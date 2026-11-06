# kedovi AI 협업 워크스페이스 킷

**AI 에이전트로 팀 개발할 때, 모두가 같은 규칙으로 일하고 누구든 이어받게 해 주는 협업 워크스페이스 킷**

[![ci](https://github.com/evrenjo/kedovi/actions/workflows/ci.yml/badge.svg)](https://github.com/evrenjo/kedovi/actions/workflows/ci.yml)
![status](https://img.shields.io/badge/status-0.x%20%EA%B0%9C%EB%B0%9C%20%EC%A4%91-orange)
![node](https://img.shields.io/badge/node-%3E%3D20.19-339933?logo=nodedotjs&logoColor=white)
![Claude Code](https://img.shields.io/badge/Claude%20Code-supported-D97757)
![Codex](https://img.shields.io/badge/Codex-supported-412991)
[![docs](https://img.shields.io/badge/docs-site-0969da)](https://evrenjo.github.io/kedovi/)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> 🚧 **개발 중 (0.x)**: 개인 작업에 쓰려고 만든 도구를 공개한 것입니다. 정식 버전 전까지는 명령 · 설정 형식이 예고 없이 바뀔 수 있고, 바뀐 내용은 [변경 기록](CHANGELOG.md)에 버전마다 남깁니다.
>
> ⚠️ **사용 책임**: 쓰다가 생기는 문제(파일 · 데이터 손실, AI 사용 요금, 보안 사고 등)는 책임지지 않습니다 ([MIT 라이선스](LICENSE)의 「있는 그대로」 조건). AI 에이전트가 파일을 고치고 명령을 실행하므로, 중요한 저장소에서는 커밋 · 백업을 해 두고 쓰세요.

### 문서 사이트

**https://evrenjo.github.io/kedovi/**

- 문서 원본은 md(`README.md` · `docs/*.md`)이고, `npm run docs` 가 기획 문서 사이트와 같은 생성기(`kedovi docs build`)로 `docs-site/` 를 만든다.

프로젝트마다 git repo 하나로 된 **워크스페이스**를 세우면, 누가 어느 PC 에서 Claude Code 나 Codex 를 켜도 같은 규칙으로 일하고, 한 일이 기록으로 남아 다음 사람이 바로 이어받는다.

> 처음이면 [빠른 시작](docs/quickstart.md) 부터. 문서를 브라우저로 보려면 위 「문서 사이트」 주소를 열거나 킷 repo 를 clone 했으면 `docs-site/index.html` 을 연다.

### 화면

**문서 사이트**: 기획 repo 의 md 를 검색 · 목차 · 흐름도가 있는 사이트로 만든다 (그림은 이 킷의 문서).

![문서 사이트](https://raw.githubusercontent.com/evrenjo/kedovi/main/.github/readme/docs-site.png)

**데이터 설계 (ERD)**: md 테이블 정의서에서 ERD 를 그린다. 영역 · 스키마로 거르고 SQL DDL · SVG · PDF 로 내보낸다.

![ERD](https://raw.githubusercontent.com/evrenjo/kedovi/main/.github/readme/erd.png)

**화면설계서**: 같은 양식 · 같은 뷰어. 번호 마커와 설명, 근거 ID 가 기능 정의로 이어진다.

![화면설계서](https://raw.githubusercontent.com/evrenjo/kedovi/main/.github/readme/storyboard.png)

### 해결하는 문제

| 팀에서 AI 를 쓰면 생기는 일 | kedovi 에서는 |
|---|---|
| 사람마다 프롬프트·규칙이 달라 결과 품질이 제각각이다 | 규칙·스킬·훅을 워크스페이스 repo 에 한 벌 두고 모두가 같은 것을 쓴다 |
| 세션이 끝나면 AI 가 하던 일을 잊는다 | 작업을 마칠 때 **핸드오프**로 한 일·진행 중·남은 일을 남기고, 다음 세션이 **재개**로 이어 간다 |
| 누가 무엇을 어디까지 했는지 모른다 | **팀 현황**이 모두의 기록을 모아 보여 주고, 빠진 사람의 일은 **인수인계**로 넘겨받는다 |
| AI 가 처음부터 계획을 크게 세우고 한꺼번에 만든다 | **진행 방식 스프린트**(신규 · 고도화 기본): 기능 단위 스프린트로 끝까지 동작하는 최소 기능부터 만들고, 스프린트마다 데모 · 회고하며 백로그에서 하나씩 붙인다. 전체 설계가 산출물인 차세대 · 분석·설계는 **전체**, 이슈마다 운영에 반영하는 운영 · 유지보수는 **이슈형**(이슈 보드) (`kedovi approach`) |
| 긴 작업에서 전체 중 어디까지 왔는지 안 보인다 | **로드맵**(`handoffs/PLAN.md`)이 단계 흐름 · 지금 단계 표 · 이번에 생긴 것 · 다음을 그린다. 단계를 끝낼 때마다 보고에 붙는다 |
| 기획 문서와 화면설계서가 사람마다 양식이 다르고, 근거를 찾아 문서를 뒤진다 | **문서 사이트**(`kedovi docs build`)가 기획 repo 의 md 를 HTML 로 만들고 ID 마다 앵커를 단다. **화면설계서**는 같은 양식 · 같은 뷰어로, 근거 ID 를 누르면 옆에 그 정의가 열린다. **데이터 설계**는 md 테이블 정의서에서 ERD 를 만든다 |
| Claude 파, GPT 파로 도구가 갈린다 | Claude Code · Codex 를 같은 규칙으로 쓰고, 역할마다 두 회사 모델을 **섞어** 쓴다 |
| "된다" 고 했는데 안 된다 | AI 가 근거(확인됨 · 추정 · 미확인)와 **실행한 검증 결과(표)** 로 보고한다 |
| "보통은 이렇게 한다" 가 AI 기억이라 낡거나 틀린다 | 흔한 방식 · 업계 관례는 **웹 검색으로 출처를 확인해 비교표로** 답한다 (`common-practice` 스킬). 검색할 수 없으면 "내 지식 기준" 이라고 밝힌다 |
| 규칙을 문서에 써 두면 지켜지지 않는다 | 중요한 규칙은 **검사 도구**(훅 · pre-commit · 스택별 검사)로 강제한다 |

### 추구하는 방향

1. **규칙은 한 벌, 도구는 둘.** 정본(`packs/` · `workspace.json`)을 고치면 Claude Code 용과 Codex 용 파일을 킷이 함께 만든다.
2. **기록이 곧 협업.** AI 와 한 일은 대화창이 아니라 워크스페이스 repo 의 `handoffs/` 에 남아 팀 전체가 본다.
3. **말보다 검사.** 사고에서 배운 규칙은 문장보다 훅·pre-commit·검사 도구로 남긴다.
4. **근거로 말하는 AI.** 추측을 사실처럼 말하지 않고, 완료는 실행한 검증으로 말한다.
5. **결정은 사람이.** 커밋·push·배포·DB 반영은 사용자 승인 뒤에만 한다. AI 서명은 붙이지 않는다.

### 구조 한눈에

```tree
GitLab · GitHub 그룹
├─ order       ← 워크스페이스 repo (규칙 · 스킬 · 팀 설정 · handoffs/ 를 모두 공유)
├─ order-api   ← 개발 repo
└─ order-web   ← 개발 repo

각자 PC 의 order/ (워크스페이스를 clone)
├─ workspace.json          ← 팀 설정 원본: repo 목록 · 팩 · 유형 · 모델
├─ AGENTS.md · CLAUDE.md   ← 두 도구가 읽는 같은 규칙 (자동 생성)
├─ bin/kit.js · packs/     ← 생성 엔진 · 규칙 · 스킬 · 훅 사본 (kedovi upgrade 가 갱신)
├─ handoffs/<이름>/        ← 내 작업 기록, push 로 팀 공유
├─ handoffs/PLAN.md        ← 로드맵 (팀 공용)
├─ docs-site/              ← (선택) 워크스페이스 문서 사이트 (아래 표)
└─ repos/                  ← 각자 kedovi install 로 받는다 (git 제외, 이력은 원래 repo 로)
   ├─ order-api            ← clone
   ├─ order-plans          ← 기획 repo: clone 또는 로컬 폴더 링크
   └─ order-batch          ← 새로 만든 repo (git init, 원격 없음)
```

문서 사이트는 채팅으로 말하면 에이전트가 `kedovi docs` 명령으로 만든다.

| 이럴 때 | 이렇게 말한다 | 하는 일 |
|---|---|---|
| 기획 문서 · 화면설계서 · ERD 를 볼 때 (모든 유형) | "문서 사이트 만들어줘" | `kedovi docs build`: 기획 repo 의 `docs-site/` |
| 여러 repo 의 산출물을 한 사이트로 (분석·설계 · repo 가 많은 프로젝트) | "워크스페이스 문서 사이트 만들어줘" | `kedovi docs build .`: 워크스페이스 `docs-site/`. repo 마다 사본 · 링크 · 뺌은 `docs-site.json` |
| 내 PC 에서 바로 볼 때 | "문서 사이트 열어줘" | `kedovi docs serve --open` |
| 팀이 주소로 볼 때 | "문서 사이트 Pages 로 올려줘" | `kedovi docs pages on`: GitLab · GitHub Pages |

### 하루의 협업 모습

| 누가 · 언제 | 하는 것 | 일어나는 일 |
|---|---|---|
| 리더 · 처음 한 번 | `kedovi init` → push | 유형 · 개발 repo · 스택 · 팀 모델을 고르면 워크스페이스가 만들어진다 |
| 팀원 · 처음 한 번 | clone → `kedovi install` | 개발 repo 가 `repos/` 에 받아지고 팀 합류 기록이 올라간다 |
| 모두 · 아침 | `kedovi start` → "재개" | 로드맵(흐름도 · 지금 단계 표)과 어제 내 핸드오프가 뜨고, 이어서 할 일을 보고받는다 |
| 모두 · 작업 중 | "주문 목록에 페이지네이션 추가해줘" | 큰 일은 분석 · 설계 · 구현 · 테스트 · 리뷰 역할로 나눠 계획을 먼저 보여 주고 진행한다. 리뷰는 다른 회사 모델이 본다 |
| 모두 · 작업 끝 | "핸드오프" | 한 일 · 진행 중(작업 브랜치) · 남은 일이 기록돼 push 된다 |
| 리더 · 수시로 | `kedovi team` 또는 "팀 현황" | 누가 언제 무엇을 얼마나 했는지, 며칠째 멈춘 사람은 누구인지 본다 |
| 누구나 · 필요할 때 | "인수인계 이개발" | 그 사람의 미완 작업 · TODO 를 골라 내 것으로 옮기고, 작업 브랜치에서 이어 간다 |

### 주요 특징

| 특징 | 내용 |
|---|---|
| Claude Code · Codex 겸용 | 같은 규칙 · 스킬 · 훅을 두 도구용으로 생성. 누가 어느 도구를 써도 같은 방식 |
| repo 마다 맞는 규칙 | 스택 80종을 감지해 repo 마다 규칙을 붙인다 (예: Spring 은 서버 규칙, React 는 화면 규칙). 멀티모듈도 모듈별로 |
| 프로젝트 유형 | 신규 구축 · 차세대 · 운영·고도화 · 분석·설계 마다 AI 가 삼는 근거와 규칙이 다르다. 이슈·티켓 처리는 모든 유형 공통 |
| 팀 에이전트 | 일반 역할 7개(분석 · 설계 · 설계 문서 · 구현 · 테스트 · 리뷰 · 문서화) + 팩·프로젝트가 더한 역할. **자동** 모드면 리더가 작업마다 역할과 모델을 고르고(성향 · 회사별 요금제 여유도 · 선호 모델), **고정** 모드면 프로필대로 |
| 모델 혼용 · 예산 | 최고 · 표준 · 절약 프로필. 역할을 상대 회사 모델에게 위임할 수 있다 (예: Claude 가 구현, GPT 가 리뷰) |
| 인수인계 | 핸드오프 · 재개 · 인수인계 · 팀 현황 · 팀 합류와 명단 |
| 로드맵 | 유형 · 진행 방식 · 스택마다 기본 단계로 시작 (스프린트면 스프린트 계획 → 구현 → 데모 → 회고 반복 · 백로그, 전체면 DB 가 있으면 데이터 설계, 화면이 있으면 화면설계). 단계 흐름도 · 영역 × 하위 작업 표 · 완료 n / 전체 N · 분모 변경 기록. 숫자는 git 기록에서 센다 |
| 문서 사이트 · 화면설계서 · 데이터 설계 | 기획 repo 의 md → 같은 경로 구조의 HTML(정의 ID 앵커 · 근거 색인). 화면설계서 장 양식(표지 · 이력 · 메뉴 구조 · 정책 · 화면) · 뷰어(썸네일 · 발표 · A4 인쇄 · 근거 패널) · 검사. 테이블 정의서(md) → ERD 뷰어(관계 중심 배치 · 표시 수준 · 근거 패널 · Export SQL DDL · SVG · PDF) · 검사 |
| 검사 도구 | 생성물 어긋남(pre-commit, JSON 은 키 순서 무관) · 죽은 문서 참조 · 문서 표·ID 검사(`check-docs.js`, 문서 담당이 보고 전에) · AI 서명 제거 · 스택별 코드 검사 · 교차 검토 · 토론 모드(여러 모델이 서로 반박, 요청 때만) · 작업 완료 조건 점검(끝내기 전 훅) |
| 모델 관리 | 독립 벤치마크(LiveBench) 근거의 추천, 새 모델 · 퇴역 모델 알림 |

## 설치 (PC 마다 1번)

npm 공개 저장소에서 받는다. macOS 터미널 · Windows PowerShell 모두 같은 명령이다.

```bash
node -v                      # v20.19 이상
npm i -g kedovi
kedovi --version
```

처음 실행할 때 kedovi 은 Node 버전과 상관없는 고정 위치에 실행 파일을 두고 PATH 에 넣는다. 그래서 nvm 등으로 기본 Node 를 바꾸거나 설치했던 버전을 지워도 `kedovi` 명령은 그대로 동작한다 (다른 Node 버전에 깔린 kedovi 중 가장 최근 것을 쓴다). 새 터미널부터 적용된다.

| PC | 실행 파일 | PATH |
|---|---|---|
| macOS · Linux | `~/.local/bin/kedovi` | 셸 설정(`~/.zshrc` · `~/.bashrc` 등)에 한 줄 |
| Windows | `%LOCALAPPDATA%\kedovi\bin\kedovi.cmd` | 사용자 PATH |

> 참고: 끄려면 환경 변수 `KEDOVI_NO_GLOBAL_SHIM=1`. 넣은 줄은 `# kedovi:` 표시가 붙어 있어 지울 때 찾기 쉽다.

### 권한 오류 (EACCES)

설치가 `EACCES: permission denied, mkdir '/usr/local/lib/node_modules/…'` 로 실패하면, 전역 설치 폴더의 주인이 지금 계정이 아니다. 예전에 `sudo npm i -g` 를 한 번 썼거나, Node · Homebrew 를 다른 계정이나 공식 설치 파일(.pkg)로 깐 경우다. 킷 문제가 아니라 npm 이 패키지를 받기 전에 난 오류다.

원인 확인:

```bash
which node npm
ls -ld "$(npm config get prefix)/lib/node_modules"   # 주인이 지금 계정(whoami)이 아니면 이 경우
```

| 방법 | 관리자 암호 | 명령 | 맞는 경우 |
|---|---|---|---|
| 전역 설치 위치를 홈 폴더로 (권장) | 필요 없음 | 아래 「홈 폴더로」 | 누구 PC 든, 원인이 무엇이든 |
| 폴더 주인을 내 계정으로 | 한 번 | `sudo chown -R "$(whoami)" "$(npm config get prefix)/lib/node_modules" "$(npm config get prefix)/bin"` | 내 PC 이고 `sudo npm i -g` 를 쓴 것이 원인일 때 |
| 설치 없이 실행 | 필요 없음 | `npx <패키지>@latest <명령>` | 잠깐 써 볼 때 (매번 `npx` 를 붙인다) |

홈 폴더로 (macOS · Linux, 셸이 bash 면 `~/.zshrc` 대신 `~/.bash_profile`):

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

그다음 위 설치 명령(`npm i -g …`)을 다시 실행한다. `sudo npm i -g` 로 설치하지 않는다: 설치는 되지만 업데이트와 킷이 만드는 파일에서 같은 오류가 다시 난다.

Claude Code(`npm i -g @anthropic-ai/claude-code`) 나 Codex(`npm i -g @openai/codex`) 중 쓸 것도 설치돼 있어야 한다. Codex 앱만 깔아 터미널에 `codex` 명령이 없어도, 앱이 내려받은 CLI(`~/.codex/packages/*/current`)를 찾아 쓴다.

### 플러그인 · MCP · 도구

워크스페이스를 제대로 쓰려면 아래를 PC 마다 한 번 설치한다. `kedovi doctor` 가 같은 목록으로 빠진 것을 알린다.

| 구분 | 항목 | 설치 | 쓰는 기능 |
|---|---|---|---|
| 필수 | Node.js 20.19+ · git | `node -v` · `git --version` | 전부 |
| 필수 | Claude Code 또는 Codex (최신) | `npm i -g @anthropic-ai/claude-code` · `npm i -g @openai/codex` | 에이전트. Haiku 5.5 는 Claude Code 2.1.293 이상 |
| 필수 (팀) | 저장소 로그인: GitHub `gh` · GitLab `glab` · 또는 SSH 키 | `gh auth login` · `glab auth login` | 이 PC 사용자 확인(팀장 · 담당 repo), MR · PR 스킬 |
| 권장 | claude-mermaid (Claude Code 플러그인) | `kedovi prefs mermaid install` | 대화 중 그림을 브라우저로 |
| 권장 (화면 개발) | Playwright MCP | `claude mcp add playwright -- npx @playwright/mcp@latest` | 화면 확인 · 접근성 검사 (stack-react 실행 검사) |
| 선택 | telegram 플러그인 + bun | `kedovi notify my channel on` (안내에 따라) · `curl -fsSL https://bun.sh/install \| bash` | 텔레그램 양방향 대화 |
| 선택 | pixel-agents | `npm i -g pixel-agents` | 팀원 작업을 캐릭터 화면으로 (`kedovi start --pixel-agents`) |

Codex 는 따로 넣을 플러그인이 없다. 팀이 함께 쓰는 MCP 서버는 `workspace.json` 의 `mcp` 에 적으면 `.mcp.json` · `.codex/config.toml` 에 함께 들어간다.

설치가 끝나면 [빠른 시작](docs/quickstart.md)의 「팀 리더: 워크스페이스 생성」 또는 「팀원: 합류」 로 간다. 선택 화면마다 무엇을 묻고 어디에 저장하는지는 [업무 흐름](docs/workflow.md).

### 인증

repo 마다 토큰이 필요하지 않다.

- clone 은 kedovi 가 아니라 **git 이 저장해 둔 인증**을 쓴다 (macOS 키체인·Git Credential Manager·SSH 키). **호스트마다 한 번** 인증해 두면 그 호스트의 repo 는 모두 받아진다.
- 인증이 없으면 clone 이 멈추지 않고 바로 실패하며 "인증 필요" 를 알린다 → 그 주소로 `git clone` 을 한 번 직접 해서 인증을 저장한 뒤 `kedovi install`.
- MR·PR 을 만드는 스킬 · 파이프라인 조회만 따로 토큰이 필요하다. GitLab 은 `kedovi secret set GITLAB_TOKEN`([비밀값](docs/workspace.md#비밀값-토큰)), GitHub 은 `gh auth login`.

## 시작 유형 (SI 분류)

| 유형 | 에이전트가 삼는 근거 | 필요한 repo | 자동으로 들어가는 팩 |
|---|---|---|---|
| **신규 구축** `new` | 기획 문서(요구사항) | 기획 문서 | 없음 |
| **차세대** `modernization` | 요구사항 > AS-IS 소스 > 현재 코드 | 레거시 소스 (없으면 sync 가 멈춤) | `modernization`: AS-IS 대조 규칙·도구 |
| **운영·고도화** `enhancement` (SM 포함) | 현재 코드(지금 동작) + 개선 요구사항·이슈 티켓(바뀔 동작) | 운영 중인 시스템 코드 | `enhancement`: 기존 동작 보존·변경 영향 점검 상시·회귀 방지·운영 환경 조회만·hotfix |
| **분석·설계(ISP·ISMP)** `consulting` | 현행 시스템·업무 자료 → 결과물은 문서 | 산출물 문서 (현행 소스는 선택) | `consulting`: 코드 수정 없음·근거 표기·`requirements` 스킬 |

**이슈·티켓 처리는 모든 유형 공통이다.** 구축 중 QA·UAT 지적이든 운영 중 장애든 `ticket` 스킬과 공통 규칙(재현 먼저 · 최소 변경 · 티켓 번호 · 조치 보고 5칸)으로 처리한다.

여러 시스템을 하나로 합치는 통합구축은 **차세대에 레거시 repo 를 여러 개** 등록해 쓴다.

## 문서 안내

| 알고 싶은 것 | 문서 |
|---|---|
| 처음 따라 하기 (유형별) | [빠른 시작](docs/quickstart.md) |
| 선택 화면 · 저장 위치 흐름도 | [업무 흐름](docs/workflow.md) |
| 모든 명령 | [명령](docs/commands.md) |
| 핸드오프 · 재개 · 인수인계 · 로드맵 | [인수인계](docs/handoff.md) |
| 기획 문서 사이트 · 화면설계서 · 데이터 설계 | [문서 사이트](docs/docs-site.md) |
| 텔레그램 알림 | [알림](docs/notify.md) |
| 역할별 모델 · Claude · GPT 혼용 | [팀 에이전트와 모델](docs/team-models.md) |
| `workspace.json` · 비밀값 · 설정 수정 권한 | [workspace.json · 설정](docs/workspace.md) |
| 규칙이 붙는 방식 · 켜고 끄기 | [규칙](docs/rules.md) |
| 팩 목록 · 만들기 | [팩 종류](docs/packs.md) · [팩 제작](docs/pack-making.md) |
