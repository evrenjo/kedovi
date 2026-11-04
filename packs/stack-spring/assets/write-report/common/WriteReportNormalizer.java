package __BASE_PACKAGE__.writereport;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Pattern;

/** 승인본 모양으로 바꾼다 (FORMAT.md 「정규화」 표). */
final class WriteReportNormalizer {

    private WriteReportNormalizer() {
    }

    private static final Pattern UUID = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private static final String NOW_FN = "(now\\(\\)|current_timestamp(\\(\\d*\\))?|localtimestamp(\\(\\d*\\))?|clock_timestamp\\(\\)"
            + "|statement_timestamp\\(\\)|transaction_timestamp\\(\\)|sysdate(\\(\\))?|systimestamp|getdate\\(\\)|current_date|current_time)";
    /** now() · current_timestamp 와 그 형 변환(cast(... as t) · ...::t). */
    private static final Pattern NOW_SQL = Pattern.compile(
            "(?i)\\s*(" + NOW_FN + "|cast\\(\\s*" + NOW_FN + "\\s+as\\s+[a-z0-9_ (),]+\\)|" + NOW_FN + "\\s*::\\s*[a-z0-9_ ()]+)\\s*");

    /** 쓰기 목록 → 승인본 YAML. tables 가 비면 쓴 테이블 전부. */
    static String approval(List<WriteReportWrite> writes, String[] tables, WriteReportCatalog catalog, WriteReportConfig cfg) {
        // 1. 승인본 모양 맵 (seq · table 없음) 을 테이블별로
        List<String> tableOf = new ArrayList<>();
        List<Map<String, Object>> maps = new ArrayList<>();
        for (WriteReportWrite w : writes) {
            tableOf.add(w.table == null ? "(테이블 모름)" : w.table);
            maps.add(deepCopy(w.fields(false)));
        }
        // 2. 생성 ID: 테이블 · 컬럼마다 원값 숫자 오름차순 번호
        Map<String, Map<String, TreeSet<BigDecimal>>> idValues = new HashMap<>();
        for (int i = 0; i < maps.size(); i++) {
            String t = tableOf.get(i);
            for (String col : idColumns(t, maps.get(i), catalog, cfg)) {
                collectNumbers(maps.get(i), col, idValues.computeIfAbsent(t, k -> new HashMap<>()).computeIfAbsent(col, k -> new TreeSet<>()));
            }
        }
        for (int i = 0; i < maps.size(); i++) {
            Map<String, TreeSet<BigDecimal>> cols = idValues.get(tableOf.get(i));
            if (cols != null) {
                for (Map.Entry<String, TreeSet<BigDecimal>> e : cols.entrySet()) {
                    Map<BigDecimal, String> label = new HashMap<>();
                    int n = 0;
                    for (BigDecimal v : e.getValue()) {
                        label.put(v.stripTrailingZeros(), "<" + e.getKey() + "-" + (++n) + ">");
                    }
                    replaceColumn(maps.get(i), e.getKey(), label);
                }
            }
            normalizeValues(maps.get(i), cfg);
        }
        // 3. 테이블별로 묶고 정렬
        Map<String, List<String>> byTable = new TreeMap<>();
        for (int i = 0; i < maps.size(); i++) {
            byTable.computeIfAbsent(tableOf.get(i), k -> new ArrayList<>()).add(WriteReportText.yaml(maps.get(i)));
        }
        Map<String, List<String>> chosen = new TreeMap<>();
        if (tables == null || tables.length == 0) {
            chosen.putAll(byTable);
        } else {
            for (String want : tables) {
                String key = want;
                List<String> found = new ArrayList<>();
                for (Map.Entry<String, List<String>> e : byTable.entrySet()) {
                    if (sameTable(e.getKey(), want)) {
                        key = e.getKey();
                        found.addAll(e.getValue());
                    }
                }
                chosen.computeIfAbsent(key, k -> new ArrayList<>()).addAll(found);
            }
        }
        StringBuilder sb = new StringBuilder();
        if (chosen.isEmpty()) {
            return "{}\n";
        }
        for (Map.Entry<String, List<String>> e : chosen.entrySet()) {
            List<String> items = e.getValue();
            items.sort(NATURAL);
            sb.append(yamlKey(e.getKey())).append(':');
            if (items.isEmpty()) {
                sb.append(" []\n");
            } else {
                sb.append('\n');
                for (String it : items) {
                    sb.append("  - ").append(it).append('\n');
                }
            }
        }
        return sb.toString();
    }

