# 모델 카탈로그 관리

역할별 추천 모델은 `packs/core/models.json` 한 곳에 있다. 선택 화면, 에이전트 파일, 팀 에이전트와 모델 · 흐름도의 추천 표가 모두 이 파일에서 나온다.
새 모델이나 퇴역 공지가 나오면 아래 순서로 조사하고, 추천을 바꿀지 판단해서 이 파일만 고친다.

## 언제 하나

- 두 회사가 새 모델을 내거나 퇴역을 공지했을 때
- `npm test`(또는 `npm run models`)가 "카탈로그 확인일에서 N일 지났습니다"라고 경고할 때. 기준은 `reviewEveryDays`(45일)
- 퇴역 임박 경고가 뜰 때 (30일 전부터)

## 주간 점검 (자동)

킷 repo 의 GitLab 예약 파이프라인(`watch-models`, 주 1회)이 `node bin/models.js watch --notify` 를 돈다. 아래를 찾으면 관리자 텔레그램(CI 변수 `TELEGRAM_BOT_TOKEN` · `TELEGRAM_CHAT_ID`)으로 알린다. 반영은 사람이 아래 절차로 한다.

| 찾는 것 | 방법 |
|---|---|
| 카탈로그 · 요금제 확인일이 오래됨 · 퇴역 임박 | `check` 의 경고 |
| 새 모델 | LiveBench 에 카탈로그에 없는 Claude · GPT 모델 |
| 요금제 변경 | 공식 요금제 페이지의 요금제 이름 낱말이 기준(`plans.watch`)과 다름. 페이지를 못 받으면 "확인 못 함" |

## 1. 조사

공식 출처로 확인한 것만 넣는다.

| 항목 | 어디서 | 넣는 곳 |
|---|---|---|
| 모델 ID·별칭 | Claude: code.claude.com/docs/en/model-config · Codex: learn.chatgpt.com/docs/models | `tools.<도구>[].id` |
| 가격 (API 1M 토큰 입력·출력) | platform.claude.com/docs/en/about-claude/pricing · developers.openai.com/api/docs/pricing | `hint` 의 `API $입력·$출력` |
| 요금제별 제공 여부 | Claude 도움말(요금제별 모델) · learn.chatgpt.com/docs/pricing | 이 문서 "근거" 표 |
| 벤더 권장 용도 | 위 모델 페이지, 서브에이전트 문서(code.claude.com/docs/en/sub-agents · learn.chatgpt.com/docs/agent-configuration/subagents) | 이 문서 "근거" 표 |
| 벤치마크 (독립, 우선) | **LiveBench**: `npm run models:livebench` 가 최신 문제 세트 CSV 를 받아 계산한다 (브라우저 불필요) | `tools.<도구>[].bench`, 이름 연결은 `livebench` |
| 벤치마크 (벤더) | 벤더 발표·모델 카드 (Terminal-Bench, DeepSWE, SWE-bench 등) | `tools.<도구>[].bench` (`name` · `score` · `setting` · `source`) |
| 추론 강도(effort) 허용값 | 위 모델 설정 문서 | 프로필의 `effort` |
| 퇴역일·대체 모델 | 두 회사의 모델·퇴역 공지 | `retired` (`source` 필수. 공지에 날짜 없이 이미 빠졌으면 `retiresAt` 을 비우고 `note` 에 까닭) |

- 모델마다 `checked`(확인일)와 `sources`(공식 URL)를 남긴다. `npm run models` 가 없으면 실패시킨다.
- **LiveBench 를 먼저 본다.** 같은 문제·같은 조건으로 두 회사 모델을 함께 재고, 문제를 계속 바꿔 학습 오염이 적고, 문항당 비용도 준다. 벤더 발표 수치는 측정 환경이 서로 달라 보조 근거로만 쓴다.
  `npm run models:livebench` 는 카탈로그 모델 점수와 **카탈로그에 없는 새 Claude·GPT 모델**을 보여 준다. 검토하고 넣지 않기로 한 이름은 `livebenchReviewed` 에 적어 다음부터 안 뜨게 한다.
