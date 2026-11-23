#!/usr/bin/env node
// 응답 언어 · 대화 스타일 한 줄 (Claude Code · Codex): UserPromptSubmit = 값이 바뀌거나 요청 10번 · 30분마다, PostToolUse = 긴 작업 중 도구 15번 · 4분마다 한 번.
/*
 * 긴 작업 중 진행 알림이 다른 언어로 새는 것을 막는다. 규칙 정본은 개인 지침 머리(lib/chatprefs.js headSection)이고 이 줄은 다시 알리기만.
 * 요청 시작 때 한 번만 알리면, 도구 결과(영어 로그 · 코드)가 수십 번 쌓인 뒤의 진행 알림이 영어로 바뀐다. 작업 중간에 보낸 메시지도 요청 시작 훅을 거치지 않는다.
 * 그래서 PostToolUse 에서 도구 호출 수 · 시간을 세어 다시 알린다 (세션별 상태: lib/workspace stateDir 의 <세션>.lang).
 * 값: 이 PC .agents/local.json chat → 팀 workspace.json chat → 기본(팀 문서 언어 · 일반). kedovi prefs
 * 출력: UserPromptSubmit 은 평문(두 도구 모두 문맥에 더함), PostToolUse 는 JSON hookSpecificOutput(hookEventName 필수. Codex 는 PostToolUse 평문을 버린다). 근거: developers.openai.com/codex/hooks, codex-cli 0.159 실측
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { run, readInput, context, safeId, root } = require('../lib/hook');
const { stateDir } = require('../lib/workspace');
const prefs = require('../lib/chatprefs');

const EVERY_TOOLS = 15;
const EVERY_MS = 4 * 60 * 1000;
const ASK_EVERY = 10; // 요청 시작 때 같은 줄을 다시 넣는 간격 (요청 수)
const ASK_MS = 30 * 60 * 1000; // 또는 시간
const MIN_TOOLS = 3; // 시간이 지나도 도구를 이만큼은 쓴 뒤에 (짧은 요청에는 다시 넣지 않는다)

run(() => {
  const input = readInput();
  const R = root();
  const line = prefs.reminder(prefs.resolve(R));
  const id = safeId(input.session_id);
  const file = id ? path.join(stateDir(R), `${id}.lang`) : null;
  const save = (st) => { if (file) try { fs.writeFileSync(file, JSON.stringify(st)); } catch { /* 상태는 편의 */ } };
  let st = { n: 0, at: Date.now() };
  try { if (file) st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* 처음 */ }
  if (String(input.hook_event_name || '') !== 'PostToolUse') {
    // 요청 시작: 값이 바뀌었거나, 마지막으로 넣은 지 30분 · 요청 10번이 지났을 때만 (같은 줄을 요청마다 쌓지 않는다)
    const asked = (Number(st.asked) || 0) + 1;
    const due = st.line !== line || asked >= ASK_EVERY || Date.now() - (Number(st.at) || 0) >= ASK_MS;
    save({ ...st, n: due ? 0 : st.n, at: due ? Date.now() : st.at, asked: due ? 0 : asked, line });
    if (due) context(line);
    return;
  }
  if (!file) return;
  st.n = (Number(st.n) || 0) + 1;
  const due = st.n >= EVERY_TOOLS || (st.n >= MIN_TOOLS && Date.now() - (Number(st.at) || 0) >= EVERY_MS);
  if (!due) return save(st);
  save({ ...st, n: 0, at: Date.now(), line });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: line } }));
});