    private static String yamlKey(String k) {
        return k.matches("[A-Za-z_][A-Za-z0-9_$.\\-]*") ? k : WriteReportText.yaml(k);
    }

    /** "daily_sales" 는 "shop.daily_sales" 와 같은 테이블로 본다. */
    static boolean sameTable(String written, String wanted) {
        String a = written.toLowerCase(Locale.ROOT);
        String b = wanted.toLowerCase(Locale.ROOT);
        if (a.equals(b)) {
            return true;
        }
        return !b.contains(".") && a.endsWith("." + b) || !a.contains(".") && b.endsWith("." + a);
    }

    private static Set<String> idColumns(String table, Map<String, Object> w, WriteReportCatalog catalog, WriteReportConfig cfg) {
        Set<String> cols = new LinkedHashSet<>();
        Set<String> seen = new LinkedHashSet<>();
        for (String part : List.of("rows", "set", "where")) {
            Object v = w.get(part);
            if (v instanceof List<?> l) {
                for (Object r : l) {
                    if (r instanceof Map<?, ?> m) {
                        for (Object k : m.keySet()) {
                            seen.add(String.valueOf(k));
                        }
                    }
                }
            } else if (v instanceof Map<?, ?> m) {
                for (Object k : m.keySet()) {
                    seen.add(String.valueOf(k));
                }
            }
        }
        if (cfg.ids != null) {
            for (String c : seen) {
                if (cfg.idColumn(table, c)) {
                    cols.add(c);
                }
            }
        } else {
            WriteReportCatalog.Table t = catalog.find(table);
            String id = t == null ? null : t.generatedId();
            if (id != null && seen.contains(id)) {
                cols.add(id);
            }
        }
        return cols;
    }

    private static BigDecimal number(Object v) {
        try {
            if (v instanceof Long || v instanceof Integer || v instanceof BigInteger) {
                return new BigDecimal(v.toString()).stripTrailingZeros();
            }
            if (v instanceof BigDecimal d) {
                return d.stripTrailingZeros();
            }
            if (v instanceof WriteReportText.JNum n) {
                return new BigDecimal(n.raw()).stripTrailingZeros();
            }
        } catch (NumberFormatException e) {
            return null;
        }
        return null;
    }

    private static void collectNumbers(Map<String, Object> w, String col, TreeSet<BigDecimal> into) {
        forColumn(w, col, v -> {
            BigDecimal d = number(v);
            if (d != null) {
                into.add(d);
            }
            return v;
        });
    }

    private static void replaceColumn(Map<String, Object> w, String col, Map<BigDecimal, String> label) {
        forColumn(w, col, v -> {
            BigDecimal d = number(v);
            String l = d == null ? null : label.get(d);
            return l != null ? l : v;
        });
    }

    private interface ValueFn {
        Object apply(Object v);
    }

    /** rows · set · where 안의 그 컬럼 값을 바꾼다 (IN 목록은 원소마다). */
    @SuppressWarnings("unchecked")
    private static void forColumn(Map<String, Object> w, String col, ValueFn fn) {
        List<Map<String, Object>> targets = new ArrayList<>();
        if (w.get("rows") instanceof List<?> rows) {
            for (Object r : rows) {
                targets.add((Map<String, Object>) r);
            }
        }
        if (w.get("set") instanceof Map<?, ?> s) {
            targets.add((Map<String, Object>) s);
        }
        if (w.get("where") instanceof Map<?, ?> s) {
            targets.add((Map<String, Object>) s);
        }
        for (Map<String, Object> m : targets) {
            if (m.containsKey(col)) {
                Object v = m.get(col);
                if (v instanceof List<?> l) {
                    List<Object> nl = new ArrayList<>();
                    for (Object o : l) {
                        nl.add(fn.apply(o));
                    }
                    m.put(col, nl);
                } else {
                    m.put(col, fn.apply(v));
                }
            }
        }
    }

