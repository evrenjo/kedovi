---
title: git 기본
load: always
---

## git 기본

- **커밋·푸시는 사용자가 명시적으로 요청할 때만**, 건마다 확인한다.
- **git 명령은 그 파일이 속한 repo 에서** (`git -C <repo> …`) — repo 마다 따로 커밋하고 루트 repo 에 섞지 않는다.
- **커밋 전에 diff 를 본다** — 의도한 파일만 스테이징하고 비밀값·임시 파일·산출물을 섞지 않는다. 메시지는 repo 관례대로.
- **내가 만들지 않은 변경은 되돌리지 않는다** — 작업 트리에 있던 수정은 사용자 것이다. 겹치면 멈추고 묻는다.
- **파괴적 명령·히스토리 변경은 요청받았을 때만** — `reset --hard`·`checkout -- `·`clean`·amend·rebase·강제 push 전에 `git status` 로 잃을 것을 보이고 승인을 받는다.
- **브랜치 정리** (`cleanupMerged = {{ws:vars.git.cleanupMerged}}`): `false` 면 로컬 브랜치 · worktree 를 지우지 않고 삭제 · prune 을 제안하지도 않는다. `true` 면 머지가 확인된 것만 머지 직후 지운다: 먼저 `git status` 로 미커밋 변경이 없음을, `git merge-base --is-ancestor <브랜치> origin/<대상>` 으로 머지됨을 보인다. 원격 브랜치 삭제는 건마다 승인받는다.
- **넓은 패턴으로 프로세스를 죽이지 않는다** — 내가 띄운 PID 만.
