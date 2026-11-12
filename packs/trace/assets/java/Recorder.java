// 실행 흐름 기록기 (Java, JDI): 디버그 포트로 붙은 JVM 에서 프로젝트 코드만 한 줄씩 기록해 JSON 으로 쓴다. kedovi trace run 이 띄운다
/*
 * 실행: java --add-modules jdk.jdi Recorder.java --port <N> --include <패키지,…> --out <파일> [--entry <클래스>#<메서드>] [--mode test|request]
 *       [--max-steps 5000] [--max-hits 30] [--attach-timeout 600] [--exit-app]
 * test    : 대상 JVM 은 suspend=y 로 기다린다. --entry 메서드가 시작될 때부터 끝날 때까지, 그 스레드만 기록
 * request : 대상 JVM(서버)은 이미 돈다. 표준 입력 「start」 에 기록을 켜고, 처음 프로젝트 코드를 탄 스레드만 기록, 「stop」 에 끈다
 * 값은 필드만 읽는다. 대상 JVM 의 메서드는 부르지 않는다 (toString · JPA 지연 로딩이 실행 결과를 바꾸지 않게)
 * SQL: datasource-proxy 의 afterQuery 가 불릴 때 질의 · 파라미터를 읽는다 (kedovi trace 가 기록할 때만 붙인다)
 */
import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import java.io.*;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Pattern;

public class Recorder {
  // ── 설정 ──
  static int port;
  static String outFile;
  static String mode = "test";
  static String entryClass, entryMethod;
  static List<String> include = new ArrayList<>();
  static int maxSteps = 5000, maxHits = 30, attachTimeout = 600;
  static boolean exitApp = false;
  static final int MAX_DEPTH = 3, MAX_ITEMS = 20, MAX_FIELDS = 40, MAX_STR = 500;
  static final Pattern SECRET = Pattern.compile("(?i).*(passw|pwd|secret|token|apikey|api_key|credential|authorization|private_?key).*");
  static final Pattern ACCESSOR = Pattern.compile("^(get|set|is|has)[A-Z].*|^(equals|hashCode|toString|canEqual)$");

  // ── 상태 ──
  static VirtualMachine vm;
  static EventRequestManager erm;
  static final List<Step> steps = new ArrayList<>();
  static final Map<String, Frame> frames = new HashMap<>(); // 스레드:깊이 → 프레임
  static final Set<ReferenceType> armed = new HashSet<>();
  static final List<EventRequest> windowReqs = new ArrayList<>();
  static final Set<Long> seenSql = new HashSet<>();
  static final List<String> notes = new ArrayList<>();
  static ThreadReference target; // 기록하는 스레드
  static int entryDepth = -1;
  static boolean recording = false, done = false, truncated = false, written = false;
  static long t0 = System.currentTimeMillis(), startedAt, endedAt;
  static int callSeq = 0;

  static class Frame { int call; String method; int lastStep = -1; boolean muted; int curLine; Map<String, String> vals = new HashMap<>(); Map<Integer, Integer> hits = new HashMap<>(); int depth; }
  static class Step {
    String kind; int call = -1, parent = -1, site = -1, depth, line; String cls, method, src; long t;
    String args, ret, extra; boolean isCall; int skipped, skippedCalls; LinkedHashMap<String, String> after;
  }

  public static void main(String[] a) throws Exception {
    for (int i = 0; i < a.length; i++) {
      String k = a[i], v = i + 1 < a.length ? a[i + 1] : null;
      switch (k) {
        case "--port": port = Integer.parseInt(v); i++; break;
        case "--out": outFile = v; i++; break;
        case "--mode": mode = v; i++; break;
        case "--include": for (String p : v.split(",")) if (!p.isBlank()) include.add(p.trim()); i++; break;
        case "--entry": { int h = v.indexOf('#'); entryClass = h < 0 ? v : v.substring(0, h); entryMethod = h < 0 ? null : v.substring(h + 1); i++; break; }
        case "--max-steps": maxSteps = Integer.parseInt(v); i++; break;
        case "--max-hits": maxHits = Integer.parseInt(v); i++; break;
        case "--attach-timeout": attachTimeout = Integer.parseInt(v); i++; break;
        case "--exit-app": exitApp = true; break;
        default: break;
      }
    }
    if (port == 0 || outFile == null || include.isEmpty()) { System.err.println("사용법: --port N --include 패키지 --out 파일 [--entry 클래스#메서드] [--mode test|request]"); System.exit(2); }
    if (mode.equals("test") && entryClass == null) { System.err.println("test 모드는 --entry 클래스#메서드 가 필요합니다"); System.exit(2); }
    vm = attach();
    erm = vm.eventRequestManager();
    say("ATTACHED");
    if (mode.equals("test")) armEntry(); else watchStdin();
    loop();
  }

  static void say(String s) { System.out.println(s); System.out.flush(); }

  static VirtualMachine attach() throws Exception {
    AttachingConnector c = Bootstrap.virtualMachineManager().attachingConnectors().stream().filter(x -> x.transport().name().equals("dt_socket")).findFirst().orElseThrow();
    Map<String, Connector.Argument> args = c.defaultArguments();
    args.get("hostname").setValue("127.0.0.1");
    args.get("port").setValue(String.valueOf(port));
    long until = System.currentTimeMillis() + attachTimeout * 1000L;
    while (true) {
      try { return c.attach(args); } catch (IOException e) {
        if (System.currentTimeMillis() > until) { System.err.println("디버그 포트 " + port + " 에 붙지 못했습니다 (" + attachTimeout + "초)"); System.exit(3); }
        Thread.sleep(300);
      }
    }
  }

  // ── 기록 범위 ──
  static boolean ours(String cls) {
    if (cls.contains("$$") || cls.contains("$HibernateProxy$") || cls.contains("$ByteBuddy$")) return false;
    for (String p : include) if (cls.equals(p) || cls.startsWith(p + ".")) return true;
    return false;
  }

  /** test 모드: 시작 메서드의 첫 줄에 중단점 */
  static void armEntry() {
    ClassPrepareRequest r = erm.createClassPrepareRequest();
    r.addClassFilter(entryClass);
    r.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
    r.enable();
    for (ReferenceType t : vm.classesByName(entryClass)) entryBreak(t);
  }

