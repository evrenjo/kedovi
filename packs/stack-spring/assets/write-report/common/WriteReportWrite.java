package __BASE_PACKAGE__.writereport;

import java.lang.reflect.Array;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.OffsetTime;
import java.time.ZonedDateTime;
import java.time.temporal.Temporal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 쓰기 한 건 (FORMAT.md 의 writes 항목). 키 순서는 FORMAT.md 표 순서다.
 * 값은 기록할 때 표준 모양으로 바꿔 둔다: 문자열 · Long · BigInteger · BigDecimal · Double · Boolean · null ·
 * LocalDate(날짜) · Time(시각 문자열) · Bytes · Sql(바인드가 아닌 식) · List.
 */
final class WriteReportWrite {

    int seq;
    String op;
    String table;
    List<Map<String, Object>> rows;
    Map<String, Object> set;
    List<String> sameAsInsert;
    List<String> conflict;
    Map<String, Object> where;
    String whereSql;
    String sql;
    Long resultRows;
    String errorState;
    String errorMessage;
    volatile boolean rolledBack;

    /** 바인드가 아닌 식 (YAML !sql). */
    record Sql(String text) {}

    /** 바이트 값 (YAML !bytes 길이). 길이를 모르면 -1. */
    record Bytes(int length) {}

    /** 시각 값. ISO-8601 문자열로 쓴다. */
    record Time(String iso) {}

    static final String MASK = "***";

    private static final Pattern SECRET_COLUMN = Pattern.compile(
            "(^|_)(app|api|access|private|secret)_?key(_|$)|password|passwd|token|secret");

    static boolean secretColumn(String column) {
        return column != null && SECRET_COLUMN.matcher(column.toLowerCase(Locale.ROOT)).find();
    }

    /** 컬럼을 아는 값. 비밀 컬럼이면 가린다. */
    static Object columnValue(String column, Object raw) {
        Object v = canonical(raw);
        if (v != null && secretColumn(column)) {
            return MASK;
        }
        return v;
    }

    /** 컬럼을 모르는 바인드. 설정 mask.unknownBinds 를 따른다. */
    static Object unknownBind(Object raw) {
        Object v = canonical(raw);
        String mode = WriteReportConfig.get().unknownBinds;
        if (v == null || mode.equals("show")) {
            return v;
        }
        if (mode.equals("hide")) {
            return MASK;
        }
        if (v instanceof String s) {
            return "<text:" + s.length() + ">";
        }
        if (v instanceof Number) {
            return "<number>";
        }
        if (v instanceof Time || v instanceof LocalDate) {
            return "<time>";
        }
        return v;
    }

