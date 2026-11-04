package __BASE_PACKAGE__.writereport;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 의존성 없는 간단한 SQL 문장 파서. 아래 모양만 행 · SET · WHERE 로 푼다:
 * INSERT INTO t (c, ...) VALUES (...)[, (...)] [ON CONFLICT (..) DO UPDATE SET c = EXCLUDED.c | DO NOTHING]
 * [ON DUPLICATE KEY UPDATE c = VALUES(c)] · UPDATE t SET c = ?, ... WHERE a = ? AND b IN (?, ?) · DELETE FROM t WHERE ...
 * 못 푸는 문장은 op 와 테이블(찾으면)과 값을 ? 로 바꾼 sql 로 남긴다. 인라인 리터럴도 ? 로 바꾼다.
 */
final class WriteReportSql {

    private WriteReportSql() {
    }

    // ---------- 토큰 ----------

    enum Kind { WORD, QIDENT, STRING, NUMBER, PARAM, PUNCT, OP }

    record Token(Kind kind, String text, String value, int param) {
        boolean is(String word) {
            return kind == Kind.WORD && text.equalsIgnoreCase(word);
        }

        boolean punct(char c) {
            return kind == Kind.PUNCT && text.length() == 1 && text.charAt(0) == c;
        }

        boolean ident() {
            return kind == Kind.WORD || kind == Kind.QIDENT;
        }

        /** 식별자 이름: 따옴표 없는 것은 소문자, 따옴표 식별자는 원래 대소문자. */
        String name() {
            return kind == Kind.QIDENT ? value : text.toLowerCase(Locale.ROOT);
        }
    }

    static List<Token> tokenize(String sql) {
        List<Token> out = new ArrayList<>();
        int n = sql.length();
        int i = 0;
        int param = 0;
        while (i < n) {
            char c = sql.charAt(i);
            if (Character.isWhitespace(c)) {
                i++;
            } else if (c == '-' && i + 1 < n && sql.charAt(i + 1) == '-') {
                while (i < n && sql.charAt(i) != '\n') {
                    i++;
                }
            } else if (c == '/' && i + 1 < n && sql.charAt(i + 1) == '*') {
                int end = sql.indexOf("*/", i + 2);
                i = end < 0 ? n : end + 2;
            } else if (c == '\'' || ((c == 'E' || c == 'e' || c == 'N' || c == 'n' || c == 'X' || c == 'x' || c == 'B' || c == 'b')
                    && i + 1 < n && sql.charAt(i + 1) == '\'' && (i == 0 || !wordChar(sql.charAt(i - 1))))) {
                int st = i;
                if (c != '\'') {
                    i++;
                }
                boolean escapes = c == 'E' || c == 'e';
                StringBuilder v = new StringBuilder();
                i++;
                while (i < n) {
                    char d = sql.charAt(i);
                    if (escapes && d == '\\' && i + 1 < n) {
                        v.append(sql.charAt(i + 1));
                        i += 2;
                    } else if (d == '\'') {
                        if (i + 1 < n && sql.charAt(i + 1) == '\'') {
                            v.append('\'');
                            i += 2;
                        } else {
                            i++;
                            break;
                        }
                    } else {
                        v.append(d);
                        i++;
                    }
                }
                out.add(new Token(Kind.STRING, sql.substring(st, i), v.toString(), 0));
            } else if (c == '$' && dollarTag(sql, i) != null) {
                String tag = dollarTag(sql, i);
                int end = sql.indexOf(tag, i + tag.length());
                int stop = end < 0 ? n : end + tag.length();
                String body = end < 0 ? sql.substring(i + tag.length()) : sql.substring(i + tag.length(), end);
                out.add(new Token(Kind.STRING, sql.substring(i, stop), body, 0));
                i = stop;
            } else if (c == '"' || c == '`' || c == '[') {
                char close = c == '[' ? ']' : c;
                int st = i;
                StringBuilder v = new StringBuilder();
                i++;
                while (i < n) {
                    char d = sql.charAt(i);
                    if (d == close) {
                        if (i + 1 < n && sql.charAt(i + 1) == close && close != ']') {
                            v.append(close);
                            i += 2;
                        } else {
                            i++;
                            break;
                        }
                    } else {
                        v.append(d);
                        i++;
                    }
                }
                out.add(new Token(Kind.QIDENT, sql.substring(st, i), v.toString(), 0));
            } else if (Character.isLetter(c) || c == '_') {
                int st = i;
                while (i < n && wordChar(sql.charAt(i))) {
                    i++;
                }
                out.add(new Token(Kind.WORD, sql.substring(st, i), null, 0));
            } else if (Character.isDigit(c) || (c == '.' && i + 1 < n && Character.isDigit(sql.charAt(i + 1)))) {
                int st = i;
                while (i < n && (Character.isDigit(sql.charAt(i)) || sql.charAt(i) == '.')) {
                    i++;
                }
                if (i < n && (sql.charAt(i) == 'e' || sql.charAt(i) == 'E')) {
                    int save = i;
                    i++;
                    if (i < n && (sql.charAt(i) == '+' || sql.charAt(i) == '-')) {
                        i++;
                    }
                    if (i < n && Character.isDigit(sql.charAt(i))) {
                        while (i < n && Character.isDigit(sql.charAt(i))) {
                            i++;
                        }
                    } else {
                        i = save;
                    }
                }
                String t = sql.substring(st, i);
                out.add(new Token(Kind.NUMBER, t, t, 0));
            } else if (c == '?') {
                if (i + 1 < n && sql.charAt(i + 1) == '?') {
                    out.add(new Token(Kind.OP, "??", null, 0));
                    i += 2;
                } else {
                    out.add(new Token(Kind.PARAM, "?", null, ++param));
                    i++;
                }
            } else if ("(),;.".indexOf(c) >= 0) {
                out.add(new Token(Kind.PUNCT, String.valueOf(c), null, 0));
                i++;
            } else {
                String op = String.valueOf(c);
                for (String m : MULTI_OPS) {
                    if (sql.startsWith(m, i)) {
                        op = m;
                        break;
                    }
                }
                out.add(new Token(Kind.OP, op, null, 0));
                i += op.length();
            }
        }
        return out;
    }