  static void entryBreak(ReferenceType t) {
    for (Method m : t.methods()) {
      if (entryMethod != null && !m.name().equals(entryMethod)) continue;
      if (m.location() == null || m.isAbstract() || m.isNative()) continue;
      if (entryMethod == null && m.name().startsWith("<")) continue;
      BreakpointRequest b = erm.createBreakpointRequest(m.location());
      b.putProperty("entry", Boolean.TRUE);
      b.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
      b.enable();
    }
  }

  /** request 모드: 표준 입력으로 켜고 끈다 */
  static void watchStdin() {
    Thread th = new Thread(() -> {
      try (BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
        String l;
        while ((l = in.readLine()) != null) {
          l = l.trim();
          if (l.equals("start")) { synchronized (Recorder.class) { startedAt = now(); armAll(null); say("ARMED"); } }
          else if (l.equals("stop")) { synchronized (Recorder.class) { finish("멈춤 요청"); } break; }
        }
      } catch (Exception e) { /* 끝 */ }
    });
    th.setDaemon(true);
    th.start();
  }

  static long now() { return System.currentTimeMillis() - t0; }

  /** 프로젝트 클래스의 모든 줄에 중단점 + 새로 올라오는 클래스도 (thread 가 있으면 그 스레드만) */
  static void armAll(ThreadReference th) {
    recording = true;
    for (String p : include) { // 필터는 AND 로 묶이므로 패키지마다 요청 하나
      ClassPrepareRequest r = erm.createClassPrepareRequest();
      r.addClassFilter(p + ".*");
      r.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
      r.enable();
      windowReqs.add(r);
    }
    for (ReferenceType t : vm.allClasses()) if (ours(t.name())) armClass(t);
    if (th != null) armThread(th);
  }

  static void armClass(ReferenceType t) {
    if (!armed.add(t)) return;
    if (!ours(t.name())) return;
    try {
      for (Method m : t.methods()) {
        if (m.isAbstract() || m.isNative() || m.isSynthetic() && !m.name().startsWith("lambda$") || m.isBridge()) continue;
        List<Location> ls;
        try { ls = m.allLineLocations(); } catch (AbsentInformationException e) { continue; }
        if (skipMethod(m, ls)) continue;
        Set<Integer> lines = new HashSet<>();
        for (Location l : ls) {
          if (!lines.add(l.lineNumber())) continue;
          BreakpointRequest b = erm.createBreakpointRequest(l);
          if (target != null) b.addThreadFilter(target);
          b.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
          b.enable();
          windowReqs.add(b);
        }
      }
    } catch (ClassNotPreparedException e) { armed.remove(t); }
  }

  /** 한 줄짜리 접근자 · equals · hashCode (Lombok 등) 는 건너뛴다 */
  static boolean skipMethod(Method m, List<Location> ls) {
    if (m.name().equals("<clinit>")) return true;
    if (m.name().equals("<init>") && m.declaringType() instanceof ClassType && isEnum((ClassType) m.declaringType())) return true;
    Set<Integer> s = new HashSet<>();
    for (Location l : ls) s.add(l.lineNumber());
    if (s.size() > 1) return false;
    if (ACCESSOR.matcher(m.name()).matches() || m.name().equals("<init>")) return true; // 한 줄짜리 접근자 · 생성자 (Lombok · record · 빈 생성자)
    try { return m.argumentTypeNames().isEmpty() && m.declaringType().fieldByName(m.name()) != null; } catch (Exception e) { return false; } // record 접근자 name()
  }

  /** 기록 스레드가 정해지면: 메서드 끝(반환값) · SQL · 예외 */
  static void armThread(ThreadReference th) {
    target = th;
    for (String p : include) {
      MethodExitRequest x = erm.createMethodExitRequest();
      x.addClassFilter(p + ".*");
      x.addThreadFilter(th);
      x.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
      x.enable();
      windowReqs.add(x);
    }
    MethodEntryRequest q = erm.createMethodEntryRequest();
    q.addClassFilter("net.ttddyy.dsproxy.listener.*");
    q.addThreadFilter(th);
    q.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
    q.enable();
    windowReqs.add(q);
    ExceptionRequest e = erm.createExceptionRequest(null, true, true);
    e.addThreadFilter(th);
    e.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
    e.enable();
    windowReqs.add(e);
  }

  static void disarm() {
    for (EventRequest r : windowReqs) { try { erm.deleteEventRequest(r); } catch (Exception ignore) { } }
    windowReqs.clear();
    try { erm.deleteEventRequests(new ArrayList<>(erm.breakpointRequests())); } catch (Exception ignore) { }
    recording = false;
  }

  static void finish(String why) {
    if (done) return;
    done = true;
    endedAt = now();
    disarm();
    if (why != null && !why.equals("시작 메서드 끝") && !why.equals("멈춤 요청")) notes.add(why);
    write();
    say("DONE " + steps.size());
    if (mode.equals("request")) {
      try { if (exitApp) vm.exit(0); else vm.dispose(); } catch (Exception ignore) { }
      System.exit(0);
    }
  }

  // ── 이벤트 ──
  static void loop() throws Exception {
    EventQueue q = vm.eventQueue();
    while (true) {
      EventSet set;
      try { set = q.remove(); } catch (VMDisconnectedException e) { break; }
      boolean stop = false;
      Set<String> seenLoc = new HashSet<>();
      synchronized (Recorder.class) {
        for (Event ev : set) {
          try {
            if (ev instanceof VMDeathEvent || ev instanceof VMDisconnectEvent) { stop = true; continue; }
            if (ev instanceof ClassPrepareEvent) {
              ReferenceType t = ((ClassPrepareEvent) ev).referenceType();
              if (mode.equals("test") && t.name().equals(entryClass) && !recording && !done) entryBreak(t);
              if (recording) armClass(t);
            } else if (ev instanceof BreakpointEvent) {
              BreakpointEvent b = (BreakpointEvent) ev;
              String key = b.thread().uniqueID() + "@" + b.location();
              if (!seenLoc.add(key)) continue;
              onBreak(b);
            } else if (ev instanceof MethodExitEvent) onExit((MethodExitEvent) ev);
            else if (ev instanceof MethodEntryEvent) onSql((MethodEntryEvent) ev);
            else if (ev instanceof ExceptionEvent) onException((ExceptionEvent) ev);
          } catch (VMDisconnectedException e) { stop = true; } catch (Exception e) { if (notes.size() < 20) notes.add("기록 오류: " + e); }
        }
      }
      if (stop) break;
      try { set.resume(); } catch (VMDisconnectedException e) { break; }
    }
    synchronized (Recorder.class) { if (!done) { endedAt = now(); write(); } }
  }