    /** JDBC · jOOQ 값을 표준 모양으로. */
    static Object canonical(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof String || v instanceof Boolean || v instanceof Long || v instanceof BigInteger
                || v instanceof Sql || v instanceof Bytes || v instanceof Time || v instanceof LocalDate) {
            return v;
        }
        if (v instanceof Integer || v instanceof Short || v instanceof Byte) {
            return ((Number) v).longValue();
        }
        if (v instanceof BigDecimal d) {
            return d;
        }
        if (v instanceof Double || v instanceof Float) {
            return ((Number) v).doubleValue();
        }
        if (v instanceof Character || v instanceof java.util.UUID) {
            return v.toString();
        }
        if (v instanceof java.sql.Date d) {
            return d.toLocalDate();
        }
        if (v instanceof java.sql.Timestamp t) {
            return new Time(t.toLocalDateTime().toString());
        }
        if (v instanceof java.sql.Time t) {
            return new Time(t.toLocalTime().toString());
        }
        if (v instanceof java.util.Date d) {
            return new Time(d.toInstant().toString());
        }
        if (v instanceof LocalDateTime || v instanceof OffsetDateTime || v instanceof ZonedDateTime
                || v instanceof java.time.Instant || v instanceof LocalTime || v instanceof OffsetTime) {
            return new Time(v.toString());
        }
        if (v instanceof Temporal) {
            return new Time(v.toString());
        }
        if (v instanceof byte[] b) {
            return new Bytes(b.length);
        }
        if (v instanceof Enum<?> e) {
            return literalOf(e);
        }
        if (v instanceof java.sql.Array a) {
            try {
                return canonical(a.getArray());
            } catch (SQLException e) {
                return v.toString();
            }
        }
        if (v.getClass().isArray()) {
            List<Object> out = new ArrayList<>();
            for (int i = 0; i < Array.getLength(v); i++) {
                out.add(canonical(Array.get(v, i)));
            }
            return out;
        }
        if (v instanceof Collection<?> c) {
            List<Object> out = new ArrayList<>();
            for (Object o : c) {
                out.add(canonical(o));
            }
            return out;
        }
        if (v instanceof Number n) {
            return new BigDecimal(n.toString());
        }
        // org.postgresql.util.PGobject (json · jsonb · interval 등) 과 jOOQ JSON · JSONB 는 문자열 값으로
        String cn = v.getClass().getName();
        if (cn.endsWith("PGobject") || cn.startsWith("org.postgresql.util.PG")) {
            Object s = call(v, "getValue");
            return s == null ? null : s.toString();
        }
        if (cn.equals("org.jooq.JSON") || cn.equals("org.jooq.JSONB") || cn.equals("org.jooq.XML")) {
            Object s = call(v, "data");
            return s == null ? null : s.toString();
        }
        return v.toString();
    }

    private static Object literalOf(Enum<?> e) {
        // jOOQ EnumType 은 DB 값이 getLiteral() 이다
        Object lit = call(e, "getLiteral");
        return lit != null ? lit.toString() : e.name();
    }

    private static Object call(Object target, String method) {
        try {
            Method m = target.getClass().getMethod(method);
            return m.invoke(target);
        } catch (ReflectiveOperationException | RuntimeException ex) {
            return null;
        }
    }

    /** YAML · JSON 에 쓰는 순서대로 키와 값을 모은다. withSeqTable=false 면 승인본 모양 (seq · table 없음). */
    Map<String, Object> fields(boolean withSeqTable) {
        Map<String, Object> m = new LinkedHashMap<>();
        if (withSeqTable) {
            m.put("seq", (long) seq);
        }
        m.put("op", new Plain(op));
        if (withSeqTable && table != null) {
            m.put("table", new Plain(table));
        }
        if (rows != null && !rows.isEmpty()) {
            m.put("rows", new ArrayList<Object>(rows));
        }
        if (set != null && !set.isEmpty()) {
            m.put("set", set);
        }
        if (sameAsInsert != null && !sameAsInsert.isEmpty()) {
            m.put("sameAsInsert", plainList(sameAsInsert));
        }
        if (conflict != null && !conflict.isEmpty()) {
            m.put("conflict", plainList(conflict));
        }
        if (where != null && !where.isEmpty()) {
            m.put("where", where);
        }
        if (whereSql != null) {
            m.put("whereSql", whereSql);
        }
        if (sql != null) {
            m.put("sql", sql);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        if (errorState != null) {
            result.put("error", errorState);
            result.put("message", errorMessage == null ? "" : errorMessage);
        } else if (resultRows != null) {
            result.put("rows", resultRows);
        }
        if (!result.isEmpty()) {
            m.put("result", result);
        }
        if (rolledBack) {
            m.put("rolledBack", Boolean.TRUE);
        }
        return m;
    }

    /** 따옴표 없이 쓰는 이름 (op · table · 컬럼 목록). */
    record Plain(String text) {}

    private static List<Object> plainList(List<String> names) {
        List<Object> out = new ArrayList<>();
        for (String n : names) {
            out.add(new Plain(n));
        }
        return out;
    }

    /** 오류를 SQLState 와 정리한 메시지로 기록한다. */
    void error(SQLException e) {
        SQLException s = e;
        while (s != null && s.getSQLState() == null && s.getNextException() != null) {
            s = s.getNextException();
        }
        Throwable c = e;
        String state = s == null ? null : s.getSQLState();
        while (state == null && c.getCause() != null) {
            c = c.getCause();
            if (c instanceof SQLException se) {
                state = se.getSQLState();
                s = se;
            }
        }
        this.errorState = state == null ? "unknown" : state;
        this.errorMessage = cleanMessage((s == null ? e : s).getMessage());
    }

    private static final Pattern SEVERITY = Pattern.compile("^(ERROR|FATAL|PANIC|오류|치명적오류|심각):\\s*");
    private static final Pattern DETAIL = Pattern.compile("(?s)\\s*(Detail:|세부 정보:|상세 정보:|Hint:|힌트:|Position:|위치:|Where:|작업 위치:).*$");

    /** 로케일 번역 줄(Detail: · 세부 정보: 등)과 심각도 머리를 지운다. */
    static String cleanMessage(String msg) {
        if (msg == null) {
            return "";
        }
        String m = msg;
        int nl = m.indexOf('\n');
        if (nl >= 0) {
            m = m.substring(0, nl);
        }
        m = DETAIL.matcher(m).replaceFirst("");
        m = SEVERITY.matcher(m.trim()).replaceFirst("");
        return m.trim();
    }
}
