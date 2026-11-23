---
name: gitlab-issue
description: GitLab 이슈를 찾고 · 읽고 · 등록하고 · 조치 보고를 댓글로 달고 · 닫는다. 초안 → 비슷한 이슈 · 민감정보 검사 → 사용자 OK → 등록 · 댓글 · 닫기. 다시 열기 · 라벨 · 담당자는 하지 않는다. "이슈 등록해줘", "#12 이슈 봐줘", "조치 내용 이슈에 남겨줘", "#12 닫아줘" 요청에 쓴다.
argument-hint: "<등록할 내용 | 이슈 번호> [repo]"
---

# gitlab-issue: GitLab 이슈 찾기 · 읽기 · 등록 · 댓글 · 닫기

도우미: `node packs/gitlab/bin/gitlab-issue.js` (`search` · `view` · `create` · `comment` · `close`, 보내는 것은 `--dry-run` 지원). 보내기 직전에 비밀값 모양이나 글 형식 문제(`kedovi draft check`)가 있으면 스스로 멈춘다.
설정 · 토큰은 `mr` 스킬과 같다: `workspace.json` 의 `repos[].gitlab = {"host", "projectId"}`, 토큰 `GITLAB_TOKEN`(권한 api). 설정이 없으면 무엇을 채워야 하는지 안내하고 멈춘다.
사용자가 repo 를 말하지 않았으면: 이슈 기록 repo(kind `issues`) → 지금 작업 중인 repo 순으로 고르고, 후보가 둘 이상이면 묻는다 (`gitlab-mr.js repos` 로 후보를 본다).

## 사용법

| 요청 | 하는 일 |
|---|---|
| "이슈 등록해줘: <내용>" | 초안 → 검사 → 미리보기 → OK 뒤 등록 |
| "#12 이슈 봐줘" · 이슈 번호만 | 읽기만 (본문 · 댓글 요약) |
| "조치 내용 #12 에 남겨줘" | `ticket` 조치 보고를 댓글 초안으로 → 검사 → 미리보기 → OK 뒤 댓글 |
| "#12 닫아줘" | 닫는 사유 확인 → (사유 댓글 검사 · 미리보기) → OK 뒤 닫기 |

## 절대 규칙

- **미리보기를 낸 뒤 사용자의 명시적 OK 없이 등록 · 댓글 · 닫기를 하지 않는다.** 이슈는 지워도 번호 · 알림 메일이 남는다. 지난번 승인 · 다른 주제의 지시는 OK 가 아니다.
- **검사에서 걸리면 올리지 않는다.** 해당 줄을 고치거나 `***` 로 가린 뒤 다시 검사한다. 검사 결과 값은 화면에 다시 찍지 않는다.
- **닫기는 사용자가 닫으라고 했거나 OK 했을 때만** `close` 로 한다. 다시 열기 · 라벨 · 담당자 · 마일스톤은 하지 않는다 (사람이 GitLab 에서). 본문에 `Closes #n` 을 쓰지 않는다. API 를 직접 부르지 않는다.
- 토큰을 출력 · 기록하지 않는다.

## 등록 절차

1. **초안**: 어조는 `gitlab--30-issue-mr-tone`(발견 경위 → 분석 → 확인 요청), 언어는 그 repo 규칙(project 팩). 제목은 주제 + 현상 한 줄(판정 낱말 금지).

   본문 틀은 꺼내 쓴다 (옮겨 적지 않는다). 결함이면 `bug`, 할 일 · 개선이면 `task`. 그 repo 에 이슈 틀(`.gitlab/issue_templates/`)이 있으면 그 틀이 먼저다 (검사도 그 절을 본다).

   ```bash
   node packs/core/bin/draft.js template bug    # 현상 · 재현 · 기대 / 실제 · 환경
   node packs/core/bin/draft.js template task   # 요약 · 배경 · 현황 · 할 일 · 완료 조건
   ```

   형식은 `core--12-writing-format` (두괄식 · 개조식 · 빈칸 없음 · 이 PC 링크 없음). 환경에는 개인 경로 · 계정 · 사내 주소를 쓰지 않는다.

   로그는 필요한 몇 줄만, 경로는 repo 기준 상대 경로로 줄인다.
