"""장부 대조 시험 · 실패 주입 세트 (kedovi apiledger add python 이 넣음).

일반 시험: pytest -m "not faults"   (장부 동작마다 measured → observed, unverified → worst 로 응답하고 기대를 돌린다)
실패 주입: pytest -m faults         (CI 전용 작업. 429 · 지연 · 빈 응답 · 일시 404 · 본문 멈춤 · 토큰 지연)
pytest 설정에 markers = faults 를 등록한다.
"""
import concurrent.futures as cf
import time

import pytest

import api_ledger_expectations as X
from api_ledger_stub import Stub, faults, load_ledger, problems, scenarios, write_covered

LEDGER = load_ledger()
EPS = {f"{a['id']}/{e['id']}": e for a in LEDGER["apis"] for e in a["endpoints"]}
_covered: list[str] = []
_faults: list[str] = []


@pytest.fixture(scope="module")
def stub():
    with Stub(LEDGER) as s:
        yield s
    if _covered:
        write_covered("behaviors", _covered)
    if _faults:
        write_covered("faults", _faults)


def test_ledger_format():
    assert problems(LEDGER) == []


@pytest.mark.parametrize("s", scenarios(LEDGER), ids=lambda s: s["key"])
def test_behavior(stub, s):
    fn = X.BEHAVIORS.get(s["key"])
    assert fn, f"장부 동작 {s['key']} 의 기대가 api_ledger_expectations.BEHAVIORS 에 없다"
    stub.reset()
    stub.use(s["endpoint"], s["response"])
    fn(X.client(stub.urls), stub)
    _covered.append(s["key"])


@pytest.mark.faults
@pytest.mark.parametrize("f", faults(LEDGER), ids=lambda f: f["key"])
def test_fault(stub, f):
    call = X.CALLS.get(f["endpoint"])
    assert call, f"api_ledger_expectations.CALLS 에 {f['endpoint']} 가 없다"
    budget = X.BUDGET_MS.get(f["endpoint"]) or (EPS[f["endpoint"]].get("timeoutMs") or 5000) * 3
    stub.reset()
    stub.use(f["endpoint"], f["response"])
    c = X.client(stub.urls)
    n = 5 if f["kind"] == "token-slow" else 1
    t0 = time.monotonic()
    with cf.ThreadPoolExecutor(n) as pool:
        futs = [pool.submit(call, c) for _ in range(n)]
        for fut in futs:
            try:
                fut.result(timeout=(budget + 500) / 1000)
            except cf.TimeoutError:
                pytest.fail(f"{budget}ms 예산 안에 끝나지 않았다")
            except Exception as e:  # noqa: BLE001 처리된 오류인지 본다
                assert X.handled(e), f"처리되지 않은 오류: {e!r}"
    assert (time.monotonic() - t0) * 1000 <= budget + 500
    if f["kind"] == "token-slow":
        assert stub.calls(f["endpoint"]) <= 1, "토큰을 여러 번 받았다 (동시 갱신은 한 번으로)"
    _faults.append(f["key"])
