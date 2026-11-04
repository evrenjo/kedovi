// 문서 사이트 생성기: 기획 repo 의 md 를 같은 경로 구조의 HTML 사이트로 만든다. 실행은 bin/docs-site.js
// md 해석은 markdown-it + 한국어 굵게 보정(cjk-friendly). 킷에 묶어 넣은 파일(lib/vendor/markdown-it.js, npm run vendor)이라 npm 설치 없이 돈다
/*
 * 입력: { 'md 상대 경로': 내용 } (+ 화면설계서 장 HTML · 그림). 출력: { '사이트 상대 경로': 내용 } + 색인 + 경고.
 * - 같은 입력이면 같은 출력 (날짜 · 시각을 넣지 않고 키를 정렬한다).
 * - 정의 ID 에 앵커를 단다: ID 로 시작하는 제목(# ~ ####)은 제목 안 <span id>, 표 첫 칸이 ID 인 행은 <tr id>,
 *   「**ID**」 로 시작하는 문단 · 목록 줄은 <span id>. 「대조」 가 든 절(## · ###)의 표는 참조라 정의로 치지 않는다
 *   (그 ID 의 정의가 그 문서에 달리 없을 때만 예외). 제목 끝 괄호 안의 낱 ID(「### 권한 (D2-3)」)는 약한 정의.
 * - 본문의 ID 는 이 페이지에 정의가 있으면 #ID, 다른 한 페이지에만 있으면 그 페이지로 잇는다. 여러 페이지에 있으면 잇지 않는다.
 *   「뉴스 설계 D1-1 · D1-2」 처럼 다른 문서(링크 · xxx.md)를 바로 앞에 쓴 ID 목록은 이 페이지 앵커로 잇지 않고 그 문서로 잇는다.
 * - 색인 assets/ids.json = { ids: { ID: ['경로#ID', …] }, docs: { md 이름: 페이지 경로 }, prefixes: [...] } (생성한 HTML 의 실제 id 를 스캔).
 * - 데이터 설계 정의서(「### 스키마.테이블」 + 컬럼 표, lib/datamodel.js)가 든 폴더마다 ERD 뷰어 쪽 <폴더>/erd.html (opts.erd 를 줄 때만).
 */
'use strict';
const path = require('path').posix;
const DM = require('./datamodel');
const V = require('./vendor/markdown-it');

// ID 모양: 대문자로 시작하고 「-숫자」 로 끝난다 (REQ-001 · REQ-SAF-001 · FN-ADM-001 · D1-1 · A-11 · SCR-AUTH-01)
const ID_SRC = '[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\\d+';
const ID_FULL = new RegExp(`^${ID_SRC}$`);
const ID_IN_TEXT = new RegExp(`(?<![\\w-])(${ID_SRC})(?![\\w-])`, 'g');
const SKIP_DIRS = new Set(['docs-site', 'html', 'originals', 'node_modules', '.git', '.github', '.gitlab']);
const SKIP_ROOT_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'AGENTS.override.md', 'CLAUDE.local.md']);
const IMG_EXT = /\.(png|jpe?g|gif|svg|webp)$/i;
const SHEET_RE = /<section\b[^>]*\bclass="[^"]*\bsheet\b/;

/**
 * 긴 표 칸 접기.
 * - 날짜로 시작하는 항목이 쌓인 칸(머리말 「변경」 등, 300자 넘음): 첫 항목만 보이고 나머지는 「나머지 n건 보기」. 나누는 곳 = 「;」 · 「 · 」 뒤에 날짜가 오는 곳
 * - 그 밖에 max 자(opts.cellFold, 기본 200)를 넘는 칸: 첫 문장만 보이고 나머지는 「더 보기」
 */
