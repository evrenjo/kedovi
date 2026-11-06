package __BASE_PACKAGE__.apiledger;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.yaml.snakeyaml.Yaml;

/**
 * 외부 API 시뮬레이터 (kedovi apiledger add java 가 넣음). 장부(api-ledger.yaml)를 읽어 API 마다 로컬 HTTP 서버를 띄운다.
 * 응답 칸: status · headers · body · delayMs(머리 전 지연) · stallBodyMs(본문 절반 뒤 멈춤) · reset(연결 끊기) · failTimes(앞 N 번만).
 * measured 동작은 observed(실제로 본 응답), unverified 는 worst(최악 응답). 의존성: SnakeYAML (Spring Boot 에 들어 있다).
 */
@SuppressWarnings("unchecked")
public final class ApiLedgerStub implements AutoCloseable {

  public static final List<String> FAULT_KINDS = List.of("rate-limit", "slow", "empty", "transient-404", "body-stall", "token-slow");

  public record Endpoint(String key, String api, Map<String, Object> ep, Pattern route) {}

  public record Case(String key, String endpoint, String kind, String status, String what, Map<String, Object> response, String from) {}

  private final Map<String, Object> ledger;
  private final List<Endpoint> endpoints = new ArrayList<>();
  private final Map<String, Map<String, Object>> responses = new ConcurrentHashMap<>();
  private final Map<String, Integer> used = new ConcurrentHashMap<>();
  private final Map<String, Integer> calls = new ConcurrentHashMap<>();
  private final Map<String, String> urls = new LinkedHashMap<>();
  private final List<HttpServer> servers = new ArrayList<>();
  private final List<java.util.concurrent.ExecutorService> pools = new ArrayList<>();

  public static Path ledgerPath() {
    return Path.of(System.getProperty("apiLedger", System.getenv().getOrDefault("API_LEDGER", "api-ledger.yaml")));
  }

  public static Map<String, Object> load() throws IOException {
    try (InputStream in = Files.newInputStream(ledgerPath())) {
      return new Yaml().load(in);
    }
  }

  public static List<Endpoint> endpoints(Map<String, Object> ledger) {
    List<Endpoint> out = new ArrayList<>();
    for (Map<String, Object> api : (List<Map<String, Object>>) ledger.getOrDefault("apis", List.of())) {
      for (Map<String, Object> ep : (List<Map<String, Object>>) api.getOrDefault("endpoints", List.of())) {
        String regex = "^" + String.join("[^/]+", java.util.Arrays.stream(String.valueOf(ep.get("path")).split("\\{[^}]+\\}", -1)).map(Pattern::quote).toList()) + "$";
        out.add(new Endpoint(api.get("id") + "/" + ep.get("id"), String.valueOf(api.get("id")), ep, Pattern.compile(regex)));
      }
    }
    return out;
  }

  private static List<Map<String, Object>> behaviors(Map<String, Object> ep) {
    return (List<Map<String, Object>>) ep.getOrDefault("behaviors", List.of());
  }

  /** 시험 안 최소 형식 검사 (확인일이 오래된 것은 kedovi apiledger check 가 본다) */
  public static List<String> problems(Map<String, Object> ledger) {
    List<String> out = new ArrayList<>();
    if (!Integer.valueOf(1).equals(ledger.get("version"))) out.add("version: 1 이 없다");
    for (Endpoint e : endpoints(ledger)) {
      for (Map<String, Object> b : behaviors(e.ep())) {
        String k = e.key() + "/" + b.get("id");
        Object st = b.get("status");
        if (!"measured".equals(st) && !"unverified".equals(st)) out.add(k + ": status 는 measured · unverified");
        else if ("measured".equals(st) && (b.get("checked") == null || b.get("evidence") == null || b.get("observed") == null)) out.add(k + ": measured 는 checked · evidence · observed 가 있어야 한다");
        else if ("unverified".equals(st) && b.get("worst") == null) out.add(k + ": unverified 는 worst 가 있어야 한다");
      }
    }
    return out;
  }

