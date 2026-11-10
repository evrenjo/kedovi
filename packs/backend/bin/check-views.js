#!/usr/bin/env node
// 화면 이름 대조 (backend.layout = component-web): 프론트 화면 폴더와 백엔드 web/views/<화면> 폴더 목록을 비교해 한쪽에만 있는 것을 알린다. 실행: kedovi views check [--json]
/*
 * 프론트 화면 폴더 = 프론트 화면 루트(vars.backend.frontViewsDir, 비우면 react.viewsDir · FSD 면 <react.srcDir>/pages) 아래에서
 *                   화면 진입 파일(@spec 화면 ID)이 있는 폴더. 화면 ID 는 기획 repo 화면 목록 (screens 팩) 이 있으면 그것, 없으면 SCR- 로 시작하는 ID
 * 백엔드 화면 폴더 = web 폴더(vars.backend.webDir, 비우면 스택에서) 의 views 아래에서 소스 파일이 있는 폴더 (controller · dto · mapper · websocket 계층 폴더는 그 위)
 *                   customer/<고객>/web/views 도 같은 화면으로 센다
 * 비교 = 화면 루트 기준 상대 경로. 대소문자 · '-' · '_' 는 무시한다 (order-list = orderlist = order_list). vars.backend.viewsIgnore 는 뺀다
 * 끝 코드: 0 = 맞음 (또는 component-web 아님) · 1 = 한쪽에만 있는 화면이 있음 · 2 = 화면 루트 · web 폴더를 찾지 못함
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PACKS = path.resolve(__dirname, '..', '..');
const SRC = /\.(java|kt|ts|tsx|js|jsx|mjs|py)$/;
const WEB_LAYERS = new Set(['controller', 'dto', 'mapper', 'websocket', 'serializers']);
const SKIP_DIR = new Set(['node_modules', '__pycache__', 'test', 'tests', '__tests__', 'migrations']);

const get = (obj, key) => key.split('.').reduce((c, k) => (c && typeof c === 'object' ? c[k] : undefined), obj);
const norm = (rel) => String(rel).split(/[\\/.]/).filter(Boolean).map((s) => s.toLowerCase().replace(/[-_\s]/g, '')).join('/');
/** repo 스택 이름들 (쉼표로): workspace.json 의 stack, 없으면 스택 감지(core detect · stacks.json) */
const stackCache = new Map();
function stackOf(ws, r) {
  if (r.stack) return (Array.isArray(r.stack) ? r.stack.join(',') : String(r.stack)).toLowerCase();
  if (!stackCache.has(r.dir)) {
    let ids = '';
    try {
      const D = require(path.join(PACKS, 'core', 'lib', 'detect.js'));
      ids = D.detect(r.dir, D.withHints(D.loadCatalog(path.resolve(PACKS, '..')), ws.stackHints)).map((x) => x.id).join(',');
    } catch { /* 감지 실패 = 모름 */ }
    stackCache.set(r.dir, ids.toLowerCase());
  }
  return stackCache.get(r.dir);
}
const codeRepos = (ws) => (ws.repos || []).filter((r) => (r.kind || 'code') === 'code' && r.dir && fs.existsSync(r.dir));

/** 프론트 화면 루트 (repo 기준) */
function frontViewsDir(ws) {
  const v = ws.vars || {};
  if (get(v, 'backend.frontViewsDir')) return String(get(v, 'backend.frontViewsDir')).replace(/\/$/, '');
  if (get(v, 'react.packageLayout') === 'fsd') return `${get(v, 'react.srcDir') || 'src'}/pages`;
  return String(get(v, 'react.viewsDir') || 'src/views').replace(/\/$/, '');
}

/** 백엔드 web 폴더 (repo 기준): 변수 → 스택 */
function webDirOf(ws, repo) {
  const v = ws.vars || {};
  if (get(v, 'backend.webDir')) return String(get(v, 'backend.webDir')).replace(/\/$/, '');
  const s = stackOf(ws, repo);
  if (/spring|java|kotlin/.test(s)) {
    const pkg = String(get(v, 'spring.basePackage') || 'com.example.app').split('.').join('/');
    const kt = `src/main/kotlin/${pkg}/web`;
    return fs.existsSync(path.join(repo.dir, kt)) ? kt : `src/main/java/${pkg}/web`;
  }
  if (/nest/.test(s)) return `${get(v, 'nestjs.srcDir') || 'src'}/web`;
  if (/fastapi/.test(s)) return path.posix.join(get(v, 'fastapi.sourceDir') || '.', get(v, 'fastapi.package') || 'app', 'web');
  if (/django/.test(s)) return path.posix.join(get(v, 'django.sourceDir') || '.', get(v, 'django.package') || 'app', 'web');
  return '';
}

