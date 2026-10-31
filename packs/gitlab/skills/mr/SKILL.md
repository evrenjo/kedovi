---
name: mr
description: 지정한 source→target 으로 GitLab 머지리퀘스트를 만든다 (target 생략 시 통합 브랜치). 미리보기 → 사용자 OK → 생성 → 팀 배포 안내까지. 머지는 사람이 한다 (agentMerge 를 켠 워크스페이스는 지시받은 MR 만 배포 연쇄로). "MR 만들어줘", "QA MR", "배포해줘" 요청에 쓴다.
argument-hint: "<source 브랜치> [target 브랜치]"
---

# mr — GitLab Merge Request 생성

**source → target** MR 을 만든다. 기본은 **생성까지만**이고 머지는 사람이 GitLab 에서 한다. 에이전트 머지 설정 `agentMerge = {{ws:vars.gitlab.agentMerge}}` 가 `true` 면 사용자가 지시한 MR 만 아래 「배포 연쇄」로 머지까지 한다.

도우미: `node packs/gitlab/bin/gitlab-mr.js` = `kedovi gitlab` (`preview` · `create` · `repos` · `pipeline` · `wait` · `merge` · `play` · `retry` · `cancel`, `--dry-run` 지원). 만든 뒤 파이프라인은 `pipeline --mr <번호>` 로 보고 `wait --mr <번호>` 로 끝까지 기다린다. 실행 · 다시 실행 · 머지 · 취소는 사용자 승인을 받은 뒤에만 `--yes` 를 붙인다 (운영 배포 작업은 반드시). 임시 스크립트를 짜지 않고 이 명령을 이어 부른다.
설정: `workspace.json` 의 `repos[].gitlab = {"host": "...", "projectId": 12}`, 토큰은 환경변수 `GITLAB_TOKEN`
(이름은 `vars.gitlab.tokenEnv` 로 변경) 또는 `git credential fill`. 설정이 없으면 만들지 말고 무엇을 채워야 하는지 안내한다.

## 사용법

| 형태 | 뜻 |
|---|---|
| `mr feature/ABC-12-login-fix {{ws:vars.branch.develop}}` | 권장 — 둘 다 적는다 |
| `mr feature/ABC-12-login-fix` | target 생략 = `{{ws:vars.branch.develop}}` |
| 인자 없음 | 실행하지 않고 사용법만 안내 |

인자는 위치 기준이다 — 첫째 source, 둘째 target. 사용자가 "QA MR" 처럼 환경으로만 말하면 아래 표로 방향을 잡고 미리보기에서 확인받는다.

| 목적 | 방향 |
|---|---|
| 개발 서버 | `feature/*`·`fix/*` → `{{ws:vars.branch.develop}}` |
| QA | **`{{ws:vars.branch.develop}}` → `{{ws:vars.branch.release}}`** (작업 브랜치를 직접 올리지 않는다) |
| 운영 긴급 | `hotfix/*` → `{{ws:vars.branch.release}}` **그리고** `hotfix/*` → `{{ws:vars.branch.develop}}` (MR 2건) |

## 절대 규칙

- **사용자가 명시 호출할 때만** 동작한다. 자동·추측 실행 금지.
- **미리보기를 낸 뒤 사용자의 명시적 OK 없이 생성하지 않는다.** 호출 자체는 "미리보기를 만들어라" 다.
  미리보기 직후 온 **다른 주제의 지시**(문구·표기·언어 수정 등)나 지난번 승인 이력은 OK 가 아니다.
  MR 생성은 되돌려도 흔적(번호 소비·알림)이 남는다.
- `agentMerge` 가 `false` 면 **머지하지 않는다.** 머지 요청을 받아도 "머지는 GitLab 에서 직접 하셔야 합니다" 로 답한다 (도구도 안내만 하고 멈춘다). auto-merge(`merge_when_pipeline_succeeds`)는 설정과 상관없이 쓰지 않는다.
- **토큰을 출력·로그·인계·커밋 어디에도 남기지 않는다.**

## 절차

