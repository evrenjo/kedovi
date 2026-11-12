#!/usr/bin/env node
// 프로토타입 ↔ 구현 화면 비교: 같은 폭(PC · 폰)으로 스크린샷을 두 장씩 찍고 나란히 보는 compare.html 을 만든다. 실행: kedovi screens compare <화면 ID> [옵션]
/*
 * 프로토타입 찾기: --proto → 기획 repo 화면 목록(<화면 폴더>/README.md 표)의 「프로토타입」 칸 → prototype/ 아래 이름에 화면 ID 가 든 .html
 *                → vars.screens.prototype 주소 틀(`{id}` 자리, 예: docs-site/prototype/app/index.html#{id}: 한 페이지 앱 프로토타입)
 *                화면 폴더 = 기획 repo 안 vars.screens.dir(쉼표로 여럿) → 기본 30-screens · 02-screens. 못 찾으면 kedovi screens locate
 * 구현 찾기:     --impl (주소 · /경로) → 코드 repo 에서 `@spec <화면 ID>` 가 있는 파일의 `@route /경로` (그 줄 또는 파일 머리 30줄)
 *                주소 앞부분은 --base → vars.screens.appUrl (기본 http://localhost:5173)
 * 옵션: --widths 1280,390 · --scope <CSS>(배치 대조 범위, 기본 vars.screens.scope) · --out <폴더> · --storage <Playwright storageState.json>(로그인 상태) · --wait <CSS 선택자> · --find(브라우저 없이 찾은 것만)
 *       --mock <픽스처.json|.har>(백엔드 없이: 구현 화면의 API 요청을 픽스처로 답한다. 기본 vars.screens.mock)
 * 픽스처 JSON: { "routes": [{ "method": "GET", "url": "<Playwright glob · 정규식 아님>", "status": 200, "json": {…} | "body": "…" | "file": "응답.json", "headers": {} }] } 또는 { "GET <glob>": {…응답 본문…} }. .har 는 Playwright routeFromHAR
 * 끝 코드: 0 = 찍음(또는 --find 로 찾음) · 1 = 화면 ID · 프로토타입 · 구현 주소 · 픽스처를 못 찾음 · 2 = Playwright · 브라우저 · 페이지 열기 실패
 * 찍으면 정본 요소 체크리스트(kedovi screens inventory)의 「비교:」 줄에 compare.html 경로를 적는다. 못 찍으면 「미실행」: 완료로 보고하지 않는다
 * 배치 대조: 두 화면의 영역(제목이 있는 카드 · 패널 · section 등)을 제목으로 짝지어 서로의 위치(옆 · 위아래)와 폭을 비교한다.
 *   정본에서 옆이던 영역이 구현에서 아래로 가는 등 차이는 compare.html · layout.json 과 체크리스트 「배치」 줄 · 「배치」 행(판정 필요)으로 남긴다.
 *   픽셀 diff 는 하지 않는다 (예시 데이터 · 글꼴 차이로 늘 다르다). 요소 · 색 · 간격은 사람이(또는 리뷰 모델이) 나란히 놓고 판정한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { pathToFileURL } = require('url');

const PACKS = path.resolve(__dirname, '..', '..');
const SCREEN_DIRS = ['30-screens', '02-screens'];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idRe = (id) => new RegExp(`(?<![\\w-])${escRe(id)}(?![\\w-])`);

const svars = (ws) => (ws.vars && ws.vars.screens) || {};
/** 기획 repo 안 화면 폴더 이름: vars.screens.dir(쉼표로 여럿) → 기본 30-screens · 02-screens */
function screenDirNames(ws) {
  const v = String(svars(ws).dir || '').split(',').map((x) => x.trim().replace(/^\.\/|\/+$/g, '')).filter(Boolean);
  return v.length ? v : SCREEN_DIRS;
}

/** 기획 repo 들의 화면 폴더 [{ repo, dir }] */
function screenDirs(ws) {
  const out = [];
  for (const r of (ws.repos || []).filter((x) => x.kind === 'docs')) {
    for (const d of screenDirNames(ws)) if (fs.existsSync(path.join(r.dir, d))) out.push({ repo: r, dir: path.join(r.dir, d) });
  }
  return out;
}

/** 기획 repo 에서 화면 폴더 · 프로토타입 후보 찾기 (kedovi screens locate · 못 찾았을 때 안내): { dirs: [폴더], prototypes: [index.html 등] } (기획 repo 기준 경로) */
function locateCandidates(ws) {
  const dirs = new Set(); const protos = new Set();
  for (const r of (ws.repos || []).filter((x) => x.kind === 'docs' && fs.existsSync(x.dir))) {
    for (const f of walk(r.dir, 5)) {
      const rel = path.relative(r.dir, f).split(path.sep).join('/');
      if (/(^|\/)docs-site\//.test(rel) && !/(^|\/)prototype\//.test(rel)) continue; // 생성된 문서 사이트는 프로토타입만 본다
      if (path.basename(f) === 'README.md') {
        let t = '';
        try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
        if (/^\s*\|\s*\**화면\s*ID\**\s*\|/m.test(t)) dirs.add(path.dirname(rel) === '.' ? '' : path.dirname(rel));
      }
      if (/(^|\/)prototype\/(.*\/)?index\.html?$/i.test(rel)) protos.add(rel);
    }
  }
  return { dirs: [...dirs].filter(Boolean).sort(), prototypes: [...protos].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)) };
}