const FOLD_MIN = 300;
const CELL_FOLD = 200;
const seen = (t) => String(t).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<br\s*\/?>/gi, ' ').replace(/[`*]/g, '').length;
/** 여기서 끊어도 되는가: 앞부분에 굵게(**) · 코드(`) · 링크([ ]( ))가 열린 채 남지 않는다 */
const closed = (pre) => (pre.match(/\*\*/g) || []).length % 2 === 0 && (pre.match(/`/g) || []).length % 2 === 0
  && (pre.match(/\[/g) || []).length === (pre.match(/\]/g) || []).length && !/\]\([^)]*$/.test(pre);
function foldCell(text, render, max = CELL_FOLD) {
  if (text.length >= FOLD_MIN) {
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(/(?:;\s*|\s·\s)(?=\d{4}-\d{2}-\d{2})/g)) {
      if (!closed(text.slice(0, m.index))) continue;
      parts.push(text.slice(last, m.index));
      last = m.index + m[0].length;
    }
    parts.push(text.slice(last));
    const list = parts.map((x) => x.trim()).filter(Boolean);
    if (list.length >= 3) return `<div class="ds-fold">${render(list[0])}<details><summary>나머지 ${list.length - 1}건 보기</summary><ul>${list.slice(1).map((x) => `<li>${render(x)}</li>`).join('')}</ul></details></div>`;
  }
  if (seen(text) <= max) return render(text);
  // 첫 문장: 「다.」 · 「.」 · 「<br>」 뒤. 굵게 · 코드 · 링크 안에서는 끊지 않는다
  for (const m of text.matchAll(/[.!?](?=\s)|<br\s*\/?>/gi)) {
    const end = m.index + m[0].length;
    const head = text.slice(0, end), rest = text.slice(end).trim();
    if (!rest || !closed(head)) continue;
    return `<div class="ds-fold">${render(head.replace(/<br\s*\/?>$/i, ''))}<details class="ds-more"><summary>더 보기</summary><div>${render(rest)}</div></details></div>`;
  }
  return render(text);
}

const titleTokens = (t) => String(t).split(/[\s·—()\-:]+/).filter((w) => w.length >= 2);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (s) => String(s).replace(/\*\*|__|`/g, '').trim();

/** 생성 대상인가: docs-site/ · 옛 html/ · originals/ · 숨김 폴더 · _로 시작하는 견본 파일 · 에이전트 지침은 뺀다 */
function wanted(rel) {
  const parts = rel.split('/');
  if (parts.some((p, i) => (i < parts.length - 1 && (SKIP_DIRS.has(p) || p.startsWith('.'))))) return false;
  const base = parts[parts.length - 1];
  if (base.startsWith('_') || base.startsWith('.')) return false;
  if (parts.length === 1 && SKIP_ROOT_FILES.has(base)) return false;
  return /\.md$/i.test(base) || IMG_EXT.test(base) || /\.html?$/i.test(base);
}

/** md 경로 → 페이지 경로. README.md 는 그 폴더의 index.html, INDEX.md(대소문자 무관)도 index.html (대소문자를 구분하지 않는 PC 에서 INDEX.html 이 폴더 쪽과 겹친다) */
function pageOf(rel) {
  const dir = path.dirname(rel);
  const base = path.basename(rel).replace(/\.md$/i, '');
  if (/^(readme|index)$/i.test(base)) return dir === '.' ? 'index.html' : `${dir}/index.html`;
  return dir === '.' ? `${base}.html` : `${dir}/${base}.html`;
}
/** 첫 조각에 : 가 있는 상대 주소(예: 파일 이름 javascript:x.html)는 ./ 를 붙여 주소 체계로 읽히지 않게 */
const safeRel = (r) => (/^[^/?#]*:/.test(r) ? `./${r}` : r);
const relLink = (from, to) => {
  const r = path.relative(path.dirname(from), to);
  return safeRel((r || path.basename(to)).split(path.sep).join('/'));
};
const rootOf = (page) => '../'.repeat(page.split('/').length - 1);

// ───────────────────────── md 읽기 ─────────────────────────

/**
 * md 해석기: GitHub · GitLab 과 같은 CommonMark + 표 · 취소선. md 안의 HTML 은 글자로 보이고 <br> 만 줄바꿈으로 (표 칸에서 쓴다).
 * 링크 주소는 그대로 넘겨 받고(링크를 걸지 · 어디로 걸지는 mdPage 의 link 가 정한다), 굵게는 한국어 조사가 바로 붙어도 된다 (「**확정(초안)**은」)
 */
const MD = V.MarkdownIt({ html: false, linkify: false, typographer: false }).use(V.cjkFriendly);
MD.normalizeLink = (u) => u;
MD.validateLink = () => true;
MD.inline.ruler.before('autolink', 'br_tag', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x3C) return false;
  const m = /^<br\s*\/?>/i.exec(state.src.slice(state.pos, state.pos + 8));
  if (!m) return false;
  if (!silent) state.push('hardbreak', 'br', 0);
  state.pos += m[0].length;
  return true;
});
MD.renderer.rules.hardbreak = () => '<br>';
MD.renderer.rules.softbreak = () => ' ';
MD.renderer.rules.s_open = () => '<del>';
MD.renderer.rules.s_close = () => '</del>';
MD.renderer.rules.link_open = (tokens, idx, o, env) => {
  const href = tokens[idx].attrGet('href');
  const h = env.ctx ? env.ctx.link(href, false) : href;
  env.open.push(h == null);
  return h == null ? `<span class="ds-nolink" title="${esc(href)}">` : `<a href="${esc(h)}">`;
};
MD.renderer.rules.link_close = (tokens, idx, o, env) => (env.open.pop() ? '</span>' : '</a>');
MD.renderer.rules.image = (tokens, idx, o, env) => {
  const t = tokens[idx], alt = t.children ? MD.renderer.renderInlineAsText(t.children, o, env) : t.content;
  const h = env.ctx ? env.ctx.link(t.attrGet('src'), true) : t.attrGet('src');
  return h ? `<img alt="${esc(alt)}" src="${esc(h)}">` : esc(alt);
};

/** 코드 블록 밖의 HTML 주석 줄(<!-- … -->, 여러 줄 포함)을 뺀다. 보이지 않는다 (GitHub 와 같게) */
function dropComments(lines) {
  const out = [];
  let fence = null, inComment = false;
  for (const l of lines) {
    if (inComment) { if (l.includes('-->')) inComment = false; continue; }
    const f = /^\s*(```+|~~~+)/.exec(l);
    if (f) fence = fence ? (l.trim().startsWith(fence) ? null : fence) : f[1];
    if (!fence && /^\s*<!--/.test(l)) { if (!l.includes('-->')) inComment = true; continue; }
    out.push(l);
  }
  return out;
}

/**
 * md → 블록 목록: {t:'h',lvl,text} {t:'table',head,rows} {t:'list',ordered,start,items:[{text,task,kids,blocks}]} {t:'quote',blocks} {t:'code',lang,text} {t:'hr'} {t:'p',text}
 * text 는 그 자리의 md 글자 그대로 (정의 ID 찾기 · 상태 읽기가 쓰고, 그릴 때 inline 이 HTML 로). 맨 앞 YAML 머리(--- … ---)는 뺀다
 */
function parse(src) {
  const text = dropComments(String(src).replace(/\r\n?/g, '\n').split('\n')).join('\n').replace(/^---\n(?:[\w-]+:.*\n|\s+.*\n)*---\n/, '');
  const toks = MD.parse(text, {});
  let i = 0;
  function blocks(end) {
    const out = [];
    while (i < toks.length) {
      const t = toks[i];
      if (end && t.type === end) { i++; return out; }
      if (t.type === 'heading_open') { out.push({ t: 'h', lvl: Number(t.tag.slice(1)), text: toks[i + 1].content }); i += 3; }
      else if (t.type === 'paragraph_open') { out.push({ t: 'p', text: toks[i + 1].content }); i += 3; }
      else if (t.type === 'fence' || t.type === 'code_block') { out.push({ t: 'code', lang: t.type === 'fence' ? (t.info || '').trim().split(/\s+/)[0] : '', text: t.content.replace(/\n$/, '') }); i++; }
      else if (t.type === 'hr') { out.push({ t: 'hr' }); i++; }
      else if (t.type === 'blockquote_open') { i++; out.push({ t: 'quote', blocks: blocks('blockquote_close') }); }
      else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') out.push(list());
      else if (t.type === 'table_open') out.push(table());
      else i++;
    }
    return out;
  }
  function list() {
    const open = toks[i++];
    const ordered = open.type === 'ordered_list_open';
    const close = ordered ? 'ordered_list_close' : 'bullet_list_close';
    const items = [];
    while (toks[i].type !== close) {
      i++; // list_item_open
      const inner = blocks('list_item_close');
      const first = inner[0] && inner[0].t === 'p' ? inner.shift().text : '';
      const task = /^\[( |x|X)\]\s+/.exec(first);
      const item = { text: task ? first.slice(task[0].length) : first, task: task ? task[1] !== ' ' : null };
      // 끝의 하위 목록 하나 = kids (중첩 목록), 그 밖에 항목 안 블록(문단 · 코드 · 표 · 인용)은 blocks
      if (inner.length && inner[inner.length - 1].t === 'list' && inner.filter((x) => x.t === 'list').length === 1) item.kids = inner.pop();
      if (inner.length) item.blocks = inner;
      items.push(item);
    }
    i++;
    const start = ordered ? Number(open.attrGet('start') || 1) : 1;
    return { t: 'list', ordered, ...(start !== 1 ? { start } : {}), items };
  }
  function table() {
    const head = [], rows = [];
    let cur = null, inHead = false;
    for (i++; toks[i].type !== 'table_close'; i++) {
      const t = toks[i];
      if (t.type === 'thead_open') inHead = true;
      else if (t.type === 'thead_close') inHead = false;
      else if (t.type === 'tr_open') cur = [];
      else if (t.type === 'tr_close') { if (inHead) head.push(...cur); else rows.push(cur); }
      else if (t.type === 'inline') cur.push(t.content.trim());
    }
    i++;
    return { t: 'table', head, rows };
  }
  return blocks(null);
}

/** 문서 정보: 제목(첫 #) · 상태(「> 상태: 초안」 · 「상태: 초안」 · 머리 표 「| 상태 | **확정** |」) */
function docInfo(blocks, fallback) {
  const h1 = blocks.find((b) => b.t === 'h' && b.lvl === 1);
  let status = '';
  const pick = (s) => plain(s).split(/\s+[—-]\s+|[(.,·]/)[0].trim();
  const scan = (bs) => {
    for (const b of bs) {
      if (status) return;
      if (b.t === 'p') { const m = /^\**상태\**\s*[:：]\s*(.+)$/m.exec(b.text); if (m) status = pick(m[1]); }
      if (b.t === 'quote') scan(b.blocks);
      if (b.t === 'table') for (const r of b.rows) if (!status && plain(r[0]) === '상태' && r[1]) status = pick(r[1]);
    }
  };
  scan(blocks.slice(0, 8));
  return { title: h1 ? plain(h1.text) : fallback, status };
}

// ───────────────────────── 정의 찾기 ─────────────────────────

/** 문서의 정의 ID → 정의 후보 목록. 강도 0 = 제목 · 표 행 · 굵은 머리말, 1 = 제목 끝 괄호, 2 = 대조 절 · 대응 표의 행 */
function findDefs(blocks) {
  const found = new Map(); // ID → 정의 후보 [{ block, row?, item?, kind, strength }] (문서 순서)
  const put = (id, where, strength) => {
    const list = found.get(id) || [];
    if (!list.some((c) => c.block === where.block && c.row === where.row && c.item === where.item)) list.push({ ...where, strength });
    found.set(id, list);
  };
  // 대응 표: 행 대부분(80% 이상)이 첫 칸 뒤에 ID 목록만 있는 표(「| VS-AUT-01 중복 방지 | FN-AUT-001 · 014 |」)는 참조다
  const idList = new RegExp(`^(?:${ID_SRC}|\\d+|§[\\d.]+|[\\s·,~+()-]|및)*$`);
  const mapping = (b) => b.rows.length > 0 && b.head.length >= 2 && b.rows.filter((r) => r.slice(1).every((c) => idList.test(plain(c)))).length >= b.rows.length * 0.8;
  let h2ref = false;
  let h3ref = false;
  const lead = (t) => { const m = /^\**\s*([A-Z][\w-]*)/.exec(plain(t).replace(/^\[[ xX]\]\s*/, '')); return m && ID_FULL.test(m[1]) ? m[1] : null; };
  const parenIds = (t) => {
    const m = /\(([^()]*)\)\s*\**\s*$/.exec(plain(t));
    return m ? m[1].split(/\s*(?:,|·|\+)\s*/).filter((x) => ID_FULL.test(x)) : [];
  };
  const walk = (bs) => {
    for (const b of bs) {
      if (b.t === 'h') {
        if (b.lvl <= 2) { h2ref = b.lvl === 2 && b.text.includes('대조'); h3ref = false; }
        if (b.lvl === 3) h3ref = b.text.includes('대조');
        if (b.lvl <= 4) {
          const id = lead(b.text);
          if (id) put(id, { block: b, kind: 'head' }, 0);
          for (const x of parenIds(b.text)) if (x !== id) put(x, { block: b, kind: 'paren' }, 1);
        }
      } else if (b.t === 'table') {
        const ref = h2ref || h3ref || mapping(b);
        b.rows.forEach((r, k) => {
          const first = plain(r[0] || '').split(/\s+/)[0];
          if (ID_FULL.test(first)) put(first, { block: b, row: k, kind: 'row' }, ref ? 2 : 0);
        });
      } else if (b.t === 'p') {
        const m = /^\*\*([^*]+)\*\*/.exec(b.text);
        if (m && ID_FULL.test(m[1].trim())) put(m[1].trim(), { block: b, kind: 'para' }, 0);
        else if (m) for (const x of parenIds(m[1])) put(x, { block: b, kind: 'paren' }, 1);
      } else if (b.t === 'list') {
        const items = (l) => l.items.forEach((it) => {
          const m = /^\*\*([^*]+)\*\*/.exec(it.text);
          if (m && ID_FULL.test(m[1].trim())) put(m[1].trim(), { block: b, item: it, kind: 'para' }, 0);
          if (it.kids) items(it.kids);
        });
        items(b);
      } else if (b.t === 'quote') walk(b.blocks);
    }
  };
  walk(blocks);
  return found;
}

/** 문서 안에서 다른 문서를 가리키며 적은 ID · 범위 → (id) => 그 문서 것인가 */
function externalRefs(src, self) {
  const singles = new Set();
  const ranges = [];
  const nums = (id) => (id.match(/\d+/g) || []).map(Number);
  const fam = (id) => id.replace(/\d+/g, '#');
  const ID = ID_SRC;
  const tailRe = new RegExp(`^\\s*(?:\\(([^()]*)\\)|((?:${ID}|\\d+|[\\s·,~+]|및)+))`);
  const anchors = /\]\(([^)\s]+\.md)(?:#[^)]*)?\)|\b[\w-]+\.md\b/g;
  const text = String(src);
  let m;
  while ((m = anchors.exec(text))) {
    if (path.basename(m[1] || m[0]) === self) continue; // 자기 파일 이름은 다른 문서가 아니다
    const t = tailRe.exec(text.slice(m.index + m[0].length));
    if (!t) continue;
    const seg = t[1] != null ? t[1] : t[2];
    // 「A · B ~ C」: 앞 ID 의 머리를 이어 받아 줄여 쓴 번호(· 015)를 채운다
    let prev = null;
    const toks = seg.split(/\s*(?:·|,|\+|및)\s*/);
    for (const tok of toks) {
      const parts = tok.split(/\s*~\s*/).map((x) => x.trim()).filter(Boolean);
      const full = parts.map((x) => {
        if (ID_FULL.test(x)) return (prev = x);
        if (/^\d+$/.test(x) && prev) return (prev = prev.replace(/\d+$/, x.padStart(prev.match(/\d+$/)[0].length, '0')));
        return null;
      });
      if (full.length === 1 && full[0]) singles.add(full[0]);
      if (full.length === 2 && full[0] && full[1] && fam(full[0]) === fam(full[1])) ranges.push({ fam: fam(full[0]), lo: nums(full[0]), hi: nums(full[1]) });
    }
  }
  const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); } return 0; };
  return (id) => singles.has(id) || ranges.some((r) => r.fam === fam(id) && cmp(nums(id), r.lo) >= 0 && cmp(nums(id), r.hi) <= 0);
}

// ───────────────────────── 글자 → HTML ─────────────────────────

/**
 * 한 줄 md → HTML. ctx: { page, link(href, img) → 새 href | null, ids(html, defIds) → html }
 * 내부 md 링크는 페이지로, 외부 http(s) 는 그대로, 그 밖의 링크(원본 파일 등)는 글자만 남긴다 (ds-nolink).
 */
function inline(t, ctx, defIds, skip) {
  let s = MD.renderInline(String(t).replace(/\u0000/g, ''), { ctx, open: [] });
  // 링크 · 코드 · 그림 · 걸지 않은 링크는 통째로 숨겨 둔 채 ID 를 잇고, 마지막에 되돌린다 (링크 글자 · 코드 안은 건드리지 않는다)
  const keep = [];
  s = s.replace(/<a\b[^>]*>[\s\S]*?<\/a>|<code>[\s\S]*?<\/code>|<img\b[^>]*>|<span class="ds-nolink"[^>]*>[\s\S]*?<\/span>/g, (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
  s = ctx && ctx.ids ? ctx.ids(s, defIds || [], keep, skip || []) : s;
  return s.replace(/\u0000(\d+)\u0000/g, (_, k) => keep[+k]);
}

// ───────────────────────── 사이트 ─────────────────────────

// 인용구 안 「출처: · 근거: · 참고: · 자료:」 줄은 작은 글씨 줄로 나눈다 (인용 본문 아래 출처)
const SRC_LINE = /^\s*(?:[—-]\s*)?\**(?:출처|근거|참고|자료)\**\s*[:：]/;
function quoteSrc(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.t !== 'p' || !b.text.split('\n').some((l) => SRC_LINE.test(l))) { out.push(b); continue; }
    let cur = null;
    for (const l of b.text.split('\n')) {
      const src = SRC_LINE.test(l);
      if (!cur || cur.src !== src || src) { cur = { t: 'p', text: l, src }; out.push(cur); } else cur.text += `\n${l}`;
    }
  }
  return out;
}

/**
 * @param files { 상대 경로: 내용(문자열 · 그림은 Buffer) }
 * @param opts { title, prefixes: ['REQ','FN', …] (정의 없는 ID 를 경고할 머리말), assets: { 사이트 경로: 내용 }, cellFold (표 칸 접기 글자 수), srcOf(md) · fileUrl(경로) (원본 · 사이트 밖 파일 주소) }
 * @returns { pages: { 사이트 경로: 내용 }, index, warnings: [문자열], docs: [{ md, page, title, status, kind }] }
 */
function build(input, opts = {}) {
  let files = input;
  const prefixes = (opts.prefixes || []).filter(Boolean);
  const prefixRe = prefixes.length ? new RegExp(`^(?:${prefixes.map((p) => p.replace(/[^A-Za-z0-9]/g, '')).join('|')})-`) : null;
  const warnings = [];
  const docs = [];
  const pages = {};
  const cfg = opts.config || {};
  // ## 마다 쪽을 나눌 문서: 설정 묶음의 split(true = 그 묶음 전부, [glob] = 그 파일만), 설정이 없으면 루트 README
  const splitRes = Array.isArray(cfg.groups) && cfg.groups.length
    ? cfg.groups.filter((g) => g.split).flatMap((g) => (Array.isArray(g.split) ? g.split : g.files || []).map(globRe)) : [/^README\.md$/i];
  files = { ...files };
  const parts = {}; // 조각 key → { origin, part, section, slug }
  const splitPages = {}; // 원본 md → { 절 slug: 조각 key }
  for (const k of Object.keys(files).filter(wanted).sort()) {
    if (!/\.md$/i.test(k) || !splitRes.some((re) => re.test(k))) continue;
    const ps = splitDoc(k, files[k]);
    if (ps.length < 2) continue;
    splitPages[k] = {};
    for (const x of ps) { files[x.key] = x.text; parts[x.key] = x; if (x.slug) splitPages[k][x.slug] = x.key; }
  }
  const keys = Object.keys(files).filter(wanted).sort();
  const mdPages = {};
  for (const k of keys) if (/\.md$/i.test(k)) mdPages[k] = pageOf(k);

  // 1. md 읽기 · 정의 모으기 · 화면설계서 장
  for (const k of keys) {
    if (/\.md$/i.test(k)) {
      const blocks = parse(files[k]);
      const info = docInfo(blocks, path.basename(k, '.md'));
      const pt = parts[k] || {};
      docs.push({ md: k, page: mdPages[k], kind: 'md', blocks, cands: findDefs(blocks), ...info, origin: pt.origin, part: pt.part, section: pt.section });
    } else if (/\.html?$/i.test(k) && SHEET_RE.test(String(files[k]))) {
      const html = String(files[k]);
      const title = (/data-doc="([^"]+)"/.exec(html) || /<title>([^<]*)<\/title>/i.exec(html) || [])[1] || path.basename(k);
      const attr = (tag, n) => { const m = new RegExp(`\\b${n}="([^"]*)"`).exec(tag); return m ? m[1] : ''; };
      const secs = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<section\b[^>]*>/g)].map((m) => m[0])
        .filter((tag) => /\bclass="[^"]*\bsheet\b/.test(tag))
        .map((tag) => ({ id: attr(tag, 'id'), group: attr(tag, 'data-group') || '기타', label: attr(tag, 'data-label') || attr(tag, 'id') }));
      const page = k.replace(/\.htm$/i, '.html');
      docs.push({ md: k, page, kind: 'sheets', html, sheetIds: secs.map((x) => x.id).filter(Boolean), sheets: secs, title: title.trim(), status: '' });
    } else if (IMG_EXT.test(k)) pages[k] = files[k];
  }
  // 정의 고르기: 후보 중 가장 강한 것 (같으면 앞의 것)
  const md = docs.filter((d) => d.kind === 'md');
  const pick = (d) => { d.defs = new Map([...d.cands].filter(([, l]) => l.length).map(([id, l]) => [id, l.reduce((a, c) => (c.strength < a.strength ? c : a))])); };
  // ① 다른 문서를 가리키며 적은 ID(「[아키텍처](10-architecture.md) (A-1 · A-8)」 · 「30-design-x.md D2-2」 · 범위 「D1-1 ~ D3-4」)는
  //    그 문서의 것이라 이 문서의 표 행 · 괄호 후보에서 뺀다 (ID 로 시작하는 제목 · 「**ID**」 머리말은 이 문서의 정의로 둔다)
  for (const d of md) {
    const ext = externalRefs(files[d.md], path.basename(d.md));
    for (const [id, l] of d.cands) if (ext(id)) d.cands.set(id, l.filter((c) => c.kind !== 'row' && c.kind !== 'paren'));
    pick(d);
  }
  // ② 여러 문서에 잡힌 ID 의 표 행 정의는 그 계열(숫자를 뺀 모양: A-# · D#-# · VS-GW-#)을 가진 문서에만 남긴다.
  //    (매핑 표에 옮겨 적은 남의 ID 를 정의로 잡지 않는다).
  //    뺀 문서는 다음 후보(제목 끝 괄호 등)로 내려간다
  const fam = (id) => id.replace(/\d+/g, '#');
  for (const d of md) d.strongFams = new Set([...d.cands].filter(([, l]) => l.some((c) => c.strength === 0)).map(([id]) => fam(id)));
  {
    const docsOf = new Map();
    for (const d of md) for (const id of d.defs.keys()) docsOf.set(id, [...(docsOf.get(id) || []), d]);
    // 계열을 가진다 = 그 계열의 강한 정의 수가 가장 많은 문서의 절반 이상이거나,
    const count = new Map(md.map((d) => [d, new Map()]));
    for (const d of md) for (const [id, w] of d.defs) if (w.strength === 0) count.get(d).set(fam(id), (count.get(d).get(fam(id)) || 0) + 1);
    const most = new Map();
    for (const c of count.values()) for (const [f, n] of c) most.set(f, Math.max(most.get(f) || 0, n));
    // 또는 그 계열의 ID 중 이 문서에만 정의된 것이 있다 (문서마다 따로 매기는 결정 번호 D1-1 등)
    const owned = new Map(md.map((d) => [d, new Set([...[...count.get(d)].filter(([f, n]) => n * 2 >= most.get(f)).map(([f]) => f),
      ...[...d.defs.keys()].filter((id) => docsOf.get(id).length === 1).map(fam)])]));
    for (const [id, list] of docsOf) {
      if (list.length < 2) continue;
      const keep = list.filter((d) => d.defs.get(id).kind !== 'row' || d.defs.get(id).strength > 0 || owned.get(d).has(fam(id)));
      if (!keep.length) continue;
      for (const d of list) if (!keep.includes(d)) d.cands.set(id, d.cands.get(id).filter((c) => c.kind !== 'row' || c.strength > 0));
    }
    md.forEach(pick);
  }
  // ③ 약한 정의(제목 끝 괄호 · 대조 절 · 대응 표)는 다른 문서에 강한 정의가 있고 이 문서에 같은 계열의 강한 후보가 없으면 뺀다
  //    (「### 3.5 외부 입력 방어 (REQ-NEW-015)」 는 요구사항 문서의 것, 「### 7.3 재접속 (D2-3)」 은 이 문서의 결정)
  for (const d of md) {
    for (const [id, w] of [...d.defs]) {
      if (w.strength > 0 && !d.strongFams.has(fam(id)) && md.some((o) => o !== d && o.defs.has(id) && o.defs.get(id).strength === 0)) d.defs.delete(id);
    }
  }
  const where = new Map(); // ID → Set(페이지)
  for (const d of docs) {
    const list = d.kind === 'md' ? [...d.defs.keys()] : d.sheetIds.filter((x) => ID_FULL.test(x));
    for (const id of list) { if (!where.has(id)) where.set(id, new Set()); where.get(id).add(d.page); }
  }
  const byName = {}; // 문서 이름(경로 · 파일명 · .md 뺀 것) → 페이지
  const names = {};
  for (const d of docs) {
    const base = path.basename(d.md);
    names[base] = names[base] ? null : d.page;
  }
  for (const d of docs) {
    if (d.origin && d.origin !== d.md) continue; // 나눈 조각은 원본 이름으로만 (첫 쪽)
    byName[d.md] = d.page;
    const base = path.basename(d.md);
    if (names[base]) byName[base] = d.page;
  }

  // 2. 페이지 그리기
  // 문서 제목의 낱말 → 그 문서들 (여러 제목에 흔한 낱말 「상세」 · 「설계」 는 뺀다)
  const titleWords = new Map();
  for (const d of docs) for (const w of new Set(titleTokens(d.title))) titleWords.set(w, [...(titleWords.get(w) || []), d.page]);
  for (const [w, l] of [...titleWords]) if (l.length * 4 > docs.length) titleWords.delete(w);
  const docNames = new Map(docs.map((d) => [path.basename(d.md).replace(/\.md$/i, ''), d.page]));
  // 나눈 문서의 첫 쪽은 메뉴에서 「개요」
  for (const d of docs) if (d.origin && d.part === 0) d.navTitle = '개요';
  // docs-site.json labels: { "README.md": "소개" } = 메뉴 · 이전/다음에 보일 이름 (문서 제목은 그대로)
  for (const d of docs) { const l = (cfg.labels || {})[d.origin || d.md]; if (l && !d.part) d.navTitle = String(l); }
  const groups = navGroups(docs, cfg);
  // 개요 쪽: 그 폴더의 README 쪽, 없으면 폴더 쪽. 묶음 첫 항목으로 올린다 (화면설계서 · ERD 가 같이 쓴다)
  const overviewOf = (g, dir, title) => {
    const readme = docs.find((d) => d.kind === 'md' && !d.part && (d.origin || d.md) === (dir === '.' ? 'README.md' : `${dir}/README.md`));
    const page = dir === '.' ? 'index.html' : `${dir}/index.html`;
    const over = readme || g.docs.find((d) => d.kind === 'overview' && d.page === page) || { kind: 'overview', md: dir === '.' ? '' : `${dir}/`, page, title, status: '' };
    g.docs = [over, ...g.docs.filter((d) => d !== over)];
    return over;
  };
  // 화면설계서 장 파일은 메뉴에 파일마다 두지 않는다: 묶음 첫 항목 = 개요 쪽, 묶음 제목 옆 「설계서 보기」 버튼
  for (const g of groups) {
    const sheets = g.docs.filter((d) => d.kind === 'sheets');
    if (!sheets.length) continue;
    g.docs = g.docs.filter((d) => d.kind !== 'sheets');
    const over = overviewOf(g, path.dirname(sheets[0].md), '화면설계서 개요');
    over.sheetList = sheets;
    for (const sh of sheets) sh.back = over.page;
    g.sheets = sheets;
  }
  // 데이터 설계: 정의서가 든 폴더마다 ERD 쪽 하나. 정의서 md 는 메뉴에 그대로 두고, 개요 쪽 맨 위에 ERD 블록 · 묶음 제목 옆 「ERD 보기」 버튼
  const erds = [];
  if (opts.erd) {
    const byDir = new Map();
    for (const d of docs) if (d.kind === 'md' && !d.origin && DM.hasTables(files[d.md])) byDir.set(path.dirname(d.md), [...(byDir.get(path.dirname(d.md)) || []), d]);
    const taken = new Set(docs.map((d) => d.page));
    for (const [dir, ds] of [...byDir].sort()) {
      let page = dir === '.' ? 'erd.html' : `${dir}/erd.html`;
      if (taken.has(page)) page = page.replace(/erd\.html$/, 'erd-view.html');
      const e = { dir, page, docs: ds, model: DM.model(Object.fromEntries(ds.map((d) => [d.md, files[d.md]]))) };
      const g = groups.find((x) => x.docs.some((d) => ds.includes(d)));
      if (g) {
        const over = overviewOf(g, dir, '데이터 설계 개요');
        over.erdList = [...(over.erdList || []), e];
        e.back = over.page;
        e.title = over.kind === 'md' ? `${over.title} · ERD` : 'ERD';
        g.erds = [...(g.erds || []), e];
      } else e.title = 'ERD';
      erds.push(e);
    }
  }
  const flat = [];
  for (const g of groups) for (const d of g.docs) { d.groupName = g.group; flat.push(d); }
  const env0 = { docs, where, mdPages, opts, prefixRe, warnings, files, titleWords, docNames, groups, flat, splitPages, spa: new Set(), texts: [] };
  for (const d of docs) {
    if (d.kind === 'sheets') { pages[d.page] = sheetPage(d, opts.sheetTheme); continue; }
    pages[d.page] = mdPage(d, env0);
  }
  // 폴더 목록 페이지 (README 가 없는 폴더도)
  const dirs = new Set(['.']);
  for (const d of docs) { let x = path.dirname(d.md); while (x !== '.') { dirs.add(x); x = path.dirname(x); } }
  for (const dir of [...dirs].sort()) {
    const page = dir === '.' ? 'index.html' : `${dir}/index.html`;
    if (!pages[page]) pages[page] = folderPage(dir, page, docs, env0);
  }
  for (const g of groups) for (const d of g.docs) if (d.kind === 'overview' && !pages[d.page]) pages[d.page] = folderPage(d.md.replace(/\/$/, '') || '.', d.page, docs, env0);
  // 전체 인쇄: 쪽마다 넣지 않고, 이 쪽이 메뉴 순서대로 모든 문서를 불러와 한 번에 인쇄한다 (site.js)
  const autoPrint = ((opts.config || {}).printAll || {}).autoPrint !== false;
  pages[PRINT_PAGE] = layout({ page: PRINT_PAGE, kind: 'print', autoPrint, title: '전체 문서 인쇄', crumb: '인쇄', body: `<div id="print-all"${autoPrint ? '' : ' data-auto="0"'}><p class="print-status">문서를 불러오는 중…</p></div>`, toc: [] }, env0);

  // 3. 색인: 생성한 HTML 의 실제 id 만
  const ids = {};
  for (const [p, h] of Object.entries(pages)) {
    if (!/\.html$/.test(p)) continue;
    for (const m of String(h).matchAll(/(?<![\w-])id="([^"]+)"/g)) {
      if (!ID_FULL.test(m[1])) continue;
      (ids[m[1]] = ids[m[1]] || []).push(`${p}#${m[1]}`);
    }
  }
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, Array.isArray(o[k]) ? [...new Set(o[k])].sort() : o[k]]));
  const index = { docs: sorted(byName), ids: sorted(ids), prefixes };
  pages['assets/ids.json'] = `${JSON.stringify(index, null, 1)}\n`;
  // 왼쪽 메뉴: 쪽마다 넣지 않고 한 파일 (문서가 많아도 쪽 크기가 그대로). 주소는 사이트 맨 위 기준, site.js 가 그 쪽 기준으로 바꾸고 지금 문서를 표시한다
  // pages = 앱이 새로고침 없이 옮겨 다니는 쪽 (문서 · 폴더 · 전체 인쇄). 화면설계서 · ERD 뷰어는 따로 연다
  // v = 나중에 읽는 파일의 버전 (맨 끝에서 채운다)
  pages['assets/nav.js'] = `window.DS_NAV = ${JSON.stringify({ key: cfg.title || opts.title || '문서', groups: navData(groups), pages: [...env0.spa].sort(), v: {} }).replace(/</g, '\\u003c')};\n`;
  // 본문 검색 색인: 절(## · ###)마다 글자. 처음 검색할 때만 읽는다
  pages['assets/search-text.js'] = `/* 생성물: kedovi docs build. 본문 검색 색인 */\nwindow.DS_TEXT = ${JSON.stringify(env0.texts).replace(/</g, '\\u003c')};\n`;
  pages['assets/search.js'] = searchJs({
    pages: flat.map((d) => ({ u: d.page, t: d.navTitle === '개요' ? d.title : d.title, g: d.groupName, h: (d.toc || []).map((x) => [x.sid, x.text]) })),
    ids: Object.keys(index.ids).map((k) => [k, index.ids[k][0], (flat.find((d) => d.page === index.ids[k][0].split('#')[0]) || {}).title || '']),
  });
  for (const e of erds) pages[e.page] = erdPage(e, index, opts.erd);
  // mermaid 그림이 있는 사이트에만 mermaid 파일을 넣는다 (site.js 가 그 쪽에서만 읽는다)
  const mermaid = Object.entries(pages).some(([p, h]) => /\.html$/.test(p) && String(h).includes('<pre class="mermaid">'));
  for (const [p, c] of Object.entries({ ...(opts.assets || {}), ...(erds.length ? (opts.erd.assets || {}) : {}), ...(mermaid ? (opts.mermaid || {}) : {}) })) pages[p] = c;
  versionAssets(pages);
  return {
    pages, index, warnings: [...new Set(warnings)].sort(), collisions: collisionsOf(pages, mdPages), docs: docs.map(({ md, page, title, status, kind }) => ({ md, page, title, status, kind })),
    erds: erds.map((e) => ({ dir: e.dir, page: e.page, title: e.title, model: e.model })),
    // docs-site.json groups 어느 묶음에도 맞지 않아 메뉴 「기타」 로 간 문서
    unlisted: [...new Set(groups.filter((g) => g.rest).flatMap((g) => g.docs.map((d) => d.origin || d.md)))],
  };
}