  public static List<Case> scenarios(Map<String, Object> ledger) {
    List<Case> out = new ArrayList<>();
    for (Endpoint e : endpoints(ledger)) {
      for (Map<String, Object> b : behaviors(e.ep())) {
        boolean measured = "measured".equals(b.get("status"));
        Object r = measured ? first(b.get("observed"), b.get("worst")) : first(b.get("worst"), b.get("observed"));
        out.add(new Case(e.key() + "/" + b.get("id"), e.key(), String.valueOf(b.getOrDefault("kind", "")), String.valueOf(b.get("status")), String.valueOf(b.getOrDefault("what", "")), r == null ? Map.of() : (Map<String, Object>) r, ""));
      }
    }
    return out;
  }

  public static List<Case> faults(Map<String, Object> ledger) {
    List<Case> out = new ArrayList<>();
    for (Endpoint e : endpoints(ledger)) {
      int t = timeoutMs(e.ep());
      Object okBody = ((Map<String, Object>) e.ep().getOrDefault("ok", Map.of())).getOrDefault("body", "{}");
      Map<String, Map<String, Object>> defaults = Map.of(
          "rate-limit", Map.<String, Object>of("status", 429),
          "slow", Map.<String, Object>of("delayMs", t * 2),
          "empty", Map.<String, Object>of("status", 200, "body", ""),
          "transient-404", Map.<String, Object>of("status", 404, "failTimes", 1),
          "body-stall", Map.<String, Object>of("status", 200, "body", okBody, "stallBodyMs", t * 2),
          "token-slow", Map.<String, Object>of("delayMs", Math.round(t * 0.9)));
      for (String kind : FAULT_KINDS) {
        if (kind.equals("token-slow") && !"token".equals(e.ep().get("auth"))) continue;
        Map<String, Object> b = behaviors(e.ep()).stream().filter(x -> kind.equals(x.get("kind"))).findFirst().orElse(null);
        Map<String, Object> r = b != null ? (Map<String, Object>) first(b.get("worst"), b.get("observed")) : defaults.get(kind);
        out.add(new Case(e.key() + "#" + kind, e.key(), kind, "", "", r, b != null ? e.key() + "/" + b.get("id") : "기본값"));
      }
    }
    return out;
  }

  public static int timeoutMs(Map<String, Object> ep) {
    Object t = ep.get("timeoutMs");
    return t instanceof Number n ? n.intValue() : 5000;
  }

  private static Object first(Object a, Object b) {
    return a != null ? a : b;
  }

  public ApiLedgerStub(Map<String, Object> ledger) throws IOException {
    this.ledger = ledger;
    endpoints.addAll(endpoints(ledger));
    reset();
    for (String api : endpoints.stream().map(Endpoint::api).distinct().toList()) {
      HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
      var pool = Executors.newCachedThreadPool(r -> {
        Thread th = new Thread(r, "api-ledger-stub");
        th.setDaemon(true);
        return th;
      });
      pools.add(pool);
      server.setExecutor(pool);
      server.createContext("/", ex -> handle(api, ex));
      server.start();
      urls.put(api, "http://127.0.0.1:" + server.getAddress().getPort());
      servers.add(server);
    }
  }

  public Map<String, String> urls() {
    return urls;
  }

  public Map<String, Object> ledger() {
    return ledger;
  }

  public void reset() {
    responses.clear();
    for (Endpoint e : endpoints) {
      used.put(e.key(), 0);
      calls.put(e.key(), 0);
    }
  }

  public void use(String key, Map<String, Object> response) {
    if (!calls.containsKey(key)) throw new IllegalArgumentException("장부에 없는 엔드포인트: " + key);
    responses.put(key, response);
    used.put(key, 0);
  }

  public int calls(String key) {
    return calls.getOrDefault(key, 0);
  }