  static void onBreak(BreakpointEvent b) throws Exception {
    if (done) return;
    ThreadReference th = b.thread();
    if (!recording) {
      if (mode.equals("test") && Boolean.TRUE.equals(b.request().getProperty("entry"))) {
        startedAt = now();
        target = th;
        entryDepth = th.frameCount();
        for (BreakpointRequest r : new ArrayList<>(erm.breakpointRequests())) erm.deleteEventRequest(r);
        armAll(th);
      } else return;
    }
    if (target == null) armThread(th); // request 모드: 처음 탄 스레드
    if (!th.equals(target)) return;
    if (steps.size() >= maxSteps) { truncated = true; finish("단계 상한(" + maxSteps + ")에 닿아 멈춤"); return; }
    StackFrame f = th.frame(0);
    Location loc = f.location();
    int count = th.frameCount();
    String key = th.uniqueID() + ":" + count;
    frames.entrySet().removeIf(e -> e.getValue().depth > count && e.getKey().startsWith(th.uniqueID() + ":")); // 예외로 빠져나간 프레임
    Frame fr = frames.get(key);
    String mname = loc.method().name() + loc.method().signature();
    boolean isCall = fr == null || !fr.method.equals(mname);
    if (isCall) {
      fr = new Frame();
      fr.call = callSeq++;
      fr.method = mname;
      fr.depth = count;
      frames.put(key, fr);
      // 상한을 넘긴 반복 줄에서 부른 호출은 접는다 (그 아래 호출도)
      Frame par = parentOf(th, count);
      if (par != null && (par.muted || par.hits.getOrDefault(par.curLine, 0) > maxHits)) {
        fr.muted = true;
        if (!par.muted && par.lastStep >= 0) steps.get(par.lastStep).skippedCalls++;
      }
    }
    if (fr.muted) return;
    int line = loc.lineNumber();
    fr.curLine = line;
    int h = fr.hits.merge(line, 1, Integer::sum);
    if (!isCall && h > maxHits) { // 같은 줄을 많이 돌면 값은 건너뛰고 수만 센다
      if (fr.lastStep >= 0) steps.get(fr.lastStep).skipped++;
      return;
    }
    Map<String, String> cur = locals(f);
    Step s = new Step();
    s.kind = "line"; s.call = fr.call; s.depth = ourDepth(th); s.line = line; s.t = now();
    s.cls = loc.declaringType().name(); s.method = loc.method().name();
    try { s.src = loc.sourcePath(); } catch (AbsentInformationException e) { s.src = s.cls.replace('.', '/') + ".java"; }
    if (isCall) {
      s.isCall = true;
      Frame parent = parentOf(th, count);
      if (parent != null) { s.parent = parent.call; s.site = parent.lastStep; }
      s.args = obj(cur);
    } else if (fr.lastStep >= 0) {
      LinkedHashMap<String, String> ch = diff(fr.vals, cur);
      if (!ch.isEmpty()) { Step prev = steps.get(fr.lastStep); if (prev.after == null) prev.after = ch; else prev.after.putAll(ch); }
    }
    fr.vals = cur;
    fr.lastStep = steps.size();
    steps.add(s);
  }

  static Frame parentOf(ThreadReference th, int count) {
    Frame best = null;
    String pre = th.uniqueID() + ":";
    for (Map.Entry<String, Frame> e : frames.entrySet()) {
      if (!e.getKey().startsWith(pre)) continue;
      Frame f = e.getValue();
      if (f.depth < count && (best == null || f.depth > best.depth)) best = f;
    }
    return best;
  }

  static int ourDepth(ThreadReference th) throws IncompatibleThreadStateException {
    int n = 0;
    for (StackFrame f : th.frames()) if (ours(f.location().declaringType().name())) n++;
    return n;
  }

  static void onExit(MethodExitEvent e) throws Exception {
    if (done || !recording) return;
    ThreadReference th = e.thread();
    if (!th.equals(target)) return;
    int count = th.frameCount();
    String key = th.uniqueID() + ":" + count;
    Frame fr = frames.get(key);
    String mname = e.method().name() + e.method().signature();
    if (fr != null && fr.muted && fr.method.equals(mname)) { frames.remove(key); return; }
    if (fr == null || !fr.method.equals(mname)) {
      if (mode.equals("test") && count == entryDepth && e.method().name().equals(entryMethod)) finish("시작 메서드 끝");
      return;
    }
    try {
      Map<String, String> cur = locals(th.frame(0));
      LinkedHashMap<String, String> ch = diff(fr.vals, cur);
      if (!ch.isEmpty() && fr.lastStep >= 0) { Step prev = steps.get(fr.lastStep); if (prev.after == null) prev.after = ch; else prev.after.putAll(ch); }
    } catch (Exception ignore) { }
    Step s = new Step();
    s.kind = "return"; s.call = fr.call; s.t = now(); s.depth = ourDepth(th);
    if (fr.lastStep >= 0) s.line = steps.get(fr.lastStep).line;
    if (!e.method().returnTypeName().equals("void")) s.ret = ser(e.returnValue(), 0, new HashSet<>());
    steps.add(s);
    frames.remove(key);
    if (mode.equals("test") && count == entryDepth && e.method().name().equals(entryMethod)) finish("시작 메서드 끝");
  }

