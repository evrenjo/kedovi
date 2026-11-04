package __BASE_PACKAGE__.writereport;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jooq.Condition;
import org.jooq.Configuration;
import org.jooq.DSLContext;
import org.jooq.ExecuteContext;
import org.jooq.ExecuteListener;
import org.jooq.ExecuteListenerProvider;
import org.jooq.ExecuteType;
import org.jooq.Field;
import org.jooq.FieldOrRow;
import org.jooq.FieldOrRowOrSelect;
import org.jooq.Param;
import org.jooq.Query;
import org.jooq.QueryPart;
import org.jooq.Row;
import org.jooq.Table;
import org.jooq.TableField;
import org.jooq.UniqueKey;
import org.jooq.conf.RenderQuotedNames;
import org.jooq.conf.RenderTable;
import org.jooq.conf.Settings;
import org.jooq.impl.DSL;
import org.jooq.impl.DefaultExecuteListenerProvider;
import org.jooq.impl.QOM;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.ContextConfigurationAttributes;
import org.springframework.test.context.ContextCustomizer;
import org.springframework.test.context.ContextCustomizerFactory;
import org.springframework.test.context.MergedContextConfiguration;

/**
 * jOOQ 판 등록기와 ExecuteListener.
 *
 * test 리소스 META-INF/spring.factories 의 org.springframework.test.context.ContextCustomizerFactory 키로 붙는다.
 * 모든 Spring 시험 문맥(@SpringBootTest · @JooqTest 슬라이스 포함)에 아래를 넣는다. 운영 코드 · 설정은 바꾸지 않는다.
 * - ExecuteListenerProvider 빈: Spring Boot jOOQ 자동설정(JooqAutoConfiguration)이 ObjectProvider 로 모아
 *   DefaultConfiguration 에 붙인다 (Boot 4.1.2 에서 확인). 직접 만든 Configuration · DSLContext 빈에는 후처리기가 붙인다.
 * - DataSource 후처리기 (트랜잭션 추적만, 문장 기록은 jOOQ 리스너가 한다): commit · rollback · savepoint 를 보고 롤백을 표시한다.
 *
 * 문장 해석은 jOOQ QOM(org.jooq.impl.QOM: Insert · InsertReturning · Update · Delete · Merge · Eq · And · InList)으로 한다.
 * QOM 은 @Experimental API 다. jOOQ 버전을 올릴 때 이 파일이 컴파일되고 쓰기 보고서 시험이 그대로인지 확인한다.
 * 시험한 버전: jOOQ 3.21.9 (Spring Boot 4.1.2, PostgreSQL 17). plain SQL 은 첫 낱말 정규식으로 op · 테이블만 본다.
 * dsl.batch(q1, q2) (BatchMode.MULTIPLE) 는 쿼리마다 QOM 으로, dsl.batch(q).bind(...) (BatchMode.SINGLE) 는
 * 준비된 문장을 감싸 행별 바인드를 모아 SQL 문장 파서로 푼다 (jOOQ 가 행별 바인드 값을 ExecuteContext 에 주지 않는다).
 */
public class WriteReportJooq implements ContextCustomizerFactory {

    @Override
    public ContextCustomizer createContextCustomizer(Class<?> testClass, List<ContextConfigurationAttributes> configAttributes) {
        return new Customizer();
    }

    static final class Customizer implements ContextCustomizer {
        @Override
        public void customizeContext(ConfigurableApplicationContext context, MergedContextConfiguration mergedConfig) {
            WriteReportRecorder.stack("jooq");
            ExecuteListenerProvider provider = new DefaultExecuteListenerProvider(new Listener(context));
            context.getBeanFactory().registerSingleton("writeReportExecuteListenerProvider", provider);
            context.getBeanFactory().addBeanPostProcessor(new WriteReportConnections.PostProcessor(context, false));
            context.getBeanFactory().addBeanPostProcessor(new ConfigurationPostProcessor(provider));
        }

