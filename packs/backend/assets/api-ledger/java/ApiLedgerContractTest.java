package __BASE_PACKAGE__.apiledger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/** 장부 대조 시험 (kedovi apiledger add java 가 넣음): 장부의 동작마다 measured → observed, unverified → worst 로 응답하고 기대를 돌린다 */
class ApiLedgerContractTest {

  static Map<String, Object> ledger;
  static ApiLedgerStub stub;
  static final List<String> covered = new ArrayList<>();

  @BeforeAll
  static void start() throws Exception {
    ledger = ApiLedgerStub.load();
    stub = new ApiLedgerStub(ledger);
  }

  @AfterAll
  static void stop() throws Exception {
    stub.close();
    ApiLedgerStub.writeCovered("behaviors", covered);
  }

  @Test
  void ledgerFormat() {
    assertEquals(List.of(), ApiLedgerStub.problems(ledger));
  }

  @TestFactory
  Stream<DynamicTest> behaviors() {
    return ApiLedgerStub.scenarios(ledger).stream().map(s -> DynamicTest.dynamicTest(s.key() + " (" + s.status() + ") " + s.what(), () -> {
      ApiLedgerExpectations.Behavior fn = ApiLedgerExpectations.BEHAVIORS.get(s.key());
      assertNotNull(fn, "장부 동작 " + s.key() + " 의 기대가 ApiLedgerExpectations.BEHAVIORS 에 없다");
      stub.reset();
      stub.use(s.endpoint(), s.response());
      fn.check(ApiLedgerExpectations.CLIENT.apply(stub.urls()), stub);
      covered.add(s.key());
    }));
  }
}
