# 외부 API 동작 장부 형식

repo 의 `api-ledger.yaml` (위치는 `vars.apiLedger.path`). 검사 `kedovi apiledger check`, 사람용 설명은 킷 문서 「운영 검증」.
YAML 은 블록 맵 · 목록 · 흐름 `{ }` `[ ]` · 따옴표 · 블록 글 `|` 만 쓴다 (앵커 · 태그 · 여러 문서 없음).

## 최상위

| 칸 | 필수 | 뜻 |
|---|---|---|
| `version` | 예 | `1` |
| `staleDays` | 아니오 | 확인일이 이보다 오래되면 재확인 목록 (기본 `vars.apiLedger.staleDays`, 30) |
| `apis` | 예 | 외부 API 목록 |

## API · 엔드포인트

| 칸 | 필수 | 뜻 |
|---|---|---|
| `apis[].id` | 예 | API 이름. 시뮬레이터는 API 마다 서버 하나 (`urls.<id>`) |
| `endpoints[].id` | 예 | 엔드포인트 · TR 이름 (API 안에서 겹치지 않게) |
| `method` · `path` | path 예 | `path` 의 `{이름}` 은 아무 한 마디와 맞는다 |
| `timeoutMs` | 경고 | 이 엔드포인트 클라이언트 timeout. 공용 기본값 대신 |
| `p99Ms` · `p99Checked` · `p99Evidence` | 경고 | 실측 p99 지연 · 확인일 · 근거 (`p99Ms` 를 쓰면 나머지 둘 필수). `timeoutMs < p99Ms` 면 경고 |
| `auth: token` | 아니오 | 토큰 발급 엔드포인트 (실패 주입에 `token-slow` 가 붙는다) |
| `ok` | 아니오 | 정상 응답 (시나리오가 없을 때 · `failTimes` 를 다 쓴 뒤) |
| `behaviors` | 아니오 | 동작 목록 |

## 동작

| 칸 | 필수 | 뜻 |
|---|---|---|
| `id` · `what` | 예 | 이름 · 한 줄 설명 |
| `kind` | 아니오 | `rate-limit` · `slow` · `empty` · `transient-404` · `body-stall` · `token-slow` (실패 주입 재료) · `order` · `shape` · `other` |
| `status` | 예 | `measured`(실측) · `unverified`(미확인) |
| `checked` · `evidence` · `observed` | measured 면 예 | 확인일(YYYY-MM-DD) · 근거(로그 위치 · 문서 절 · 실측 명령) · 실제로 본 응답 |
| `worst` | unverified 면 예 | 최악 응답 |

시뮬레이터: `measured` → `observed`, `unverified` → `worst`. 실패 주입: 같은 `kind` 동작의 `worst`(없으면 `observed`), 없으면 기본 최악값.

## 응답

| 칸 | 뜻 |
|---|---|
| `status` | HTTP 상태 (기본 200) |
| `headers` | 응답 머리 맵 |
| `body` | 본문 (글 그대로, 맵 · 목록이면 JSON). 상태가 `ok` 와 다르고 비어 있으면 빈 본문 |
| `delayMs` | 응답 머리 전 지연 |
| `stallBodyMs` | 머리와 본문 절반을 보낸 뒤 멈춤 (본문 읽기 중 timeout) |
| `reset` | 응답 없이 연결 끊기 |
| `failTimes` | 앞 N 번만 이 응답, 그 뒤는 `ok` (일시 오류) |

## 시험 기록

대조 시험 · 실패 주입이 `<repo>/.api-ledger/covered.json` 에 다룬 항목을 남긴다 (커밋하지 않는다).

```json
{ "behaviors": ["<api>/<엔드포인트>/<동작>"], "faults": ["<api>/<엔드포인트>#<종류>"], "at": "ISO 시각" }
```

`kedovi apiledger check` 가 장부와 대조한다: 시험이 안 다룬 동작 · 안 돈 실패 주입 · 장부에 없는 기록 · 장부가 시험 뒤에 바뀜.
