# 팩 제작

워크스페이스에 맞게 규칙을 고르고 고치는 방법과, 팩 파일의 형식(작성 규격)이다. 킷에 새 팩을 더하는 절차는 [킷 개발](kit-dev.md).

## 킷 규칙 해제 · 변경 · 추가

| 하고 싶은 것 | 방법 | 저장 |
|---|---|---|
| 킷 규칙 끄기 | `kedovi rules` (켤 규칙 고르기) 또는 `kedovi rules off <ID>` | `workspace.json` 의 `rules.off` (팀 공유) |
| 스택 · 언어 규칙을 일부 repo 에서만 끄기 | `kedovi rules off <ID> --repo <이름,…>` (켜기는 `on`) | `workspace.json` 의 `rules.offIn` (팀 공유) |
| 상시 규칙을 필요할 때만 | `kedovi rules ondemand <ID>` (`repo-tasks` = repo 별 작업별 표) | `workspace.json` 의 `rules.onDemand` (팀 공유) |
| 킷 규칙을 우리 방식으로 바꾸기 | `packs/project/rules/<이름>.md` 머리말에 `replaces: <ID>` | 그 규칙 대신 들어가고, 원래 규칙이 걸리던 repo 에 똑같이 걸린다 |
| repo 마다 다른 규칙 (예: 이 repo 만 다른 Java 규칙) | 머리말에 `replaces: <ID>` + `repos: <이름,…>` | 적은 repo 에서만 바꾸고 나머지 repo 는 킷 규칙 그대로. `replaces` 없이 `repos:` 만 쓰면 그 repo 에만 더해진다 |
| 우리 규칙·스킬 더하기 | `packs/project/rules/*.md` · `packs/project/skills/<이름>/SKILL.md` | 워크스페이스 repo (팀 공유) |
| 스택 규칙을 repo 에서 빼기 | `kedovi detect` 에서 그 repo 스택을 고치거나 건너뛰기 | `workspace.json` 의 `repos[].stacks` |
| 언어 규칙을 repo 에서 빼기 | `kedovi rules off lang-<언어>--10-<언어> --repo <이름>` 또는 `kedovi detect` 에서 그 repo 를 건너뛴다 (`repos[].languages: false`). 감지 결과를 손으로 지우면 다음 감지 때 되살아난다 | `workspace.json` 의 `rules.offIn` |
| 협업 도구 규칙 빼기 | `workspace.json` 에서 그 repo 의 `host` 를 `none` | `workspace.json` |
| 나만 쓰는 지침 | `.agents/local.md` | 이 PC 만 |

- 규칙 ID 는 `팩--파일이름` 이다 (예: `stack-spring--50-logging`). 목록은 `kedovi rules list` 나 [팩 종류](packs.md).
- **필수 규칙**(근거·검증 · 보안·안전 · 보안 상세)은 킷의 전제라 끄거나 바꿀 수 없다.
- 바꾸기 예:

```markdown
---
title: 우리 팀 Spring 로깅
load: on-demand
when: Spring 코드에서 로그를 남길 때
replaces: stack-spring--50-logging
---

## 우리 팀 로깅
- 모든 로그는 사내 로거를 쓴다.
```

## 프로젝트 전용 규칙 · 스킬 제작

워크스페이스마다 있는 `project` 팩에 둔다. 워크스페이스 repo 에 커밋되어 팀이 함께 쓴다.

```tree
packs/project/
├── rules/10-우리-규칙.md          규칙 (머리말: title · load · when)
├── skills/<이름>/SKILL.md         스킬 (머리말: name · description)
└── agents/<역할>.md               역할 정의를 덮어쓰거나 새 역할을 더한다
```

1. 파일을 만든다. 규칙 예:

```markdown
---
title: 주문 도메인 용어
load: on-demand
when: 주문·결제 코드를 고치거나 관련 문서를 쓸 때
---

## 주문 도메인 용어
- "확정" 은 결제 완료 뒤 상태다. "접수" 와 섞어 쓰지 않는다.
```