/**
 * 사이트 파일 버전: 쪽이 부르는 assets/ 파일 주소에 내용 해시(?v=)를 붙인다. 다시 만들면 바뀐 파일만 주소가 바뀌어 브라우저가 옛 파일(메뉴 등)을 쓰지 않는다.
 * 나중에 읽는 파일(본문 색인 · mermaid)은 메뉴 파일(nav.js)의 v 에 적는다
 */
function versionAssets(pages) {
  const crypto = require('crypto');
  const hash = (p) => crypto.createHash('sha1').update(pages[p]).digest('hex').slice(0, 8);
  const late = ['assets/search-text.js', 'assets/mermaid/mermaid.min.js'].filter((p) => pages[p] != null);
  if (pages['assets/nav.js']) pages['assets/nav.js'] = String(pages['assets/nav.js']).replace('"v":{}', `"v":${JSON.stringify(Object.fromEntries(late.map((p) => [p, hash(p)])))}`);
  const ver = new Map();
  const vOf = (p) => { if (!ver.has(p)) ver.set(p, hash(p)); return ver.get(p); };
  for (const [p, h] of Object.entries(pages)) {
    if (!/\.html$/.test(p) || Buffer.isBuffer(h)) continue;
    pages[p] = String(h).replace(/(\s(?:src|href)=")((?:\.\.\/)*assets\/[^"?#]+)"/g, (m, a, u) => {
      const t = path.normalize(path.join(path.dirname(p), u));
      return pages[t] != null ? `${a}${u}?v=${vOf(t)}"` : m;
    });
  }
}

