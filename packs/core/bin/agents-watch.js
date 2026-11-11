#!/usr/bin/env node
// 에이전트 진행 보기 (Claude Code): 메인이 부른 작업 리더 · 역할 에이전트 · 그 아래 팀원이 지금 무엇을 하는지 나무 모양으로 본다.
// 실행: kedovi agents watch [--once] [--all] [--json] [--session <id>] [--tmux]
/*
 * 읽는 곳: Claude Code 의 대화 기록 ~/.claude/projects/<워크스페이스 경로>/<세션>/subagents/agent-<id>.jsonl · .meta.json
 *   meta = agentType · description · name · parentAgentId(메인이 부른 것은 없음) · spawnDepth · finished
 * 이름 없이 띄운 서브에이전트(작업 리더 · 리더 아래 팀원)는 tmux 창이 없어 이것으로 본다. 이름 있는 팀원(agent teams)은 tmux 창으로.
 *   --once     한 번만 그리고 끝 (채팅 · 스크립트용)
 *   --all      끝난 에이전트도 모두 (기본: 도는 것 + 10분 안에 끝난 것)
 *   --json     목록을 JSON 으로
 *   --session  세션 id (기본: 서브에이전트 기록이 가장 최근에 바뀐 세션)
 *   --tmux     tmux 안이면 오른쪽에 창을 나눠 띄운다
 * 읽기만 한다. 에이전트를 멈추거나 메시지를 보내지 않는다.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RECENT = 10 * 60000;
const STALE = 5 * 60000;

/** 워크스페이스 경로 → Claude Code 기록 폴더 이름 (경로의 / · . 를 - 로) */
function projectDirs(root) {
  const base = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  const names = new Set();
  const pwd = process.env.PWD && fs.existsSync(path.join(process.env.PWD, 'workspace.json')) ? [process.env.PWD] : []; // 링크 경로로 들어온 셸 (macOS /var → /private/var)
  for (const p of [root, ...pwd, (() => { try { return fs.realpathSync(root); } catch { return root; } })()]) names.add(p.replace(/[^A-Za-z0-9]/g, '-'));
  return [...names].map((n) => path.join(base, n)).filter((d) => fs.existsSync(d));
}

