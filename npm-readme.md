# kedovi

**Claude Code · Codex 겸용 AI 협업 워크스페이스 킷**

팀이 같은 규칙으로 AI 에이전트와 일하고, 누가 어느 PC 에서 이어받아도 작업 기록이 남는 워크스페이스(git repo 하나)를 만든다.

> 🚧 개발 중 (0.x): 개인 작업에 쓰려고 만든 도구를 공개한 것입니다. 명령 · 설정 형식이 예고 없이 바뀔 수 있습니다.
>
> ⚠️ 쓰다가 생기는 문제(파일 · 데이터 손실, AI 사용 요금, 보안 사고 등)는 책임지지 않습니다 (MIT 라이선스의 「있는 그대로」 조건). AI 에이전트가 파일을 고치고 명령을 실행하므로, 중요한 저장소에서는 커밋 · 백업을 해 두고 쓰세요.

## 설치

```bash
node -v              # v20.19 이상
npm i -g kedovi
kedovi --version
```

Claude Code(`npm i -g @anthropic-ai/claude-code`) 나 Codex(`npm i -g @openai/codex`) 중 쓸 것도 설치돼 있어야 한다.

설치가 `EACCES: permission denied` 로 실패하면 전역 설치 위치를 홈 폴더로 바꾼 뒤 다시 설치한다 (`sudo` 는 쓰지 않는다. 자세히는 GitHub README 「권한 오류」):

```bash
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
npm i -g kedovi
```

## 빠른 시작

| 누가 | 명령 |
|---|---|
| 리더 (처음 한 번) | `kedovi init` → 유형 · repo · 쓰는 AI 를 고르면 워크스페이스가 만들어진다 |
| 팀원 (처음 한 번) | 워크스페이스 repo 를 clone → `kedovi install` |
| 모두 (매일) | `kedovi start` |
| 킷 새 버전 | `npm i -g kedovi` → 워크스페이스에서 `kedovi upgrade` |

## 더 보기

- 문서 · 화면: https://github.com/evrenjo/kedovi
- 변경 기록: 패키지 안 `CHANGELOG.md`
- 라이선스: MIT
