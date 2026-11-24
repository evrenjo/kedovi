# 빠른 시작

kedovi 은 팀이 같은 규칙으로 AI 에이전트(Claude Code · Codex)와 일하게 해 주는 **작업 공간(워크스페이스)** 을 만든다.
워크스페이스는 git repo 하나이고, 개발 repo 들은 그 안 `repos/` 에 따로 clone 된다.

## 1. 준비 (PC 마다 1번)

| 필요한 것 | 설치 · 확인 |
|---|---|
| Node.js 20.19 이상 · git | `node -v` · `git --version` |
| 에이전트 CLI | 쓰는 AI 에 맞게: Claude 구독·게이트웨이 = Claude Code `npm i -g @anthropic-ai/claude-code`, GPT 구독 = Codex `npm i -g @openai/codex` |
| kedovi | [설치](../README.md#설치-pc-마다-1번) 절을 따른다 (확인 → registry → 로그인 → 설치) |
| git 인증 | 회사 GitLab·GitHub 주소로 `git clone` 을 한 번 해 두면 된다 (호스트마다 한 번) |
| 저장소 로그인 (팀) | `gh auth login` · `glab auth login` 또는 SSH 키. 이 PC 사용자(팀장 · 담당 repo)를 확인한다 |
| 플러그인 · MCP | 권장 claude-mermaid · Playwright MCP, 선택 telegram · pixel-agents. 목록과 설치 명령은 [README 의 플러그인 · MCP · 도구](../README.md#플러그인--mcp--도구). `kedovi doctor` 가 빠진 것을 알린다 |

Claude·GPT 를 모두 구독하거나 AI 게이트웨이를 쓰면 역할마다 두 회사 모델을 섞어 쓸 수 있다 ([AI 연결 방식](team-models.md#ai-연결-방식)).

## 2. 유형별 진행 예시

프로젝트 성격에 맞는 유형을 펼쳐 위에서부터 따라 하면 워크스페이스 구성부터 첫 작업까지 끝난다. `kedovi init` 은 유형을 묻지 않는다: 프로젝트명과 repo 만 받고, 유형은 첫 `kedovi start` 의 방향 인터뷰에서 답한다. 유형에 따라 에이전트가 따르는 규칙·스킬이 다르다.

| 유형 | 이럴 때 | 에이전트의 근거 |
|---|---|---|
| 신규 구축 | 새 시스템을 처음 만든다 | 기획 문서 |
| 차세대 | 옛 시스템(AS-IS)을 새로 다시 만든다 | 기획 문서 + 레거시 소스 (읽기 전용) |
| 운영·고도화 (SM 포함) | 운영 중인 시스템을 고치고 늘린다 | 운영 코드 + 개선 요구사항 · 티켓 |
| 분석·설계 (ISP·ISMP) | 구축 전에 분석하고 설계 문서를 만든다 | 인터뷰 · 현행 문서 · 현행 소스 (결과물은 문서) |

<details>
<summary><b>신규 구축</b>: 새 시스템을 처음 만든다</summary>

**① 준비할 repo**

| repo | 없으면 |
|---|---|
| 워크스페이스 repo (예: `order`) | 지금은 없어도 된다. 팀과 나눌 때 GitLab·GitHub 에 빈 비공개 repo 를 만들고 `kedovi remote add <주소>` |
| 코드 repo (예: `order-api` · `order-web`) | 만들지 않아도 된다. init 에서 이름만 입력하면 새로 만든다 |
| 기획 문서 | 따로 repo 를 만들지 않아도 된다. 방향 인터뷰가 워크스페이스 `docs-site/` 에 개요 · 설계 · 기능 문서 초안을 만든다. 이미 쓰던 기획 repo 가 있으면 init 에서 「기존 기획 repo 연결」 |

**② 워크스페이스 만들기**

```bash
kedovi init order
```

| 질문 | 답 |
|---|---|
| 프로젝트명 | `order` |
| repo 등록: 종류 | 코드 → 저장소가 있으면 clone(주소), 없으면 새로 만들기(이름만, `order-api`). 「추가」 로 여러 개, 다 넣었으면 「확정」 |
| repos/order-api 스택 | 새 repo 는 코드가 없어 감지되지 않는다. 서버·클라이언트 → 프레임워크 → DB 를 직접 고른다 (그래야 그 기술 규칙이 붙는다) |
| 쓰는 AI · 팀 기본 모델 프로필 | 구독한 것(Claude 만 · GPT 만 · Claude + GPT), AI 게이트웨이면 "AI 게이트웨이". 프로필은 추천대로 |

init 은 첫 커밋(`chore: init workspace`)까지 한다. 원격은 붙이지 않는다.

**③ 팀에 올리기**

```bash
cd order
kedovi remote add <워크스페이스 repo 주소>      # origin 추가 · push (공개 repo 면 확인)
# 이름만 입력해 새로 만든 코드 repo 는 원격을 만든 뒤
git -C repos/order-api remote add origin <order-api 주소> && git -C repos/order-api push -u origin HEAD
kedovi sync      # workspace.json 에 원격 주소를 기록한다 → commit · push
```

팀원은 아래 "4. 팀원: 합류" 대로 한다.

**④ 첫 작업**

```bash
kedovi start
```

1. 처음 시작하면 **방향 인터뷰**를 한다 (`kickoff` 스킬, 한 번에 한 질문): 무엇 · 누가 쓰나 → 유형(신규 구축이면 「새로 만든다」) → 기존 자료 → 첫 기능 목록 · 마일스톤 → 개발 표준 → 규칙. 결과는 `docs-site/` 의 개요 · 설계 · 기능 문서 초안이고, 끝나면 `kedovi kickoff done`.
1. 처음 계정을 물으면 git · GitLab 에서 쓰는 아이디와 이름을 적는다 (원격이 없으면 묻는다).
1. 기능 문서(`docs-site/기능/`)를 다듬고 기능 하나씩 명세 → 설계 → AI 구현 → 검증 → 배포로 진행한다 (진행 방식 기능 단위).
2. 에이전트에게 요구사항 ID 로 시킨다: "REQ-ORD-001 주문 목록 화면 만들어줘".
3. 에이전트가 영향 범위 · 할 일 · 검증 계획을 먼저 보이고, 필요하면 역할 에이전트(분석 · 설계 · 구현 · 테스트 · 리뷰)를 불러 진행한다.
4. "리뷰" 로 변경을 검토받고, 하루 끝에 "핸드오프".

</details>

<details>
<summary><b>차세대</b>: 옛 시스템(AS-IS)을 새로 다시 만든다</summary>

**① 준비할 repo**

| repo | 없으면 |
|---|---|
| 워크스페이스 repo | 팀과 나눌 때 빈 비공개 repo (`kedovi remote add`) |
| 레거시(AS-IS) 소스 | **필수.** git 주소나 이 PC 의 폴더. 에이전트는 읽기만 한다 |
| TO-BE 코드 repo | init 에서 이름만 입력하면 새로 만든다 |
| 기존 기획 repo | 있으면 init 에서 연결 (없으면 방향 인터뷰가 `docs-site/` 에 초안) |

**② 워크스페이스 만들기**

```bash
kedovi init next-order
```

| 질문 | 답 |
|---|---|
| repo 등록: 종류 | 코드 → TO-BE repo 주소 또는 이름만 · 「추가」 → 참고 자료 (레거시) → AS-IS 소스 주소 또는 폴더 · (있으면) 기존 기획 repo 연결 → 「확정」 |
| repos/<TO-BE> 스택 | 새 repo 면 직접 고른다 (레거시 repo 는 스택을 묻지 않는다) |
| 쓰는 AI · 프로필 | 추천대로 |
| (첫 kedovi start) 방향 인터뷰의 유형 | 옛 시스템을 옮긴다 → `kedovi type modernization --approach feature` |

올리기와 팀원 합류는 신규 구축과 같다.

**③ 첫 작업**

1. 기능 하나를 골라 AS-IS 부터 조사한다: "주문 등록 AS-IS 분석해줘" (`asis-analysis-team` 스킬: 레거시 소스 · DB 정의 · TO-BE 코드를 나눠 조사해 비교 보고서).
2. 분석을 근거로 구현한다: "주문 등록 TO-BE 구현해줘. AS-IS 와 같게".
3. 정합을 확인한다: "주문 등록 AS-IS 대조해줘" (`asis-compare` 스킬: 쓰는 표 · 컬럼 값 · 읽기 조건을 도구로 뽑아 정합표, 판정마다 확인됨 · 추정 · 미확인).
4. 고객 요구 티켓이 AS-IS 와 다르게 요구하면 티켓이 우선이다 (정합표에 "티켓 기준" 으로 표시된다).

에이전트는 AS-IS 정합 규칙(저장 · 복사 · 조회 대조)과 데이터 이행 원칙을 따른다.

</details>

<details>
<summary><b>운영·고도화 (SM 포함)</b>: 운영 중인 시스템을 고치고 늘린다</summary>

**① 준비할 repo**

| repo | 없으면 |
|---|---|
| 워크스페이스 repo | 팀과 나눌 때 빈 비공개 repo (`kedovi remote add`) |
| 운영 코드 repo | **필수.** 지금 운영 중인 소스 저장소 주소 |
| 개선 요구사항 · 업무 문서 repo | 있으면 (없으면 건너뛴다) |
| 이미 쓰는 이슈 repo | init 에서는 묻지 않는다. 필요하면 `kedovi repo add <주소> --kind issues` |

**② 워크스페이스 만들기**

| 질문 | 답 |
|---|---|
| repo 등록: 종류 | 코드 → 운영 코드 repo 주소 · (있으면) 기존 기획 repo 연결 → 개선 요구사항 · 업무 문서 repo → 「확정」 |
| repos/<이름> 스택 | 기존 코드라 자동 감지된다. 맞으면 [맞음] |
| 쓰는 AI · 프로필 | 추천대로 |
| (첫 kedovi start) 방향 인터뷰의 유형 | 운영 중인 서비스를 고친다 → `kedovi type enhancement --approach feature` (이슈마다 운영 반영이 주된 일이면 `--approach issue`) |

올리기와 팀원 합류는 신규 구축과 같다 (새로 만드는 repo 가 없어 ③ 의 원격 등록은 필요 없다).

**③ 첫 작업**

| 할 일 | 에이전트에게 |
|---|---|
| 장애 · 결함 · QA 지적 처리 | "IM-360 처리해줘" (`ticket` 스킬: 영향 범위 → 재현 → 원인 확정 → 수정 → 검증 → 조치 보고) |
| GitHub · GitLab 이슈 | "#12 이슈 처리해줘" (이슈를 읽고 `ticket` 으로 처리, 끝나면 조치 보고 댓글을 제안) · "이슈 등록해줘: <내용>" (초안 · 비슷한 이슈 · 민감정보 검사를 보이고 OK 뒤 등록) |
| 기능 개선 | "주문 목록에 기간 검색 추가해줘" (영향 범위 · 할 일 · 검증 계획을 먼저 보인다) |
| 지난 작업 찾기 | "IM-360 전에 어디까지 했지" (작업별 핸드오프 기록을 찾는다) |

에이전트는 기존 동작을 지키는 규칙을 따른다. 지금 동작을 테스트로 고정한 뒤 바꾸고, 운영 환경은 조회만 하며, 데이터 보정은 스크립트로 만들어 승인을 받는다.

</details>

<details>
<summary><b>분석·설계 (ISP·ISMP)</b>: 구축 전에 분석하고 설계 문서를 만든다</summary>

**① 준비할 repo**

| repo | 없으면 |
|---|---|
| 워크스페이스 repo | 팀과 나눌 때 빈 비공개 repo (`kedovi remote add`) |
| 산출물(문서) repo | `kedovi init-docs deliverables` 로 뼈대를 만들어 push (나중에 해도 된다) |
| 현행 시스템 소스 | 있으면 주소나 폴더 (읽기 전용 분석용, 선택) |

코드 repo 는 묻지 않는다. 이 유형은 코드를 고치지 않는다.

**② 워크스페이스 만들기**

| 질문 | 답 |
|---|---|
| repo 등록: 종류 | 기존 기획 repo 연결 → 산출물 repo 주소 · (있으면) 참고 자료 (레거시) → 현행 소스 → 「확정」 |
| 쓰는 AI · 프로필 | 추천대로 |
| (첫 kedovi start) 방향 인터뷰의 유형 | 구축 전 분석만 → `kedovi type consulting` |

**③ 첫 작업**

1. 인터뷰 기록 · 현행 문서를 산출물 repo 에 넣는다 (원본은 `originals`, md 사본은 `md`).
2. "인터뷰 기록으로 요구사항 정리해줘" (`requirements` 스킬: ID · 설명 · 수용 기준 · 출처 · 우선순위를 갖춘 요구사항 정의서).
3. 현행 소스가 있으면 "현행 주문 처리 흐름 분석해줘". 분석 역할 에이전트가 소스를 읽고 근거와 함께 정리한다.
4. 목표 모델 · 이행 계획 · RFP 문서도 같은 방식으로 산출물 repo 에 만든다. 모든 내용에 출처를 단다.

</details>

## 3. 팀 리더: 워크스페이스 생성 (프로젝트당 1번)

1. 상위 폴더에서 만든다 (입력한 이름으로 폴더를 만든다).

```bash
kedovi init order
```

2. 화면에서 차례로 고른다: 프로젝트명 → repo 등록(종류: 코드 · 참고 자료 (레거시) · 기존 기획 repo 연결, 「추가」 로 여러 개 · 「확정」 으로 끝) → 확인 → 스택 확인 → 쓰는 AI → 팀 모델 프로필 → 실행 인자. 끝나면 첫 커밋(`chore: init workspace`)까지 한다. 원격은 붙이지 않는다.
3. 첫 `kedovi start` 에서 방향 인터뷰(무엇 · 누가 · 유형 · 첫 기능 · 개발 표준 · 규칙)를 한다.
4. 팀과 나눌 때: GitLab·GitHub 그룹에 빈 비공개 repo 를 만들고 (예: `order`)

```bash
kedovi remote add <워크스페이스 repo 주소>
```

- 막 clone 한 빈 repo 안에서 `kedovi init` 해도 된다. 기존 README·LICENSE 는 그대로 두고, `.gitignore` 는 필요한 줄만 덧붙인다 (원격이 이미 있으니 `git push -u origin HEAD` 만).

5. (선택) 팀 명단: `kedovi team add 이개발 박개발` → commit · push.

## 4. 팀원: 합류

```bash
git clone <워크스페이스 repo 주소>
cd order
kedovi install
```

- `repos/` 에 개발 repo 들이 자동으로 clone 된다. 권한 없는 repo 는 "인증 필요" 로 알려 준다.
- 쓰는 AI(Claude 만 · GPT 만 · Claude + GPT · AI 게이트웨이)와 실행 인자를 고르고, "팀에 합류 기록을 올릴까요?" 에 예를 누르면 팀 현황에 바로 보인다.

## 5. 일상 사용

```bash
kedovi start            # 정한 에이전트로 시작 (이번만 바꾸려면 --claude · --codex)
```

| 할 일 | 에이전트에게 말하기 | 터미널 |
|---|---|---|
| 어제 하던 일 이어서 | "재개" | |
| 일 시키기 | "주문 목록에 페이지네이션 추가해줘" (큰 일은 역할을 나눈 계획을 먼저 보여 준다) | |
| 하루 마무리 | "핸드오프" (한 일 · 미완 작업을 팀에 공유. 개인 할 일은 "TODO 에 넣어줘") | |
| 팀이 어디까지 했나 | "팀 현황" | `kedovi team` |
| 다른 사람 일 이어받기 | "인수인계 이개발" | `kedovi team 이개발` |
| 모델 바꾸기 | "리뷰는 GPT 로 바꿔줘" | `kedovi models` |
| 구독·게이트웨이 바꾸기 | "이제 GPT 만 써" | `kedovi ai` |
| 무언가 이상할 때 | "진단" | `kedovi doctor` |

## 6. 처음 한 번 확인

- **Claude Code**: 처음 실행할 때 이 폴더를 신뢰하겠냐고 물으면 수락한다 (그래야 규칙·훅이 적용된다).
- **Codex**: 처음 실행할 때 이 프로젝트를 trusted 로 지정하고, `/hooks` 에서 훅을 신뢰한다.
- 킷이 새 버전이면 `kedovi start` 가 지금 올릴지 묻는다 (올릴 수 없는 팀원 · 받지 않은 커밋이 있으면 알리기만). 리더가 올려 commit · push 하면 팀원은 `git pull` 로 받는다.
- `npm i -g` 로 새 버전을 받은 뒤 이 PC 의 워크스페이스를 모두 올리려면 `kedovi upgrade --all` (처음 쓰는 폴더는 `--scan ~/projects`).

## 관련 문서

| 알고 싶은 것 | 문서 |
|---|---|
| 선택 화면마다 무엇을 묻고 어디에 저장하나 | [업무 흐름](workflow.md) |
| 명령 전체 | [명령](commands.md) |
| 인수인계 (handoff · 재개 · 인수 · 팀 현황) | [인수인계](handoff.md) |
| 역할별 모델 · Claude · GPT 혼용 | [팀 에이전트와 모델](team-models.md) |
| 저장소 없이 새 repo 로 시작하기 | [workspace.json · 설정](workspace.md#저장소-없는-시작) |