/** 대소문자를 구분하지 않는 PC(macOS · Windows)에서 같은 파일이 되는 출력 경로들. [[경로, 원본 md…]] (README.md 와 INDEX.md 가 같은 폴더에 있을 때 등) */
function collisionsOf(pages, mdPages) {
  const by = new Map();
  for (const p of Object.keys(pages)) by.set(p.toLowerCase(), [...(by.get(p.toLowerCase()) || []), p]);
  for (const [md, p] of Object.entries(mdPages)) by.set(`md:${p.toLowerCase()}`, [...(by.get(`md:${p.toLowerCase()}`) || []), md]);
  const out = [];
  for (const [k, l] of by) if (l.length > 1) out.push(k.startsWith('md:') ? `${k.slice(3)} ← ${l.join(' · ')}` : l.join(' · '));
  return out.sort();
}

// ───────────────────────── 화면 틀 (kedovi 가이드와 같은 틀: 상단 바 · 왼쪽 구분 메뉴 · 본문 머리 · 오른쪽 목차 · 이전/다음) ─────────────────────────

const ICONS = ['◆', '☰', '⬡', '▦', '▣', '◇', '▤', '●', '◈', '▧'];
// 끝의 「폴더/**」 는 그 폴더 아래 전부 (README.md · 하위 폴더 포함)
const globRe = (g) => new RegExp(`^${String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\/\*\*$/, '/\u0002').replace(/\*\*\/?/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.+')}$`);
const bandOf = (md) => { const m = /^(\d+)[-_ ]/.exec(path.basename(md)); return m ? Math.floor(Number(m[1]) / 10) : null; };

