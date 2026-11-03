---
title: 브랜치·MR·머지 원칙 (통합 브랜치 직접)
load: always
if: vars.gitlab.branchMode=trunk
---

## 브랜치 · MR · 머지 (GitLab, 통합 브랜치 직접)

이 워크스페이스는 브랜치 운영 방식이 `trunk` 다 (`workspace.json` `vars.gitlab.branchMode`). 영구 브랜치는 `{{ws:vars.branch.develop}}`(통합 · 개발 배포)와 `{{ws:vars.branch.release}}`(QA · 운영 배포) 둘이고, **작업은 `{{ws:vars.branch.develop}}` 에서 바로 한다.**

**한 사이클**
1. `{{ws:vars.branch.develop}}` 최신(`git pull --ff-only`)에서 증상 · 현행 동작을 먼저 확인한다
2. 그 자리에서 고치고 검사 · 리뷰를 통과시킨다
3. `{{ws:vars.branch.develop}}` 에 커밋한다. push 직전에 다시 `git pull --ff-only` (밀리면 `git pull --rebase` 로 아직 push 안 한 내 커밋만 올린다) 하고 검사를 다시 돌린 뒤 push 한다. 커밋 · push 승인은 건마다 받는다
4. 운영 배포만 MR: `{{ws:vars.branch.develop}}` → `{{ws:vars.branch.release}}` (`mr` 스킬)
5. 머지: 에이전트 머지 설정 `agentMerge = {{ws:vars.gitlab.agentMerge}}`. `false`(기본)면 사람이 GitLab 에서 머지한다. `true` 면 사용자가 그 MR 의 머지를 지시했을 때만 `kedovi gitlab merge <번호> --yes`

**🚫 금지**
- `feature/*` · `fix/*` · `hotfix/*` 작업 브랜치와 worktree 를 만들지 않는다. 운영 긴급 수정도 `{{ws:vars.branch.develop}}` 에서 고쳐 같은 MR 로 올린다.
- 검사를 통과하지 못한 변경은 push 하지 않는다. 미완 작업은 이 PC 작업 트리에 두고 핸드오프에 「push 안 함 · 이유」를 적는다.
- 같은 repo 를 두 에이전트(팀원)에게 동시에 맡기지 않는다. repo 가 다르면 동시에 해도 된다.
- `agentMerge` 가 `false` 면 에이전트는 MR 생성까지만 한다. `true` 여도 지시 없이 머지하지 않고 auto-merge 는 설정하지 않는다. 답변 · 인계에서 머지를 먼저 꺼내지 않는다.
- `{{ws:vars.branch.release}}` 에 직접 커밋 · push 하지 않는다. 로컬에서 영구 브랜치끼리 머지해 push 하지 않는다.

여러 repo 를 함께 고치면 repo 마다 따로 커밋하고, 배포 MR 도 repo 마다 만든다. 배포 순서(계약을 바꾼 쪽 먼저)는 미리보기에 적는다.
