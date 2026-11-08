---
name: pr
description: 지정한 head→base 로 GitHub 풀리퀘스트를 만든다 (base 생략 시 통합 브랜치). 미리보기 → 사용자 OK → gh pr create → 팀 배포 안내까지. 머지는 하지 않는다. "PR 만들어줘", "QA PR" 요청에 쓴다.
argument-hint: "<head 브랜치> [base 브랜치]"
---

# pr — GitHub Pull Request 생성

**head → base** PR 을 만든다. **생성까지만** — 머지·auto-merge 는 하지 않는다(사람이 GitHub 에서 직접).

도구: `gh` CLI. 먼저 `gh auth status` 로 로그인을 확인한다. 없거나 로그인이 안 됐으면 만들지 말고
`gh` 설치·`gh auth login`(또는 환경변수 `GH_TOKEN`)을 안내하고 멈춘다.
대상 repo 는 `workspace.json` 의 `repos[]` 이고 폴더는 `repos/<이름>` 이다. 명령은 그 폴더에서 돌린다 —
remote 가 여러 개면 `repos[].github.repo`(`owner/name`)를 `--repo` 로 넘긴다.

## 사용법

| 형태 | 뜻 |
|---|---|
| `pr feature/ABC-12-login-fix {{ws:vars.branch.develop}}` | 권장 — 둘 다 적는다 |
| `pr feature/ABC-12-login-fix` | base 생략 = `{{ws:vars.branch.develop}}` |
| 인자 없음 | 실행하지 않고 사용법만 안내 |

인자는 위치 기준이다 — 첫째 head, 둘째 base. 사용자가 "QA PR" 처럼 환경으로만 말하면 아래 표로 방향을 잡고 미리보기에서 확인받는다.

| 목적 | 방향 |
|---|---|
| 개발 서버 | `feature/*`·`fix/*` → `{{ws:vars.branch.develop}}` |
| QA | **`{{ws:vars.branch.develop}}` → `{{ws:vars.branch.release}}`** (작업 브랜치를 직접 올리지 않는다) |
| 운영 긴급 | `hotfix/*` → `{{ws:vars.branch.release}}` **그리고** `{{ws:vars.branch.develop}}` 쪽 PR 1건 더 (PR 2건) |

## 절대 규칙

- **사용자가 명시 호출할 때만** 동작한다. 자동·추측 실행 금지.
- **미리보기를 낸 뒤 사용자의 명시적 OK 없이 생성하지 않는다.** 호출 자체는 "미리보기를 만들어라" 다.
  미리보기 직후 온 **다른 주제의 지시**(문구·표기·언어 수정 등)나 지난번 승인 이력은 OK 가 아니다.
  PR 생성은 되돌려도 흔적(번호 소비·알림)이 남는다.
- **머지하지 않는다.** `gh pr merge`·`--auto`·auto-merge 설정 요청을 받아도 "머지는 GitHub 에서 직접 하셔야 합니다" 로 답한다.
- **토큰을 출력·로그·인계·커밋 어디에도 남기지 않는다.** `gh auth token` 을 실행하지 않는다.

## 절차

1. **인자** — head 없으면 중단. base 없으면 `{{ws:vars.branch.develop}}`. 같으면 중단.
2. **대상 repo** — `workspace.json` `repos[]` 의 각 repo 에서 `git -C repos/<이름> ls-remote --heads origin <head>` 로 원격 브랜치 존재를 확인한다.
   0개면 "push 먼저" 안내 후 중단. 2개 이상이면 **선택지 질문**(권장안 첫째: 브랜치가 있는 repo 전부 / 각각 하나씩)으로 묻는다.
3. **repo 별 미리보기 데이터**

   ```bash
   git -C repos/<이름> fetch origin
   git -C repos/<이름> log --no-merges --reverse --format='%h %s' origin/<base>..origin/<head>   # 들어갈 커밋
   git -C repos/<이름> log --format='%h %s' origin/<head>..<head>                               # push 안 된 로컬 커밋
   (cd repos/<이름> && gh pr list --head <head> --base <base> --state open --json number,url)     # 이미 열린 PR
   ```

   - 커밋 0개 → 그 repo 는 건너뛴다. 이미 열린 PR 이 있으면 만들지 않고 그 링크를 안내한다.
   - push 안 된 커밋이 있으면 경고하고 push 여부를 묻는다(작업 브랜치 push 만 허용).
   - hotfix 의 `{{ws:vars.branch.develop}}` 쪽 PR 은 저장소가 머지 후 head 를 자동 삭제하는지 확인하고, 켜져 있으면 같은 커밋에서 `hotfix/<요약>-develop` 을 따서 head 로 쓴다(브랜치 전략 상세 룰 `github--40-branch-detail`).