2. `kedovi sync` (또는 `node bin/kit.js sync`). AGENTS.md 에 반영된다.
3. commit · push 하면 팀원도 받는다.

- `load: always` 는 AGENTS.md 본문에 늘 들어가 예산(32KB)을 쓴다. 대부분은 `on-demand` 와 `when` 으로 둔다.
- 워크스페이스 설정 수정이 막혀 있으면(`kedovi team edit deny`) 팀장만 만들 수 있다.

## 팩 작성 규격

팩은 `packs/<이름>/` 폴더 하나다. `kit sync` 가 팩을 읽어 Claude Code·Codex 용 파일을 만든다.
**팩 안의 파일이 정본이고, 생성물(`AGENTS.md`·`CLAUDE.md`·`.agents/`·`.claude/`·`.codex/`)은 손으로 고치지 않는다.**

```tree
packs/<이름>/
├── pack.json              {"name","title","description","requires":["core"]}
├── rules/*.md             룰 (머리말 필수)
├── skills/<스킬>/SKILL.md  스킬 (+ 보조 파일)
├── hooks.json             훅 (선택)
├── hooks/*.js             훅 스크립트
├── bin/*                  도구 (룰·스킬이 경로로 가리킨다)
├── assets/*               도구가 복사해 쓰는 파일 (예: 문서 사이트 스타일 · 화면설계서 뷰어. 생성·검사 대상 아님)
└── docs/*.md              상세 문서 (룰이 경로로 가리킨다. 생성·검사 대상 아님)
```

### 팩 종류 (`category`)

`pack.json` 의 `category` 로 정한다.

| category | 붙는 방식 | 예 |
|---|---|---|
| `core` | 항상 | `core` |
| `type` | 시작 유형이 정한다 (`project.type`) | `modernization` · `enhancement` · `consulting` |
| `workflow` | repo 주소(또는 `host`)가 그 도구인 repo 에만 | `gitlab` · `github` |
| `layer` | **repo 스택**이 그 layer 면 자동. 기술과 무관한 공통 원칙 | `backend` · `frontend` · `db` |
| `stack` | **repo 스택**이 그 기술이면 자동. `"layer"` · `"stacks": ["<id>"]` 를 적는다 | `stack-spring` · `stack-react` · `stack-postgres` |
| `lang` | **repo 언어**(소스 확장자로 감지, `stacks.json` 의 `languages`)가 그 언어면 자동. `"languages": ["<id>"]` 를 적는다. 언어가 하나라도 있으면 `clean-code` 도 붙는다 | `lang-java` · `lang-python` · `clean-code` |

- **layer·stack·lang 팩의 룰은 AGENTS.md 본문에 들어가지 않는다.** "repo 별 작업 규칙" 표에서 그 스택을 쓰는 repo 에만 걸린다
  (`always` = 그 repo 를 고치기 전에 읽을 문서, `on-demand` = 해당 작업 때). 그래서 repo 가 많아도 AGENTS.md 가 커지지 않는다.
- **stack 팩에는 그 기술에만 해당하는 것만** 둔다. 기술과 무관한 원칙은 layer 팩으로.
- **특정 프로젝트·사내 프레임워크의 관례(응답 봉투, 오류 코드 체계, 메시지 키 등)를 표준처럼 쓰지 않는다.** "그 프로젝트의 기존 관례를 찾아 따른다" 로 쓰고, 관례 예시가 필요하면 `docs/example-*.md` 로 "강요하지 않는다" 를 머리에 달아 둔다.
- `summary`: 선택 화면에 나오는 40자 이내 한 줄.

### 룰 (`rules/*.md`)

```markdown
---
title: 커뮤니케이션 규칙
load: always            # always = AGENTS.md 에 본문 포함 / on-demand = 색인만
when: 백엔드 코드를 고칠 때   # on-demand 필수. 색인 표의 "언제" 칸
agents: all             # all(기본) | claude. claude 는 CLAUDE.md 에만 들어간다
required: true          # (선택) 킷의 전제라 워크스페이스가 끄거나 바꿀 수 없다. core 의 근거·안전·보안만
replaces: <규칙 ID>      # (선택, project 팩) 킷 규칙 대신 이 규칙을 넣는다. 규칙 ID = <팩>--<파일이름>
if: vars.gitlab.branchMode=trunk   # (선택) 설정값이 맞을 때만 넣는다. != 는 다를 때. 값이 없으면 빈 문자열로 본다
---

## 본문 제목
...
```