    private static final List<String> MULTI_OPS = List.of("->>", "#>>", "<>", "<=", ">=", "!=", "::", "||", "->", "#>", "@>", "<@", "&&");

    private static boolean wordChar(char c) {
        return Character.isLetterOrDigit(c) || c == '_' || c == '$';
    }

    private static String dollarTag(String sql, int i) {
        int j = i + 1;
        while (j < sql.length() && (Character.isLetterOrDigit(sql.charAt(j)) || sql.charAt(j) == '_')) {
            j++;
        }
        if (j < sql.length() && sql.charAt(j) == '$') {
            String tag = sql.substring(i, j + 1);
            if (tag.length() > 2 && Character.isDigit(tag.charAt(1))) {
                return null; // $1 같은 위치 바인드
            }
            return tag;
        }
        return null;
    }

    /** 토큰을 다시 SQL 로. 바인드 · 문자열 · 숫자 리터럴은 ? 로 쓴다. */
    static String masked(List<Token> tokens) {
        StringBuilder sb = new StringBuilder();
        Token prev = null;
        for (Token t : tokens) {
            String text = switch (t.kind()) {
                case PARAM, STRING, NUMBER -> "?";
                default -> t.text();
            };
            if (prev != null && space(prev, t)) {
                sb.append(' ');
            }
            sb.append(text);
            prev = t;
        }
        return sb.toString();
    }

