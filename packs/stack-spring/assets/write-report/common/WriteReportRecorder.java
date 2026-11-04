package __BASE_PACKAGE__.writereport;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.AnnotatedElement;
import java.lang.reflect.Method;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.sql.DataSource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.TestTemplate;
import org.springframework.context.ApplicationContext;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.test.context.TestContext;

/**
 * 시험 구간과 쓰기 목록. 스레드 로컬을 쓰지 않는다: 구간이 열린 동안 그 시험의 ApplicationContext(와 부모)에서 온 쓰기는
 * 어느 스레드에서 왔든 기록한다 (배치 · 비동기 쓰기). 캐시된 다른 문맥(Quartz · 릴레이 등)의 쓰기는 버린다.
 * 직렬 실행만: 구간이 겹치면 즉시 실패시킨다.
 */
final class WriteReportRecorder {

    private WriteReportRecorder() {
    }

    /** 한 시험의 기록 구간. */
    static final class Window {
        final String id;
        final String group;
        final String name;
        final List<String> specs;
        final String started;
        final Set<Object> contexts;
        final List<WriteReportWrite> writes = new ArrayList<>();
        final Set<DataSource> dataSources = Collections.newSetFromMap(new IdentityHashMap<>());
        int seq;
        boolean closed;

        Window(String group, String name, List<String> specs, Set<Object> contexts) {
            this.group = group;
            this.name = name;
            this.id = group + "#" + name;
            this.specs = specs;
            this.contexts = contexts;
            this.started = OffsetDateTime.now().truncatedTo(ChronoUnit.MILLIS).toString();
        }
    }

    private static final Object LOCK = new Object();
    private static Window current;
    private static Window lastClosed;
    /** 구간이 열린 문맥들 (빠른 확인용). */
    private static volatile Set<Object> activeContexts;
    private static volatile String stack = "jdbc";
    private static final Map<String, Map<String, Object>> finished = new LinkedHashMap<>();
    private static final Map<String, Integer> invocations = new HashMap<>();
    private static final Map<String, long[]> updatesOnlyCounts = new LinkedHashMap<>();
    static final WriteReportCatalog CATALOG = new WriteReportCatalog();
    private static final Set<DataSource> catalogRead = Collections.newSetFromMap(new IdentityHashMap<>());
    private static boolean hookInstalled;

    static void stack(String name) {
        stack = name;
    }

    /** 이 문맥에서 온 쓰기를 지금 기록하는지. 문장마다 부르므로 가볍게. */
    static boolean active(Object context) {
        Set<Object> a = activeContexts;
        return a != null && a.contains(context);
    }

    static void record(Object context, WriteReportConnections.Handle handle, WriteReportWrite w) {
        recordBatch(context, handle, List.of(w));
    }

    /** 배치 쓰기. 같은 모양의 INSERT 계열이 이어지면 한 건(여러 행)으로 합친다. */
    static void recordBatch(Object context, WriteReportConnections.Handle handle, List<WriteReportWrite> ws) {
        if (!active(context) || ws.isEmpty()) {
            return;
        }
        List<WriteReportWrite> merged = mergeInserts(ws);
        WriteReportConfig cfg = WriteReportConfig.get();
        synchronized (LOCK) {
            Window win = current;
            if (win == null || win.closed || !win.contexts.contains(context)) {
                return;
            }
            for (WriteReportWrite w : merged) {
                if (w.table != null && cfg.excluded(w.table)) {
                    continue;
                }
                if (updatesOnly(cfg, w)) {
                    continue;
                }
                w.seq = ++win.seq;
                win.writes.add(w);
                if (handle != null) {
                    if (handle.inTransaction()) {
                        handle.addPending(w);
                    }
                    if (handle.rawDataSource != null) {
                        win.dataSources.add(handle.rawDataSource);
                    }
                }
            }
        }
    }