const words = (t) => String(t).split(/\s+[—–-]\s+|[\s·:()]+/).map((w) => w.replace(/[,.]$/, '')).filter((w) => w.length >= 2 && !/^\d+$/.test(w));
/** 묶음 이름: 제목들의 공통 낱말을 빼고 남은 부분을 「 · 」 로 (문서 하나뿐인 띠를 합친 묶음) */
function distinctWords(titles) {
  const common = new Set(commonWords(titles).split(' ').filter(Boolean));
  return titles.map((t) => words(t).filter((w) => !common.has(w)).slice(0, 2).join(' ')).filter(Boolean).join(' · ');
}
/** 제목들에 모두 있는 낱말 (첫 제목의 순서대로) */
function commonWords(titles) {
  if (titles.length < 2) return titles[0] || '';
  const toks = titles.map(words);
  return toks[0].filter((w) => toks.every((x) => x.includes(w))).join(' ');
}

/**
 * 왼쪽 메뉴 묶음 [{ group, icon, docs }].
 * 설정(docs-site.json groups: [{ group, icon, files: [glob], split }])이 있으면 그 순서대로, 맞지 않는 문서는 「기타」.
 * 없으면 기본: 폴더마다 한 묶음(이름 = 그 폴더 README 제목 · 문서 제목들의 공통 낱말 · 폴더 이름, 루트는 「시작」).
 * 한 폴더에 파일 이름 앞 번호 띠(00 · 10 · 20 …)가 여럿이면 README · 번호 없는 문서를 앞 묶음으로 두고 띠마다 나눈다.
 * 띠 이름은 문서 제목들의 공통 낱말, 문서 하나뿐인 띠가 이어지면 합쳐 서로 다른 낱말을 「 · 」 로 잇는다.
 */
function navGroups(docs, config) {
  const listed = docs.filter((d) => !d.folderPage);
  const order = (a, b) => { const x = a.origin || a.md, y = b.origin || b.md; return x === y ? (a.part || 0) - (b.part || 0) : x.localeCompare(y); };
  if (config && Array.isArray(config.groups) && config.groups.length) {
    const used = new Set();
    const out = config.groups.map((g, i) => {
      const res = (g.files || []).map(globRe);
      const ds = [];
      for (const re of res) for (const d of listed.filter((x) => !used.has(x) && re.test(x.origin || x.md)).sort(order)) { used.add(d); ds.push(d); }
      return { group: g.group || `묶음 ${i + 1}`, icon: g.icon || ICONS[i % ICONS.length], docs: ds, collapsed: !!g.collapsed, tree: !!g.tree };
    }).filter((g) => g.docs.length);
    const rest = listed.filter((d) => !used.has(d)).sort(order);
    if (rest.length) out.push({ group: '기타', icon: '…', docs: rest, rest: true });
    return out;
  }
  const byDir = new Map();
  for (const d of [...listed].sort(order)) { const dir = path.dirname(d.origin || d.md); byDir.set(dir, [...(byDir.get(dir) || []), d]); }
  const out = [];
  const isReadme = (d) => /^readme\.md$/i.test(path.basename(d.origin || d.md));
  const dirs = [...byDir.keys()].sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.localeCompare(b)));
  for (const dir of dirs) {
    const ds = byDir.get(dir);
    const readme = ds.filter(isReadme);
    // 번호 없는 문서(README 포함)는 앞에, 번호 붙은 문서는 띠(00 · 10 · 20 …)로
    const plainDocs = ds.filter((d) => !isReadme(d) && bandOf(d.origin || d.md) == null);
    const numbered = ds.filter((d) => !isReadme(d) && bandOf(d.origin || d.md) != null);
    const bands = [];
    for (const d of numbered) {
      const b = bandOf(d.origin || d.md);
      const last = bands[bands.length - 1];
      if (last && last.band === b) last.docs.push(d); else bands.push({ band: b, docs: [d] });
    }
    // 문서 하나뿐인 띠가 이어지면 합친다
    const merged = [];
    for (const b of bands) {
      const last = merged[merged.length - 1];
      if (last && last.single && b.docs.length === 1) { last.docs.push(...b.docs); continue; }
      merged.push({ docs: [...b.docs], single: b.docs.length === 1 });
    }
    const folderName = dir === '.' ? '시작' : (readme[0] && readme[0].part == null ? readme[0].title : null) || dir.split('/').pop().replace(/^\d+[-_]/, '');
    const head = [...readme, ...plainDocs];
    if (merged.length <= 1) {
      const all = [...head, ...(merged[0] ? merged[0].docs : [])];
      const titles = all.filter((d) => !isReadme(d)).map((d) => d.title);
      const name = dir === '.' || readme.length || titles.length < 2 ? folderName : commonWords(titles) || folderName;
      out.push({ group: name, docs: all });
      continue;
    }
    if (head.length) out.push({ group: folderName, docs: head });
    for (const b of merged) {
      const titles = b.docs.map((d) => d.title);
      const group = b.single && titles.length > 1 ? distinctWords(titles) : commonWords(titles) || titles.join(' · ');
      out.push({ group, docs: b.docs });
    }
  }
  return out.map((g, i) => ({ ...g, icon: ICONS[i % ICONS.length] }));
}

/**
 * 왼쪽 메뉴 자료 (assets/nav.js 의 groups, 주소는 사이트 맨 위 기준 쪽 경로). docs-site.json 묶음 옵션:
 *   collapsed: true  처음엔 접힌 묶음 (지금 문서가 든 묶음은 앱이 편다)
 *   tree: true       묶음 안 문서를 폴더대로 접히는 트리로 (issues/2024/… → 2024 ▸ …)
 * [{ k, group, icon, open, acts: [{ p, h, label }], items: [{ p, t } | { k, dir, items }] }]
 */
function navData(groups) {
  const item = (d) => ({ p: d.page, t: d.navTitle || d.title });
  // 묶음 제목 옆 바로 가기: 하나면 그 뷰어로, 여럿이면 개요 쪽의 그 블록으로
  const act = (list, hash, label) => {
    if (!list || !list.length) return null;
    return { p: list.length === 1 ? list[0].page : list[0].back || list[0].page, h: list.length === 1 ? '' : hash, label };
  };
  const dirOf = (d) => (d.kind === 'overview' ? String(d.md).replace(/\/$/, '') || '.' : path.dirname(d.origin || d.md));
  const tree = (g) => {
    const parts = g.docs.map((d) => (dirOf(d) === '.' ? [] : dirOf(d).split('/')));
    let common = parts[0] || [];
    for (const p of parts) { let n = 0; while (n < common.length && n < p.length && common[n] === p[n]) n++; common = common.slice(0, n); }
    const root = { docs: [], kids: new Map() };
    g.docs.forEach((d, i) => {
      let node = root;
      for (const seg of parts[i].slice(common.length)) { if (!node.kids.has(seg)) node.kids.set(seg, { docs: [], kids: new Map() }); node = node.kids.get(seg); }
      node.docs.push(d);
    });
    const draw = (node, key) => [...node.docs.map(item), ...[...node.kids].map(([seg, kid]) => ({ k: `${key}/${seg}`, dir: seg.replace(/^\d+[-_]/, '') || seg, items: draw(kid, `${key}/${seg}`) }))];
    return draw(root, g.group);
  };
  return groups.map((g) => ({
    k: g.group, group: g.group, icon: g.icon, open: !g.collapsed,
    acts: [act(g.sheets, 'sheet-docs', '설계서 보기'), act(g.erds, 'erd-docs', 'ERD 보기')].filter(Boolean),
    items: g.tree ? tree(g) : g.docs.map(item),
  }));
}

/** 메뉴 자료 → HTML (앱의 메뉴와 같은 틀. 점검 · 시험용) */
function navHtml(data) {
  const items = (list) => list.map((x) => (x.items
    ? `<details class="nav-dir" data-k="${esc(x.k)}"><summary>${esc(x.dir)}</summary>${items(x.items)}</details>`
    : `<a class="nav-link" href="${esc(x.p)}" data-p="${esc(x.p)}">${esc(x.t)}</a>`)).join('');
  const act = (a) => `<a class="nav-act" href="${esc(a.p)}${a.h ? `#${a.h}` : ''}" data-p="${esc(a.p)}" data-h="${a.h}" title="${a.label}" aria-label="${a.label}">▶</a>`;
  return data.map((g) => `<details class="nav-group"${g.open ? ' open' : ''} data-k="${esc(g.k)}"><summary class="nav-title"><span class="ico">${esc(g.icon)}</span>${esc(g.group)}${g.acts.map(act).join('')}</summary>${items(g.items)}</details>`).join('');
}

/** 로고 글자: 설정 logo → 제목 첫 낱말이 2~3자 영문 약어면 그대로 대문자(「XD 분석」 → XD) → 앞 두 낱말 첫 글자 */
function logoOf(cfg, site) {
  if (cfg.logo) return cfg.logo;
  const ws = String(site).split(/[\s\-_]+/).filter(Boolean);
  if (ws[0] && /^[A-Za-z]{2,3}$/.test(ws[0])) return ws[0].toUpperCase();
  return ws.slice(0, 2).map((w) => w[0]).join('').toLowerCase() || 'd';
}

