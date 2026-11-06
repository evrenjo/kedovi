#!/usr/bin/env node
// 오래된 환경 사실 알림 (Claude Code · Codex). PostToolUse(Read · Bash): 에이전트가 md 문서를 읽었는데 「확인일」 칸이 있는 표에
// 확인일이 vars.docs.factDays(기본 30일, 0 = 끔)보다 오래된 행이 있으면 「재확인 필요: <사실> (확인일 …, 확인 명령 …)」 를 알린다.
// Read 는 그 파일, Bash 는 cat · sed · head 등 읽는 명령의 .md 인자. 같은 파일은 세션당 한 번. 팀원 · 위임 세션에서도 돈다 (문서를 근거로 쓰는 쪽).
// 알림만 한다 (additionalContext JSON). 예외는 삼키고 항상 exit 0
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const READERS = new Set(['cat', 'less', 'more', 'head', 'tail', 'bat', 'batcat', 'nl', 'sed', 'gsed', 'awk', 'grep', 'rg', 'view']);
const MAX_ROWS = 5;

/** Bash 명령 → 읽는 .md 파일 (절대경로) */
function mdFilesOf(cmd, cwd) {
  const { tokens } = require('./repo-guard');
  const { parts } = require('./git-guard');
  const out = [];
  for (const seg of parts(String(cmd || ''))) {
    const t = tokens(String(seg.text || '').trim()).filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x));
    if (!READERS.has(path.basename(t[0] || ''))) continue;
    for (const a of t.slice(1)) {
      if (a.startsWith('-') || !/\.md$/i.test(a) || /[$`*?]/.test(a)) continue;
      out.push(path.resolve(cwd, a.replace(/^~(?=\/)/, os.homedir())));
    }
  }
  return [...new Set(out)];
}

/** 세션당 한 번: 이미 알린 파일이면 true, 아니면 기록하고 false */
function seen(input, file) {
  try {
    const { safeId } = require('../lib/hook');
    const { stateDir } = require('../lib/workspace');
    const id = safeId(input.session_id);
    if (!id) return false;
    const f = path.join(stateDir(input.cwd || process.cwd()), `${id}.fresh`);
    let list = [];
    try { list = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { /* 처음 */ }
    if (list.includes(file)) return true;
    fs.appendFileSync(f, `${file}\n`);
  } catch { /* 기록 못 하면 매번 알린다 */ }
  return false;
}

function message(file, rows, days) {
  const shown = rows.slice(0, MAX_ROWS).map((r) => `- ${require('../lib/freshness').staleLine(r)} (${path.basename(file)}:${r.line})`);
  return [`⚠ 오래된 환경 사실 (확인일 ${days}일 넘음) ${rows.length}행: ${file}`, ...shown, ...(rows.length > MAX_ROWS ? [`- 외 ${rows.length - MAX_ROWS}행`] : []),
    '이 행을 근거로 쓰기 전에 확인 명령을 다시 돌린다. 같으면 확인일만, 다르면 값과 확인일을 고친다 (기획 repo 면 그 repo 의 방식대로). (fact-freshness)'].join('\n');
}

function main() {
  const { readInput } = require('../lib/hook');
  const input = readInput();
  if (String(input.hook_event_name || '') !== 'PostToolUse') return;
  const tool = String(input.tool_name || '');
  const ti = input.tool_input || {};
  const cwd = input.cwd || process.cwd();
  let days = 30;
  try { days = require('../lib/freshness').daysOf(require('../lib/workspace').load()); } catch { /* 워크스페이스 밖: 기본 */ }
  if (!days) return;
  const files = tool === 'Read' ? (ti.file_path && /\.md$/i.test(ti.file_path) ? [path.resolve(cwd, ti.file_path)] : []) : tool === 'Bash' ? mdFilesOf(ti.command, cwd) : [];
  const { staleRows } = require('../lib/freshness');
  const notes = [];
  for (const f of files) {
    let text;
    try { if (fs.statSync(f).size > 2 * 1024 * 1024) continue; text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (!/확인일/.test(text)) continue;
    const rows = staleRows(text, days);
    if (rows.length && !seen(input, f)) notes.push(message(path.relative(cwd, f) || f, rows, days));
  }
  if (notes.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n') } }));
}

if (require.main === module) {
  try { main(); } catch { /* 훅은 세션을 깨지 않는다 */ }
  process.exit(0);
}
module.exports = { mdFilesOf };
