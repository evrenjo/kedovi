#!/usr/bin/env node
// 화면 정본 판정 · 정본 요소 체크리스트: 화면 개발 착수 전에 정본(프로토타입 · 화면설계서)을 정하고, 정본의 영역별 요소를 체크리스트로 만든다. 실행: kedovi screens inventory|checklist|review <화면 ID>
/*
 * kedovi screens inventory <화면 ID> [--proto 파일|주소] [--canon prototype|storyboard] [--force] [--print]   정본 판정 + 요소 체크리스트 (handoffs/<나>/screens/<화면 ID>.md, 있으면 판정 칸을 살려 합친다). --canon 은 둘 다 있을 때 사용자가 고른 정본
 * kedovi screens checklist <화면 ID> [--start] [--md]   착수 전(--start: 원천 빈 칸 · 원천 없음) · 완료 전(판정 빈 칸 · 비교 미실행) 점검, --md 는 MR 본문용 표
 * kedovi screens review <화면 ID…>   리뷰 지시서에 넣을 정본 대조 블록 (정본 경로 · 체크리스트 · 비교 스크린샷 · 블로커 기준)
 * 정본 순서: 프로토타입 있음 → 프로토타입 · 화면설계서만 → 화면설계서 · 둘 다(요소가 다름) → 묻기 · 둘 다 없음 → 묻기
 * 끝 코드: 0 = 정상 · 1 = 화면 ID 없음 · 점검 실패 · 3 = 사용자 결정 필요(둘 다 있고 다를 수 있음 · 둘 다 없음)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const C = require('./compare-screens.js');

const PACKS = path.resolve(__dirname, '..', '..');
const SCREEN_DIRS = ['30-screens', '02-screens'];

// ── HTML → 나무 (의존성 없이: 화면 요소를 세는 데 필요한 만큼만) ──
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const SKIP = new Set(['script', 'style', 'noscript', 'head', 'title']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };
const unent = (s) => String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m)));

function parseAttrs(s) {
  const out = {};
  for (const m of String(s).matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] = unent(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

function parseHtml(html) {
  const rootNode = { tag: '#root', attrs: {}, children: [] };
  const stack = [rootNode];
  const src = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) { if (!SKIP.has(top.tag)) top.children.push({ text: unent(m[4]) }); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const node = { tag, attrs: parseAttrs(m[3]), children: [], parent: top };
    top.children.push(node);
    if (SKIP.has(tag)) {
      const end = src.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      re.lastIndex = end < 0 ? src.length : end;
      continue;
    }
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) stack.push(node);
  }
  return rootNode;
}

const textOf = (n) => (n.text !== undefined ? n.text : SKIP.has(n.tag) ? '' : n.children.map(textOf).join(' '));
const clean = (s, max = 40) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const cls = (n) => ` ${String((n.attrs && n.attrs.class) || '')} `;
const hasCls = (n, re) => re.test(cls(n));
function* walkNodes(n) { for (const c of n.children || []) { if (c.tag) { yield c; yield* walkNodes(c); } } }
const find = (n, pred) => { for (const c of walkNodes(n)) if (pred(c)) return c; return null; };

// ── 요소 고르기 ──
const REGION_TAG = { section: '구역', aside: '옆 패널', article: '글', nav: '메뉴', header: '머리', footer: '바닥', main: '본문', form: '입력 양식', dialog: '대화상자' };
const REGION_CLS = /[\s_-](card|panel|widget|pane|sidebar|drawer|modal)[\s_-]/i;
const CHIP_CLS = /[\s_-](chip|badge|pill|status|tag|label-status)[\s_-]/i;
const VALUE_CLS = /[\s_-](stat|kpi|metric|summary-item|info-item|figure|tile)[\s_-]/i;
const CHART_CLS = /(chart|graph|spark|candle)/i;

/** 영역 이름: data-area · aria-label · 자기 제목(안쪽 영역의 제목은 보지 않는다) · 이름 없는 aside 같은 태그 이름. 이름이 없으면 '' (영역으로 세지 않는다) */
function regionLabel(n) {
  const a = n.attrs || {};
  if (a['data-area'] || a['data-region']) return clean(a['data-area'] || a['data-region']);
  if (a['aria-label']) return clean(a['aria-label']);
  const own = (x) => {
    for (const c of x.children || []) {
      if (!c.tag) continue;
      if (/^h[1-4]$/.test(c.tag) || hasCls(c, /[\s_-](title|head|header)[\s_-]/i)) { const t = clean(textOf(c), 30); if (t) return t; }
      if (isRegion(c)) continue;
      const t = own(c);
      if (t) return t;
    }
    return '';
  };
  return own(n) || ({ aside: '옆 패널', nav: '메뉴', header: '머리', footer: '바닥', dialog: '대화상자' }[n.tag] || '');
}

