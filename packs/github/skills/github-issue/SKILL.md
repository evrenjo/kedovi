---
name: github-issue
description: GitHub 이슈를 찾고 · 읽고 · 등록하고 · 조치 보고를 댓글로 단다. 초안 → 비슷한 이슈 · 민감정보 검사 → 사용자 OK → gh issue create / comment. 닫기 · 라벨 · 담당자는 하지 않는다. "이슈 등록해줘", "#12 이슈 봐줘", "조치 내용 이슈에 남겨줘" 요청에 쓴다.
argument-hint: "<등록할 내용 | 이슈 번호> [repo]"
---

# github-issue: GitHub 이슈 찾기 · 읽기 · 등록 · 댓글

도구: `gh` CLI. 먼저 `gh auth status` 로 로그인을 확인한다. 안 됐으면 `gh auth login`(또는 환경변수 `GH_TOKEN`)을 안내하고 멈춘다.
대상 repo 는 `workspace.json` 의 `repos[]` 이고 명령은 그 폴더(`repos/<이름>`)에서 돌린다. remote 가 여러 개면 `repos[].github.repo`(`owner/name`)를 `--repo` 로 넘긴다.
사용자가 repo 를 말하지 않았으면: 이슈 기록 repo(kind `issues`) → 지금 작업 중인 repo 순으로 고르고, 후보가 둘 이상이면 묻는다.

## 사용법

| 요청 | 하는 일 |
|---|---|
| "이슈 등록해줘: <내용>" | 초안 → 검사 → 미리보기 → OK 뒤 등록 |
| "#12 이슈 봐줘" · 이슈 번호만 | 읽기만 (본문 · 댓글 요약) |
| "조치 내용 #12 에 남겨줘" | `ticket` 조치 보고를 댓글 초안으로 → 검사 → 미리보기 → OK 뒤 댓글 |

## 절대 규칙

- **미리보기를 낸 뒤 사용자의 명시적 OK 없이 등록 · 댓글하지 않는다.** 이슈는 지워도 번호 · 알림 메일이 남는다. 지난번 승인 · 다른 주제의 지시는 OK 가 아니다.
- **검사에서 걸리면 올리지 않는다.** 해당 줄을 고치거나 `***` 로 가린 뒤 다시 검사한다. 검사 결과 값은 화면에 다시 찍지 않는다.
- **닫기 · 다시 열기 · 라벨 · 담당자 · 마일스톤은 하지 않는다** (사람이 GitHub 에서). 본문에 `Closes #n` 을 쓰지 않는다.
- 토큰을 출력 · 기록하지 않는다. `gh auth token` 을 실행하지 않는다.

## 등록 절차

1. **초안**: 어조는 `github--30-issue-pr-tone`(발견 경위 → 분석 → 확인 요청), 언어는 그 repo 규칙(project 팩). 제목은 주제 + 현상 한 줄(판정 낱말 금지).

   본문 틀은 꺼내 쓴다 (옮겨 적지 않는다). 결함이면 `bug`, 할 일 · 개선이면 `task`. 그 repo 에 이슈 틀(`.github/ISSUE_TEMPLATE/`)이 있으면 그 틀이 먼저다 (검사도 그 절을 본다).

   ```bash
   node packs/core/bin/draft.js template bug    # 현상 · 재현 · 기대 / 실제 · 환경
   node packs/core/bin/draft.js template task   # 요약 · 배경 · 현황 · 할 일 · 완료 조건
   ```

   형식은 `core--12-writing-format` (두괄식 · 개조식 · 빈칸 없음 · 이 PC 링크 없음). 환경에는 개인 경로 · 계정 · 사내 주소를 쓰지 않는다.

   로그는 필요한 몇 줄만, 경로는 repo 기준 상대 경로로 줄인다.
2. **비슷한 이슈**: 핵심 낱말 2~3개로 찾는다. 같은 것이 있으면 새로 만들지 말고 그 이슈 댓글을 제안한다.

   ```bash
   (cd repos/<이름> && gh issue list --search "<낱말>" --state all --limit 10 --json number,title,state,url)
   ```

3. **검사**: 제목을 첫 줄에 넣은 본문 파일(세션 임시 폴더)로:

   ```bash
   node packs/core/bin/issue-check.js --file <임시파일> --repo <이름> --type bug|task
   ```

   비밀값 모양 · 개인 경로 · 이메일 · 사설 IP · 금지 낱말(`vars.issue.forbid`)과 글 형식(빈칸 자리표시자 · 필수 절 · 긴 글머리 · 이 PC 에만 있는 것)이 0건이어야 한다. 공개 repo 면 경고가 나온다.
4. **미리보기 → 멈춤**: 대상 repo · 공개 여부 · 비슷한 이슈 목록 · 검사 결과를 표로, 실제 올라갈 제목 · 본문 원문은 코드블록으로 보여 준다.
   공개 repo 면 "누구나 읽고 검색에 잡힙니다" 를 한 줄 붙인다.
5. **OK 뒤 등록**: 본문 파일은 제목 줄을 뺀 것. 미리보기와 같은 내용으로 한 번만 돌린다 (시험 실행이 없다). 오류면 출력을 그대로 보고하고 재시도하지 않는다.

   ```bash
   (cd repos/<이름> && gh issue create --title "<제목>" --body-file <본문 파일>)
   ```

6. **기록**: 이슈 번호 · 주소를 작업별 기록(`handoffs/<id>/topics/<티켓>.md`)의 `관련:` 에 적는다.

## 읽기

```bash
(cd repos/<이름> && gh issue view <번호> --comments)
```

사용자에게는 현상 · 재현 조건 · 지금까지 나온 의견을 짧게 요약한다. 처리까지 이어지면 `ticket` 스킬로 넘긴다 (입력 = 이 이슈).

## 조치 보고 댓글

1. `ticket` 조치 보고를 완료 댓글 틀(`node packs/core/bin/draft.js template done`: 결과 · 원인 · 조치 · 영향 범위 · 확인 · 재발 방지)로 옮겨 초안을 만든다. 빈 항목은 「없음」. 커밋은 짧은 SHA, PR 은 그 repo 의 번호만 (다른 트래커 번호는 쓰지 않는다).
2. 등록 절차 3~4 와 같이 검사(`--type done`) → 미리보기 → 멈춤.
3. OK 뒤 (훅이 `gh` 이슈 · PR 명령의 본문을 같은 글 형식 검사로 보고 걸리면 막는다):

   ```bash
   (cd repos/<이름> && gh issue comment <번호> --body-file <본문 파일>)
   ```

   닫을지는 사용자에게 맡긴다 ("닫는 것은 GitHub 에서 직접 하시면 됩니다").
