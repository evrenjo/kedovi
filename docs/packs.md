# 팩 종류

**팩**은 AI 에이전트가 따를 규칙 · 쓸 스킬 · 자동으로 도는 훅 · 검사 도구를 한 주제로 묶은 것이다 (예: `backend` = 백엔드 공통 원칙, `stack-spring` = Spring 규칙과 검사 도구).
워크스페이스는 필요한 팩만 골라 붙이고, sync 가 팩을 읽어 Claude Code · Codex 가 읽는 파일(`AGENTS.md` · `CLAUDE.md` · `.agents/` · `.claude/` · `.codex/`)을 만든다.

## 팩이 붙는 방식

| 종류 | 언제 붙나 | 무엇을 담나 |
|---|---|---|
| 공통 (`core`) | 항상 | 소통 · 근거와 검증 · 안전 · git · 핸드오프 · 팀 에이전트 |
| 유형 (`type`) | 시작 유형이 정한다 (차세대 · 운영·고도화 · 분석·설계) | 그 유형에서 AI 가 삼는 근거와 원칙 |
| 협업 도구 (`workflow`) | repo 주소가 GitLab · GitHub 인 repo 에 | 브랜치 전략 · 커밋 규칙 · MR · PR 스킬 |
| 계층 (`layer`) | repo 스택의 계층(서버 · 화면 · DB · 모바일 …)에 | 기술과 무관한 공통 원칙 |
| 스택 (`stack`) | repo 스택이 그 기술일 때 | 그 기술의 구체 규칙과 검사 도구 |
| 언어 (`lang`) | repo 에 그 언어 소스가 있을 때 (언어 감지: Java · Kotlin · Python · C · C++ · Swift · Dart · TypeScript · JavaScript · Go · C#) | 클린 코드: 이름 · 함수 · 클래스 · 주석 · 읽히는 코드 · 레이어 책임. 언어가 감지된 코드 repo 에 공통(`clean-code`), 언어별(`lang-*`)은 전용 팩이 있는 언어만 |
| 프로젝트 (`project`) | 워크스페이스마다 하나, 처음엔 비어 있다 | 그 프로젝트만의 규칙 · 스킬 · 역할 정의 |

계층·스택·언어·협업 도구 팩은 **그 스택 · 언어를 쓰는 repo 에만** 걸린다 (AGENTS.md 의 "repo 별 작업 규칙" 표). 그래서 repo 가 많아도 AGENTS.md 가 커지지 않는다.

규칙을 끄거나 우리 방식으로 바꾸거나 새로 더하려면 [팩 제작](pack-making.md).

모든 팩은 종류마다 한 쪽(공통 · 유형 · 협업 도구 · 계층 · 스택 · 언어 · 산출물)이다. 팩 이름을 누르면 설명 · 붙는 조건 · 규칙 · 스킬 · 도구가 펼쳐진다. 이 목록은 `npm run docs` 가 `packs/` 로 만든다.

<!-- packs:catalog: node bin/docs.js 가 packs/ 로 쓴다. 손으로 고치지 않는다 -->
## 공통 팩

<details>
<summary><b>core</b> · 공통 코어: 소통·검증 규칙 · 핸드오프 · 로드맵 · 문서 사이트 · 진단</summary>

협업 워크스페이스 기본: 팀 구성(자동: 리더가 작업마다 역할·모델 선택, 고정: 프로필대로), 커뮤니케이션·근거/검증 원칙·변경 영향 점검, 핸드오프/재개/작업 시작, 진행 방식(스프린트: 최소 기능부터 기능 단위 스프린트 · 데모 · 회고 · 백로그, 전체: 전체 설계 뒤 구축, 이슈형: 운영 · 유지보수의 이슈 보드 · 주간 보고), 유형 바꾸기(kedovi type), 신규 구축 아이디어 · 전체 그림(idea 스킬: 무엇을 왜 만드는지 대화 → 기능 지도 → MVP 범위), 로드맵(handoffs/PLAN.md: 종류 · 진행 방식별 기본 단계 · 단계 흐름도 · 영역 × 하위 작업 표 · 완료 보고 블록), 문서 사이트(kedovi docs build: 기획 repo 의 md → 같은 경로 구조의 HTML, 가이드와 같은 화면 틀 · 정의 ID 앵커 · 근거 색인 ids.json · docs-site.json 묶음), 워크스페이스 현황판(kedovi board), 컨텍스트 관리, 응답 언어 · 대화 스타일(kedovi prefs: 한국어 · English, 학습 · 일반 · 전문가, 요청마다 · 긴 작업 중 다시 한 줄 · Claude 출력 스타일 · 그림은 claude-mermaid 가 있으면 브라우저, 없으면 텍스트), 답변 첫 줄 시각 표시(요청 받은 시각, kedovi timestamp), 시간 예산(budget.js: 예산 1.5배를 넘으면 계속할지 묻게 함), 리뷰 위임 차수(같은 범위 차수 · 앞 차수 블로커 · 3차부터 경고), 리뷰 전 검사(지시서의 검사: 줄), 착수 전 확인(코드 첫 수정 전 머리말), 오래 일하는 팀원 · 위임 알림(기본 60분), 레포 업데이트·죽은 참조 검사·핸드오프 알림 훅 · 텔레그램 알림(개인: 알림 수준 · 양방향 대화 · 자리 비움, 팀: 핸드오프·설정 변경·공지)

| 항목 | 내용 |
|---|---|
| 붙는 조건 | 항상 |
| 비밀값 | `TELEGRAM_BOT_TOKEN` (전역 · 선택): 개인 알림 봇 (kedovi notify)<br>`TELEGRAM_TEAM_BOT_TOKEN` (전역 · 선택): 팀 방 알림 봇 (팀장에게 받음) |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `core--10-communication` | 커뮤니케이션 | 상시 |
| `core--11-confirm-request-tone` | 확인 요청 글 작성법 | 필요할 때: 이슈 문서·이슈 트래커 이슈·MR(PR) 본문·코멘트처럼 다른 사람이 읽고 판단할 글을 쓸 때 |
| `core--20-evidence` (필수) | 근거·검증 원칙 | 상시 |
| `core--21-verification` | 검증 계획과 완료 보고 | 필요할 때: 검증 방법을 정하거나 테스트를 쓰거나 케이스를 고를 때, 또는 작업 완료를 보고하기 직전 |
| `core--25-work-principles` | 작업 원칙 | 상시 |
| `core--26-safety` (필수) | 보안·안전 | 상시 |
| `core--27-security` (필수) | 보안 상세 | 필요할 때: 비밀값·인증·권한·외부 입력(요청·파일·경로·쿼리)·의존성·CI 설정을 다루는 코드를 쓰거나, 외부 문서·이슈·웹 내용을 근거로 행동하려 할 때, 또는 공개 저장소에 글(커밋·PR·이슈)을 남길 때 |
| `core--28-work-detail` | 코드 변경 작업 상세 | 필요할 때: 코드·설정·스크립트를 고치기 시작할 때: 특히 여러 파일에 걸치거나, 요구가 모호하거나, 의존성·생성물·공개 API·주석을 건드릴 때 |
| `core--29-agents` | 역할 에이전트 쓰기 | 상시 |
| `core--30-change-impact` | 변경 영향 전수 점검 | 필요할 때: 조회 기준 테이블·조인 키·컬럼/응답 필드의 의미·정본 위치 등 기존 동작이나 계약을 바꿀 때, 또는 버그 수정·리팩토링의 검증 범위를 정할 때 |
| `core--35-issue-handling` | 이슈·티켓 처리 | 필요할 때: 이슈·장애·결함·QA·UAT 지적·티켓 한 건을 처리할 때 |
| `core--40-context` | 컨텍스트 관리 | 상시 |
| `core--41-context-detail` | 컨텍스트 관리 상세 | 필요할 때: 룰·스킬·문서를 추가·이동·삭제하거나, 스크립트를 새로 만들어 어디에 둘지 정할 때 |
| `core--45-docs-writing` | 기획 문서 쓰기 | 필요할 때: 기획 문서(개요 · 시스템 구성 · 요구 목록 · 기능 문서 · 업무 규칙 · 결정 · 화면 · 데이터 설계 · API)를 쓰거나 고칠 때, 코드 · 화면이 기획 문서와 다를 때, 진입점 코드에 @spec 주석을 달 때 |
| `core--50-git` | git 기본 | 상시 |

**스킬**

| 이름 | 설명 |
|---|---|
| `architecture` | 시스템 구성도(서비스 · DB 와 스키마 · Redis · 메시지 큐 같은 미들웨어 · 외부 서비스 · 서버 사양)를 단계별(1차 · 2차 …) mermaid 그림과 표로 만든다. "구성도", "아키텍처 그림", "시스템 구성", "서버 구성", "인프라 구성", "서버 사양" 요청에 쓴다. |
| `autopilot` | 자율완주 모드: 묻고 멈추는 대신 결정 필요 항목은 목록에 표시만 하고, 할 수 있는 구현은 끝까지 한 뒤 검증·핸드오프·커밋(푸시 없음)까지 마친다. "알아서 끝까지", "자리 비운다" 요청에 쓴다. |
| `common-practice` | 흔한 방식 · 업계 관례 · 표준을 웹 검색으로 확인해 출처와 함께 비교해 답한다. 사용자가 "아닌가?", "보통 ~하던데", "다른 데는 어떻게 해?", "일반적으로", "표준이 뭐야", "찾아봐줘", "검색해봐" 라고 묻거나 다른 서비스 화면 · 문서를 예로 들며 우리 것과 다르다고 할 때, 또는 내가 "보통은 ~" 이라고 말하려 할 때 쓴다. |
| `cross-review` | 다른 벤더의 에이전트에게 읽기 전용 교차 리뷰(두 번째 의견)를 받는다: Claude Code 세션이면 Codex, Codex 세션이면 Claude Code 를 비대화형으로 돌린다. "교차 리뷰", "다른 모델 의견", "codex 한테도 봐 달라" 요청에 쓴다. |
| `debate` | 토론 모드. 여러 모델(다른 회사 모델 포함 2~4개)이 같은 문제를 따로 보고, 이름을 가린 주장 목록에 서로 동의 · 반대해 갈린 것만 다시 본다. 코드 리뷰 · 설계 · 요구 · 문서 · 원인 분석 어떤 작업이든. "토론해줘", "토론 모드", "여러 모델로 봐줘", "다른 모델들한테도", 또는 결과가 마음에 안 든다 · 맞는지 모르겠다는 말에 쓴다. |
| `doctor` | 워크스페이스 셋업·환경(Node·git·repos/ 의 repo·훅 경로·kit 생성물·에이전트 CLI)을 진단한다. 처음 받았을 때나 뭔가 깨졌을 때 쓴다. |
| `go` | 이 워크스페이스에서 작업을 시작한다: 본인 핸드오프·repo 상태를 확인하고, 요청을 다시 정리해 영향 범위·할 일·검증 계획·안 할 것을 먼저 제시한 뒤 착수한다. "시작", "작업하자", 새 요구사항을 받았을 때 쓴다. |
| `handoff` | 작업을 마무리하고 본인 핸드오프(작업별 기록 · 주간 기록 · LATEST · TODO)를 남긴다. "핸드오프", "마무리", "오늘 정리" 요청에 쓴다. "TODO 에 넣어줘", "TODO 정리" 도 이 스킬 5절을 따른다. |
| `handoff-organize` | 이미 커진 본인 핸드오프 기록(수십만 자 주간 기록 · 흩어진 메모 파일 · 쌓인 색인)을 작업별 기록으로 나눠 정리한다. 원본은 지우지 않고 보관한다. "핸드오프 정리", "기록 정리", "핸드오프가 너무 길다" 요청에 쓴다. |
| `idea` | 신규 구축의 첫 단계. 무엇을 왜 만들려는지 사용자와 충분히 대화해 전체 그림(누구 · 문제 · 핵심 흐름 · 기능 지도 · 하지 않을 것)을 그리고, MVP(첫 스프린트) 또는 워터폴 범위를 정한다. "아이디어 정리", "무엇을 만들지", "전체 그림", "MVP 정하기", "기획 시작" 요청과 로드맵 「아이디어 · 전체 그림」 단계에 쓴다. |
| `import` | 기존 AI 작업 폴더(예전 지침 파일 · 룰 · 메모 · 핸드오프 · 스크립트)를 이 워크스페이스로 옮긴다. 먼저 훑어 계획을 보여 주고 승인 뒤에 옮긴다. "기존 폴더 가져와", "이관", "예전 설정 옮겨줘" 요청에 쓴다. |
| `kedovi` | 워크스페이스 설정을 바꾸거나 확인하는 요청을 kedovi 명령으로 처리한다 (비밀값(토큰) 확인 · 옮기기 · 텔레그램 알림 · 팀 공지 · 모델·프로필·AI 연결 방식(구독·게이트웨이)·시작 도구·규칙 켜고 끄기·팀 명단·설정 수정 권한·repo 추가·스택 감지·진단·팀 현황·킷 업그레이드 · 팩 켜기 · 진행 방식(스프린트 · 전체 · 이슈형) · 유형 바꾸기 · 로드맵 보기 · 문서 사이트 · 기획 문서 ID 찾기 · 화면설계 · 데이터 설계 검사). |
| `resume` | 이 워크스페이스로 돌아왔을 때 본인 마지막 핸드오프·미완 작업·TODO·최근 활동·repo 상태를 한 번에 파악해 보고한다. 본인 작업 재개 전용이다. "재개", "어디까지 했지", "상태 파악" 요청에 쓴다. |
| `review` | 현재 변경사항(git diff)을 코드 리뷰한다: 결함·누락·보안·계약 동기화·검증 누락을 짚고 수정안을 낸다. "리뷰", "검토해줘" 요청에 쓴다. |
| `takeover` | 다른 개발자의 핸드오프 기록을 받아 그 사람 작업을 이어받는다(인수인계). 팀장이 배정하거나 팀원이 빠질 때 쓴다. "인수인계", "<id> 작업 인수", "<id> 일 이어받기" 요청에 쓴다. 본인 작업 재개는 resume. |
| `team` | 역할 에이전트(분석·설계·설계 문서·구현·테스트·리뷰·문서화와 팩·프로젝트가 더한 역할)를 불러 일을 나눠 진행한다. 자동 모드면 작업마다 역할과 모델을 골라 구성표를 알리고 시작한다. 버그 수정·기능 추가·리팩터링·레거시 분석·리뷰처럼 여러 단계나 여러 repo 에 걸친 작업에서, 메인 대화 context 를 아끼려고 스스로 판단해 쓴다. 하위 에이전트를 못 쓰는 도구면 같은 역할을 혼자 차례로 밟는다. |
| `team-status` | 팀원 모두의 핸드오프를 모아 누가 언제 무엇을 얼마나 했는지, 미완 작업·TODO·진행 중 브랜치·오래 갱신 안 된 사람을 보고한다. "팀 현황", "다들 어디까지 했어", "누가 뭐 하고 있어" 요청에 쓴다. |
| `ticket` | 이슈·티켓 한 건(장애·결함·QA·UAT 지적·요청)을 영향 범위 → 재현 → 원인 확정 → 수정 → 검증 → 조치 보고 순서로 처리한다. 모든 유형 공통. "티켓 처리", "장애 봐줘", "이 이슈 고쳐줘", "QA 지적 처리" 요청에 쓴다. |
| `tidy` | 방향이 바뀌거나 고친 뒤 남은 파일(안 쓰게 된 코드 · 문서 · 이미지 · 스크립트 · 백업 사본)을 찾아 근거와 함께 보이고, 승인받은 것만 지운다. "정리해줘", "안 쓰는 파일 지워줘", "쓰레기 파일", "이전 버전 정리" 요청, 작업 방향을 바꾼 뒤, 단계 · 핸드오프 보고에 정리 후보가 있을 때 쓴다. |

**팀 에이전트 역할**: 분석 (`analyst`) · 설계 (`architect`) · 문서화 (`documenter`) · 구현 (`implementer`) · 리뷰 (`reviewer`) · 설계 문서 (`spec-writer`) · 테스트 (`tester`)

**도구**: `bin/board.js` · `bin/brief.js` · `bin/budget.js` · `bin/check-docs.js` · `bin/check-refs.js` · `bin/cross-review.js` · `bin/debate.js` · `bin/delegate.js` · `bin/docs-site.js` · `bin/doctor.js` · `bin/handoff.js` · `bin/import-scan.js` · `bin/issue-check.js` · `bin/notify.js` · `bin/plan.js` · `bin/rename-ref.js` · `bin/repo-activity.js` · `bin/repo-check.js` · `bin/review.js` · `bin/secret.js` · `bin/strip-ai-trailers.js` · `bin/team-status.js` · `bin/tidy.js`

**훅**: 세션 시작: `check-repo-updates.js` · 세션 시작: `check-context-sync.js` · 세션 시작: `handoff-brief.js` · 세션 시작: `session-brief.js` · 세션 시작: `model-profile.js` · 세션 시작: `team-mode.js` · 세션 시작: `channel-mode.js` · 세션 끝: `task-check.js` · 세션 끝: `decision-ask.js` · 세션 끝: `handoff-reminder.js` · 세션 끝: `agent-cleanup.js` · 세션 끝: `budget-check.js` · 세션 끝: `team-idle.js` · 세션 끝: `notify.js` · UserPromptSubmit: `agent-budget.js` · UserPromptSubmit: `task-focus.js` · UserPromptSubmit: `prompt-time.js` · UserPromptSubmit: `chat-prefs.js` · UserPromptSubmit: `settings-hint.js` · UserPromptSubmit: `budget-check.js` · UserPromptSubmit: `team-idle.js` · UserPromptSubmit: `decision-ask.js` · UserPromptSubmit: `plan-first.js` · UserPromptSubmit: `notify.js` · PreToolUse: `agent-budget.js` · PreToolUse: `notify.js` · PreToolUse: `decision-ask.js` · PreToolUse: `notify.js` · PreToolUse: `plan-first.js` · PreToolUse: `team-guard.js` · PreToolUse: `repo-guard.js` · PreToolUse: `git-guard.js` · PreToolUse: `secret-guard.js` · PreToolUse: `review-gate.js` · PreToolUse: `spec-commit.js` · PostToolUse: `channel-progress.js` · PostToolUse: `chat-prefs.js` · PostToolUse: `secret-guard.js` · PostToolUse: `notify.js` · PostToolUse: `notify.js` · Notification: `team-idle.js` · Notification: `notify.js` · SubagentStop: `agent-budget.js` · SubagentStop: `notify.js` · TeammateIdle: `team-idle.js` · TeammateIdle: `notify.js`

</details>

## 유형 팩

<details>
<summary><b>consulting</b> · 분석·설계 (ISP·ISMP): 문서 산출물 · requirements 스킬</summary>

구축 전 분석·설계 사업: 결과물은 문서(현행 분석·요구사항 정의·목표 모델·이행계획·RFP), 코드 수정 없음, 근거 표기, requirements 스킬

| 항목 | 내용 |
|---|---|
| 붙는 조건 | 시작 유형이 분석·설계 (ISP·ISMP) 일 때 |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `consulting--10-consulting` | 분석·설계(ISP·ISMP) 원칙 | 상시 |

**스킬**

| 이름 | 설명 |
|---|---|
| `requirements` | 인터뷰 기록·현행 문서·현행 소스에서 요구사항을 뽑아 ID·설명·수용 기준·출처·우선순위를 갖춘 요구사항 정의서로 정리한다. "요구사항 정리", "요구사항 정의서", "RFP 요구사항" 요청에 쓴다. |

</details>

<details>
<summary><b>enhancement</b> · 운영·고도화: 기존 동작 보존 · 변경 영향 점검 · 운영 환경 조회만</summary>

운영 중인 시스템을 다루는 프로젝트(고도화·유지보수 SM): 기존 동작 보존, 변경 영향 점검 상시 적용, 지금 동작을 테스트로 고정한 뒤 변경, 데이터·호출자 호환, 운영 환경은 조회만, 데이터 보정은 스크립트와 승인, hotfix 흐름. 이슈·티켓 처리는 모든 유형 공통(core 의 ticket 스킬)

| 항목 | 내용 |
|---|---|
| 붙는 조건 | 시작 유형이 운영·고도화 (SM 포함) 일 때 |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `enhancement--10-enhancement` | 운영·고도화 프로젝트 원칙 | 상시 |

</details>

<details>
<summary><b>modernization</b> · 차세대 전환 (AS-IS → TO-BE): AS-IS 대조 규칙 · 레거시 분석 도구</summary>

레거시(AS-IS) 재구축 프로젝트: AS-IS 정합 원칙(저장·복사·조회 대조, grep -a, 뷰 정의 확인), 데이터 마이그레이션 원칙, COBOL·EGL 효과/읽기/필드 쓰기 추출 도구, AS-IS↔TO-BE 매핑·대조 도구, asis-compare 스킬

| 항목 | 내용 |
|---|---|
| 붙는 조건 | 시작 유형이 차세대 (재구축 · AS-IS → TO-BE) 일 때 |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `modernization--10-asis-parity` | 차세대 전환: AS-IS 정합 원칙 | 상시 |
| `modernization--20-asis-parity-procedure` | AS-IS 대조 절차 (저장·복사·조회) | 필요할 때: AS-IS 의 저장·복사·조회 로직을 TO-BE 로 구현하거나, 둘이 같은지 대조·검증할 때 |
| `modernization--30-data-migration` | 데이터 마이그레이션 원칙 | 필요할 때: 레거시 DB 데이터를 TO-BE 로 옮기는 마이그레이션 스텝·매핑·적재 도구를 작성·수정·검증할 때 |

**스킬**

| 이름 | 설명 |
|---|---|
| `asis-analysis-team` | AS-IS(레거시) 분석 팀을 꾸려 한 기능을 레거시 소스·DB 정의·TO-BE 코드로 나눠 조사하고 사실 기반 비교 보고서를 낸다. "분석 팀", "AS-IS 분석해줘", "레거시 로직 전수 조사" 요청에 쓴다. |
| `asis-compare` | 레거시(AS-IS) 프로그램과 TO-BE 구현의 정합표를 만든다: 쓰는 표 집합·컬럼 값·읽기 조건을 도구로 뽑아 대조하고 판정마다 확인됨/추정/미확인을 붙인다. "AS-IS 대조", "AS-IS 랑 같은지", "정합 확인" 요청에 쓴다. |

**도구**: `bin/asis-config.js` · `bin/asis-dialect.js` · `bin/asis-effects.js` · `bin/asis-field-writes.js` · `bin/asis-reads.js` · `bin/asis-tobe-diff.js` · `bin/asis-tobe-map.js` · `bin/check-cobol-coverage.py`

</details>

## 협업 도구 팩

<details>
<summary><b>github</b> · GitHub 팀 워크플로: 브랜치 전략 · PR 생성 · 이슈 등록 · 커밋 규칙</summary>

GitHub 협업: 브랜치 전략(작업 브랜치 → PR, 머지는 사람만), 커밋 메시지, 이슈·PR 어조, gh CLI 로 PR 을 만드는 스킬, 이슈 찾기 · 읽기 · 등록 · 조치 보고 댓글 스킬

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 주소가 GitHub 인 repo 에 |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `github--10-branch-and-merge` | 브랜치·PR·머지 원칙 | 상시 |
| `github--20-commit-message` | 커밋 메시지 | 상시 |
| `github--30-issue-pr-tone` | 이슈·PR 본문 어조와 확인 항목 양식 | 필요할 때: 이슈 문서·GitHub 이슈·PR 본문·리뷰 코멘트·코드 담당자에게 보내는 확인 요청을 쓸 때 |
| `github--40-branch-detail` | 브랜치 전략 상세 | 필요할 때: 브랜치를 새로 따거나, PR 방향(head→base)·hotfix·브랜치 이름을 정할 때 |

**스킬**

| 이름 | 설명 |
|---|---|
| `github-issue` | GitHub 이슈를 찾고 · 읽고 · 등록하고 · 조치 보고를 댓글로 단다. 초안 → 비슷한 이슈 · 민감정보 검사 → 사용자 OK → gh issue create / comment. 닫기 · 라벨 · 담당자는 하지 않는다. "이슈 등록해줘", "#12 이슈 봐줘", "조치 내용 이슈에 남겨줘" 요청에 쓴다. |
| `pr` | 지정한 head→base 로 GitHub 풀리퀘스트를 만든다 (base 생략 시 통합 브랜치). 미리보기 → 사용자 OK → gh pr create → 팀 배포 안내까지. 머지는 하지 않는다. "PR 만들어줘", "QA PR" 요청에 쓴다. |

</details>

<details>
<summary><b>gitlab</b> · GitLab 팀 워크플로: 브랜치 전략 · MR 생성 · 이슈 등록 · 파이프라인 조회 · 배포 연쇄(대기 · 머지 · 수동 작업) · 커밋 규칙</summary>

GitLab 협업: 브랜치 전략(작업 브랜치 → MR, 머지는 사람만. vars.gitlab.agentMerge 를 켜면 지시받은 MR 만 에이전트가), 커밋 메시지, 이슈·MR 어조, MR 생성 스킬, 이슈 찾기 · 읽기 · 등록 · 조치 보고 댓글 스킬, 파이프라인 조회(kedovi gitlab pipeline) · 수동 작업 실행 · 다시 실행(--play · --retry: manual 이 될 때까지 기다린 뒤 실행하고 끝날 때까지 상태, --yes 없이는 확인 문구만), 배포 연쇄 명령(kedovi gitlab wait · merge · play · retry · cancel, create 는 열린 MR 을 다시 씀)

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 주소가 GitLab 인 repo 에 |
| 함께 붙는 팩 | `core` |
| 비밀값 | `GITLAB_TOKEN` (프로젝트): MR 생성 · 이슈 등록 · 파이프라인 조회 · 권한 api |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `gitlab--10-branch-and-merge` | 브랜치·MR·머지 원칙 | 상시 |
| `gitlab--20-commit-message` | 커밋 메시지 | 상시 |
| `gitlab--30-issue-mr-tone` | 이슈·MR 본문 어조와 확인 항목 양식 | 필요할 때: 이슈 문서·GitLab 이슈·MR 본문·코드 담당자에게 보내는 확인 요청을 쓸 때 |
| `gitlab--40-branch-detail` | 브랜치 전략 상세 | 필요할 때: 브랜치를 새로 따거나, MR 방향(source→target)·hotfix·브랜치 이름을 정할 때 |

**스킬**

| 이름 | 설명 |
|---|---|
| `gitlab-issue` | GitLab 이슈를 찾고 · 읽고 · 등록하고 · 조치 보고를 댓글로 단다. 초안 → 비슷한 이슈 · 민감정보 검사 → 사용자 OK → 등록 · 댓글. 닫기 · 라벨 · 담당자는 하지 않는다. "이슈 등록해줘", "#12 이슈 봐줘", "조치 내용 이슈에 남겨줘" 요청에 쓴다. |
| `mr` | 지정한 source→target 으로 GitLab 머지리퀘스트를 만든다 (target 생략 시 통합 브랜치). 미리보기 → 사용자 OK → 생성 → 팀 배포 안내까지. 머지는 사람이 한다 (agentMerge 를 켠 워크스페이스는 지시받은 MR 만 배포 연쇄로). "MR 만들어줘", "QA MR", "배포해줘" 요청에 쓴다. |

**도구**: `bin/gitlab-issue.js` · `bin/gitlab-mr.js`

</details>

## 계층 팩

<details>
<summary><b>backend</b> · 백엔드 공통 원칙: 인가·검증·API 계약·데이터·외부 호출·로깅</summary>

프레임워크와 무관한 백엔드 원칙: 기존 관례 따르기, 객체 단위 인가, 경계 입력 검증, 기존 API 계약·하위 호환, 페이지·멱등성, 트랜잭션 경계·동시 수정, 데이터 접근(파라미터 바인딩·N+1·대량 처리), 보안(비밀·SSRF·업로드·의존성), 외부 호출 타임아웃·재시도·설정·정상 종료, 구조화 로깅·추적 ID, 변경 동작 테스트. 근거 출처는 docs/SOURCES.md

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택의 계층이 backend 일 때 (8종: Spring, FastAPI, Django, Flask, Express, NestJS, ASP.NET, Go) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `backend--10-backend-baseline` | 백엔드 기본 원칙 | 상시 |
| `backend--20-layers-and-naming` | 백엔드 계층·이름·주석 | 필요할 때: 백엔드에 클래스·모듈·패키지를 새로 만들거나, 코드를 다른 계층으로 옮기거나, 트랜잭션 경계·이름·주석을 정할 때 |
| `backend--30-api-contract` | 백엔드 API 계약·검증·오류 메시지 | 필요할 때: 엔드포인트를 만들거나 요청·응답·오류·상태 코드·검증·페이지·멱등성·사용자 메시지를 정하거나 기존 API 를 바꿀 때 |
| `backend--40-data-access` | 백엔드 데이터 접근: 쿼리·대량 처리·원시 SQL | 필요할 때: DB 를 읽거나 쓰는 코드를 새로 쓰거나 고칠 때 (조회 조건 변경, 동시 수정 처리, 대량 수정·삭제·복제, 원시 SQL 포함) |
| `backend--50-logging` | 백엔드 로깅 원칙 | 필요할 때: 로그를 새로 넣거나, 예외를 잡아 로그로 남기는 코드·전역 오류 처리기·요청 로깅 필터·감사(보안 이벤트) 로그를 고칠 때 |
| `backend--60-security` | 백엔드 보안: 인증·인가·비밀·외부 입력 | 필요할 때: 인증·인가·토큰·쿠키·CORS, 비밀값, 요청 한도, 파일 업로드, 사용자가 준 URL·경로·명령·XML·직렬화 데이터, 관리 엔드포인트, 의존성 추가를 다룰 때 |
| `backend--70-resilience-and-config` | 백엔드 외부 호출·재시도·설정 | 필요할 때: 외부 API·다른 서비스·큐·캐시를 호출·소비하거나, 타임아웃·재시도·폴백·배경 작업, 설정값·헬스 체크·기동/종료 동작을 바꿀 때 |
| `backend--80-testing` | 백엔드 테스트 | 필요할 때: 백엔드 동작을 바꾸거나 버그를 고쳐 테스트를 추가·수정할 때 |

</details>

<details>
<summary><b>db</b> · DB 계층 원칙: DB 환경 확정 · 파괴적 SQL 승인 · 무중단 스키마 변경</summary>

DBMS 공통 DB 작업 원칙: 환경 확정·운영 직접 변경 금지·파괴적 SQL 건별 승인, 마이그레이션 도구 규율(적용된 파일 수정 금지)과 확장→전환→축소, 큰 테이블 잠금·묶음 처리, 멱등 백필·0 검증 쿼리·백업 확인, 바인드 파라미터·최소 권한·개인정보 가리기, 트랜잭션·교착·커넥션 풀·시간대, 테이블 설계(키·enum·외래키·소프트 삭제·감사 컬럼), 시드·테스트 데이터

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택의 계층이 db 일 때 (5종: PostgreSQL, MySQL·MariaDB, Oracle, SQL Server, MongoDB) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `db--10-db-safety` | DB 작업 안전 원칙 | 상시 |
| `db--20-schema-change` | 스키마 변경 체크리스트 | 필요할 때: 테이블·컬럼·인덱스·시퀀스·제약·enum·컬렉션 구조를 바꾸거나, 마이그레이션 파일을 새로 만들거나 생성기로 만든 마이그레이션을 검토할 때 |
| `db--30-data-change` | 데이터 반영·백필·정리 SQL · 백업 | 필요할 때: 백필·데이터 정리·일괄 UPDATE/DELETE SQL 이나 데이터 마이그레이션을 쓰거나, 여러 스키마·환경·테넌트에 같은 SQL 을 돌리거나, 백업·복구·덤프를 다룰 때 |
| `db--40-access-and-data` | 쿼리 코드 · DB 계정 · 개인정보 | 필요할 때: SQL·쿼리를 만드는 코드를 쓰거나 고칠 때, DB 계정·권한·접속 정보를 다룰 때, DB 덤프나 다른 환경의 데이터를 복사·공유할 때, 개인정보 컬럼·보존 기한·로그를 다룰 때 |
| `db--50-transactions-and-connections` | 트랜잭션 · 잠금 · 동시성 · 커넥션 | 필요할 때: 트랜잭션 경계·격리 수준·행 잠금·재시도를 정하는 코드를 쓰거나, 교착(deadlock)·잠금 대기·타임아웃·커넥션 부족을 조사하거나, 커넥션 풀·타임아웃 설정을 바꿀 때 |
| `db--60-data-modeling` | 테이블 · 컬럼 설계 | 필요할 때: 새 테이블·컬럼을 설계하거나, 키·타입·enum·외래키·인덱스·삭제 방식(소프트 삭제)·감사 컬럼을 정할 때 |
| `db--70-seed-and-test-data` | 시드 · 기준 데이터 · 테스트 데이터 | 필요할 때: 시드·기준(코드) 데이터·초기 데이터를 만들거나 바꿀 때, DB 를 쓰는 테스트·픽스처·테스트 DB 구성을 만들거나 고칠 때 |

**팀 에이전트 역할**: DBA (`dba`)

</details>

<details>
<summary><b>desktop</b> · 데스크톱 앱 공통 원칙: UI 스레드·권한 경계·서명·업데이트·OS 경로</summary>

프레임워크와 무관한 데스크톱 앱 원칙: UI 스레드 규칙, 화면과 로컬 권한 사이 IPC 경계, 원격 코드에 로컬 권한 주지 않기, 서명·공증·업데이트 무결성, OS별 경로·로컬 저장 보안, 개인정보 없는 크래시 보고, 접근성·고해상도(DPI), 웹 기술 셸(Electron·Tauri 류)과 네이티브 툴킷(WPF·WinForms·JavaFX·Qt 류)의 작업별 규칙

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택의 계층이 desktop 일 때 (10종: Electron, Tauri, Neutralinojs, WPF, WinForms, WinUI 3, Avalonia, JavaFX …) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `desktop--10-desktop-baseline` | 데스크톱 앱 기본 원칙 | 상시 |
| `desktop--20-web-shell` | 웹 기술 셸: IPC·CSP·샌드박스 | 필요할 때: 웹 기술로 화면을 그리는 데스크톱 앱(Electron·Tauri 류)에서 창·웹뷰 생성 옵션, 프리로드·브리지, IPC 채널·명령, 권한(capability) 설정, CSP, 내비게이션·새 창·외부 링크, 커스텀 프로토콜, 빌드 퓨즈를 추가하거나 바꿀 때 |
| `desktop--30-native-ui-threading` | 네이티브 툴킷: UI 스레드·화면 구조 | 필요할 때: 네이티브 UI 툴킷(WPF·WinForms·MAUI·Avalonia·JavaFX·Swing·Qt 류) 화면 코드에서 비동기·백그라운드 작업, 타이머, 이벤트·바인딩, 뷰모델·컨트롤러 구조를 추가하거나 바꿀 때 |
| `desktop--40-packaging-distribution` | 패키징·배포: 서명·공증·업데이트·설치 | 필요할 때: 데스크톱 앱의 설치 프로그램·패키지 형식, 코드 서명·공증, 자동 업데이트, 번들 식별자·버전, 권한(entitlement·매니페스트·샌드박스) 설정, 배포 CI 단계를 추가하거나 바꿀 때 |

</details>

<details>
<summary><b>frontend</b> · 프론트엔드 공통 원칙: API·상태·접근성·보안·성능·i18n·검증</summary>

프레임워크와 무관한 화면 원칙: 작업 전 점검, 생성 API 클라이언트·파일 배치·반응형, 상태 관리(서버/URL/폼/전역), 로딩·빈/오류 상태·오류 문구·알림·확인창, 권한 게이팅(비활성 + 이유, 인가는 서버), URL 상태, 접근성(WCAG 2.2 AA·APG), 폼·숫자/날짜 포맷, 브라우저 보안(XSS·토큰·CSP·의존성), 성능(Core Web Vitals·예산·캐시), 문구·i18n·시간대, 테스트·브라우저 검증

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택의 계층이 frontend 일 때 (4종: React, Angular, Vue, Svelte) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `frontend--10-frontend-baseline` | 프론트엔드 작업 전 점검 | 상시 |
| `frontend--20-structure-and-api` | 화면 구조·API 연동·파일 배치·반응형 | 필요할 때: 화면 코드 파일을 추가·이동·이름 변경하거나, 화면에 API 호출을 붙이거나 바꿀 때, 레이아웃·반응형·스타일·패키지를 바꿀 때 |
| `frontend--30-permission-gating` | 권한 게이팅 (비활성 + 이유 툴팁) | 필요할 때: 권한에 따라 버튼·입력 등 컨트롤을 막거나, 메뉴(권한 단위)에 엔드포인트를 배치·이동할 때 |
| `frontend--40-feedback-ui` | 로딩·빈/오류 상태·오류 문구·알림·확인창·모달 | 필요할 때: 로딩 표시·빈/오류 상태·오류 문구·알림(배너/토스트)·확인창·다이얼로그/드로어를 넣거나 바꿀 때 |
| `frontend--50-forms-and-inputs` | 폼·입력칸·숫자/날짜 표시·첨부 | 필요할 때: 폼·입력칸을 만들거나 저장 오류 처리를 붙일 때, 숫자·금액·비율·날짜를 표시하거나 입력받을 때, 파일 첨부를 넣을 때 |
| `frontend--60-url-state` | 화면 상태를 URL 에 | 필요할 때: 목록·상세 화면의 페이지·정렬·검색·필터·탭 상태를 만들거나 바꿀 때 |
| `frontend--65-state-management` | 화면 상태 관리 원칙 (서버 상태·클라이언트 상태·폼 상태) | 필요할 때: 화면에 상태(서버 데이터 캐시·전역 스토어·컴포넌트 상태·폼 값)를 새로 두거나 옮길 때, 저장 뒤 목록 갱신·낙관적 갱신을 붙일 때 |
| `frontend--70-keyboard-a11y` | 접근성 기준 (시맨틱·키보드·라벨·대비) | 필요할 때: 화면 요소(폼 컨트롤·버튼·링크·표·탭·드롭다운·모달·이미지·아이콘)를 새로 만들거나 고칠 때, 색·포커스 스타일·애니메이션을 바꿀 때, 접근성 검사를 돌릴 때 |
| `frontend--80-web-security` | 브라우저 쪽 보안 (XSS·비밀값·토큰·CSP) | 필요할 때: 서버·사용자·URL·외부에서 온 값을 화면에 그리거나 링크·리다이렉트에 쓸 때, HTML 을 직접 넣을 때, 토큰·세션·환경 변수·외부 스크립트·postMessage·iframe 을 다룰 때, 새 패키지를 추가할 때 |
| `frontend--85-performance` | 화면 성능 기본 (레이아웃 흔들림·지연 로딩·예산·캐시·공개 페이지·측정) | 필요할 때: 이미지·폰트·임베드·큰 목록·무거운 컴포넌트나 라이브러리를 넣을 때, 번들·로딩 속도·반응 속도·캐시를 개선하거나 성능 문제를 조사할 때, 검색 노출이 필요한 공개 페이지를 만들 때 |
| `frontend--90-content-and-i18n` | UI 문구·다국어(i18n)·로캘·시간대 | 필요할 때: 버튼·라벨·안내·오류·빈 상태 문구를 쓰거나 고칠 때, 다국어 리소스를 다룰 때, 날짜·시각·숫자·통화를 로캘에 맞게 표시할 때 |
| `frontend--95-testing-and-verification` | 화면 테스트·완료 전 검증 | 필요할 때: 화면 코드 변경을 마무리하기 전, 화면·컴포넌트 테스트를 쓰거나 고칠 때, 테스트가 실패해 원인을 볼 때 |

</details>

<details>
<summary><b>infra</b> · 인프라·배포 계층 원칙: 환경 확정 · plan/diff 먼저 · 반영 승인 · 비밀 출처만</summary>

도구와 무관한 인프라·배포 원칙: 대상 환경(클러스터·컨텍스트·계정·워크스페이스) 확정, 운영 직접 반영 금지와 plan·diff·dry-run 근거, 파괴적 작업(destroy·삭제·state 조작) 건별 승인, 비밀은 출처만, 버전·이미지 태그 고정, 컨테이너 이미지(비루트·다단계·헬스체크), Kubernetes·Helm(리소스·프로브·보안 컨텍스트), IaC(원격 state·잠금·버전 고정·import), Ansible(check·diff·멱등), 배포 파이프라인(권한 최소·승인 단계). infra 역할(인프라 담당)을 더한다

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택의 계층이 infra 일 때 (5종: Docker, Docker Compose, Kubernetes, Terraform·OpenTofu, Ansible) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `infra--10-infra-safety` | 인프라 작업 안전 원칙 | 상시 |
| `infra--20-containers` | 컨테이너 이미지 · compose | 필요할 때: Dockerfile · Containerfile · compose 파일을 만들거나 고칠 때, 이미지 크기 · 빌드 시간 · 보안 지적을 다룰 때 |
| `infra--30-kubernetes` | Kubernetes · Helm | 필요할 때: Kubernetes 매니페스트 · Kustomize · Helm 차트 · values 를 만들거나 고칠 때, 배포 · 롤아웃 · 스케일 설정을 바꿀 때 |
| `infra--40-iac` | IaC (Terraform · OpenTofu · Ansible) | 필요할 때: Terraform · OpenTofu · Terragrunt 코드, state · 백엔드 · 모듈 · 프로바이더, Ansible 플레이북 · 인벤토리 · 롤을 만들거나 고칠 때 |
| `infra--50-pipelines` | 배포 파이프라인 | 필요할 때: CI · CD 파이프라인 설정(GitHub Actions · GitLab CI 등), 배포 단계 · 승인 단계 · 배포 권한 · 러너를 만들거나 고칠 때 |

**팀 에이전트 역할**: 인프라 (`infra`)

</details>

<details>
<summary><b>mobile</b> · 모바일 앱 공통 원칙: 메인 스레드·권한·비밀 저장·웹뷰 브리지·서명</summary>

프레임워크와 무관한 모바일 앱 원칙: 메인 스레드와 OS 강제 종료(ANR·워치독), OS 가 언제든 없애는 화면·프로세스 수명, 필요한 때만 묻는 권한과 용도 문구, Keychain·Keystore 비밀 저장과 백업 제외, HTTPS 강제, 딥 링크·인텐트 입력 검증, 오프라인·백그라운드 작업, 접근성, 서명 키·스토어 개인정보 신고. 네이티브(Android·iOS)와 크로스플랫폼(React Native·Flutter·KMP·MAUI), 웹뷰 기반 하이브리드(Capacitor·Cordova·Ionic 류)의 작업별 규칙

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택의 계층이 mobile 일 때 (10종: Android, iOS, Flutter, React Native, .NET MAUI, Kotlin Multiplatform, Capacitor, Ionic …) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `mobile--10-mobile-baseline` | 모바일 앱 기본 원칙 | 상시 |
| `mobile--20-hybrid-webview-bridge` | 웹뷰·브리지: 하이브리드 앱과 네이티브 연동 | 필요할 때: 모바일 앱에서 웹뷰(WebView·WKWebView)나 웹뷰 기반 셸(Capacitor·Cordova·Ionic 류)의 설정·허용 목록·CSP, 자바스크립트↔네이티브 브리지(자바스크립트 인터페이스·메시지 채널·플러그인), 크로스플랫폼 프레임워크의 네이티브 모듈·플랫폼 채널을 추가하거나 바꿀 때 |
| `mobile--30-permissions-privacy-storage` | 권한·개인정보·로컬 저장 | 필요할 때: 모바일 앱에서 권한(매니페스트 권한·런타임 요청·Info.plist 용도 문구), 개인정보 매니페스트·수집 데이터, 토큰·비밀·사용자 데이터의 로컬 저장(파일·DB·설정·보안 저장소), 백업 규칙, 외부 앱과의 데이터 공유(인텐트·콘텐츠 제공자·파일 공유)를 추가하거나 바꿀 때 |
| `mobile--40-lifecycle-offline-network` | 수명 주기·백그라운드·오프라인·네트워크·링크 | 필요할 때: 모바일 앱에서 화면·앱 수명 주기 처리, 상태 저장·복원, 백그라운드·예약 작업, 동기화·오프라인 동작, 네트워크 클라이언트·보안 설정(평문 허용·ATS·인증서 고정), 딥 링크·유니버설 링크·앱 링크 처리를 추가하거나 바꿀 때 |
| `mobile--50-release-signing-store` | 배포·서명·스토어: 빌드 설정과 심사 | 필요할 때: 모바일 앱의 서명 설정·키스토어·프로비저닝, 빌드 변형(디버그·배포)·빌드 설정, 버전 코드·앱 ID, 대상·최소 SDK 버전, 의존성·SDK 추가와 갱신, 스토어 제출 관련 설정(메타데이터·계정 삭제·개인정보 신고), 배포 CI 단계를 추가하거나 바꿀 때 |

</details>

<details>
<summary><b>tv</b> · TV 앱 공통 원칙: 리모컨 포커스·뒤로 키·안전 영역·재생 수명주기</summary>

프레임워크와 무관한 TV 앱 원칙: 10피트 화면(안전 영역·글자 크기·대비), 리모컨 방향키 포커스(모든 요소 도달·포커스 표시·뒤로 키), 텍스트 입력 최소화, 제한된 메모리, 재생 키·앱이 숨겨질 때 재생 정지·복귀·DRM, 런처·홈 연동, 스토어 인증 점검표(Android TV·tvOS·Tizen·webOS), 화면 낭독기, 실기기·리모컨만으로 확인

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택의 계층이 tv 일 때 (4종: tvOS, Android TV, Tizen, webOS) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `tv--10-tv-baseline` | TV 앱 기본 원칙 | 상시 |
| `tv--20-focus-navigation` | 포커스·리모컨 입력·10피트 화면 | 필요할 때: TV 앱에서 화면 레이아웃·포커스 이동·키(리모컨·방향키·뒤로·재생 키) 처리, 포인터(매직 리모컨 류) 대응, 텍스트 입력·로그인 화면, 화면 낭독기 이름·역할을 추가하거나 바꿀 때 |
| `tv--30-media-lifecycle` | 재생·수명주기·메모리 | 필요할 때: TV 앱에서 영상·음악 플레이어, 재생 키 처리, DRM·라이선스 요청, 앱이 숨겨지거나 다시 보일 때(백그라운드·일시정지·재실행)의 처리, 이어 보기, 네트워크 끊김 처리, 이미지·버퍼 메모리 사용을 추가하거나 바꿀 때 |
| `tv--40-platform-store` | 플랫폼 선언·런처 연동·스토어 점검 | 필요할 때: TV 앱의 매니페스트·설정 파일(AndroidManifest·Info.plist·config.xml·appinfo.json), 권한·기능 선언, 런처 아이콘·배너, 홈 화면 연동(채널·이어 보기·Top Shelf), 광고, 웹 콘텐츠 표시, 스토어 제출·인증 준비, 테스트 기기·에뮬레이터 설정을 추가하거나 바꿀 때 |

</details>

<details>
<summary><b>watch</b> · 워치 앱 공통 원칙: 짧은 상호작용·배터리·컴플리케이션·폰 연동</summary>

프레임워크와 무관한 스마트워치 앱 원칙: 몇 초 안에 끝나는 짧은 상호작용, 원형·작은 화면 배치와 글자 크기, 크라운·회전 입력, 상시 표시(AOD) 화면과 민감 정보 가리기, 배터리·백그라운드 실행 한도, 컴플리케이션·타일·위젯 갱신 예산, 알림 중복 방지, 폰 없이 동작(독립 실행)과 폰·워치 데이터 동기화, 건강·센서 데이터 권한과 개인정보, 원형·사각 화면과 실기기 확인

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택의 계층이 watch 일 때 (2종: watchOS, Wear OS) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `watch--10-watch-baseline` | 워치 앱 기본 원칙 | 상시 |
| `watch--20-watch-ui-input` | 워치 화면·입력·상시 표시·접근성 | 필요할 때: 워치 앱(watchOS·Wear OS)의 화면 배치·내비게이션, 글자 크기·터치 영역, 크라운·회전 입력, 상시 표시(AOD·ambient) 화면, 접근성 속성, 화면 미리보기·스크린샷 테스트를 추가하거나 바꿀 때 |
| `watch--30-watch-surfaces-background` | 워치 컴플리케이션·타일·알림·백그라운드 | 필요할 때: 워치 앱의 컴플리케이션·타일·위젯(스마트 스택), 알림(폰에서 넘어오는 알림 포함), 진행 중 활동, 백그라운드 작업·갱신 스케줄, 운동·오디오 같은 장시간 세션, 네트워크 요청 시점을 추가하거나 바꿀 때 |
| `watch--40-watch-companion-sync-health` | 워치 독립 실행·폰 연동·건강 데이터 | 필요할 때: 워치 앱의 독립 실행 여부 설정, 폰 앱과의 데이터 전송·동기화(WatchConnectivity·Wearable Data Layer 류), 워치에서의 로그인·인증, 건강·센서 데이터(HealthKit·Health Services 류) 권한·읽기·쓰기·전송을 추가하거나 바꿀 때 |

</details>

## 스택 팩

<details>
<summary><b>stack-android</b> · Android 스택: Android 구조(UI · 데이터 층) · ViewModel · Compose</summary>

Android: UI 층 · 데이터 층 분리 · 화면당 ViewModel · UiState · Compose 인자 · 상태 끌어올리기. 모바일 공통은 mobile 팩

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택이 android 일 때 (mobile 계층 팩과 함께) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `stack-android--10-android` | Android 구조 · ViewModel · Compose | 상시 |

</details>

<details>
<summary><b>stack-django</b> · Django 스택: Django 업무 로직 위치 · 모델 · 쿼리 · 설정</summary>

Django: 업무 로직 위치(서비스 · 선택자) · 뷰 · 시그널에 로직 금지 · DB 제약 · 쿼리 · 설정. 서버 공통은 backend 팩

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택이 django 일 때 (backend 계층 팩과 함께) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `stack-django--10-django` | Django 기본 규약 | 상시 |

</details>

<details>
<summary><b>stack-fastapi</b> · FastAPI 스택: FastAPI 라우터 · Pydantic 모델 · 의존성 · async · 설정</summary>

FastAPI: 얇은 라우터 · Pydantic 모델 분리 · Annotated 의존성 · async 안 블로킹 금지 · 설정 의존성. 서버 공통은 backend 팩

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택이 fastapi 일 때 (backend 계층 팩과 함께) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `stack-fastapi--10-fastapi` | FastAPI 기본 규약 | 상시 |

</details>

<details>
<summary><b>stack-flutter</b> · Flutter 스택: Flutter 구조(MVVM · Repository) · 위젯 나누기</summary>

Flutter: View · ViewModel · Repository 구조 · 위젯에는 표시만 · 작은 위젯 클래스 · 상태 범위. 모바일 공통은 mobile 팩

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택이 flutter 일 때 (mobile 계층 팩과 함께) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `stack-flutter--10-flutter` | Flutter 구조 · 위젯 | 상시 |

</details>

<details>
<summary><b>stack-nestjs</b> · NestJS 스택: NestJS 레이어 책임 · 모듈 경계 · 공통 처리 위치 · 파일 이름</summary>

NestJS: Controller · provider · Module 책임 · 모듈 경계 · 공통 처리는 pipe · guard · interceptor · 파일 이름. 서버 공통은 backend 팩

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택이 nestjs 일 때 (backend 계층 팩과 함께) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `stack-nestjs--10-nestjs` | NestJS 레이어 책임 · 모듈 · 공통 처리 | 상시 |

</details>

<details>
<summary><b>stack-nextjs</b> · Next.js 스택: Next.js App Router 레이어 책임 · 데이터 접근 층 · 배치</summary>

Next.js(App Router): page · route · Server Action 책임 · server-only 데이터 접근 층 · 배치. stack-react 와 함께 붙는다

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택이 nextjs 일 때 (frontend 계층 팩과 함께) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `stack-nextjs--10-nextjs` | Next.js 레이어 책임 · 데이터 접근 층 | 상시 |

</details>

<details>
<summary><b>stack-postgres</b> · PostgreSQL 스택: PostgreSQL 문법 · 잠금 · 확장·시퀀스 함정</summary>

PostgreSQL 전용 규칙: 트랜잭션 DDL 로 건수 시험, CONCURRENTLY 는 트랜잭션 밖, search_path·식별자 대소문자, 확장 설치 스키마, 시퀀스 보정, SELECT DISTINCT + ORDER BY 식, 스키마 순회 DO 블록, 잠금 시간 제한

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택이 postgres 일 때 (db 계층 팩과 함께) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `stack-postgres--10-postgres` | PostgreSQL 작업 규칙 | 상시 |
| `stack-postgres--20-sql-patterns` | PostgreSQL SQL 패턴과 함정 | 필요할 때: PostgreSQL 에 DDL·백필·정리 SQL 을 쓰거나, 여러 스키마를 도는 스크립트·인덱스·시퀀스·확장을 다룰 때 |

</details>

<details>
<summary><b>stack-react</b> · React 스택: React·TanStack Query·라우터 구현 규약</summary>

React + TypeScript + Vite + TanStack Query + React Router 구현 규약: 생성 쿼리 옵션·쿼리 키, 훅 사용, URL 상태 훅, 폼·다이얼로그 구현, 접근성 속성 + a11y 라벨·런타임 검사기, 공용 폴더 배치 검사기. 화면 공통 원칙은 frontend 레이어 팩

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택이 react 일 때 (frontend 계층 팩과 함께) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `stack-react--10-react-baseline` | React 구현 기본 규약 | 상시 |
| `stack-react--20-react-patterns` | React 구조·쿼리·URL·폼·다이얼로그 구현 | 필요할 때: React 화면 코드를 새로 쓰거나 고칠 때 (파일 추가·이동, TanStack Query 연동, URL 상태·폼·다이얼로그 구현 포함) |
| `stack-react--30-react-a11y` | React 접근성 구현·검사기 | 필요할 때: React 폼 컨트롤·버튼·표·탭·드롭다운·모달을 만들거나 고칠 때, 접근성 검사기를 돌리거나 공용 입력 컴포넌트를 추가할 때 |
| `stack-react--40-logic-placement` | React 컴포넌트 책임 · 로직 위치 | 상시 |

**스킬**

| 이름 | 설명 |
|---|---|
| `form-validation-pattern` | 폼 저장 오류 처리 공통 패턴: 서버 검증 오류(errors[] 의 field·message)를 그 입력칸 아래 인라인으로 표시한다. 폼·드로어·다이얼로그에 생성/수정 저장을 붙이거나 "검증 오류가 안 보인다" 를 고칠 때 쓴다. |

**도구**: `bin/check-a11y-labels.py` · `bin/check-a11y-runtime.js` · `bin/check-shared-placement.js`

</details>

<details>
<summary><b>stack-spring</b> · Spring 백엔드 스택: Spring·JPA·QueryDSL 트랜잭션·쿼리 규칙</summary>

Spring Boot + JPA + QueryDSL 구체 규칙: @Transactional 기본값·checked 예외 롤백 함정, 파생 쿼리/QueryDSL/네이티브 SQL 정책, 엔티티당 리포지토리, 복합 키 값 객체, 대량 처리 예외, MapStruct·Bean Validation + 쿼리 술어 추출기·QueryDSL 런타임 오류 검사기·로깅 검사기. 계층·API 계약 원칙은 backend 팩

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 스택이 spring 일 때 (backend 계층 팩과 함께) |
| 함께 붙는 팩 | `core` · `backend` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `stack-spring--10-spring-baseline` | Spring 기본 규약 | 상시 |
| `stack-spring--20-layers-and-naming` | Spring 패키지 구조·이름·Javadoc | 필요할 때: Spring 백엔드에 클래스·패키지를 새로 만들거나, 메서드 이름을 짓거나, Javadoc 을 달 때 |
| `stack-spring--30-persistence` | Spring 데이터 접근: 리포지토리·QueryDSL·네이티브 SQL | 필요할 때: Repository·QueryDSL·네이티브 SQL 로 DB 를 읽거나 쓰는 코드를 새로 쓰거나 고칠 때 (대량 수정·삭제·복제 포함) |
| `stack-spring--40-api-and-validation` | Spring 기존 관례 찾기·입력 검증 | 필요할 때: Spring 에서 엔드포인트를 새로 만들거나 요청·응답·예외·검증·사용자 메시지를 정하거나 바꿀 때 |
| `stack-spring--50-logging` | Spring 로깅 | 필요할 때: Spring 백엔드에서 로그를 새로 넣거나, 예외를 잡아 로그로 남기는 코드·@RestControllerAdvice 를 고칠 때 |
| `stack-spring--60-clean-code` | Spring 레이어 책임 · 주입 · 설정값 | 상시 |

**도구**: `bin/check-logging-convention.js` · `bin/check-querydsl-distinct-order.js` · `bin/check-querydsl-projection-arity.js` · `bin/query-predicates.js`

</details>

## 언어 팩

<details>
<summary><b>clean-code</b> · 클린 코드 공통: 이름 · 함수 · 클래스 · 주석 · 읽히는 코드 · 레이어 책임 (언어 공통)</summary>

언어가 감지된 모든 코드 repo 에 붙는 클린 코드 공통 규칙: 이름 · 함수 · 모듈 · 주석 · 읽히는 코드 · 레이어 파일에 private 상수 · 함수 늘어놓지 않기와 공통 로직 위치. 근거는 클린 코드 규칙 문서

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 에 감지된 언어(Java · Kotlin · Python · C · C++ · Swift · Dart · TypeScript · JavaScript · Go · C#)가 하나라도 있을 때 |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `clean-code--10-clean-code` | 클린 코드 공통 | 상시 |
| `clean-code--20-layer-responsibility` | 레이어 책임 · 공통 로직 추출 | 상시 |

</details>

<details>
<summary><b>lang-c</b> · C 클린 코드: C 이름 · 함수 · 모듈 · 메모리 · 오류 처리</summary>

C 소스가 있는 repo 에: 이름 · 함수 · 모듈 · 반환값 확인 · 정리 경로 · 위험 함수 금지

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 에 C 소스가 있을 때 (언어 감지) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `lang-c--10-c` | C 클린 코드 | 상시 |

</details>

<details>
<summary><b>lang-cpp</b> · C++ 클린 코드: C++ 이름 · 함수 · 클래스 · 소유권(RAII) · const · 오류 방식</summary>

C++ 소스가 있는 repo 에: 출력은 반환값 · rule of zero · RAII · 소유권 · const · 오류 방식 하나

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 에 C++ 소스가 있을 때 (언어 감지) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `lang-cpp--10-cpp` | C++ 클린 코드 | 상시 |

</details>

<details>
<summary><b>lang-dart</b> · Dart 클린 코드: Dart 이름 · 함수 · 변수 · 타입 · 비동기 · 문서 주석 (Effective Dart)</summary>

Dart 소스가 있는 repo 에: Effective Dart 이름 · final · const · 불변 · sealed · async · 문서 주석

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 에 Dart 소스가 있을 때 (언어 감지) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `lang-dart--10-dart` | Dart 클린 코드 | 상시 |

</details>

<details>
<summary><b>lang-java</b> · Java 클린 코드: Java 이름 · 메서드 · 클래스 · Javadoc · 관용구</summary>

Java 소스가 있는 repo 에: 이름 · 메서드 · record · sealed · Optional · Javadoc · 관용구

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 에 Java 소스가 있을 때 (언어 감지) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `lang-java--10-java` | Java 클린 코드 | 상시 |

</details>

<details>
<summary><b>lang-kotlin</b> · Kotlin 클린 코드: Kotlin 이름 · 함수 · 클래스 · KDoc · 관용구</summary>

Kotlin 소스가 있는 repo 에: 이름 · 식 본문 · 불변 · data · sealed · KDoc · 스코프 함수 · !! 금지

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 에 Kotlin 소스가 있을 때 (언어 감지) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `lang-kotlin--10-kotlin` | Kotlin 클린 코드 | 상시 |

</details>

<details>
<summary><b>lang-python</b> · Python 클린 코드: Python 이름 · 함수 · 타입 힌트 · docstring · 관용구 · ML/AI 코드</summary>

Python 소스가 있는 repo 에: PEP 8 이름 · 함수 · 타입 힌트 · docstring · 예외 · 관용구. ML · AI 코드는 작업할 때 읽는 규칙

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 에 Python 소스가 있을 때 (언어 감지) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `lang-python--10-python` | Python 클린 코드 | 상시 |
| `lang-python--20-ml-ai` | ML · AI 코드 | 필요할 때: 학습 · 추론 · 데이터 전처리 · 노트북 · LLM 호출(프롬프트 · 모델 설정) 코드를 쓰거나 고칠 때 |

</details>

<details>
<summary><b>lang-swift</b> · Swift 클린 코드: Swift 이름(API Design Guidelines) · 인자 레이블 · 타입 · DocC · 동시성 · SwiftUI</summary>

Swift 소스가 있는 repo 에: 문장처럼 읽히는 이름 · 인자 레이블 · 타입 · DocC · 동시성 · SwiftUI

| 항목 | 내용 |
|---|---|
| 붙는 조건 | repo 에 Swift 소스가 있을 때 (언어 감지) |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `lang-swift--10-swift` | Swift 클린 코드 | 상시 |

</details>

## 산출물 팩

<details>
<summary><b>datamodel</b> · 데이터 설계: 테이블 정의서 양식 · ERD 뷰어 · datamodel 스킬 · 검사</summary>

데이터 설계를 같은 양식 · 같은 뷰어로: md 테이블 정의서(스키마마다 한 파일, 「### 스키마.테이블 논리명」 + 컬럼 표), ERD 뷰어(kedovi docs build 가 정의서에서 생성. 영역 덩어리 배치 · 영역 개요 카드 · 관계 중심 배치 · 논리 참조 점선 · 이름 보기 · 표시 수준 자동 전환 · 돋보기 · 미니맵 · 사이드바 스키마 접기 · 주제 영역 보기 · 참조 많은 표 선 숨김 · 상세 드로어 · 기능 ID 근거 패널 · Export SQL DDL · SVG · PDF · 영역마다 PDF), 데이터 설계 절차(datamodel 스킬: 진행 방식 합의 → DB 컨벤션 → 엔티티 목록 → 테이블 정의서 → ERD → 검사), 검사(kedovi datamodel check: 참조 · 기본키 · 중복 · 표 형식 · 컨벤션 · 기능 ID 대조 · 논리 참조 · 고정 스키마 예외 · JSON 사유). DB 컨벤션은 프로젝트가 정한다(vars.datamodel). 신규 · 차세대 유형은 기본으로 켜진다

| 항목 | 내용 |
|---|---|
| 붙는 조건 | 시작 유형이 신규 구축 · 차세대 (재구축 · AS-IS → TO-BE) 이면 기본. 다른 유형은 kedovi upgrade --add datamodel |
| 함께 붙는 팩 | `core` |

**스킬**

| 이름 | 설명 |
|---|---|
| `datamodel` | 데이터 설계(테이블 정의서 · ERD)를 킷 양식으로 만든다. 진행 방식 합의 → DB 컨벤션 정하기 → 엔티티 목록(기능 ID 대조) → 스키마별 테이블 정의서 → ERD 생성과 검사 → 문서 사이트 반영. "데이터 설계", "테이블 정의서", "ERD", "DB 설계", "스키마 설계" 요청에 쓴다. |

**도구**: `bin/check-datamodel.js`

</details>

<details>
<summary><b>screens</b> · 화면설계서: 화면설계서 양식 · 뷰어 · screens 스킬 · 검사 · 프로토타입대로 구현 · 화면 비교</summary>

화면의 정본은 프로토타입(기본: 화면 목록 · 정책 · 스크린샷만) 또는 화면설계서 중 하나로 고른다. 화면설계서(스토리보드)를 같은 양식 · 같은 뷰어로: 장 양식(표지 · 변경 이력 · 메뉴 구조 · 정책 · 화면, 가로 1280×760), 뷰어(썸네일 · 발표 · A4 가로 인쇄 · 한 쪽 넘침 표시 · 내부 정보(Check Point · 근거 ID · sb-dev) 숨김과 I 키 토글 · 근거 ID 를 누르면 오른쪽 패널에 근거 문서), 화면설계 절차(screens 스킬: 진행 방식 합의 → 화면 정책 → 화면 목록 → 장 작성 → 문서 사이트 반영), 프로토타입대로 구현(상시 규칙: 프로토타입이 있으면 화면 구현이 구성 · 스타일을 따르고 다르게 만든 곳은 「프로토타입 요소 \| 구현 \| 다른 이유」 표로 보고 · MR 에 남긴다), 화면 비교(kedovi screens compare <화면 ID>: 프로토타입과 구현을 같은 폭 PC · 폰으로 찍어 나란히 보는 compare.html), 검사(Related ID · 근거 ID 가 색인에 있는지 · Description 이 결론 한 줄인지 · 화면 ID 중복 · 기능 ID 누락). 문서 사이트는 core 의 kedovi docs build 가 만든다. 신규 · 차세대 유형은 기본으로 켜진다

| 항목 | 내용 |
|---|---|
| 붙는 조건 | 시작 유형이 신규 구축 · 차세대 (재구축 · AS-IS → TO-BE) 이면 기본. 다른 유형은 kedovi upgrade --add screens |
| 함께 붙는 팩 | `core` |

**규칙**

| ID | 제목 | 읽는 때 |
|---|---|---|
| `screens--10-prototype-fidelity` | 프로토타입 충실도 | 필요할 때: 화면설계서나 기획 확인용으로 동작하는 화면(프로토타입·목업·시안)을 만들거나 고칠 때 |
| `screens--20-implement-from-prototype` | 프로토타입대로 구현 | 상시 |

**스킬**

| 이름 | 설명 |
|---|---|
| `screens` | 화면설계서(스토리보드)를 킷 양식으로 만든다. 진행 방식 합의 → 화면 정책 → 화면 목록(화면 ID ↔ 기능 ID 대조) → 화면별 장 작성 → 문서 사이트 반영과 검사. "화면설계", "화면설계서", "스토리보드", "와이어프레임" 요청에 쓴다. |

**도구**: `bin/check-screens.js` · `bin/compare-screens.js`

</details>
<!-- /packs:catalog -->