function isRegion(n) {
  const a = n.attrs || {};
  if (a['data-area'] || a['data-region']) return true;
  if (REGION_TAG[n.tag] || /^(region|dialog|tabpanel|complementary)$/.test(a.role || '')) return true;
  return REGION_CLS.test(cls(n)) && !!find(n, (c) => /^h[1-6]$/.test(c.tag) || hasCls(c, /[\s_-](title|head|header)[\s_-]/i));
}

/** 요소 하나: { kind, label } 또는 null */
function itemOf(n) {
  const a = n.attrs || {};
  const t = () => clean(textOf(n)) || clean(a['aria-label'] || a.title || a.alt || a.value || a.placeholder || a.name || a.id || '');
  if (a['data-el']) return { kind: a['data-kind'] || '요소', label: clean(a['data-el']) };
  if (/^h[1-4]$/.test(n.tag)) return { kind: '제목', label: t() };
  if (n.tag === 'button' || a.role === 'button' || (n.tag === 'input' && /^(button|submit|reset)$/i.test(a.type || '')) || hasCls(n, /[\s_-](btn|button|wf-btn)[\s_-]/i)) return { kind: '버튼', label: t() };
  if (n.tag === 'a' && (a.href !== undefined) || hasCls(n, /[\s]wf-link[\s]/)) return { kind: '링크', label: t() };
  if (n.tag === 'select') return { kind: '선택', label: clean(a['aria-label'] || a.name || a.id || (find(n, (c) => c.tag === 'option') ? textOf(find(n, (c) => c.tag === 'option')) : '')) };
  if ((n.tag === 'input' && !/^hidden$/i.test(a.type || '')) || n.tag === 'textarea' || hasCls(n, /[\s]wf-input[\s]/)) {
    const prev = n.parent && n.parent.children.filter((c) => c.tag)[n.parent.children.filter((c) => c.tag).indexOf(n) - 1];
    const lab = prev && (prev.tag === 'label' || hasCls(prev, /[\s](wf-label|label)[\s]/)) ? clean(textOf(prev)) : '';
    return { kind: '입력', label: lab || clean(a['aria-label'] || a.placeholder || a.name || a.id || textOf(n)) };
  }
  if (n.tag === 'table' || hasCls(n, /[\s]wf-table[\s]/)) {
    const cap = find(n, (c) => c.tag === 'caption');
    const ths = [...walkNodes(n)].filter((c) => c.tag === 'th').map((c) => clean(textOf(c), 12)).filter(Boolean);
    return { kind: '표', label: cap ? clean(textOf(cap)) : ths.length ? `열: ${ths.slice(0, 6).join(' · ')}${ths.length > 6 ? ' …' : ''}` : '표' };
  }
  if (n.tag === 'canvas' || CHART_CLS.test(cls(n)) || CHART_CLS.test(a.id || '')) return { kind: '차트', label: clean(a['aria-label'] || a.title || a.id || textOf(n)) || '차트' };
  if (n.tag === 'svg' && (Number(a.width) >= 80 || Number(a.height) >= 60 || /chart|graph/i.test(cls(n)))) return { kind: '차트', label: clean(a['aria-label'] || a.id || '') || '그림' };
  if (n.tag === 'img' || hasCls(n, /[\s]wf-img[\s]/)) return { kind: '이미지', label: clean(a.alt || textOf(n)) || '이미지' };
  if (hasCls(n, /[\s]wf-bar[\s]/) || n.tag === 'progress' || n.tag === 'meter') return { kind: '막대', label: t() || '막대' };
  if (CHIP_CLS.test(cls(n))) return { kind: '상태 칩', label: t() };
  if (VALUE_CLS.test(cls(n)) || n.tag === 'dt') return { kind: '값', label: t() };
  return null;
}