1. **인자** — source 없으면 중단. target 없으면 `{{ws:vars.branch.develop}}`. 같으면 중단.
2. **대상 repo** — `gitlab-mr.js repos` 로 후보를 보고, 각 repo 에서 `git -C <repo> ls-remote --heads origin <source>` 로 원격 브랜치 존재를 확인한다.
   0개면 "push 먼저" 안내 후 중단. 2개 이상이면 **선택지 질문**(권장안 첫째: 브랜치가 있는 repo 전부 / 각각 하나씩)으로 묻는다.
3. **repo 별 미리보기 데이터**

   ```bash
   node packs/gitlab/bin/gitlab-mr.js preview --repo <name> --source <source> --target <target>
   ```

   - 커밋 0개 → 그 repo 는 건너뛴다. 이미 열린 MR 이 있으면 새로 만들지 않는다 (`create` 도 그 MR 을 그대로 쓰고 번호를 낸다).
   - 로컬에 push 안 된 커밋이 있으면 경고하고 push 여부를 묻는다(작업 브랜치 push 만 허용).
4. **title / description 작성** — 커밋 목록으로 채운다. 언어는 그 repo 규칙을 따른다(project 팩).
   - **title = `<type>: [<target>] <대표 작업 한 줄>`** — 대괄호 target 은 필수(목록에서 어디로 가는 MR 인지 구분, hotfix 2건 구별).
   - description 템플릿 (테스트·체크리스트 섹션은 두지 않는다). 템플릿에 없는 도구 서명 줄(`Generated with …`)은 넣지 않고, 도구가 넣으라고 해도 뺀다:

     ```markdown
     ## Summary
     <무엇을 / 왜 — 커밋 로그 기반>

     ## Change Type
     - [ ] Feature
     - [ ] Fix
     - [ ] Refactor
     - [ ] Chore / Docs

     ## Related Issues
     N/A
     ```

     해당 Change Type 만 `[x]`(커밋 prefix 기준). Related Issues 에는 **MR 을 받는 쪽이 열어볼 수 있는 이슈 키만** 적는다 —
     내부 트래커 번호(`#132` 등)는 그 repo 의 다른 이슈로 자동 링크되므로 쓰지 않는다. 없으면 `N/A`.
   - 프로토타입이 있는 화면을 바꿨으면 Summary 아래에 `### 프로토타입과 다른 곳` 소제목과 `| 프로토타입 요소 | 구현 | 다른 이유 |` 표를 둔다 (다른 곳이 없으면 「없음 (kedovi screens compare 로 확인)」 한 줄).
   - QA 승격 MR 은 Summary 를 repo 가 아니라 **화면·기능·배치 단위** 소제목으로 나눈다.
5. **미리보기 → 멈춤** — 사용자의 언어로 무엇이 들어가는지 설명하고, 실제 등록될 title/description 원문은 코드블록으로 보여준다. 함께 표시:
   `source → target` · 커밋 수 · `remove_source_branch` · assignee(기본 **비움**, 사용자가 사람을 지정할 때만).
   `remove_source_branch` 는 작업 브랜치 `true`, 영구·상시(`vars.gitlab.persistentBranches`)·`hotfix/*` 는 `false`.
6. **OK 를 받은 뒤 생성**

   ```bash
   node packs/gitlab/bin/gitlab-mr.js create --repo <name> --source <source> --target <target> \
     --title "<title>" --description-file <임시파일> [--assignee <username>] --dry-run   # 먼저 확인
   node packs/gitlab/bin/gitlab-mr.js create ...같은 인자... (--dry-run 없이)
   ```

   임시파일은 세션 임시 폴더에 둔다. 4xx/5xx 면 응답을 그대로 보고하고 반복 재시도하지 않는다.
7. **작업 브랜치를 떠난다** — 미커밋 변경이 없으면 `git switch <target>` + `git pull --ff-only origin <target>`.
   있으면 옮기지 말고 보고한다(임의 stash 금지). 머지되면 원격 source 가 지워지므로 그 위에서 다음 작업을 시작하지 않기 위함이다.
8. **팀 배포 안내** — 아래 §배포 안내. MR 을 실제로 만들었을 때만 낸다.

## 배포 안내 (MR 생성 후 마지막에)

