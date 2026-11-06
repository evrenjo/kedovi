package __BASE_PACKAGE__.apiledger;

import java.util.Map;
import java.util.function.Function;

/**
 * 장부 대조 · 실패 주입 시험이 부르는 프로젝트 쪽 연결 (kedovi apiledger add java 가 넣음. 프로젝트가 채운다).
 *
 * client(urls)        : 시뮬레이터 주소로 프로젝트의 외부 API 클라이언트를 만든다
 * CALLS[엔드포인트]   : 그 엔드포인트를 부르는 프로젝트 코드 한 번 (실패 주입이 쓴다)
 * BEHAVIORS[동작]     : 장부 동작마다 기대. measured 는 그 응답에 기대는 동작을, unverified 는 최악 응답을 견디는지 단언
 * handled(err)        : 프로젝트가 처리한 오류인가 (분류된 예외 → true, 예상 못 한 예외 → false)
 * BUDGET_MS[엔드포인트] : 재시도까지 포함한 총 허용 시간 (없으면 timeoutMs × 3)
 *
 * 장부에 있는데 여기 없는 동작 · 엔드포인트는 시험이 실패한다.
 */
final class ApiLedgerExpectations {

  interface Call {
    void run(Object client) throws Exception;
  }

  interface Behavior {
    void check(Object client, ApiLedgerStub stub) throws Exception;
  }

  /** 예: urls -> new PartnerClient(urls.get("partner")) */
  static final Function<Map<String, String>, Object> CLIENT = urls -> urls;

  static final Map<String, Call> CALLS = Map.of(
      // "partner/items", c -> ((PartnerClient) c).getItem("A1")
  );

  static final Map<String, Behavior> BEHAVIORS = Map.of(
      // measured: "partner/items/rate-limit", (c, stub) -> assertThrows(RateLimitedException.class, ...)
      // unverified: "partner/items/empty-after-hours", (c, stub) -> 빈 본문을 처리된 예외 · 빈 결과로
  );

  static boolean handled(Throwable err) {
    // 예: return err instanceof PartnerApiException;
    return false;
  }

  static final Map<String, Integer> BUDGET_MS = Map.of();

  private ApiLedgerExpectations() {}
}