function walkDirs(dir, out = [], depth = 8) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  const files = list.filter((e) => e.isFile() && SRC.test(e.name) && !/^(__init__\.py|index\.[jt]sx?)$/.test(e.name) && !/\.(test|spec)\.[jt]sx?$/.test(e.name));
  if (files.length) out.push(dir);
  if (depth > 0) for (const e of list) if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIR.has(e.name)) walkDirs(path.join(dir, e.name), out, depth - 1);
  return out;
}

/** 백엔드 화면 폴더 [{ key, rel, repo, dir }] */
function backendViews(ws) {
  const out = [];
  const roots = [];
  for (const r of codeRepos(ws)) {
    const web = webDirOf(ws, r);
    if (!web) continue;
    const base = path.join(r.dir, web);
    const views = [{ dir: path.join(base, 'views'), label: `${web}/views` }];
    // customer/<고객>/web/views
    const custRoot = path.join(path.dirname(base), 'customer');
    try { for (const c of fs.readdirSync(custRoot, { withFileTypes: true }).filter((e) => e.isDirectory())) views.push({ dir: path.join(custRoot, c.name, 'web', 'views'), label: path.posix.join(path.posix.dirname(web), 'customer', c.name, 'web', 'views') }); } catch { /* 고객사 없음 */ }
    for (const v of views) {
      if (!fs.existsSync(v.dir)) continue;
      roots.push(`${r.name}/${v.label}`);
      const seen = new Set();
      for (const d of walkDirs(v.dir)) {
        let screen = d;
        while (WEB_LAYERS.has(path.basename(screen)) && screen !== v.dir) screen = path.dirname(screen);
        if (screen === v.dir || seen.has(screen)) continue;
        seen.add(screen);
        const rel = path.relative(v.dir, screen).split(path.sep).join('/');
        out.push({ key: norm(rel), rel, repo: r.name, dir: screen, at: `${r.name}/${v.label}/${rel}` });
      }
    }
  }
  return { list: out, roots };
}

/** 화면 ID 집합 (screens 팩이 있으면 화면 목록, 없으면 null = SCR- 로 시작하는 ID) */
function screenIdSet(ws) {
  try { const S = require(path.join(PACKS, 'screens', 'bin', 'screens-inventory.js')); const ids = S.screenIds(ws); return ids.length ? new Set(ids) : null; } catch { return null; }
}

