// 워크스페이스 repo 들의 git worktree(작업 폴더)를 훑는다. 쓰는 곳: bin/worktree.js (list · clean) · hooks/session-health.js (남은 작업 폴더 알림)
/*
 * 종류: kit = 킷 작업 폴더(.worktrees/<repo>/<단위>) · claude = Claude Code 작업 폴더(.claude/worktrees/) · other = 그 밖(git worktree add 로 직접 만든 것)
 * 끝난 작업 폴더 = 바뀐 파일이 없고, 브랜치 내용이 이미 기준 브랜치에 들어갔거나(squash 머지 포함) 기준에서 나아간 커밋이 없고, 최근 손댄 지 idleMin 분이 지난 것
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const KIT_DIR = '.worktrees';
const CLAUDE_DIR = path.join('.claude', 'worktrees');
const IDLE_MIN = 60;

function git(cwd, args) {
  try {
    return { ok: true, out: execFileSync('git', ['-C', cwd, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 20000 }).trim() };
  } catch (e) { return { ok: false, out: String((e.stderr || '') + (e.stdout || '') || e.message).trim() }; }
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const under = (p, dir) => { const a = real(p); const b = real(dir); return a === b || a.startsWith(b + path.sep); };

/** git worktree list --porcelain → [{ path, head, branch, detached, locked, prunable, main }] (첫 항목 = 본 작업 트리) */
function listRepo(repoDir) {
  const r = git(repoDir, ['worktree', 'list', '--porcelain']);
  if (!r.ok) return [];
  const out = [];
  let cur = null;
  for (const line of r.out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null, detached: false, locked: false, prunable: false }; out.push(cur); continue; }
    if (!cur) continue;
    if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line.startsWith('locked')) cur.locked = true;
    else if (line.startsWith('prunable')) cur.prunable = true;
    else if (line === 'bare') cur.bare = true;
  }
  out.forEach((w, i) => { w.main = i === 0; });
  return out;
}

function kindOf(root, p) {
  if (under(p, path.join(root, KIT_DIR))) return 'kit';
  if (under(p, path.join(root, CLAUDE_DIR))) return 'claude';
  return 'other';
}