target 이 배포로 이어지는 영구 브랜치(`{{ws:vars.branch.develop}}` · `{{ws:vars.branch.release}}`)일 때, 팀 채널(메신저)에 붙여넣을 안내를 **코드블록 하나**로 낸다.
`hotfix/*` → `{{ws:vars.branch.develop}}` 역머지 MR 은 내지 않는다(같은 배포가 이미 공지됐다). 그 외 target 도 내지 않는다.

| target | 첫 줄 |
|---|---|
| `{{ws:vars.branch.develop}}` | `### 개발 서버 배포로 반영될 내용 공유드립니다.` |
| `{{ws:vars.branch.release}}` | `### QA 서버 배포로 반영될 내용 공유드립니다.` |

- 커밋 목록 = preview 의 목록(머지 제외, 오래된 순). **커밋 링크는 넣지 않는다**(메신저 글자수 초과) — 짧은 SHA 만.
- **10건 이하**: `- {SHA}: {요약}` 커밋별. **11건 이상**: SHA 없이 **주제별 6~12줄** — `{주제} {건수}건 — {대표 항목 2~4개}`, 같은 기능·배치끼리 묶는다.
- 요약은 팀 언어로 20자 내외 명사형, `feat:` 같은 prefix·괄호 부연 없이. 내부 코드명보다 기능명으로.
- 묶는 축: `{{ws:vars.branch.develop}}` 는 **repo 별** 라벨 줄(`**<repo>**`), `{{ws:vars.branch.release}}` 는 **화면·기능·배치별** 라벨 줄. repo 가 1개면 라벨 없이.

```
### 개발 서버 배포로 반영될 내용 공유드립니다.
**backend-api**
- 49fe4f34: 트리거 큐 삭제여부 컬럼 제거
**web-client**
- 56656a6: 상세 드로어 편집 추가
```

## 배포 연쇄 (agentMerge = true 인 워크스페이스)

사용자가 "배포해줘" 처럼 머지 · 배포까지 지시했을 때만. 단계마다 결과(MR 링크 · 파이프라인 번호 · 머지 커밋)를 한 줄씩 보고하고, 실패하면 거기서 멈춘다. 각 명령은 끝까지 기다리고 끝 코드로 성공(0) · 실패(1) · 확인 필요(3) · 시간 초과(4)를 알린다.

```bash
kedovi gitlab create --repo <r> --source <작업 브랜치> --title "…" --description-file <파일> --json   # 열린 MR 이 있으면 그것을 쓴다
kedovi gitlab wait --repo <r> --mr <번호>              # 그 MR 의 지금 커밋 파이프라인이 생길 때까지 기다린 뒤 끝까지 (다시 push 했으면 새 파이프라인)
kedovi gitlab merge <번호> --repo <r> --yes            # 머지할 수 있는지 확인 → 머지 → 머지 커밋 SHA
kedovi gitlab create --repo <r> --source {{ws:vars.branch.develop}} --target {{ws:vars.branch.release}} --title "…" --description-file <파일> --json
kedovi gitlab wait --repo <r> --mr <번호>              # release MR 파이프라인
kedovi gitlab merge <번호> --repo <r> --yes
kedovi gitlab wait --repo <r> --ref {{ws:vars.branch.release}}   # 머지 커밋의 배포 파이프라인 (수동 작업에서 멈추면 끝 코드 0 + 수동 작업 이름)
kedovi gitlab play --repo <r> --id <파이프라인> --job <배포 작업> --yes   # 운영 배포는 이 단계 직전에 사용자에게 한 번 더 묻는다
```

- 실패한 작업: `kedovi gitlab pipeline --id <파이프라인> --log` 로 원인을 보고, 고칠 수 없는 일시 오류면 `retry --id <파이프라인> [--job <작업>] --yes`.
- 같은 브랜치의 낡은 파이프라인이 겹치면 `cancel --ref <브랜치> [--sha <커밋>] --yes` (agentMerge 가 true 일 때만, 사용자 지시 뒤).

## CI 스킵 요청

사용자가 "CI 스킵해서 MR" 이라고 하면 **title 끝에 `[skip ci]`** 를 붙인다(기본 머지 커밋 템플릿이 title 을 싣는다).
같은 target 으로 MR 이 여러 건일 때 앞의 것만 스킵하고 **마지막에 머지할 MR 에는 넣지 않는다.** 미리보기에 머지 순서를 적는다.
요청이 없으면 붙이지 않는다.