/** 머리 줄 아이콘: Lucide (ISC 라이선스, https://lucide.dev) 선 아이콘의 SVG 경로만 옮겼다 */
const ICON_PATHS = {
  ink: '<path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  print: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
  theme: '<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>',
};
const svgIcon = (k) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[k]}</svg>`;

/** 쪽 하나: 가이드와 같은 틀. a = { page, title, crumb, h1Html, lead, src, body, toc: [{ lvl, sid, text }] } */
const PRINT_PAGE = 'print-all.html';

function layout(a, env) {
  const { opts, flat } = env;
  const r = rootOf(a.page);
  const cfg = opts.config || {};
  const site = cfg.title || opts.title || '문서';
  const logo = logoOf(cfg, site);
  const i = flat.findIndex((d) => d.page === a.page);
  env.spa.add(a.page);
  const pg = (d, cls, label) => (d ? `<a class="${cls}" href="${esc(relLink(a.page, d.page))}"><small>${label} · ${esc(d.groupName)}</small>${esc(d.navTitle || d.title)}</a>` : '<span></span>');
  const pager = i < 0 ? '' : `<div class="pager">${pg(flat[i - 1], 'prev', '이전')}${pg(flat[i + 1], 'next', '다음')}</div>`;
  const toc = (a.toc || []).length ? a.toc.map((x) => `<a class="l${x.lvl}" href="#${esc(x.sid)}" data-id="${esc(x.sid)}">${esc(x.text)}</a>`).join('') : `<div class="empty">${esc(a.title)}</div>`;
  const title = `${a.title}${a.title !== site ? ` · ${site}` : ''}`;
  const src = a.src && /^https?:\/\//i.test(a.src) ? a.src : null;
  const near = (d) => (d ? { p: d.page, t: d.navTitle || d.title, g: d.groupName } : null);
  // 앱(site.js)이 쓰는 이 쪽 정보: 본문(.ds-body)은 HTML 그대로 두고 그 밖의 화면은 이것으로 그린다
  const meta = {
    page: a.page, kind: a.kind || 'doc', title: a.title, head: title, crumb: a.crumb || '', status: a.status || '', h1: a.h1Html || esc(a.title), lead: a.lead || '',
    src: src ? { href: src, name: path.basename(a.srcName || '') } : null, toc: a.toc || [], prev: i < 0 ? null : near(flat[i - 1]), next: i < 0 ? null : near(flat[i + 1]),
    ...(a.kind === 'print' ? { autoPrint: a.autoPrint !== false } : {}),
  };
  const site0 = { title: site, logo, version: cfg.version || '', ink: cfg.ink !== false };
  return `<!doctype html>
<html lang="ko" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="kedovi docs">
<title>${esc(title)}</title>
<script>try { var t = localStorage.getItem('kedovi-docs-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}</script>
<link rel="stylesheet" href="${r}assets/site.css">
<link rel="icon" href="data:,">
</head>
<body data-root="${r}">
<div id="ds-app">
<header>
  <div class="left"><button class="menu-btn" id="menu" type="button" aria-label="메뉴" aria-expanded="false" aria-controls="side-nav">☰</button><a class="brand" href="${r}index.html"><span class="logo">${esc(logo)}</span>${esc(site)}</a></div>
  <div class="search"><input id="q" placeholder="검색 (제목 · 본문 · ID)" autocomplete="off"><kbd>⌘K</kbd><div class="results" id="results"></div></div>
  <div class="tools"><span>${esc(cfg.version || '')}</span>${cfg.ink === false ? '' : `<button id="ink" type="button" title="펜 필기 (끝내기: Esc)" aria-label="펜 필기" aria-pressed="false">${svgIcon('ink')}</button>`}<button id="print" type="button" title="인쇄 (이 문서 · 전체 문서)" aria-label="인쇄" aria-haspopup="true">${svgIcon('print')}</button><button id="theme" type="button" title="테마" aria-label="테마">${svgIcon('theme')}</button></div>
</header>
<div class="layout">
  <nav class="side" id="side-nav" data-page="${esc(a.page)}"><noscript><a class="nav-link" href="${r}index.html">문서 목록</a></noscript></nav><div class="nav-backdrop" id="nav-backdrop"></div>
  <main id="main"><article class="page">
<div class="page-head"><div><div class="crumb">${esc(a.crumb || '')}${a.badge || ''}</div><h1>${a.h1Html || esc(a.title)}</h1>${a.lead ? `<p class="lead">${a.lead}</p>` : ''}</div>${src ? `<a class="src" href="${esc(src)}" title="원본 md">원본 ${esc(path.basename(a.srcName || ''))}</a>` : ''}</div>
<div class="ds-body">
${a.body}
</div>
</article>
  ${pager}</main>
  <aside class="toc"><div class="toc-title">이 페이지</div><div id="toc">${toc}</div></aside>
</div>
</div>
<script type="application/json" id="ds-page">${JSON.stringify({ ...meta, site: site0 }).replace(/</g, '\\u003c')}</script>
<script src="${r}assets/search.js"></script>
<script src="${r}assets/nav.js"></script>
<script src="${r}assets/vendor.js"></script>
<script src="${r}assets/site.js"></script>
</body>
</html>
`;
}

/** 본문 HTML → 검색 색인 [{ u: 쪽, h: 절 id, t: 절 제목, x: 글자 }] (## · ### 마다, 절마다 글자 수 제한) */
const TEXT_MAX = 4000;
const unhtml = (h) => String(h).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function textsOf(page, title, html) {
  const out = [];
  const parts = String(html).split(/(?=<h[23] id=")/);
  for (const part of parts) {
    const m = /^<h[23] id="([^"]+)">([\s\S]*?)<\/h[23]>/.exec(part);
    const t = m ? unhtml(m[2].replace(/<a class="anchor"[\s\S]*?<\/a>/, '')) : title;
    const x = unhtml(m ? part.slice(m[0].length) : part).slice(0, TEXT_MAX);
    if (x) out.push({ u: page, h: m ? m[1] : '', t, x });
  }
  return out;
}

const badge = (st) => (st ? ` <span class="ds-badge" data-status="${esc(st)}">${esc(st)}</span>` : '');

/** 원본 md 보기 주소: 설정 source(예: https://host/group/repo/-/blob/main) + 경로 */
const srcUrl = (cfg, md) => (cfg && cfg.source ? `${String(cfg.source).replace(/\/+$/, '')}/${md.split('/').map(encodeURIComponent).join('/')}` : null);

/** README 처럼 ## 마다 쪽을 나눌 문서 → 조각 [{ key, text, part, origin, section }] */
function splitDoc(k, text) {
  const lines = String(text).split('\n');
  const out = [];
  let fence = false;
  let h1 = '';
  let cur = { section: null, lines: [] };
  const parts = [];
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    if (!fence && /^#\s+/.test(l) && !h1) { h1 = l; continue; }
    if (!fence && /^##\s+/.test(l)) { parts.push(cur); cur = { section: l.replace(/^##\s+/, '').trim(), lines: [] }; continue; }
    cur.lines.push(l);
  }
  parts.push(cur);
  const dir = path.dirname(k);
  const base = path.basename(k, '.md');
  const used = new Set();
  parts.forEach((p, n) => {
    if (n === 0) { out.push({ key: k, text: [h1 || `# ${base}`, ...p.lines].join('\n'), part: 0, origin: k, section: null }); return; }
    let s = plain(p.section).toLowerCase().replace(/[^\w가-힣\s-]/g, '').trim().replace(/\s+/g, '-') || `part-${n}`;
    let key = s;
    for (let x = 2; used.has(key); x++) key = `${s}-${x}`;
    used.add(key);
    const file = `${dir === '.' ? '' : `${dir}/`}${base}--${key}.md`;
    out.push({ key: file, text: [`# ${p.section}`, ...p.lines].join('\n'), part: n, origin: k, section: p.section, slug: key });
  });
  return out;
}

/** 검색 색인: 쪽 제목 · 소제목 · 정의 ID (file:// 로도 열리게 JS 로) */
function searchJs(entries) {
  return `/* 생성물: kedovi docs build. 검색 색인 */\nwindow.DS_SEARCH = ${JSON.stringify(entries).replace(/</g, '\\u003c')};\n`;
}

/**
 * 결정 기록 표인가: 첫 칸이 ID 인 행이 대부분(80% 이상)이고 머리에 「결정」 칸과 대안 · 이유 · 영향 중 하나가 있다.
 * → { what: 결정 칸, status: 상태 칸(-1), rest: 펼쳐 보일 칸 } | null
 */
function decisionCols(b) {
  const h = b.head.map((c) => plain(c));
  const what = h.findIndex((c, j) => j > 0 && /결정/.test(c) && !/ID|번호|날짜/.test(c));
  if (what < 0 || !h.some((c) => /대안|이유|근거|영향/.test(c)) || !b.rows.length) return null;
  if (b.rows.filter((r) => ID_FULL.test(plain(r[0] || '').split(/\s+/)[0])).length < b.rows.length * 0.8) return null;
  const status = h.findIndex((c, j) => j > 0 && /^상태$/.test(c));
  return { what, status, rest: h.map((_, j) => j).filter((j) => j > 0 && j !== what && j !== status) };
}

