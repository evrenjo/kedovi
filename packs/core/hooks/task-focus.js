#!/usr/bin/env node
// UserPromptSubmit 훅 (Claude Code) — 요청마다 진행 중 작업의 "한 줄 · 미완 완료 조건 · 지킬 것" 을 짧게 다시 넣는다.
/*
 * 세션 시작 때 읽은 규칙은 대화가 길어지거나 컨텍스트가 압축되면 흐려진다. 행동 직전에 매번 다시 넣는 것이 가장 덜 놓친다.
 * 출력: 평문 1~2줄 (컨텍스트에 추가). 날짜가 된 예약([>] 오늘 예정 · 지난 예약)이 있는 작업, 그다음 최근 7일 안에 손댄 진행 중 작업, 모두 2개까지. 없으면 출력하지 않는다. 항상 exit 0.
 * 같은 세션에서 직전 요청과 내용이 같으면 넣지 않는다 (2시간 지나면 다시). 상태 폴더의 <session>.focus
 * Codex 는 UserPromptSubmit 의 평문 출력 계약이 확인되지 않아 Claude 에만 건다 (hooks.json agents: claude).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { run, context, readInput, safeId } = require('../lib/hook');
const { load, devId, localDate, stateDir } = require('../lib/workspace');
const { activeTopics, dueTopics } = require('../lib/topics');

run(() => {
  const input = readInput();
  const ws = load();
  const id = devId(ws.root);
  if (!id) return;
  // 날짜가 된 예약([>])이 있는 작업을 먼저 (손댄 지 오래됐어도)
  const due = dueTopics(ws.root, id);
  const topics = [...due, ...activeTopics(ws.root, id, Date.now() - 7 * 86400000, localDate()).filter((t) => !due.some((d) => d.name === t.name))].slice(0, 2);
  if (!topics.length) return;
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const parts = topics.map((t) => {
    const todo = t.todo.length ? ` · 미완 ${t.todo.length}: ${cut(t.todo.slice(0, 3).join('; '), 160)}` : '';
    const later = t.later.length ? ` · 예약 ${t.later.length}: ${cut(t.later.slice(0, 2).map((x) => `${x.date} ${x.text}`).join('; '), 80)}` : '';
    const keep = t.keep.length ? ` · 지킬 것: ${cut(t.keep.slice(0, 3).join('; '), 200)}` : '';
    return `${t.name}${t.summary ? ` (${cut(t.summary, 60)})` : ''}${todo}${later}${keep}`;
  });
  const text = `🎯 진행 중 작업: ${parts.join(' | ')}`;
  const sid = safeId(input.session_id);
  const file = sid ? path.join(stateDir(ws.root), `${sid}.focus`) : null;
  let prev = null;
  try { if (file) prev = fs.readFileSync(file, 'utf8'); } catch { /* 처음 */ }
  // 직전과 같으면 넣지 않는다. 같아도 2시간이 지났으면 다시 (맥락이 요약돼 잊었을 수 있다)
  let at = 0;
  try { if (file) at = fs.statSync(file).mtimeMs; } catch { /* 처음 */ }
  if (prev === text && Date.now() - at < 2 * 3600000) return;
  if (file) fs.writeFileSync(file, text);
  context(text);
});
