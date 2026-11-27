#!/usr/bin/env node
// 화면 품질 점검: 레이아웃 · 입력 · 목록 · 상태 · 상호작용 · 호환성 · 접근성 · 사용성 8개 영역을 화면마다 판정한다. 실행: kedovi screens quality|audit|quality-level|usability
/*
 * kedovi screens quality <화면 ID> [--design] [--no-run] [--impl 주소|/경로] [--proto 파일|주소] [--mock 픽스처] [--storage 상태.json] [--wait CSS]
 *     품질 점검표(handoffs/<나>/screens/<화면 ID>.quality.md)를 만들고(있으면 판정을 살려 합친다) 자동 측정을 돌려 채운다. --design = 정본(프로토타입)을 측정 (설계 단계)
 * kedovi screens audit [--run] [--design] [--json]   모든 화면의 품질 점검 현황 (업그레이드 뒤 한 번에). --run 이면 화면마다 자동 측정까지
 * kedovi screens quality-level [public|standard|light]   수준 (공공 · 일반 · 사내 도구, workspace.json vars.screens.quality)
 * kedovi screens usability   사용성 평가 결과서 뼈대 (docs-site/테스트/사용성-평가.md, 없을 때만)
 * 판정: 통과 · 실패 (내용) · 해당 없음 (이유) · 예외 (결정 ID). 자동 측정이 채운 판정은 「(자동)」 이 붙고, 사람이 쓴 판정은 덮지 않는다
 * 끝 코드: 0 = 정상 · 1 = 화면 ID · 주소를 못 찾음 · 필수 항목 미판정 · 실패 · 2 = Playwright 없음
 */
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./compare-screens.js');

const PACKS = path.resolve(__dirname, '..', '..');
const CATALOG = path.join(PACKS, 'screens', 'assets', 'quality', 'items.json');
const LEVELS = ['public', 'standard', 'light'];
const DECISION = /[A-Z][A-Z0-9]*-[A-Z0-9][\w-]*|결정\s*#?\d+/;
const COLS = ['ID', '영역', '항목', '구분', '확인 방법', '근거', '자동 결과', '판정'];
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const today = () => new Date().toISOString().slice(0, 10);

function catalog() { return JSON.parse(fs.readFileSync(CATALOG, 'utf8')); }
function levelOf(ws) { const v = String((((ws && ws.vars) || {}).screens || {}).quality || 'standard'); return LEVELS.includes(v) ? v : 'standard'; }

/** 수준 · 화면 성격(form · list · api)에 맞는 항목. traits 가 없으면(모름) 모두 넣는다 */
function itemsFor(level, traits) {
  const li = LEVELS.indexOf(level);
  return catalog().items.map((it) => ({ ...it, need: it.level[li] })).filter((it) => it.need !== 'skip')
    .filter((it) => it.when === 'always' || !traits || traits[it.when] !== false);
}

