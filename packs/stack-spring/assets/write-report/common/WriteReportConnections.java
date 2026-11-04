package __BASE_PACKAGE__.writereport;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Proxy;
import java.sql.BatchUpdateException;
import java.sql.CallableStatement;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.sql.Savepoint;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.ApplicationContext;
import org.springframework.core.Ordered;
import org.springframework.util.ClassUtils;

/**
 * DataSource 빈을 감싼다: CGLIB 클래스 프록시(원래 형식 유지), final 클래스면 java.lang.reflect.Proxy (시험 classpath 에서만 붙는다. 운영 코드 변경 0).
 *
 * 두 가지 일을 한다.
 * 1. 트랜잭션 추적 (두 판 공통): 그 연결에서 commit · rollback · savepoint 를 보고, autocommit 이 꺼진 연결의 쓰기만
 *    트랜잭션 완료에 묶는다. autocommit 쓰기는 즉시 커밋으로 본다 (Spring Batch ResourcelessTransactionManager 아래 쓰기 포함).
 *    Spring 의 DataSourceTransactionManager · JpaTransactionManager 는 ConnectionHolder 에 이 프록시 연결을 들고
 *    commit · rollback · setSavepoint · rollback(savepoint) 를 부르므로 여기서 그대로 보인다.
 * 2. 문장 기록 (JDBC 판, recordStatements=true): PreparedStatement · Statement 를 감싸 setXxx 바인드를 모으고
 *    execute · addBatch · executeBatch 를 쓰기 보고서에 남긴다.
 */
final class WriteReportConnections {

    private WriteReportConnections() {
    }

    /** 감싼 연결 표시. unwrap(Tracked.class) 로 jOOQ · Spring 프록시 아래의 연결을 찾는다. */
    public interface Tracked {
        /** Handle 을 돌려준다 (프록시가 패키지 전용 형식을 볼 수 없어 Object). */
        Object writeReportHandle();
    }

    /** 연결 하나를 빌린 동안의 상태. */
    static final class Handle {
        final Object context;
        final DataSource rawDataSource;
        final Connection target;
        private Boolean autoCommit;
        private String schema;
        private boolean schemaLoaded;
        private final List<WriteReportWrite> pending = new ArrayList<>();
        private final List<Object[]> savepoints = new ArrayList<>();

        Handle(Object context, DataSource rawDataSource, Connection target) {
            this.context = context;
            this.rawDataSource = rawDataSource;
            this.target = target;
        }

        /** autocommit 이 꺼져 있어 트랜잭션 완료를 기다려야 하는지. */
        synchronized boolean inTransaction() {
            if (autoCommit == null) {
                try {
                    autoCommit = target.getAutoCommit();
                } catch (SQLException e) {
                    return false;
                }
            }
            return !autoCommit;
        }

        synchronized void addPending(WriteReportWrite w) {
            pending.add(w);
        }

        /** 연결의 현재 스키마 (테이블에 스키마가 없을 때). 연결을 빌린 동안 한 번만 묻는다. */
        synchronized String currentSchema() {
            if (!schemaLoaded) {
                schemaLoaded = true;
                try {
                    schema = target.getSchema();
                } catch (SQLException | RuntimeException | AbstractMethodError e) {
                    schema = null;
                }
            }
            return schema;
        }

        synchronized void schemaChanged() {
            schemaLoaded = false;
        }

        synchronized void autoCommitSet(boolean on) {
            if (on && Boolean.FALSE.equals(autoCommit)) {
                committed(); // JDBC: 트랜잭션 중 autocommit 을 켜면 커밋한다
            }
            autoCommit = on;
        }

        synchronized void committed() {
            pending.clear();
            savepoints.clear();
        }

        synchronized void rolledBack() {
            for (WriteReportWrite w : pending) {
                w.rolledBack = true;
            }
            pending.clear();
            savepoints.clear();
        }