    private static boolean updatesOnly(WriteReportConfig cfg, WriteReportWrite w) {
        if (!"UPDATE".equals(w.op) || w.table == null || w.set == null || w.set.isEmpty() || cfg.updatesOnly.isEmpty()) {
            return false;
        }
        for (WriteReportConfig.UpdatesOnly u : cfg.updatesOnly) {
            if (WriteReportConfig.matchTable(u.tablePattern(), w.table) && u.columns().containsAll(lower(w.set.keySet()))) {
                updatesOnlyCounts.computeIfAbsent(u.table() + ":" + String.join(",", u.columns()), k -> new long[1])[0]++;
                return true;
            }
        }
        return false;
    }

    private static Set<String> lower(Set<String> s) {
        Set<String> out = new LinkedHashSet<>();
        for (String x : s) {
            out.add(x.toLowerCase(java.util.Locale.ROOT));
        }
        return out;
    }

    private static List<WriteReportWrite> mergeInserts(List<WriteReportWrite> ws) {
        if (ws.size() < 2) {
            return ws;
        }
        List<WriteReportWrite> out = new ArrayList<>();
        for (WriteReportWrite w : ws) {
            WriteReportWrite last = out.isEmpty() ? null : out.get(out.size() - 1);
            if (last != null && sameShape(last, w)) {
                last.rows.addAll(w.rows);
                if (last.resultRows != null && w.resultRows != null) {
                    last.resultRows += w.resultRows;
                } else {
                    last.resultRows = null;
                }
            } else {
                if (w.rows != null) {
                    w.rows = new ArrayList<>(w.rows);
                }
                out.add(w);
            }
        }
        return out;
    }

    private static boolean sameShape(WriteReportWrite a, WriteReportWrite b) {
        return a.op != null && a.op.startsWith("INSERT") || "UPSERT".equals(a.op)
                ? Objects.equals(a.op, b.op) && Objects.equals(a.table, b.table) && a.rows != null && b.rows != null
                        && a.sql == null && b.sql == null && a.errorState == null && b.errorState == null
                        && !a.rows.isEmpty() && !b.rows.isEmpty() && a.rows.get(0).keySet().equals(b.rows.get(0).keySet())
                        && Objects.equals(a.set, b.set) && Objects.equals(a.sameAsInsert, b.sameAsInsert)
                        && Objects.equals(a.conflict, b.conflict) && Objects.equals(a.whereSql, b.whereSql)
                : false;
    }

    // ---------- 구간 ----------

    static void open(TestContext tc) {
        installHook();
        ApplicationContext ctx = tc.getApplicationContext();
        Set<Object> contexts = Collections.newSetFromMap(new IdentityHashMap<>());
        for (ApplicationContext c = ctx; c != null; c = c.getParent()) {
            contexts.add(c);
        }
        Method m = tc.getTestMethod();
        String group = tc.getTestClass().getName();
        String name = m.getName();
        if (AnnotatedElementUtils.hasAnnotation(m, TestTemplate.class)) {
            // 매개변수 시험 · 반복 시험: 실행 번호를 붙인다 (method[1] → method_1_)
            int n;
            synchronized (LOCK) {
                n = invocations.merge(group + "#" + name, 1, Integer::sum);
            }
            name = name + "_" + n + "_";
        }
        Window w = new Window(group, name, specs(tc.getTestClass(), m), contexts);
        synchronized (LOCK) {
            if (current != null && !current.closed) {
                String other = current.id;
                throw new IllegalStateException("쓰기 보고서는 시험을 하나씩 돌릴 때만 기록한다: " + other + " 와 " + w.id
                        + " 의 구간이 겹쳤다. 병렬 실행(junit.jupiter.execution.parallel.enabled)을 끄거나 이 시험 묶음만 따로 돌린다");
            }
            current = w;
            activeContexts = contexts;
        }
        tc.setAttribute(WINDOW_ATTRIBUTE, w);
    }