/** 작업 폴더를 마지막으로 손댄 시각 (그 worktree 의 git 기록 · 인덱스 · 폴더). git status 를 돌리기 전에 읽는다 */
function lastActivity(p) {
  const files = [p];
  try {
    const m = fs.readFileSync(path.join(p, '.git'), 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
    if (m) { const gd = path.resolve(p, m[1]); files.push(path.join(gd, 'index'), path.join(gd, 'HEAD'), path.join(gd, 'logs', 'HEAD')); }
  } catch { /* 없음 */ }
  let t = 0;
  for (const f of files) { try { t = Math.max(t, fs.statSync(f).mtimeMs); } catch { /* 없음 */ } }
  return t || null;
}

/** 기준 커밋들: 본 작업 트리 HEAD · 그 upstream · origin/HEAD (있는 것만) */
function targets(repoDir) {
  const out = [];
  for (const ref of ['HEAD', '@{upstream}', 'refs/remotes/origin/HEAD']) {
    const r = git(repoDir, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
    if (r.ok && r.out && !out.includes(r.out)) out.push(r.out);
  }
  return out;
}

/** 브랜치(또는 커밋) 내용이 기준에 이미 있는가: 조상이거나, 기준과 갈라진 뒤 바꾼 파일이 지금 기준과 모두 같다 (squash 머지) */
function landed(repoDir, tip, bases) {
  for (const b of bases) {
    if (git(repoDir, ['merge-base', '--is-ancestor', tip, b]).ok) return true;
    const mb = git(repoDir, ['merge-base', tip, b]);
    if (!mb.ok || !mb.out) continue;
    const files = git(repoDir, ['diff', '--name-only', mb.out, tip]);
    if (!files.ok) continue;
    const list = files.out.split('\n').filter(Boolean);
    if (list.length && git(repoDir, ['diff', '--quiet', tip, b, '--', ...list]).ok) return true;
  }
  return false;
}

/**
 * 워크스페이스의 모든 작업 폴더 (본 작업 트리 제외)
 * ws = lib/workspace load() 결과. deep 이면 바뀐 파일 · 기준 반영 여부 · 끝남 판정까지 (repo 마다 git 을 더 돈다)
 * 반환: [{ repo, repoDir, path, rel, kind, branch, head, detached, locked, missing, activity, changed?, ahead?, landed?, done?, why? }]
 */
function scan(ws, { deep = false, idleMin = IDLE_MIN, now = Date.now() } = {}) {
  const out = [];
  const seen = new Set();
  for (const r of ws.repos || []) {
    if (!r.dir || !fs.existsSync(path.join(r.dir, '.git'))) continue;
    const key = real(r.dir);
    if (seen.has(key)) continue;
    seen.add(key);
    const wts = listRepo(r.dir).filter((w) => !w.main && !w.bare);
    if (!wts.length) continue;
    const bases = deep ? targets(r.dir) : [];
    for (const w of wts) {
      const missing = w.prunable || !fs.existsSync(w.path);
      const x = { repo: r.name, repoDir: r.dir, path: w.path, rel: path.relative(ws.root, w.path) || w.path, kind: kindOf(ws.root, w.path), branch: w.branch, head: w.head, detached: w.detached, locked: w.locked, missing, activity: missing ? null : lastActivity(w.path) };
      if (deep && !missing) {
        const st = git(w.path, ['status', '--porcelain']);
        x.changed = st.ok ? st.out.split('\n').filter(Boolean).length : null;
        const tip = w.head;
        const base = bases.find((b) => git(r.dir, ['merge-base', '--is-ancestor', b, tip]).ok);
        const ahead = bases.length ? git(r.dir, ['rev-list', '--count', tip, ...bases.map((b) => `^${b}`)]) : { ok: false };
        x.ahead = ahead.ok ? Number(ahead.out) : null;
        x.landed = !!tip && (x.ahead === 0 || landed(r.dir, tip, bases));
        const idle = !x.activity || now - x.activity > idleMin * 60000;
        if (w.locked) x.why = '잠김 (git worktree unlock 뒤)';
        else if (x.changed === null) x.why = '상태를 읽지 못함';
        else if (x.changed > 0) x.why = `바뀐 파일 ${x.changed}개`;
        else if (!x.landed) x.why = `기준 브랜치에 없는 커밋 ${x.ahead === null ? '?' : x.ahead}개 (머지 · 옮기기 전)`;
        else if (!idle) x.why = `최근 ${Math.max(1, Math.round((now - x.activity) / 60000))}분 안에 손댐 (작업 중일 수 있음)`;
        else x.done = true;
        x.base = base || bases[0] || null;
      }
      out.push(x);
    }
  }
  return out;
}

/** 빈 상위 폴더를 stop 직전까지 지운다 (repos/<x>-wt/ 처럼 작업 폴더만 담던 폴더) */
function removeEmptyParents(dir, stop) {
  for (let d = path.dirname(dir); under(d, stop) && real(d) !== real(stop); d = path.dirname(d)) {
    try { if (fs.readdirSync(d).filter((f) => f !== '.DS_Store').length) break; try { fs.unlinkSync(path.join(d, '.DS_Store')); } catch { /* 없음 */ } fs.rmdirSync(d); } catch { break; }
  }
}

/** 하루 넘게 손대지 않은 작업 폴더 · 킷 밖 위치 · 폴더 없는 기록 수 (가벼운 훑기, 알림용) */
function summary(ws, { now = Date.now(), staleHours = 24 } = {}) {
  const list = scan(ws, { now });
  return {
    total: list.length,
    stray: list.filter((x) => x.kind === 'other' && !x.missing).length,
    stale: list.filter((x) => !x.missing && x.activity && now - x.activity > staleHours * 3600000).length,
    missing: list.filter((x) => x.missing).length,
  };
}

module.exports = { KIT_DIR, CLAUDE_DIR, IDLE_MIN, git, listRepo, kindOf, lastActivity, targets, landed, scan, summary, removeEmptyParents, under };
