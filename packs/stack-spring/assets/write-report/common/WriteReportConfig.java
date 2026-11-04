package __BASE_PACKAGE__.writereport;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * 쓰기 보고서 설정. classpath 의 write-report.properties (src/test/resources) 한 곳에서 읽는다.
 * 키 설명은 그 파일 템플릿의 주석과 packs/core/assets/write-report/FORMAT.md 에 있다.
 */
final class WriteReportConfig {

    static final List<String> DEFAULT_EXCLUDE_TABLES =
            List.of("batch_*", "qrtz_*", "flyway_schema_history", "databasechangelog*", "shedlock");
    static final List<String> DEFAULT_NOW = List.of("created_at", "updated_at", "inserted_at", "modified_at");

    final Path output;
    final Path approved;
    final String repo;
    /** null 이면 기본 규칙(기본 키 하나짜리 숫자 컬럼 중 DB 가 값을 만드는 컬럼). 값은 스키마.테이블.컬럼 또는 테이블.컬럼. */
    final Set<String> ids;
    final Set<String> now;
    final List<Replace> replace;
    final String unknownBinds;
    final List<Pattern> excludeTables;
    final List<String> excludeTablePatterns;
    final List<UpdatesOnly> updatesOnly;

    record Replace(Pattern pattern, String with) {}

    record UpdatesOnly(String table, Pattern tablePattern, Set<String> columns) {}

    private static volatile WriteReportConfig instance;

    static WriteReportConfig get() {
        WriteReportConfig c = instance;
        if (c == null) {
            synchronized (WriteReportConfig.class) {
                c = instance;
                if (c == null) {
                    c = instance = load();
                }
            }
        }
        return c;
    }

    static boolean approveMode() {
        return Boolean.parseBoolean(System.getProperty("writeReport.approve", "false").trim());
    }

    private WriteReportConfig(Properties p) {
        boolean maven = new File("pom.xml").exists()
                && !new File("build.gradle").exists() && !new File("build.gradle.kts").exists();
        this.output = Path.of(p.getProperty("output", maven ? "target/write-report" : "build/write-report").trim());
        this.approved = Path.of(p.getProperty("approved", "src/test/resources/write-report/approved").trim());
        String r = p.getProperty("repo", "").trim();
        this.repo = r.isEmpty() ? new File("").getAbsoluteFile().getName() : r;
        String idsValue = p.getProperty("ids");
        this.ids = idsValue == null ? null : lowerSet(split(idsValue));
        this.now = lowerSet(p.containsKey("now") ? split(p.getProperty("now")) : DEFAULT_NOW);
        this.replace = new ArrayList<>();
        for (String v : numbered(p, "replace.")) {
            int at = v.lastIndexOf("=>");
            String regex = at < 0 ? v : v.substring(0, at);
            String with = at < 0 ? "" : v.substring(at + 2);
            replace.add(new Replace(Pattern.compile(regex), with));
        }
        String ub = p.getProperty("mask.unknownBinds", "type").trim().toLowerCase(Locale.ROOT);
        if (!Set.of("type", "hide", "show").contains(ub)) {
            throw new IllegalStateException("write-report.properties: mask.unknownBinds 는 type | hide | show 중 하나다 (지금 " + ub + ")");
        }
        this.unknownBinds = ub;
        this.excludeTablePatterns = p.containsKey("exclude.tables") ? split(p.getProperty("exclude.tables")) : DEFAULT_EXCLUDE_TABLES;
        this.excludeTables = new ArrayList<>();
        for (String g : excludeTablePatterns) {
            excludeTables.add(glob(g));
        }
        this.updatesOnly = new ArrayList<>();
        for (String v : numbered(p, "exclude.updatesOnly.")) {
            int at = v.indexOf(':');
            if (at < 0) {
                throw new IllegalStateException("write-report.properties: exclude.updatesOnly 값은 테이블:컬럼,컬럼 모양이다 (지금 " + v + ")");
            }
            String table = v.substring(0, at).trim();
            updatesOnly.add(new UpdatesOnly(table, glob(table), lowerSet(split(v.substring(at + 1)))));
        }
    }