    private static final String WINDOW_ATTRIBUTE = WriteReportRecorder.class.getName() + ".window";

    /** afterTestExecution: 구간만 닫는다. 직렬화는 트랜잭션 완료를 본 뒤(afterTestMethod). */
    static void close(TestContext tc) {
        Window w = (Window) tc.getAttribute(WINDOW_ATTRIBUTE);
        synchronized (LOCK) {
            // 이 시험이 연 구간만 닫는다 (구간을 못 연 시험 · 겹친 시험이 남의 구간을 닫지 않게)
            if (w == null || w != current || w.closed) {
                return;
            }
            w.closed = true;
            activeContexts = null;
            lastClosed = w;
        }
        loadCatalog(w);
    }

    /** afterTestMethod (TransactionalTestExecutionListener 의 롤백 뒤): 원본 YAML 을 쓴다. */
    static void finish(TestContext tc) {
        close(tc);
        Window w = (Window) tc.removeAttribute(WINDOW_ATTRIBUTE);
        if (w == null) {
            return;
        }
        synchronized (LOCK) {
            if (current == w) {
                current = null;
            }
        }
        Throwable ex = tc.getTestException();
        String status = ex == null ? "passed"
                : ex.getClass().getName().contains("Aborted") || ex.getClass().getName().contains("Assumption") ? "skipped" : "failed";
        List<WriteReportWrite> writes;
        synchronized (LOCK) {
            writes = new ArrayList<>(w.writes);
        }
        WriteReportConfig cfg = WriteReportConfig.get();
        Path file = cfg.output.resolve(safe(w.group)).resolve(safe(w.name) + ".yaml");
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, yaml(w, writes), StandardCharsets.UTF_8);
        } catch (IOException e) {
            System.err.println("[write-report] " + file + " 를 쓰지 못했다: " + e.getMessage());
        }
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("id", w.id);
        entry.put("group", w.group);
        entry.put("name", w.name);
        entry.put("file", safe(w.group) + "/" + safe(w.name) + ".yaml");
        entry.put("specs", new ArrayList<Object>(w.specs));
        entry.put("status", status);
        List<Object> ws = new ArrayList<>();
        for (WriteReportWrite x : writes) {
            ws.add(x.fields(true));
        }
        entry.put("writes", ws);
        synchronized (LOCK) {
            finished.put(w.id, entry);
        }
    }

    /** assertMatches 용: 지금 열린 구간, 없으면 방금 닫힌 구간 (@AfterEach 에서 부를 때). */
    static Window window() {
        synchronized (LOCK) {
            return current != null ? current : lastClosed;
        }
    }

    static List<WriteReportWrite> writes(Window w) {
        synchronized (LOCK) {
            return new ArrayList<>(w.writes);
        }
    }

    /** 구간에서 쓴 테이블 중 catalog 에 없는 것이 있으면 그 DataSource 를 (한 번 더) 읽는다. */
    static void loadCatalog(Window w) {
        Set<String> tables = new LinkedHashSet<>();
        List<DataSource> sources;
        synchronized (LOCK) {
            for (WriteReportWrite x : w.writes) {
                if (x.table != null) {
                    tables.add(x.table);
                }
            }
            sources = new ArrayList<>(w.dataSources);
        }
        if (tables.isEmpty() || CATALOG.knowsAll(tables)) {
            return;
        }
        for (DataSource ds : sources) {
            boolean first;
            synchronized (LOCK) {
                first = catalogRead.add(ds);
            }
            if (first || !CATALOG.knowsAll(tables)) {
                CATALOG.read(ds);
            }
        }
    }

    static String safe(String s) {
        return s.replaceAll("[^A-Za-z0-9._$\\-]", "_");
    }

    private static String yaml(Window w, List<WriteReportWrite> writes) {
        StringBuilder sb = new StringBuilder();
        sb.append("test: ").append(w.id).append('\n');
        sb.append("specs: [").append(String.join(", ", w.specs)).append("]\n");
        sb.append("started: ").append(w.started).append('\n');
        if (writes.isEmpty()) {
            sb.append("writes: []\n");
            return sb.toString();
        }
        sb.append("writes:\n");
        for (WriteReportWrite x : writes) {
            boolean first = true;
            for (Map.Entry<String, Object> e : x.fields(true).entrySet()) {
                sb.append(first ? "  - " : "    ").append(e.getKey()).append(':');
                first = false;
                if (e.getKey().equals("rows")) {
                    sb.append('\n');
                    for (Object r : (List<?>) e.getValue()) {
                        sb.append("      - ");
                        WriteReportText.yaml(sb, r);
                        sb.append('\n');
                    }
                } else {
                    sb.append(' ');
                    WriteReportText.yaml(sb, e.getValue());
                    sb.append('\n');
                }
            }
        }
        return sb.toString();
    }

    // ---------- 기획 ID ----------

    private static final Pattern SPEC = Pattern.compile("(?<![A-Za-z0-9])([A-Z]{2,5})[-_]([A-Z0-9]+)((?:[-_][0-9]+)+)(?![A-Za-z0-9])");

    static List<String> specs(Class<?> testClass, Method m) {
        Set<String> out = new LinkedHashSet<>();
        List<String> sources = new ArrayList<>();
        sources.add(m.getName());
        addAnnotated(sources, m);
        for (Class<?> c = testClass; c != null; c = c.getEnclosingClass()) {
            addAnnotated(sources, c);
        }
        for (String s : sources) {
            Matcher mt = SPEC.matcher(s);
            while (mt.find()) {
                out.add(mt.group().replace('_', '-'));
            }
        }
        return new ArrayList<>(out);
    }

    private static void addAnnotated(List<String> sources, AnnotatedElement e) {
        for (Tag t : AnnotatedElementUtils.findMergedRepeatableAnnotations(e, Tag.class)) {
            sources.add(t.value());
        }
        DisplayName d = AnnotatedElementUtils.findMergedAnnotation(e, DisplayName.class);
        if (d != null) {
            sources.add(d.value());
        }
    }

    // ---------- 색인 (JVM 종료 훅) ----------

    private static void installHook() {
        synchronized (LOCK) {
            if (hookInstalled) {
                return;
            }
            hookInstalled = true;
        }
        Runtime.getRuntime().addShutdownHook(new Thread(WriteReportRecorder::writeIndex, "write-report-index"));
    }

    /** index.json · index.html. 이미 있는 index.json 과 합친다 (다른 JVM · 앞선 일부 실행의 시험을 남긴다). */
    @SuppressWarnings("unchecked")
    static void writeIndex() {
        WriteReportConfig cfg = WriteReportConfig.get();
        Path out = cfg.output;
        try {
            Files.createDirectories(out);
            try (FileChannel ch = FileChannel.open(out.resolve(".index.lock"), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
                 FileLock ignored = ch.lock()) {
                Path indexFile = out.resolve("index.json");
                Map<String, Object> tests = new LinkedHashMap<>();
                Map<String, Object> catalog = new LinkedHashMap<>();
                List<Object> oldUpdatesOnly = new ArrayList<>();
                if (Files.exists(indexFile)) {
                    try {
                        Map<String, Object> old = (Map<String, Object>) WriteReportText.parseJson(Files.readString(indexFile, StandardCharsets.UTF_8));
                        for (Object t : (List<Object>) old.getOrDefault("tests", List.of())) {
                            Map<String, Object> tm = (Map<String, Object>) t;
                            Object file = tm.get("file");
                            if (file != null && Files.exists(out.resolve(file.toString()))) {
                                tests.put(String.valueOf(tm.get("id")), tm);
                            }
                        }
                        Object c = old.get("catalog");
                        if (c instanceof Map<?, ?> cm) {
                            catalog.putAll((Map<String, Object>) cm);
                        }
                        Object ex = old.get("excluded");
                        if (ex instanceof Map<?, ?> em && em.get("updatesOnly") instanceof List<?> ul) {
                            oldUpdatesOnly.addAll(ul);
                        }
                    } catch (RuntimeException e) {
                        System.err.println("[write-report] 이전 index.json 을 읽지 못해 새로 쓴다: " + e.getMessage());
                    }
                }
                synchronized (LOCK) {
                    tests.putAll(finished);
                }
                for (Map.Entry<String, Object> s : CATALOG.toJson().entrySet()) {
                    Object prev = catalog.get(s.getKey());
                    if (prev instanceof Map<?, ?> pm) {
                        Map<String, Object> m = new LinkedHashMap<>((Map<String, Object>) pm);
                        m.putAll((Map<String, Object>) s.getValue());
                        catalog.put(s.getKey(), m);
                    } else {
                        catalog.put(s.getKey(), s.getValue());
                    }
                }
                Map<String, Object> excluded = new LinkedHashMap<>();
                excluded.put("tables", new ArrayList<Object>(cfg.excludeTablePatterns()));
                List<Object> uo = new ArrayList<>();
                synchronized (LOCK) {
                    for (Map.Entry<String, long[]> e : updatesOnlyCounts.entrySet()) {
                        int at = e.getKey().indexOf(':');
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("table", e.getKey().substring(0, at));
                        m.put("columns", new ArrayList<Object>(List.of(e.getKey().substring(at + 1).split(","))));
                        m.put("count", e.getValue()[0]);
                        uo.add(m);
                    }
                }
                excluded.put("updatesOnly", uo.isEmpty() ? oldUpdatesOnly : uo);

                Map<String, Object> index = new LinkedHashMap<>();
                index.put("format", 1L);
                index.put("generatedAt", OffsetDateTime.now().truncatedTo(ChronoUnit.SECONDS).toString());
                index.put("repo", cfg.repo);
                index.put("stack", stack);
                List<Object> sorted = new ArrayList<>(tests.values());
                sorted.sort((a, b) -> String.valueOf(((Map<?, ?>) a).get("id")).compareTo(String.valueOf(((Map<?, ?>) b).get("id"))));
                index.put("tests", sorted);
                index.put("catalog", catalog);
                index.put("excluded", excluded);
                String json = WriteReportText.json(index);
                Files.writeString(indexFile, json, StandardCharsets.UTF_8);
                writeHtml(out, json);
            }
        } catch (IOException | RuntimeException e) {
            System.err.println("[write-report] 색인을 쓰지 못했다: " + e);
        }
    }

    private static void writeHtml(Path out, String json) throws IOException {
        ClassLoader cl = WriteReportRecorder.class.getClassLoader();
        try (InputStream in = cl.getResourceAsStream("write-report/viewer.html")) {
            if (in == null) {
                System.err.println("[write-report] classpath 에 write-report/viewer.html 이 없어 index.html 은 건너뛴다");
                return;
            }
            String viewer = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            String slot = "/*__WRITE_REPORT_DATA__*/null";
            int at = viewer.indexOf(slot);
            if (at < 0 || viewer.indexOf(slot, at + 1) >= 0) {
                System.err.println("[write-report] viewer.html 의 데이터 자리(" + slot + ")가 정확히 한 번 있지 않아 index.html 은 건너뛴다");
                return;
            }
            // </script> 가 데이터 안에 있어도 페이지가 깨지지 않게. 정규식 치환은 쓰지 않는다 ($ 글자)
            String safeJson = json.replace("</", "<\\/");
            Files.writeString(out.resolve("index.html"), viewer.substring(0, at) + safeJson + viewer.substring(at + slot.length()),
                    StandardCharsets.UTF_8);
        }
    }
}
