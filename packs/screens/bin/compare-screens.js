#!/usr/bin/env node
// 프로토타입 ↔ 구현 화면 비교: 같은 폭(PC · 폰)으로 스크린샷을 두 장씩 찍고 나란히 보는 compare.html 을 만든다. 실행: kedovi screens compare <화면 ID> [옵션]
/*
 * 프로토타입 찾기: --proto → 기획 repo 화면 목록(<화면 폴더>/README.md 표)의 「프로토타입」 칸 → prototype/ 아래 이름에 화면 ID 가 든 .html
 * 구현 찾기:     --impl (주소 · /경로) → 코드 repo 에서 `@spec <화면 ID>` 가 있는 파일의 `@route /경로` (그 줄 또는 파일 머리 30줄)
 *                주소 앞부분은 --base → vars.screens.appUrl (기본 http://localhost:5173)
 * 옵션: --widths 1280,390 · --out <폴더> · --storage <Playwright storageState.json>(로그인 상태) · --wait <CSS 선택자> · --find(브라우저 없이 찾은 것만)
 *       --mock <픽스처.json|.har>(백엔드 없이: 구현 화면의 API 요청을 픽스처로 답한다. 기본 vars.screens.mock)
 * 픽스처 JSON: { "routes": [{ "method": "GET", "url": "<Playwright glob · 정규식 아님>", "status": 200, "json": {…} | "body": "…" | "file": "응답.json", "headers": {} }] } 또는 { "GET <glob>": {…응답 본문…} }. .har 는 Playwright routeFromHAR
 * 끝 코드: 0 = 찍음(또는 --find 로 찾음) · 1 = 화면 ID · 프로토타입 · 구현 주소 · 픽스처를 못 찾음 · 2 = Playwright · 브라우저 · 페이지 열기 실패
 * 찍으면 정본 요소 체크리스트(kedovi screens inventory)의 「비교:」 줄에 compare.html 경로를 적는다. 못 찍으면 「미실행」: 완료로 보고하지 않는다
 * 시각 diff 는 하지 않는다. 사람이(또는 리뷰 모델이) 나란히 놓고 정본 요소 체크리스트의 판정을 채운다.
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

/** 기획 repo 들의 화면 폴더 [{ repo, dir }] */
function screenDirs(ws) {
  const out = [];
  for (const r of (ws.repos || []).filter((x) => x.kind === 'docs')) {
    for (const d of SCREEN_DIRS) if (fs.existsSync(path.join(r.dir, d))) out.push({ repo: r, dir: path.join(r.dir, d) });
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
  const looked = docs.flatMap((r) => SCREEN_DIRS.map((d) => `${path.relative(ws.root, path.join(r.dir, d))}${fs.existsSync(path.join(r.dir, d)) ? '' : ' (없음)'}`));
  if (!docs.length) throw new Error('workspace.json 에 기획 repo(kind: docs)가 없어 화면 폴더를 찾지 못했습니다. 기획 repo 를 더하거나 --proto <파일|주소> 로 준다');
  if (!dirs.length) throw new Error(`화면 폴더가 없습니다. 찾은 곳: ${looked.join(' · ')}. 폴더를 만들거나 --proto <파일|주소> 로 준다`);
  throw new Error(`${id} 의 프로토타입을 찾지 못했습니다. 찾은 곳: 화면 목록 ${dirs.map((d) => path.relative(ws.root, path.join(d.dir, 'README.md'))).join(' · ')} 의 「프로토타입」 칸 · ${dirs.map((d) => path.relative(ws.root, path.join(d.dir, 'prototype'))).join(' · ')} 아래 이름에 ${id} 가 든 .html. 칸에 파일(prototype/…, 해시 주소면 파일#경로)이나 실행 주소를 적거나 --proto 로 준다`);
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
    return { url: /^https?:\/\//.test(v) ? v : `${base}${v.startsWith('/') ? '' : '/'}${v}`, how: '--impl', files: [] };
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

function compareHtml(id, proto, impl, shots) {
  const rows = shots.map((s) => `<h2>${s.width}px</h2><div class="pair"><figure><figcaption>프로토타입</figcaption><img src="${esc(path.basename(s.proto))}" alt="프로토타입 ${s.width}px"></figure><figure><figcaption>구현</figcaption><img src="${esc(path.basename(s.impl))}" alt="구현 ${s.width}px"></figure></div>`).join('\n');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(id)} 화면 비교</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:16px;background:#f5f5f7;color:#1d1d1f}h1{font-size:18px}h2{font-size:15px;margin:24px 0 8px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px}figcaption{font-weight:600;margin-bottom:6px}img{width:100%;height:auto;display:block;border:1px solid #eee}code{font-size:12px;word-break:break-all}</style></head>
<body><h1>${esc(id)} 프로토타입 ↔ 구현</h1><p>프로토타입: <code>${esc(proto.url)}</code><br>구현: <code>${esc(impl.url)}</code></p>
<p>정본 요소 체크리스트(kedovi screens inventory)의 요소마다 판정(구현 · 다름 (이유) · 뺌 (결정 ID))을 적고, kedovi screens checklist --md 표를 MR 에 남긴다.</p>
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
    return failed;
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
    try { await shoot(pw, proto.url, s.proto, w, a); } catch (e) { console.error(`✖ 프로토타입을 열지 못했습니다 (${proto.url}, ${w}px): ${e.message.split('\n')[0]}\n  ${notRun}`); process.exit(2); }
    try { for (const f of await shoot(pw, impl.url, s.impl, w, a, mock)) unmocked.add(f); } catch (e) { console.error(`✖ 구현 화면을 열지 못했습니다 (${impl.url}, ${w}px): ${e.message.split('\n')[0]}. 앱(프런트 개발 서버)을 띄웠는지 · 백엔드가 없으면 --mock <픽스처> · 로그인이 필요하면 --storage\n  ${notRun}`); process.exit(2); }
    shots.push(s);
  }
  const html = path.join(out, 'compare.html');
  fs.writeFileSync(html, compareHtml(id, proto, impl, shots));
  console.log(`✔ ${id} 화면 비교 (${widths.join(' · ')}px)`);
  console.log(`  프로토타입: ${proto.url} (${proto.how})`);
  console.log(`  구현: ${impl.url} (${impl.how})`);
  for (const s of shots) console.log(`  ${s.width}px: ${s.proto} · ${s.impl}`);
  console.log(`  나란히 보기: ${pathToFileURL(html).href}`);
  if (mock) console.log(`  목: ${path.relative(ws.root, mock.file)} (${mock.kind === 'har' ? 'HAR' : `경로 ${mock.routes.length}개`})`);
  if (unmocked.size) console.log(`  ⚠ 구현 화면의 API 요청 ${unmocked.size}개가 실패했습니다 (오류 응답 · 연결 실패: 빈 화면 · 오류 상태로 찍혔을 수 있다): ${[...unmocked].slice(0, 6).join(' · ')}${unmocked.size > 6 ? ' …' : ''}. 픽스처에 더한다`);
  try { const f = require('./screens-inventory.js').recordCompare(ws, id, html); if (f) console.log(`  체크리스트 비교 줄: ${path.relative(ws.root, f)}`); } catch { /* 체크리스트는 부가 */ }
  console.log(`다음: 두 화면의 구성(영역 배치 · 카드 머리 · 상태 칩 색 · 막대 · 타일 · 간격)을 비교해 체크리스트 판정을 채우고 kedovi screens checklist ${id}. 리뷰 위임 지시서에는 kedovi screens review ${id} 블록을 넣는다`);
}

if (require.main === module) main().catch((e) => { console.error(`✖ ${e.message}`); process.exit(2); });
module.exports = { listedPrototype, cellTarget, findPrototype, findImpl, specFiles, loadMock, loadPlaywright, parseArgs };