/** 판정 분류: ok · fail · empty · bad */
function verdictKind(v) {
  const t = String(v || '').trim();
  if (!t) return 'empty';
  if (/^통과/.test(t)) return 'ok';
  if (/^실패/.test(t)) return 'fail';
  const reason = (/^\S+(?:\s\S+)?\s*[(（](.*)[)）]/s.exec(t) || [])[1] || '';
  if (/^해당\s*없음\s*[(（]/.test(t)) return reason.trim() ? 'ok' : 'bad';
  if (/^예외\s*[(（]/.test(t)) return DECISION.test(reason) ? 'ok' : 'bad';
  return 'bad';
}

const me = (ws) => require(path.join(PACKS, 'core', 'lib', 'workspace.js')).devId(ws.root) || 'me';
const safeId = (id) => String(id).replace(/[^\w.-]+/g, '_');
// 설계 단계(--design) 결과는 따로: 구현 판정에 섞이지 않게 (완료 조건은 구현 쪽만 본다)
const suffix = (design) => (design ? '.quality-design.md' : '.quality.md');
function qualityPath(ws, id, design = false) { return path.join(ws.root, 'handoffs', me(ws), 'screens', `${safeId(id)}${suffix(design)}`); }
/** 내 것 → 다른 사람 것 (같은 화면을 이어받은 경우) */
function findQuality(ws, id, design = false) {
  const mine = qualityPath(ws, id, design);
  if (fs.existsSync(mine)) return mine;
  const hd = path.join(ws.root, 'handoffs');
  try { for (const who of fs.readdirSync(hd)) { const f = path.join(hd, who, 'screens', `${safeId(id)}${suffix(design)}`); if (fs.existsSync(f)) return f; } } catch { /* 없음 */ }
  return null;
}

function readQuality(file) {
  const text = fs.readFileSync(file, 'utf8');
  const head = {};
  const rows = [];
  let cols = null;
  for (const l of text.split('\n')) {
    const m = /^- ([^:]{1,20}):\s*(.*)$/.exec(l);
    if (m && !rows.length) { head[m[1]] = m[2]; continue; }
    if (!/^\s*\|/.test(l)) { cols = null; continue; }
    const cells = l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
    if (!cols) { if (cells[0] === 'ID') cols = cells; continue; }
    if (cells.every((c) => /^:?-+:?$/.test(c) || !c)) continue;
    const r = {};
    cols.forEach((k, i) => { r[k] = cells[i] || ''; });
    rows.push({ id: r.ID, area: r['영역'], title: r['항목'], need: r['구분'] === '필수' ? 'req' : 'rec', how: r['확인 방법'], ref: r['근거'], auto: r['자동 결과'], verdict: r['판정'] });
  }
  return { head, rows };
}

function writeQuality(file, { id, level, basis, measured, rows, design }) {
  const lines = [
    `# ${id} 화면 품질 점검${design ? ' (설계 단계: 정본)' : ''}`,
    '',
    `- 수준: ${catalog().levels[level].label} (${level}, 바꾸기: kedovi screens quality-level)`,
    `- 기준: ${basis}`,
    `- 자동 측정: ${measured || '미실행 (kedovi screens quality ' + id + ')'}`,
    `- 만든 때: ${today()} · kedovi screens quality ${id}`,
    '',
    '판정은 `통과` · `실패 (내용)` · `해당 없음 (이유)` · `예외 (결정 ID)` 가운데 하나. 자동 측정이 채운 판정에는 「(자동)」 이 붙고, 사람이 쓴 판정은 다시 돌려도 덮지 않는다. 필수 항목이 모두 통과 · 해당 없음 · 예외여야 화면 작업이 완료다 (kedovi screens checklist). 권장 항목은 남으면 알리기만 한다.',
    '',
    `| ${COLS.join(' | ')} |`,
    `|${COLS.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${[r.id, r.area, r.title, r.need === 'req' ? '필수' : '권장', r.how, r.ref, r.auto || '', r.verdict || ''].map(cell).join(' | ')} |`),
    '',
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'));
}

/** 점검: { file, rows, req: { total, ok, fail, empty, bad }, rec: {...}, measured } */
function checkQuality(file) {
  const q = readQuality(file);
  const sum = (need) => {
    const xs = q.rows.filter((r) => r.need === need);
    const k = xs.map((r) => verdictKind(r.verdict));
    const pick = (x) => xs.filter((_, i) => k[i] === x);
    return { total: xs.length, ok: pick('ok'), fail: pick('fail'), empty: pick('empty'), bad: pick('bad') };
  };
  return { file, head: q.head, rows: q.rows, req: sum('req'), rec: sum('rec'), measured: !!q.head['자동 측정'] && !/^미실행/.test(q.head['자동 측정']) };
}

/** 화면 성격: 요소 체크리스트의 종류 칸에서 (없으면 null = 모름) */
function traitsFromChecklist(ws, id) {
  let I;
  try { I = require('./screens-inventory.js'); } catch { return null; }
  const f = I.findChecklist(ws, id);
  if (!f) return null;
  const kinds = I.readChecklist(f).rows.map((r) => r.kind);
  return { form: kinds.some((k) => /입력|선택/.test(k)), list: kinds.some((k) => /^표$|목록/.test(k)), api: true };
}

// ── 자동 측정 (Playwright, 브라우저 안 함수는 직렬화되니 바깥 변수를 쓰지 않는다) ──

/** axe-core: 로컬 → 전역 → npx 캐시 */
function axeSource() {
  const { execSync } = require('child_process');
  const tries = [() => require.resolve('axe-core/axe.min.js'), () => path.join(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 'axe-core', 'axe.min.js')];
  const cache = path.join(require('os').homedir(), '.npm', '_npx');
  try { for (const d of fs.readdirSync(cache)) tries.push(() => path.join(cache, d, 'node_modules', 'axe-core', 'axe.min.js')); } catch { /* 없음 */ }
  for (const t of tries) { try { const p = t(); if (fs.existsSync(p)) return p; } catch { /* 다음 */ } }
  return null;
}

function probeLayout() {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0; };
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} 「${(el.innerText || el.getAttribute('aria-label') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 24)}」`;
  const clipped = [];
  const noTitle = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || !el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(el);
    const hidX = /hidden|clip/.test(s.overflowX); const hidY = /hidden|clip/.test(s.overflowY);
    if (hidX && el.scrollWidth > el.clientWidth + 1) { if (s.textOverflow === 'ellipsis') { if (!el.title && !el.getAttribute('aria-label')) noTitle.push(name(el)); } else clipped.push(name(el)); }
    else if (hidY && el.scrollHeight > el.clientHeight + 2 && !s.webkitLineClamp) clipped.push(name(el));
  }
  const boxes = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],h1,h2,h3,h4,label')].filter(vis).slice(0, 400);
  const overlap = [];
  for (let i = 0; i < boxes.length && overlap.length < 20; i++) {
    const a = boxes[i].getBoundingClientRect();
    for (let j = i + 1; j < boxes.length; j++) {
      const x = boxes[i]; const y = boxes[j];
      if (x.contains(y) || y.contains(x) || (x.tagName === 'LABEL' && (x.control === y || x.htmlFor === y.id)) || (y.tagName === 'LABEL' && (y.control === x || y.htmlFor === x.id))) continue;
      const b = y.getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 2 && h > 2 && w * h > 0.25 * Math.min(a.width * a.height, b.width * b.height)) overlap.push(`${name(x)} ↔ ${name(y)}`);
    }
  }
  // 가로 넘침: 화면 오른쪽 밖으로 나간 요소 가운데 표 · 스크롤 영역 안이 아닌 것 (2차원 표는 WCAG 1.4.10 예외)
  const W = document.documentElement.clientWidth;
  const over = document.documentElement.scrollWidth > W + 1;
  const offenders = [];
  if (over) {
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el) || el.getBoundingClientRect().right <= W + 1) continue;
      let p = el; let ok = false;
      while (p && p !== document.body) { const s = getComputedStyle(p); if (/auto|scroll/.test(s.overflowX) || p.tagName === 'TABLE' || p.getAttribute('role') === 'grid') { ok = true; break; } p = p.parentElement; }
      if (!ok && ![...el.children].some((c) => c.getBoundingClientRect().right > W + 1)) offenders.push(name(el));
      if (offenders.length >= 8) break;
    }
  }
  const forms = [...document.querySelectorAll('form, [role=form]')].filter(vis).length;
  const inputs = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(vis).length;
  const lists = [...document.querySelectorAll('table,[role=grid],[role=table]')].filter(vis).length + [...document.querySelectorAll('ul,ol')].filter((u) => vis(u) && u.children.length >= 5 && !u.closest('nav')).length;
  return { clipped: clipped.slice(0, 12), noTitle: noTitle.slice(0, 12), overlap, offenders, over, forms, inputs, lists };
}

function probeTargets() {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const small = [];
  const all = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=checkbox],[role=tab]')].filter(vis);
  const rects = all.map((el) => el.getBoundingClientRect());
  const tiny = all.map((el, i) => rects[i].width < 24 || rects[i].height < 24);
  const center = (r) => [r.left + r.width / 2, r.top + r.height / 2];
  const dist = (p, r) => Math.hypot(Math.max(r.left - p[0], 0, p[0] - r.right), Math.max(r.top - p[1], 0, p[1] - r.bottom));
  all.forEach((el, i) => {
    if (!tiny[i]) return;
    if (el.tagName === 'A' && el.parentElement && /^(P|LI|TD|SPAN|DD)$/.test(el.parentElement.tagName) && el.parentElement.innerText.trim().length > el.innerText.trim().length + 4) return; // 문장 안 링크 (예외)
    const c = center(rects[i]);
    const crowded = all.some((o, j) => j !== i && !o.contains(el) && !el.contains(o) && (dist(c, rects[j]) < 12 || (tiny[j] && Math.hypot(c[0] - center(rects[j])[0], c[1] - center(rects[j])[1]) < 24)));
    if (crowded) small.push(`${el.tagName.toLowerCase()} 「${(el.innerText || el.getAttribute('aria-label') || el.placeholder || '').trim().slice(0, 16)}」 ${Math.round(rects[i].width)}×${Math.round(rects[i].height)}`);
  });
  return small.slice(0, 12);
}

function focusables() {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[inert],[aria-hidden=true]'); };
  const list = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable=true],summary')].filter((el) => vis(el) && !el.disabled);
  list.forEach((el, i) => { el.dataset.kedoviQ = String(i); el.dataset.kedoviQs = JSON.stringify([getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineWidth, getComputedStyle(el).boxShadow, getComputedStyle(el).borderColor, getComputedStyle(el).backgroundColor]); });
  return list.length;
}
function focusNow() {
  const el = document.activeElement;
  if (!el || !el.dataset || el.dataset.kedoviQ === undefined) return null;
  const s = getComputedStyle(el);
  const was = JSON.parse(el.dataset.kedoviQs || '[]');
  const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== was[2] || s.borderColor !== was[3] || s.backgroundColor !== was[4];
  return { i: el.dataset.kedoviQ, ring, name: `${el.tagName.toLowerCase()} 「${(el.innerText || el.getAttribute('aria-label') || el.value || '').trim().slice(0, 16)}」` };
}
function unreached(seen) {
  return [...document.querySelectorAll('[data-kedovi-q]')].filter((el) => !seen.includes(el.dataset.kedoviQ)).slice(0, 10).map((el) => `${el.tagName.toLowerCase()} 「${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 16)}」`);
}
function busyShown() {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const hit = [...document.querySelectorAll('[aria-busy=true],[role=progressbar],progress,[class*=spinner],[class*=loading],[class*=skeleton],[class*=Spinner],[class*=Loading],[class*=Skeleton]')].some(vis);
  return hit || /불러오는|로딩|loading|잠시만/i.test(document.body.innerText || '');
}

const STATE_WORDS = {
  stateEmpty: /없습니다|없어요|비어|결과가 없|no (data|results|items)|empty|nothing/i,
  stateError: /오류|실패|문제가|다시 시도|에러|error|failed|retry|try again/i,
  stateOffline: /연결|네트워크|오프라인|인터넷|offline|network|오류|실패|다시 시도/i,
  stateForbidden: /권한|접근할 수 없|접근 권한|로그인|forbidden|permission|unauthori[sz]ed|sign in/i,
};

/** 브라우저 띄우기: Playwright 내려받은 것 → (Chromium 이면) 설치된 Chrome. 못 띄우면 null */
async function launch(pw, kind) {
  try { return await pw[kind].launch(); } catch { /* 다음 */ }
  if (kind === 'chromium') { try { return await pw.chromium.launch({ channel: 'chrome' }); } catch { /* 없음 */ } }
  return null;
}

async function newCtx(browser, a, opts, mock) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts, ...(a.storage && a.storage !== true ? { storageState: String(a.storage) } : {}) });
  // 저장 요청(GET 아닌 xhr · fetch)은 서버로 보내지 않는다: 가짜 성공. 목 픽스처에 있으면 그것이 먼저
  await ctx.route('**/*', (route) => { const r = route.request(); return /^(xhr|fetch)$/.test(r.resourceType()) && r.method() !== 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) : route.fallback(); });
  await C.applyMock(ctx, mock);
  return ctx;
}

async function open(page, url, a) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(async (e) => { if (!/Timeout/i.test(e.message)) throw e; });
  if (a.wait && a.wait !== true) await page.waitForSelector(String(a.wait), { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
}

/** 자동 측정 전부: 결과 { key: { pass: true|false|null, text } } + traits + 스크린샷 폴더 */
async function measure(pw, url, a, mock, outDir, { design = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const R = {};
  const put = (k, pass, text) => { R[k] = { pass, text }; };
  const browser = await launch(pw, 'chromium');
  if (!browser) throw new Error('Chromium · Chrome 을 띄우지 못했습니다 (npx playwright install chromium)');
  const traits = { form: false, list: false, api: false };
  try {
    // 1) 기본 열기: 오류 · API 요청 · 레이아웃 · 접근성 · 키보드 · 누르는 영역 · 속도
    const ctx = await newCtx(browser, a, {}, mock);
    const page = await ctx.newPage();
    const errors = []; let api = 0;
    page.on('pageerror', (e) => errors.push(`페이지 오류: ${String(e.message).slice(0, 80)}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`콘솔: ${m.text().slice(0, 80)}`); });
    page.on('request', (r) => { if (/^(xhr|fetch)$/.test(r.resourceType())) api += 1; });
    await page.addInitScript(() => { window.__kedoviLcp = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__kedoviLcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* 없음 */ } });
    await open(page, url, a);
    await page.screenshot({ path: path.join(outDir, 'pc-1280.png'), fullPage: true });
    const L = await page.evaluate(probeLayout);
    traits.form = L.forms > 0 || L.inputs > 0; traits.list = L.lists > 0; traits.api = design || api > 0; // 설계 단계: 상태별 모습은 정본에 그려야 한다
    put('pageErrors', errors.length === 0, errors.length ? `${errors.length}건: ${errors.slice(0, 3).join(' · ')}` : '오류 없음');
    put('clip', L.clipped.length === 0, L.clipped.length ? `잘린 글자 ${L.clipped.length}곳: ${L.clipped.slice(0, 4).join(' · ')}` : `잘린 글자 없음${L.noTitle.length ? ` (말줄임에 전체 값 보기 없음 ${L.noTitle.length}곳: ${L.noTitle.slice(0, 3).join(' · ')})` : ''}`);
    put('overlap', L.overlap.length === 0, L.overlap.length ? `겹침 ${L.overlap.length}곳: ${L.overlap.slice(0, 3).join(' · ')}` : '겹침 없음');
    const small = await page.evaluate(probeTargets);
    put('target', small.length === 0, small.length ? `24px 미만이고 이웃과 가까움 ${small.length}개: ${small.slice(0, 4).join(' · ')}` : '24px 이상이거나 간격 예외(WCAG 2.5.8)');
    const lcp = await page.evaluate(() => window.__kedoviLcp || (performance.getEntriesByType('navigation')[0] || {}).domContentLoadedEventEnd || 0).catch(() => 0);
    put('perf', lcp ? (lcp <= 2500 ? true : null) : null, lcp ? `LCP ${Math.round(lcp)}ms (이 PC${mock ? ' · 목 응답' : ''} 기준, 참고)` : '측정 못 함');
    const axe = axeSource();
    if (axe) {
      await page.addScriptTag({ path: axe });
      const res = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] }));
      const v = res.violations || [];
      const label = v.filter((x) => /label|input-button-name|select-name|form-field/.test(x.id));
      put('axe', v.length === 0, v.length ? `위반 ${v.length}종 ${v.reduce((n, x) => n + x.nodes.length, 0)}곳: ${v.slice(0, 5).map((x) => `${x.id}(${x.nodes.length})`).join(' · ')}` : 'WCAG 2.2 AA 자동 규칙 위반 없음');
      put('axeLabel', label.length === 0, label.length ? `라벨 위반: ${label.map((x) => `${x.id}(${x.nodes.length})`).join(' · ')}` : '라벨 위반 없음');
      fs.writeFileSync(path.join(outDir, 'axe.json'), JSON.stringify(v.map((x) => ({ id: x.id, impact: x.impact, help: x.help, url: x.helpUrl, nodes: x.nodes.slice(0, 10).map((n) => n.target.join(' ')) })), null, 2));
    } else { put('axe', null, '미실행: axe-core 없음 (npm i -g axe-core)'); put('axeLabel', null, '미실행: axe-core 없음'); }
    // 키보드: Tab 으로 한 바퀴
    const n = await page.evaluate(focusables);
    const seen = []; const noRing = [];
    await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.scrollTo(0, 0); });
    for (let i = 0; i < Math.min(n + 5, 150); i++) {
      await page.keyboard.press('Tab');
      const f = await page.evaluate(focusNow);
      if (!f) continue;
      if (!seen.includes(f.i)) { seen.push(f.i); if (!f.ring) noRing.push(f.name); }
    }
    const miss = await page.evaluate(unreached, seen);
    put('keyboard', n === 0 ? true : miss.length === 0, n === 0 ? '조작 요소 없음' : miss.length ? `Tab 으로 닿지 않음 ${miss.length}개: ${miss.slice(0, 4).join(' · ')}` : `조작 요소 ${n}개 모두 닿음`);
    put('focusVisible', noRing.length === 0, noRing.length ? `포커스 표시 없음 ${noRing.length}개: ${noRing.slice(0, 4).join(' · ')}` : `포커스 표시 ${seen.length}개 확인`);
    await ctx.close();

    // 2) 폭: 768 · 390 · 리플로우 320 · 200% 확대(640)
    const widthRes = [];
    for (const [w, key] of [[768, 'tablet-768'], [390, 'phone-390'], [320, 'reflow-320'], [640, 'zoom-640']]) {
      const c2 = await newCtx(browser, a, { viewport: { width: w, height: 800 } }, mock);
      const p2 = await c2.newPage();
      await open(p2, url, a);
      await p2.screenshot({ path: path.join(outDir, `${key}.png`), fullPage: true });
      widthRes.push({ w, key, L: await p2.evaluate(probeLayout) });
      await c2.close();
    }
    const at = (w) => widthRes.find((x) => x.w === w).L;
    const wl = [768, 390].map((w) => `${w}px ${at(w).offenders.length ? `가로 넘침(${at(w).offenders.slice(0, 2).join(' · ')})` : '넘침 없음'}`);
    put('widths', [768, 390].every((w) => !at(w).offenders.length) ? null : false, `${wl.join(' · ')}. 배치는 스크린샷으로 확인`);
    put('reflow', at(320).offenders.length === 0, at(320).offenders.length ? `320px 가로 넘침: ${at(320).offenders.slice(0, 4).join(' · ')}` : `320px 가로 넘침 없음${at(320).over ? ' (표 · 스크롤 영역 안 넘침은 예외)' : ''}`);
    const z = at(640);
    put('zoom', z.offenders.length === 0 && z.clipped.length === 0, z.offenders.length || z.clipped.length ? `200% 에서 ${z.offenders.length ? `가로 넘침 ${z.offenders.slice(0, 2).join(' · ')}` : ''}${z.clipped.length ? ` 잘린 글자 ${z.clipped.slice(0, 2).join(' · ')}` : ''}` : '200% 에서 넘침 · 잘림 없음');

    // 3) 상태: 빈 값 · 오류 · 끊김 · 권한 없음 · 느림 (설계 단계 정적 프로토타입은 요청이 없어 해당 없음)
    if (design || !api) {
      for (const k of ['stateEmpty', 'stateError', 'stateOffline', 'stateForbidden', 'stateSlow']) put(k, design ? null : 'na', design ? '설계 단계: 이 상태의 모습 · 문구를 정본에 그렸는지 사람이 확인' : '서버 요청 없음');
    } else {
      const emptyBody = (body) => { try { const j = JSON.parse(body); const z = (v) => (Array.isArray(v) ? [] : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, z(x)])) : v); return JSON.stringify(z(j)); } catch { return '[]'; } };
      const states = {
        stateEmpty: async (route) => { const r = route.request(); if (r.method() !== 'GET') return route.fallback(); const m = mock && mock.routes && mock.routes.find((x) => new RegExp(x.url.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')).test(r.url())); return route.fulfill({ status: 200, contentType: 'application/json', body: m ? emptyBody(m.body) : '[]' }); },
        stateError: (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Internal Server Error"}' }),
        stateOffline: (route) => route.abort('internetdisconnected'),
        stateForbidden: (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Forbidden"}' }),
      };
      for (const [k, handler] of Object.entries(states)) {
        const c3 = await newCtx(browser, a, {}, mock);
        await c3.route('**/*', (route) => (/^(xhr|fetch)$/.test(route.request().resourceType()) && route.request().method() === 'GET' ? handler(route) : route.fallback()));
        const p3 = await c3.newPage();
        const errs = [];
        p3.on('pageerror', (e) => errs.push(String(e.message).slice(0, 60)));
        await open(p3, url, a);
        await p3.screenshot({ path: path.join(outDir, `${k}.png`), fullPage: true });
        const txt = await p3.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim());
        const hit = (txt.match(STATE_WORDS[k]) || [])[0];
        put(k, errs.length ? false : hit ? true : null, errs.length ? `페이지 오류로 멈춤: ${errs[0]}` : hit ? `안내 보임 (「${hit}」, 스크린샷 ${k}.png)` : `안내 문구를 찾지 못함: 스크린샷 ${k}.png 로 확인`);
        await c3.close();
      }
      const c4 = await newCtx(browser, a, {}, mock);
      await c4.route('**/*', async (route) => { if (/^(xhr|fetch)$/.test(route.request().resourceType()) && route.request().method() === 'GET') { await new Promise((ok) => setTimeout(ok, 4000)); return route.fallback(); } return route.fallback(); });
      const p4 = await c4.newPage();
      await p4.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await p4.waitForTimeout(1200);
      await p4.screenshot({ path: path.join(outDir, 'stateSlow.png'), fullPage: true });
      const busy = await p4.evaluate(busyShown).catch(() => false);
      put('stateSlow', busy ? true : null, busy ? '로딩 표시 보임 (stateSlow.png)' : '로딩 표시를 찾지 못함: 스크린샷 stateSlow.png 로 확인');
      await c4.close();
    }

    // 4) 중복 제출: 저장 요청을 늦게 답하고 제출을 두 번 누른다 (서버로는 보내지 않는다)
    if (!traits.form) put('doubleSubmit', 'na', '입력 양식 없음');
    else {
      const c5 = await newCtx(browser, a, {}, mock);
      const sent = [];
      await c5.route('**/*', async (route) => { const r = route.request(); if (/^(xhr|fetch)$/.test(r.resourceType()) && r.method() !== 'GET') { sent.push(`${r.method()} ${r.url()}`); await new Promise((ok) => setTimeout(ok, 1500)); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); } return route.fallback(); });
      const p5 = await c5.newPage();
      await open(p5, url, a);
      const btn = await p5.evaluate(() => {
        const b = [...document.querySelectorAll('button[type=submit],input[type=submit],form button:not([type])')].find((x) => x.getBoundingClientRect().width > 0 && !x.disabled);
        if (!b) return null;
        const f = b.form || b.closest('form') || document;
        for (const el of f.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]),textarea')) {
          if (el.value || el.readOnly || el.disabled) continue;
          const t = (el.type || 'text').toLowerCase();
          const v = t === 'email' ? 'qa@example.com' : t === 'number' ? '1' : t === 'tel' ? '01012345678' : t === 'url' ? 'https://example.com' : t === 'date' ? '2026-01-01' : t === 'password' ? 'Passw0rd!' : '점검';
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; setter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        for (const s of f.querySelectorAll('select')) if (!s.value && s.options.length > 1) { s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); }
        for (const c of f.querySelectorAll('input[type=checkbox][required]')) if (!c.checked) c.click();
        b.dataset.kedoviSubmit = '1';
        return true;
      });
      if (!btn) put('doubleSubmit', null, '제출 버튼을 찾지 못함: 사람이 확인');
      else {
        const b = p5.locator('[data-kedovi-submit="1"]').first();
        await b.click({ timeout: 3000 }).catch(() => {});
        await b.click({ timeout: 1000, force: true }).catch(() => {});
        await p5.waitForTimeout(2500);
        const same = sent.filter((x) => x === sent[0]).length;
        put('doubleSubmit', sent.length === 0 ? null : same <= 1, sent.length === 0 ? '저장 요청이 나가지 않음 (입력 검증에 막혔을 수 있음): 사람이 확인' : same > 1 ? `두 번 눌러 같은 요청 ${same}번: ${sent[0]}` : `요청 1번 (${sent[0]})`);
      }
      await c5.close();
    }
  } finally { await browser.close(); }

  // 5) 브라우저 3종 · 모바일 2종
  const engines = [];
  for (const kind of ['chromium', 'firefox', 'webkit']) {
    const b = await launch(pw, kind);
    if (!b) { engines.push({ kind, ok: null }); continue; }
    try {
      const c = await newCtx(b, a, {}, mock); const p = await c.newPage(); const errs = [];
      p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 60)));
      await open(p, url, a);
      await p.screenshot({ path: path.join(outDir, `browser-${kind}.png`), fullPage: true });
      engines.push({ kind, ok: errs.length === 0, err: errs[0] });
    } catch (e) { engines.push({ kind, ok: false, err: e.message.slice(0, 60) }); } finally { await b.close(); }
  }
  const miss = engines.filter((e) => e.ok === null).map((e) => e.kind);
  const bad = engines.filter((e) => e.ok === false);
  put('browsers', bad.length ? false : miss.length ? null : true, `${engines.map((e) => `${e.kind} ${e.ok === null ? '없음' : e.ok ? '정상' : `오류(${e.err})`}`).join(' · ')}${miss.length ? ` · 받기: npx playwright install ${miss.join(' ')}` : ''}`);
  const mob = [];
  for (const [dev, kind, label] of [['Pixel 7', 'chromium', 'Android'], ['iPhone 14', 'webkit', 'iOS']]) {
    let engine = kind;
    let b = await launch(pw, kind);
    if (!b && kind !== 'chromium') { b = await launch(pw, 'chromium'); engine = 'chromium'; }
    if (!b) { mob.push(`${label} 못 띄움`); continue; }
    try {
      const d = { ...(pw.devices[dev] || {}) }; if (engine !== kind) delete d.defaultBrowserType;
      const c = await newCtx(b, a, d, mock); const p = await c.newPage();
      await open(p, url, a);
      await p.screenshot({ path: path.join(outDir, `mobile-${label}.png`), fullPage: true });
      const L = await p.evaluate(probeLayout);
      mob.push(`${label}(${dev}${engine !== kind ? ', WebKit 없어 Chromium 으로' : ''}) ${L.offenders.length ? '가로 넘침' : '넘침 없음'}`);
    } catch (e) { mob.push(`${label} 오류 ${e.message.slice(0, 40)}`); } finally { await b.close(); }
  }
  put('mobile', mob.some((x) => /가로 넘침|오류/.test(x)) ? false : null, `${mob.join(' · ')}. 터치 · 배치는 스크린샷으로 확인`);
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify({ url, at: new Date().toISOString(), traits, results: R }, null, 2));
  return { results: R, traits };
}

