// 쓰기 보고서(시험이 DB 에 쓴 것) 읽기 · 기능 문서 「저장」 표 대조: kedovi writes check 와 kedovi docs build 의 「저장 데이터」 쪽이 같이 쓴다 (외부 모듈 없음)
/*
 * 보고서 형식 정본: packs/core/assets/write-report/FORMAT.md (index.json: tests[].specs · writes[] · catalog)
 * 저장 표 (기능 문서의 기능 절 안, 템플릿 templates/docs-repo/20-features/_template.md)
 *   ## FN-<영역>-001 <기능 이름>
 *   ### 저장
 *   | 스키마.테이블.컬럼 | 값 출처 | 조건 | 기본값 |
 *   대상 칸: 스키마.테이블.컬럼 · 테이블.컬럼(스키마 생략) · 스키마.테이블.*(행 삭제 · 행 전체). 저장이 없으면 표 대신 「없음」
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ID_SRC = '[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\\d+';
const ID_RE = new RegExp(`(?<![\\w-])${ID_SRC}(?![\\w-])`, 'g');
const FEATURE_HEAD = new RegExp(`^(#{2,3})\\s+(${ID_SRC})(?![\\w-])\\s*(.*?)\\s*$`);
const SAVE_HEAD = /^(#{3,5})\s+저장(?:\s+데이터)?\s*$/;
const NAME = '[A-Za-z_][\\w$]*';
const TARGET_RE = new RegExp(`^(?:(${NAME})\\.)?(${NAME})\\.(${NAME}|\\*)$`);
const REF_IN_TEXT = new RegExp(`(?<![\\w.])(${NAME}\\.${NAME}(?:\\.${NAME})?)(?![\\w.(])`, 'g');

/** 보고서 출력 폴더 (스택 기본값, FORMAT.md 「파일 위치」) */
const REPORT_DIRS = ['build/write-report', 'target/write-report', '.write-report'];
const SKIP = new Set(['.git', 'node_modules', 'build', 'target', 'src', 'dist', 'out', '.venv', 'venv', '__pycache__', '.gradle', '.idea']);

/** repo 안의 보고서: 맨 위와 한 단계 아래 모듈. [{ module('.'|모듈), dir, index, html }] (index.json 이 있는 것만, 최근 것 먼저) */
function findReports(repoDir) {
  const out = [];
  const look = (base, module) => {
    for (const d of REPORT_DIRS) {
      const dir = path.join(base, d);
      const index = path.join(dir, 'index.json');
      if (!fs.existsSync(index)) continue;
      const html = path.join(dir, 'index.html');
      out.push({ module, dir, index, html: fs.existsSync(html) ? html : null, mtime: fs.statSync(index).mtimeMs });
    }
  };
  if (!repoDir || !fs.existsSync(repoDir)) return out;
  look(repoDir, '.');
  let subs = [];
  try { subs = fs.readdirSync(repoDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')).map((e) => e.name).sort(); } catch { /* 못 읽음 */ }
  for (const s of subs) look(path.join(repoDir, s), s);
  return out.sort((a, b) => b.mtime - a.mtime || a.module.localeCompare(b.module));
}

function loadReport(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`보고서를 읽지 못했습니다: ${file} (${e.message})`); }
  if (!j || !Array.isArray(j.tests)) throw new Error(`쓰기 보고서 형식이 아닙니다 (tests 목록 없음): ${file}`);
  return j;
}