        synchronized void savepointSet(Savepoint sp) {
            savepoints.add(new Object[] {sp, pending.size()});
        }

        synchronized void rolledBackTo(Savepoint sp) {
            for (int i = savepoints.size() - 1; i >= 0; i--) {
                if (savepoints.get(i)[0] == sp) {
                    int from = (Integer) savepoints.get(i)[1];
                    for (int j = from; j < pending.size(); j++) {
                        pending.get(j).rolledBack = true;
                    }
                    pending.subList(from, pending.size()).clear();
                    savepoints.subList(i + 1, savepoints.size()).clear();
                    return;
                }
            }
        }

        synchronized void released(Savepoint sp) {
            for (int i = savepoints.size() - 1; i >= 0; i--) {
                if (savepoints.get(i)[0] == sp) {
                    savepoints.subList(i, savepoints.size()).clear();
                    return;
                }
            }
        }

        /** 커밋하지 않고 닫은 연결: 풀(HikariCP 등)이 돌려받을 때 롤백한다. */
        synchronized void closed() {
            if (Boolean.FALSE.equals(autoCommit) && !pending.isEmpty()) {
                rolledBack();
            }
        }
    }

    /** jOOQ 등 다른 프록시 아래 연결에서 Handle 을 찾는다. 감싼 연결이 아니면 null. */
    static Handle handleOf(Connection c) {
        if (c == null) {
            return null;
        }
        try {
            if (c instanceof Tracked t) {
                return (Handle) t.writeReportHandle();
            }
            if (c.isWrapperFor(Tracked.class)) {
                return (Handle) c.unwrap(Tracked.class).writeReportHandle();
            }
        } catch (SQLException | RuntimeException e) {
            return null;
        }
        return null;
    }

    // ---------- DataSource ----------

    /** DataSource 빈을 감싸는 후처리기. 시험 문맥마다 하나 (ContextCustomizer 가 넣는다). */
    static final class PostProcessor implements BeanPostProcessor, Ordered {
        private final ApplicationContext context;
        private final boolean recordStatements;

        PostProcessor(ApplicationContext context, boolean recordStatements) {
            this.context = context;
            this.recordStatements = recordStatements;
        }

        @Override
        public Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
            if (bean instanceof DataSource ds && !isOurs(ds)) {
                return wrap(ds, context, recordStatements);
            }
            return bean;
        }

