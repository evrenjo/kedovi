---
title: 브랜치 전략 상세 (통합 브랜치 직접)
load: on-demand
when: 운영 배포 MR 을 만들거나, 통합 브랜치에 push 가 밀렸거나, 예외로 브랜치 · worktree 를 써야 할 때
if: vars.gitlab.branchMode=trunk
---

## 브랜치 전략 상세 (통합 브랜치 직접)

### 브랜치 표

| 브랜치 | 수명 | 하는 일 | 어디로 MR |
|---|---|---|---|
| `{{ws:vars.branch.develop}}` | 영구 | 개발 · 커밋 · push (개발 서버 배포) | `{{ws:vars.branch.release}}` (운영 배포) |
| `{{ws:vars.branch.release}}` | 영구 | 운영 배포 | 없음 |

### push 가 밀렸을 때

```bash
git pull --rebase origin {{ws:vars.branch.develop}}   # 아직 push 안 한 내 커밋만 다시 쌓인다
# 빌드 · 검사 다시: 텍스트 충돌 없는 의미 충돌(시그니처 · 타입 · 시드 변경)을 잡는다
git push
```

- 이미 push 한 커밋은 rebase · amend 하지 않는다. 강제 push 금지.
- 충돌이 나면 멈추고 보인다. 남의 변경을 덮지 않는다.

### 운영 배포 MR

- 방향은 항상 `{{ws:vars.branch.develop}}` → `{{ws:vars.branch.release}}`. 그 사이 들어간 남의 커밋까지 담기므로 미리보기 커밋 목록을 사용자에게 보인다.
- 만든 뒤 `{{ws:vars.branch.develop}}` 에 그대로 남는다 (`mr` 스킬의 「작업 브랜치를 떠난다」 단계는 건너뛴다). source 브랜치는 지우지 않는다.

### 예외로 브랜치 · worktree 를 썼을 때

실험 · 큰 리팩터링처럼 사용자가 브랜치를 쓰라고 한 건만. 머지가 확인되면 바로 정리한다 (core 「git 기본」 의 브랜치 정리 설정과 상관없이): `git status` 로 잃을 것이 없음을, `git merge-base --is-ancestor <브랜치> origin/{{ws:vars.branch.develop}}` 로 머지됨을 보인 뒤 로컬 브랜치 · worktree 를 지운다. 원격 브랜치 삭제는 건마다 승인받는다.