- **`always` 는 예산을 쓴다.** 모든 팩의 always 룰 + 레포 표 + 색인이 `AGENTS.md` 한 파일에 들어가고,
  Codex 는 이 파일을 `project_doc_max_bytes`(기본 32KB)에서 **자른다**. 잘린 뒤쪽 룰은 조용히 사라진다.
  → 팩 하나의 always 룰은 **합계 6KB 이내**를 목표로 한다. 판단·금지 규칙만 always 로, 절차·예시·근거는 on-demand 나 `docs/` 로.
- `on-demand` 룰은 `.agents/rules/<팩>--<파일>.md` 로 렌더되고 AGENTS.md 색인 표에 "언제 | 문서" 한 줄이 된다.
  에이전트는 그 작업을 시작하기 전에 읽는다. `when` 은 **에이전트가 스스로 해당 여부를 판단할 수 있는 문장**으로.
- 설정에 따라 내용이 갈리는 규칙은 본문에 둘 다 쓰지 않고 파일을 나눠 `if:` 로 고른다 (예: 브랜치 운영 방식). 안 쓰는 쪽은 예산을 쓰지 않는다. 같은 자리의 규칙이면 ID 를 다르게 두고 서로 반대 조건을 건다.
- 파일 이름 앞 숫자(`10-`, `20-`)가 팩 안의 순서다. 팩 순서는 `workspace.json` packs 순서.
- 본문 첫 제목은 `##` 부터 (AGENTS.md 의 `#` 은 프로젝트 제목).

### 변수 (`{{ws:…}}`)

형식: `{{ws:키.경로}}`

룰·스킬 본문의 `{{ws:project.title}}`, `{{ws:vars.branch.develop}}` 는 `workspace.json` 값으로 바뀐다.
값이 없으면 sync 가 **오류로 멈춘다**. 프로젝트마다 달라지는 이름(브랜치·환경·계정·호스트)은 하드코딩하지 말고 변수로.
팩이 쓰는 변수는 `pack.json` 의 `"vars"` 에 **점 경로 키**로 기본값·설명과 함께 적는다.
`init` 과 `upgrade --add` 가 이 기본값을 `workspace.json` 의 `vars` 에 채운다 (이미 있는 값은 건드리지 않는다).

```json
"vars": {
  "branch.develop": { "default": "develop", "desc": "통합 브랜치 이름" },
  "gitlab.commitNote": { "default": "", "desc": "커밋 규칙 뒤에 붙일 프로젝트별 한 줄 (비우면 없음)" }
}
```

스킬 `description` 에도 변수를 쓸 수 있다 (AGENTS.md 스킬 표에는 치환된 값이 들어간다).

### 스킬 (`SKILL.md`)

위치: `skills/<이름>/SKILL.md`

```markdown
---
name: handoff                 # 폴더명과 같아야 한다 (Codex 필수)
description: 오늘 작업을 마무리하고 인계 기록을 남긴다. "핸드오프", "마무리" 요청에 쓴다.
---
```

- `name`·`description` 만 두 도구 공통이다. `argument-hint` 등 Claude 전용 필드는 넣어도 Codex 가 무시한다.
- 생성 위치: `.agents/skills/`(Codex) 와 `.claude/skills/`(Claude) 양쪽. 호출은 Claude `/이름`, Codex `$이름`.
- **도구 중립으로 쓴다.** 스킬은 두 에이전트가 읽는다.

  | 쓰지 않는다 | 대신 |
  |---|---|
  | `AskUserQuestion` 도구로 묻는다 | **선택지 질문**으로 묻는다 (권장안을 첫째에, 2~4개) |
  | `Agent` 도구 / `subagent_type` | 병렬 에이전트를 쓸 수 있으면 나눠 맡긴다. 없으면 순서대로 |
  | `TodoWrite` · `Skill` 도구 이름 | 할 일 목록을 유지한다 · `<스킬>` 스킬을 따른다 |
  | `$CLAUDE_PROJECT_DIR` | 워크스페이스 루트 (`git rev-parse --show-toplevel`) |
  | `CLAUDE.md` / `.claude/rules` | `AGENTS.md` / 해당 룰 문서 |

  도구별로 꼭 달라야 하는 절차만 `> Claude Code:` / `> Codex:` 인용 줄로 나눠 적는다.

