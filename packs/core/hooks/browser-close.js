#!/usr/bin/env node
// 브라우저 닫기 점검 (Claude Code) — 브라우저 MCP(playwright · chrome-devtools 등)로 브라우저를 열고 닫지 않은 채 끝내면 한 번 막는다
/*
 * 까닭: 닫지 않은 브라우저(Chrome)가 MCP 서버와 함께 남아 세션마다 수백 MB 씩 쌓인다.
 * PostToolUse(mcp__*): 브라우저 MCP 의 도구를 쓰면 「열림」, 닫기 도구(browser_close · close_browser · close_page)를 쓰면 「닫힘」 을 부른 쪽(메인 · 서브에이전트 · 팀원)마다 적는다
 * Stop(메인 · 팀원 세션) · SubagentStop(서브에이전트): 열린 채면 한 번 막고 닫으라고 알린다 (같은 열림은 한 번만)
 * 브라우저 MCP 판정: 서버 이름에 playwright · chrome · browser · puppeteer · devtools. 수준 agents.enforce.browserClose (off | block, 기본 block)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, block, run, root, safeId } = require('../lib/hook');
const { stateDir } = require('../lib/workspace');

const SERVER = /playwright|chrome|browser|puppeteer|devtools/i;
const CLOSE = /(^|_)(browser_close|close_browser|close_page|close)$/i;

run(() => {
  const input = readInput();
  const id = safeId(input.session_id);
  if (!id) return;
  const ROOT = root();
  const ev = String(input.hook_event_name || '');
  const file = path.join(stateDir(ROOT), `${id}.browser.json`);
  let st = {};
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 처음 */ }
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(st)); } catch { /* 기록 실패 */ } };
  if (ev === 'PostToolUse') {
    const m = String(input.tool_name || '').match(/^mcp__(.+?)__(.+)$/);
    if (!m || !SERVER.test(m[1])) return;
    const who = String(input.agent_id || 'main');
    const cur = st[who] || {};
    if (CLOSE.test(m[2])) st[who] = { ...cur, open: false, server: m[1] };
    else if (!cur.open) st[who] = { open: true, server: m[1], at: Date.now(), warned: false };
    else return;
    return save();
  }
  if (ev !== 'Stop' && ev !== 'SubagentStop') return;
  const who = ev === 'SubagentStop' ? String(input.agent_id || '') : 'main';
  const cur = st[who];
  if (!cur || !cur.open || cur.warned) return;
  let level = 'block';
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); level = (kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).enforce || {}).browserClose || level; } catch { /* 옛 워크스페이스 */ }
  cur.warned = true;
  save();
  if (level !== 'block') return;
  block(`브라우저 MCP(${cur.server})로 브라우저를 열고 닫지 않았습니다. 이 작업에서 더 쓰지 않으면 그 MCP 의 닫기 도구(browser_close · close_page)로 닫고 끝낸다. 닫지 않으면 Chrome 이 세션마다 남아 메모리를 차지한다. 사용자가 화면을 계속 볼 것이면 그대로 두고 보고에 「브라우저 열어 둠」 을 적는다. 수준 바꾸기: kedovi team-mode enforce browser off|block`);
}, { teammateEvents: ['PostToolUse', 'Stop'] });