- 벤치마크는 **본 페이지·데이터 파일의 숫자만** 넣는다. 추정하지 않는다. 벤더 자체 측정인지 독립 측정인지, 실행 조건(effort·하네스)을 `setting` 에 적는다.
- 새 모델은 **실제 CLI 로 한 번 돌려 본다**: `claude -p --model <id> "ok"`, `codex exec -m <id> "ok"`. CLI 가 아직 모르는 모델이면 경고가 나온다(예: 2026-09-30 Codex 0.159 는 `gpt-6.1-sol` 메타데이터가 없다고 경고). 그럴 때는 기본값으로 바로 올리지 않고 결정을 사용자에게 묻는다.

## 2. 판단

역할마다 무엇이 결과를 좌우하는지로 고른다.

| 역할 | 무엇이 결과를 좌우하나 | 고르는 기준 |
|---|---|---|
| 메인(리드) | 토큰을 가장 많이 쓴다. 나누고 모으는 판단 | 에이전틱 코딩 점수 대비 가격. 최상위 모델은 "최고"에서도 기본으로 두지 않는다 |
| 설계 | 긴 추론·놓친 경우의 수 | 가장 깊은 추론 모델 + 높은 effort |
| 구현 | 실제 코드 품질·도구 사용 | 에이전틱 코딩 벤치마크(SWE-bench 등) 상위, 가격 대비 |
| 리뷰 | 버그를 찾는 능력 | 구현과 같거나 높은 등급 + 높은 effort. 다른 회사 엔진은 교차 검토로 |
| 분석 | 넓고 꼼꼼하게 읽고 근거와 함께 정리한다 | 추론·데이터 분석 점수 상위 모델. 가벼운 파일 탐색용 저렴한 모델은 쓰지 않는다 |
| 테스트 | 많이 실행하고 반복한다 | 에이전틱 코딩 점수 대비 가격이 좋은 모델 |
| 설계 문서 | 결정을 빠짐없이 · 지어내지 않고 옮김 | 지시 따르기 · 언어 점수 상위의 중상급 모델 (등급 high) |
| 문서화 | 단순 (README · 사용법) | 가장 저렴한 모델 |
| 교차 검토 | 다른 엔진의 시각 | 상대 회사의 코딩 상위 모델 + 높은 effort |

- 두 도구 모두 서브에이전트는 **자기 회사 모델만** 공식 지원한다. 섞는 자리는 교차 검토뿐이다.
- 프로필 성격: **최고** = 사용량 걱정 없음, **표준** = 추천 기본(개인 중간 요금제), **절약** = 최상위 모델 없이.
- 새 모델이 기존 모델보다 **같은 가격에 벤치마크가 높으면** 교체하고, **더 비싸면** 최고 프로필에만 넣는 것부터 검토한다.

## 3. 반영

1. `packs/core/models.json` 수정: `tools`(선택지·근거) · `retired` · `profiles`(역할별 + 등급 표 `grades.<도구>.high|standard|low`) · `catalogVersion`(오늘 날짜)
   - 요금제: `plans.<도구>`(id · label · room = tight|ample|metered · detect = 로그인 값 정규식 · hint · sources)와 `plans.checked`. 공식 요금제 페이지로 확인한 것만 넣는다
   - 요금제 페이지 기준 낱말: 검토를 마치면 `node bin/models.js watch --accept`
   - 분야별 점수: `node bin/models.js livebench --write` 가 모델마다 `strengths`(LiveBench 분야별)와 `strengthsSource` 를 적는다. 자동 팀 구성의 모델 메뉴가 쓴다