        // 문맥 캐시 열쇠에 들어간다. 모든 시험에서 같아야 문맥 캐시가 쪼개지지 않는다
        @Override
        public boolean equals(Object o) {
            return o != null && o.getClass() == getClass();
        }

        @Override
        public int hashCode() {
            return Customizer.class.hashCode();
        }
    }

    /** 자동설정을 쓰지 않고 직접 만든 Configuration · DSLContext 빈에 리스너를 붙인다 (이미 있으면 그대로). */
    static final class ConfigurationPostProcessor implements BeanPostProcessor {
        private final ExecuteListenerProvider provider;

        ConfigurationPostProcessor(ExecuteListenerProvider provider) {
            this.provider = provider;
        }

        @Override
        public Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
            Configuration cfg = bean instanceof Configuration c ? c : bean instanceof DSLContext d ? d.configuration() : null;
            if (cfg != null) {
                ExecuteListenerProvider[] now = cfg.executeListenerProviders();
                if (!Arrays.asList(now).contains(provider)) {
                    ExecuteListenerProvider[] next = Arrays.copyOf(now, now.length + 1);
                    next[now.length] = provider;
                    cfg.set(next);
                }
            }
            return bean;
        }
    }

    // ---------- ExecuteListener ----------

    static final class Listener implements ExecuteListener {
        private static final String KEY = "writeReport.writes";
        private final Object context;

        Listener(Object context) {
            this.context = context;
        }

        @Override
        public void prepareEnd(ExecuteContext ctx) {
            if (ctx.batchMode() == ExecuteContext.BatchMode.SINGLE && ctx.statement() != null && WriteReportRecorder.active(context)) {
                WriteReportConnections.Handle h = WriteReportConnections.handleOf(ctx.connection());
                ctx.statement(WriteReportConnections.recordingStatement(ctx.statement(), ctx.connection(), h, context, ctx.sql()));
            }
        }

        @Override
        public void executeStart(ExecuteContext ctx) {
            if (!WriteReportRecorder.active(context) || ctx.batchMode() == ExecuteContext.BatchMode.SINGLE || ctx.type() == ExecuteType.DDL) {
                return;
            }
            try {
                WriteReportConnections.Handle h = WriteReportConnections.handleOf(ctx.connection());
                List<WriteReportWrite> ws = new ArrayList<>();
                if (ctx.batchMode() == ExecuteContext.BatchMode.MULTIPLE) {
                    for (Query q : ctx.batchQueries()) {
                        WriteReportWrite w = analyze(q, null, ctx, h);
                        if (w != null) {
                            ws.add(w);
                        }
                    }
                } else {
                    WriteReportWrite w = analyze(ctx.query(), ctx.sql(), ctx, h);
                    if (w != null) {
                        ws.add(w);
                    }
                }
                if (!ws.isEmpty()) {
                    ctx.data(KEY, new Object[] {ws, h});
                }
            } catch (RuntimeException e) {
                // 기록 실패가 시험을 깨지 않게 한다
                System.err.println("[write-report] jOOQ 문장을 풀지 못했다: " + e);
            }
        }

        @Override
        public void executeEnd(ExecuteContext ctx) {
            Object[] d = take(ctx);
            if (d == null) {
                return;
            }
            @SuppressWarnings("unchecked")
            List<WriteReportWrite> ws = (List<WriteReportWrite>) d[0];
            if (ctx.batchMode() == ExecuteContext.BatchMode.MULTIPLE) {
                WriteReportConnections.applyCounts(ws, ctx.batchRows());
            } else {
                ws.get(0).resultRows = WriteReportConnections.rowsResult(ws.get(0), ctx.rows());
            }
            WriteReportRecorder.recordBatch(context, (WriteReportConnections.Handle) d[1], ws);
        }

        @Override
        public void exception(ExecuteContext ctx) {
            Object[] d = take(ctx);
            if (d == null) {
                return;
            }
            @SuppressWarnings("unchecked")
            List<WriteReportWrite> ws = (List<WriteReportWrite>) d[0];
            SQLException se = ctx.sqlException();
            for (Throwable t = ctx.exception(); se == null && t != null; t = t.getCause()) {
                if (t instanceof SQLException s) {
                    se = s;
                }
            }
            for (WriteReportWrite w : ws) {
                if (se != null) {
                    w.error(se);
                } else {
                    w.errorState = "unknown";
                    w.errorMessage = ctx.exception() == null ? "" : WriteReportWrite.cleanMessage(ctx.exception().getMessage());
                }
            }
            WriteReportRecorder.recordBatch(context, (WriteReportConnections.Handle) d[1], ws);
        }

        private static Object[] take(ExecuteContext ctx) {
            Object d = ctx.data(KEY);
            if (d == null) {
                return null;
            }
            ctx.data(KEY, null);
            return (Object[]) d;
        }
    }

    // ---------- QOM 해석 ----------

    static WriteReportWrite analyze(Query q, String sql, ExecuteContext ctx, WriteReportConnections.Handle h) {
        if (q == null) {
            return plain(sql, h);
        }
        Query base = q;
        if (q instanceof QOM.InsertReturning<?> ir) {
            base = ir.$insert();
        } else if (q instanceof QOM.UpdateReturning<?> ur) {
            base = ur.$update();
        } else if (q instanceof QOM.DeleteReturning<?> dr) {
            base = dr.$delete();
        }
        Renderer r = new Renderer(ctx.configuration());
        if (base instanceof QOM.Insert<?> i) {
            return insert(i, r, h);
        }
        if (base instanceof QOM.Update<?> u) {
            return update(u, r, h);
        }
        if (base instanceof QOM.Delete<?> d) {
            return delete(d, r, h);
        }
        if (base instanceof QOM.Merge<?> m) {
            WriteReportWrite w = new WriteReportWrite();
            w.op = "MERGE";
            w.table = tableName(m.$into(), h);
            w.sql = r.statement(m);
            return w;
        }
        if (ctx.type() == ExecuteType.READ || ctx.type() == ExecuteType.DDL) {
            return null;
        }
        return plain(sql != null ? sql : r.statement(q), h);
    }

    private static WriteReportWrite plain(String sql, WriteReportConnections.Handle h) {
        if (sql == null) {
            return null;
        }
        WriteReportSql.Template t = WriteReportSql.head(sql);
        if (t == null) {
            return null;
        }
        return t.instantiate(null, t.needsSchema() && h != null ? h.currentSchema() : null);
    }

    private static WriteReportWrite insert(QOM.Insert<?> i, Renderer r, WriteReportConnections.Handle h) {
        WriteReportWrite w = new WriteReportWrite();
        Table<?> into = i.$into();
        w.table = tableName(into, h);
        w.op = i.$onDuplicateKeyIgnore() ? "INSERT_IGNORE" : i.$onDuplicateKeyUpdate() ? "UPSERT" : "INSERT";
        List<String> cols = new ArrayList<>();
        for (Field<?> f : i.$columns()) {
            cols.add(f.getName());
        }
        if (i.$select() != null) {
            w.sql = r.statement(i);
            return w;
        }
        w.rows = new ArrayList<>();
        if (i.$defaultValues()) {
            w.rows.add(new LinkedHashMap<>());
        }
        for (Row row : i.$values()) {
            Map<String, Object> m = new LinkedHashMap<>();
            Field<?>[] fs = row.fields();
            for (int k = 0; k < fs.length; k++) {
                String col = k < cols.size() ? cols.get(k) : "$" + (k + 1);
                m.put(col, k < cols.size() ? value(col, fs[k], r) : unknown(fs[k], r));
            }
            w.rows.add(m);
        }
        if (w.op.equals("UPSERT") || w.op.equals("INSERT_IGNORE")) {
            List<String> conflict = new ArrayList<>();
            for (Field<?> f : i.$onConflict()) {
                conflict.add(f.getName());
            }
            if (conflict.isEmpty()) {
                UniqueKey<?> pk = into.getPrimaryKey();
                if (pk != null) {
                    for (TableField<?, ?> f : pk.getFields()) {
                        conflict.add(f.getName());
                    }
                }
            }
            w.conflict = conflict.isEmpty() ? null : conflict;
        }
        if (w.op.equals("UPSERT")) {
            w.set = new LinkedHashMap<>();
            for (Map.Entry<? extends FieldOrRow, ? extends FieldOrRowOrSelect> e : i.$updateSet().entrySet()) {
                String col = e.getKey() instanceof Field<?> f ? f.getName() : r.text(e.getKey());
                Object v = e.getValue();
                if (v instanceof QOM.Excluded<?> ex && ex.$field().getName().equals(col)) {
                    if (w.sameAsInsert == null) {
                        w.sameAsInsert = new ArrayList<>();
                    }
                    w.sameAsInsert.add(col);
                } else if (v instanceof Field<?> f) {
                    w.set.put(col, value(col, f, r));
                } else {
                    w.set.put(col, new WriteReportWrite.Sql(r.text((QueryPart) v)));
                }
            }
            if (i.$updateWhere() != null) {
                w.whereSql = r.text(i.$updateWhere());
            }
        }
        return w;
    }

    private static WriteReportWrite update(QOM.Update<?> u, Renderer r, WriteReportConnections.Handle h) {
        WriteReportWrite w = new WriteReportWrite();
        w.op = "UPDATE";
        w.table = tableName(u.$table(), h);
        if (!u.$from().isEmpty()) {
            w.sql = r.statement(u);
            return w;
        }
        w.set = new LinkedHashMap<>();
        for (Map.Entry<? extends FieldOrRow, ? extends FieldOrRowOrSelect> e : u.$set().entrySet()) {
            if (!(e.getKey() instanceof Field<?> key)) {
                w.set = null;
                w.sql = r.statement(u);
                return w;
            }
            Object v = e.getValue();
            w.set.put(key.getName(), v instanceof Field<?> f ? value(key.getName(), f, r) : new WriteReportWrite.Sql(r.text((QueryPart) v)));
        }
        where(w, u.$where(), r);
        return w;
    }

    private static WriteReportWrite delete(QOM.Delete<?> d, Renderer r, WriteReportConnections.Handle h) {
        WriteReportWrite w = new WriteReportWrite();
        w.op = "DELETE";
        w.table = tableName(d.$from(), h);
        if (!d.$using().isEmpty()) {
            w.sql = r.statement(d);
            return w;
        }
        where(w, d.$where(), r);
        return w;
    }

    /** AND 로 이은 컬럼 = 값 · 컬럼 IN (값...) 은 where, 나머지는 whereSql. */
    private static void where(WriteReportWrite w, Condition c, Renderer r) {
        if (c == null || DSL.noCondition().equals(c) || c instanceof QOM.True) {
            return;
        }
        List<Condition> parts = new ArrayList<>();
        flatten(c, parts);
        Map<String, Object> where = new LinkedHashMap<>();
        List<Condition> rest = new ArrayList<>();
        for (Condition p : parts) {
            if (p instanceof QOM.Eq<?> eq) {
                Field<?> a = eq.$arg1();
                Field<?> b = eq.$arg2();
                if (!(a instanceof TableField) && b instanceof TableField) {
                    Field<?> t = a;
                    a = b;
                    b = t;
                }
                Object v = a instanceof TableField ? param(b) : NOT_PARAM;
                if (v != NOT_PARAM && !where.containsKey(a.getName())) {
                    where.put(a.getName(), WriteReportWrite.columnValue(a.getName(), v));
                    continue;
                }
            } else if (p instanceof QOM.InList<?> in && in.$field() instanceof TableField && !where.containsKey(in.$field().getName())) {
                List<Object> vs = new ArrayList<>();
                boolean ok = true;
                for (Field<?> f : in.$list()) {
                    Object v = param(f);
                    if (v == NOT_PARAM) {
                        ok = false;
                        break;
                    }
                    vs.add(WriteReportWrite.columnValue(in.$field().getName(), v));
                }
                if (ok) {
                    where.put(in.$field().getName(), vs);
                    continue;
                }
            }
            rest.add(p);
        }
        w.where = where.isEmpty() ? null : where;
        w.whereSql = rest.isEmpty() ? null : r.text(DSL.and(rest));
    }

    private static void flatten(Condition c, List<Condition> out) {
        if (c instanceof QOM.And and) {
            flatten(and.$arg1(), out);
            flatten(and.$arg2(), out);
        } else {
            out.add(c);
        }
    }

    private static final Object NOT_PARAM = new Object();

    /** 바인드 · 인라인 값이면 그 DB 값, 아니면 NOT_PARAM. 형 변환(cast · coerce) 안쪽도 본다. */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private static Object param(Field<?> f) {
        Field<?> x = f;
        while (x instanceof QOM.Cast<?> c) {
            x = c.$field();
        }
        while (x instanceof QOM.Coerce<?> c) {
            x = c.$field();
        }
        if (x instanceof Param<?> p) {
            Object v = p.getValue();
            try {
                // Converter 가 붙은 필드는 DB 쪽 값으로 (enum · 값 객체 등)
                org.jooq.Converter conv = p.getConverter();
                if (v != null && conv != null && conv.fromType() != conv.toType()) {
                    v = conv.to(v);
                }
            } catch (RuntimeException ignored) {
                // 바꾸지 못하면 원래 값
            }
            return v;
        }
        return NOT_PARAM;
    }

    private static Object value(String col, Field<?> f, Renderer r) {
        Object v = param(f);
        if (v == NOT_PARAM) {
            return new WriteReportWrite.Sql(r.text(f));
        }
        return WriteReportWrite.columnValue(col, v);
    }

    private static Object unknown(Field<?> f, Renderer r) {
        Object v = param(f);
        if (v == NOT_PARAM) {
            return new WriteReportWrite.Sql(r.text(f));
        }
        return WriteReportWrite.unknownBind(v);
    }

    private static String tableName(Table<?> t, WriteReportConnections.Handle h) {
        Table<?> x = t;
        while (x instanceof QOM.TableAlias<?> a) {
            x = a.$table();
        }
        String[] parts = x.getQualifiedName().getName();
        String table = parts[parts.length - 1];
        String schema = parts.length >= 2 ? parts[parts.length - 2] : (h != null ? h.currentSchema() : null);
        return schema == null || schema.isEmpty() ? table : schema + "." + table;
    }

    /** SQL 로 남기는 경로: 이름 따옴표 · 스키마 없이 렌더하고 바인드 · 인라인 리터럴을 ? 로 가린다. */
    static final class Renderer {
        private final Configuration base;
        private DSLContext dsl;

        Renderer(Configuration base) {
            this.base = base;
        }

        private DSLContext dsl() {
            if (dsl == null) {
                Settings s = base.settings() == null ? new Settings() : (Settings) base.settings().clone();
                s.withRenderQuotedNames(RenderQuotedNames.EXPLICIT_DEFAULT_UNQUOTED)
                        .withRenderSchema(false)
                        .withRenderCatalog(false)
                        .withRenderTable(RenderTable.WHEN_MULTIPLE_TABLES)
                        .withRenderFormatted(false);
                dsl = base.derive(s).dsl();
            }
            return dsl;
        }

        String text(QueryPart part) {
            return WriteReportSql.masked(dsl().render(part));
        }

        String statement(QueryPart q) {
            return WriteReportSql.masked(dsl().render(q));
        }
    }
}