    private static boolean space(Token prev, Token t) {
        if (t.punct(',') || t.punct(')') || t.punct('.') || t.punct(';') || prev.punct('(') || prev.punct('.')) {
            return false;
        }
        if (t.kind() == Kind.OP && t.text().equals("::") || prev.kind() == Kind.OP && prev.text().equals("::")) {
            return false;
        }
        if (t.punct('(') && prev.kind() == Kind.WORD && !KEYWORDS_BEFORE_PAREN.contains(prev.text().toLowerCase(Locale.ROOT))) {
            return false; // 함수 호출 now() · coalesce(...)
        }
        return true;
    }

    private static final Set<String> KEYWORDS_BEFORE_PAREN = Set.of(
            "values", "in", "and", "or", "not", "on", "conflict", "set", "where", "exists", "as", "from", "using", "select", "into", "when", "then");

    static String masked(String sql) {
        return masked(tokenize(sql));
    }

    // ---------- 문장 틀 ----------

    /** 값 자리: 바인드 · 리터럴 · 식. */
    record Val(int bind, boolean literal, Object value, String expr) {
        static Val bindAt(int i) {
            return new Val(i, false, null, null);
        }

        static Val lit(Object v) {
            return new Val(0, true, v, null);
        }

        static Val sql(String text) {
            return new Val(0, false, null, text);
        }

        boolean simple() {
            return expr == null;
        }
    }

    /** 한 번 풀어 둔 문장 틀. 바인드 값을 넣어 쓰기 한 건을 만든다. */
    static final class Template {
        String op;
        String schema;
        String table;
        List<String> columns;
        boolean noColumnList;
        List<List<Val>> rows;
        Map<String, Val> set;
        List<String> sameAsInsert;
        List<String> conflict;
        Map<String, Object> where; // Val 또는 List<Val>
        String whereSql;
        String sql;

        WriteReportWrite instantiate(Object[] binds, String currentSchema) {
            WriteReportWrite w = new WriteReportWrite();
            w.op = op;
            String s = schema != null ? schema : currentSchema;
            w.table = table == null ? null : (s == null ? table : s + "." + table);
            if (rows != null) {
                w.rows = new ArrayList<>();
                for (List<Val> r : rows) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    for (int i = 0; i < r.size(); i++) {
                        if (noColumnList || columns == null || i >= columns.size()) {
                            m.put("$" + (i + 1), unknown(r.get(i), binds));
                        } else {
                            m.put(columns.get(i), value(columns.get(i), r.get(i), binds));
                        }
                    }
                    w.rows.add(m);
                }
            }
            if (set != null) {
                w.set = new LinkedHashMap<>();
                for (Map.Entry<String, Val> e : set.entrySet()) {
                    w.set.put(e.getKey(), value(e.getKey(), e.getValue(), binds));
                }
            }
            w.sameAsInsert = sameAsInsert;
            w.conflict = conflict;
            if (where != null) {
                w.where = new LinkedHashMap<>();
                for (Map.Entry<String, Object> e : where.entrySet()) {
                    if (e.getValue() instanceof List<?> l) {
                        List<Object> vs = new ArrayList<>();
                        for (Object o : l) {
                            vs.add(value(e.getKey(), (Val) o, binds));
                        }
                        w.where.put(e.getKey(), vs);
                    } else {
                        w.where.put(e.getKey(), value(e.getKey(), (Val) e.getValue(), binds));
                    }
                }
            }
            w.whereSql = whereSql;
            w.sql = sql;
            return w;
        }

        private static Object raw(Val v, Object[] binds) {
            if (v.literal()) {
                return v.value();
            }
            return binds != null && v.bind() < binds.length ? binds[v.bind()] : null;
        }

        private static Object value(String column, Val v, Object[] binds) {
            if (!v.simple()) {
                return new WriteReportWrite.Sql(v.expr());
            }
            return WriteReportWrite.columnValue(column, raw(v, binds));
        }

        private static Object unknown(Val v, Object[] binds) {
            if (!v.simple()) {
                return new WriteReportWrite.Sql(v.expr());
            }
            return WriteReportWrite.unknownBind(raw(v, binds));
        }