/** 서브에이전트 기록이 있는 세션 폴더 (가장 최근 것 먼저) */
function sessions(root) {
  const out = [];
  for (const d of projectDirs(root)) {
    for (const s of fs.readdirSync(d)) {
      const sub = path.join(d, s, 'subagents');
      try { out.push({ id: s, dir: sub, mtime: fs.statSync(sub).mtimeMs }); } catch { /* 서브에이전트 없음 */ }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** 기록 끝부분에서 마지막 행동 한 줄 */
function lastAction(file) {
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 96 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch { return ''; }
  const rows = text.split('\n').reverse();
  for (const r of rows) {
    let d;
    try { d = JSON.parse(r); } catch { continue; }
    const c = (d.message || {}).content;
    if (d.type !== 'assistant' || !Array.isArray(c)) continue;
    for (const x of [...c].reverse()) {
      if (x.type === 'tool_use') {
        const i = x.input || {};
        const arg = i.description || i.file_path || i.command || i.pattern || i.url || i.prompt || '';
        return `${x.name} ${String(arg).replace(/\s+/g, ' ').slice(0, 70)}`.trim();
      }
      if (x.type === 'text' && x.text.trim()) return `말: ${x.text.trim().split('\n')[0].slice(0, 70)}`;
    }
  }
  return '';
}

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}초` : s < 3600 ? `${Math.floor(s / 60)}분` : `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
}

/** 세션의 에이전트 목록 [{ id, type, name, description, parent, depth, finished, state, last, idle, started }] */
function agents(dir, now = Date.now()) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')); } catch { return []; }
  return files.map((f) => {
    let m = {};
    try { m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { /* 깨짐 */ }
    const id = f.replace(/^agent-/, '').replace(/\.meta\.json$/, '');
    const log = path.join(dir, `agent-${id}.jsonl`);
    let mtime = 0;
    let birth = 0;
    try { const st = fs.statSync(log); mtime = st.mtimeMs; birth = st.birthtimeMs || st.ctimeMs; } catch { /* 없음 */ }
    const idle = now - mtime;
    const state = m.finished ? 'done' : idle > STALE ? 'stale' : 'running';
    return { id, type: m.agentType || '?', name: m.name || '', description: m.description || '', parent: m.parentAgentId || 'main', depth: m.spawnDepth || 1, finished: !!m.finished, state, last: lastAction(log), idle, started: birth, model: m.model || '' };
  });
}

const MARK = { running: '●', stale: '◌', done: '✔' };
const STATE = { running: '도는 중', stale: '멈춘 듯', done: '끝남' };

function render(list, { all, session }) {
  const show = list.filter((a) => all || a.state !== 'done' || a.idle < RECENT || list.some((k) => k.parent === a.id && k.state !== 'done'));
  const lines = [`에이전트 진행 · 세션 ${session.slice(0, 8)} · ${new Date().toLocaleTimeString()}  (● 도는 중 · ◌ ${ago(STALE)} 넘게 기록 없음 · ✔ 끝남)`];
  const running = list.filter((a) => a.state !== 'done').length;
  lines.push(`도는 것 ${running} · 끝난 것 ${list.length - running}${show.length < list.length ? ` (오래전에 끝난 ${list.length - show.length}개 숨김, --all)` : ''}`);
  const line = (a, pad) => {
    const who = `${a.type}${a.name ? `(${a.name})` : ''}`;
    lines.push(`${pad}${MARK[a.state]} ${who} · ${a.description || '-'} · ${STATE[a.state]}${a.state === 'done' ? '' : ` · 마지막 기록 ${ago(a.idle)} 전`}`);
    if (a.last && a.state !== 'done') lines.push(`${pad}    └ ${a.last}`);
  };
  const walk = (parent, pad) => {
    for (const a of show.filter((x) => x.parent === parent).sort((x, y) => x.started - y.started)) { line(a, pad); walk(a.id, `${pad}    `); }
  };
  lines.push('메인');
  walk('main', '  ');
  // 부모가 목록에 없는 것 (부모 기록이 지워짐)
  for (const a of show.filter((x) => x.parent !== 'main' && !list.some((p) => p.id === x.parent))) line(a, '  ? ');
  if (!show.length) lines.push('  (지금 도는 에이전트 없음)');
  return lines.join('\n');
}

function main(argv) {
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const root = (() => { let d = process.cwd(); for (;;) { if (fs.existsSync(path.join(d, 'workspace.json'))) return d; const up = path.dirname(d); if (up === d) return process.cwd(); d = up; } })();
  if (argv.includes('--tmux')) {
    if (!process.env.TMUX) { console.log('tmux 안이 아닙니다. 다른 터미널에서 이 워크스페이스로 가서 kedovi agents watch 를 실행하세요'); return; }
    const r = spawnSync('tmux', ['split-window', '-h', '-c', root, 'kedovi agents watch'], { stdio: 'inherit' });
    if (r.status !== 0) console.log('tmux 창을 나누지 못했습니다. 다른 창에서 kedovi agents watch');
    return;
  }
  const pick = () => {
    const all = sessions(root);
    const id = opt('--session');
    return id ? all.find((s) => s.id.startsWith(id)) : all[0];
  };
  const s = pick();
  if (!s) { console.log('이 워크스페이스의 Claude Code 서브에이전트 기록이 없습니다 (아직 에이전트를 부르지 않았거나 다른 폴더에서 시작함)'); return; }
  if (argv.includes('--json')) { console.log(JSON.stringify({ session: s.id, agents: agents(s.dir) }, null, 2)); return; }
  const draw = () => { const cur = pick() || s; return render(agents(cur.dir), { all: argv.includes('--all'), session: cur.id }); };
  if (argv.includes('--once') || !process.stdout.isTTY) { console.log(draw()); return; }
  const tick = () => { process.stdout.write(`\x1b[2J\x1b[H${draw()}\n\n(2초마다 새로 그림 · 끝내기 Ctrl+C)\n`); };
  tick();
  setInterval(tick, 2000);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { agents, render, sessions, projectDirs };