const locateHint = (ws) => {
  const c = locateCandidates(ws);
  const parts = [];
  if (c.dirs.length) parts.push(`화면 목록이 있는 폴더 후보: ${c.dirs.join(' · ')}`);
  if (c.prototypes.length) parts.push(`프로토타입 후보: ${c.prototypes.slice(0, 4).join(' · ')}`);
  return parts.length ? ` ${parts.join('. ')}. 정하기: kedovi screens locate --dir <폴더> --prototype "<파일>#{id}"` : ' 위치가 다르면 kedovi screens locate --dir <폴더> --prototype "<파일>#{id}"';
};

/** 한 페이지 앱 프로토타입 소스에서 화면 ID 가 나오는 곳 (주소 틀의 파일 폴더 아래 .js · .html, 처음 5곳) */
function sourceHits(file, id) {
  const out = [];
  for (const f of walk(path.dirname(file), 4).filter((x) => /\.(m?js|html?|tsx?|jsx|vue|svelte)$/i.test(x))) {
    let lines = [];
    try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch { continue; }
    lines.forEach((l, i) => { if (out.length < 5 && idRe(id).test(l)) out.push({ file: f, line: i + 1 }); });
    if (out.length >= 5) break;
  }
  return out;
}

/** 표 칸 값 → 링크 대상 (`[이름](주소)` · `` `경로` `` · <…> 자리표시는 비움) */
function cellTarget(cell) {
  let v = String(cell || '').trim();
  const link = /\[[^\]]*\]\(([^)]+)\)/.exec(v);
  if (link) v = link[1];
  v = v.replace(/^`|`$/g, '').trim();
  if (!v || /^<.*>$/.test(v) || /^(-|없음)$/.test(v)) return '';
  return v;
}