        @Override
        public int getOrder() {
            return Ordered.HIGHEST_PRECEDENCE;
        }
    }

    /** 감싼 DataSource 표시 (두 번 감싸지 않게). */
    public interface TrackedDataSource {
    }

    private static boolean isOurs(Object o) {
        return o instanceof TrackedDataSource;
    }

    /**
     * 원래 클래스 형식을 지키는 CGLIB 클래스 프록시가 먼저다 (HikariDataSource 형식으로 주입받는 코드도 그대로 돈다).
     * final 클래스라 하위 클래스를 못 만들면 인터페이스 프록시로 물러선다 (그때는 DataSource · 인터페이스 형식으로만 주입된다).
     */
    static DataSource wrap(DataSource target, Object context, boolean recordStatements) {
        DataSourceHandler handler = new DataSourceHandler(target, context, recordStatements);
        if (!java.lang.reflect.Modifier.isFinal(target.getClass().getModifiers())) {
            try {
                org.springframework.aop.framework.ProxyFactory pf = new org.springframework.aop.framework.ProxyFactory(target);
                pf.setProxyTargetClass(true);
                pf.addInterface(TrackedDataSource.class);
                pf.addAdvice((org.aopalliance.intercept.MethodInterceptor) inv -> {
                    Object r = inv.proceed();
                    if (inv.getMethod().getName().equals("getConnection") && r instanceof Connection c) {
                        return connection(c, handler);
                    }
                    return r;
                });
                ClassLoader cl = target.getClass().getClassLoader();
                return (DataSource) pf.getProxy(cl != null ? cl : WriteReportConnections.class.getClassLoader());
            } catch (RuntimeException | LinkageError e) {
                System.err.println("[write-report] " + target.getClass().getName() + " 를 클래스 프록시로 못 감싸 인터페이스 프록시로 감싼다: " + e);
            }
        }
        return interfaceProxy(target, handler);
    }

    private static DataSource interfaceProxy(DataSource target, DataSourceHandler handler) {
        Set<Class<?>> ifaces = new LinkedHashSet<>();
        ClassLoader cl = target.getClass().getClassLoader();
        if (cl == null) {
            cl = WriteReportConnections.class.getClassLoader();
        }
        for (Class<?> i : ClassUtils.getAllInterfacesForClassAsSet(target.getClass(), cl)) {
            if (Modifier.isPublic(i.getModifiers())) {
                ifaces.add(i);
            }
        }
        ifaces.add(DataSource.class);
        ifaces.add(TrackedDataSource.class);
        ClassLoader proxyLoader = WriteReportConnections.class.getClassLoader();
        return (DataSource) Proxy.newProxyInstance(proxyLoader, visible(ifaces, proxyLoader), handler);
    }

    private static Class<?>[] visible(Set<Class<?>> ifaces, ClassLoader loader) {
        List<Class<?>> out = new ArrayList<>();
        for (Class<?> i : ifaces) {
            if (ClassUtils.isVisible(i, loader)) {
                out.add(i);
            }
        }
        return out.toArray(new Class<?>[0]);
    }

    private static final class DataSourceHandler implements InvocationHandler {
        final DataSource target;
        final Object context;
        final boolean recordStatements;

        DataSourceHandler(DataSource target, Object context, boolean recordStatements) {
            this.target = target;
            this.context = context;
            this.recordStatements = recordStatements;
        }

        @Override
        public Object invoke(Object proxy, Method m, Object[] args) throws Throwable {
            switch (m.getName()) {
                case "equals":
                    return proxy == args[0];
                case "hashCode":
                    return System.identityHashCode(proxy);
                case "toString":
                    return "WriteReport(" + target + ")";
                default:
                    break;
            }
            Object r = invokeTarget(target, m, args);
            if (m.getName().equals("getConnection") && r instanceof Connection c) {
                return connection(c, this);
            }
            return r;
        }
    }

    private static Connection connection(Connection c, DataSourceHandler ds) throws SQLException {
        if (c instanceof Tracked || c.isWrapperFor(Tracked.class)) {
            return c; // 안쪽 DataSource 가 이미 감쌌다
        }
        Handle h = new Handle(ds.context, ds.target, c);
        return (Connection) Proxy.newProxyInstance(WriteReportConnections.class.getClassLoader(),
                new Class<?>[] {Connection.class, Tracked.class}, new ConnectionHandler(c, h, ds.recordStatements));
    }

    // ---------- Connection ----------

    private static final class ConnectionHandler implements InvocationHandler {
        final Connection target;
        final Handle handle;
        final boolean recordStatements;

        ConnectionHandler(Connection target, Handle handle, boolean recordStatements) {
            this.target = target;
            this.handle = handle;
            this.recordStatements = recordStatements;
        }

        @Override
        public Object invoke(Object proxy, Method m, Object[] args) throws Throwable {
            String name = m.getName();
            switch (name) {
                case "writeReportHandle":
                    return handle;
                case "equals":
                    return proxy == args[0];
                case "hashCode":
                    return System.identityHashCode(proxy);
                case "toString":
                    return "WriteReport(" + target + ")";
                case "unwrap":
                    if (args[0] == Tracked.class) {
                        return proxy;
                    }
                    break;
                case "isWrapperFor":
                    if (args[0] == Tracked.class) {
                        return true;
                    }
                    break;
                default:
                    break;
            }
            Object r = invokeTarget(target, m, args);
            switch (name) {
                case "setAutoCommit" -> handle.autoCommitSet((Boolean) args[0]);
                case "commit" -> handle.committed();
                case "rollback" -> {
                    if (args == null || args.length == 0) {
                        handle.rolledBack();
                    } else {
                        handle.rolledBackTo((Savepoint) args[0]);
                    }
                }
                case "setSavepoint" -> handle.savepointSet((Savepoint) r);
                case "releaseSavepoint" -> handle.released((Savepoint) args[0]);
                case "setSchema" -> handle.schemaChanged();
                case "close" -> handle.closed();
                case "prepareStatement", "prepareCall" -> {
                    String sql = (String) args[0];
                    if (startsWithSet(sql)) {
                        handle.schemaChanged();
                    }
                    if (recordStatements) {
                        WriteReportSql.Template t = WriteReportSql.template(sql);
                        if (t != null) {
                            Class<?> type = name.equals("prepareCall") ? CallableStatement.class : PreparedStatement.class;
                            return Proxy.newProxyInstance(WriteReportConnections.class.getClassLoader(), new Class<?>[] {type},
                                    new PreparedHandler((PreparedStatement) r, (Connection) proxy, handle, sql, t));
                        }
                    }
                }
                case "createStatement" -> {
                    if (recordStatements) {
                        return Proxy.newProxyInstance(WriteReportConnections.class.getClassLoader(), new Class<?>[] {Statement.class},
                                new StaticHandler((Statement) r, (Connection) proxy, handle));
                    }
                }
                default -> {
                }
            }
            return r;
        }
    }

    static boolean startsWithSet(String sql) {
        String s = sql == null ? "" : sql.stripLeading().toLowerCase(Locale.ROOT);
        return s.startsWith("set ") || s.startsWith("use ");
    }

    static Object invokeTarget(Object target, Method m, Object[] args) throws Throwable {
        try {
            return m.invoke(target, args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }

    // ---------- PreparedStatement ----------

    /** 바인드 모으기 · 기록. jOOQ 판도 BatchMode.SINGLE 배치에서 이걸로 행별 바인드를 모은다. */
    static final class PreparedHandler implements InvocationHandler {
        final PreparedStatement target;
        final Connection connection;
        final Handle handle;
        final String sql;
        final WriteReportSql.Template template;
        private Object[] binds = new Object[8];
        private final List<Object[]> batch = new ArrayList<>();

        PreparedHandler(PreparedStatement target, Connection connection, Handle handle, String sql, WriteReportSql.Template template) {
            this.target = target;
            this.connection = connection;
            this.handle = handle;
            this.sql = sql;
            this.template = template;
        }

        @Override
        public Object invoke(Object proxy, Method m, Object[] args) throws Throwable {
            String name = m.getName();
            if (name.startsWith("set") && args != null && args.length >= 2 && args[0] instanceof Integer idx
                    && m.getDeclaringClass() != Object.class && !name.equals("setFetchSize") && !name.equals("setMaxRows")
                    && !name.equals("setQueryTimeout") && !name.equals("setFetchDirection") && !name.equals("setMaxFieldSize")
                    && !name.equals("setLargeMaxRows")) {
                bind(idx, name, args[1]);
                return invokeTarget(target, m, args);
            }
            switch (name) {
                case "equals":
                    return proxy == args[0];
                case "hashCode":
                    return System.identityHashCode(proxy);
                case "getConnection":
                    return connection;
                case "clearParameters":
                    Arrays.fill(binds, null);
                    return invokeTarget(target, m, args);
                case "addBatch":
                    if (args == null || args.length == 0) {
                        batch.add(binds.clone());
                    }
                    return invokeTarget(target, m, args);
                case "clearBatch":
                    batch.clear();
                    return invokeTarget(target, m, args);
                case "execute", "executeUpdate", "executeLargeUpdate", "executeQuery":
                    if (args == null || args.length == 0) {
                        return executeOne(m, args, name);
                    }
                    return invokeTarget(target, m, args);
                case "executeBatch", "executeLargeBatch":
                    return executeBatch(m, args);
                default:
                    return invokeTarget(target, m, args);
            }
        }

        private void bind(int idx, String method, Object v) {
            if (idx >= binds.length) {
                binds = Arrays.copyOf(binds, Math.max(idx + 1, binds.length * 2));
            }
            Object value;
            if (method.equals("setNull")) {
                value = null;
            } else if (method.contains("Stream") || method.equals("setBlob") || method.equals("setClob") || method.equals("setNClob")) {
                value = method.contains("Character") || method.contains("Clob") ? "<stream>" : new WriteReportWrite.Bytes(-1);
            } else {
                value = v;
            }
            binds[idx] = value;
        }

        private Object executeOne(Method m, Object[] args, String name) throws Throwable {
            if (!WriteReportRecorder.active(handle.context)) {
                return invokeTarget(target, m, args);
            }
            String schema = template.needsSchema() ? handle.currentSchema() : null;
            WriteReportWrite w = template.instantiate(binds.clone(), schema);
            try {
                Object r = invokeTarget(target, m, args);
                long count = -1;
                if (r instanceof Integer i) {
                    count = i;
                } else if (r instanceof Long l) {
                    count = l;
                } else if (r instanceof Boolean b && !b) {
                    count = target.getUpdateCount();
                }
                w.resultRows = rowsResult(w, count);
                WriteReportRecorder.record(handle.context, handle, w);
                return r;
            } catch (SQLException e) {
                w.error(e);
                WriteReportRecorder.record(handle.context, handle, w);
                throw e;
            }
        }

        private Object executeBatch(Method m, Object[] args) throws Throwable {
            List<Object[]> rows = new ArrayList<>(batch);
            batch.clear();
            if (!WriteReportRecorder.active(handle.context) || rows.isEmpty()) {
                return invokeTarget(target, m, args);
            }
            String schema = template.needsSchema() ? handle.currentSchema() : null;
            List<WriteReportWrite> ws = new ArrayList<>();
            for (Object[] b : rows) {
                ws.add(template.instantiate(b, schema));
            }
            try {
                Object r = invokeTarget(target, m, args);
                applyCounts(ws, r);
                WriteReportRecorder.recordBatch(handle.context, handle, ws);
                return r;
            } catch (SQLException e) {
                if (e instanceof BatchUpdateException bu) {
                    applyCounts(ws, bu.getLargeUpdateCounts());
                }
                for (WriteReportWrite w : ws) {
                    w.error(e);
                }
                WriteReportRecorder.recordBatch(handle.context, handle, ws);
                throw e;
            }
        }
    }

    /** 영향 행 수. 모르면(-1) INSERT 는 VALUES 행 수, 나머지는 결과를 비운다. */
    static Long rowsResult(WriteReportWrite w, long count) {
        if (count >= 0) {
            return count;
        }
        if (w.rows != null && w.op != null && w.op.startsWith("INSERT")) {
            return (long) w.rows.size();
        }
        return null;
    }

    static void applyCounts(List<WriteReportWrite> ws, Object counts) {
        if (counts == null) {
            return;
        }
        int n = java.lang.reflect.Array.getLength(counts);
        for (int i = 0; i < ws.size() && i < n; i++) {
            long c = ((Number) java.lang.reflect.Array.get(counts, i)).longValue();
            ws.get(i).resultRows = c >= 0 ? c : rowsResult(ws.get(i), -1);
        }
    }

    // ---------- Statement ----------

    private static final class StaticHandler implements InvocationHandler {
        final Statement target;
        final Connection connection;
        final Handle handle;
        private final List<String> batch = new ArrayList<>();

        StaticHandler(Statement target, Connection connection, Handle handle) {
            this.target = target;
            this.connection = connection;
            this.handle = handle;
        }

        @Override
        public Object invoke(Object proxy, Method m, Object[] args) throws Throwable {
            String name = m.getName();
            switch (name) {
                case "equals":
                    return proxy == args[0];
                case "hashCode":
                    return System.identityHashCode(proxy);
                case "getConnection":
                    return connection;
                case "addBatch":
                    batch.add((String) args[0]);
                    return invokeTarget(target, m, args);
                case "clearBatch":
                    batch.clear();
                    return invokeTarget(target, m, args);
                case "executeBatch", "executeLargeBatch":
                    return executeBatch(m, args);
                case "execute", "executeUpdate", "executeLargeUpdate", "executeQuery":
                    if (args != null && args.length >= 1 && args[0] instanceof String sql) {
                        return executeOne(m, args, sql);
                    }
                    return invokeTarget(target, m, args);
                default:
                    return invokeTarget(target, m, args);
            }
        }

        private Object executeOne(Method m, Object[] args, String sql) throws Throwable {
            if (startsWithSet(sql)) {
                handle.schemaChanged();
            }
            WriteReportSql.Template t = WriteReportRecorder.active(handle.context) ? WriteReportSql.template(sql) : null;
            if (t == null) {
                return invokeTarget(target, m, args);
            }
            WriteReportWrite w = t.instantiate(null, t.needsSchema() ? handle.currentSchema() : null);
            try {
                Object r = invokeTarget(target, m, args);
                long count = -1;
                if (r instanceof Integer i) {
                    count = i;
                } else if (r instanceof Long l) {
                    count = l;
                } else if (r instanceof Boolean b && !b) {
                    count = target.getUpdateCount();
                }
                w.resultRows = rowsResult(w, count);
                WriteReportRecorder.record(handle.context, handle, w);
                return r;
            } catch (SQLException e) {
                w.error(e);
                WriteReportRecorder.record(handle.context, handle, w);
                throw e;
            }
        }

        private Object executeBatch(Method m, Object[] args) throws Throwable {
            List<String> sqls = new ArrayList<>(batch);
            batch.clear();
            if (!WriteReportRecorder.active(handle.context) || sqls.isEmpty()) {
                return invokeTarget(target, m, args);
            }
            List<WriteReportWrite> ws = new ArrayList<>();
            List<Integer> index = new ArrayList<>();
            for (int i = 0; i < sqls.size(); i++) {
                WriteReportSql.Template t = WriteReportSql.template(sqls.get(i));
                if (t != null) {
                    ws.add(t.instantiate(null, t.needsSchema() ? handle.currentSchema() : null));
                    index.add(i);
                }
            }
            try {
                Object r = invokeTarget(target, m, args);
                for (int k = 0; k < ws.size(); k++) {
                    long c = ((Number) java.lang.reflect.Array.get(r, index.get(k))).longValue();
                    ws.get(k).resultRows = rowsResult(ws.get(k), c);
                }
                WriteReportRecorder.recordBatch(handle.context, handle, ws);
                return r;
            } catch (SQLException e) {
                for (WriteReportWrite w : ws) {
                    w.error(e);
                }
                WriteReportRecorder.recordBatch(handle.context, handle, ws);
                throw e;
            }
        }
    }

    /** jOOQ BatchMode.SINGLE: jOOQ 가 준비한 문장을 감싸 행별 바인드를 모으고 executeBatch 때 기록한다. */
    static PreparedStatement recordingStatement(PreparedStatement target, Connection connection, Handle handle, Object context, String sql) {
        WriteReportSql.Template t = WriteReportSql.template(sql);
        if (t == null) {
            return target;
        }
        Handle h = handle != null ? handle : new Handle(context, null, connection);
        return (PreparedStatement) Proxy.newProxyInstance(WriteReportConnections.class.getClassLoader(),
                new Class<?>[] {PreparedStatement.class}, new PreparedHandler(target, connection, h, sql, t));
    }
}