/** 나무에서 요소 목록 [{ area, kind, label, n }] (영역 = 안쪽 두 단계 이름) */
function extract(tree, { areaMarkers = false } = {}) {
  const explicit = !!find(tree, (c) => c.attrs && c.attrs['data-el']);
  const items = [];
  let marked = '';   // 화면설계서: .area-label 이 뒤 요소의 영역 이름
  const markers = {};
  const visit = (n, areas) => {
    for (const c of n.children || []) {
      if (!c.tag) continue;
      if (areaMarkers && hasCls(c, /[\s]area-label[\s]/)) { marked = clean(textOf(c), 30); continue; }
      if (areaMarkers && hasCls(c, /[\s]mk[\s]/)) { markers[clean(textOf(c))] = marked || areas[areas.length - 1] || ''; continue; }
      if (hasCls(c, /[\s](screen-meta|band|foot)[\s]/)) continue;
      let next = areas;
      if (isRegion(c)) { const label = regionLabel(c); if (label) next = [...areas, label]; }
      const it = explicit ? (c.attrs['data-el'] ? itemOf(c) : null) : itemOf(c);
      if (it && it.label !== undefined) {
        const area = (areaMarkers && marked) ? marked : (next.slice(-2).join(' > ') || '화면');
        // 영역 이름으로 쓴 제목은 요소로 다시 세지 않는다
        if (!(it.kind === '제목' && next.length && next[next.length - 1] === it.label)) items.push({ area, kind: it.kind, label: it.label || '(이름 없음)' });
        if (!/^(차트|이미지)$/.test(it.kind)) continue;   // 요소 안쪽은 더 세지 않는다
      }
      visit(c, next);
    }
  };
  visit(tree, []);
  // 같은 영역 · 종류 · 이름은 한 줄 (×개수)
  const seen = new Map();
  for (const it of items) {
    const k = `${it.area}|${it.kind}|${it.label}`;
    if (seen.has(k)) seen.get(k).count += 1; else seen.set(k, { ...it, count: 1 });
  }
  return { items: [...seen.values()], markers, explicit };
}

// ── 정본 찾기 ──
function screenDirs(ws) {
  const out = [];
  for (const r of (ws.repos || []).filter((x) => x.kind === 'docs')) for (const d of SCREEN_DIRS) out.push({ repo: r, dir: path.join(r.dir, d), exists: fs.existsSync(path.join(r.dir, d)) });
  return out;
}

/** 화면설계서 장: 화면 폴더(prototype/ 밖)의 .html 중 <section … id="<화면 ID>"> 가 든 파일 */
function findStoryboard(ws, id) {
  const re = new RegExp(`<section\\b[^>]*\\bid\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);
  for (const d of screenDirs(ws).filter((x) => x.exists)) {
    const files = walkFiles(d.dir).filter((f) => /\.html?$/i.test(f) && !/[\\/]prototype[\\/]/.test(path.relative(d.dir, f)) && !/^_/.test(path.basename(f)));
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      if (re.test(text)) return { file: f, rel: path.relative(ws.root, f) };
    }
  }
  return null;
}

function walkFiles(dir, depth = 4, out = []) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth > 0) walkFiles(p, depth - 1, out); } else out.push(p);
  }
  return out;
}

/** 화면 목록 표의 화면 ID 전부 + 화면설계서 장 ID (커밋 훅 · 리뷰 지시서가 화면 ID 를 알아본다) */
function screenIds(ws) {
  const ids = new Set();
  for (const d of screenDirs(ws).filter((x) => x.exists)) {
    let md = '';
    try { md = fs.readFileSync(path.join(d.dir, 'README.md'), 'utf8'); } catch { /* 없음 */ }
    let inList = false;
    for (const l of md.split('\n')) {
      if (/^\s*\|/.test(l)) {
        const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/[`*]/g, ''));
        if (/^화면\s*ID$/.test(cells[0])) { inList = true; continue; }
        if (inList && /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/.test(cells[0])) ids.add(cells[0]);
      } else inList = false;
    }
    for (const f of walkFiles(d.dir).filter((x) => /\.html?$/i.test(x) && !/[\\/]prototype[\\/]/.test(path.relative(d.dir, x)) && !/^_/.test(path.basename(x)))) {
      let text = '';
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      for (const m of text.matchAll(/<section\b[^>]*\bclass\s*=\s*["'][^"']*\bsheet\b[^"']*["'][^>]*\bid\s*=\s*["']([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)["']|<section\b[^>]*\bid\s*=\s*["']([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)["'][^>]*\bclass\s*=\s*["'][^"']*\bsheet\b/g)) ids.add(m[1] || m[2]);
    }
  }
  return [...ids];
}

/** 정본 판정: { id, prototype, storyboard, verdict, note } */
function canonOf(ws, id, a = {}) {
  let prototype = null; let protoError = '';
  try { prototype = C.findPrototype(ws, id, a); } catch (e) { protoError = e.message; }
  // 화면 목록에 적었는데 파일이 없는 것은 「없음」 이 아니라 고칠 일이다
  if (!prototype && /칸 「/.test(protoError)) throw new Error(protoError);
  const storyboard = findStoryboard(ws, id);
  const verdict = prototype && storyboard ? 'both' : prototype ? 'prototype' : storyboard ? 'storyboard' : 'none';
  return { id, prototype, storyboard, verdict, searched: screenDirs(ws).map((d) => `${path.relative(ws.root, d.dir)}${d.exists ? '' : ' (없음)'}`) };
}

// ── 정본에서 요소 뽑기 ──
async function renderPrototype(url) {
  const pw = C.loadPlaywright ? C.loadPlaywright() : null;
  if (!pw) return null;
  let browser;
  try { browser = await pw.chromium.launch(); } catch { try { browser = await pw.chromium.launch({ channel: 'chrome' }); } catch { return null; } }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => { if (!/Timeout/i.test(e.message)) throw e; });
    return await page.content();
  } catch { return null; } finally { await browser.close(); }
}