// ───────── 기능 문서 「저장」 표 ─────────

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const isSep = (cells) => cells.every((c) => /^:?-{2,}:?$/.test(c));
const plain = (s) => String(s).replace(/`/g, '').replace(/\*\*/g, '').trim();
const COLS = { target: ['스키마.테이블.컬럼', '테이블.컬럼', '컬럼', '대상'], source: ['값 출처', '출처', '값'], cond: ['조건'], def: ['기본값', '기본'] };

/** 대상 칸 → { schema, table, column } | null */
function parseTarget(text) {
  const m = TARGET_RE.exec(plain(text));
  return m ? { schema: m[1] || '', table: m[2], column: m[3] } : null;
}

/**
 * 기능 절과 저장 표: { md 경로: 내용 } → [{ id, title, doc, line, ids: Set(절 안 표 첫 칸 · 제목의 ID), save: null | { line, none, rows: [{ target, schema, table, column, source, cond, def, line }], bad: [줄] } }]
 * 기능 절 = ID 로 시작하는 ## (또는 ###) 제목부터 같은 수준 이상의 다음 제목까지
 */
function features(files) {
  const out = [];
  for (const doc of Object.keys(files).filter((k) => /\.md$/i.test(k)).sort()) {
    let fence = false;
    let f = null; // 지금 기능 절
    let inSave = false;
    let head = null;
    String(files[doc]).split('\n').forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
      if (fence) return;
      const h = /^(#{1,6})\s/.exec(line);
      if (h) {
        const lv = h[1].length;
        const fh = FEATURE_HEAD.exec(line);
        if (f && lv <= f.level) f = null;
        if (fh && !f) {
          f = { id: fh[2], title: fh[3], doc, line: i + 1, level: lv, ids: new Set([fh[2]]), save: null };
          out.push(f);
          inSave = false;
          return;
        }
        inSave = false;
        if (f && SAVE_HEAD.test(line)) { f.save = f.save || { line: i + 1, none: false, rows: [], bad: [] }; inSave = true; head = null; }
        return;
      }
      if (!f) return;
      if (/^\s*\|/.test(line)) {
        const cells = cellsOf(line);
        if (!inSave) { const first = plain(cells[0] || ''); if (new RegExp(`^${ID_SRC}$`).test(first)) f.ids.add(first); return; }
        if (!head) {
          const low = cells.map((c) => plain(c).toLowerCase());
          const col = (k) => low.findIndex((c) => COLS[k].includes(c));
          head = { target: Math.max(0, col('target')), source: col('source'), cond: col('cond'), def: col('def') };
          if (head.source < 0 && cells.length > 1) head.source = 1;
          if (head.cond < 0 && cells.length > 2) head.cond = 2;
          if (head.def < 0 && cells.length > 3) head.def = 3;
          return;
        }
        if (isSep(cells)) return;
        const get = (k) => (head[k] >= 0 ? (cells[head[k]] || '').trim() : '');
        const t = parseTarget(get('target'));
        if (!t) { if (plain(get('target'))) f.save.bad.push({ line: i + 1, text: plain(get('target')) }); return; }
        f.save.rows.push({ target: plain(get('target')), ...t, source: get('source'), cond: get('cond'), def: get('def'), line: i + 1 });
        return;
      }
      if (inSave && /^\s*없음(?![\w가-힣])/.test(plain(line.replace(/^[>\-*]\s*/, '')))) f.save.none = true;
    });
  }
  for (const f of out) delete f.level;
  return out;
}

// ───────── 보고서의 쓰기 ─────────

const lower = (s) => String(s || '').toLowerCase();
const splitTable = (t) => { const p = String(t || '').split('.'); return p.length > 1 ? { schema: p.slice(0, -1).join('.'), table: p[p.length - 1] } : { schema: '', table: p[0] }; };
const ROW_OPS = new Set(['INSERT', 'UPSERT', 'INSERT_IGNORE', 'MERGE']);

/** 쓰기 하나가 쓴 컬럼: { columns: [이름], whole: 행 삭제, unknown: 문장만 있어 컬럼을 모름 } */
function columnsOf(w) {
  const cols = new Set();
  for (const r of w.rows || []) for (const k of Object.keys(r || {})) cols.add(k);
  for (const k of Object.keys(w.set || {})) cols.add(k);
  for (const k of w.sameAsInsert || []) cols.add(k);
  const op = String(w.op || '').toUpperCase();
  const whole = op === 'DELETE';
  return { columns: [...cols], whole, unknown: !cols.size && !whole };
}

/** 쓴 값: [{ column, value }] (행 · set). 마스킹 · 식(!sql) 은 그대로 넘기고 판정에서 거른다 */
function valuesOf(w) {
  const out = [];
  for (const r of w.rows || []) for (const [k, v] of Object.entries(r || {})) out.push({ column: k, value: v });
  for (const [k, v] of Object.entries(w.set || {})) out.push({ column: k, value: v });
  return out;
}

/** 표 행이 그 테이블.컬럼을 덮는가 (스키마는 한쪽이 비면 테이블 이름만 본다) */
function rowCovers(row, schema, table, column) {
  if (lower(row.table) !== lower(table)) return false;
  if (row.schema && schema && lower(row.schema) !== lower(schema)) return false;
  return row.column === '*' || column === '*' || lower(row.column) === lower(column);
}

// ───────── 타입 범위 ─────────

const INT_MAX = { smallint: 32767, int2: 32767, integer: 2147483647, int: 2147483647, int4: 2147483647, serial: 2147483647, bigint: 9223372036854775807, int8: 9223372036854775807, bigserial: 9223372036854775807 };
/** 타입 글 → { kind: num|str|int, p, s, n, max } | null */
function parseType(t) {
  const x = lower(t).replace(/\s+/g, ' ').trim();
  let m = /^(?:numeric|decimal|number)\s*\(\s*(\d+)\s*(?:,\s*(-?\d+)\s*)?\)$/.exec(x);
  if (m) return { kind: 'num', p: Number(m[1]), s: Number(m[2] || 0) };
  if (/^(numeric|decimal|number)$/.test(x)) return { kind: 'num', p: Infinity, s: Infinity };
  m = /^(?:character varying|varchar|varchar2|nvarchar|nvarchar2|char|character|nchar|bpchar)\s*\(\s*(\d+)\s*(?:byte|char)?\s*\)$/.exec(x);
  if (m) return { kind: 'str', n: Number(m[1]) };
  if (/^(text|character varying|varchar|clob|longtext|mediumtext)$/.test(x)) return { kind: 'str', n: Infinity };
  if (INT_MAX[x] != null) return { kind: 'int', max: INT_MAX[x] };
  return null;
}
const showType = (t) => String(t || '').replace(/character varying/i, 'varchar');

/** 그 값이 그 타입에 들어가는가: null | { level: '✖'|'⚠', why }. 식 {$sql} · 바이트 {$bytes} 는 보지 않는다 (index.json 표기, FORMAT.md) */
function valueRisk(type, value) {
  const ty = parseType(type);
  if (!ty || value == null || typeof value === 'boolean' || typeof value === 'object') return null;
  if (ty.kind === 'str') {
    if (typeof value !== 'string' || value === '***') return null;
    const tm = /^<text:(\d+)>$/.exec(value);
    if (/^<[a-z]+>$/.test(value)) return null;
    const len = tm ? Number(tm[1]) : [...value].length;
    if (len > ty.n) return { level: '✖', why: `길이 ${len} > ${ty.n}` };
    if (len === ty.n) return { level: '⚠', why: `길이 ${len} = 한도 ${ty.n}` };
    return null;
  }
  const num = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? value : null;
  if (num == null) return null;
  const s = String(num).replace(/^-/, '');
  if (/e/i.test(s)) return null;
  const [ip, fp = ''] = s.split('.');
  const intDigits = ip.replace(/^0+/, '').length;
  if (ty.kind === 'int') return Math.abs(Number(num)) > ty.max ? { level: '✖', why: `${num} > ${ty.max}` } : null;
  if (!Number.isFinite(ty.p)) return null;
  const room = ty.p - ty.s;
  if (intDigits > room) return { level: '✖', why: `정수 ${intDigits}자리 > ${room}자리` };
  if (fp.replace(/0+$/, '').length > ty.s) return { level: '⚠', why: `소수 ${fp.length}자리 > ${ty.s}자리 (반올림)` };
  if (room > 0 && intDigits === room) return { level: '⚠', why: `정수 ${intDigits}자리 = 한도` };
  return null;
}

/** a 타입이 b 타입보다 넓은가 (값 출처 → 대상). 종류가 다르면 판단하지 않는다 (숫자 → 정수는 본다) */
function wider(a, b) {
  const x = parseType(a), y = parseType(b);
  if (!x || !y) return false;
  if (x.kind === 'str' && y.kind === 'str') return x.n > y.n;
  if (x.kind === 'int' && y.kind === 'int') return x.max > y.max;
  if (x.kind === 'num' && y.kind === 'num') return (x.p - x.s) > (y.p - y.s) || x.s > y.s;
  if (x.kind === 'num' && y.kind === 'int') return x.s > 0 || !Number.isFinite(x.p) || 10 ** (x.p - x.s) > y.max;
  if (x.kind === 'int' && y.kind === 'num') return Number.isFinite(y.p) && String(x.max).length > y.p - y.s;
  return false;
}

/** 컬럼 타입 찾기: 보고서 catalog 먼저, 없으면 데이터 설계 정의서 모델 { tables: [{ schema, name, columns: [{ name, type }] }] } */
function typeFinder(catalog, dm) {
  return (schema, table, column) => {
    const cat = catalog || {};
    for (const sc of schema ? [schema] : Object.keys(cat)) {
      const t = cat[sc] && (cat[sc][table] || cat[sc][lower(table)]);
      const c = t && (t.columns || []).find((x) => lower(x.name) === lower(column));
      if (c && c.type) return { type: c.type, from: '보고서' };
    }
    for (const t of (dm && dm.tables) || []) {
      if (lower(t.name) !== lower(table) || (schema && lower(t.schema) !== lower(schema))) continue;
      const c = t.columns.find((x) => lower(x.name) === lower(column));
      if (c && c.type) return { type: c.type, from: '데이터 설계' };
    }
    return null;
  };
}

// ───────── 대조 ─────────

/**
 * 보고서 ↔ 저장 표. 반환 { groups: [{ id, title, doc, tests, unlisted, unused, risks, unknown }], noTests: [기능], violations }
 * - 시험의 specs 가 기능 절(제목 ID · 절 안 표 첫 칸 ID, 예: 수용 기준 AC-…)에 들면 그 기능으로 묶는다. 못 묶은 시험은 id null 묶음 (모든 저장 표와 대조)
 * - unlisted: 저장 표에 없는 쓰기 · unused: 저장 표에 있는데 시험이 안 쓴 것 · risks: 타입 범위(값 · 값 출처) · unknown: 문장만 있어 컬럼을 모르는 쓰기 수
 * - violations = unlisted + ✖ risks (안 쓴 컬럼 · ⚠ 는 세지 않는다: 시험하지 않은 분기일 수 있다)
 */
function check(report, feats, opts = {}) {
  const typeOf = typeFinder(report.catalog, opts.datamodel);
  const byId = new Map();
  for (const f of feats) for (const id of f.ids) if (!byId.has(id)) byId.set(id, f);
  const allRows = feats.flatMap((f) => (f.save ? f.save.rows : []));
  const groups = new Map();
  const groupOf = (f) => {
    const k = f ? f.id : '';
    if (!groups.has(k)) groups.set(k, { id: f ? f.id : null, title: f ? f.title : '기능 ID 없는 시험', doc: f ? f.doc : '', line: f ? f.line : 0, save: f ? f.save : null, tests: [], unlisted: new Map(), written: new Set(), risks: new Map(), unknown: 0 });
    return groups.get(k);
  };
  for (const t of report.tests || []) {
    const fs0 = [...new Set((t.specs || []).map((s) => byId.get(s)).filter(Boolean))];
    for (const f of fs0.length ? fs0 : [null]) {
      const g = groupOf(f);
      g.tests.push(t.id);
      const rows = f ? (f.save ? f.save.rows : []) : allRows;
      for (const w of t.writes || []) {
        const { schema, table } = splitTable(w.table);
        const c = columnsOf(w);
        if (c.unknown) { g.unknown++; continue; }
        for (const col of c.whole ? ['*'] : c.columns) {
          g.written.add(`${lower(schema)}|${lower(table)}|${lower(col)}`);
          if (!rows.some((r) => rowCovers(r, schema, table, col))) {
            const k = `${w.table}.${col}`;
            const u = g.unlisted.get(k) || { table: w.table, column: col, ops: new Set(), tests: new Set() };
            u.ops.add(String(w.op || '').toUpperCase()); u.tests.add(t.id);
            g.unlisted.set(k, u);
          }
        }
        if (w.result && w.result.error && /^22(003|001)$/.test(String(w.result.error))) {
          const k = `${w.table}|db`;
          if (!g.risks.has(k)) g.risks.set(k, { level: '✖', table: w.table, column: '', type: '', why: `DB 오류 ${w.result.error}${w.result.message ? ` (${w.result.message})` : ''}`, test: t.id });
        }
        for (const { column, value } of valuesOf(w)) {
          const ty = typeOf(schema, table, column);
          const r = ty && valueRisk(ty.type, value);
          if (!r) continue;
          const k = `${w.table}.${column}`;
          const cur = g.risks.get(k);
          if (!cur || (cur.level === '⚠' && r.level === '✖')) g.risks.set(k, { ...r, table: w.table, column, type: showType(ty.type), value, test: t.id });
        }
      }
    }
  }
  // 값 출처가 다른 컬럼이면 타입 너비 비교 (시험이 없어도 저장 표만으로)
  const sourceRisks = [];
  for (const f of feats) for (const r of (f.save ? f.save.rows : [])) {
    if (r.column === '*') continue;
    const to = typeOf(r.schema, r.table, r.column);
    if (!to) continue;
    for (const m of plain(r.source).matchAll(REF_IN_TEXT)) {
      const src = parseTarget(m[1]);
      if (!src || src.column === '*' || (lower(src.table) === lower(r.table) && lower(src.column) === lower(r.column))) continue;
      const from = typeOf(src.schema, src.table, src.column);
      if (from && wider(from.type, to.type)) sourceRisks.push({ feature: f.id, level: '✖', table: r.schema ? `${r.schema}.${r.table}` : r.table, column: r.column, type: showType(to.type), why: `값 출처 ${m[1]} ${showType(from.type)} 가 더 넓음`, line: r.line, doc: f.doc });
    }
  }
  const out = [];
  const tested = new Set();
  for (const g of groups.values()) {
    if (g.id) tested.add(g.id);
    // 행 전체(*) 행은 그 테이블에 무엇이든 썼으면 쓴 것으로 본다
    const hit = (r) => [...g.written].some((k) => { const [sc, tb, col] = k.split('|'); return tb === lower(r.table) && (!r.schema || !sc || sc === lower(r.schema)) && (r.column === '*' || col === lower(r.column)); });
    const unused = g.id && g.save ? g.save.rows.filter((r) => !hit(r)) : [];
    out.push({
      id: g.id, title: g.title, doc: g.doc, line: g.line, tests: [...new Set(g.tests)], noSave: !!g.id && !g.save, saveNone: !!(g.save && g.save.none),
      unlisted: [...g.unlisted.values()].map((u) => ({ table: u.table, column: u.column, ops: [...u.ops], tests: [...u.tests] })),
      unused: unused.map((r) => ({ target: r.target, cond: plain(r.cond), line: r.line })),
      risks: [...g.risks.values(), ...sourceRisks.filter((s) => s.feature === g.id)],
      unknown: g.unknown,
    });
  }
  // 시험이 없는 기능의 값 출처 위험도 남긴다
  for (const s of sourceRisks) {
    if (tested.has(s.feature)) continue;
    let g = out.find((x) => x.id === s.feature && !x.tests.length);
    if (!g) { const f = feats.find((x) => x.id === s.feature); g = { id: f.id, title: f.title, doc: f.doc, line: f.line, tests: [], noSave: false, unlisted: [], unused: [], risks: [], unknown: 0 }; out.push(g); }
    g.risks.push(s);
  }
  out.sort((a, b) => (a.id === null) - (b.id === null) || String(a.id).localeCompare(String(b.id)));
  const noTests = feats.filter((f) => f.save && f.save.rows.length && !tested.has(f.id)).map((f) => ({ id: f.id, title: f.title, doc: f.doc, line: f.line }));
  const violations = out.reduce((n, g) => n + g.unlisted.length + g.risks.filter((r) => r.level === '✖').length, 0);
  return { groups: out, noTests, violations };
}

/** 문서 사이트 예시 행: 그 기능 ID 들(specs)이 붙은 시험의 쓰기 중 앞의 몇 개. [{ test, op, table, row, result }] */
function examples(report, ids, max = 5) {
  const want = new Set(ids);
  const out = [];
  for (const t of report.tests || []) {
    if (!(t.specs || []).some((s) => want.has(s))) continue;
    for (const w of t.writes || []) {
      const row = (w.rows && w.rows[0]) || w.set || w.where || null;
      out.push({ test: t.id, name: t.name || t.id, status: t.status || '', op: w.op, table: w.table, row, more: (w.rows || []).length > 1 ? w.rows.length - 1 : 0, result: w.result || null, rolledBack: !!w.rolledBack });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** 값 한 칸 글 (보고서 값 그대로: null · 문자열 · 숫자 · 식) */
function showValue(v) {
  if (v === null) return 'null';
  if (v === undefined) return '';
  if (typeof v === 'object') return v.$sql != null ? `식 ${v.$sql}` : v.$bytes != null ? `바이트 ${v.$bytes}` : JSON.stringify(v);
  return String(v);
}

module.exports = { REPORT_DIRS, findReports, loadReport, features, parseTarget, columnsOf, valuesOf, parseType, valueRisk, wider, typeFinder, check, examples, showValue, splitTable, ID_RE };