2. **비슷한 이슈**: 핵심 낱말 2~3개로 찾는다. 같은 것이 있으면 새로 만들지 말고 그 이슈 댓글을 제안한다.

   ```bash
   node packs/gitlab/bin/gitlab-issue.js search --repo <이름> --q "<낱말>"
   ```

3. **검사**: 제목을 첫 줄에 넣은 본문 파일(세션 임시 폴더)로:

   ```bash
   node packs/core/bin/issue-check.js --file <임시파일> --repo <이름> --type bug|task
   ```

   비밀값 모양 · 개인 경로 · 이메일 · 사설 IP · 금지 낱말(`vars.issue.forbid`)과 글 형식(빈칸 자리표시자 · 필수 절 · 긴 글머리 · 이 PC 에만 있는 것 · 소스 코드 표현)이 0건이어야 한다. 공개 repo 면 경고가 나온다.
4. **미리보기 → 멈춤**: 대상 repo · 공개 여부 · 비슷한 이슈 목록 · 검사 결과를 표로, 실제 올라갈 제목 · 본문 원문은 코드블록으로 보여 준다.
   공개 repo 면 "누구나 읽고 검색에 잡힙니다" 를 한 줄 붙인다.
5. **OK 뒤 등록**: 본문 파일은 제목 줄을 뺀 것. 4xx/5xx 면 응답을 그대로 보고하고 재시도하지 않는다.

   ```bash
   node packs/gitlab/bin/gitlab-issue.js create --repo <이름> --title "<제목>" --description-file <본문 파일> --type bug|task --dry-run   # 먼저 확인
   node packs/gitlab/bin/gitlab-issue.js create ...같은 인자... (--dry-run 없이)
   ```

6. **기록**: 이슈 번호 · 주소를 작업별 기록(`handoffs/<id>/topics/<티켓>.md`)의 `관련:` 에 적는다.

## 읽기

```bash
node packs/gitlab/bin/gitlab-issue.js view --repo <이름> --iid <번호>
```

사용자에게는 현상 · 재현 조건 · 지금까지 나온 의견을 짧게 요약한다. 처리까지 이어지면 `ticket` 스킬로 넘긴다 (입력 = 이 이슈).

## 조치 보고 댓글

1. `ticket` 조치 보고를 완료 댓글 틀(`node packs/core/bin/draft.js template done`: 결과 · 원인 · 조치 · 영향 범위 · 확인 · 재발 방지)로 옮겨 초안을 만든다. 빈 항목은 「없음」. 커밋은 짧은 SHA, MR 은 그 repo 의 번호만 (다른 트래커 번호는 쓰지 않는다).
2. 등록 절차 3~4 와 같이 검사(`--type done`) → 미리보기 → 멈춤.
3. OK 뒤:

   ```bash
   node packs/gitlab/bin/gitlab-issue.js comment --repo <이름> --iid <번호> --body-file <본문 파일> --type done --dry-run   # 먼저 확인
   node packs/gitlab/bin/gitlab-issue.js comment ...같은 인자... (--dry-run 없이)
   ```

   닫을지는 사용자에게 묻는다. 닫으라고 하면 아래 「닫기」 로.

## 닫기

1. 닫는 사유를 확인한다. 조치 댓글을 이미 달았으면 사유 파일 없이 닫는다. 아니면 사유(완료 · 중복 · 재현 안 됨 등)를 짧은 댓글 초안으로 만들어 등록 절차 3~4 와 같이 검사 → 미리보기 → 멈춤.
2. OK 뒤:

   ```bash
   node packs/gitlab/bin/gitlab-issue.js close --repo <이름> --iid <번호> [--reason-file <사유 파일>] [--type done] --dry-run   # 먼저 확인
   node packs/gitlab/bin/gitlab-issue.js close ...같은 인자... (--dry-run 없이)
   ```

   이미 닫혀 있으면 도우미가 알리고 사유 댓글도 남기지 않는다.