async function prototypeItems(proto) {
  let html = await renderPrototype(proto.url);
  let how = '브라우저로 그린 화면';
  if (html == null) {
    if (!/^file:/.test(proto.url)) return { items: [], how: '읽지 못함', warn: `프로토타입 ${proto.url} 을 열지 못했습니다 (Playwright 없음 · 주소 열기 실패). 파일 경로로 주거나 Playwright 를 설치한다` };
    try { html = fs.readFileSync(fileURLToPath(proto.url.split('#')[0]), 'utf8'); } catch (e) { return { items: [], how: '읽지 못함', warn: e.message }; }
    how = '파일 그대로 (Playwright 없음: 스크립트가 그리는 요소는 빠질 수 있다)';
  }
  const tree = parseHtml(html);
  const body = find(tree, (n) => n.tag === 'body') || tree;
  const r = extract(body);
  return { items: r.items, how: r.explicit ? `${how} · data-el 표시만` : how };
}

function storyboardItems(sb, id) {
  const html = fs.readFileSync(sb.file, 'utf8');
  const tree = parseHtml(html);
  const sheet = find(tree, (n) => n.tag === 'section' && n.attrs.id === id);
  if (!sheet) return { items: [] };
  const canvas = find(sheet, (n) => hasCls(n, /[\s]canvas[\s]/)) || sheet;
  const r = extract(canvas, { areaMarkers: true });
  // 설명(Description) 항목: 마커 번호의 영역으로
  const desc = find(sheet, (n) => n.tag === 'ol' && hasCls(n, /[\s]desc[\s]/));
  const items = r.items.filter((x) => x.kind !== '값' || x.label);
  if (desc) {
    desc.children.filter((c) => c.tag === 'li').forEach((li, i) => {
      const first = clean((li.children.find((c) => c.tag === 'div') || li).children.filter((c) => c.text !== undefined || (c.tag && c.tag !== 'ul')).map(textOf).join(' '), 60);
      if (first) items.push({ area: r.markers[String(i + 1)] || '화면', kind: `설명 ${i + 1}`, label: first, count: 1 });
    });
  }
  return { items };
}