  /** datasource-proxy: QueryExecutionListener.afterQuery(ExecutionInfo, List<QueryInfo>) */
  static void onSql(MethodEntryEvent e) throws Exception {
    if (done || !recording || !e.method().name().equals("afterQuery")) return;
    ThreadReference th = e.thread();
    if (!th.equals(target)) return;
    List<Value> av = th.frame(0).getArgumentValues();
    if (av.size() < 2 || !(av.get(0) instanceof ObjectReference)) return;
    ObjectReference info = (ObjectReference) av.get(0);
    if (!seenSql.add(info.uniqueID())) return; // 묶음 리스너가 같은 실행을 여러 번 부른다
    StringBuilder sb = new StringBuilder("{");
    sb.append("\"ms\":").append(num(field(info, "elapsedTime"))).append(',');
    Value ok = field(info, "success");
    sb.append("\"ok\":").append(ok instanceof BooleanValue ? ((BooleanValue) ok).value() : true).append(',');
    Value res = field(info, "result");
    if (res instanceof ObjectReference && isBoxed(((ObjectReference) res).referenceType().name())) sb.append("\"res\":").append(ser(res, 0, new HashSet<>())).append(',');
    sb.append("\"qs\":[");
    List<Value> qs = listItems(av.get(1), 50);
    for (int i = 0; i < qs.size(); i++) {
      if (!(qs.get(i) instanceof ObjectReference)) continue;
      ObjectReference qi = (ObjectReference) qs.get(i);
      if (i > 0) sb.append(',');
      sb.append("{\"q\":").append(str(field(qi, "query"))).append(",\"ps\":[");
      List<Value> sets = listItems(field(qi, "parametersList"), 20);
      for (int j = 0; j < sets.size(); j++) {
        if (j > 0) sb.append(',');
        sb.append('[');
        List<Value> ops = listItems(sets.get(j), 100);
        for (int k = 0; k < ops.size(); k++) {
          if (k > 0) sb.append(',');
          Value args = ops.get(k) instanceof ObjectReference ? field((ObjectReference) ops.get(k), "args") : null;
          if (args instanceof ArrayReference) {
            List<Value> xs = ((ArrayReference) args).getValues();
            sb.append('[').append(xs.size() > 0 ? ser(xs.get(0), 2, new HashSet<>()) : "null").append(',').append(xs.size() > 1 ? ser(xs.get(1), 1, new HashSet<>()) : "null").append(']');
          } else sb.append("null");
        }
        sb.append(']');
      }
      sb.append("]}");
    }
    sb.append("]}");
    Step s = new Step();
    s.kind = "sql"; s.t = now(); s.extra = sb.toString(); s.depth = ourDepth(th);
    Frame owner = parentOf(th, th.frameCount() + 1);
    if (owner != null) { s.call = owner.call; s.site = owner.lastStep; if (owner.lastStep >= 0) s.line = steps.get(owner.lastStep).line; }
    steps.add(s);
  }

  static void onException(ExceptionEvent e) throws Exception {
    if (done || !recording) return;
    ThreadReference th = e.thread();
    if (!th.equals(target)) return;
    Location at = e.location(), cat = e.catchLocation();
    boolean mine = ours(at.declaringType().name()) || cat != null && ours(cat.declaringType().name()) || crossesOurs(th, cat);
    if (!mine) return;
    long n = steps.stream().filter(x -> x.kind.equals("ex")).count();
    if (n >= 50) return;
    ObjectReference ex = e.exception();
    StringBuilder sb = new StringBuilder("{");
    sb.append("\"type\":").append(q(ex.referenceType().name())).append(',');
    sb.append("\"msg\":").append(str(fieldUp(ex, "detailMessage"))).append(',');
    sb.append("\"at\":").append(q(at.declaringType().name() + ":" + at.lineNumber())).append(',');
    sb.append("\"caught\":").append(cat == null ? "null" : q(cat.declaringType().name() + ":" + cat.lineNumber()));
    sb.append('}');
    Step s = new Step();
    s.kind = "ex"; s.t = now(); s.extra = sb.toString(); s.depth = ourDepth(th);
    Frame owner = parentOf(th, th.frameCount() + 1);
    if (owner != null) { s.call = owner.call; s.site = owner.lastStep; }
    if (ours(at.declaringType().name())) s.line = at.lineNumber();
    steps.add(s);
  }

  /** 라이브러리에서 던져 라이브러리에서 잡더라도, 그 사이에 프로젝트 프레임이 있으면 프로젝트 코드를 빠져나간 예외다 */
  static boolean crossesOurs(ThreadReference th, Location cat) throws IncompatibleThreadStateException {
    List<StackFrame> fs = th.frames();
    for (StackFrame f : fs) {
      Location l = f.location();
      if (cat != null && l.method().equals(cat.method())) return false;
      if (ours(l.declaringType().name())) return true;
    }
    return false;
  }

  // ── 값 읽기 (메서드 호출 없음) ──
  static Map<String, String> locals(StackFrame f) {
    LinkedHashMap<String, String> m = new LinkedHashMap<>();
    try {
      List<LocalVariable> vs = f.visibleVariables();
      Map<LocalVariable, Value> vals = f.getValues(vs);
      for (LocalVariable v : vs) m.put(v.name(), SECRET.matcher(v.name()).matches() && vals.get(v) != null ? "\"***\"" : ser(vals.get(v), 0, new HashSet<>()));
    } catch (AbsentInformationException e) {
      try { List<Value> av = f.getArgumentValues(); for (int i = 0; i < av.size(); i++) m.put("arg" + i, ser(av.get(i), 0, new HashSet<>())); } catch (Exception ignore) { }
    } catch (Exception ignore) { }
    return m;
  }

  static LinkedHashMap<String, String> diff(Map<String, String> before, Map<String, String> now) {
    LinkedHashMap<String, String> ch = new LinkedHashMap<>();
    for (Map.Entry<String, String> e : now.entrySet()) if (!e.getValue().equals(before.get(e.getKey()))) ch.put(e.getKey(), e.getValue());
    return ch;
  }

  static Value field(ObjectReference o, String name) {
    if (o == null) return null;
    Field f = o.referenceType().fieldByName(name);
    return f == null ? null : o.getValue(f);
  }

  /** 부모 클래스까지 올라가며 필드 찾기 */
  static Value fieldUp(ObjectReference o, String name) {
    if (o == null) return null;
    ReferenceType t = o.referenceType();
    while (t instanceof ClassType) {
      Field f = t.fieldByName(name);
      if (f != null) return o.getValue(f);
      t = ((ClassType) t).superclass();
    }
    return null;
  }

  static boolean isBoxed(String t) {
    return t.equals("java.lang.Integer") || t.equals("java.lang.Long") || t.equals("java.lang.Short") || t.equals("java.lang.Byte") || t.equals("java.lang.Double") || t.equals("java.lang.Float") || t.equals("java.lang.Boolean") || t.equals("java.lang.Character");
  }

  static String num(Value v) {
    if (v instanceof PrimitiveValue) return v.toString();
    if (v instanceof ObjectReference) { Value x = field((ObjectReference) v, "value"); if (x instanceof PrimitiveValue) return x.toString(); }
    return "null";
  }