/** 사용성 평가 결과서에 이 화면이 들었나 */
function usabilityDoc(ws, id) {
  const file = path.join(ws.root, 'docs-site', '테스트', '사용성-평가.md');
  if (!fs.existsSync(file)) return { pass: null, text: '결과서 없음 (kedovi screens usability)' };
  const t = fs.readFileSync(file, 'utf8');
  return t.includes(id) ? { pass: null, text: `결과서에 ${id} 있음: 평가 결과를 보고 판정` } : { pass: null, text: `결과서에 ${id} 가 든 과업 없음` };
}

/** 점검표 만들기 · 합치기 · 자동 결과 넣기 */
function merge(ws, id, { level, traits, results, measured, design = false }) {
  const file = findQuality(ws, id, design) || qualityPath(ws, id, design);
  const old = fs.existsSync(file) ? readQuality(file).rows : [];
  const oldBy = new Map(old.map((r) => [r.id, r]));
  const items = itemsFor(level, traits);
  const AUTO = /^(통과|실패|해당 없음)\s*\(자동/;
  const rows = items.map((it) => {
    const prev = oldBy.get(it.id);
    oldBy.delete(it.id);
    let auto = prev ? prev.auto : '';
    let verdict = prev ? prev.verdict : '';
    const res = it.auto === 'usabilityDoc' ? usabilityDoc(ws, id) : results && it.auto ? results[it.auto] : null;
    if (res) {
      auto = res.text;
      if (!verdict || AUTO.test(verdict)) verdict = res.pass === true ? '통과 (자동)' : res.pass === false ? `실패 (자동: ${res.text})` : res.pass === 'na' ? `해당 없음 (자동: ${res.text})` : AUTO.test(verdict) ? '' : verdict;
    }
    return { id: it.id, area: it.area, title: it.title, need: it.need, how: it.how, ref: it.ref, auto, verdict };
  });
  for (const r of oldBy.values()) if (r.verdict) rows.push(r); // 사람이 판정한 줄은 수준이 바뀌어도 남긴다
  const L = catalog().levels[level];
  const prevHead = fs.existsSync(file) ? readQuality(file).head['자동 측정'] : '';
  writeQuality(file, { id, level, basis: L.basis, measured: measured || prevHead, rows, design });
  return file;
}

function printCheck(ws, id, ck) {
  const rel = path.relative(ws.root, ck.file);
  const list = (xs) => xs.slice(0, 8).map((r) => `${r.id} ${r.title}`).join(' · ') + (xs.length > 8 ? ` 외 ${xs.length - 8}개` : '');
  console.log(`${ck.req.fail.length || ck.req.empty.length || ck.req.bad.length ? '✖' : '✔'} ${id} 화면 품질: 필수 ${ck.req.ok.length}/${ck.req.total} 통과 · 권장 ${ck.rec.ok.length}/${ck.rec.total} (${rel})`);
  if (ck.req.fail.length) console.log(`  ✖ 실패 ${ck.req.fail.length}개: ${list(ck.req.fail)}`);
  if (ck.req.empty.length) console.log(`  ✖ 판정 없음 ${ck.req.empty.length}개: ${list(ck.req.empty)}`);
  if (ck.req.bad.length) console.log(`  ✖ 판정 모양이 틀림 ${ck.req.bad.length}개 (통과 · 실패 (내용) · 해당 없음 (이유) · 예외 (결정 ID)): ${list(ck.req.bad)}`);
  const recLeft = [...ck.rec.fail, ...ck.rec.empty];
  if (recLeft.length) console.log(`  ⚠ 권장 남음 ${recLeft.length}개: ${list(recLeft)}`);
}

async function runOne(ws, id, a) {
  const level = levelOf(ws);
  let results = null; let traits = traitsFromChecklist(ws, id); let measured = '';
  if (!a['no-run']) {
    let target; let mock = null;
    try {
      target = a.design ? C.findPrototype(ws, id, a) : C.findImpl(ws, id, a);
      if (!a.design) mock = C.loadMock(ws, a);
    } catch (e) { console.error(`✖ ${e.message}\n  자동 측정 없이 점검표만: kedovi screens quality ${id} --no-run`); return 1; }
    const pw = C.loadPlaywright();
    if (!pw) { console.error('✖ playwright 를 찾지 못했습니다. npm i -g playwright && npx playwright install chromium firefox webkit\n  자동 측정 없이 점검표만: --no-run'); return 2; }
    const outDir = path.join(ws.root, '.agents', 'screens', safeId(id), a.design ? 'quality-design' : 'quality');
    console.log(`… ${id} ${a.design ? '정본(설계)' : '구현'} 측정: ${target.url}`);
    let r;
    try { r = await measure(pw, target.url, a, mock, outDir, { design: !!a.design }); } catch (e) { console.error(`✖ 측정 실패: ${e.message}`); return 2; }
    results = r.results;
    traits = traits ? { form: traits.form || r.traits.form, list: traits.list || r.traits.list, api: r.traits.api } : r.traits;
    measured = `${today()} · ${a.design ? '정본(설계)' : '구현'} ${target.url} · 스크린샷 · 결과 \`${path.relative(ws.root, outDir)}/\``;
  }
  const file = merge(ws, id, { level, traits, results, measured, design: !!a.design });
  const ck = checkQuality(file);
  printCheck(ws, id, ck);
  if (a.design) console.log('  설계 단계: 실패 · 판정 없음은 정본(프로토타입 · 화면설계서)에서 고치거나 그린다 (상태별 모습 · 오류 문구 · 라벨 · 누르는 영역). 구현 뒤에는 --design 없이 다시 돌린다');
  return ck.req.fail.length || ck.req.empty.length || ck.req.bad.length ? 1 : 0;
}

function screenIdsOf(ws) {
  const ids = new Set();
  try { for (const x of require('./screens-inventory.js').screenIds(ws)) ids.add(x); } catch { /* 없음 */ }
  const hd = path.join(ws.root, 'handoffs');
  let people = [];
  try { people = fs.readdirSync(hd); } catch { /* 없음 */ }
  for (const who of people) { try { for (const f of fs.readdirSync(path.join(hd, who, 'screens'))) { const m = /^(.+?)(\.quality|\.quality-design)?\.md$/.exec(f); if (m) ids.add(m[1]); } } catch { /* 폴더 아님 · 화면 없음 */ } }
  return [...ids].sort();
}

async function audit(ws, a) {
  const ids = screenIdsOf(ws);
  if (!ids.length) { console.log('화면 ID 를 찾지 못했습니다 (화면 목록 · 요소 체크리스트 없음). kedovi screens locate 로 화면 폴더를 정한다'); return 0; }
  const rows = [];
  for (const id of ids) {
    if (a.run) await runOne(ws, id, a).catch(() => 1);
    else if (!findQuality(ws, id, !!a.design)) merge(ws, id, { level: levelOf(ws), traits: traitsFromChecklist(ws, id), results: null, measured: '', design: !!a.design });
    const f = findQuality(ws, id, !!a.design);
    if (!f) continue;
    const ck = checkQuality(f);
    rows.push({ id, level: levelOf(ws), req: `${ck.req.ok.length}/${ck.req.total}`, fail: ck.req.fail.length, empty: ck.req.empty.length + ck.req.bad.length, rec: ck.rec.fail.length + ck.rec.empty.length, measured: ck.measured, file: path.relative(ws.root, f), done: !ck.req.fail.length && !ck.req.empty.length && !ck.req.bad.length });
  }
  if (a.json) { console.log(JSON.stringify(rows, null, 2)); return rows.some((r) => !r.done) ? 1 : 0; }
  const L = catalog().levels[levelOf(ws)];
  console.log(`화면 품질 전체 점검${a.design ? ' (설계 단계: 정본)' : ''} · 수준 ${L.label} (${L.basis})\n`);
  console.log('| 화면 | 필수 통과 | 실패 | 판정 없음 | 권장 남음 | 자동 측정 |\n|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.id} | ${r.req} | ${r.fail} | ${r.empty} | ${r.rec} | ${r.measured ? '함' : '안 함'} |`);
  const done = rows.filter((r) => r.done).length;
  console.log(`\n완료 ${done}/${rows.length}개 화면${rows.some((r) => !r.measured) ? ` · 자동 측정 안 한 화면은 kedovi screens audit --run (또는 화면마다 kedovi screens quality <화면 ID>)` : ''}`);
  return done === rows.length ? 0 : 1;
}

function setLevel(ws, v) {
  const L = catalog().levels;
  if (!v) { const cur = levelOf(ws); console.log(`화면 품질 수준: ${L[cur].label} (${cur})\n  기준: ${L[cur].basis}\n  바꾸기: kedovi screens quality-level ${LEVELS.join('|')} (공공 사업 · 일반 서비스 · 사내 도구)`); return 0; }
  if (!LEVELS.includes(v)) { console.error(`✖ 수준은 ${LEVELS.join(' · ')} 가운데 하나`); return 1; }
  const f = path.join(ws.root, 'workspace.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.vars = j.vars || {}; j.vars.screens = { ...(j.vars.screens || {}), quality: v };
  fs.writeFileSync(f, `${JSON.stringify(j, null, 2)}\n`);
  console.log(`✔ 화면 품질 수준: ${L[v].label} (workspace.json vars.screens.quality, 커밋하면 팀 적용)\n  기준: ${L[v].basis}\n  이미 만든 점검표는 kedovi screens audit 로 다시 맞춘다`);
  return 0;
}

function usability(ws) {
  const file = path.join(ws.root, 'docs-site', '테스트', '사용성-평가.md');
  if (fs.existsSync(file)) { console.log(`이미 있습니다: ${path.relative(ws.root, file)}`); return 0; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(PACKS, 'screens', 'assets', 'quality', 'usability.md'), file);
  console.log(`✔ 사용성 평가 결과서 뼈대: ${path.relative(ws.root, file)}\n  과업은 기능 문서(docs-site/기능/)의 주요 흐름에서 고르고, 과업마다 화면 ID 를 적는다 (화면 품질 Q-U1 이 그 ID 로 찾는다)`);
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const a = C.parseArgs(argv.slice(1));
  let ws;
  try { ws = require(path.join(PACKS, 'core', 'lib', 'workspace.js')).load(path.resolve(PACKS, '..')); } catch (e) { console.error(`✖ workspace.json 을 읽지 못했습니다. ${e.message}`); process.exit(1); }
  if (sub === 'quality-level') process.exit(setLevel(ws, a._[0]));
  if (sub === 'usability') process.exit(usability(ws));
  if (sub === 'audit') process.exit(await audit(ws, a));
  if (sub !== 'quality' || !a._.length || a.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 10).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    process.exit(sub ? 1 : 0);
  }
  process.exit(await runOne(ws, a._[0], a));
}

if (require.main === module) main().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
module.exports = { catalog, itemsFor, verdictKind, levelOf, qualityPath, findQuality, readQuality, checkQuality, merge, measure, probeLayout, screenIdsOf, LEVELS };