/** 화면 목록 표에서 이 화면 ID 행의 「프로토타입」 칸 */
function listedPrototype(readme, id) {
  let text;
  try { text = fs.readFileSync(readme, 'utf8'); } catch { return ''; }
  const rows = text.split('\n').filter((l) => /^\s*\|/.test(l));
  let col = -1;
  for (const l of rows) {
    const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const at = cells.findIndex((c) => /^프로토타입$/.test(c.replace(/\*/g, '')));
    if (at >= 0) { col = at; continue; }
    if (col >= 0 && cells[0].replace(/[`*]/g, '') === id) return cellTarget(cells[col]);
  }
  return '';
}

/** 폴더 아래 파일 (깊이 4, node_modules · .git 제외) */
function walk(dir, depth = 4, out = []) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) walk(p, depth - 1, out); } else out.push(p);
  }
  return out;
}

/** 로컬 파일(#hash 포함) 또는 주소 → 브라우저 주소 */
function toUrl(target, baseDirs) {
  if (/^https?:\/\//.test(target) || /^file:/.test(target)) return { url: target, from: target };
  const [file, hash] = target.split('#');
  for (const b of baseDirs) {
    const p = path.resolve(b, file);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return { url: `${pathToFileURL(p).href}${hash ? `#${hash}` : ''}`, from: p };
  }
  return null;
}

function findPrototype(ws, id, a) {
  const dirs = screenDirs(ws);
  const bases = (d) => [d.dir, path.join(d.dir, 'prototype'), d.repo.dir, ws.root];
  if (a.proto && a.proto !== true) {
    const hit = toUrl(String(a.proto), [process.cwd(), ...dirs.flatMap(bases)]);
    if (!hit) throw new Error(`--proto ${a.proto} 를 찾지 못했습니다`);
    return { ...hit, how: '--proto' };
  }
  for (const d of dirs) {
    const listed = listedPrototype(path.join(d.dir, 'README.md'), id);
    if (!listed) continue;
    const hit = toUrl(listed, bases(d));
    if (hit) return { ...hit, how: `화면 목록 (${path.relative(ws.root, path.join(d.dir, 'README.md'))})` };
    throw new Error(`화면 목록의 프로토타입 칸 「${listed}」 를 찾지 못했습니다 (${path.relative(ws.root, path.join(d.dir, 'README.md'))}). 파일 경로 · 실행 주소로 고치거나 --proto`);
  }
  for (const d of dirs) {
    const files = walk(path.join(d.dir, 'prototype')).filter((f) => /\.html?$/i.test(f) && idRe(id).test(path.basename(f)));
    if (files.length === 1) return { url: pathToFileURL(files[0]).href, from: files[0], how: '파일 이름' };
    if (files.length > 1) throw new Error(`이름에 ${id} 가 든 프로토타입이 여럿입니다: ${files.map((f) => path.relative(ws.root, f)).join(', ')}. --proto 로 고른다`);
  }
  const docs = (ws.repos || []).filter((x) => x.kind === 'docs');
  const tpl = String(svars(ws).prototype || '').trim();
  if (tpl) {
    const target = tpl.replace(/\{id\}/g, id);
    const hit = toUrl(target, [...docs.map((r) => r.dir), ws.root]);
    if (!hit) throw new Error(`vars.screens.prototype 「${tpl}」 의 파일을 찾지 못했습니다 (기획 repo · 워크스페이스 기준). kedovi screens locate 로 고친다`);
    if (/^file:/.test(hit.url) && tpl.includes('{id}')) {
      const src = sourceHits(hit.from, id);
      if (!src.length) throw new Error(`${id} 가 프로토타입 소스(${path.relative(ws.root, path.dirname(hit.from))}/ 아래)에 없습니다. 화면 ID 가 맞는지 · 프로토타입에 그 화면이 있는지 확인한다`);
      return { ...hit, how: 'vars.screens.prototype', src: src.map((x) => `${path.relative(ws.root, x.file).split(path.sep).join('/')}:${x.line}`) };
    }
    return { ...hit, how: 'vars.screens.prototype' };
  }
  const looked = docs.flatMap((r) => screenDirNames(ws).map((d) => `${path.relative(ws.root, path.join(r.dir, d))}${fs.existsSync(path.join(r.dir, d)) ? '' : ' (없음)'}`));
  if (!docs.length) throw new Error('workspace.json 에 기획 repo(kind: docs)가 없어 화면 폴더를 찾지 못했습니다. 기획 repo 를 더하거나 --proto <파일|주소> 로 준다');
  if (!dirs.length) throw new Error(`화면 폴더가 없습니다. 찾은 곳: ${looked.join(' · ')}.${locateHint(ws)}`);
  throw new Error(`${id} 의 프로토타입을 찾지 못했습니다. 찾은 곳: 화면 목록 ${dirs.map((d) => path.relative(ws.root, path.join(d.dir, 'README.md'))).join(' · ')} 의 「프로토타입」 칸 · ${dirs.map((d) => path.relative(ws.root, path.join(d.dir, 'prototype'))).join(' · ')} 아래 이름에 ${id} 가 든 .html. 칸에 파일(prototype/…, 해시 주소면 파일#경로)이나 실행 주소를 적거나 --proto 로 준다.${locateHint(ws)}`);
}

/** 코드 repo 에서 `@spec … <화면 ID>` 가 있는 파일과 그 `@route` */
function specFiles(ws, id) {
  const out = [];
  for (const r of (ws.repos || []).filter((x) => x.kind !== 'docs' && x.kind !== 'legacy' && fs.existsSync(x.dir))) {
    let hits = '';
    try { hits = execFileSync('git', ['-C', r.dir, 'grep', '-n', '-I', '-E', `@spec[[:space:]](.*[^A-Za-z0-9_-])?${escRe(id)}([^A-Za-z0-9_-]|$)`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* 없음 · git 아님 */ }
    for (const line of hits.split('\n').filter(Boolean)) {
      const m = /^([^:]+):(\d+):(.*)$/.exec(line);
      if (!m) continue;
      const file = path.join(r.dir, m[1]);
      let route = (/@route\s+(\S+)/.exec(m[3]) || [])[1] || '';
      if (!route) {
        try { route = (/@route\s+(\S+)/.exec(fs.readFileSync(file, 'utf8').split('\n').slice(0, 30).join('\n')) || [])[1] || ''; } catch { /* 못 읽음 */ }
      }
      out.push({ repo: r.name, file, rel: `${r.name}/${m[1]}`, route: route.replace(/(\*\/|-->)$/, '') });
    }
  }
  return out;
}

function findImpl(ws, id, a) {
  const base = String((a.base && a.base !== true ? a.base : '') || ((ws.vars && ws.vars.screens) || {}).appUrl || 'http://localhost:5173').replace(/\/$/, '');
  if (a.impl && a.impl !== true) {
    const v = String(a.impl);
    const local = !/^https?:\/\//.test(v) && toUrl(v, [process.cwd(), ws.root]);
    if (local && /\.html?(#|$)/i.test(v)) return { url: local.url, how: '--impl (파일)', files: [] };
    return { url: /^https?:\/\//.test(v) || /^file:/.test(v) ? v : `${base}${v.startsWith('/') ? '' : '/'}${v}`, how: '--impl', files: [] };
  }
  const files = specFiles(ws, id);
  const routed = [...new Set(files.filter((f) => f.route).map((f) => f.route))];
  if (!files.length) { const code = (ws.repos || []).filter((x) => x.kind !== 'docs' && x.kind !== 'legacy'); throw new Error(`코드 repo 에 「@spec ${id}」 가 있는 파일이 없습니다 (찾은 repo: ${code.map((r) => `${r.name}${fs.existsSync(r.dir) ? '' : ' (폴더 없음)'}`).join(' · ') || '없음'}). 화면 진입점 머리 주석에 // @spec ${id} <기능 ID> @route /경로 를 달거나 --impl <주소|/경로>`); }
  if (!routed.length) throw new Error(`@spec ${id} 파일(${files.map((f) => f.rel).join(', ')})에 @route 가 없습니다. 그 머리 주석에 @route /경로 를 더하거나 --impl <주소|/경로>`);
  if (routed.length > 1) throw new Error(`${id} 의 @route 가 여럿입니다 (${routed.join(' · ')}). --impl 로 고른다`);
  if (/(^|\/):[A-Za-z_]|\[[^\]]+\]|\{[^}]+\}/.test(routed[0])) throw new Error(`@route ${routed[0]} 에 자리 값이 있습니다. 실제 값으로 --impl ${routed[0].replace(/:([A-Za-z_]+)|\[([^\]]+)\]|\{([^}]+)\}/g, '<$1$2$3>')}`);
  return { url: `${base}${routed[0].startsWith('/') ? '' : '/'}${routed[0]}`, how: `@route (${files.filter((f) => f.route).map((f) => f.rel).join(', ')})`, files };
}

/** playwright: 로컬 → 전역 → npx 캐시(Playwright MCP 가 받아 둔 것) */
function loadPlaywright() {
  const tries = [() => require('playwright'), () => require(path.join(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 'playwright'))];
  const cache = path.join(require('os').homedir(), '.npm', '_npx');
  try { for (const d of fs.readdirSync(cache)) tries.push(() => require(path.join(cache, d, 'node_modules', 'playwright'))); } catch { /* 캐시 없음 */ }
  for (const t of tries) { try { return t(); } catch { /* 다음 */ } }
  return null;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 배치 대조 한 줄: 「차이 2건 (1280px 1 · 390px 1) · 영역 12/14개 짝지음」 */
function layoutSummary(shots) {
  const ds = shots.filter((x) => x.diff);
  if (!ds.length) return '대조 못 함';
  const total = ds.reduce((n, x) => n + x.diff.diffs.length, 0);
  const m = ds[0].diff;
  if (!m.total) return '대조 못 함 (정본에서 제목 있는 영역을 찾지 못함: 프로토타입 영역에 제목 · data-area 를 달면 대조된다)';
  const match = `영역 ${m.matched}/${m.total}개 짝지음${m.missing.length ? ` (구현에서 못 찾은 제목: ${m.missing.slice(0, 5).join(' · ')}${m.missing.length > 5 ? ' …' : ''})` : ''}`;
  return total ? `차이 ${total}건 (${ds.map((x) => `${x.width}px ${x.diff.diffs.length}`).join(' · ')}) · ${match}` : `차이 없음 · ${match}`;
}

function compareHtml(id, proto, impl, shots) {
  const layout = shots.filter((s) => s.diff).map((s) => `<h3>${s.width}px 배치 대조</h3>${s.diff.diffs.length ? `<ul>${s.diff.diffs.map((d) => `<li>${esc(d.text)}</li>`).join('')}</ul>` : '<p>옆 · 위아래 관계가 바뀐 영역 없음</p>'}<p class="m">영역 ${s.diff.matched}/${s.diff.total}개를 제목으로 짝지음${s.diff.missing.length ? ` · 구현에서 못 찾은 제목: ${esc(s.diff.missing.join(' · '))}` : ''}</p>`).join('\n');
  const rows = shots.map((s) => `<h2>${s.width}px</h2><div class="pair"><figure><figcaption>프로토타입</figcaption><img src="${esc(path.basename(s.proto))}" alt="프로토타입 ${s.width}px"></figure><figure><figcaption>구현</figcaption><img src="${esc(path.basename(s.impl))}" alt="구현 ${s.width}px"></figure></div>`).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(id)} 화면 비교</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;background:#f5f5f7;color:#1d1d1f}h1{font-size:18px}h2{font-size:15px;margin:24px 0 8px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px}figcaption{font-weight:600;margin-bottom:6px}img{width:100%;height:auto;display:block;border:1px solid #eee}code{font-size:12px;word-break:break-all}h3{font-size:14px;margin:16px 0 4px}.m{color:#666;font-size:12px}</style></head>
<body><h1>${esc(id)} 프로토타입 ↔ 구현</h1><p>프로토타입: <code>${esc(proto.url)}</code><br>구현: <code>${esc(impl.url)}</code></p>
<p>정본 요소 체크리스트(kedovi screens inventory)의 요소마다 판정(구현 · 다름 (이유) · 뺌 (결정 ID) · 보류 (후속: 위치))을 적고, kedovi screens checklist --md 표를 MR 에 남긴다.</p>
${layout}
${rows}
</body></html>
`;
}

/** --mock 픽스처 → { kind: 'har', file } | { kind: 'routes', routes: [{ method, url, status, headers, body }] } */
function loadMock(ws, a) {
  const v = a.mock && a.mock !== true ? String(a.mock) : String(((ws.vars || {}).screens || {}).mock || '');
  if (!v) return null;
  const file = [process.cwd(), ws.root, ...(ws.repos || []).map((r) => r.dir)].map((b) => path.resolve(b, v)).find((p) => fs.existsSync(p));
  if (!file) throw new Error(`--mock 픽스처 ${v} 를 찾지 못했습니다 (지금 폴더 · 워크스페이스 · 각 repo 기준)`);
  if (/\.har$/i.test(file)) return { kind: 'har', file };
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(j) ? j : Array.isArray(j.routes) ? j.routes : Object.entries(j).map(([k, body]) => { const m = /^([A-Z]+)\s+(.+)$/.exec(k); return { method: m ? m[1] : '', url: m ? m[2] : k, json: body }; });
  const routes = list.map((r) => {
    let body = r.body;
    if (r.file) body = fs.readFileSync(path.resolve(path.dirname(file), r.file), 'utf8');
    else if (r.json !== undefined) body = JSON.stringify(r.json);
    return { method: String(r.method || '').toUpperCase(), url: String(r.url || ''), status: r.status || 200, headers: { 'content-type': r.json !== undefined || (r.file && /\.json$/i.test(r.file)) ? 'application/json' : 'text/plain', ...(r.headers || {}) }, body: body == null ? '' : String(body) };
  }).filter((r) => r.url);
  if (!routes.length) throw new Error(`픽스처 ${v} 에 경로가 없습니다`);
  return { kind: 'routes', routes, file };
}

async function applyMock(ctx, mock) {
  if (!mock) return;
  if (mock.kind === 'har') { await ctx.routeFromHAR(mock.file, { notFound: 'fallback' }); return; }
  for (const r of mock.routes) {
    await ctx.route(r.url, (route) => (r.method && route.request().method() !== r.method ? route.fallback() : route.fulfill({ status: r.status, headers: r.headers, body: r.body })));
  }
}

/** 브라우저 안에서: 영역 상자 [{ label, x, y, w, h }] (범위 = scope 선택자, 없으면 body). 영역 = 카드 · 패널 · section 등 상자 + 상자 밖 제목. 이름 = data-area · aria-label · 안쪽 제목 · 첫 줄 글자 */
function collectRegions(scope) {
  const root = (scope && document.querySelector(scope)) || document.body;
  const rb = root.getBoundingClientRect();
  const sy = window.scrollY;
  const TITLE = 'h1,h2,h3,h4,h5,h6,[role=heading],legend,caption,[class*="title" i],[class*="heading" i],[class*="CardHeader" i],[class*="card-head" i],[class*="panel-head" i]';
  const BOX = 'section,article,aside,nav,form,dialog,fieldset,table,[data-area],[role=region],[role=dialog],[role=tabpanel],[class*="card" i],[class*="panel" i],[class*="pane" i],[class*="paper" i],[class*="widget" i],[class*="tile" i]';
  const ICON = 'md-icon,svg,[class*="icon" i],[class*="material" i],[class*="symbol" i],[aria-hidden="true"]';
  const vis = (el) => { const b = el.getBoundingClientRect(); const st = getComputedStyle(el); return b.width > 16 && b.height > 8 && st.visibility !== 'hidden' && st.display !== 'none'; };
  const clean = (el, title) => { const c = el.cloneNode(true); c.querySelectorAll(title ? `${ICON},a,button,[role=button],[class*="btn" i],[class*="button" i],[class*="chip" i],[class*="badge" i]` : ICON).forEach((x) => x.remove()); return (c.textContent || '').replace(/\s+/g, ' ').trim(); };
  // 첫 글자 덩어리: 아이콘 안 글자(아이콘 글꼴 이름)는 건너뛰고, 처음 보이는 글자의 부모 요소 글자
  const firstLine = (el) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (!n.textContent.trim() || !p || p.closest(ICON) || !vis(p)) continue;
      const t = clean(p);
      if (t.length >= 2 && !/^[\p{P}\p{S}\p{N}\s_]+$/u.test(t)) return t; // 기호 · 숫자뿐인 덩어리(****-**34)는 건너뛴다
    }
    return '';
  };
  const nameOf = (box) => {
    if (box.getAttribute('data-area')) return box.getAttribute('data-area');
    if (box.getAttribute('aria-label')) return box.getAttribute('aria-label');
    const own = (sel) => [...box.querySelectorAll(sel)].find((x) => vis(x) && x.closest(BOX) === box && !x.querySelector('h1,h2,h3,h4,h5,h6') && clean(x, true).length >= 2);
    const t = own('h1,h2,h3,h4,h5,h6,[role=heading],legend,caption') || own(TITLE); // 제목 태그 먼저, 안쪽 링크 · 버튼 · 칩 글자(「전체 ›」 등)는 뺀다
    if (t) return clean(t, true);
    return firstLine(box);
  };
  const out = []; const seen = new Map(); const used = new Set();
  const add = (el, label) => {
    label = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!label || label.length < 2) return;
    const b = el.getBoundingClientRect();
    if (b.width < 60 || b.height < 20) return;
    const n = (seen.get(label) || 0) + 1; seen.set(label, n);
    out.push({ label: n > 1 ? `${label} (${n})` : label, x: Math.round(b.left - rb.left), y: Math.round(b.top + sy - (rb.top + sy)), w: Math.round(b.width), h: Math.round(b.height) });
    used.add(el);
  };
  for (const box of root.querySelectorAll(BOX)) { if (out.length >= 80) break; if (box !== root && vis(box)) add(box, nameOf(box)); }
  // 상자 밖 제목(화면 머리 등): 제목의 부모를 영역으로
  for (const t of root.querySelectorAll(TITLE)) {
    if (out.length >= 80) break;
    if (!vis(t) || t.closest(BOX) || t.querySelector('h1,h2,h3,h4,h5,h6')) continue;
    const box = t.parentElement && t.parentElement !== root ? t.parentElement : t;
    if (!used.has(box)) add(box, clean(t, true));
  }
  return { width: Math.round(rb.width), regions: out };
}

const normLabel = (s) => String(s || '').toLowerCase().replace(/[\s·・,.:;()\[\]{}<>"'`~!?_\-–—|/*]+/g, '').replace(/\d+/g, '#');

/** 두 상자의 관계: left(a 가 b 왼쪽, 같은 줄) · right · above(같은 열) · below · nest(겹침 · 포함 · 대각선) */
function relation(a, b) {
  const ov = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  const vOver = ov(a.y, a.y + a.h, b.y, b.y + b.h) / Math.max(1, Math.min(a.h, b.h));
  const hOver = ov(a.x, a.x + a.w, b.x, b.x + b.w) / Math.max(1, Math.min(a.w, b.w));
  const tol = 8;
  if (a.x + a.w <= b.x + tol && vOver > 0.2) return 'left';
  if (b.x + b.w <= a.x + tol && vOver > 0.2) return 'right';
  if (a.y + a.h <= b.y + tol && hOver > 0.2) return 'above';
  if (b.y + b.h <= a.y + tol && hOver > 0.2) return 'below';
  return 'nest'; // 대각선 · 겹침: 같은 줄 · 같은 열의 이웃만 비교한다
}
const REL_KO = { left: '왼쪽', right: '오른쪽', above: '위', below: '아래', nest: '겹침' };
const side = (r) => (r === 'left' || r === 'right' ? 'side' : r === 'above' || r === 'below' ? 'stack' : 'nest');

/**
 * 배치 대조: { matched, missing: [정본 제목], diffs: [{ key, text }] }
 * 짝 = 같은 제목(숫자는 같게 본다). 짝지은 영역 쌍마다 관계가 옆 ↔ 위아래로 바뀌었거나, 폭 비율이 2배 넘게 달라졌으면 차이
 */
function compareLayout(proto, impl) {
  const P = proto.regions || []; const I = impl.regions || [];
  const byLabel = new Map(I.map((r) => [normLabel(r.label), r]));
  const pairs = [];
  const missing = [];
  for (const p of P) {
    const k = normLabel(p.label);
    let hit = byLabel.get(k);
    if (!hit && k.length >= 3) hit = I.find((r) => { const n = normLabel(r.label); return n.length >= 3 && (n.includes(k) || k.includes(n)); });
    if (hit) pairs.push([p, hit]); else missing.push(p.label);
  }
  const moved = [];
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [pa, ia] = pairs[i]; const [pb, ib] = pairs[j];
      const rp = relation(pa, pb); const ri = relation(ia, ib);
      if (side(rp) === 'nest' || side(ri) === 'nest' || side(rp) === side(ri)) continue;
      moved.push([pairs[i], pairs[j]]);
    }
  }
  // 한 영역이 여러 짝과 함께 바뀌면(체결 이력이 오른쪽에서 아래로 가면 다른 영역 여럿과 바뀐다) 그 영역(움직인 쪽) 기준으로 한 줄
  const count = new Map();
  for (const [a, b] of moved) for (const x of [a, b]) count.set(x[0].label, (count.get(x[0].label) || 0) + 1);
  const grouped = new Map();
  for (const [a, b] of moved) {
    // 움직인 쪽: 바뀐 관계가 많은 영역, 같으면 자리(가운데 점)가 더 많이 옮겨 간 영역
    const moveOf = (x) => Math.abs((x[0].x + x[0].w / 2) / Math.max(1, proto.width) - (x[1].x + x[1].w / 2) / Math.max(1, impl.width)) + Math.abs((x[0].y + x[0].h / 2) - (x[1].y + x[1].h / 2)) / 1000;
    const ca = count.get(a[0].label) || 0; const cb = count.get(b[0].label) || 0;
    const [m, o] = cb > ca || (cb === ca && moveOf(b) > moveOf(a)) ? [b, a] : [a, b];
    const key = `${m[0].label} 위치`;
    if (grouped.has(key)) { grouped.get(key).others += 1; continue; }
    grouped.set(key, { key, text: `「${m[0].label}」: 정본에서 「${o[0].label}」 ${REL_KO[relation(m[0], o[0])]} → 구현에서 ${REL_KO[relation(m[1], o[1])]}`, others: 0 });
  }
  const out = [...grouped.values()].map((d) => ({ key: d.key, text: d.others ? `${d.text} (외 ${d.others}개 영역과도)` : d.text }));
  for (const [p, im] of pairs) {
    const rp = p.w / Math.max(1, proto.width); const ri = im.w / Math.max(1, impl.width);
    if (rp > 0 && ri > 0 && (rp / ri > 2 || ri / rp > 2) && Math.abs(rp - ri) > 0.25) out.push({ key: `${p.label} 폭`, text: `「${p.label}」: 폭 정본 ${Math.round(rp * 100)}% → 구현 ${Math.round(ri * 100)}%` });
  }
  return { matched: pairs.length, total: P.length, missing, diffs: out };
}

async function shoot(pw, url, file, width, a, mock) {
  let browser;
  try { browser = await pw.chromium.launch(); } catch { browser = await pw.chromium.launch({ channel: 'chrome' }); }
  try {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 800 }, ...(a.storage && a.storage !== true && /^https?:/.test(url) ? { storageState: String(a.storage) } : {}) });
    await applyMock(ctx, mock);
    const page = await ctx.newPage();
    const failed = [];
    page.on('response', (res) => { if (res.status() >= 400 && /^(xhr|fetch)$/.test(res.request().resourceType())) failed.push(`${res.status()} ${res.request().method()} ${res.url()}`); });
    page.on('requestfailed', (req) => { if (/^(xhr|fetch)$/.test(req.resourceType())) failed.push(`실패 ${req.method()} ${req.url()}`); });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(async (e) => { if (!/Timeout/i.test(e.message)) throw e; });
    if (a.wait && a.wait !== true) await page.waitForSelector(String(a.wait), { timeout: 15000 });
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
    await page.screenshot({ path: file, fullPage: true });
    let layout = { width, regions: [] };
    try { layout = await page.evaluate(collectRegions, a.scope && a.scope !== true ? String(a.scope) : ''); } catch { /* 배치는 부가 */ }
    return { failed, layout };
  } finally { await browser.close(); }
}

async function main() {
  const a = parseArgs(process.argv.slice(2).filter((x) => x !== 'compare'));
  const id = a._[0];
  if (!id || a.help || a.h) {
    const src = fs.readFileSync(__filename, 'utf8').split('\n'); console.log(src.slice(1, src.findIndex((l) => l.trim() === '*/')).map((l) => l.replace(/^(\/\/|\/\*| \*\/?) ?/, '')).filter(Boolean).join('\n'));
    process.exit(id ? 0 : 1);
  }
  let ws;
  try { ws = require(path.join(PACKS, 'core', 'lib', 'workspace.js')).load(path.resolve(PACKS, '..')); } catch (e) { console.error(`✖ workspace.json 을 읽지 못했습니다. ${e.message}`); process.exit(1); }
  if ((!a.scope || a.scope === true) && svars(ws).scope) a.scope = svars(ws).scope;
  let proto; let impl; let mock;
  const notRun = '미실행: 완료로 보고하지 않는다. 사용자에게 알리고, 대체 캡처로 확인했으면 그 방법을 보고와 체크리스트 「- 비교:」 줄에 적는다';
  try { proto = findPrototype(ws, id, a); impl = findImpl(ws, id, a); mock = loadMock(ws, a); } catch (e) { console.error(`✖ ${e.message}\n  ${notRun}`); process.exit(1); }
  const widths = String(a.widths && a.widths !== true ? a.widths : '1280,390').split(',').map((x) => parseInt(x, 10)).filter((n) => n >= 200 && n <= 3840);
  if (a.find) { console.log(JSON.stringify({ id, prototype: proto, implementation: impl, widths, mock: mock ? { kind: mock.kind, file: mock.file, routes: mock.routes ? mock.routes.length : undefined } : null }, null, 2)); return; }
  const pw = loadPlaywright();
  if (!pw) { console.error(`✖ playwright 를 찾지 못했습니다. npm i -g playwright && npx playwright install chromium (또는 Playwright MCP 를 한 번 실행해 받아 둔다)\n  ${notRun}`); process.exit(2); }
  const out = a.out && a.out !== true ? path.resolve(String(a.out)) : path.join(require(path.join(PACKS, 'core', 'lib', 'workspace.js')).stateDir(ws.root), 'compare', id.replace(/[^\w.-]/g, '_'));
  fs.mkdirSync(out, { recursive: true });
  const shots = [];
  const unmocked = new Set();
  for (const w of widths) {
    const s = { width: w, proto: path.join(out, `prototype-${w}.png`), impl: path.join(out, `impl-${w}.png`) };
    try { s.protoLayout = (await shoot(pw, proto.url, s.proto, w, a)).layout; } catch (e) { console.error(`✖ 프로토타입을 열지 못했습니다 (${proto.url}, ${w}px): ${e.message.split('\n')[0]}\n  ${notRun}`); process.exit(2); }
    try { const r = await shoot(pw, impl.url, s.impl, w, a, mock); for (const f of r.failed) unmocked.add(f); s.implLayout = r.layout; s.diff = compareLayout(s.protoLayout, s.implLayout); } catch (e) { console.error(`✖ 구현 화면을 열지 못했습니다 (${impl.url}, ${w}px): ${e.message.split('\n')[0]}. 앱(프런트 개발 서버)을 띄웠는지 · 백엔드가 없으면 --mock <픽스처> · 로그인이 필요하면 --storage\n  ${notRun}`); process.exit(2); }
    shots.push(s);
  }
  const html = path.join(out, 'compare.html');
  fs.writeFileSync(html, compareHtml(id, proto, impl, shots));
  fs.writeFileSync(path.join(out, 'layout.json'), `${JSON.stringify(shots.map((x) => ({ width: x.width, prototype: x.protoLayout, implementation: x.implLayout, diff: x.diff })), null, 2)}\n`);
  const layoutRows = shots.flatMap((x) => (x.diff ? x.diff.diffs.map((d) => ({ ...d, width: x.width })) : []));
  const layoutLine = layoutSummary(shots);
  console.log(`✔ ${id} 화면 비교 (${widths.join(' · ')}px)`);
  console.log(`  프로토타입: ${proto.url} (${proto.how})`);
  console.log(`  구현: ${impl.url} (${impl.how})`);
  for (const s of shots) console.log(`  ${s.width}px: ${s.proto} · ${s.impl}`);
  console.log(`  나란히 보기: ${pathToFileURL(html).href}`);
  if (mock) console.log(`  목: ${path.relative(ws.root, mock.file)} (${mock.kind === 'har' ? 'HAR' : `경로 ${mock.routes.length}개`})`);
  if (unmocked.size) console.log(`  ⚠ 구현 화면의 API 요청 ${unmocked.size}개가 실패했습니다 (오류 응답 · 연결 실패: 빈 화면 · 오류 상태로 찍혔을 수 있다): ${[...unmocked].slice(0, 6).join(' · ')}${unmocked.size > 6 ? ' …' : ''}. 픽스처에 더한다`);
  console.log(`  배치: ${layoutLine}`);
  for (const d of layoutRows.slice(0, 10)) console.log(`    ${d.width}px ${d.text}`);
  try { const f = require('./screens-inventory.js').recordCompare(ws, id, html, { line: layoutLine, rows: layoutRows }); if (f) console.log(`  체크리스트 비교 · 배치 줄: ${path.relative(ws.root, f)}${layoutRows.length ? ` (배치 행 ${layoutRows.length}개: 판정 필요)` : ''}`); } catch { /* 체크리스트는 부가 */ }
  console.log(`다음: 두 화면의 구성(영역 배치 · 카드 머리 · 상태 칩 색 · 막대 · 타일 · 간격)을 비교해 체크리스트 판정을 채우고 kedovi screens checklist ${id}. 리뷰 위임 지시서에는 kedovi screens review ${id} 블록을 넣는다`);
}

if (require.main === module) main().catch((e) => { console.error(`✖ ${e.message}`); process.exit(2); });
module.exports = { compareLayout, relation, layoutSummary, collectRegions, screenDirNames, screenDirs, locateCandidates, sourceHits, toUrl, walk, idRe, listedPrototype, cellTarget, findPrototype, findImpl, specFiles, loadMock, loadPlaywright, parseArgs };
