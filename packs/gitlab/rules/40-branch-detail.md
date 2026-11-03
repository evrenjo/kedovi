---
title: 브랜치 전략 상세
load: on-demand
when: 브랜치를 새로 따거나, MR 방향(source→target)·hotfix·브랜치 이름을 정할 때
if: vars.gitlab.branchMode!=trunk
---

## 브랜치 전략 상세

### 브랜치 표

| 브랜치 | 수명 | 어디서 따나 | 어디로 MR | MR 머지 시 source 삭제 |
|---|---|---|---|---|
| `{{ws:vars.branch.develop}}` | 영구 | — | `{{ws:vars.branch.release}}` (QA 승격) | 하지 않는다 |
| `{{ws:vars.branch.release}}` | 영구 | — | — | — |
| `feature/{티켓키}-{영문요약}` | 작업 단위 | `{{ws:vars.branch.develop}}` | `{{ws:vars.branch.develop}}` | 한다 |
| `fix/{티켓키}-{영문요약}` | 작업 단위 | `{{ws:vars.branch.develop}}` | `{{ws:vars.branch.develop}}` | 한다 |
| `hotfix/{영문요약}` | 긴급 | **`{{ws:vars.branch.release}}`** | **`{{ws:vars.branch.release}}` + `{{ws:vars.branch.develop}}`** | 둘 다 하지 않는다 (한쪽 머지로 지워지면 나머지 MR 이 깨진다) |

- 요약은 영어 kebab-case 2~4 단어. 브랜치 하나 = 티켓 하나.
- 프로젝트가 **상시 작업 브랜치**(티켓 없는 내부 건 모음 등)를 두면 project 팩에 적고, `workspace.json` `vars.gitlab.persistentBranches` 에 넣어 MR 시 삭제되지 않게 한다.
- 머지는 항상 MR 로. 로컬에서 영구 브랜치에 머지해 push 하지 않는다.

### MR 방향

| 목적 | 방향 |
|---|---|
| 개발 서버 반영 | `feature/*`·`fix/*` → `{{ws:vars.branch.develop}}` |
| QA 승격 | **`{{ws:vars.branch.develop}}` → `{{ws:vars.branch.release}}`** (그 사이 들어간 남의 작업까지 담긴다) |
| 운영 긴급 | `hotfix/*` → `{{ws:vars.branch.release}}` **그리고** → `{{ws:vars.branch.develop}}` |

커밋 수만 봐서는 방향 오류가 드러나지 않는다(이미 머지된 브랜치는 `{{ws:vars.branch.develop}}` 대비 0건, `{{ws:vars.branch.release}}` 대비 수십 건). 미리보기에서 `source → target` 을 반드시 눈으로 확인받는다.

### MR 직전 동기화

```bash
git fetch origin
git merge origin/{{ws:vars.branch.develop}}   # 충돌은 브랜치 주인이 푼다
# 빌드·검증 재실행 — 텍스트 충돌 없는 의미 충돌(시그니처·타입·시드 변경)을 잡는다
git push
```

- rebase 금지 — push 된 브랜치라 force push 가 필요해지고 리뷰 코멘트가 떨어져 나간다.
- 작업이 며칠 이어지면 주기적으로 같은 동기화를 한다. 재개할 때도 이것부터.

### 자주 하는 실수

| 실수 | 대신 |
|---|---|
| `{{ws:vars.branch.develop}}` 에서 바로 고치기 시작 | 고치기 전에 `git switch -c` |
| 증상 확인 없이 고치기 | `{{ws:vars.branch.develop}}` 에서 현행 동작부터 본다 |
| 오래된 로컬에서 브랜치 생성 | `git pull --ff-only` 먼저 |
| hotfix 를 `{{ws:vars.branch.release}}` 에만 | `{{ws:vars.branch.develop}}` 역머지 MR 도 |
| 영구 브랜치 MR 에 source 삭제 체크 | 작업 브랜치에만 |
| 깨진 커밋을 MR | 브랜치에서 빌드·검증 통과 후 |