2. `npm run models:doc`: `docs/team-models.md` · `docs/workflow.md` 의 추천 표를 다시 쓴다 (표는 손으로 고치지 않는다)
3. `npm run models`: 오류 없음 확인
4. 아래 "근거" 표를 갱신
5. `npm test` 통과 → `package.json` version 올림 (추천 변경 = patch, 형식 변경 = minor) → 커밋·push
6. 워크스페이스는 `kedovi upgrade` 로 받는다. 팀이 직접 고른 값은 그대로 두고, 퇴역 모델만 sync 가 경고한다 (`kedovi models --migrate`)

## 근거 (2026-11-11)

| 모델 | 벤더 권장 용도 | API 가격 (1M 토큰, 입력·출력) | 요금제 |
|---|---|---|---|
| Claude Fable 5.2 (2026-11-09, `fable` 별칭) | 야심 찬 열린 기술 작업(여러 날 에이전틱 개발 · 연구 · 금융). 일상 작업은 Opus 5.5 부터 권장 | $8 · $40 (5.1 은 $10 · $50) | Pro·Max·Ultra·Team·Enterprise. Pro·표준 좌석은 사용량 크레딧, Max · Ultra · 프리미엄 좌석은 주간 한도 50% 까지 |
| Claude Opus 5.5 | 버그 수정(high), 설계(xhigh). Claude Code `default` 별칭 | $4 · $20 | Pro 이상 |
| Claude Sonnet 5.5 | 일상 코딩 | $2 · $10 | Pro 이상 |
| Claude Haiku 5.5 | 대량 · 반복 작업(요약 · 분류 · 압축), Opus · Sonnet 곁의 범위 좁은 서브에이전트. 복잡한 에이전틱 코딩은 Sonnet · Opus | $0.10 · $0.50 (100K 넘는 프롬프트 $0.50 · $2.50) | Pro 이상 |
| GPT-6 Astra | 가장 까다로운 전 과정 작업 | $10 · $50 | Plus·Pro·Business·Enterprise |
| GPT-6.1 Sol | 계획이 필요한 까다로운 에이전트 작업 ("여기서 시작") | $2 · $10 | Plus 이상 |
| GPT-6.1 Terra | 글쓰기, 이미지 · 화면 이해, 컴퓨터 사용 (Codex CLI 0.159 이상) | $1 · $5 | 요금제별 안내 없음 |
| GPT-6 Luna | 빠르고 범위가 좁은 반복 작업, 가벼운 서브에이전트 | $0.10 · $0.50 | Free·Go 포함 |