    private static WriteReportConfig load() {
        Properties p = new Properties();
        ClassLoader cl = Thread.currentThread().getContextClassLoader();
        if (cl == null) {
            cl = WriteReportConfig.class.getClassLoader();
        }
        try (InputStream in = cl.getResourceAsStream("write-report.properties")) {
            if (in != null) {
                p.load(new InputStreamReader(in, StandardCharsets.UTF_8));
            }
        } catch (IOException e) {
            throw new IllegalStateException("write-report.properties 를 읽지 못했다", e);
        }
        return new WriteReportConfig(p);
    }

    /** 테이블 이름(스키마.테이블)이 제외 목록에 드는지. 패턴에 점이 없으면 테이블 이름만 맞춘다. */
    boolean excluded(String qualifiedTable) {
        for (Pattern pt : excludeTables) {
            if (matchTable(pt, qualifiedTable)) {
                return true;
            }
        }
        return false;
    }

    static boolean matchTable(Pattern pattern, String qualifiedTable) {
        String t = qualifiedTable.toLowerCase(Locale.ROOT);
        if (pattern.pattern().contains("\\.")) {
            return pattern.matcher(t).matches();
        }
        int dot = t.lastIndexOf('.');
        return pattern.matcher(dot < 0 ? t : t.substring(dot + 1)).matches();
    }

    /** ids 설정이 이 컬럼을 고르는지 (스키마.테이블.컬럼 또는 테이블.컬럼). */
    boolean idColumn(String qualifiedTable, String column) {
        if (ids == null) {
            return false;
        }
        String t = qualifiedTable.toLowerCase(Locale.ROOT);
        String c = column.toLowerCase(Locale.ROOT);
        int dot = t.lastIndexOf('.');
        String bare = dot < 0 ? t : t.substring(dot + 1);
        return ids.contains(t + "." + c) || ids.contains(bare + "." + c);
    }

    /** 와일드카드 * 만 쓰는 이름 패턴. 점이 들어 있으면 스키마.테이블 전체와 맞춘다. */
    static Pattern glob(String g) {
        StringBuilder sb = new StringBuilder();
        for (char ch : g.trim().toLowerCase(Locale.ROOT).toCharArray()) {
            if (ch == '*') {
                sb.append(".*");
            } else if (Character.isLetterOrDigit(ch) || ch == '_') {
                sb.append(ch);
            } else {
                sb.append('\\').append(ch);
            }
        }
        return Pattern.compile(sb.toString());
    }

    private static List<String> numbered(Properties p, String prefix) {
        Map<Integer, String> byNo = new TreeMap<>();
        for (String k : p.stringPropertyNames()) {
            if (k.startsWith(prefix)) {
                try {
                    byNo.put(Integer.parseInt(k.substring(prefix.length()).trim()), p.getProperty(k));
                } catch (NumberFormatException e) {
                    throw new IllegalStateException("write-report.properties: " + k + " 는 " + prefix + "<번호> 모양이어야 한다");
                }
            }
        }
        return new ArrayList<>(byNo.values());
    }

    private static List<String> split(String v) {
        List<String> out = new ArrayList<>();
        for (String s : v.split(",")) {
            if (!s.isBlank()) {
                out.add(s.trim());
            }
        }
        return out;
    }

    private static Set<String> lowerSet(List<String> values) {
        Set<String> out = new LinkedHashSet<>();
        for (String s : values) {
            out.add(s.toLowerCase(Locale.ROOT));
        }
        return out;
    }

    /** index.json 의 excluded.tables 에 넣을 목록. */
    List<String> excludeTablePatterns() {
        return excludeTablePatterns;
    }
}
