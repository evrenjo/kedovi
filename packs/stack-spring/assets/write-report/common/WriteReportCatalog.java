package __BASE_PACKAGE__.writereport;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import javax.sql.DataSource;

/**
 * 테이블 · 컬럼 정보 (index.json 의 catalog). 문장마다 묻지 않고, 시험 구간이 끝날 때 아직 모르는 테이블이 있으면
 * 그 DataSource 에서 새 연결로 한 번에 읽는다 (종료 훅 때는 Testcontainers 가 이미 내려갔을 수 있다).
 */
final class WriteReportCatalog {

    record Column(String name, String type, boolean nullable, String defaultValue, boolean generated) {}

    record Table(List<Column> columns, List<String> primaryKey) {
        Column column(String name) {
            for (Column c : columns) {
                if (c.name().equals(name)) {
                    return c;
                }
            }
            return null;
        }

        /** 기본 키 하나짜리 숫자 컬럼이고 DB 가 값을 만드는지 (identity · serial · nextval 기본값). */
        String generatedId() {
            if (primaryKey.size() != 1) {
                return null;
            }
            Column c = column(primaryKey.get(0));
            if (c == null) {
                return null;
            }
            String t = c.type().toLowerCase(Locale.ROOT);
            boolean numeric = t.contains("int") || t.startsWith("numeric") || t.startsWith("decimal") || t.contains("serial") || t.equals("number");
            String d = c.defaultValue() == null ? "" : c.defaultValue().toLowerCase(Locale.ROOT);
            boolean dbMade = c.generated() || d.startsWith("nextval(") || d.contains("auto_increment") || d.contains("identity");
            return numeric && dbMade ? c.name() : null;
        }
    }

    /** 스키마 → 테이블 → 정보. */
    private final Map<String, Map<String, Table>> schemas = new TreeMap<>();

    synchronized Table find(String qualifiedTable) {
        if (qualifiedTable == null) {
            return null;
        }
        int dot = qualifiedTable.lastIndexOf('.');
        String table = dot < 0 ? qualifiedTable : qualifiedTable.substring(dot + 1);
        if (dot >= 0) {
            Map<String, Table> s = schemas.get(qualifiedTable.substring(0, dot));
            return s == null ? null : s.get(table);
        }
        for (Map<String, Table> s : schemas.values()) {
            if (s.containsKey(table)) {
                return s.get(table);
            }
        }
        return null;
    }

    synchronized boolean knowsAll(Set<String> tables) {
        for (String t : tables) {
            if (find(t) == null) {
                return false;
            }
        }
        return true;
    }