- 요금제 (2026-10-30 변경, claude.com/pricing 2026-11-11 확인): Max 5x → **Max**(월 $100, 5시간 · 주간 Pro 의 5배), Max 20x → **Ultra**(월 $200, 주간 Pro 의 10배, 인증된 계정은 5시간 제한 없음). 로그인 값은 Max 가 그대로 `default_claude_max_5x`(이 PC 확인), Ultra 는 옛 `max_20x` 와 `ultra` 를 모두 맞춘다. 저장된 요금제 id(`max5x` · `max20x`)는 그대로 둬 이미 고른 PC 가 바뀌지 않는다. ChatGPT Pro 는 $100 · $200 · $500 등급 모두 5시간 제한이 없다.
- Fable 5.2 는 Claude Code 2.1.321 이상, `claude -p --model fable` 로 `claude-fable-5-2` 실행 확인(2026-11-11). LiveBench 측정이 아직 없어 기본 추천에 넣지 않았다 (벤더 수치만 있음, 아래 판단 표).
- 없는 모델: `gpt-6-mini` 는 없다(OpenAI 는 `gpt-5.4-mini` 의 대체로 Luna 를 안내). `o4-mini` 는 ChatGPT 에서 빠진 옛 모델.
- 퇴역(2026-10-01 확인): Sonnet 4.5(`claude-sonnet-4-5-20250929`)는 2026-09-30 퇴역 예고, 2026-11-30 종료, 대체 Sonnet 5.5. GPT-5.5 는 2026-10-14 에 ChatGPT·Codex(ChatGPT 로그인)에서 빠지고 API 에는 남는다(그때 OpenAI 안내 대체 gpt-6-sol, Free·Go 는 gpt-6-luna. gpt-6-sol 은 지금 Codex 목록에서도 빠졌으니 gpt-6.1-sol 로). GPT-5.3 Codex Spark 는 2026-09-14 Codex 에서 빠졌다. `gpt-5.2` · `gpt-5.3-codex` 는 날짜 없이 "Codex(ChatGPT 로그인)에서 이미 지원 중단"(2026-10-08 확인, 공식 대체 안내 없음 → 킷 기본 코딩 모델 gpt-6.1-sol).
- Haiku 5.5 는 2026-10-07 출시. Claude Code 별칭 `haiku` 가 Anthropic API 에서 Haiku 5.5 로 연결된다(Claude Code 2.1.293 이상, effort 지원 · 기본 medium, 사고를 끌 수 없음). Bedrock · Vertex · Foundry 는 아직 Haiku 4.5.
- GPT-6.1 Terra 는 2026-10-28 에 Codex 모델 목록 · API 가격표에 올라 있다(OpenAI 발표문은 못 찾음, `codex exec -m gpt-6.1-terra` 실행 확인). LiveBench 측정이 없어 역할 추천에는 쓰지 않고 선택지로만 둔다. GPT-6 Sol 은 Codex 모델 목록에서 빠졌다(API 가격표에는 남고 `codex exec -m gpt-6-sol` 도 아직 돈다, 퇴역 공지 없음 → `retired` 에 넣지 않음). Terra 는 `bench` · `strengths` 가 없어 자동 팀 구성의 모델 메뉴에도 나오지 않는다.
- Haiku 4.5 고정 스냅샷(`claude-haiku-4-5-20251001`)은 2026-10-28 에도 Active 다(모델 퇴역 페이지, 퇴역 공지 없음). 그래서 `retired` 에 두지 않는다. 실제 공지가 나오면 그때 넣는다. 별칭 `haiku` 는 최신 Haiku 를 따라간다.
- 게이트웨이(Bedrock · Vertex · Foundry)에서는 `haiku` 가 아직 Haiku 4.5 로 이어진다. 그래서 테스트 역할에 `gateway` 대체(`below: 5.5` 면 GPT-6 Luna max)를 두었다. GPT 를 못 쓰는 게이트웨이면 Haiku 4.5 를 추론 강도 없이 쓰고 sync 가 경고한다. 테스트 모델을 haiku 가 아닌 다른 모델로 직접 고른 팀 · PC 에는 적용하지 않는다. 별칭 연결 게이트웨이(`ANTHROPIC_DEFAULT_HAIKU_MODEL` 로 잇는 방식)는 실제 버전을 모르므로 바꾸지 않는다.
- LiveBench(2026-06-25 문제 세트) 2026-10-28 확인: 카탈로그 밖 새 모델은 Haiku 5.5 xhigh 뿐이라 넣었다. 데이터 파일은 2026-10 에 `/v1/` 아래로 옮겨졌다(`bin/models.js` 가 새 위치부터 본다).
- effort: Claude `low`~`max`, Codex `low`~`max`(모델에 따라 `ultra`). 2026-09-30 Codex 0.159 에서 Sol·6.1 Sol·Luna·Astra 모두 `max` 실행 확인.

> 출처: 각 모델의 `sources` (`packs/core/models.json`)

### 벤치마크로 바꾼 판단

LiveBench 2026-06-25 문제 세트 (독립 측정, 전체 / 에이전틱 코딩 / 문항당 비용):
Fable 5.1 max 83.4 / 66.1 / $1.01 · Opus 5.5 max 83.2 / 71.7 / $0.67 · Astra max 82.2 / 57.3 / $0.60 · Opus 5.5 xhigh 82.1 / 65.4 / $0.20 ·
6.1 Sol max 81.6 / 54.5 / $0.12 · 6.1 Sol xhigh 81.1 / 56.8 / $0.08 · Sonnet 5.5 xhigh 77.8 / 39.3 / $0.11 · Haiku 5.5 xhigh 72.1 / 51.4 / $0.013 · Luna max 72.0 / 51.2 / $0.02