### 훅 (`hooks.json`)

```json
{
  "SessionStart": [{ "matcher": "startup", "script": "hooks/check-repo-updates.js", "timeout": 30 }],
  "Stop":         [{ "script": "hooks/handoff-reminder.js", "timeout": 15, "statusMessage": "핸드오프 점검" }]
}
```

- `script` 는 팩 기준 경로. 확장자로 실행기(`node`/`bash`/`python3`)가 정해진다. `timeout` 단위는 **초**.
- `agents`: `all`(기본) · `claude` · `codex`. 한 도구에만 있는 이벤트·도구(예: Claude 의 `Agent` 도구 · `SubagentStop`)를 쓰는 훅은 그 도구로 한정한다.
- 생성 결과: Claude `node "$CLAUDE_PROJECT_DIR/packs/..." --agent=claude`, Codex `node "$(git rev-parse --show-toplevel)/packs/..." --agent=codex`.
- **출력 계약 (두 도구 공통으로 동작하는 형태만)**
  - `SessionStart`: stdout 평문 = 에이전트 컨텍스트에 추가. **정상이면 1줄 이하**로 조용히. (예외: core 의 `session-brief.js` 는 브리핑 본문을 넘긴다. 첫 메시지로 넣으면 화면에 전문이 찍히기 때문)
  - `Stop`: stdout 은 **JSON 이거나 비어 있어야 한다** (Codex 는 평문을 오류로 본다).
    계속 작업시키려면 `{"decision":"block","reason":"..."}`. 알리기만 할 거면 출력하지 않는다.
  - `PreToolUse`: 막을 때만 `deny(reason)` 의 JSON, 허용이면 출력하지 않는다. 막지 않고 알리기만 할 때는 `note(text)`(additionalContext JSON, Claude). Codex 도 같은 deny JSON 으로 셸(`Bash`) · 파일 편집(`apply_patch`, matcher `apply_patch` · `Edit` · `Write`)을 막는다 (codex-cli 0.165 실측, core `repo-guard.js`). 대부분의 PreToolUse 훅은 Claude 전용이다
  - `UserPromptSubmit`: stdout 평문 = 그 요청의 컨텍스트에 추가 (Claude · Codex 모두, Codex 는 codex-cli 0.159 에서 확인). 요청마다 들어가므로 **2줄 이내**, 없으면 출력하지 않는다.
  - `PostToolUse`: 문맥을 넣으려면 JSON `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"…"}}` (Codex 는 평문을 버리고, `hookEventName` 이 없으면 실패로 본다). 도구마다 불리므로 가볍게, 대부분 출력하지 않는다.
  - 공통 헬퍼: `packs/core/lib/hook.js`: `root()`, `agent()`, `readInput()`, `context(text)`, `block(reason)`, `deny(reason)`, `note(text)`.
- 훅은 **세션을 깨지 않는다.** 예외는 잡고 exit 0. 네트워크가 필요한 검사는 timeout 안에 끝나게.
- Codex 는 프로젝트 훅을 **trusted 로 지정해야** 돌린다(`/hooks`). 훅 내용이 바뀌면 다시 신뢰해야 한다.

### 역할 (`agents/*.md`)