    /** index.json 모양 (schema → table → {columns, primaryKey}). */
    synchronized Map<String, Object> toJson() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, Table>> s : schemas.entrySet()) {
            Map<String, Object> ts = new LinkedHashMap<>();
            for (Map.Entry<String, Table> t : s.getValue().entrySet()) {
                List<Object> cols = new ArrayList<>();
                for (Column c : t.getValue().columns()) {
                    Map<String, Object> cm = new LinkedHashMap<>();
                    cm.put("name", c.name());
                    cm.put("type", c.type());
                    cm.put("nullable", c.nullable());
                    cm.put("default", c.defaultValue());
                    cm.put("generated", c.generated());
                    cols.add(cm);
                }
                Map<String, Object> tm = new LinkedHashMap<>();
                tm.put("columns", cols);
                tm.put("primaryKey", new ArrayList<Object>(t.getValue().primaryKey()));
                ts.put(t.getKey(), tm);
            }
            out.put(s.getKey(), ts);
        }
        return out;
    }

    /** DataSource 에서 새 연결로 읽어 합친다. 실패하면 경고만 하고 넘어간다 (보고서는 catalog 없이도 쓴다). */
    void read(DataSource ds) {
        try (Connection c = ds.getConnection()) {
            String product = c.getMetaData().getDatabaseProductName();
            Map<String, Map<String, Table>> found = product != null && product.toLowerCase(Locale.ROOT).contains("postgres")
                    ? readPostgres(c) : readInformationSchema(c);
            synchronized (this) {
                for (Map.Entry<String, Map<String, Table>> e : found.entrySet()) {
                    schemas.computeIfAbsent(e.getKey(), k -> new TreeMap<>()).putAll(e.getValue());
                }
            }
        } catch (SQLException | RuntimeException e) {
            System.err.println("[write-report] catalog 을 읽지 못했다: " + e.getMessage());
        }
    }

    private static final String PG_COLUMNS = """
            select n.nspname, c.relname, a.attname, format_type(a.atttypid, a.atttypmod), not a.attnotnull,
                   pg_get_expr(d.adbin, d.adrelid), (a.attidentity <> '' or a.attgenerated <> '')
              from pg_catalog.pg_class c
              join pg_catalog.pg_namespace n on n.oid = c.relnamespace
              join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
              left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
             where c.relkind in ('r', 'p') and not c.relispartition
               and n.nspname not in ('pg_catalog', 'information_schema')
               and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'
             order by n.nspname, c.relname, a.attnum
            """;

    private static final String PG_KEYS = """
            select n.nspname, c.relname, a.attname
              from pg_catalog.pg_index i
              join pg_catalog.pg_class c on c.oid = i.indrelid
              join pg_catalog.pg_namespace n on n.oid = c.relnamespace
              join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
              join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum
             where i.indisprimary and n.nspname not in ('pg_catalog', 'information_schema')
             order by n.nspname, c.relname, k.ord
            """;

    private static Map<String, Map<String, Table>> readPostgres(Connection c) throws SQLException {
        Map<String, Map<String, List<Column>>> cols = new TreeMap<>();
        Map<String, List<String>> keys = new LinkedHashMap<>();
        try (Statement st = c.createStatement()) {
            try (ResultSet rs = st.executeQuery(PG_COLUMNS)) {
                while (rs.next()) {
                    cols.computeIfAbsent(rs.getString(1), k -> new TreeMap<>())
                            .computeIfAbsent(rs.getString(2), k -> new ArrayList<>())
                            .add(new Column(rs.getString(3), rs.getString(4), rs.getBoolean(5), rs.getString(6), rs.getBoolean(7)));
                }
            }
            try (ResultSet rs = st.executeQuery(PG_KEYS)) {
                while (rs.next()) {
                    keys.computeIfAbsent(rs.getString(1) + "." + rs.getString(2), k -> new ArrayList<>()).add(rs.getString(3));
                }
            }
        }
        return assemble(cols, keys);
    }

    private static final String IS_COLUMNS = """
            select table_schema, table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale,
                   is_nullable, column_default
              from information_schema.columns
             where table_schema not in ('information_schema', 'pg_catalog', 'sys', 'mysql', 'performance_schema', 'INFORMATION_SCHEMA')
             order by table_schema, table_name, ordinal_position
            """;

    private static final String IS_KEYS = """
            select k.table_schema, k.table_name, k.column_name
              from information_schema.table_constraints t
              join information_schema.key_column_usage k
                on k.constraint_name = t.constraint_name and k.table_schema = t.table_schema and k.table_name = t.table_name
             where t.constraint_type = 'PRIMARY KEY'
             order by k.table_schema, k.table_name, k.ordinal_position
            """;

    private static Map<String, Map<String, Table>> readInformationSchema(Connection c) throws SQLException {
        Map<String, Map<String, List<Column>>> cols = new TreeMap<>();
        Map<String, List<String>> keys = new LinkedHashMap<>();
        try (Statement st = c.createStatement()) {
            try (ResultSet rs = st.executeQuery(IS_COLUMNS)) {
                while (rs.next()) {
                    String type = rs.getString(4);
                    String len = rs.getString(5);
                    String prec = rs.getString(6);
                    String scale = rs.getString(7);
                    String t = type == null ? "" : type.toLowerCase(Locale.ROOT);
                    if (len != null && (t.contains("char") || t.contains("binary"))) {
                        t += "(" + len + ")";
                    } else if (prec != null && (t.startsWith("numeric") || t.startsWith("decimal"))) {
                        t += "(" + prec + (scale == null ? "" : "," + scale) + ")";
                    }
                    String def = rs.getString(9);
                    boolean gen = def != null && (def.toLowerCase(Locale.ROOT).contains("identity") || def.toLowerCase(Locale.ROOT).contains("auto_increment"));
                    cols.computeIfAbsent(rs.getString(1).toLowerCase(Locale.ROOT), k -> new TreeMap<>())
                            .computeIfAbsent(rs.getString(2).toLowerCase(Locale.ROOT), k -> new ArrayList<>())
                            .add(new Column(rs.getString(3).toLowerCase(Locale.ROOT), t, "YES".equalsIgnoreCase(rs.getString(8)), def, gen));
                }
            }
            try (ResultSet rs = st.executeQuery(IS_KEYS)) {
                while (rs.next()) {
                    keys.computeIfAbsent(rs.getString(1).toLowerCase(Locale.ROOT) + "." + rs.getString(2).toLowerCase(Locale.ROOT),
                            k -> new ArrayList<>()).add(rs.getString(3).toLowerCase(Locale.ROOT));
                }
            } catch (SQLException e) {
                // 기본 키를 못 읽는 DB 는 비워 둔다
            }
        }
        return assemble(cols, keys);
    }

    private static Map<String, Map<String, Table>> assemble(Map<String, Map<String, List<Column>>> cols, Map<String, List<String>> keys) {
        Map<String, Map<String, Table>> out = new TreeMap<>();
        for (Map.Entry<String, Map<String, List<Column>>> s : cols.entrySet()) {
            Map<String, Table> ts = new TreeMap<>();
            for (Map.Entry<String, List<Column>> t : s.getValue().entrySet()) {
                ts.put(t.getKey(), new Table(t.getValue(), keys.getOrDefault(s.getKey() + "." + t.getKey(), List.of())));
            }
            out.put(s.getKey(), ts);
        }
        return out;
    }
}