  private void handle(String api, HttpExchange ex) throws IOException {
    String url = ex.getRequestURI().getPath();
    Endpoint e = endpoints.stream().filter(x -> x.api().equals(api) && x.route().matcher(url).matches()
        && (x.ep().get("method") == null || ex.getRequestMethod().equals(x.ep().get("method")))).findFirst().orElse(null);
    if (e == null) {
      ex.sendResponseHeaders(599, -1);
      ex.close();
      return;
    }
    calls.merge(e.key(), 1, Integer::sum);
    Map<String, Object> ok = (Map<String, Object>) e.ep().getOrDefault("ok", Map.of());
    Map<String, Object> r = responses.get(e.key());
    if (r != null && r.get("failTimes") instanceof Number n && used.get(e.key()) >= n.intValue()) r = null;
    if (r != null) used.merge(e.key(), 1, Integer::sum);
    reply(ex, r != null ? r : ok, ok);
  }

  private static void reply(HttpExchange ex, Map<String, Object> r, Map<String, Object> ok) throws IOException {
    try {
      if (r.get("delayMs") instanceof Number d) Thread.sleep(d.longValue());
      if (Boolean.TRUE.equals(r.get("reset"))) {
        ex.close();
        return;
      }
      int status = r.get("status") instanceof Number s ? s.intValue() : 200;
      Object body = r.get("body");
      if (body == null) body = status != (ok.get("status") instanceof Number s ? s.intValue() : 200) ? "" : ok.getOrDefault("body", "");
      byte[] bytes = String.valueOf(body).getBytes(StandardCharsets.UTF_8);
      ex.getResponseHeaders().add("content-type", "application/json");
      ((Map<String, Object>) r.getOrDefault("headers", Map.of())).forEach((k, v) -> ex.getResponseHeaders().add(k, String.valueOf(v)));
      if (r.get("stallBodyMs") instanceof Number stall) {
        if (bytes.length == 0) bytes = "{\"stalled\":true}".getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(status, bytes.length);
        OutputStream out = ex.getResponseBody();
        out.write(bytes, 0, bytes.length / 2);
        out.flush();
        Thread.sleep(stall.longValue());
        out.write(bytes, bytes.length / 2, bytes.length - bytes.length / 2);
        out.close();
        return;
      }
      ex.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
      if (bytes.length > 0) ex.getResponseBody().write(bytes);
    } catch (InterruptedException ie) {
      Thread.currentThread().interrupt();
    } catch (IOException closedByClient) {
      // 클라이언트가 시간 초과로 끊은 경우
    } finally {
      ex.close();
    }
  }

  /** 시험이 다룬 항목을 .api-ledger/covered.json 에 남긴다 (kedovi apiledger check 가 장부와 대조) */
  public static synchronized void writeCovered(String part, List<String> keys) throws IOException {
    Path file = Path.of(".api-ledger", "covered.json");
    Map<String, List<String>> cur = new LinkedHashMap<>();
    if (Files.exists(file)) {
      Object old = new Yaml().load(Files.readString(file));
      if (old instanceof Map<?, ?> m) m.forEach((k, v) -> { if (v instanceof List<?> l) cur.put(String.valueOf(k), (List<String>) l); });
    }
    cur.put(part, new ArrayList<>(new TreeSet<>(keys)));
    StringBuilder sb = new StringBuilder("{\n");
    for (var en : cur.entrySet()) {
      sb.append("  \"").append(en.getKey()).append("\": [");
      sb.append(String.join(", ", en.getValue().stream().map(k -> "\"" + k.replace("\"", "\\\"") + "\"").toList()));
      sb.append("],\n");
    }
    sb.append("  \"at\": \"").append(Instant.now()).append("\"\n}\n");
    Files.createDirectories(file.getParent());
    Files.writeString(file, sb.toString());
  }

  @Override
  public void close() {
    servers.forEach(s -> s.stop(0));
    pools.forEach(java.util.concurrent.ExecutorService::shutdownNow);
  }
}