| 판단 | 근거 |
|---|---|
| Claude 설계(최고)를 Fable 5.1 → Opus 5.5 max | LiveBench 전체 83.2 ≈ Fable 83.4, 에이전틱 코딩 71.7 > 66.1, 비용 2/3. 벤더 수치도 같은 방향(Terminal-Bench 4.0 66.4% 대 55.8%) |
| Claude 구현을 표준에서도 Opus 5.5 로 | LiveBench 에이전틱 코딩 Opus xhigh 65.4 · Sonnet xhigh 39.3, 비용은 약 2배. 벤더 수치(Terminal-Bench 4.0 Sonnet 70.6% · Opus 66.4%)와 반대라 독립 측정을 따른다. 절약은 Sonnet 유지 |
| Codex 코딩 역할은 GPT-6.1 Sol high | 벤더 DeepSWE v1.1 high 75.2% > xhigh·max 71.9%, LiveBench 에이전틱 코딩 xhigh 56.8 > max 54.5 (high 는 LiveBench 측정 없음) |
| Codex 설계(최고)만 Astra xhigh | LiveBench 전체 82.2 로 6.1 Sol(81.6)보다 조금 높지만 비용 5배. 추론 비중이 큰 설계에만 |
| 분석은 Opus 5.5 · GPT-6.1 Sol (Sonnet·Luna 아님) | LiveBench 추론·데이터 분석: 6.1 Sol xhigh 91.6·82.2($0.08), Opus xhigh 90.7·79.8($0.20), Sonnet 5.5 xhigh 86.8·78.6($0.11), Luna max 81.8·73.4. 벤더의 "탐색은 저렴한 모델" 권고는 가벼운 파일 탐색 이야기라 이 킷의 분석 역할(근거와 함께 넓게 조사)에는 맞지 않는다 |
| Claude 테스트를 Luna(Codex 위임) → Haiku 5.5 xhigh (표준 · 절약) | LiveBench 전체 72.1 ≈ Luna 72.0, 에이전틱 코딩 51.4 ≈ 51.2, 문항당 $0.013 < $0.02. 같은 회사라 위임 없이 서브에이전트로 돈다. Anthropic 도 Opus · Sonnet 곁의 서브에이전트 용도로 안내 |
| 작업 리더(lead): 최고 Opus 5.5 medium · 표준 Sonnet 5.5 medium · 절약 Sonnet 5.5 low | 리더는 나누고 넘기고 보고를 요약한다 (코드 안 씀). 리더가 여럿이라 곱절로 늘어나므로 메인보다 한 단계 낮게. Anthropic: Opus 5.5 medium ≈ Opus 5 high, 서브에이전트는 비용을 낮은 모델로 |
| Fable 5.2 는 선택지로만 (설계 최고도 Opus 5.5 max 유지) | 벤더 수치는 Opus 5.5 보다 높다 (FrontierSWE v2 69.9% 대 62.3%) 하지만 독립 측정이 없고, 가격 2배 · Max 에서는 주간 한도의 절반까지만. LiveBench 에 들어오면 설계(최고)부터 다시 본다 |
| Luna 는 테스트 max | 벤더 DeepSWE low 2.4% · high 59.3% · max 66.6%, LiveBench max 문항당 $0.02 |

> 출처: 수치와 출처는 `models.json` 의 `bench`

- 벤더 발표 수치는 측정 하네스가 달라 회사 간 비교는 참고용이다. 같은 모델도 발표처마다 다르다(Opus 5.5 TB-Science: Anthropic 58.7% · OpenAI 측정 63.3%).
- 2026 모델들은 SWE-bench Verified·Pro 수치를 발표하지 않았다.
- Anthropic 5.1·5.5 계열은 안전 장치가 걸리면 옛 모델로 넘기는 경우가 있어 점수가 낮게 나올 수 있다고 밝힌다.