팀 에이전트의 역할 하나. sync 가 Claude Code 용 `.claude/agents/<이름>.md` 와 Codex 용 `.codex/agents/<이름>.toml` 을 이 PC 모델로 만들고, 개인 지침 「팀 구성」 표에 한 줄로 넣는다. 계층 팩(db 의 `dba` · infra 의 `infra`)이 그 분야 역할을 가져오고, 프로젝트 고유 역할은 `packs/project/agents/` 에 둔다. 같은 이름이면 뒤 팩이 덮어쓴다. 순서는 workspace.json 팩 → repo 스택으로 붙은 계층 팩 → project 라서 project 역할이 늘 이긴다. 계층 팩 역할도 `grade` 대로 모델을 받는다.

```markdown
---
name: data-migrator          # 영문 소문자 · - (호출 이름)
title: 데이터 이관            # 표 · 화면에 보이는 이름
description: 이관 스크립트를 쓰고 건수를 대조할 때 맡긴다.   # 리더가 언제 맡길지 판단하는 문장
access: workspace-write      # read-only(기본) | workspace-write
effort: high                 # 프로필에 값이 없을 때의 추론 강도
grade: high                  # high | standard | low. 프로필에 이 역할이 없으면 성향의 등급 표(models.json profiles.*.grades)로 모델을 정한다
---
```

- 본문은 「받는 것 · 방법 · 하지 않는다 · 보고」 순서로 쓴다 (core 역할 참고). 쓰기 역할은 무엇만 고치는지 적는다.
- `grade` 가 없고 프로필에도 없으면 메인 모델을 그대로 쓴다.

### 도구 (`bin/`)

- 의존성 없는 Node(권장)·Python3·bash. 프로젝트 경로는 **`workspace.json` 에서 읽는다** (`packs/core/lib/workspace.js`).
- 룰·스킬은 `packs/<팩>/bin/x.js` 경로로 가리킨다. 존재하지 않는 경로를 가리키면 pre-commit 이 막는다.
- 첫 줄 주석에 한 줄 설명과 실행법.

### 비밀값 (`pack.json` 의 `secrets`)

팩의 도구가 토큰을 쓰면 이름 · 용도 · 필요 권한을 선언한다. 값은 사람마다 달라 워크스페이스에 두지 않고, 각자 `kedovi secret set <이름>` 으로 OS 저장소에 넣는다.

```json
"secrets": [
  { "name": "GITLAB_TOKEN", "scope": "project", "purpose": "MR 생성 · 파이프라인 조회", "needs": ["api"], "test": "gitlab" }
]
```

| 필드 | 뜻 |
|---|---|
| `name` | 대문자 · 숫자 · `_`. 같은 이름의 환경변수가 있으면 그것이 먼저다 |
| `scope` | `project`(기본, 프로젝트마다 다른 값) · `global`(이 PC 의 모든 프로젝트 공통) |
| `optional` | `true` 면 없어도 `kedovi doctor` 가 경고하지 않는다 (켤 때만 쓰는 기능) |
| `purpose` · `needs` | 무엇에 쓰는지 · 필요한 권한 (GitLab 토큰 범위 등). `kedovi secret list` · doctor 가 보인다 |
| `test` | 확인 방법: `gitlab` (토큰 이름 · 권한 · 만료) · `telegram` (봇 이름) · `npm` (계정) |

- 도구는 `packs/core/lib/secrets.js` 의 `get(이름, { root })` 하나로 읽는다 (환경변수 > 프로젝트 > 전역 > 옛 파일). 돌려받은 `label` 로 어디서 읽었는지 알릴 수 있고, 값은 어떤 출력에도 찍지 않는다.
- 위임 세션(`delegate.js`)은 선언한 이름을 모두 뺀 환경으로 돈다.

### 체크리스트

팩을 추가·수정할 때 확인한다.

- [ ] `node bin/kit.js sync` 오류 0, `check` 통과
- [ ] always 룰 합계가 팩 예산(6KB) 이내
- [ ] 특정 프로젝트 이름·경로·계정이 본문에 남지 않았다 (`grep -ri '<옛 프로젝트명>' packs/<팩>`)
- [ ] 스킬 본문에 Claude 전용 도구 이름이 없다 (`grep -rE 'AskUserQuestion|subagent_type|CLAUDE_PROJECT_DIR' packs/<팩>/skills`)
