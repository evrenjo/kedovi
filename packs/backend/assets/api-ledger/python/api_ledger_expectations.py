"""장부 대조 · 실패 주입 시험이 부르는 프로젝트 쪽 연결 (kedovi apiledger add python 이 넣음. 프로젝트가 채운다).

client(urls)        : 시뮬레이터 주소로 프로젝트의 외부 API 클라이언트를 만든다
CALLS[엔드포인트]   : 그 엔드포인트를 부르는 프로젝트 코드 한 번 (실패 주입이 쓴다)
BEHAVIORS[동작]     : 장부 동작마다 기대. measured 는 그 응답에 기대는 동작을, unverified 는 최악 응답을 견디는지 단언
handled(err)        : 프로젝트가 처리한 오류인가 (분류된 오류 → True, 예상 못 한 예외 → False)
BUDGET_MS[엔드포인트] : 재시도까지 포함한 총 허용 시간 (없으면 timeoutMs × 3)

장부에 있는데 여기 없는 동작 · 엔드포인트는 시험이 실패한다.
"""


def client(urls: dict):
    # 예: return PartnerClient(base_url=urls["partner"])
    return urls


CALLS = {
    # "partner/items": lambda c: c.get_item("A1"),
}

BEHAVIORS = {
    # "partner/items/rate-limit": lambda c, stub: ...,  # measured: Retry-After 를 읽어 RateLimited(retry_after=1) 로
    # "partner/items/empty-after-hours": lambda c, stub: ...,  # unverified: 빈 본문을 처리된 오류 · 빈 결과로
}


def handled(err: BaseException) -> bool:
    # 예: return isinstance(err, PartnerError)
    return False


BUDGET_MS: dict = {}
