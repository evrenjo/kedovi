#!/usr/bin/env node
// Claude Code 상태 줄: 입력의 요금제 사용률을 기록하고(lib/usagepace.js), 사용자의 전역 상태 줄이 있으면 그 출력을 그대로 보인다. 항상 exit 0
/*
 * 프로젝트 설정의 상태 줄이 전역 설정을 가리므로 전역 명령을 대신 돌려 준다. 없으면 주간 사용률 한 줄.
 * 속도가 빠르면(단계 1 이상) 끝에 경고를 붙인다. 표시는 3초 안에 끝낸다
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('../lib/usagepace');

function globalCommand() {
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
    const c = (JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).statusLine || {}).command;
    return c && !c.includes('usage-status.js') ? c : null;
  } catch { return null; }
}

function main() {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch { /* 입력 없음 */ }
  let input = {};
  try { input = JSON.parse(raw); } catch { /* 깨짐 */ }
  try { P.record(input.rate_limits); } catch { /* 기록은 부가 */ }
  let ws = {};
  const dir = ((input.workspace || {}).project_dir) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try { ws = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8')); } catch { /* 없음 */ }
  const s = P.state(ws);
  let out = '';
  const cmd = globalCommand();
  if (cmd) { const r = spawnSync('sh', ['-c', cmd], { input: raw, encoding: 'utf8', timeout: 2500, cwd: dir }); out = String(r.stdout || '').replace(/\s+$/, ''); }
  const mark = !s.known || !s.level ? '' : s.fiveHot ? `⚠ 5시간 ${Math.round(s.five.used)}% (${s.label})` : `⚠ 주간 ${Math.round(s.used)}% (속도 +${Math.round(s.over)} · ${s.label})`;
  if (!out) out = s.known ? (mark || `주간 ${Math.round(s.used)}%`) : '';
  else if (mark) out += ` · ${mark}`;
  if (out) process.stdout.write(`${out}\n`);
}

try { main(); } catch { /* 상태 줄은 세션을 깨지 않는다 */ }
process.exit(0);
