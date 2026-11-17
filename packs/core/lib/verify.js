// 검증 2단: 작업마다는 바뀐 영역의 시험만(vars.verify.areaMap), 전체 실제 스택 시험(vars.verify.fullCmd)은 릴리스 직전 한 번(vars.verify.fullSuite = release).
// 전체 시험 통과 기록 = .agents/verify/full.json (repo 이름 → { sha, at, cmd, ms }). 쓰는 곳: bin/verify.js · gitlab release.js (기록 없으면 경고)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = (root) => path.join(root, '.agents', 'verify', 'full.json');
const MODES = ['release', 'per-item'];

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim();
const tryGit = (dir, ...a) => { try { return git(dir, ...a); } catch { return null; } };

/** 설정: 팀 값(vars.verify) 위에 repo 값(repos[].verify) */
function settings(ws, repo) {
  const v = { ...(((ws || {}).vars || {}).verify || {}), ...((repo || {}).verify || {}) };
  let map = v.areaMap;
  if (typeof map === 'string') { try { map = JSON.parse(map); } catch { map = {}; } }
  const areas = Object.entries(map && typeof map === 'object' ? map : {})
    .map(([glob, cmd]) => [glob, (Array.isArray(cmd) ? cmd : [cmd]).filter((c) => typeof c === 'string' && c.trim())])
    .filter(([, c]) => c.length);
  return { fullSuite: MODES.includes(v.fullSuite) ? v.fullSuite : 'release', fullCmd: typeof v.fullCmd === 'string' ? v.fullCmd.trim() : '', areas };
}

/** 글롭 → 정규식. ** = 여러 단계, * = 한 단계, 끝이 / 거나 와일드카드 없는 폴더 이름이면 그 아래 전부 */
function globRe(glob) {
  let g = String(glob).trim().replace(/^\.\//, '');
  if (g.endsWith('/') || (!/[*?]/.test(g) && !/\.[A-Za-z0-9]+$/.test(g))) g = `${g.replace(/\/$/, '')}/**`;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { if (g[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; } } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** 바뀐 파일 (기준 → 작업 트리, 커밋 안 한 것 · 새 파일 포함). 기준 = --base, 없으면 upstream, 없으면 HEAD~1 */
function changed(dir, base) {
  const b = base || tryGit(dir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}') || (tryGit(dir, 'rev-parse', '--verify', 'HEAD~1') ? 'HEAD~1' : null);
  const files = new Set();
  const from = b ? tryGit(dir, 'merge-base', b, 'HEAD') || b : null;
  for (const l of String((from ? tryGit(dir, 'diff', '--name-only', from) : tryGit(dir, 'diff', '--name-only', 'HEAD')) || '').split('\n')) if (l) files.add(l);
  for (const l of String(tryGit(dir, 'ls-files', '--others', '--exclude-standard') || '').split('\n')) if (l) files.add(l);
  return { base: b, files: [...files].sort() };
}

/** 바뀐 파일 → 돌릴 영역 시험 { cmds: [{ cmd, globs, files }], unmatched: [파일] } */
function plan(files, areas) {
  const by = new Map();
  const unmatched = [];
  for (const f of files) {
    let hit = false;
    for (const [glob, cmds] of areas) {
      if (!globRe(glob).test(f)) continue;
      hit = true;
      for (const c of cmds) {
        const e = by.get(c) || { cmd: c, globs: new Set(), files: [] };
        e.globs.add(glob); e.files.push(f); by.set(c, e);
      }
    }
    if (!hit) unmatched.push(f);
  }
  return { cmds: [...by.values()].map((e) => ({ ...e, globs: [...e.globs] })), unmatched };
}

const readAll = (root) => { try { return JSON.parse(fs.readFileSync(FILE(root), 'utf8')); } catch { return {}; } };

function record(root, repoName, rec) {
  const all = readAll(root);
  all[repoName] = { ...rec, at: rec.at || Date.now() };
  fs.mkdirSync(path.dirname(FILE(root)), { recursive: true });
  fs.writeFileSync(FILE(root), JSON.stringify(all, null, 2));
  return all[repoName];
}

/**
 * 전체 시험 기록과 대상 커밋(기본 HEAD)을 견준다 → { rec, head, same, behind(기록 뒤 커밋 수 | null), ok }
 * ok = 기록이 대상과 같은 커밋 · 같은 트리
 */
function fullState(root, repoName, dir, target = 'HEAD') {
  const rec = readAll(root)[repoName] || null;
  const head = (dir && tryGit(dir, 'rev-parse', target)) || (/^[0-9a-f]{40}$/.test(target) ? target : null);
  if (!rec) return { rec, head, same: false, behind: null, ok: false };
  if (head && rec.sha === head) return { rec, head, same: true, behind: 0, ok: true };
  const sameTree = head && rec.tree && tryGit(dir, 'rev-parse', `${head}^{tree}`) === rec.tree;
  const n = head ? tryGit(dir, 'rev-list', '--count', `${rec.sha}..${head}`) : null;
  return { rec, head, same: !!sameTree, behind: n == null ? null : Number(n), ok: !!sameTree };
}

/** 사람이 읽는 한 줄 (release · status) */
function fullLine(st, repoName) {
  const when = (t) => { const d = new Date(t); const p = (x) => String(x).padStart(2, '0'); return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  if (!st.rec) return `전체 시험 기록 없음 (${repoName}): 릴리스 전에 kedovi verify full --repo ${repoName}`;
  if (st.ok) return `전체 시험 통과 (${repoName}): ${when(st.rec.at)} · ${String(st.rec.sha).slice(0, 8)} = 대상 커밋`;
  return `전체 시험 기록이 낡음 (${repoName}): ${when(st.rec.at)} · ${String(st.rec.sha).slice(0, 8)}${st.behind != null ? ` · 그 뒤 커밋 ${st.behind}개` : ' · 대상과 다른 커밋'}. 릴리스 전에 kedovi verify full --repo ${repoName}`;
}

module.exports = { settings, globRe, changed, plan, record, fullState, fullLine, readAll, MODES };
