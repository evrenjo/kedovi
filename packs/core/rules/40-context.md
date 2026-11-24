---
title: 컨텍스트 관리
load: always
member: skip
---

## 컨텍스트 관리

- **정본은 `packs/` · `workspace.json`** — 생성물(`AGENTS.md`·`CLAUDE.md`·`.agents/`·`.claude/`·`.codex/`)은 손으로 고치지 않고 `node bin/kit.js sync`.
- **룰보다 장치** — 막아야 할 것은 먼저 훅·린터·검사 스크립트로 만든다.
- **`backup/` 폴더는 어떤 목적으로도 근거로 삼지 않는다.**
- **문서 자리** — 사람이 읽는 문서는 `docs-site/`(사이트 원본, 쓰기 전 `core--45-docs-writing`), AI 가 모은 자료는 `ai-docs/`(규칙은 그 README, 사이트에 안 올림), 이슈 관리 위치는 `issues/README.md`.
- 룰·스킬·문서를 추가·이동·삭제하거나 스크립트를 새로 둘 때는 `.agents/rules/core--41-context-detail.md` 를 먼저 읽는다 (상시 룰은 매 세션 비용이다).
