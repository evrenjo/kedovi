// 워크스페이스 문서 사이트의 빌드 DB (assets/site-db.json, 판 2): 사이트 화면이 브라우저에서 읽는 색인 하나.
// 기능(머리 줄 · 명세 · 설계 · 검증 절) · 마일스톤 · 문서 목록 · ID 색인 · 기능별 관계 · 최근 바뀜(git) · 팀 · 설정(허용 목록) ·
// 이슈 · 작업 항목 · 게시판 · 자료실 파일 · 의견 · 원격 · API 명세 · 인터페이스 명세(OpenAPI · AsyncAPI) · 유형 · 분야 프로필(lib/profile.js)과 대시보드 숫자.
// 원격에서 읽은 것은 siteremote.js 가 정리해 넘긴다. Node 기본 모듈만.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STAGES = ['명세', '설계', '구현', '검증', '배포'];
const FEATURE_DIR = '기능';
const BOARD_DIR = '자료실/게시판';
const FILES_DIR = '자료실';
const COMMENTS_DIR = '.comments';
const ID_RE = /(?<![\w-])[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+(?![\w-])/g;
const ISSUE_RE = /(?<![\w/&])#\d+\b/g;
const MAX_FILE = 25 * 1024 * 1024; // 자료실 파일 하나의 상한 (사이트에 복사)
const CLOSED = /^(닫힘|완료|해결|closed|done)$/i;

const uniq = (a) => [...new Set(a.filter(Boolean))];
const idsIn = (text) => uniq(String(text || '').match(ID_RE) || []);
const kindOf = (id) => (String(id).startsWith('#') ? 'ISSUE' : String(id).split('-')[0]);
const placeholder = (s) => /<[^<>]*>/.test(String(s));

// ───────── md 읽기 ─────────

/** md 표 칸 → 글자 (링크 · 굵게 · 코드 표시를 걷는다) */
function plain(cell) {
  return String(cell || '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/\\\|/g, '|').trim();
}
function splitRow(line) {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; }
    if (s[i] === '|') { out.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out.map(plain);
}

/** md 의 표들 [{ h2, h3, head, rows }] (코드 블록 안은 뺀다) */
function mdTables(text) {
  const lines = String(text).split('\n');
  const out = [];
  let h2 = '', h3 = '', fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    let m;
    if ((m = /^##\s+(.+?)\s*#*$/.exec(l))) { h2 = m[1].trim(); h3 = ''; continue; }
    if ((m = /^#{3,4}\s+(.+?)\s*#*$/.exec(l))) { h3 = m[1].trim(); continue; }
    if (/^\s*\|/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const head = splitRow(l);
      const rows = [];
      let j = i + 2;
      for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push(splitRow(lines[j]));
      out.push({ h2, h3, head, rows });
      i = j - 1;
    }
  }
  return out;
}

/** 제목 줄의 정의 ID → 제목 ({ ID: 글 }) */
function headingTitles(text) {
  const out = {};
  for (const m of String(text).matchAll(/^#{1,4}\s+(.+)$/gm)) {
    const ids = idsIn(m[1]);
    if (ids.length !== 1) continue;
    const t = m[1].replace(ids[0], '').replace(/^[\s:·.\-]+|[\s:·.\-]+$/g, '').trim();
    out[ids[0]] = t || ids[0];
  }
  return out;
}

/**
 * 기능 문서 머리 줄 → { no, name, milestone, stage } | null (lib/site.js featureMeta 와 같다).
 * 꼴: 제목 아래 「> 번호: 001 · 이름: 회원 관리 · 마일스톤: M1 · 단계: 명세」, 또는 맨 위 머리말(--- 안 「번호: 001」 줄)
 */
function featureMeta(text) {
  const lines = String(text).split('\n');
  const meta = {};
  const put = (k, v) => { k = k.trim(); if (k && !(k in meta)) meta[k] = String(v).trim(); };
  if (/^---\s*$/.test(lines[0] || '')) {
    for (let i = 1; i < Math.min(lines.length, 40) && !/^---\s*$/.test(lines[i]); i++) { const m = /^([^:：#]+?)\s*[:：]\s*(.*)$/.exec(lines[i]); if (m) put(m[1], m[2].replace(/^["']|["']$/g, '')); }
  }
  for (const l of lines.slice(0, 15)) {
    const m = /^\s*>\s*(.*번호\s*[:：].*)$/.exec(l);
    if (!m) continue;
    for (const part of m[1].split(/\s+·\s+/)) { const kv = /^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/.exec(part); if (kv) put(kv[1], kv[2]); }
    break;
  }
  if (!meta['번호'] && !meta['단계']) return null;
  const clean = (v) => (placeholder(v) ? '' : v || '');
  return { no: clean(meta['번호']), name: clean(meta['이름']), milestone: clean(meta['마일스톤']), stage: clean(meta['단계']) };
}

/** 머리 줄 「> 키: 값 · 키: 값」 또는 머리말(---) → { 키: 값 } (이슈 · 게시판 글) */
function headMeta(text) {
  const lines = String(text).split('\n');
  const meta = {};
  const put = (k, v) => { k = k.trim(); if (k && !(k in meta)) meta[k] = String(v).trim(); };
  if (/^---\s*$/.test(lines[0] || '')) {
    for (let i = 1; i < Math.min(lines.length, 40) && !/^---\s*$/.test(lines[i]); i++) { const m = /^([^:：#]+?)\s*[:：]\s*(.*)$/.exec(lines[i]); if (m) put(m[1], m[2].replace(/^["']|["']$/g, '')); }
  }
  for (const l of lines.slice(0, 12)) {
    const m = /^\s*>\s*(.+)$/.exec(l);
    if (!m || !/[:：]/.test(m[1])) continue;
    for (const part of m[1].split(/\s+·\s+/)) { const kv = /^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/.exec(part); if (kv) put(kv[1], kv[2]); else if (part.trim()) put(part.trim(), true); }
    break;
  }
  return meta;
}
/** 머리 줄 · 머리말 · 제목을 뺀 본문 */
function bodyOf(text) {
  let t = String(text);
  if (/^---\s*\n/.test(t)) t = t.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
  const lines = t.split('\n');
  let i = 0;
  while (i < lines.length && (/^\s*$/.test(lines[i]) || /^#\s/.test(lines[i]) || (/^\s*>/.test(lines[i]) && /[:：]/.test(lines[i]) && i < 6))) i++;
  return lines.slice(i).join('\n').trim();
}
const h1Of = (text) => { const m = /^#\s+(.+)$/m.exec(String(text)); return m ? m[1].trim() : ''; };

/** 기능 문서 → { fn, ac, api, scr, tables } (명세 · 설계 · 검증 절의 표) */
function featureParts(text) {
  const fn = [], ac = [], api = [], scr = [], tables = [];
  const rowsOf = { fn: [], api: [], scr: [] }; // [ID, 그 행의 다른 ID 들] (FN 별로 좁힐 때)
  const result = {};
  for (const t of mdTables(text)) {
    const verify = /검증/.test(t.h2) && !/수용/.test(t.h3) || /^수용 ?기준$/.test(t.head[0] || '');
    const dataTable = /데이터|테이블/.test(t.h3) || /^테이블/.test(t.head[0] || '');
    for (const r of t.rows) {
      const first = r[0] || '';
      if (!first || placeholder(first)) continue;
      const id = (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+$/.test(first) ? first : null);
      if (verify && id && kindOf(id) === 'AC') { result[id] = placeholder(r[r.length - 1]) ? '' : r[r.length - 1] || ''; continue; }
      if (id) {
        const k = kindOf(id);
        const others = idsIn(r.slice(1).join(' '));
        if (k === 'FN') { if (!fn.some((x) => x.id === id)) { fn.push({ id, text: placeholder(r[1]) ? '' : r[1] || '' }); rowsOf.fn.push([id, others]); } }
        else if (k === 'AC') { if (!ac.some((x) => x.id === id)) ac.push({ id, text: r.slice(1, verify ? 2 : undefined).filter((c) => c && !placeholder(c)).join(' '), result: '' }); }
        else if (k === 'API') { if (!api.includes(id)) { api.push(id); rowsOf.api.push([id, others]); } }
        else if (k === 'SCR') { if (!scr.includes(id)) { scr.push(id); rowsOf.scr.push([id, others]); } }
        continue;
      }
      if (dataTable && /^[\w$.]+$/.test(first) && !/^(없음|-)$/.test(first) && !tables.includes(first)) tables.push(first);
    }
  }
  for (const a of ac) a.result = result[a.id] || '';
  return { fn, ac, api, scr, tables, rowsOf };
}

/** 분야 칸 (장치 · IoT · 게임): 기능 문서에 나온 보드 판 · 위험 · 대책 · 인터페이스 · 밸런스 ID 와 검증 절의 단계별 결과 표(단계 · 결과 · 어디서) */
const EXTRA_KINDS = { hw: ['HW'], risks: ['HAZ', 'RC'], ifs: ['IF'], bal: ['BAL'] };
function featureExtras(text) {
  const all = idsIn(text);
  const out = Object.fromEntries(Object.entries(EXTRA_KINDS).map(([k, kinds]) => [k, all.filter((id) => kinds.includes(kindOf(id)))]));
  out.tiers = [];
  for (const t of mdTables(text)) {
    if (!/검증/.test(`${t.h2} ${t.h3}`)) continue;
    const h = t.head.map((x) => x.trim());
    const ti = h.indexOf('단계');
    const ri = h.indexOf('결과');
    const wi = h.findIndex((x) => /^어디서/.test(x));
    if (ti < 0 || ri < 0 || wi < 0) continue;
    for (const r of t.rows) {
      const tier = r[ti] || '';
      if (!tier || placeholder(tier)) continue;
      out.tiers.push({ tier, result: placeholder(r[ri]) ? '' : r[ri] || '', where: placeholder(r[wi]) ? '' : r[wi] || '' });
    }
  }
  return out;
}

// ───────── git ─────────

function git(dir, args, max = 64 * 1024 * 1024) {
  try { return execFileSync('git', ['-C', dir, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: max, timeout: 30000 }); } catch { return ''; }
}

/** 폴더 안 파일마다 마지막 커밋 { 경로(폴더 기준): { at, name, email } } */
function lastTouch(dir) {
  const out = {};
  const log = git(dir, ['log', '--no-merges', '--relative', '--format=%x1e%aI%x1f%an%x1f%ae', '--name-only', '--', '.']);
  for (const chunk of log.split('\x1e')) {
    if (!chunk.trim()) continue;
    const [head, ...files] = chunk.split('\n');
    const [at, name, email] = head.split('\x1f');
    for (const f of files) if (f.trim() && !out[f.trim()]) out[f.trim()] = { at, name, email };
  }
  return out;
}

/** 최근 커밋의 바뀐 md 와 더한 줄의 ID [{ file, at, name, email, subject, ids }] (새것부터) */
function recentChanges(dir, limit = 60) {
  const out = [];
  const log = git(dir, ['log', '--no-merges', '--relative', `-n${limit}`, '--format=%x1e%aI%x1f%an%x1f%ae%x1f%s', '-p', '-U0', '--no-color', '--no-ext-diff', '--', '.']);
  for (const chunk of log.split('\x1e')) {
    if (!chunk.trim()) continue;
    const lines = chunk.split('\n');
    const [at, name, email, subject] = lines[0].split('\x1f');
    let file = null;
    const per = new Map();
    for (const l of lines.slice(1)) {
      let m;
      if ((m = /^\+\+\+ (?:b\/)?(.+)$/.exec(l))) { file = m[1] === '/dev/null' ? null : m[1].replace(/^"|"$/g, ''); if (file && !per.has(file)) per.set(file, new Set()); continue; }
      if (l.startsWith('diff --git')) { file = null; continue; }
      if (file && l.startsWith('+') && !l.startsWith('+++')) for (const id of idsIn(l)) per.get(file).add(id);
    }
    for (const [f, ids] of per) out.push({ file: f, at, name, email, subject: subject || '', ids: [...ids].sort() });
  }
  return out;
}

// ───────── 팀 · 설정 (허용 목록만) ─────────

function kitModule(ws) {
  for (const f of [ws && ws.root && path.join(ws.root, 'bin', 'kit.js'), path.join(__dirname, '..', '..', '..', 'bin', 'kit.js')]) {
    try { if (f && fs.existsSync(f)) return require(f); } catch { /* 다음 */ }
  }
  return null;
}
function roleTitle(role) {
  try { const m = /^title:\s*(.+)$/m.exec(fs.readFileSync(path.join(__dirname, '..', 'agents', `${role}.md`), 'utf8')); return m ? m[1].trim() : ''; } catch { return ''; }
}
function rosterOf(ws) {
  try { return require('./team').roster(ws); } catch { return { leads: [], members: [] }; }
}

/**
 * 사이트에 보일 팀 · 설정. 여기 적은 칸만 내보낸다 (토큰 · 호스트 · 채팅방 · 이 PC 설정 · 게이트웨이는 넣지 않는다).
 * 모델 · 강제 수준은 팀 값(workspace.json)만 본다 (PC 마다 같은 사이트)
 */
function teamInfo(ws) {
  const { leads, members } = rosterOf(ws);
  const person = (p, role) => ({ id: String(p.username), name: String(p.nickname || p.username), role, repos: role === '팀장' ? [] : (p.repos || []).map(String) });
  const seen = new Set();
  const list = [];
  for (const p of leads) if (!seen.has(p.username)) { seen.add(p.username); list.push(person(p, '팀장')); }
  for (const p of members) if (!seen.has(p.username)) { seen.add(p.username); list.push(person(p, '팀원')); }
  const ai = { tool: null, mainModel: null, roles: [], teamMode: null, enforce: [] };
  const K = kitModule(ws);
  if (K) {
    try {
      const plain0 = { ...ws, agents: ws.agents || {} };
      const r = K.resolveModels(ws.root, plain0);
      const access = K.normalizeAccess({ ...((ws.agents || {}).access || {}) });
      const tool = K.startToolOf(access);
      const pick = (o) => (o && typeof o[tool] === 'string' ? o[tool] : null);
      ai.tool = tool;
      ai.mainModel = pick(r.team.main);
      ai.roles = Object.entries(r.team.roles || {}).map(([role, o]) => ({ role, model: pick(o), desc: roleTitle(role) }));
      ai.teamMode = K.teamOptions(ws, {}).mode;
      ai.enforce = Object.entries(r.teamEnforce || {}).map(([name, level]) => ({ name, level: String(level) }));
    } catch { /* 모델 카탈로그를 못 읽으면 빈 칸 */ }
  }
  return {
    members: list, ai,
    kit: { version: (ws.kit && ws.kit.version) || null, packs: (ws.packs || []).map(String) },
    repos: (ws.repos || []).map((r) => ({ name: String(r.name), kind: String(r.kind || 'code'), stack: (r.stacks || []).length ? r.stacks.join(', ') : null })),
  };
}

/** git 작성자 → 팀 아이디 (아이디 · 메일 앞부분 · 부르는 이름이 맞으면), 모르면 작성자 이름 */
function personMap(ws) {
  const { leads, members } = rosterOf(ws);
  const all = [...leads, ...members];
  return (name, email) => {
    const local = String(email || '').split('@')[0].replace(/^\d+\+/, '');
    const hit = all.find((p) => p.username === local || p.username === name || (p.nickname && p.nickname === name));
    return hit ? hit.username : String(name || local || '');
  };
}

// ───────── 이슈 · 게시판 · 의견 (로컬 파일) ─────────

/** issues/*.md → 이슈 항목 */
function localIssues(root) {
  const dir = path.join(root, 'issues');
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => /\.md$/i.test(f) && !/^readme\.md$/i.test(f) && !f.startsWith('_')).sort(); } catch { return []; }
  const touch = lastTouch(dir);
  const firstTouch = {};
  for (const chunk of git(dir, ['log', '--reverse', '--relative', '--format=%x1e%aI', '--name-only', '--diff-filter=A', '--', '.']).split('\x1e')) {
    const [at, ...files] = chunk.split('\n');
    for (const f of files) if (f.trim() && !firstTouch[f.trim()]) firstTouch[f.trim()] = at;
  }
  return names.map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const meta = headMeta(text);
    const num = (/^(\d+)/.exec(f) || [])[1];
    const title = h1Of(text).replace(/^(ISSUE-)?\d+[\s.:-]+/, '') || f.replace(/\.md$/i, '');
    const rel = meta['관련 ID'] || meta['관련'] || '';
    return {
      id: num ? `ISSUE-${num.padStart(3, '0')}` : f.replace(/\.md$/i, ''), title,
      state: meta['상태'] || '열림', stage: meta['단계'] || '', labels: uniq([meta['종류']].filter((x) => typeof x === 'string')),
      assignee: meta['담당'] && !/^(없음|-)$/.test(meta['담당']) ? meta['담당'] : null,
      ids: uniq([...idsIn(rel), ...idsIn(text)]).filter((x) => !x.startsWith('ISSUE-')),
      milestone: meta['마일스톤'] || null, created: meta['날짜'] || firstTouch[f] || null, updated: (touch[f] || {}).at || null, url: null,
      closed: meta['닫은 날'] || (CLOSED.test(meta['상태'] || '') ? (touch[f] || {}).at || null : null), due: meta['기한'] || null,
    };
  });
}

/** docs-site/자료실/게시판/*.md → 게시판 글 */
function localBoard(src, who) {
  const dir = path.join(src, BOARD_DIR);
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => /\.md$/i.test(f) && !/^readme\.md$/i.test(f) && !f.startsWith('_')).sort(); } catch { return []; }
  const touch = lastTouch(dir);
  return names.map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const meta = headMeta(text);
    const t = touch[f] || {};
    return { id: f.replace(/\.md$/i, ''), title: h1Of(text) || f.replace(/\.md$/i, ''), body: bodyOf(text), author: meta['작성'] || (t.name ? who(t.name, t.email) : null), at: meta['날짜'] || t.at || null, pinned: meta['공지'] === true || /^(예|네|true|공지)$/i.test(String(meta['공지'] || '')), comments: [], url: null };
  });
}

/** 쪽 경로 → 의견 파일 이름 (docs-site/.comments/<이름>.json) */
const commentFile = (page) => `${String(page).replace(/\.html$/i, '').replace(/[\\/]+/g, '__').replace(/[^\w가-힣.\-]/g, '_').slice(0, 180) || 'index'}.json`;

/** docs-site/.comments/*.json → { 쪽: [의견] } */
function localComments(src) {
  const dir = path.join(src, COMMENTS_DIR);
  const out = {};
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { return out; }
  for (const f of names) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!j || typeof j.page !== 'string' || !Array.isArray(j.items)) continue;
    out[j.page] = j.items.filter((c) => c && c.text).map((c) => ({ id: String(c.id || ''), who: String(c.who || ''), at: String(c.at || ''), quote: String(c.quote || ''), text: String(c.text), url: null }));
  }
  return out;
}

/** docs-site/자료실/ 의 md 아닌 파일 → [{ name, path, kind, by, at, size, abs }] (사이트에 그대로 복사한다) */
function libraryFiles(src, who) {
  const base = path.join(src, FILES_DIR);
  const out = [];
  if (!fs.existsSync(base)) return out;
  const touch = lastTouch(base);
  (function walk(rel) {
    let ents = [];
    try { ents = fs.readdirSync(path.join(base, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(r); continue; }
      if (!e.isFile() || /\.(md|html?)$/i.test(e.name)) continue;
      const abs = path.join(base, r);
      const size = fs.statSync(abs).size;
      const t = touch[r] || {};
      out.push({ name: e.name, path: `${FILES_DIR}/${r}`, kind: (path.extname(e.name).slice(1) || 'file').toLowerCase(), by: t.name ? who(t.name, t.email) : null, at: t.at || null, size, abs, big: size > MAX_FILE });
    }
  })('');
  return out;
}

// ───────── API 명세 (코드 repo 의 openapi) ─────────

const OPENAPI = /^(openapi|swagger)\.(json|ya?ml)$/i;
const ASYNCAPI = /^asyncapi\.(json|ya?ml)$/i;
const API_SKIP = new Set(['.git', 'node_modules', 'vendor', '.venv', 'venv', '__pycache__', '.gradle', '.idea', 'target', 'coverage']);
/** repo 안에서 이름이 맞는 명세 파일 (얕은 것 먼저) */
function specHits(dir, re) {
  const hits = [];
  (function walk(rel, depth) {
    if (depth > 5 || hits.length > 20) return;
    let ents = [];
    try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!API_SKIP.has(e.name) && !e.name.startsWith('.')) walk(p, depth + 1); continue; }
      if (re.test(e.name)) hits.push(p);
    }
  })('', 0);
  return hits.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}
const codeRepos = (ws) => (ws.repos || []).filter((x) => (x.kind || 'code') === 'code' && x.dir && fs.existsSync(x.dir));
/** 코드 repo 마다 openapi 파일 하나 (얕은 것 먼저) → [{ repo, title, file, data }] (file = 사이트 안 경로) */
function findApis(ws) {
  const out = [];
  for (const r of codeRepos(ws)) {
    const hits = specHits(r.dir, OPENAPI);
    for (const h of hits) {
      let raw;
      try { raw = fs.readFileSync(path.join(r.dir, h)); } catch { continue; }
      if (raw.length > 8 * 1024 * 1024) continue;
      const yaml = /\.ya?ml$/i.test(h);
      let title = '';
      if (yaml) {
        const m = /^info:\s*\n(?:[ \t]+.*\n)*?[ \t]+title:\s*["']?(.+?)["']?\s*$/m.exec(raw.toString('utf8'));
        if (!/^\s*(openapi|swagger)\s*:/m.test(raw.toString('utf8'))) continue;
        title = m ? m[1] : '';
      } else {
        let j;
        try { j = JSON.parse(raw.toString('utf8')); } catch { continue; }
        if (!j || !(j.openapi || j.swagger)) continue;
        title = (j.info && j.info.title) || '';
      }
      const safe = String(r.name).replace(/[^\w.-]/g, '_');
      out.push({ repo: r.name, title: String(title || r.name), file: `assets/openapi/${safe}.${yaml ? 'yaml' : 'json'}`, data: raw });
      break;
    }
  }
  return out;
}

/** JSON 안 「#/…」 참조를 따라간다 (밖 파일 참조는 그대로) */
function deref(doc, o) {
  for (let i = 0; i < 10 && o && typeof o.$ref === 'string' && o.$ref.startsWith('#/'); i++) {
    o = o.$ref.slice(2).split('/').map((k) => decodeURIComponent(k).replace(/~1/g, '/').replace(/~0/g, '~')).reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), doc);
  }
  return o && typeof o === 'object' ? o : null;
}
const refName = (o) => (o && typeof o.$ref === 'string' ? o.$ref.split('/').pop() : '');
/** 메시지 → { name, fields(본문 맨 위 칸 이름) } */
function asyncMessage(doc, m0, fallback) {
  const m = deref(doc, m0);
  if (!m) return null;
  let pl = deref(doc, m.payload) || {};
  if (pl.type === 'array' && pl.items) pl = deref(doc, pl.items) || {};
  const props = { ...(pl.properties || {}) };
  for (const part of pl.allOf || []) Object.assign(props, (deref(doc, part) || {}).properties || {});
  return { name: String(m.name || m.title || m.messageId || refName(m0) || fallback || ''), fields: Object.keys(props) };
}
/** AsyncAPI JSON (2.x · 3.x) → 채널 [{ name, action, messages: [{ name, fields }] }] */
function asyncChannels(doc) {
  const out = [];
  const channels = (doc && doc.channels) || {};
  const list = (m) => (m && Array.isArray(m.oneOf) ? m.oneOf : m ? [m] : []);
  if (/^2\./.test(String(doc.asyncapi || ''))) {
    for (const [name, c0] of Object.entries(channels)) {
      const c = deref(doc, c0) || {};
      for (const action of ['publish', 'subscribe']) {
        if (!c[action]) continue;
        out.push({ name, action, messages: list(c[action].message).map((x, i) => asyncMessage(doc, x, `${action}-${i + 1}`)).filter(Boolean) });
      }
    }
    return out;
  }
  const used = new Set();
  for (const [opName, o0] of Object.entries(doc.operations || {})) {
    const o = deref(doc, o0) || {};
    const key = refName(o.channel);
    const c = deref(doc, o.channel) || {};
    used.add(key);
    const msgs = Array.isArray(o.messages) && o.messages.length ? o.messages : Object.values(c.messages || {});
    out.push({ name: String(c.address || key || opName), action: String(o.action || ''), messages: msgs.map((x, i) => asyncMessage(doc, x, `${opName}-${i + 1}`)).filter(Boolean) });
  }
  for (const [key, c0] of Object.entries(channels)) {
    if (used.has(key)) continue;
    const c = deref(doc, c0) || {};
    out.push({ name: String(c.address || key), action: '', messages: Object.entries(c.messages || {}).map(([k, x]) => asyncMessage(doc, x, k)).filter(Boolean) });
  }
  return out;
}
/** 코드 repo 마다 asyncapi 파일 하나 → [{ repo, kind: 'asyncapi', title, file, channels, data }]. JSON 이면 채널을 풀고, YAML 은 파일만 */
function findAsyncApis(ws) {
  const out = [];
  for (const r of codeRepos(ws)) {
    for (const h of specHits(r.dir, ASYNCAPI)) {
      let raw;
      try { raw = fs.readFileSync(path.join(r.dir, h)); } catch { continue; }
      if (raw.length > 8 * 1024 * 1024) continue;
      const yaml = /\.ya?ml$/i.test(h);
      const text = raw.toString('utf8');
      let title = '';
      let channels = [];
      if (yaml) {
        if (!/^\s*asyncapi\s*:/m.test(text)) continue;
        const m = /^info:\s*\n(?:[ \t]+.*\n)*?[ \t]+title:\s*["']?(.+?)["']?\s*$/m.exec(text);
        title = m ? m[1] : '';
      } else {
        let j;
        try { j = JSON.parse(text); } catch { continue; }
        if (!j || !j.asyncapi) continue;
        title = (j.info && j.info.title) || '';
        try { channels = asyncChannels(j); } catch { channels = []; }
      }
      const safe = String(r.name).replace(/[^\w.-]/g, '_');
      out.push({ repo: r.name, kind: 'asyncapi', title: String(title || r.name), file: `assets/asyncapi/${safe}.${yaml ? 'yaml' : 'json'}`, channels, data: raw });
      break;
    }
  }
  return out;
}

// ───────── 대시보드 숫자 (유형별 4칸) ─────────

const DEFECT = /결함|버그|bug|defect/i;
/** 그 때의 로컬 날짜 YYYY-MM-DD */
const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const plusDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 864e5);
/** 조건에 맞는 표의 행 → [{ 머리 칸: 값 }] (자리표시자 행은 뺀다) */
const tableRows = (text, pred) => mdTables(text || '').filter(pred).flatMap((t) => t.rows.filter((r) => r[0] && !placeholder(r[0])).map((r) => Object.fromEntries(t.head.map((h, i) => [h.trim(), r[i] || '']))));
const statusOf = (text) => String((/^\s*>\s*상태\s*[:：]\s*([^·\n]+)/m.exec(String(text || '')) || [])[1] || '').trim();
const M = (value, sub = null) => ({ value: String(value), sub });

/**
 * 유형별 대시보드 숫자 { key: { value(보이는 글자), sub(작은 설명) } | null }. 못 구하면 null (화면은 「아직 없음」).
 * today = 빌드 날짜 (YYYY-MM-DD). 날짜에 따라 바뀌는 값이라 check 는 비교하지 않는다 (stable)
 */
function computeMetrics({ keys, today, features = [], milestones = [], issues = null, workItems = [], files = {}, comments = {} }) {
  const items = (issues && issues.items) || [];
  const hasIssues = !!(issues && issues.source);
  const open = items.filter((x) => !CLOSED.test(x.state || ''));
  const closed = items.filter((x) => CLOSED.test(x.state || ''));
  const weekStart = plusDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const weekEnd = plusDays(weekStart, 6);
  const inWeek = (d) => !!d && String(d).slice(0, 10) >= weekStart && String(d).slice(0, 10) <= weekEnd;
  const nextMs = (re) => milestones.filter((m) => m.due && m.due >= today && (!re || re.test(m.name))).sort((a, b) => a.due.localeCompare(b.due))[0];
  const daysTo = (m) => (m ? M(`${dayDiff(today, m.due)}일`, `${m.name} · ${m.due}`) : null);
  const parity = tableRows(files['설계/정합표.md'], (t) => t.head.some((h) => h.trim() === '상태'));
  const rehearsal = tableRows(files['설계/데이터-이관.md'], (t) => /리허설/.test(`${t.h2} ${t.h3}`));
  const reqs = tableRows(files['설계/요구사항.md'], (t) => (t.head[0] || '').trim() === 'ID').filter((r) => /^REQ-/.test(r.ID));
  const openDue = (list) => list.filter((x) => !CLOSED.test(x.state || '') && x.due);
  const calc = {
    daysToMilestone: () => daysTo(nextMs()),
    featureProgress: () => (features.length ? M(`${features.filter((f) => f.stage === STAGES[STAGES.length - 1]).length} / ${features.length}`, '배포까지 끝난 기능') : null),
    openIssues: () => (hasIssues ? M(open.length) : null),
    dueThisWeek: () => (workItems.length || hasIssues ? M(openDue([...workItems, ...items]).filter((x) => inWeek(x.due)).length, `${weekStart} ~ ${weekEnd}`) : null),
    openDefects: () => {
      if (!hasIssues) return null;
      const marked = items.some((x) => (x.labels || []).some((l) => DEFECT.test(l)));
      return marked ? M(open.filter((x) => (x.labels || []).some((l) => DEFECT.test(l))).length, '결함 표시 이슈') : M(open.length, '열린 이슈 전체 (결함 표시 없음)');
    },
    avgLeadDays: () => {
      const recent = closed.filter((x) => x.created && x.closed && dayDiff(x.closed, today) <= 30);
      if (!recent.length) return null;
      const avg = recent.reduce((n, x) => n + Math.max(0, (Date.parse(x.closed) - Date.parse(x.created)) / 864e5), 0) / recent.length;
      return M(`${Math.round(avg * 10) / 10}일`, `지난 30일 ${recent.length}건`);
    },
    releasedThisWeek: () => (hasIssues ? M(closed.filter((x) => inWeek(x.closed)).length, '이번 주 닫힌 이슈') : null),
    overdue: () => (workItems.length || hasIssues ? M(openDue([...items, ...workItems]).filter((x) => String(x.due).slice(0, 10) < today).length, '기한 지난 열린 항목') : null),
    daysToCutover: () => daysTo(nextMs(/전환|cutover|오픈|go-?live/i)),
    parityDone: () => (parity.length ? M(`${parity.filter((r) => /^(같음|일치|의도한 차이|완료|통과)/.test(r['상태'])).length} / ${parity.length}`, '정합표 행') : null),
    migrationRehearsal: () => (rehearsal.length ? M(`${rehearsal.length}회`, rehearsal[rehearsal.length - 1]['결과'] ? `마지막 ${rehearsal[rehearsal.length - 1]['결과']}` : null) : null),
    openDiffs: () => (parity.length ? M(parity.filter((r) => /^(차이|다름|불일치)/.test(r['상태'])).length, '정합표의 차이') : null),
    deliverableProgress: () => {
      const docs = ['설계/현행-분석.md', '설계/요구사항.md', '설계/목표-모델.md', '설계/이행계획.md', '설계/RFP.md'].filter((f) => typeof files[f] === 'string');
      return docs.length ? M(`${docs.filter((f) => /^(확정|완료)/.test(statusOf(files[f]))).length} / ${docs.length}`, '상태가 확정인 산출물') : null;
    },
    confirmedReqs: () => (reqs.length ? M(`${reqs.filter((r) => /^확정/.test(r['상태'] || '')).length} / ${reqs.length}`, '요구사항') : null),
    pendingDecisions: () => {
      const decs = Object.entries(files).filter(([f, t]) => typeof t === 'string' && /^설계\/결정\/DEC-[^/]*\.md$/.test(f) && /^제안/.test(statusOf(t))).length;
      const openQ = tableRows(files['설계/결정/README.md'], (t) => /미결/.test(`${t.h2} ${t.h3}`)).length;
      return typeof files['설계/결정/README.md'] === 'string' || decs ? M(decs + openQ, '제안 결정 · 미결') : null;
    },
    reviewComments: () => M(Object.values(comments || {}).reduce((n, l) => n + l.length, 0), '문서 의견'),
  };
  return Object.fromEntries(keys.map((k) => [k, calc[k] ? calc[k]() : null]));
}

// ───────── 모으기 ─────────

/**
 * 빌드 DB 판 2.
 * opts: { ws, src(docs-site 폴더), title, files({ md: 글 }), docs(mdsite docs: md · page · title · group), index(mdsite 색인), pageOf,
 *         remote(siteremote.read 결과 | null), apis([{ repo, title, file }]), library(libraryFiles 결과), config(docs-site.json), builtAt }
 */
/**
 * 로드맵 백로그: handoffs/PLAN.md 의 「백로그」 절(이슈형은 「개선 후보」) 한 줄씩 → [{ text, added }] (정본은 PLAN.md, 사이트는 읽기만).
 * added = 줄에 적힌 날짜(YYYY-MM-DD), 없으면 git 이 그 줄을 처음 넣은 날. PLAN.md 가 없으면 null
 */
function planBacklog(root) {
  if (!root) return null;
  const file = path.join(root, 'handoffs', 'PLAN.md');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  let P;
  try { P = require('./plan'); } catch { return null; }
  const plan = P.parse(text);
  const list = (plan && plan.backlog) || [];
  const label = plan && plan.mode === 'issue' ? '개선 후보' : '백로그';
  const added = {};
  try {
    const out = require('child_process').execFileSync('git', ['-C', root, 'blame', '--line-porcelain', '--', 'handoffs/PLAN.md'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
    let t = 0;
    for (const l of out.split('\n')) {
      if (l.startsWith('author-time ')) t = Number(l.slice(12)) * 1000;
      else if (l.startsWith('\t')) { const k = l.slice(1).replace(/^\s*[-*]\s+/, '').trim(); if (k && !(k in added) && t) added[k] = ymd(new Date(t)); }
    }
  } catch { /* git 없음 · 커밋 전: 날짜 없이 */ }
  const items = list.filter((x) => x && !/^<.*>$/.test(x)).map((x) => {
    const d = (x.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
    return { text: x, added: d || added[x] || null };
  });
  return { label, items };
}

function build(opts) {
  const { ws = {}, src, title, files = {}, docs = [], index = { ids: {} }, pageOf, remote = null, apis = [], asyncs = [], library = [], config = {}, builtAt = null } = opts;
  const who = personMap(ws);
  const gitOk = !!(src && git(src, ['rev-parse', '--is-inside-work-tree']).trim() === 'true');
  const touch = gitOk ? lastTouch(src) : {};
  const touchOf = (md) => touch[md] || {};

  // 기능
  const features = [];
  const rows = {};
  for (const [md, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    if (typeof text !== 'string' || !md.startsWith(`${FEATURE_DIR}/`) || !/\.md$/i.test(md) || /(^|\/)(_[^/]*|readme\.md)$/i.test(md)) continue;
    const meta = featureMeta(text) || { no: '', name: '', milestone: '', stage: '' };
    const parts = featureParts(text);
    const ex = featureExtras(text);
    const h1 = h1Of(text);
    features.push({ no: meta.no, name: meta.name, milestone: meta.milestone, stage: meta.stage, page: pageOf(md), md, title: h1 || path.basename(md, '.md'), fn: parts.fn, ac: parts.ac, api: parts.api, scr: parts.scr, tables: parts.tables, hw: ex.hw, risks: ex.risks, ifs: ex.ifs, bal: ex.bal, tiers: ex.tiers, updatedAt: touchOf(md).at || null });
    rows[md] = parts.rowsOf;
  }

  // 문서 목록 (사람 문서만: md 원본이 있는 쪽)
  const docList = docs.filter((d) => d.md && /\.md$/i.test(d.md)).map((d) => ({ page: d.page, md: d.md, title: d.title, group: d.group || '', updatedAt: touchOf(d.md).at || null, updatedBy: touchOf(d.md).name ? who(touchOf(d.md).name, touchOf(d.md).email) : null }));
  const pageOfMd = new Map(docList.map((d) => [d.md, d.page]));

  // ID 색인: 정의 쪽(mdsite 색인) + 제목 · 표 첫 칸의 이름
  const titles = {};
  for (const [md, text] of Object.entries(files)) {
    if (typeof text !== 'string' || !/\.md$/i.test(md)) continue;
    Object.assign(titles, Object.fromEntries(Object.entries(headingTitles(text)).filter(([k]) => !(k in titles))));
    for (const t of mdTables(text)) for (const r of t.rows) {
      const id = r[0];
      if (!id || placeholder(id) || !/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+$/.test(id) || id in titles) continue;
      const rest = r.slice(1).filter((c) => c && !placeholder(c) && !/^[A-Z]+-[\w-]+$/.test(c));
      if (rest.length) titles[id] = rest[0];
    }
  }
  const ids = {};
  const put = (id, page, t, kind) => { if (!(id in ids)) ids[id] = { page: page || null, title: t || id, kind: kind || kindOf(id) }; };
  for (const f of features) {
    for (const x of f.fn) put(x.id, f.page, x.text, 'FN');
    for (const x of f.ac) put(x.id, f.page, x.text, 'AC');
    for (const a of f.api) put(a, f.page, titles[a], 'API');
    for (const s of f.scr) put(s, f.page, titles[s], 'SCR');
  }
  for (const [id, hits] of Object.entries(index.ids || {})) {
    if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+$/.test(id)) continue;
    put(id, String((hits || [])[0] || '').split('#')[0], titles[id], kindOf(id));
  }
  // 분야 ID (BAL · IF · HW · HAZ · RC): 정의 쪽이 없으면 가리킨 기능 쪽
  for (const f of features) for (const k of Object.keys(EXTRA_KINDS)) for (const id of f[k]) put(id, f.page, titles[id], kindOf(id));
  // 테이블 이름: 데이터 정의서의 「### 스키마.테이블」 제목
  for (const [md, text] of Object.entries(files)) {
    if (typeof text !== 'string' || !/\.md$/i.test(md)) continue;
    for (const m of text.matchAll(/^###\s+`?([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)`?\s*$/gm)) {
      const name = m[1];
      if (!/(^|\/)데이터\//.test(md) && !/\|\s*(컬럼|column)/i.test(text)) continue;
      put(name, pageOfMd.get(md) || pageOf(md), name, 'TABLE');
      const short = name.split('.').pop();
      if (short !== name) put(short, pageOfMd.get(md) || pageOf(md), name, 'TABLE');
    }
  }
  for (const f of features) for (const t of f.tables) put(t, ids[t] ? ids[t].page : null, t, 'TABLE');

  // 이슈 · 작업 항목
  const rm = remote && remote.ok ? remote : null;
  const local = localIssues(ws.root || path.dirname(src || '.'));
  const issueItems = [...(rm ? rm.issues || [] : []), ...local];
  for (const it of issueItems) put(it.id, null, it.title, 'ISSUE');
  const issues = { source: rm ? rm.kind : (local.length ? 'local' : null), url: rm ? rm.issuesUrl || null : null, items: issueItems };
  const featureOfId = new Map();
  for (const f of features) for (const id of [...f.fn.map((x) => x.id), ...f.ac.map((x) => x.id), ...f.api, ...f.scr, ...f.hw, ...f.risks, ...f.ifs, ...f.bal]) if (!featureOfId.has(id)) featureOfId.set(id, f.no);
  const workItems = (rm ? rm.workItems || [] : []).map((w) => ({ ...w, feature: w.feature || (w.ids || []).map((x) => featureOfId.get(x)).find(Boolean) || null })).map(({ ids: _i, ...w }) => w);

  // 관계 (FN 기준)
  const relations = {};
  const stem = (id) => String(id).split('-').slice(1, -1).join('-') || String(id).split('-').slice(1).join('-');
  for (const f of features) {
    const r = rows[f.md] || { fn: [], api: [], scr: [] };
    const narrowed = (list, kind) => {
      // 그 행이 FN 을 가리키면 그 FN 에만, 아니면 기능 전체에
      const by = new Map();
      for (const [id, others] of r[kind]) by.set(id, others.filter((x) => kindOf(x) === 'FN'));
      return (fn) => list.filter((id) => { const o = by.get(id) || []; return !o.length || o.includes(fn); });
    };
    const apiOf = narrowed(f.api, 'api');
    const scrOf = narrowed(f.scr, 'scr');
    const fnStems = new Set(f.fn.map((x) => x.id.split('-').slice(1).join('-')));
    const acMatch = f.ac.some((a) => fnStems.has(stem(a.id)));
    for (const x of f.fn) {
      const myStem = x.id.split('-').slice(1).join('-');
      relations[x.id] = {
        req: [], api: apiOf(x.id), scr: scrOf(x.id), tables: [...f.tables],
        ac: f.ac.filter((a) => !acMatch || stem(a.id) === myStem).map((a) => a.id), dec: [], issues: [],
      };
      // 분야 ID: 기능 목록 행이 그 종류를 가리키면 행마다 자기 것만, 어느 행도 안 가리키면 기능 전체
      const rowIds = (fn) => r.fn.filter(([id]) => id === fn).flatMap(([, others]) => others);
      for (const [k, kinds] of Object.entries(EXTRA_KINDS)) {
        const byRow = r.fn.some(([, others]) => others.some((o) => kinds.includes(kindOf(o))));
        relations[x.id][k] = byRow ? rowIds(x.id).filter((o) => kinds.includes(kindOf(o))) : [...f[k]];
      }
      for (const [, others] of r.fn.filter(([id]) => id === x.id)) for (const o of others) { if (kindOf(o) === 'REQ') relations[x.id].req.push(o); if (kindOf(o) === 'DEC') relations[x.id].dec.push(o); }
    }
  }
  // 요구 표의 행이 FN 을 가리키면 REQ, 결정 문서가 FN 을 가리키면 DEC
  for (const [md, text] of Object.entries(files)) {
    if (typeof text !== 'string' || !/\.md$/i.test(md) || md.startsWith(`${FEATURE_DIR}/`)) continue;
    for (const t of mdTables(text)) for (const row of t.rows) {
      const id = row[0];
      if (!id || kindOf(id) !== 'REQ' || placeholder(id)) continue;
      for (const fn of idsIn(row.slice(1).join(' '))) if (relations[fn]) relations[fn].req.push(id);
    }
    const decId = (/^#\s+(DEC-\d+)/m.exec(text) || [])[1] || (/(^|\/)(DEC-\d+)[^/]*\.md$/.exec(md) || [])[2];
    if (decId) for (const fn of idsIn(text)) if (relations[fn]) relations[fn].dec.push(decId);
  }
  const fnsOf = (id) => (relations[id] ? [id] : Object.keys(relations).filter((fn) => { const r = relations[fn]; return [r.req, r.api, r.scr, r.ac, r.dec, r.bal, r.ifs, r.hw, r.risks].some((l) => (l || []).includes(id)); }));
  for (const it of issueItems) for (const id of it.ids || []) for (const fn of fnsOf(id)) relations[fn].issues.push(it.id);
  for (const r of Object.values(relations)) for (const k of Object.keys(r)) r[k] = uniq(r[k]);

  // 마일스톤: 기능 머리 줄 + 원격(날짜 · 주소) + docs-site.json milestones(날짜)
  const msMap = new Map();
  const ms = (name) => { if (!msMap.has(name)) msMap.set(name, { name, start: null, due: null, features: [], progress: { done: 0, total: 0 }, source: 'local', url: null }); return msMap.get(name); };
  for (const m of Array.isArray(config.milestones) ? config.milestones : []) if (m && m.name) Object.assign(ms(String(m.name)), { start: m.start || null, due: m.due || null });
  for (const m of rm ? rm.milestones || [] : []) Object.assign(ms(m.name), { start: m.start || ms(m.name).start, due: m.due || ms(m.name).due, source: rm.kind, url: m.url || null });
  for (const f of features) {
    if (!f.milestone) continue;
    const m = ms(f.milestone);
    m.features.push(f.no || f.md);
    m.progress.total++;
    if (f.stage === STAGES[STAGES.length - 1]) m.progress.done++;
  }
  const milestones = [...msMap.values()].sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || a.name.localeCompare(b.name));

  // 최근 바뀜
  const changes = gitOk ? recentChanges(src).filter((c) => pageOfMd.has(c.file)).slice(0, 200).map((c) => ({ page: pageOfMd.get(c.file), at: c.at, by: who(c.name, c.email), summary: c.subject, ids: c.ids })) : [];

  // 게시판 · 의견
  const board = [...(rm ? rm.board || [] : []), ...localBoard(src, who)].sort((a, b) => (b.pinned - a.pinned) || String(b.at || '').localeCompare(String(a.at || '')));
  const comments = localComments(src);
  for (const [page, list] of Object.entries(rm ? rm.comments || {} : {})) comments[page] = [...(comments[page] || []), ...list];
  for (const page of Object.keys(comments)) comments[page].sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const project = (() => {
    const p = ws.project || {};
    let description = p.description || '';
    if (!description) {
      const t = files['개요.md'];
      if (typeof t === 'string') description = (t.split('\n').find((l) => l.trim() && !/^\s*(#|>|\||-|\*|```|<)/.test(l)) || '').trim().slice(0, 300);
    }
    return { title: p.title || title, description: description || null, onboarded: p.onboarded !== false };
  })();

  // 유형 · 분야 프로필 · 대시보드 숫자
  let profile = null;
  try { profile = require('./profile').profileOf(ws, config); } catch { profile = null; }
  const today = ymd(builtAt ? new Date(builtAt) : new Date());
  const metrics = profile ? computeMetrics({ keys: profile.dashboard.map((d) => d.key), today, features, milestones, issues, workItems, files, comments }) : {};

  return {
    version: 2, layout: 'workspace', title, builtAt, project, profile, metrics, stages: STAGES,
    features, milestones, docs: docList, ids, relations, changes,
    team: teamInfo(ws), issues, workItems, board, backlog: planBacklog(ws.root),
    files: library.filter((f) => !f.big).map(({ name, path: p, kind, by, at, size }) => ({ name, path: p, kind, by, at, size })),
    comments,
    remote: remote ? { kind: remote.kind || null, web: remote.web || null, project: remote.project || null, api: remote.api || null, pages: remote.pages || null, commentIssues: remote.commentIssues || {} } : { kind: null, web: null, project: null, api: null, pages: null, commentIssues: {} },
    apis: apis.map(({ repo, title: t, file }) => ({ repo, title: t, file })),
    interfaces: [
      ...apis.map(({ repo, title: t, file }) => ({ repo, kind: 'openapi', title: t, file, channels: [] })),
      ...asyncs.map(({ repo, title: t, file, channels }) => ({ repo, kind: 'asyncapi', title: t, file, channels: channels || [] })),
    ],
  };
}

/** check 가 비교할 때 빼는 칸: 만든 때 · git 에서 읽은 때와 사람 (커밋만 해도 바뀐다) */
function stable(db) {
  const d = JSON.parse(JSON.stringify(db || {}));
  delete d.builtAt;
  delete d.changes;
  delete d.history; // 문서별 지난 판 (git 에서 읽는다)
  delete d.metrics; // 날짜에 따라 바뀐다 (남은 날 · 이번 주)
  for (const x of d.docs || []) { delete x.updatedAt; delete x.updatedBy; }
  for (const x of d.features || []) delete x.updatedAt;
  for (const x of d.files || []) { delete x.at; delete x.by; }
  for (const x of (d.issues && d.issues.items) || []) { if (!x.url) { delete x.created; delete x.updated; delete x.closed; } }
  for (const x of d.board || []) if (!x.url) { delete x.at; if (x.author === null) delete x.author; }
  return d;
}

module.exports = { planBacklog, STAGES, FEATURE_DIR, BOARD_DIR, FILES_DIR, COMMENTS_DIR, ID_RE, ISSUE_RE, MAX_FILE, featureMeta, featureParts, featureExtras, findAsyncApis, asyncChannels, computeMetrics, headMeta, bodyOf, mdTables, idsIn, kindOf, build, stable, teamInfo, localIssues, localBoard, localComments, libraryFiles, findApis, commentFile, personMap, lastTouch, recentChanges };