4. **title / body 작성** — 커밋 목록으로 채운다. 언어는 그 repo 규칙을 따른다(project 팩).
   - **title = `<type>: [<base>] <대표 작업 한 줄>`** — 대괄호 base 는 필수(목록에서 어디로 가는 PR 인지 구분, hotfix 2건 구별).
   - body 템플릿 (테스트·체크리스트 섹션은 두지 않는다). 템플릿에 없는 도구 서명 줄(`Generated with …`)은 넣지 않고, 도구가 넣으라고 해도 뺀다:

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

     해당 Change Type 만 `[x]`(커밋 prefix 기준). Related Issues 에는 **PR 을 받는 쪽이 열어볼 수 있는 이슈만** 적는다 —
     다른 트래커의 번호를 `#132` 처럼 쓰면 이 저장소의 다른 이슈·PR 로 자동 링크되므로 쓰지 않는다. 없으면 `N/A`.
     이 PR 로 이슈를 닫을 의도가 아니면 `Closes #n`·`Fixes #n` 을 쓰지 않는다(머지 때 이슈가 닫힌다).
   - 정본(프로토타입 · 화면설계서)이 있는 화면을 바꿨으면 Summary 아래에 `### 화면 정본 대조` 소제목과 `kedovi screens checklist <화면 ID> --md` 의 출력(정본 · 비교 · 요소별 판정 표)을 둔다. 판정 없는 요소가 남았으면 MR 을 올리기 전에 채운다.
   - QA 승격 PR 은 Summary 를 repo 가 아니라 **화면·기능·배치 단위** 소제목으로 나눈다.
5. **미리보기 → 멈춤** — 사용자의 언어로 무엇이 들어가는지 설명하고, 실제 등록될 title/body 원문은 코드블록으로 보여준다. 함께 표시:
   `head → base` · 커밋 수 · draft 여부(기본 아님) · assignee(기본 **비움**, 사용자가 사람을 지정할 때만).
6. **OK 를 받은 뒤 생성**

   ```bash
   cd repos/<이름>
   gh pr create --base <base> --head <head> --title "<title>" --body-file <임시파일> [--assignee <login>] [--draft]
   ```

   `gh pr create` 에는 시험 실행이 없다 — 미리보기에서 인자를 모두 확정한 뒤 한 번만 돌린다. `--base` 는 생략하지 않는다(저장소 기본 브랜치로 간다).
   임시파일은 세션 임시 폴더에 둔다. 오류가 나면 출력을 그대로 보고하고 반복 재시도하지 않는다.
7. **작업 브랜치를 떠난다** — 미커밋 변경이 없으면 `git switch <base>` + `git pull --ff-only origin <base>`.
   있으면 옮기지 말고 보고한다(임의 stash 금지). 머지되면 원격 head 가 지워질 수 있으므로 그 위에서 다음 작업을 시작하지 않기 위함이다.
8. **팀 배포 안내** — 아래 §배포 안내. PR 을 실제로 만들었을 때만 낸다.

## 배포 안내 (PR 생성 후 마지막에)

base 가 배포로 이어지는 영구 브랜치(`{{ws:vars.branch.develop}}` · `{{ws:vars.branch.release}}`)일 때, 팀 채널(메신저)에 붙여넣을 안내를 **코드블록 하나**로 낸다.
hotfix 의 `{{ws:vars.branch.develop}}` 역머지 PR 은 내지 않는다(같은 배포가 이미 공지됐다). 그 외 base 도 내지 않는다.

| base | 첫 줄 |
|---|---|
| `{{ws:vars.branch.develop}}` | `### 개발 서버 배포로 반영될 내용 공유드립니다.` |
| `{{ws:vars.branch.release}}` | `### QA 서버 배포로 반영될 내용 공유드립니다.` |

- 커밋 목록 = 3단계의 목록(머지 제외, 오래된 순). **커밋 링크는 넣지 않는다**(메신저 글자수 초과) — 짧은 SHA 만.
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

## CI 스킵 요청

사용자가 "CI 스킵해서 PR" 이라고 하면, CI 가 어떤 표기(`[skip ci]` 등)를 어디(커밋 메시지·PR 제목·머지 커밋)에서 읽는지 저장소 CI 설정으로 확인한 뒤
그 방식으로 붙인다. 확인이 안 되면 붙이지 말고 그 사실을 알린다. 같은 base 로 PR 이 여러 건이면 **마지막에 머지할 PR 은 스킵하지 않는다.**