  static String q(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c == '\n') b.append("\\n");
      else if (c == '\r') b.append("\\r");
      else if (c == '\t') b.append("\\t");
      else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
      else b.append(c);
    }
    return b.append('"').toString();
  }

  static String str(Value v) {
    if (v == null) return "null";
    if (v instanceof StringReference) {
      String s = ((StringReference) v).value();
      return q(s.length() > MAX_STR * 4 ? s.substring(0, MAX_STR * 4) + "…(" + s.length() + "자)" : s);
    }
    return q(String.valueOf(v));
  }

  static String obj(Map<String, String> m) {
    StringBuilder b = new StringBuilder("{");
    boolean first = true;
    for (Map.Entry<String, String> e : m.entrySet()) { if (!first) b.append(','); first = false; b.append(q(e.getKey())).append(':').append(e.getValue()); }
    return b.append('}').toString();
  }

  static String typeOnly(String t, String extra) { return "{\"t\":" + q(t) + (extra == null ? "" : "," + extra) + "}"; }

  static boolean framework(String t) {
    return t.startsWith("org.springframework.") || t.startsWith("jakarta.") || t.startsWith("javax.") || t.startsWith("org.hibernate.") || t.startsWith("org.apache.") || t.startsWith("com.zaxxer.") || t.startsWith("com.fasterxml.") || t.startsWith("org.slf4j.") || t.startsWith("ch.qos.") || t.startsWith("io.micrometer.") || t.startsWith("org.junit.") || t.startsWith("org.mockito.") || t.startsWith("net.ttddyy.") || t.startsWith("org.aspectj.") || t.startsWith("reactor.") || t.startsWith("io.netty.") || t.startsWith("java.lang.reflect.") || t.startsWith("java.lang.Class") || t.startsWith("java.lang.Thread") || t.startsWith("java.util.concurrent.") || t.startsWith("sun.") || t.startsWith("jdk.") || t.startsWith("com.sun.");
  }

  static String ser(Value v, int depth, Set<Long> path) {
    if (v == null) return "null";
    if (v instanceof BooleanValue || v instanceof IntegerValue || v instanceof LongValue || v instanceof ShortValue || v instanceof ByteValue) return v.toString();
    if (v instanceof DoubleValue || v instanceof FloatValue) { String s = v.toString(); return s.equals("NaN") || s.contains("Infinity") ? q(s) : s; }
    if (v instanceof CharValue) return q(String.valueOf(((CharValue) v).value()));
    if (v instanceof StringReference) {
      String s = ((StringReference) v).value();
      return q(s.length() > MAX_STR ? s.substring(0, MAX_STR) + "…(" + s.length() + "자)" : s);
    }
    ObjectReference o = (ObjectReference) v;
    String t = o.referenceType().name();
    long id = o.uniqueID();
    try {
      if (isBoxed(t)) { Value x = field(o, "value"); return x == null ? "null" : ser(x, depth, path); }
      if (o instanceof ArrayReference) {
        ArrayReference a = (ArrayReference) o;
        int n = a.length();
        if (t.equals("byte[]")) return typeOnly(t, "\"n\":" + n);
        if (depth >= MAX_DEPTH) return typeOnly(t, "\"n\":" + n + ",\"ref\":" + id);
        return seq(t, n, a.getValues(0, Math.min(n, MAX_ITEMS)), depth, path, id);
      }
      String special = special(o, t, depth, path);
      if (special != null) return special;
      if (o.referenceType() instanceof ClassType && isEnum((ClassType) o.referenceType())) return typeOnly(t, "\"v\":" + str(fieldUp(o, "name")));
      if (o.referenceType() instanceof ClassType && isThrowable((ClassType) o.referenceType())) {
        Value cause = fieldUp(o, "cause");
        String c = cause instanceof ObjectReference && !cause.equals(o) ? ",\"cause\":" + q(((ObjectReference) cause).referenceType().name()) : "";
        return typeOnly(t, "\"msg\":" + str(fieldUp(o, "detailMessage")) + c);
      }
      if (t.contains("$HibernateProxy$") || t.contains("$ByteBuddy$")) return typeOnly(t.replaceAll("\\$(HibernateProxy|ByteBuddy)\\$.*$", ""), "\"lazy\":true,\"note\":\"지연 로딩 프록시 (읽지 않음)\"");
      if (framework(t)) return typeOnly(t, null);
      if (path.contains(id)) return typeOnly(t, "\"ref\":" + id + ",\"cycle\":true");
      if (depth >= MAX_DEPTH) return typeOnly(t, "\"ref\":" + id);
      path.add(id);
      StringBuilder b = new StringBuilder("{\"t\":").append(q(t)).append(",\"id\":").append(id).append(",\"f\":{");
      int n = 0;
      for (Field f : o.referenceType().allFields()) {
        if (f.isStatic() || f.name().startsWith("$$_hibernate") || f.name().startsWith("this$")) continue;
        if (n >= MAX_FIELDS) { b.append(",\"…\":\"필드 더 있음\""); break; }
        if (n > 0) b.append(',');
        Value fv = o.getValue(f);
        b.append(q(f.name())).append(':').append(SECRET.matcher(f.name()).matches() && fv != null ? "\"***\"" : ser(fv, depth + 1, path));
        n++;
      }
      path.remove(id);
      return b.append("}}").toString();
    } catch (ObjectCollectedException e) {
      return typeOnly(t, "\"gone\":true");
    }
  }

  static boolean isEnum(ClassType c) {
    for (ClassType s = c.superclass(); s != null; s = s.superclass()) if (s.name().equals("java.lang.Enum")) return true;
    return false;
  }

  static boolean isThrowable(ClassType c) {
    for (ClassType s = c; s != null; s = s.superclass()) if (s.name().equals("java.lang.Throwable")) return true;
    return false;
  }

  static String seq(String t, int n, List<Value> items, int depth, Set<Long> path, long id) {
    StringBuilder b = new StringBuilder("{\"t\":").append(q(t)).append(",\"n\":").append(n).append(",\"items\":[");
    for (int i = 0; i < items.size(); i++) { if (i > 0) b.append(','); b.append(ser(items.get(i), depth + 1, path)); }
    return b.append("]}").toString();
  }

  static int intField(ObjectReference o, String f) { Value v = field(o, f); return v instanceof IntegerValue ? ((IntegerValue) v).value() : v instanceof PrimitiveValue ? (int) ((PrimitiveValue) v).longValue() : 0; }
  static long longField(ObjectReference o, String f) { Value v = field(o, f); return v instanceof PrimitiveValue ? ((PrimitiveValue) v).longValue() : 0; }

  /** 자주 쓰는 JDK 타입: 메서드 없이 필드로 값을 만든다 */
  static String special(ObjectReference o, String t, int depth, Set<Long> path) {
    switch (t) {
      case "java.math.BigDecimal": {
        long ic = longField(o, "intCompact");
        int scale = intField(o, "scale");
        BigInteger unscaled = ic != Long.MIN_VALUE ? BigInteger.valueOf(ic) : bigInt((ObjectReference) field(o, "intVal"));
        return unscaled == null ? typeOnly(t, null) : typeOnly(t, "\"v\":" + q(new BigDecimal(unscaled, scale).toPlainString()));
      }
      case "java.math.BigInteger": { BigInteger b = bigInt(o); return b == null ? typeOnly(t, null) : typeOnly(t, "\"v\":" + q(b.toString())); }
      case "java.time.LocalDate": return typeOnly(t, "\"v\":" + q(date(o)));
      case "java.time.LocalTime": return typeOnly(t, "\"v\":" + q(time(o)));
      case "java.time.LocalDateTime": return typeOnly(t, "\"v\":" + q(date((ObjectReference) field(o, "date")) + "T" + time((ObjectReference) field(o, "time"))));
      case "java.time.Instant": return typeOnly(t, "\"v\":" + q(java.time.Instant.ofEpochSecond(longField(o, "seconds"), intField(o, "nanos")).toString()));
      case "java.time.OffsetDateTime": case "java.time.ZonedDateTime": {
        ObjectReference dt = (ObjectReference) field(o, "dateTime");
        ObjectReference off = (ObjectReference) field(o, "offset");
        int secs = off == null ? 0 : intField(off, "totalSeconds");
        return typeOnly(t, "\"v\":" + q(dt == null ? "?" : date((ObjectReference) field(dt, "date")) + "T" + time((ObjectReference) field(dt, "time")) + java.time.ZoneOffset.ofTotalSeconds(secs)));
      }
      case "java.sql.Date": return typeOnly(t, "\"v\":" + q(java.time.Instant.ofEpochMilli(longField(o, "fastTime")).atZone(java.time.ZoneId.systemDefault()).toLocalDate().toString()));
      case "java.sql.Timestamp": return typeOnly(t, "\"v\":" + q(java.time.Instant.ofEpochMilli(longField(o, "fastTime")).atZone(java.time.ZoneId.systemDefault()).toLocalDateTime().withNano(intField(o, "nanos")).toString()));
      case "java.util.Date": return typeOnly(t, "\"v\":" + q(java.time.Instant.ofEpochMilli(longField(o, "fastTime")).atZone(java.time.ZoneId.systemDefault()).toOffsetDateTime().toString()));
      case "java.util.UUID": return typeOnly(t, "\"v\":" + q(new UUID(longField(o, "mostSigBits"), longField(o, "leastSigBits")).toString()));
      case "java.util.Optional": { Value x = field(o, "value"); return "{\"t\":\"Optional\",\"v\":" + ser(x, depth, path) + "}"; }
      case "java.lang.Object": return typeOnly(t, null);
      default: break;
    }
    // 목록 · 집합 · 맵
    if (t.equals("java.util.ArrayList") || t.equals("java.util.Vector")) {
      int n = intField(o, t.endsWith("Vector") ? "elementCount" : "size");
      ArrayReference a = (ArrayReference) field(o, "elementData");
      return listOf(t, n, a == null ? List.of() : a.getValues(0, Math.min(n, MAX_ITEMS)), depth, path, o.uniqueID());
    }
    if (t.equals("java.util.Arrays$ArrayList") || t.equals("java.util.ImmutableCollections$ListN") || t.equals("java.util.ImmutableCollections$SetN") || t.equals("java.util.concurrent.CopyOnWriteArrayList")) {
      ArrayReference a = (ArrayReference) field(o, t.endsWith("ArrayList") && t.startsWith("java.util.Arrays") ? "a" : t.contains("CopyOnWrite") ? "array" : "elements");
      List<Value> xs = new ArrayList<>();
      if (a != null) for (Value x : a.getValues()) if (x != null || !t.endsWith("SetN")) xs.add(x);
      return listOf(t, xs.size(), xs.subList(0, Math.min(xs.size(), MAX_ITEMS)), depth, path, o.uniqueID());
    }
    if (t.equals("java.util.ImmutableCollections$List12") || t.equals("java.util.ImmutableCollections$Set12")) {
      List<Value> xs = new ArrayList<>();
      Value a = field(o, "e0"), b = field(o, "e1");
      xs.add(a);
      if (b != null && !(b instanceof ObjectReference && ((ObjectReference) b).referenceType().name().equals("java.lang.Object"))) xs.add(b);
      return listOf(t, xs.size(), xs, depth, path, o.uniqueID());
    }
    if (t.equals("java.util.Collections$EmptyList") || t.equals("java.util.Collections$EmptySet")) return listOf(t, 0, List.of(), depth, path, o.uniqueID());
    if (t.equals("java.util.Collections$EmptyMap")) return "{\"t\":" + q(t) + ",\"n\":0,\"entries\":[]}";
    if (t.equals("java.util.Collections$SingletonList") || t.equals("java.util.Collections$SingletonSet")) return listOf(t, 1, List.of(field(o, "element")), depth, path, o.uniqueID());
    if (t.startsWith("java.util.Collections$Unmodifiable") || t.startsWith("java.util.Collections$Synchronized")) {
      Value inner = t.contains("Map") ? fieldUp(o, "m") : fieldUp(o, "c");
      return inner == null ? typeOnly(t, null) : ser(inner, depth, path);
    }
    if (t.equals("java.util.LinkedList")) {
      List<Value> xs = new ArrayList<>();
      int n = intField(o, "size");
      for (ObjectReference node = (ObjectReference) field(o, "first"); node != null && xs.size() < MAX_ITEMS; node = (ObjectReference) field(node, "next")) xs.add(field(node, "item"));
      return listOf(t, n, xs, depth, path, o.uniqueID());
    }
    if (t.equals("java.util.HashSet") || t.equals("java.util.LinkedHashSet")) {
      ObjectReference m = (ObjectReference) fieldUp(o, "map");
      List<Value[]> es = mapEntries(m);
      List<Value> xs = new ArrayList<>();
      for (Value[] e : es) xs.add(e[0]);
      return listOf(t, m == null ? 0 : intField(m, "size"), xs, depth, path, o.uniqueID());
    }
    if (t.equals("java.util.HashMap") || t.equals("java.util.LinkedHashMap") || t.equals("java.util.TreeMap") || t.equals("java.util.concurrent.ConcurrentHashMap") || t.startsWith("java.util.ImmutableCollections$Map")) {
      int n = t.startsWith("java.util.ImmutableCollections$Map1") ? 1 : t.startsWith("java.util.ImmutableCollections") ? -1 : intField(o, t.contains("Concurrent") ? "baseCount" : "size");
      List<Value[]> es = mapEntries(o);
      if (n < 0) n = es.size();
      if (depth >= MAX_DEPTH) return "{\"t\":" + q(t) + ",\"n\":" + n + ",\"ref\":" + o.uniqueID() + "}";
      StringBuilder b = new StringBuilder("{\"t\":").append(q(t)).append(",\"n\":").append(n).append(",\"entries\":[");
      for (int i = 0; i < es.size(); i++) {
        if (i > 0) b.append(',');
        String k = ser(es.get(i)[0], depth + 1, path);
        boolean hide = es.get(i)[0] instanceof StringReference && SECRET.matcher(((StringReference) es.get(i)[0]).value()).matches();
        b.append('[').append(k).append(',').append(hide ? "\"***\"" : ser(es.get(i)[1], depth + 1, path)).append(']');
      }
      return b.append("]}").toString();
    }
    // Hibernate 컬렉션: 아직 읽지 않았으면 그대로 둔다
    if (t.startsWith("org.hibernate.collection.")) {
      Value init = fieldUp(o, "initialized");
      if (init instanceof BooleanValue && !((BooleanValue) init).value()) return typeOnly(t, "\"lazy\":true,\"note\":\"지연 로딩 (아직 읽지 않음)\"");
      for (String f : new String[] { "bag", "list", "set", "map" }) { Value x = fieldUp(o, f); if (x != null) return ser(x, depth, path); }
      return typeOnly(t, null);
    }
    // 스프링 테스트 요청 · 응답 (본문 · 상태만)
    if (t.equals("org.springframework.mock.web.MockHttpServletResponse")) {
      return "{\"t\":\"MockHttpServletResponse\",\"f\":{\"status\":" + intField(o, "status") + ",\"contentType\":" + str(field(o, "contentType")) + ",\"body\":" + q(bytesOut((ObjectReference) field(o, "content"))) + "}}";
    }
    if (t.equals("org.springframework.mock.web.MockHttpServletRequest")) {
      Value c = field(o, "content");
      return "{\"t\":\"MockHttpServletRequest\",\"f\":{\"method\":" + str(field(o, "method")) + ",\"uri\":" + str(field(o, "requestURI")) + ",\"query\":" + str(field(o, "queryString")) + ",\"body\":" + q(c instanceof ArrayReference ? bytes((ArrayReference) c, -1) : "") + "}}";
    }
    if (t.equals("org.springframework.test.web.servlet.DefaultMvcResult")) {
      return "{\"t\":\"MvcResult\",\"f\":{\"request\":" + ser(field(o, "mockRequest"), depth + 1, path) + ",\"response\":" + ser(field(o, "mockResponse"), depth + 1, path) + "}}";
    }
    if (t.equals("org.springframework.test.web.servlet.MockMvc$1")) { // perform 결과(ResultActions)
      for (Field f : o.referenceType().allFields()) if (f.name().startsWith("val$")) { Value x = o.getValue(f); if (x instanceof ObjectReference && ((ObjectReference) x).referenceType().name().endsWith("DefaultMvcResult")) return ser(x, depth, path); }
    }
    if (t.equals("org.springframework.http.ResponseEntity")) {
      Value st = fieldUp(o, "status");
      String code = st instanceof IntegerValue ? st.toString() : st instanceof ObjectReference ? num(fieldUp((ObjectReference) st, "value")) : "null";
      if (st instanceof ObjectReference && code.equals("null")) { Value v = fieldUp((ObjectReference) st, "value"); code = v instanceof PrimitiveValue ? v.toString() : "null"; }
      return "{\"t\":\"ResponseEntity\",\"f\":{\"status\":" + code + ",\"body\":" + ser(fieldUp(o, "body"), depth + 1, path) + "}}";
    }
    return null;
  }

  static String listOf(String t, int n, List<Value> items, int depth, Set<Long> path, long id) {
    if (depth >= MAX_DEPTH) return "{\"t\":" + q(t) + ",\"n\":" + n + ",\"ref\":" + id + "}";
    return seq(t, n, items, depth, path, id);
  }

  /** 맵 항목 (HashMap · LinkedHashMap · TreeMap · ConcurrentHashMap · 불변 맵), 최대 MAX_ITEMS */
  static List<Value[]> mapEntries(ObjectReference m) {
    List<Value[]> out = new ArrayList<>();
    if (m == null) return out;
    String t = m.referenceType().name();
    if (t.equals("java.util.LinkedHashMap")) {
      for (ObjectReference e = (ObjectReference) field(m, "head"); e != null && out.size() < MAX_ITEMS; e = (ObjectReference) field(e, "after")) out.add(new Value[] { fieldUp(e, "key"), fieldUp(e, "value") });
      return out;
    }
    if (t.equals("java.util.TreeMap")) { inorder((ObjectReference) field(m, "root"), out); return out; }
    if (t.equals("java.util.ImmutableCollections$Map1")) { out.add(new Value[] { field(m, "k0"), field(m, "v0") }); return out; }
    if (t.equals("java.util.ImmutableCollections$MapN")) {
      ArrayReference a = (ArrayReference) field(m, "table");
      if (a != null) { List<Value> xs = a.getValues(); for (int i = 0; i + 1 < xs.size() && out.size() < MAX_ITEMS; i += 2) if (xs.get(i) != null) out.add(new Value[] { xs.get(i), xs.get(i + 1) }); }
      return out;
    }
    ArrayReference tab = (ArrayReference) field(m, "table");
    if (tab == null) return out;
    for (Value b : tab.getValues()) {
      for (ObjectReference e = (ObjectReference) b; e != null && out.size() < MAX_ITEMS; ) {
        if (e.referenceType().name().endsWith("TreeNode") || field(e, "key") != null || field(e, "val") != null) {
          Value k = fieldUp(e, "key"), v = fieldUp(e, "value");
          if (v == null) v = fieldUp(e, "val");
          out.add(new Value[] { k, v });
        }
        Value nx = fieldUp(e, "next");
        e = nx instanceof ObjectReference ? (ObjectReference) nx : null;
      }
      if (out.size() >= MAX_ITEMS) break;
    }
    return out;
  }

  static void inorder(ObjectReference n, List<Value[]> out) {
    if (n == null || out.size() >= MAX_ITEMS) return;
    inorder((ObjectReference) field(n, "left"), out);
    if (out.size() < MAX_ITEMS) out.add(new Value[] { field(n, "key"), field(n, "value") });
    inorder((ObjectReference) field(n, "right"), out);
  }

  /** List 의 앞쪽 항목 (ArrayList · 불변 목록 · 기타는 elementData/elements) */
  static List<Value> listItems(Value v, int max) {
    List<Value> out = new ArrayList<>();
    if (!(v instanceof ObjectReference)) return out;
    ObjectReference o = (ObjectReference) v;
    String t = o.referenceType().name();
    if (o instanceof ArrayReference) { ArrayReference a = (ArrayReference) o; return a.getValues(0, Math.min(a.length(), max)); }
    if (t.startsWith("java.util.Collections$Unmodifiable") || t.startsWith("java.util.Collections$Synchronized")) return listItems(fieldUp(o, "list") != null ? fieldUp(o, "list") : fieldUp(o, "c"), max);
    if (t.equals("java.util.Collections$SingletonList")) { out.add(field(o, "element")); return out; }
    if (t.equals("java.util.ImmutableCollections$List12")) { out.add(field(o, "e0")); Value b = field(o, "e1"); if (b != null && !(b instanceof ObjectReference && ((ObjectReference) b).referenceType().name().equals("java.lang.Object"))) out.add(b); return out; }
    Value arr = field(o, "elementData");
    int n = arr != null ? intField(o, "size") : -1;
    if (arr == null) arr = field(o, "elements");
    if (arr == null) arr = field(o, "a");
    if (arr instanceof ArrayReference) { ArrayReference a = (ArrayReference) arr; int len = n >= 0 ? n : a.length(); return a.getValues(0, Math.min(len, max)); }
    return out;
  }

  static BigInteger bigInt(ObjectReference o) {
    if (o == null) return null;
    int signum = intField(o, "signum");
    ArrayReference mag = (ArrayReference) field(o, "mag");
    if (mag == null) return null;
    byte[] bs = new byte[mag.length() * 4];
    List<Value> xs = mag.getValues();
    for (int i = 0; i < xs.size(); i++) { int x = ((IntegerValue) xs.get(i)).value(); bs[i * 4] = (byte) (x >>> 24); bs[i * 4 + 1] = (byte) (x >>> 16); bs[i * 4 + 2] = (byte) (x >>> 8); bs[i * 4 + 3] = (byte) x; }
    return new BigInteger(signum == 0 ? 1 : signum, bs).multiply(signum == 0 ? BigInteger.ZERO : BigInteger.ONE);
  }

  static String date(ObjectReference o) { return o == null ? "?" : String.format("%04d-%02d-%02d", intField(o, "year"), intField(o, "month"), intField(o, "day")); }
  static String time(ObjectReference o) {
    if (o == null) return "?";
    int nano = intField(o, "nano");
    return String.format("%02d:%02d:%02d", intField(o, "hour"), intField(o, "minute"), intField(o, "second")) + (nano > 0 ? String.format(".%03d", nano / 1000000) : "");
  }

  static String bytesOut(ObjectReference baos) {
    if (baos == null) return "";
    Value buf = fieldUp(baos, "buf");
    return buf instanceof ArrayReference ? bytes((ArrayReference) buf, intField(baos, "count")) : "";
  }

  static String bytes(ArrayReference a, int count) {
    int n = count < 0 ? a.length() : Math.min(count, a.length());
    n = Math.min(n, 20000);
    byte[] bs = new byte[n];
    List<Value> xs = n == 0 ? List.of() : a.getValues(0, n);
    for (int i = 0; i < n; i++) bs[i] = ((ByteValue) xs.get(i)).value();
    String s = new String(bs, StandardCharsets.UTF_8);
    return s.length() > 4000 ? s.substring(0, 4000) + "…(" + s.length() + "자)" : s;
  }

  // ── 쓰기 ──
  static void write() {
    if (written) return;
    written = true;
    StringBuilder b = new StringBuilder();
    b.append("{\"version\":1,\"lang\":\"java\",\"mode\":").append(q(mode));
    b.append(",\"entry\":").append(entryClass == null ? "null" : q(entryClass + (entryMethod == null ? "" : "#" + entryMethod)));
    b.append(",\"include\":[");
    for (int i = 0; i < include.size(); i++) { if (i > 0) b.append(','); b.append(q(include.get(i))); }
    b.append("],\"startedAt\":").append(startedAt).append(",\"endedAt\":").append(endedAt == 0 ? now() : endedAt);
    b.append(",\"truncated\":").append(truncated).append(",\"maxHits\":").append(maxHits);
    b.append(",\"notes\":[");
    for (int i = 0; i < notes.size(); i++) { if (i > 0) b.append(','); b.append(q(notes.get(i))); }
    b.append("],\"steps\":[\n");
    for (int i = 0; i < steps.size(); i++) {
      Step s = steps.get(i);
      if (i > 0) b.append(",\n");
      b.append("{\"i\":").append(i).append(",\"k\":").append(q(s.kind)).append(",\"c\":").append(s.call).append(",\"d\":").append(s.depth).append(",\"t\":").append(s.t);
      if (s.line > 0) b.append(",\"ln\":").append(s.line);
      if (s.cls != null) b.append(",\"cls\":").append(q(s.cls)).append(",\"m\":").append(q(s.method)).append(",\"src\":").append(q(s.src));
      if (s.isCall) b.append(",\"call\":true,\"p\":").append(s.parent).append(",\"site\":").append(s.site).append(",\"args\":").append(s.args == null ? "{}" : s.args);
      else if (s.site >= 0) b.append(",\"site\":").append(s.site);
      if (s.after != null && !s.after.isEmpty()) b.append(",\"after\":").append(obj(s.after));
      if (s.skipped > 0) b.append(",\"skipped\":").append(s.skipped);
      if (s.skippedCalls > 0) b.append(",\"skippedCalls\":").append(s.skippedCalls);
      if (s.kind.equals("return")) b.append(",\"ret\":").append(s.ret == null ? "\"(void)\"" : s.ret);
      if (s.extra != null) b.append(",\"x\":").append(s.extra);
      b.append('}');
    }
    b.append("\n]}\n");
    try { Files.writeString(Paths.get(outFile), b.toString(), StandardCharsets.UTF_8); } catch (IOException e) { System.err.println("기록 파일을 쓰지 못했습니다: " + e.getMessage()); }
  }
}