        /** 이 틀이 스키마 없는 테이블을 쓰는지 (연결의 현재 스키마가 필요한지). */
        boolean needsSchema() {
            return table != null && schema == null;
        }
    }

    private static final Map<String, Template> CACHE = new LinkedHashMap<>(256, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Template> eldest) {
            return size() > 2000;
        }
    };

    private static final Template NOT_WRITE = new Template();

    /** 쓰기 문장이면 틀, 아니면 null. 같은 SQL 은 한 번만 푼다. */
    static Template template(String sql) {
        if (sql == null) {
            return null;
        }
        synchronized (CACHE) {
            Template t = CACHE.get(sql);
            if (t != null) {
                return t == NOT_WRITE ? null : t;
            }
        }
        Template t = parse(sql);
        synchronized (CACHE) {
            CACHE.put(sql, t == null ? NOT_WRITE : t);
        }
        return t;
    }

    /** 첫 낱말만 보고 op · 테이블 · 가린 sql 을 낸다 (jOOQ plain SQL 용). 쓰기가 아니면 null. */
    static Template head(String sql) {
        List<Token> tk = tokenize(sql);
        String op = writeOp(tk);
        if (op == null) {
            return null;
        }
        Template t = new Template();
        t.op = op;
        t.sql = masked(tk);
        Cursor c = new Cursor(tk);
        try {
            tableAfterVerb(c, t);
        } catch (RuntimeException ignored) {
            // 테이블을 못 찾으면 sql 만 남긴다
        }
        return t;
    }

    /** 쓰기 문장의 op. INSERT · UPDATE · DELETE · MERGE 외 쓰기(WITH ... INSERT · TRUNCATE · CALL)는 SQL. */
    static String writeOp(List<Token> tk) {
        int i = 0;
        while (i < tk.size() && tk.get(i).punct('(')) {
            i++;
        }
        if (i >= tk.size()) {
            return null;
        }
        Token f = tk.get(i);
        if (f.is("insert") || f.is("upsert") || f.is("replace")) {
            return "INSERT";
        }
        if (f.is("update")) {
            return "UPDATE";
        }
        if (f.is("delete")) {
            return "DELETE";
        }
        if (f.is("merge")) {
            return "MERGE";
        }
        if (f.is("truncate") || f.is("call") || f.kind() == Kind.OP && f.text().startsWith("{")) {
            return "SQL";
        }
        if (f.is("with")) {
            for (Token t : tk) {
                if (t.is("insert") || t.is("update") || t.is("delete") || t.is("merge")) {
                    return "SQL";
                }
            }
        }
        return null;
    }

    static Template parse(String sql) {
        List<Token> tk = tokenize(sql);
        String op = writeOp(tk);
        if (op == null) {
            return null;
        }
        Template t = new Template();
        t.op = op;
        Cursor c = new Cursor(tk);
        try {
            switch (op) {
                case "INSERT" -> parseInsert(c, t);
                case "UPDATE" -> parseUpdate(c, t);
                case "DELETE" -> parseDelete(c, t);
                default -> {
                    if (op.equals("MERGE")) {
                        tableAfterVerb(c, t);
                    }
                    t.sql = masked(tk);
                }
            }
        } catch (RuntimeException e) {
            Template f = new Template();
            f.op = op;
            f.schema = t.schema;
            f.table = t.table;
            f.sql = masked(tk);
            return f;
        }
        return t;
    }

    private static final class Cursor {
        final List<Token> tk;
        int i;

        Cursor(List<Token> tk) {
            this.tk = tk;
        }

        boolean end() {
            return i >= tk.size() || tk.get(i).punct(';') && i == tk.size() - 1;
        }

        Token peek() {
            return i < tk.size() ? tk.get(i) : null;
        }

        Token next() {
            if (i >= tk.size()) {
                throw new IllegalStateException("문장이 끝났다");
            }
            return tk.get(i++);
        }

        boolean at(String word) {
            Token t = peek();
            return t != null && t.is(word);
        }

        boolean accept(String word) {
            if (at(word)) {
                i++;
                return true;
            }
            return false;
        }

        void expect(String word) {
            if (!accept(word)) {
                throw new IllegalStateException(word + " 가 와야 한다");
            }
        }

        boolean acceptPunct(char ch) {
            Token t = peek();
            if (t != null && t.punct(ch)) {
                i++;
                return true;
            }
            return false;
        }

        void expectPunct(char ch) {
            if (!acceptPunct(ch)) {
                throw new IllegalStateException(ch + " 가 와야 한다");
            }
        }

        /** 지금부터 끝(세미콜론 앞)까지. */
        List<Token> rest() {
            int stop = tk.size();
            if (stop > 0 && tk.get(stop - 1).punct(';')) {
                stop--;
            }
            List<Token> r = tk.subList(Math.min(i, stop), stop);
            i = tk.size();
            return r;
        }
    }

    private static void tableAfterVerb(Cursor c, Template t) {
        while (!c.end() && !c.peek().ident()) {
            c.next();
        }
        Token v = c.next(); // INSERT · UPDATE · DELETE · MERGE
        if (v.is("insert") || v.is("merge") || v.is("replace") || v.is("upsert")) {
            c.accept("ignore");
            c.expect("into");
        } else if (v.is("delete")) {
            c.accept("from");
        } else if (v.is("update")) {
            c.accept("only");
        } else if (v.is("truncate")) {
            c.accept("table");
        }
        name(c, t);
    }

    private static void name(Cursor c, Template t) {
        List<String> parts = new ArrayList<>();
        Token a = c.next();
        if (!a.ident()) {
            throw new IllegalStateException("테이블 이름이 아니다");
        }
        parts.add(a.name());
        while (c.acceptPunct('.')) {
            parts.add(c.next().name());
        }
        t.table = parts.get(parts.size() - 1);
        t.schema = parts.size() >= 2 ? parts.get(parts.size() - 2) : null;
    }

    private static void alias(Cursor c, Set<String> stop) {
        if (c.accept("as")) {
            c.next();
            return;
        }
        Token t = c.peek();
        if (t != null && t.ident() && !(t.kind() == Kind.WORD && stop.contains(t.text().toLowerCase(Locale.ROOT)))) {
            c.next();
        }
    }

    private static void parseInsert(Cursor c, Template t) {
        Token first = c.peek();
        boolean ignore = false;
        while (c.peek().punct('(')) {
            c.next();
        }
        c.next(); // insert
        if (c.accept("ignore")) {
            ignore = true;
        }
        c.expect("into");
        name(c, t);
        alias(c, Set.of("values", "select", "default", "with", "overriding"));
        if (c.peek() != null && c.peek().punct('(') && !(c.tk.size() > c.i + 1 && (c.tk.get(c.i + 1).is("select") || c.tk.get(c.i + 1).is("with")))) {
            c.next();
            t.columns = new ArrayList<>();
            do {
                t.columns.add(c.next().name());
            } while (c.acceptPunct(','));
            c.expectPunct(')');
        } else {
            t.noColumnList = true;
        }
        if (c.accept("overriding")) {
            c.next();
            c.expect("value");
        }
        if (c.accept("default")) {
            c.expect("values");
            t.rows = new ArrayList<>();
            t.rows.add(new ArrayList<>());
            t.noColumnList = false;
        } else if (c.accept("values") || c.accept("value")) {
            t.rows = new ArrayList<>();
            do {
                c.expectPunct('(');
                List<Val> row = new ArrayList<>();
                do {
                    row.add(classify(expr(c, Set.of())));
                } while (c.acceptPunct(','));
                c.expectPunct(')');
                t.rows.add(row);
            } while (c.acceptPunct(','));
            if (t.noColumnList && t.rows.stream().allMatch(List::isEmpty)) {
                t.noColumnList = false;
            }
        } else {
            // INSERT ... SELECT: 행으로 못 푼다
            t.sql = masked(c.tk);
            t.op = ignore ? "INSERT_IGNORE" : "INSERT";
            t.columns = null;
            return;
        }
        t.op = ignore ? "INSERT_IGNORE" : "INSERT";
        if (c.accept("on")) {
            if (c.accept("conflict")) {
                if (c.acceptPunct('(')) {
                    t.conflict = new ArrayList<>();
                    do {
                        t.conflict.add(c.next().name());
                    } while (c.acceptPunct(','));
                    c.expectPunct(')');
                    if (c.accept("where")) {
                        expr(c, Set.of("do"));
                    }
                } else if (c.accept("on")) {
                    c.expect("constraint");
                    c.next();
                }
                c.expect("do");
                if (c.accept("nothing")) {
                    t.op = "INSERT_IGNORE";
                } else {
                    c.expect("update");
                    c.expect("set");
                    t.op = "UPSERT";
                    assignments(c, t, true);
                    if (c.accept("where")) {
                        t.whereSql = masked(expr(c, Set.of("returning")));
                    }
                }
            } else {
                c.expect("duplicate");
                c.expect("key");
                c.expect("update");
                t.op = "UPSERT";
                assignments(c, t, true);
            }
        }
        if (c.accept("returning")) {
            c.rest();
        }
        if (!c.end()) {
            throw new IllegalStateException("남은 토큰");
        }
        if (first == null) {
            throw new IllegalStateException("빈 문장");
        }
    }

    private static void assignments(Cursor c, Template t, boolean upsert) {
        t.set = new LinkedHashMap<>();
        do {
            Token col = c.next();
            if (!col.ident()) {
                throw new IllegalStateException("SET 컬럼이 아니다");
            }
            String name = col.name();
            while (c.acceptPunct('.')) {
                name = c.next().name();
            }
            Token eq = c.next();
            if (!(eq.kind() == Kind.OP && eq.text().equals("="))) {
                throw new IllegalStateException("= 가 와야 한다");
            }
            List<Token> e = expr(c, Set.of("where", "from", "returning"));
            if (upsert && sameAsInsert(e, name)) {
                if (t.sameAsInsert == null) {
                    t.sameAsInsert = new ArrayList<>();
                }
                t.sameAsInsert.add(name);
            } else {
                t.set.put(name, classify(e));
            }
        } while (c.acceptPunct(','));
    }

    /** EXCLUDED.c (PostgreSQL) · VALUES(c) (MySQL) 이고 c 가 같은 컬럼인지. */
    private static boolean sameAsInsert(List<Token> e, String column) {
        if (e.size() == 3 && e.get(0).is("excluded") && e.get(1).punct('.') && e.get(2).ident()) {
            return e.get(2).name().equals(column);
        }
        if (e.size() == 4 && e.get(0).is("values") && e.get(1).punct('(') && e.get(2).ident() && e.get(3).punct(')')) {
            return e.get(2).name().equals(column);
        }
        return false;
    }

    private static void parseUpdate(Cursor c, Template t) {
        c.next(); // update
        c.accept("only");
        name(c, t);
        alias(c, Set.of("set"));
        c.expect("set");
        assignments(c, t, false);
        if (c.at("from")) {
            // UPDATE ... FROM: 값을 다른 테이블에서 가져온다. 행으로 못 푼다
            t.set = null;
            t.sql = masked(c.tk);
            c.rest();
            return;
        }
        if (c.accept("where")) {
            where(t, expr(c, Set.of("returning")));
        }
        if (c.accept("returning")) {
            c.rest();
        }
        if (!c.end()) {
            throw new IllegalStateException("남은 토큰");
        }
    }

    private static void parseDelete(Cursor c, Template t) {
        c.next(); // delete
        c.expect("from");
        c.accept("only");
        name(c, t);
        alias(c, Set.of("where", "using", "returning"));
        if (c.at("using")) {
            t.sql = masked(c.tk);
            c.rest();
            return;
        }
        if (c.accept("where")) {
            where(t, expr(c, Set.of("returning")));
        }
        if (c.accept("returning")) {
            c.rest();
        }
        if (!c.end()) {
            throw new IllegalStateException("남은 토큰");
        }
    }

    /** 깊이 0 에서 쉼표 · 닫는 괄호 · 멈춤 낱말 전까지의 토큰. */
    private static List<Token> expr(Cursor c, Set<String> stopWords) {
        int depth = 0;
        int st = c.i;
        while (c.i < c.tk.size()) {
            Token t = c.tk.get(c.i);
            if (t.punct('(')) {
                depth++;
            } else if (t.punct(')')) {
                if (depth == 0) {
                    break;
                }
                depth--;
            } else if (depth == 0 && (t.punct(',') || t.punct(';'))) {
                break;
            } else if (depth == 0 && t.kind() == Kind.WORD && stopWords.contains(t.text().toLowerCase(Locale.ROOT))) {
                break;
            }
            c.i++;
        }
        if (c.i == st) {
            throw new IllegalStateException("빈 식");
        }
        return c.tk.subList(st, c.i);
    }

    /** 값 하나: 바인드(형 변환 포함) · 리터럴이면 값, 그 밖은 식. */
    static Val classify(List<Token> e) {
        List<Token> core = stripCast(e);
        if (core.size() == 1) {
            Token t = core.get(0);
            switch (t.kind()) {
                case PARAM:
                    return Val.bindAt(t.param());
                case STRING:
                    return Val.lit(t.value());
                case NUMBER:
                    return Val.lit(number(t.text()));
                case WORD:
                    if (t.is("null")) {
                        return Val.lit(null);
                    }
                    if (t.is("true") || t.is("false")) {
                        return Val.lit(Boolean.valueOf(t.text().toLowerCase(Locale.ROOT)));
                    }
                    break;
                default:
                    break;
            }
        }
        if (core.size() == 2 && core.get(0).kind() == Kind.OP && core.get(0).text().equals("-") && core.get(1).kind() == Kind.NUMBER) {
            return Val.lit(number("-" + core.get(1).text()));
        }
        return Val.sql(masked(e));
    }

    /** ?::jsonb · CAST(? AS x) 의 안쪽. */
    private static List<Token> stripCast(List<Token> e) {
        if (e.size() >= 3 && e.get(1).kind() == Kind.OP && e.get(1).text().equals("::")) {
            boolean typeOnly = true;
            for (int i = 2; i < e.size(); i++) {
                Token t = e.get(i);
                if (!(t.ident() || t.punct('(') || t.punct(')') || t.kind() == Kind.NUMBER || t.punct(',') || t.punct('.')
                        || t.kind() == Kind.OP && t.text().equals("[]"))) {
                    typeOnly = false;
                }
            }
            if (typeOnly) {
                return e.subList(0, 1);
            }
        }
        if (e.size() >= 6 && e.get(0).is("cast") && e.get(1).punct('(') && e.get(3).is("as") && e.get(e.size() - 1).punct(')')) {
            return e.subList(2, 3);
        }
        return e;
    }

    private static Object number(String s) {
        try {
            if (s.matches("-?\\d+")) {
                return Long.parseLong(s);
            }
            return new BigDecimal(s);
        } catch (NumberFormatException ex) {
            return s;
        }
    }

    /** WHERE 를 AND 로 나눠 컬럼 = 값 · 컬럼 IN (값...) 은 where 로, 나머지는 whereSql 로. */
    private static void where(Template t, List<Token> cond) {
        cond = stripParens(cond);
        List<List<Token>> parts = new ArrayList<>();
        int depth = 0;
        int st = 0;
        boolean between = false;
        boolean or = false;
        for (int i = 0; i < cond.size(); i++) {
            Token k = cond.get(i);
            if (k.punct('(')) {
                depth++;
            } else if (k.punct(')')) {
                depth--;
            } else if (depth == 0 && k.is("between")) {
                between = true;
            } else if (depth == 0 && k.is("or")) {
                or = true;
            } else if (depth == 0 && k.is("and")) {
                if (between) {
                    between = false;
                } else {
                    parts.add(cond.subList(st, i));
                    st = i + 1;
                }
            }
        }
        parts.add(cond.subList(st, cond.size()));
        if (or) {
            t.whereSql = masked(cond);
            return;
        }
        Map<String, Object> where = new LinkedHashMap<>();
        List<String> rest = new ArrayList<>();
        for (List<Token> p : parts) {
            if (!simpleCondition(p, where)) {
                rest.add(masked(p));
            }
        }
        t.where = where.isEmpty() ? null : where;
        t.whereSql = rest.isEmpty() ? null : String.join(" AND ", rest);
    }

    private static List<Token> stripParens(List<Token> e) {
        while (e.size() >= 2 && e.get(0).punct('(') && e.get(e.size() - 1).punct(')')) {
            int depth = 0;
            boolean wraps = true;
            for (int i = 0; i < e.size() - 1; i++) {
                if (e.get(i).punct('(')) {
                    depth++;
                } else if (e.get(i).punct(')')) {
                    depth--;
                }
                if (depth == 0) {
                    wraps = false;
                    break;
                }
            }
            if (!wraps) {
                break;
            }
            e = e.subList(1, e.size() - 1);
        }
        return e;
    }

    /** 컬럼 참조(a.b.c 의 마지막 이름) 길이. 아니면 0. */
    private static int columnRef(List<Token> p, int from) {
        int i = from;
        if (i >= p.size() || !p.get(i).ident() || p.get(i).kind() == Kind.WORD && RESERVED.contains(p.get(i).text().toLowerCase(Locale.ROOT))) {
            return 0;
        }
        i++;
        while (i + 1 < p.size() && p.get(i).punct('.') && p.get(i + 1).ident()) {
            i += 2;
        }
        if (i < p.size() && p.get(i).punct('(')) {
            return 0; // 함수 호출
        }
        return i - from;
    }

    private static final Set<String> RESERVED = Set.of("null", "true", "false", "not", "exists", "case", "cast", "select", "current_timestamp", "current_date", "now");

    private static boolean simpleCondition(List<Token> p, Map<String, Object> where) {
        int n = columnRef(p, 0);
        if (n > 0 && n < p.size()) {
            String col = p.get(n - 1).name();
            Token op = p.get(n);
            if (op.kind() == Kind.OP && op.text().equals("=")) {
                Val v = classify(p.subList(n + 1, p.size()));
                if (v.simple() && !where.containsKey(col)) {
                    where.put(col, v);
                    return true;
                }
                return false;
            }
            if (op.is("in") && n + 1 < p.size() && p.get(n + 1).punct('(') && p.get(p.size() - 1).punct(')')) {
                List<Token> inner = p.subList(n + 2, p.size() - 1);
                List<Val> vals = new ArrayList<>();
                int st = 0;
                for (int i = 0; i <= inner.size(); i++) {
                    if (i == inner.size() || inner.get(i).punct(',')) {
                        if (i == st) {
                            return false;
                        }
                        Val v = classify(inner.subList(st, i));
                        if (!v.simple()) {
                            return false;
                        }
                        vals.add(v);
                        st = i + 1;
                    } else if (inner.get(i).punct('(')) {
                        return false;
                    }
                }
                if (where.containsKey(col)) {
                    return false;
                }
                where.put(col, vals);
                return true;
            }
            return false;
        }
        // 값 = 컬럼
        for (int i = 1; i < p.size() - 1; i++) {
            Token op = p.get(i);
            if (op.kind() == Kind.OP && op.text().equals("=")) {
                int m = columnRef(p, i + 1);
                if (m > 0 && i + 1 + m == p.size()) {
                    Val v = classify(p.subList(0, i));
                    String col = p.get(p.size() - 1).name();
                    if (v.simple() && !where.containsKey(col)) {
                        where.put(col, v);
                        return true;
                    }
                }
                return false;
            }
        }
        return false;
    }
}