function mdPage(d, env) {
  const { docs, where, mdPages, opts, prefixRe, warnings, titleWords, docNames, splitPages } = env;
  const page = d.page;
  // 정의 위치: 블록 → [ID] (행 정의는 블록.rowIds)
  const defsAt = new Map();
  const rowDefs = new Map();
  const itemDefs = new Map();
  for (const [id, w] of d.defs) {
    if (w.row != null) { const m = rowDefs.get(w.block) || {}; m[w.row] = id; rowDefs.set(w.block, m); }
    else if (w.item) itemDefs.set(w.item, [...(itemDefs.get(w.item) || []), id]);
    else defsAt.set(w.block, [...(defsAt.get(w.block) || []), id]);
  }
  const own = new Set(d.defs.keys());
  const link = (u, img) => {
    if (/^(https?:|mailto:)/i.test(u)) return u;
    if (/^#/.test(u)) return u;
    if (/^[a-z][\w+.-]*:/i.test(u)) return null; // javascript: 등
    const [p, hash] = u.split('#');
    const target = path.normalize(path.join(path.dirname(d.md), decodeURI(p)));
    if (/\.md$/i.test(target) && splitPages[target] && hash) {
      // ## 마다 나눈 문서: 그 절의 쪽으로
      const sl = plain(decodeURIComponent(hash)).toLowerCase().replace(/[^\w가-힣\s-]/g, '').trim().replace(/\s+/g, '-');
      if (splitPages[target][sl]) return relLink(page, mdPages[splitPages[target][sl]]);
    }
    if (/\.md$/i.test(target) && mdPages[target]) return relLink(page, mdPages[target]) + (hash ? `#${hash}` : '');
    if (/\.html?$/i.test(target) && docs.some((x) => x.page === target)) return relLink(page, target) + (hash ? `#${hash}` : '');
    if (img && IMG_EXT.test(target) && env.files[target] != null) return relLink(page, target);
    if (opts.linkable && opts.linkable.has(target)) return relLink(page, target) + (hash ? `#${hash}` : ''); // 생성기가 따로 넣는 파일 (쓰기 보고서 사본 등)
    const dir = target.replace(/\/$/, '');
    if (!/\.\w+$/.test(dir) && docs.some((x) => x.md.startsWith(`${dir === '.' ? '' : `${dir}/`}`))) return relLink(page, dir === '.' ? 'index.html' : `${dir}/index.html`); // 폴더 → 그 폴더 목록 페이지
    return opts.fileUrl ? opts.fileUrl(target) : null; // 사이트 밖 파일: 주는 쪽이 있으면 그 주소 (킷 가이드 = repo 파일 보기)
  };
  const pageOfDoc = (href) => {
    const m = /href="([^"#]+)/.exec(href);
    if (!m) return null;
    return path.normalize(path.join(path.dirname(page), m[1]));
  };
  // ID 잇기. h = 이스케이프된 글자(숨긴 조각은 \0n\0), defIds = 이 자리가 정의하는 ID
  const ids = (h, defIds, keep, skip) => {
    const done = new Set();
    let out = '';
    let last = 0;
    let ctxDoc = null; // 바로 앞에 쓴 다른 문서 (링크 · xxx.md)
    const re = new RegExp(ID_IN_TEXT.source, 'g');
    let m;
    while ((m = re.exec(h))) {
      const id = m[1];
      const before = h.slice(last, m.index);
      // 앞 글자: 다른 문서 언급 뒤에 ID 목록이 이어지는가
      const tail = h.slice(0, m.index).replace(/\u0000(\d+)\u0000/g, (_, k) => (/<a\b/.test(keep[+k]) ? `\u0001${k}\u0001` : ''));
      const docLink = /\u0001(\d+)\u0001\s*((?:[A-Z][\w-]*\s*(?:·|,|~|\+)\s*)*)$/.exec(tail);
      const mdName = /([\w-]+\.md)\s*((?:[A-Z][\w-]*\s*(?:·|,|~|\+)\s*)*)$/.exec(tail);
      if (docLink) ctxDoc = pageOfDoc(keep[+docLink[1]]);
      else if (mdName) ctxDoc = (docs.find((x) => path.basename(x.md) === mdName[1]) || {}).page || '?';
      else if (!/^\s*(?:·|,|~|\+)\s*$/.test(before)) ctxDoc = null;
      out += before;
      last = m.index + id.length;
      if (defIds.includes(id) && !done.has(id)) { out += `<span id="${id}">${id}</span>`; done.add(id); continue; }
      if (skip.includes(id)) { out += id; continue; }
      // 여러 페이지에 있는 ID(문서마다 매기는 결정 번호) 앞에 다른 문서 제목의 낱말이 있으면 그 문서 것이다 (「뉴스 설계 D1-1 · D1-2」)
      let named = null;
      if (!ctxDoc && where.has(id) && where.get(id).size > 1) {
        const words = tail.replace(/\u0001\d+\u0001/g, ' ').replace(/<[^>]+>/g, ' ')
          .replace(new RegExp(`(?:${ID_SRC}\\s*(?:·|,|~|\\+)\\s*)*$`), '').split(/[\s()[\]「」:;,.·]+/).filter(Boolean).slice(-3);
        const mine = titleTokens(d.title);
        // 가까운 낱말부터: 문서 이름(30-design-news) 이나 다른 문서 제목에만 있는 낱말. 그 ID 를 가진 문서가 하나로 좁혀지면 그 문서, 여럿이면 잇지 않는다
        for (const w of words.reverse()) {
          const hit = [...new Set([...(docNames.has(w) ? [docNames.get(w)] : []), ...(mine.includes(w) ? [] : titleWords.get(w) || [])])].filter((p) => p !== page);
          if (!hit.length) continue;
          const has = hit.filter((p) => where.get(id).has(p));
          if (!has.length) continue; // 그 낱말의 문서가 이 ID 를 정의하지 않으면 우연히 같은 낱말이다
          named = has.length === 1 ? has[0] : '?';
          break;
        }
      }
      const hrefOf = (x) => {
        const other = named || (ctxDoc && ctxDoc !== page ? ctxDoc : null);
        if (other) return other !== '?' && where.has(x) && where.get(x).has(other) ? `${relLink(page, other)}#${x}` : null;
        if (own.has(x)) return `#${x}`;
        if (where.has(x) && where.get(x).size === 1) return `${relLink(page, [...where.get(x)][0])}#${x}`;
        return null;
      };
      const href = hrefOf(id);
      if (href) {
        out += `<a class="ds-id" href="${esc(href)}">${id}</a>`;
        // 줄여 쓴 이어지는 번호: 「VS-ADM-04 · 05 · 07」 의 05 · 07 도 같은 머리의 ID 로 잇는다 (자릿수가 같을 때)
        const head = id.replace(/\d+$/, '');
        const width = id.match(/\d+$/)[0].length;
        let cm;
        while ((cm = /^(\s*(?:·|,)\s*)(\d+)(?![\w-])/.exec(h.slice(last))) && cm[2].length === width) {
          const h2 = hrefOf(head + cm[2]);
          if (!h2) break;
          out += `${cm[1]}<a class="ds-id" href="${esc(h2)}">${cm[2]}</a>`;
          last += cm[0].length;
        }
        re.lastIndex = last;
      }
      else if (!where.has(id) && prefixRe && prefixRe.test(id) && !ctxDoc) {
        out += `<span class="ds-broken" title="정의를 찾지 못한 ID">${id}</span>`;
        warnings.push(`${d.md}: ${id} 정의 없음`);
      } else out += id;
    }
    return out + h.slice(last);
  };
  const ctx = { page, link, ids };
  const L = (t, defIds, skip) => inline(t, ctx, defIds, skip);
  const toc = [];
  const slugs = new Set();
  const slug = (t) => {
    let s = plain(t).toLowerCase().replace(/[^\w가-힣\s-]/g, '').trim().replace(/\s+/g, '-') || 's';
    let k = s;
    for (let n = 2; slugs.has(k); n++) k = `${s}-${n}`;
    slugs.add(k);
    return k;
  };
  const render = (bs) => bs.map((b) => {
    const defIds = defsAt.get(b) || [];
    if (b.t === 'h') {
      if (b.lvl === 1) return '';
      const sid = slug(b.text);
      if (b.lvl <= 3) toc.push({ lvl: b.lvl, sid, text: plain(b.text) });
      return `<h${b.lvl} id="${sid}">${L(b.text, defIds)}<a class="anchor" href="#${sid}" aria-label="이 절 주소">#</a></h${b.lvl}>`;
    }
    if (b.t === 'p') return `<p${b.src ? ' class="q-src"' : ''}>${L(b.text, defIds)}</p>`;
    if (b.t === 'hr') return '<hr>';
    if (b.t === 'code' && /^mermaid$/i.test(b.lang || '')) return `<div class="diagram"><div class="diagram-tools"><button class="mm-zoom" type="button" title="크게 보기">확대</button><button class="mm-open" type="button" title="새 창에서 보기">새 창</button></div><pre class="mermaid">${esc(b.text)}</pre></div>`;
    if (b.t === 'code') return `<div class="code"><button class="copy" type="button">복사</button><pre><code${b.lang ? ` class="lang-${esc(b.lang)}"` : ''}>${esc(b.text)}</code></pre></div>`;
    if (b.t === 'quote') return `<blockquote>${render(quoteSrc(b.blocks))}</blockquote>`;
    if (b.t === 'list') {
      const list = (l) => `<${l.ordered ? `ol${l.start ? ` start="${l.start}"` : ''}` : 'ul'}>${l.items.map((it) => `<li${it.task != null ? ' class="ds-task"' : ''}>${it.task != null ? `<input type="checkbox" disabled${it.task ? ' checked' : ''}> ` : ''}${L(it.text, itemDefs.get(it))}${it.blocks ? render(it.blocks) : ''}${it.kids ? list(it.kids) : ''}</li>`).join('')}</${l.ordered ? 'ol' : 'ul'}>`;
      return list(b);
    }
    if (b.t === 'table') {
      const rows = rowDefs.get(b) || {};
      const n = b.head.length;
      const dec = decisionCols(b);
      if (dec) {
        // 결정 기록 표: 한 줄(ID · 결정 · 상태) 목록, 펼치면 대안 · 이유 · 영향 카드
        const items = b.rows.map((r, k) => {
          const rid = rows[k];
          const C = (t) => L(t, [], rid ? [rid] : []);
          const more = dec.rest.filter((j) => (r[j] || '').trim()).map((j) => `<dt>${L(b.head[j])}</dt><dd>${C(r[j])}</dd>`).join('');
          const st = dec.status >= 0 ? plain(r[dec.status] || '') : '';
          const line = `<span class="ds-dec-id">${C(r[0] || '')}</span><span class="ds-dec-t">${C(r[dec.what] || '')}</span>${st ? badge(st) : ''}`;
          return more ? `<details class="ds-dec"${rid ? ` id="${rid}"` : ''}><summary>${line}</summary><dl>${more}</dl></details>`
            : `<div class="ds-dec ds-dec-one"${rid ? ` id="${rid}"` : ''}>${line}</div>`;
        }).join('');
        return `<div class="ds-decs">${items}</div>`;
      }
      const head = b.head.map((c) => `<th>${L(c)}</th>`).join('');
      // 넓고 칸이 긴 표(4칸 이상 · 칸 평균 40자 넘음): 좁은 화면에서 행마다 카드로 (칸 이름 = data-label)
      const all = b.rows.flat().filter((c) => c && c.trim());
      const wide = n >= 4 && all.length > 0 && all.reduce((a, c) => a + seen(c), 0) / all.length > 40;
      const labels = b.head.map((c) => (wide ? esc(plain(c)) : ''));
      const fold = Number(opts.cellFold) > 0 ? Number(opts.cellFold) : CELL_FOLD;
      const body = b.rows.map((r, k) => {
        const rid = rows[k];
        const tds = Array.from({ length: Math.max(n, r.length) }, (_, j) => `<td${labels[j] ? ` data-label="${labels[j]}"` : ''}>${foldCell(r[j] || '', (t) => L(t, [], rid ? [rid] : []), fold)}</td>`);
        return `<tr${rid ? ` id="${rid}"` : ''}>${tds.join('')}</tr>`;
      }).join('');
      return `<div class="table${wide ? ' ds-cards' : ''}"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    }
    return '';
  }).join('\n');
  const h1 = d.blocks.find((b) => b.t === 'h' && b.lvl === 1);
  const content = render(d.blocks);
  d.toc = toc;
  const origin = d.origin || d.md;
  const isReadme = /^readme\.md$/i.test(path.basename(origin)) && !d.part;
  env.texts.push(...textsOf(page, d.title, content));
  return layout({
    page, title: d.title, crumb: d.groupName || path.dirname(origin), badge: badge(d.status), status: d.status,
    h1Html: h1 ? L(h1.text, defsAt.get(h1) || []) : esc(d.title),
    src: opts.srcOf ? opts.srcOf(origin) : srcUrl(opts.config, origin), srcName: origin,
    // 화면설계 개요: 설계서 블록을 본문 맨 위에 (README 가 길어도 장 수 · 묶음별 화면 · 설계서 보기가 먼저 보이게)
    body: `${d.sheetList ? sheetsHtml(d.sheetList, page) : ''}${d.erdList ? erdHtml(d.erdList, page) : ''}${content}${isReadme ? listHtml(path.dirname(origin), page, docs, env) : ''}`,
    toc: [...(d.sheetList ? [{ lvl: 2, sid: 'sheet-docs', text: '화면설계서' }] : []), ...(d.erdList ? [{ lvl: 2, sid: 'erd-docs', text: '데이터 설계 · ERD' }] : []), ...toc],
  }, env);
}

/** 화면설계서 개요 블록: 설계서 파일마다 장 수 · 「설계서 보기」 · 묶음(data-group)별 화면 목록 */
function sheetsHtml(sheets, page) {
  const out = ['<h2 id="sheet-docs">화면설계서</h2>'];
  for (const sh of sheets) {
    const href = relLink(page, sh.page);
    const byGroup = new Map();
    for (const x of sh.sheets || []) byGroup.set(x.group, [...(byGroup.get(x.group) || []), x]);
    out.push(`<div class="ds-sheetdoc"><div class="ds-sheethead"><b>${esc(sh.title)}</b> <span class="ds-muted">장 ${(sh.sheets || []).length} · ${esc(sh.md)}</span> <a class="ds-btn" href="${esc(href)}">▶ 설계서 보기</a></div>`);
    out.push(`<div class="table"><table><thead><tr><th>묶음</th><th>장</th></tr></thead><tbody>${[...byGroup].map(([grp, xs]) => `<tr><td>${esc(grp)}</td><td>${xs.map((x) => (x.id ? `<a href="${esc(href)}#${esc(x.id)}">${esc(x.label)}</a>` : esc(x.label))).join(' · ')}</td></tr>`).join('')}</tbody></table></div></div>`);
  }
  return out.join('\n');
}

/** 폴더 아래 문서 표: 메뉴 묶음마다 제목 + 표 (문서 · 파일 · 상태) */
function listHtml(dir, page, docs, env) {
  const inDir = (d) => (dir === '.' || (d.origin || d.md).startsWith(`${dir}/`)) && d.page !== page && !d.part && !(d.origin && d.origin !== d.md) && d.kind !== 'overview'
    && !/^readme\.md$/i.test(path.basename(d.origin || d.md));
  const rel = (d) => (dir === '.' ? d.md : d.md.slice(dir.length + 1));
  const row = (d) => `<tr><td><a href="${esc(relLink(page, d.page))}">${esc(d.title)}</a></td><td>${esc(rel(d))}</td><td>${d.kind === 'sheets' ? `화면설계서 · 장 ${(d.sheets || []).length}` : esc(d.status)}</td></tr>`;
  const table = (ds) => `<div class="table"><table><thead><tr><th>문서</th><th>파일</th><th>상태</th></tr></thead><tbody>${ds.map(row).join('')}</tbody></table></div>`;
  const out = [];
  const seen = new Set();
  for (const g of (env && env.groups) || []) {
    const ds = [...g.docs, ...(g.sheets || [])].filter((d) => inDir(d) && !seen.has(d));
    if (!ds.length) continue;
    ds.forEach((d) => seen.add(d));
    out.push(`<h3 id="docs-${esc(g.group.replace(/\s+/g, '-'))}"><span class="ico">${esc(g.icon)}</span> ${esc(g.group)}</h3>`, table(ds));
  }
  const rest = docs.filter((d) => inDir(d) && !seen.has(d)).sort((a, b) => a.md.localeCompare(b.md));
  if (rest.length) out.push(out.length ? '<h3 id="docs-rest">기타</h3>' : '', table(rest));
  return out.length ? `<h2 id="docs-list">문서</h2>\n${out.join('\n')}` : '';
}

function folderPage(dir, page, docs, env) {
  const over = env.groups.flatMap((g) => g.docs).find((d) => d.kind === 'overview' && d.page === page);
  const title = over ? over.title : dir === '.' ? ((env.opts.config || {}).title || env.opts.title || '문서') : dir;
  const group = env.groups.find((g) => g.docs.includes(over));
  const body = `${over && over.sheetList ? sheetsHtml(over.sheetList, page) : ''}${over && over.erdList ? erdHtml(over.erdList, page) : ''}${listHtml(dir, page, docs, env)}` || '<p>문서가 없습니다.</p>';
  return layout({ page, title, crumb: group ? group.group : '폴더', body, toc: [] }, env);
}

/** 데이터 설계 개요 블록: 폴더마다 스키마 · 테이블 · 관계 수 · 「ERD 보기」 · 스키마별 테이블 */
function erdHtml(list, page) {
  const out = ['<h2 id="erd-docs">데이터 설계 · ERD</h2>'];
  for (const e of list) {
    const href = relLink(page, e.page);
    const m = e.model;
    out.push(`<div class="ds-sheetdoc"><div class="ds-sheethead"><b>${esc(e.title)}</b> <span class="ds-muted">스키마 ${m.schemas.length} · 테이블 ${m.tables.length} · 관계 ${m.rels.length}${(m.lrels || []).length ? ` · 논리 참조 ${m.lrels.length}` : ''} · ${esc(e.dir === '.' ? '/' : `${e.dir}/`)}</span> <a class="ds-btn" href="${esc(href)}">▶ ERD 보기</a></div>`);
    out.push(`<div class="table"><table><thead><tr><th>스키마</th><th>테이블</th></tr></thead><tbody>${m.schemas.map((s) => `<tr><td>${esc(s)}</td><td>${m.tables.filter((t) => t.schema === s).map((t) => `<a href="${esc(href)}#${esc(t.id)}" title="${esc(t.id)}">${esc(t.logical || t.name)}</a>`).join(' · ')}</td></tr>`).join('')}</tbody></table></div></div>`);
  }
  return out.join('\n');
}

/** ERD 뷰어 쪽: 모델(정의서 · 정의서 쪽 주소 · 근거 ID 주소)을 뷰어 틀(datamodel 팩 viewer.html)에 넣는다 */
function erdPage(e, index, erd) {
  const r = rootOf(e.page);
  const m = e.model;
  const refs = {};
  const sidOf = new Map(); // 「### 제목」 → 정의서 쪽의 절 id (mdPage 가 만든 목차)
  for (const d of e.docs) for (const x of d.toc || []) if (x.lvl === 3) sidOf.set(`${d.md}\u0000${x.text}`, `${relLink(e.page, d.page)}#${x.sid}`);
  const tables = m.tables.map((t) => {
    for (const id of [...t.fns, ...t.refs]) if (index.ids[id] && !refs[id]) refs[id] = index.ids[id].map((h) => { const [p, hash] = h.split('#'); return `${relLink(e.page, p)}#${hash}`; });
    const { file, line, heading, ...rest } = t;
    return { ...rest, src: sidOf.get(`${file}\u0000${plain(heading)}`) || null, columns: t.columns.map(({ line: l, ...c }) => c) };
  });
  const model = { title: e.title, schemas: m.schemas, tables, conv: erd.conv || {}, refs: Object.fromEntries(Object.keys(refs).sort().map((k) => [k, refs[k]])) };
  return String(erd.shell)
    .replace(/%TITLE%/g, () => esc(e.title)).replace(/%ROOT%/g, () => r)
    .replace(/%BACK%/g, () => esc(e.back ? `${relLink(e.page, e.back)}#erd-docs` : `${r}index.html`))
    .replace('/*%MODEL%*/null', () => JSON.stringify(model).replace(/</g, '\\u003c'));
}

/** 화면설계서 장 HTML: 뷰어 파일 경로 · data-root 를 이 위치에 맞춘다 (나머지는 그대로). theme = 색 프리셋 (장 파일에 data-theme 가 없을 때만) */
function sheetPage(d, theme) {
  const r = rootOf(d.page);
  let h = d.html
    .replace(/(<link\b[^>]*href=")[^"]*storyboard\.css(")/, `$1${r}assets/storyboard/storyboard.css$2`)
    .replace(/(<script\b[^>]*src=")[^"]*storyboard\.js(")/, `$1${r}assets/storyboard/storyboard.js$2`);
  // 뷰어가 쓰는 화면 라이브러리(Preact + htm)를 뷰어 앞에
  if (!/assets\/vendor\.js"/.test(h)) h = h.replace(/(<script\b[^>]*src="[^"]*storyboard\.js")/, `<script src="${r}assets/vendor.js"></script>\n$1`);
  h = /<body\b[^>]*\bdata-root="/.test(h) ? h.replace(/(<body\b[^>]*\bdata-root=")[^"]*(")/, (_, a, b) => `${a}${r}${b}`) : h.replace(/<body\b/, `<body data-root="${r}"`);
  // 뷰어 「← 문서」 버튼이 돌아갈 곳: 화면설계 개요 쪽 (없으면 뷰어가 사이트 메인으로)
  const back = d.back ? `${relLink(d.page, d.back)}#sheet-docs` : null;
  if (theme && !/<body\b[^>]*\bdata-theme="/.test(h)) h = h.replace(/<body\b/, `<body data-theme="${esc(theme)}"`);
  if (back) h = /<body\b[^>]*\bdata-back="/.test(h) ? h.replace(/(<body\b[^>]*\bdata-back=")[^"]*(")/, (_, a, b) => `${a}${esc(back)}${b}`) : h.replace(/<body\b/, `<body data-back="${esc(back)}"`);
  return h;
}

module.exports = { build, navHtml, parse, findDefs, docInfo, pageOf, wanted, inline, globRe, ID_FULL, ID_SRC };
