// 워크스페이스 루트·workspace.json 을 읽는 공용 헬퍼 (도구·훅 공통). 사용: const ws = require('.../lib/workspace').load()
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

function root(start) {
  if (process.env.CLAUDE_PROJECT_DIR && fs.existsSync(path.join(process.env.CLAUDE_PROJECT_DIR, 'workspace.json'))) return process.env.CLAUDE_PROJECT_DIR;
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, 'workspace.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return process.cwd(); }
}

/** repo 폴더 (워크스페이스 기준) — repos/<이름>, group 이 있으면 repos/<그룹>/<이름>. bin/kit.js repoRel 과 한 쌍 */
const repoRel = (x) => ['repos', ...(x.group ? [x.group] : []), x.name].join('/');

function load(start) {
  const r = root(start);
  const ws = JSON.parse(fs.readFileSync(path.join(r, 'workspace.json'), 'utf8'));
  ws.root = r;
  // repo 는 워크스페이스 안 repos/<이름> · repos/<그룹>/<이름> (kedovi install 이 clone·링크). install 전이면 path 로 떨어진다
  ws.repos = (ws.repos || []).map((x) => {
    const inWs = path.join(r, repoRel(x));
    return { ...x, kind: x.kind || 'code', dir: fs.existsSync(inWs) || !x.path ? inWs : path.resolve(r, x.path) };
  });
  // 파생 변수 — bin/kit.js deriveVars 와 같은 규칙: 레거시 소스 루트를 kind: legacy 항목에서
  const legacy = ws.repos.find((x) => x.kind === 'legacy');
  ws.vars = ws.vars || {};
  if (legacy && ws.vars.asis && !ws.vars.asis.sourceRoot) ws.vars.asis.sourceRoot = path.join(repoRel(legacy), legacy.sourceRoot || '');
  return ws;
}

/** 개발자 ID = 워크스페이스 repo 의 git user.name */
function devId(r) {
  try { return execFileSync('git', ['-C', r || root(), 'config', 'user.name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

/** workspace.json repos + 워크스페이스 repo 자신. 각 항목 { name, dir, self } */
function allRepos(ws) {
  const w = ws || load();
  return [...w.repos.map((r) => ({ name: r.name, dir: r.dir, self: false })),
    { name: path.basename(w.root), dir: w.root, self: true }];
}

/** git 동기 실행. 실패하면 null (예외를 던지지 않는다) */
function git(cwd, args, timeoutMs = 8000) {
  try {
    return execFileSync('git', ['-C', cwd, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }).trim();
  } catch { return null; }
}

/** git 비동기 실행 (병렬 fetch 용). { ok, out } 로 끝난다 — 타임아웃이면 ok=false */
function gitAsync(cwd, args, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const p = spawn('git', ['-C', cwd, '-c', 'core.quotepath=false', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const t = setTimeout(() => { if (!done) { done = true; try { p.kill('SIGKILL'); } catch { /* 이미 끝남 */ } resolve({ ok: false, out: 'timeout' }); } }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve({ ok: false, out: 'spawn error' }); } });
    p.on('close', (code) => { if (!done) { done = true; clearTimeout(t); resolve({ ok: code === 0, out: out.trim() }); } });
  });
}

/** 로컬 날짜 YYYY-MM-DD */
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ISO 주차 YYYY-Www (월요일 시작) */
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

/** 워크스페이스 밖(OS 임시 폴더)의 이 워크스페이스 전용 상태 폴더 — gitignore 가 필요 없다 */
function stateDir(r) {
  const key = require('crypto').createHash('sha1').update(path.resolve(r || root())).digest('hex').slice(0, 12);
  // 여러 사람이 쓰는 Linux 의 /tmp 에서 남이 먼저 만든 폴더에 끼어들지 않게: 내 것만 (0700, 소유자 확인)
  const base = path.join(require('os').tmpdir(), process.getuid ? `agent-workspace-kit-${process.getuid()}` : 'agent-workspace-kit');
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const dir = path.join(base, key);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.getuid && fs.statSync(dir).uid !== process.getuid()) throw new Error(`상태 폴더가 다른 사용자 것입니다: ${dir}`);
  return dir;
}

/** Claude Code 가 띄운 프로세스인가 (--agent 플래그가 없을 때의 추정용) */
function launchedByClaude() { return !!process.env.CLAUDE_PROJECT_DIR; }

module.exports = { root, load, repoRel, devId, launchedByClaude, allRepos, git, gitAsync, localDate, isoWeek, stateDir };
