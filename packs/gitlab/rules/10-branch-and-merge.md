---
title: 브랜치·MR·머지 원칙
load: always
---

## 브랜치 · MR · 머지 (GitLab)

영구 브랜치는 `{{ws:vars.branch.develop}}`(통합·개발 배포) 와 `{{ws:vars.branch.release}}`(QA·운영 배포) 둘이다.
작업은 **작업 브랜치**(`feature/*` · `fix/*` · `hotfix/*`)에서만 한다.

**한 사이클 (예외 없음)**
1. `{{ws:vars.branch.develop}}` 최신(`git pull --ff-only`)에서 증상·현행 동작을 먼저 확인한다
2. 거기서 작업 브랜치를 딴다 — 고치기 **전에** 딴다
3. 그 브랜치에서만 커밋·push 한다
4. MR 직전 `{{ws:vars.branch.develop}}` **을 내 브랜치로** 머지(`git merge origin/{{ws:vars.branch.develop}}`)하고 빌드·검증을 다시 돌린다 — 충돌이 없어도. rebase 하지 않는다
5. MR 을 만든다 (`mr` 스킬)
6. 머지: 에이전트 머지 설정 `agentMerge = {{ws:vars.gitlab.agentMerge}}`. `false`(기본)면 **사람이 GitLab 에서 머지한다**. `true` 면 사용자가 그 MR 의 머지를 지시했을 때만 `kedovi gitlab merge <번호> --yes` (`mr` 스킬 「배포 연쇄」)

**🚫 금지**
- `{{ws:vars.branch.develop}}` 를 체크아웃한 채 고치거나 push 하지 않는다. 이미 고쳤으면 커밋하지 말고 `git switch -c <브랜치>`.
- `agentMerge` 가 `false` 면 에이전트는 **MR 생성까지만** 한다. `{{ws:vars.branch.develop}}`·`{{ws:vars.branch.release}}` 로의 머지 · 파이프라인 취소는 **요청받아도 수행하지 않고** "머지는 GitLab 에서 직접 하셔야 합니다 (에이전트에게 맡기려면 workspace.json `vars.gitlab.agentMerge` 를 true 로)" 라고 답한다. `true` 여도 지시 없이 머지하지 않고 auto-merge 는 설정하지 않는다.
- 답변·안내·인계에서 머지를 먼저 꺼내지 않는다.
- 작업 브랜치를 `{{ws:vars.branch.release}}` 로 직접 올리지 않는다 — QA MR 의 source 는 항상 `{{ws:vars.branch.develop}}`.

**hotfix** 는 `{{ws:vars.branch.release}}` 에서 따고 MR 을 **2건**(`{{ws:vars.branch.release}}` + `{{ws:vars.branch.develop}}`) 만든다. 하나만 있으면 끝난 게 아니다.
여러 repo 를 함께 고치면 브랜치 이름을 **양쪽 같게** 한다(MR 이 짝을 이룬다).