    @SuppressWarnings("unchecked")
    private static void normalizeValues(Map<String, Object> w, WriteReportConfig cfg) {
        for (String part : List.of("rows", "set", "where")) {
            Object v = w.get(part);
            if (v instanceof List<?> l) {
                for (Object r : l) {
                    normalizeMap((Map<String, Object>) r, cfg);
                }
            } else if (v instanceof Map<?, ?> m) {
                normalizeMap((Map<String, Object>) m, cfg);
            }
        }
        if (w.get("result") instanceof Map<?, ?> r && r.get("message") instanceof String msg) {
            String m = WriteReportWrite.cleanMessage(msg);
            for (WriteReportConfig.Replace rp : cfg.replace) {
                m = rp.pattern().matcher(m).replaceAll(rp.with());
            }
            ((Map<String, Object>) r).put("message", m.trim());
        }
    }

    private static void normalizeMap(Map<String, Object> m, WriteReportConfig cfg) {
        for (Map.Entry<String, Object> e : m.entrySet()) {
            boolean nowColumn = cfg.now.contains(e.getKey().toLowerCase(Locale.ROOT));
            e.setValue(normalizeValue(e.getValue(), nowColumn));
        }
    }

    private static Object normalizeValue(Object v, boolean nowColumn) {
        if (v instanceof List<?> l) {
            List<Object> out = new ArrayList<>();
            for (Object o : l) {
                out.add(normalizeValue(o, nowColumn));
            }
            return out;
        }
        if (v instanceof WriteReportWrite.Sql s && NOW_SQL.matcher(s.text()).matches()) {
            return "<now>";
        }
        if (nowColumn && v != null && !(v instanceof String str && str.startsWith("<"))) {
            return "<now>";
        }
        if (v instanceof String s) {
            if (UUID.matcher(s).matches()) {
                return "<uuid>";
            }
            String t = s.trim();
            if (t.startsWith("{") || t.startsWith("[")) {
                try {
                    return WriteReportText.jsonSorted(WriteReportText.parseJson(t));
                } catch (IllegalArgumentException ignored) {
                    return s;
                }
            }
        }
        return v;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> deepCopy(Map<String, Object> m) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : m.entrySet()) {
            out.put(e.getKey(), copy(e.getValue()));
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Object copy(Object v) {
        if (v instanceof Map<?, ?> m) {
            return deepCopy((Map<String, Object>) m);
        }
        if (v instanceof List<?> l) {
            List<Object> out = new ArrayList<>();
            for (Object o : l) {
                out.add(copy(o));
            }
            return out;
        }
        return v;
    }

    /** 숫자 덩어리는 수로 비교하는 문자열 정렬. */
    static final Comparator<String> NATURAL = (a, b) -> {
        int i = 0;
        int j = 0;
        while (i < a.length() && j < b.length()) {
            char ca = a.charAt(i);
            char cb = b.charAt(j);
            if (Character.isDigit(ca) && Character.isDigit(cb)) {
                int si = i;
                int sj = j;
                while (i < a.length() && Character.isDigit(a.charAt(i))) {
                    i++;
                }
                while (j < b.length() && Character.isDigit(b.charAt(j))) {
                    j++;
                }
                int c = new BigInteger(a.substring(si, i)).compareTo(new BigInteger(b.substring(sj, j)));
                if (c != 0) {
                    return c;
                }
            } else {
                if (ca != cb) {
                    return Character.compare(ca, cb);
                }
                i++;
                j++;
            }
        }
        return Integer.compare(a.length() - i, b.length() - j);
    };
}