const norm = (s) => String(s || '').toLowerCase().replace(/[\s·・,.:;()\[\]{}<>"'`~!?_-]+/g, '');

/** 둘 다 있을 때: 이름이 한쪽에만 있는 요소 (제목 · 설명 제외) */
function diffItems(protoItems, sbItems) {
  const named = (xs) => xs.filter((x) => !/^(제목|설명)/.test(x.kind) && x.label && !/^\(이름 없음\)$|^(표|차트|그림|이미지|막대)$/.test(x.label));
  const p = named(protoItems); const s = named(sbItems);
  const has = (xs, y) => xs.some((x) => { const a = norm(x.label); const b = norm(y.label); return a && b && (a.includes(b) || b.includes(a)); });
  return [...s.filter((y) => !has(p, y)).map((y) => ({ ...y, only: '화면설계서' })), ...p.filter((y) => !has(s, y)).map((y) => ({ ...y, only: '프로토타입' }))];
}

// ── 체크리스트 파일 ──
function me(ws) { return require(path.join(PACKS, 'core', 'lib', 'workspace.js')).devId(ws.root) || 'me'; }
const safeId = (id) => id.replace(/[^\w.-]/g, '_');
function checklistPath(ws, id, who) { return path.join(ws.root, 'handoffs', who || me(ws), 'screens', `${safeId(id)}.md`); }
/** 누가 만들었든 이 화면의 체크리스트 (내 것 먼저) */
function findChecklist(ws, id) {
  const mine = checklistPath(ws, id);
  if (fs.existsSync(mine)) return mine;
  let people = [];
  try { people = fs.readdirSync(path.join(ws.root, 'handoffs'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* 없음 */ }
  for (const p of people) { const f = checklistPath(ws, id, p); if (fs.existsSync(f)) return f; }
  return null;
}

const COLS = ['영역', '요소', '종류', '상태(빈 값 · 오류 · 로딩)', '데이터 원천', '판정'];
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function readChecklist(file) {
  const text = fs.readFileSync(file, 'utf8');
  const head = {};
  for (const m of text.matchAll(/^- (정본|화면설계서|프로토타입|비교|만든 때):\s*(.*)$/gm)) head[m[1]] = m[2].trim();
  const rows = [];
  let inTable = false;
  for (const l of text.split('\n')) {
    if (!/^\s*\|/.test(l)) { inTable = false; continue; }
    const cells = l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
    if (cells[0] === '영역' && cells[1] === '요소') { inTable = true; continue; }
    if (!inTable || /^:?-+:?$/.test(cells[0])) continue;
    rows.push({ area: cells[0] || '', label: cells[1] || '', kind: cells[2] || '', state: cells[3] || '', source: cells[4] || '', verdict: cells[5] || '' });
  }
  return { text, head, rows };
}

function writeChecklist(file, c, rows) {
  const lines = [
    `# ${c.id} 화면 요소 체크리스트`,
    '',
    `- 정본: ${c.canonLine}`,
    `- 화면설계서: ${c.storyboard ? `\`${c.storyboard.rel}\`` : '없음'}`,
    `- 프로토타입: ${c.prototype ? `\`${c.prototype.from ? (path.isAbsolute(c.prototype.from) ? path.relative(c.root, c.prototype.from) : c.prototype.from) : c.prototype.url}\`` : '없음'}`,
    `- 비교: ${c.compare || '미실행'}`,
    `- 만든 때: ${new Date().toISOString().slice(0, 10)} · kedovi screens inventory ${c.id} (${c.how})`,
    '',
    '착수 전에 「데이터 원천」 을 채운다 (API · 필드 · 계산). 원천이 없으면 `없음` 이라 적고 착수 전에 사용자에게 알린다.',
    '완료 전에 「판정」 을 모두 채운다: `구현` · `다름 (이유)` · `뺌 (결정 ID)`. 판정 없는 요소가 남으면 완료가 아니다. 상태 칸은 정본에 있는 빈 값 · 오류 · 로딩 모양.',
    '',
    `| ${COLS.join(' | ')} |`,
    `|${COLS.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${[r.area, r.label, r.kind, r.state, r.source, r.verdict].map(cell).join(' | ')} |`),
    '',
  ];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join('\n'));
}

/** 판정 칸이 맞는 모양인가: 구현 · 다름 (이유) · 뺌 (결정 ID) */
function verdictOk(v) {
  const t = String(v || '').trim();
  if (/^구현(\s|$|[(（])/.test(t)) return true;
  if (/^다름\s*[(（].*\S.*[)）]/.test(t)) return true;
  if (/^뺌\s*[(（].*[A-Z][A-Z0-9]*-[\w-]+.*[)）]/.test(t)) return true;
  return false;
}

/** 체크리스트 점검: { file, rows, missingVerdict, badVerdict, noSource, emptySource, compare } */
function checkChecklist(file) {
  const c = readChecklist(file);
  return {
    file, head: c.head, rows: c.rows,
    empty: !c.rows.length,
    missingVerdict: c.rows.filter((r) => !r.verdict.trim()),
    badVerdict: c.rows.filter((r) => r.verdict.trim() && !verdictOk(r.verdict)),
    emptySource: c.rows.filter((r) => !r.source.trim()),
    noSource: c.rows.filter((r) => /^(없음|원천 없음)/.test(r.source.trim())),
    compareDone: !!c.head['비교'] && !/^미실행/.test(c.head['비교']),
  };
}

/** compare 가 찍은 뒤 체크리스트의 「비교:」 줄을 고친다 */
function recordCompare(ws, id, html) {
  const f = findChecklist(ws, id);
  if (!f) return null;
  const text = fs.readFileSync(f, 'utf8');
  const line = `- 비교: \`${path.isAbsolute(html) ? html : path.resolve(html)}\` (${new Date().toISOString().slice(0, 10)} kedovi screens compare)`;
  fs.writeFileSync(f, /^- 비교:.*$/m.test(text) ? text.replace(/^- 비교:.*$/m, line) : text.replace(/^(- 정본:.*)$/m, `$1\n${line}`));
  return f;
}

// ── 리뷰 지시서 블록 ──
function reviewBlock(ws, ids) {
  const out = [];
  for (const id of ids) {
    let c;
    try { c = canonOf(ws, id); } catch (e) { out.push(`## 화면 정본 대조: ${id}\n\n- 정본을 찾지 못함: ${e.message}`); continue; }
    const f = findChecklist(ws, id);
    const ck = f ? checkChecklist(f) : null;
    const canon = c.verdict === 'prototype' || c.verdict === 'both' ? `프로토타입 \`${c.prototype.from && path.isAbsolute(c.prototype.from) ? path.relative(ws.root, c.prototype.from) : c.prototype.url}\`${c.verdict === 'both' ? ` (화면설계서 \`${c.storyboard.rel}\` 도 있음)` : ''}` : c.verdict === 'storyboard' ? `화면설계서 \`${c.storyboard.rel}\` (장 ${id})` : '없음 (기능 명세만)';
    const lines = [`## 화면 정본 대조: ${id}`, '', `- 정본: ${canon}`];
    if (ck) {
      lines.push(`- 정본 요소 체크리스트: \`${path.relative(ws.root, f)}\` (요소 ${ck.rows.length}개 · 판정 없음 ${ck.missingVerdict.length}개 · 판정 모양 틀림 ${ck.badVerdict.length}개)`);
      lines.push(`- 비교 스크린샷: ${ck.compareDone ? ck.head['비교'] : '미실행 (구현 쪽이 완료로 보고하면 안 되는 상태)'}`);
      lines.push('', `| ${COLS.join(' | ')} |`, `|${COLS.map(() => '---').join('|')}|`, ...ck.rows.map((r) => `| ${[r.area, r.label, r.kind, r.state, r.source, r.verdict].map(cell).join(' | ')} |`));
    } else {
      lines.push(`- 정본 요소 체크리스트: 없음 (구현 쪽이 \`kedovi screens inventory ${id}\` 를 하지 않았다. 그 자체를 지적한다)`);
    }
    lines.push('', '리뷰 기준 (화면):', '- **정본에 있는데 구현에 없는 요소는 블로커다.** 체크리스트에서 판정이 「구현」 인데 화면 · 코드에 없거나, 판정이 비었거나, 결정 ID 없는 「뺌」 이면 블로커로 적는다.', '- 「다름 (이유)」 는 이유가 데이터 모양 · API 로 맞는지 본다. 이유가 없으면 블로커.', '- 체크리스트에 없는데 정본에 보이는 요소(도구가 놓친 것)도 정본을 열어 확인한다.', '- 비교 스크린샷이 미실행이면 그 사실을 지적한다.');
    out.push(lines.join('\n'));
  }
  return out.join('\n\n');
}

// ── 명령 ──
async function inventory(ws, id, a) {
  const c = canonOf(ws, id, a);
  const rel = (p) => (p && path.isAbsolute(p) ? path.relative(ws.root, p) : p);
  let items = []; let how = ''; let diff = []; const warns = [];
  const pick = a.canon && a.canon !== true ? String(a.canon) : '';
  if (pick && !['prototype', 'storyboard'].includes(pick)) throw new Error('--canon 은 prototype | storyboard');
  if (pick && c.verdict !== 'both') throw new Error(`--canon 은 프로토타입과 화면설계서가 둘 다 있을 때만 씁니다 (${id} 판정: ${c.verdict})`);
  if (c.prototype) { const r = await prototypeItems(c.prototype); items = r.items; how = `프로토타입: ${r.how}`; if (r.warn) warns.push(r.warn); }
  if (c.storyboard) {
    const s = storyboardItems(c.storyboard, id);
    if (!c.prototype || pick === 'storyboard') { items = s.items; how = '화면설계서 장'; } else if (!pick) diff = diffItems(items, s.items);
  }
  const canonLine = c.verdict === 'prototype' ? `프로토타입 \`${rel(c.prototype.from) || c.prototype.url}\` (화면설계서 없음)`
    : c.verdict === 'storyboard' ? `화면설계서 \`${c.storyboard.rel}\` 장 ${id} (프로토타입 없음)`
      : c.verdict === 'both' && pick === 'storyboard' ? `화면설계서 \`${c.storyboard.rel}\` 장 ${id} (프로토타입 \`${rel(c.prototype.from) || c.prototype.url}\` 도 있음: 사용자가 화면설계서로 정함)`
        : c.verdict === 'both' ? `프로토타입 \`${rel(c.prototype.from) || c.prototype.url}\` (화면설계서 \`${c.storyboard.rel}\` 도 있음${pick ? ': 사용자가 프로토타입으로 정함' : diff.length ? `: 다를 수 있는 요소 ${diff.length}개, 확인 전` : ': 요소 이름이 맞음'})`
        : '없음';
  const out = { id, verdict: c.verdict, canon: canonLine, prototype: c.prototype && { url: c.prototype.url, how: c.prototype.how }, storyboard: c.storyboard && c.storyboard.rel, items: items.length, diff, warns };
  if (c.verdict === 'none') {
    out.ask = '정본(프로토타입 · 화면설계서)이 없습니다. 진행하지 말고 선택지로 묻는다: (권장) 프로토타입 · 화면설계를 먼저 만들고 확인한 뒤 구현 · 기능 명세(FN-*)대로 구현하고 화면은 디자인 시스템 기본형 (빠지는 것: 화면 확인 없이 만든 배치는 다시 고칠 가능성)';
    out.searched = c.searched;
    return out;
  }
  if (c.verdict === 'both' && diff.length) {
    out.ask = `프로토타입과 화면설계서가 둘 다 있고 요소 이름이 ${diff.length}개 다릅니다. 진행하지 말고 아래 표를 보이고 묻는다: 어느 쪽이 맞는지 · 틀린 쪽 문서를 갱신 대상으로 결정 기록에 남긴다. 답을 받으면 kedovi screens inventory ${id} --canon prototype|storyboard`;
    return out;
  }
  // 체크리스트: 있으면 사람이 채운 칸(상태 · 원천 · 판정)을 살려 합친다
  const file = checklistPath(ws, id);
  let old = [];
  let compare = '';
  if (fs.existsSync(file) && !a.force) { const r = readChecklist(file); old = r.rows; compare = r.head['비교'] || ''; }
  const key = (r) => `${r.area}|${r.label}|${r.kind}`;
  const oldBy = new Map(old.map((r) => [key(r), r]));
  const rows = items.map((it) => {
    const label = it.count > 1 ? `${it.label} (×${it.count})` : it.label;
    const prev = oldBy.get(`${it.area}|${label}|${it.kind}`);
    if (prev) oldBy.delete(key(prev));
    return { area: it.area, label, kind: it.kind, state: prev ? prev.state : '', source: prev ? prev.source : '', verdict: prev ? prev.verdict : '' };
  });
  // 사람이 더한 줄 · 정본에서 사라진 줄도 지우지 않는다 (판정이 있으면 그대로)
  for (const r of oldBy.values()) rows.push(r);
  if (!a.print) writeChecklist(file, { id, root: ws.root, canonLine, storyboard: c.storyboard, prototype: c.prototype, compare, how }, rows);
  out.checklist = path.relative(ws.root, file);
  out.rows = rows;
  return out;
}

function printInventory(r) {
  const mark = r.ask ? '⚠' : '✔';
  console.log(`${mark} ${r.id} 정본: ${r.canon}`);
  if (r.searched) console.log(`  찾은 곳: ${r.searched.join(' · ') || '기획 repo(kind: docs) 없음'}`);
  for (const w of r.warns || []) console.log(`  ⚠ ${w}`);
  if (r.checklist) console.log(`  요소 ${r.rows.length}개 · 체크리스트 ${r.checklist}`);
  if (r.diff && r.diff.length) {
    console.log('\n| 한쪽에만 있음 | 영역 | 요소 | 종류 |\n|---|---|---|---|');
    for (const d of r.diff) console.log(`| ${d.only} | ${cell(d.area)} | ${cell(d.label)} | ${d.kind} |`);
  }
  if (r.rows && r.rows.length && !r.ask) {
    const byArea = {};
    for (const x of r.rows) byArea[x.area] = (byArea[x.area] || 0) + 1;
    console.log(`  영역: ${Object.entries(byArea).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  }
  if (r.rows && !r.rows.length) console.log('  ⚠ 정본에서 요소를 하나도 찾지 못했습니다. 정본을 열어 직접 체크리스트에 적는다 (프로토타입에 data-area · data-el 표시를 달면 정확해진다)');
  if (r.ask) console.log(`\n${r.ask}`);
  else console.log(`\n착수 전 확인 줄: 화면 정본 ${r.id} = ${r.canon} · 요소 ${r.rows.length}개 · 체크리스트 ${r.checklist}\n다음: 체크리스트의 「데이터 원천」 을 채우고 kedovi screens checklist ${r.id} --start (원천 없는 요소는 착수 전에 사용자에게 알린다)`);
}

function printChecklist(ws, id, a) {
  const f = findChecklist(ws, id);
  if (!f) { console.error(`✖ ${id} 체크리스트가 없습니다. 먼저 kedovi screens inventory ${id}`); return 1; }
  const ck = checkChecklist(f);
  const rel = path.relative(ws.root, f);
  if (a.md) {
    console.log(`#### 화면 ${id} 정본 대조\n\n- 정본: ${ck.head['정본'] || '?'}\n- 비교: ${ck.head['비교'] || '미실행'}\n\n| 영역 | 요소 | 판정 |\n|---|---|---|`);
    for (const r of ck.rows) console.log(`| ${cell(r.area)} | ${cell(r.label)} | ${cell(r.verdict || '(판정 없음)')} |`);
    return ck.missingVerdict.length || ck.badVerdict.length ? 1 : 0;
  }
  const list = (xs) => xs.slice(0, 12).map((r) => `${r.area} > ${r.label}`).join(' · ') + (xs.length > 12 ? ` 외 ${xs.length - 12}개` : '');
  if (a.start) {
    if (ck.noSource.length) console.log(`⚠ 데이터 원천이 없는 요소 ${ck.noSource.length}개: ${list(ck.noSource)}\n  착수 전에 사용자에게 알린다 (만들 수 없는 요소 · 대안 · 뺄지)`);
    if (ck.empty) { console.log(`✖ 체크리스트에 요소가 없습니다. 정본을 열어 영역 · 요소를 직접 적는다 (${rel})`); return 1; }
    if (ck.emptySource.length) { console.log(`✖ 데이터 원천 빈 칸 ${ck.emptySource.length}개: ${list(ck.emptySource)} (${rel})`); return 1; }
    console.log(`✔ ${id} 착수 전 점검: 요소 ${ck.rows.length}개 원천 채움${ck.noSource.length ? ` · 원천 없음 ${ck.noSource.length}개 알림 필요` : ''}`);
    return 0;
  }
  let bad = 0;
  if (ck.empty) { console.log('✖ 체크리스트에 요소가 없습니다. 정본을 열어 영역 · 요소를 직접 적는다'); bad++; }
  if (ck.missingVerdict.length) { console.log(`✖ 판정 없는 요소 ${ck.missingVerdict.length}개: ${list(ck.missingVerdict)}`); bad++; }
  if (ck.badVerdict.length) { console.log(`✖ 판정 모양이 틀린 요소 ${ck.badVerdict.length}개 (구현 · 다름 (이유) · 뺌 (결정 ID)): ${list(ck.badVerdict)}`); bad++; }
  if (!ck.compareDone) { console.log(`✖ 비교 미실행: kedovi screens compare ${id} (백엔드 없이: --mock <픽스처>). 정말 못 돌리면 체크리스트의 「- 비교:」 줄에 「대체: <무엇으로 확인했는지>」 를 적고 보고에 미실행을 밝힌다`); bad++; }
  if (bad) { console.log(`  → 완료로 보고하지 않는다 (${rel})`); return 1; }
  console.log(`✔ ${id} 요소 ${ck.rows.length}개 모두 판정 · 비교 ${ck.head['비교']}`);
  return 0;
}

async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const a = C.parseArgs ? C.parseArgs(argv.slice(1)) : { _: argv.slice(1) };
  if (!['inventory', 'checklist', 'review'].includes(sub) || !a._.length || a.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 9).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    process.exit(sub ? 1 : 0);
  }
  let ws;
  try { ws = require(path.join(PACKS, 'core', 'lib', 'workspace.js')).load(path.resolve(PACKS, '..')); } catch (e) { console.error(`✖ workspace.json 을 읽지 못했습니다. ${e.message}`); process.exit(1); }
  if (sub === 'review') { console.log(reviewBlock(ws, a._)); return; }
  if (sub === 'checklist') process.exit(printChecklist(ws, a._[0], a));
  let r;
  try { r = await inventory(ws, a._[0], a); } catch (e) { console.error(`✖ ${e.message}`); process.exit(1); }
  if (a.json) console.log(JSON.stringify(r, null, 2)); else printInventory(r);
  process.exit(r.ask ? 3 : 0);
}

if (require.main === module) main().catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
module.exports = { parseHtml, extract, canonOf, findStoryboard, screenIds, inventory, checklistPath, findChecklist, readChecklist, checkChecklist, verdictOk, recordCompare, reviewBlock, diffItems };
