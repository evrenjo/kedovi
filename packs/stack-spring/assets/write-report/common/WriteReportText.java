package __BASE_PACKAGE__.writereport;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

/** YAML · JSON 을 라이브러리 없이 쓰고, JSON 은 정규화 · 색인 합치기에 필요한 만큼 읽는다. */
final class WriteReportText {

    private WriteReportText() {
    }

    private static final Pattern PLAIN_KEY = Pattern.compile("[A-Za-z_][A-Za-z0-9_$]*");
    private static final Pattern PLAIN_NAME = Pattern.compile("[A-Za-z_][A-Za-z0-9_$.#\\-]*");

    // ---------- YAML ----------

    static String yaml(Object v) {
        StringBuilder sb = new StringBuilder();
        yaml(sb, v);
        return sb.toString();
    }

    static void yaml(StringBuilder sb, Object v) {
        if (v == null) {
            sb.append("null");
        } else if (v instanceof String s) {
            quote(sb, s);
        } else if (v instanceof WriteReportWrite.Plain p) {
            if (PLAIN_NAME.matcher(p.text()).matches()) {
                sb.append(p.text());
            } else {
                quote(sb, p.text());
            }
        } else if (v instanceof Boolean || v instanceof Long || v instanceof Integer || v instanceof java.math.BigInteger) {
            sb.append(v);
        } else if (v instanceof BigDecimal d) {
            sb.append(d.toPlainString());
        } else if (v instanceof Double d) {
            sb.append(d.isNaN() ? ".nan" : d.isInfinite() ? (d > 0 ? ".inf" : "-.inf") : d.toString());
        } else if (v instanceof JNum n) {
            sb.append(n.raw());
        } else if (v instanceof LocalDate d) {
            sb.append(d);
        } else if (v instanceof WriteReportWrite.Time t) {
            quote(sb, t.iso());
        } else if (v instanceof WriteReportWrite.Bytes b) {
            sb.append("!bytes ").append(b.length());
        } else if (v instanceof WriteReportWrite.Sql s) {
            sb.append("!sql ");
            quote(sb, s.text());
        } else if (v instanceof Map<?, ?> m) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (!first) {
                    sb.append(", ");
                }
                first = false;
                String k = String.valueOf(e.getKey());
                if (PLAIN_KEY.matcher(k).matches() && !k.equals("null") && !k.equals("true") && !k.equals("false")) {
                    sb.append(k);
                } else {
                    quote(sb, k);
                }
                sb.append(": ");
                yaml(sb, e.getValue());
            }
            sb.append('}');
        } else if (v instanceof List<?> l) {
            sb.append('[');
            for (int i = 0; i < l.size(); i++) {
                if (i > 0) {
                    sb.append(", ");
                }
                yaml(sb, l.get(i));
            }
            sb.append(']');
        } else {
            quote(sb, v.toString());
        }
    }

    /** YAML 큰따옴표 문자열 (JSON 문자열과 같은 이스케이프). */
    static void quote(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
    }

    // ---------- JSON ----------

    /** JSON 숫자 원문 (읽은 숫자를 그대로 다시 쓰려고). */
    record JNum(String raw) {}

    static String json(Object v) {
        StringBuilder sb = new StringBuilder();
        json(sb, v, false);
        return sb.toString();
    }

    /** 키 이름순으로 다시 쓴 JSON (정규화용). */
    static String jsonSorted(Object v) {
        StringBuilder sb = new StringBuilder();
        json(sb, v, true);
        return sb.toString();
    }

    static void json(StringBuilder sb, Object v, boolean sortKeys) {
        if (v == null) {
            sb.append("null");
        } else if (v instanceof String s) {
            quote(sb, s);
        } else if (v instanceof WriteReportWrite.Plain p) {
            quote(sb, p.text());
        } else if (v instanceof Boolean || v instanceof Long || v instanceof Integer || v instanceof java.math.BigInteger) {
            sb.append(v);
        } else if (v instanceof BigDecimal d) {
            sb.append(d.toPlainString());
        } else if (v instanceof Double d) {
            if (d.isNaN() || d.isInfinite()) {
                quote(sb, d.toString());
            } else {
                sb.append(d);
            }
        } else if (v instanceof JNum n) {
            sb.append(n.raw());
        } else if (v instanceof LocalDate d) {
            quote(sb, d.toString());
        } else if (v instanceof WriteReportWrite.Time t) {
            quote(sb, t.iso());
        } else if (v instanceof WriteReportWrite.Bytes b) {
            sb.append("{\"$bytes\":").append(b.length()).append('}');
        } else if (v instanceof WriteReportWrite.Sql s) {
            sb.append("{\"$sql\":");
            quote(sb, s.text());
            sb.append('}');
        } else if (v instanceof Map<?, ?> m) {
            Map<?, ?> mm = m;
            if (sortKeys) {
                TreeMap<String, Object> t = new TreeMap<>();
                for (Map.Entry<?, ?> e : m.entrySet()) {
                    t.put(String.valueOf(e.getKey()), e.getValue());
                }
                mm = t;
            }
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : mm.entrySet()) {
                if (!first) {
                    sb.append(',');
                }
                first = false;
                quote(sb, String.valueOf(e.getKey()));
                sb.append(':');
                json(sb, e.getValue(), sortKeys);
            }
            sb.append('}');
        } else if (v instanceof List<?> l) {
            sb.append('[');
            for (int i = 0; i < l.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                json(sb, l.get(i), sortKeys);
            }
            sb.append(']');
        } else {
            quote(sb, v.toString());
        }
    }

    /** 최소 JSON 읽기. 객체 = LinkedHashMap, 배열 = ArrayList, 숫자 = JNum. 틀린 JSON 이면 IllegalArgumentException. */
    static Object parseJson(String s) {
        Parser p = new Parser(s);
        p.ws();
        Object v = p.value();
        p.ws();
        if (p.i != s.length()) {
            throw new IllegalArgumentException("JSON 뒤에 남은 글자가 있다");
        }
        return v;
    }

    private static final class Parser {
        final String s;
        int i;

        Parser(String s) {
            this.s = s;
        }

        void ws() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) {
                i++;
            }
        }

        IllegalArgumentException bad() {
            return new IllegalArgumentException("JSON 이 아니다 (위치 " + i + ")");
        }

        Object value() {
            if (i >= s.length()) {
                throw bad();
            }
            char c = s.charAt(i);
            switch (c) {
                case '{': {
                    i++;
                    Map<String, Object> m = new LinkedHashMap<>();
                    ws();
                    if (peek('}')) {
                        i++;
                        return m;
                    }
                    while (true) {
                        ws();
                        if (!peek('"')) {
                            throw bad();
                        }
                        String k = string();
                        ws();
                        expect(':');
                        ws();
                        m.put(k, value());
                        ws();
                        if (peek(',')) {
                            i++;
                            continue;
                        }
                        expect('}');
                        return m;
                    }
                }
                case '[': {
                    i++;
                    List<Object> l = new ArrayList<>();
                    ws();
                    if (peek(']')) {
                        i++;
                        return l;
                    }
                    while (true) {
                        ws();
                        l.add(value());
                        ws();
                        if (peek(',')) {
                            i++;
                            continue;
                        }
                        expect(']');
                        return l;
                    }
                }
                case '"':
                    return string();
                case 't':
                    word("true");
                    return Boolean.TRUE;
                case 'f':
                    word("false");
                    return Boolean.FALSE;
                case 'n':
                    word("null");
                    return null;
                default: {
                    int st = i;
                    if (peek('-')) {
                        i++;
                    }
                    while (i < s.length() && "0123456789.eE+-".indexOf(s.charAt(i)) >= 0) {
                        i++;
                    }
                    String raw = s.substring(st, i);
                    if (raw.isEmpty() || raw.equals("-")) {
                        throw bad();
                    }
                    try {
                        new BigDecimal(raw);
                    } catch (NumberFormatException e) {
                        throw bad();
                    }
                    return new JNum(raw);
                }
            }
        }

        boolean peek(char c) {
            return i < s.length() && s.charAt(i) == c;
        }

        void expect(char c) {
            if (!peek(c)) {
                throw bad();
            }
            i++;
        }

        void word(String w) {
            if (!s.startsWith(w, i)) {
                throw bad();
            }
            i += w.length();
        }

        String string() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                if (i >= s.length()) {
                    throw bad();
                }
                char c = s.charAt(i++);
                if (c == '"') {
                    return sb.toString();
                }
                if (c == '\\') {
                    if (i >= s.length()) {
                        throw bad();
                    }
                    char e = s.charAt(i++);
                    switch (e) {
                        case 'n' -> sb.append('\n');
                        case 'r' -> sb.append('\r');
                        case 't' -> sb.append('\t');
                        case 'b' -> sb.append('\b');
                        case 'f' -> sb.append('\f');
                        case 'u' -> {
                            if (i + 4 > s.length()) {
                                throw bad();
                            }
                            sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                            i += 4;
                        }
                        default -> sb.append(e);
                    }
                } else {
                    sb.append(c);
                }
            }
        }
    }
}
