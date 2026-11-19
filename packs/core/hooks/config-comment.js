#!/usr/bin/env node
// 설정 파일 주석 알림 (Claude Code · Codex PostToolUse): 고친 환경 · 설정 파일의 주석이 글 기준에 어긋나면 에이전트에게 알린다. 막지 않는다.
/*
 * 보는 것 = lib/confcomments.js. 출력에는 줄 번호와 종류만 넣고 값은 넣지 않는다.
 * 수준 agents.enforce.draftCheck 가 off 면 보지 않는다. 항상 exit 0
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, run, root } = require('../lib/hook');
const C = require('../lib/confcomments');
const D = require('../lib/draft');
const P = require('../lib/prosestyle');

/** 이번 도구 호출이 고친 파일 */
function filesOf(input) {
  const ti = input.tool_input || {};
  const cwd = input.cwd || process.cwd();
  if (/^(Edit|MultiEdit|Write)$/.test(String(input.tool_name || ''))) return ti.file_path ? [path.resolve(cwd, ti.file_path)] : [];
  const patch = String(ti.command || ti.patch || ti.input || '');
  return [...patch.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)].map((m) => path.resolve(cwd, m[1].trim()));
}

run(() => {
  const input = readInput();
  if (String(input.hook_event_name || '') !== 'PostToolUse') return;
  const files = filesOf(input).filter((f) => C.kindOf(f));
  if (!files.length) return;
  const ROOT = root();
  if (D.levelOf(ROOT) === 'off') return;
  let ws = {};
  try { ws = JSON.parse(fs.readFileSync(path.join(ROOT, 'workspace.json'), 'utf8')); } catch { /* 기본값 */ }
  const cfg = P.settings(ws);
  const notes = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const hits = C.scan(f, text, cfg);
    if (hits.length) notes.push(`${path.basename(f)}: ${hits.slice(0, 8).map((h) => `${h.line}줄 ${h.kind}`).join(' / ')}${hits.length > 8 ? ` 외 ${hits.length - 8}건` : ''}`);
  }
  if (notes.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `설정 파일 주석 점검 (규칙: core--12-writing-format): ${notes.join(' | ')}` } }));
}, { teammateEvents: ['PostToolUse'] });