/** 프론트 화면 폴더 [{ key, rel, repo, dir, file, ids }] */
function frontViews(ws) {
  const out = [];
  const roots = [];
  const viewsDir = frontViewsDir(ws);
  const ids = screenIdSet(ws);
  for (const r of codeRepos(ws)) {
    const root = path.join(r.dir, viewsDir);
    if (!fs.existsSync(root)) continue;
    roots.push(`${r.name}/${viewsDir}`);
    let hits = '';
    try { hits = execFileSync('git', ['-C', r.dir, 'grep', '--untracked', '-n', '-I', '-E', '@spec[[:space:]]', '--', viewsDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* 없음 */ }
    const byDir = new Map();
    for (const line of hits.split('\n').filter(Boolean)) {
      const m = /^([^:]+):\d+:(.*)$/.exec(line);
      if (!m) continue;
      const got = (/@spec\s+(.*)$/.exec(m[2]) || [])[1] || '';
      const sid = got.split(/[^A-Za-z0-9_-]+/).filter((x) => (ids ? ids.has(x) : /^SCR-/.test(x)));
      if (!sid.length) continue;
      const dir = path.dirname(path.join(r.dir, m[1]));
      if (dir === root) continue;
      const prev = byDir.get(dir) || { file: m[1], ids: new Set() };
      sid.forEach((x) => prev.ids.add(x));
      byDir.set(dir, prev);
    }
    for (const [dir, v] of byDir) {
      const rel = path.relative(root, dir).split(path.sep).join('/');
      out.push({ key: norm(rel), rel, repo: r.name, dir, file: `${r.name}/${v.file}`, ids: [...v.ids] });
    }
  }
  return { list: out, roots, viewsDir };
}

function compare(ws) {
  const f = frontViews(ws);
  const b = backendViews(ws);
  const ignore = new Set(((get(ws.vars || {}, 'backend.viewsIgnore')) || []).map(norm));
  const bk = new Map(b.list.map((x) => [x.key, x]));
  const fk = new Map(f.list.map((x) => [x.key, x]));
  return {
    frontRoots: f.roots, backRoots: b.roots, viewsDir: f.viewsDir,
    matched: f.list.filter((x) => bk.has(x.key)).map((x) => ({ front: x, back: bk.get(x.key) })),
    onlyFront: f.list.filter((x) => !bk.has(x.key) && !ignore.has(x.key)),
    onlyBack: b.list.filter((x) => !fk.has(x.key) && !ignore.has(x.key)),
  };
}

/** 화면 ID → 그 화면의 백엔드 화면 API 폴더 (component-web 이 아니면 null) { at, exists } */
function backendFor(ws, screenId) {
  if (get(ws.vars || {}, 'backend.layout') !== 'component-web') return null;
  const f = frontViews(ws).list.filter((x) => x.ids.includes(screenId));
  if (!f.length) return { at: '', exists: false, note: `프론트 화면 진입 파일(@spec ${screenId})이 화면 루트(${frontViewsDir(ws)}) 아래에 없음` };
  const b = backendViews(ws).list;
  const hit = b.find((x) => x.key === f[0].key);
  if (hit) return { at: hit.at, exists: true, front: f[0].rel };
  const repo = codeRepos(ws).find((r) => webDirOf(ws, r) && fs.existsSync(path.join(r.dir, webDirOf(ws, r))));
  const want = f[0].rel.split('/').map((s) => s.toLowerCase().replace(/-/g, '')).join('/');
  return { at: repo ? `${repo.name}/${webDirOf(ws, repo)}/views/${want}` : `web/views/${want}`, exists: false, front: f[0].rel };
}

function main() {
  const args = process.argv.slice(2).filter((x) => x !== 'check');
  let ws;
  try { ws = require(path.join(PACKS, 'core', 'lib', 'workspace.js')).load(path.resolve(PACKS, '..')); } catch (e) { console.error(`✖ workspace.json 을 읽지 못했습니다. ${e.message}`); process.exit(2); }
  if (args.includes('--help')) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^(\/\/|\/\*| \*\/?) ?/, '')).filter(Boolean).join('\n')); return; }
  if (get(ws.vars || {}, 'backend.layout') !== 'component-web') { console.log('· vars.backend.layout 이 component-web 이 아니라 대조하지 않습니다'); return; }
  const r = compare(ws);
  if (args.includes('--json')) { console.log(JSON.stringify({ ...r, matched: r.matched.map((m) => ({ front: m.front.rel, back: m.back.at })) }, null, 2)); process.exit(r.onlyFront.length || r.onlyBack.length ? 1 : 0); }
  if (!r.frontRoots.length || !r.backRoots.length) {
    console.error(`✖ ${!r.frontRoots.length ? `프론트 화면 루트(${r.viewsDir})가 있는 코드 repo 가 없습니다 (vars.backend.frontViewsDir · react.viewsDir)` : '백엔드 web/views 폴더가 있는 코드 repo 가 없습니다 (vars.backend.webDir 또는 스택 변수)'}`);
    process.exit(2);
  }
  console.log(`화면 이름 대조: 프론트 ${r.frontRoots.join(' · ')} ↔ 백엔드 ${r.backRoots.join(' · ')} · 맞음 ${r.matched.length}`);
  for (const x of r.onlyFront) console.log(`  ⚠ 프론트에만: ${x.rel} (${x.ids.join(' · ')}, ${x.file}) → 백엔드 화면 API 가 없거나 이름이 다르다`);
  for (const x of r.onlyBack) console.log(`  ⚠ 백엔드에만: ${x.at} → 프론트 화면이 없거나 이름이 다르다`);
  if (r.onlyFront.length || r.onlyBack.length) {
    console.log('  이름을 맞추거나, 짝이 없어도 되는 화면은 vars.backend.viewsIgnore 에 넣는다 (비교는 대소문자 · - · _ 무시)');
    process.exit(1);
  }
  console.log('✔ 한쪽에만 있는 화면 없음');
}

if (require.main === module) main();
module.exports = { norm, frontViewsDir, webDirOf, frontViews, backendViews, compare, backendFor };
