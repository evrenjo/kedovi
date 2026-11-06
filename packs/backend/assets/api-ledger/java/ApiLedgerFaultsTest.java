package __BASE_PACKAGE__.apiledger;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.TestFactory;

/**
 * 실패 주입 세트 (kedovi apiledger add java 가 넣음): 429 · 지연 · 빈 응답 · 일시 404 · 본문 멈춤 · 토큰 지연.
 * 일반 test 에서는 빼고(excludeTags "faults") CI 전용 작업에서 돈다. 단언: 예산 안에 끝난다 · 오류면 처리된 오류다 · 토큰은 한 번만.
 */
@Tag("faults")
class ApiLedgerFaultsTest {

  static Map<String, Object> ledger;
  static ApiLedgerStub stub;
  static final List<String> done = new ArrayList<>();

  @BeforeAll
  static void start() throws Exception {
    ledger = ApiLedgerStub.load();
    stub = new ApiLedgerStub(ledger);
  }

  @AfterAll
  static void stop() throws Exception {
    stub.close();
    ApiLedgerStub.writeCovered("faults", done);
  }

  @TestFactory
  Stream<DynamicTest> faults() {
    var eps = ApiLedgerStub.endpoints(ledger);
    return ApiLedgerStub.faults(ledger).stream().map(f -> DynamicTest.dynamicTest(f.key() + " (" + f.from() + ")", () -> {
      ApiLedgerExpectations.Call call = ApiLedgerExpectations.CALLS.get(f.endpoint());
      assertNotNull(call, "ApiLedgerExpectations.CALLS 에 " + f.endpoint() + " 가 없다");
      var ep = eps.stream().filter(e -> e.key().equals(f.endpoint())).findFirst().orElseThrow().ep();
      int budget = ApiLedgerExpectations.BUDGET_MS.getOrDefault(f.endpoint(), ApiLedgerStub.timeoutMs(ep) * 3);
      stub.reset();
      stub.use(f.endpoint(), f.response());
      Object client = ApiLedgerExpectations.CLIENT.apply(stub.urls());
      int n = f.kind().equals("token-slow") ? 5 : 1;
      ExecutorService pool = Executors.newFixedThreadPool(n);
      try {
        List<Future<?>> futs = new ArrayList<>();
        for (int i = 0; i < n; i++) futs.add(pool.submit(() -> { call.run(client); return null; }));
        for (Future<?> fu : futs) {
          try {
            fu.get(budget + 500L, TimeUnit.MILLISECONDS);
          } catch (TimeoutException te) {
            fail(budget + "ms 예산 안에 끝나지 않았다");
          } catch (ExecutionException ee) {
            assertTrue(ApiLedgerExpectations.handled(ee.getCause()), "처리되지 않은 오류: " + ee.getCause());
          }
        }
      } finally {
        pool.shutdownNow();
      }
      if (f.kind().equals("token-slow")) assertTrue(stub.calls(f.endpoint()) <= 1, "토큰을 " + stub.calls(f.endpoint()) + "번 받았다 (동시 갱신은 한 번으로)");
      done.add(f.key());
    }));
  }
}
