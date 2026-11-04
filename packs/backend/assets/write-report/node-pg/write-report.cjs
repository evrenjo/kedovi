'use strict';
/**
 * 쓰기 보고서 기록기 (Node + pg). node:test · vitest · jest 공용.
 *
 * 시험 본문이 DB 에 쓴 것을 `.write-report/<시험 파일>/<이름>.yaml` 로 남기고,
 * `assertWrites(이름, 테이블...)` 로 승인본과 비교한다. 형식은 킷의 FORMAT.md 를 따른다.
 *
 *   const { recordWrites, assertWrites } = require('./write-report.cjs');
 *   test('FN-ORD-003 주문 저장', recordWrites(async () => { ...; assertWrites('저장'); }));
 *
 * 의존성: node 기본 모듈 + pg.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AssertionError } = require('assert');

const STACK = 'node-pg';
const APPROVE_ENV = 'WRITE_REPORT_APPROVE';
const G = Symbol.for('writeReport.global');
const TX = Symbol.for('writeReport.tx');
const POOL = Symbol.for('writeReport.pool');

// ---------------------------------------------------------------- 설정

const DEFAULTS = {
  output: '.write-report',
  approved: 'test/write-report/approved',
  viewer: 'test/write-report/viewer.html',
  ids: [],
  now: ['created_at', 'updated_at', 'inserted_at', 'modified_at'],
  replace: [],
  unknownBinds: 'type',
  excludeTables: ['batch_*', 'qrtz_*', 'flyway_schema_history', 'databasechangelog*', 'shedlock'],
};

const asList = (v) => (v == null ? [] : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [...v]);

function findRoot() {
  let d = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(d, 'write-report.json'))) return d;
    const up = path.dirname(d);
    if (up === d) return process.cwd();
    d = up;
  }
}

function loadConfig(root) {
  let raw = {};
  const p = path.join(root, 'write-report.json');
  if (fs.existsSync(p)) raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const flat = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && (k === 'mask' || k === 'exclude')) {
      for (const [k2, v2] of Object.entries(v)) flat[`${k}.${k2}`] = v2;
    } else flat[k] = v;
  }
  let upd = flat['exclude.updatesOnly'];
  upd = upd == null ? [] : typeof upd === 'string' ? [upd] : [...upd];
  let rep = flat.replace == null ? [] : typeof flat.replace === 'string' ? [flat.replace] : [...flat.replace];
  for (const k of Object.keys(flat).sort()) {
    if (/^exclude\.updatesOnly\.\d+$/.test(k)) upd.push(flat[k]);
    if (/^replace\.\d+$/.test(k)) rep.push(flat[k]);
  }
  const cfg = {
    root,
    output: path.resolve(root, flat.output || DEFAULTS.output),
    approved: path.resolve(root, flat.approved || DEFAULTS.approved),
    viewer: path.resolve(root, flat.viewer || DEFAULTS.viewer),
    ids: asList(flat.ids ?? DEFAULTS.ids).map((s) => s.toLowerCase()),
    now: asList(flat.now ?? DEFAULTS.now).map((s) => s.toLowerCase()),
    unknownBinds: flat['mask.unknownBinds'] || DEFAULTS.unknownBinds,
    excludeTables: asList(flat['exclude.tables'] ?? DEFAULTS.excludeTables),
    replace: [],
    updatesOnly: [],
  };
  for (const r of rep) {
    let pat, to;
    if (Array.isArray(r)) [pat, to = ''] = r;
    else if (r && typeof r === 'object') ({ pattern: pat, replacement: to = '' } = r);
    else {
      const i = String(r).indexOf('=>');
      pat = i < 0 ? String(r) : String(r).slice(0, i);
      to = i < 0 ? '' : String(r).slice(i + 2);
    }
    if (pat) cfg.replace.push([new RegExp(pat, 'g'), to]);
  }
  for (const u of upd) {
    let t, cols;
    if (u && typeof u === 'object') ({ table: t, columns: cols } = u);
    else {
      const i = String(u).indexOf(':');
      t = String(u).slice(0, i);
      cols = String(u).slice(i + 1);
    }
    cols = asList(cols).map((c) => c.toLowerCase());
    if (t && cols.length) cfg.updatesOnly.push({ table: t.trim(), columns: cols });
  }
  return cfg;
}

// ---------------------------------------------------------------- 값 표지

class SqlExpr { constructor(text) { this.text = text; } }
class Bytes { constructor(n) { this.n = n; } }
class DateVal { constructor(s) { this.s = s; } }
class NumText { constructor(s) { this.s = s; } }
class Bind { constructor(key) { this.key = key; } }
class AnyBind { constructor(b) { this.bind = b; } }
class Lit { constructor(v) { this.v = v; } }
const DEFAULT = Symbol('DEFAULT');

// ---------------------------------------------------------------- SQL 토큰

const TOK_RE = new RegExp([
  '(?<ws>\\s+)',
  '(?<cm>--[^\\n]*|/\\*[\\s\\S]*?\\*/)',
  "(?<str>[Ee]'(?:[^'\\\\]|\\\\[\\s\\S]|'')*'|[Nn]?'(?:[^']|'')*')",
  '(?<dol>\\$\\$[\\s\\S]*?\\$\\$|\\$(?<tag>[A-Za-z_]\\w*)\\$[\\s\\S]*?\\$\\k<tag>\\$)',
  '(?<pnum>\\$\\d+)',
  '(?<cast>::)',
  '(?<qid>"(?:[^"]|"")*")',
  '(?<num>(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)',
  '(?<id>[A-Za-z_\\u0080-\\uffff][\\w$\\u0080-\\uffff]*)',
  '(?<op><>|!=|<=|>=|\\|\\||[(),;.\\[\\]=<>+\\-*/%^~!@#&|{}?:])',
  '(?<other>[\\s\\S])',
].join('|'), 'gu');

function tokenize(sql) {
  const out = [];
  TOK_RE.lastIndex = 0;
  let m;
  while ((m = TOK_RE.exec(sql))) {
    const g = m.groups;
    const text = m[0];
    if (g.ws !== undefined || g.cm !== undefined) continue;
    if (g.str !== undefined) out.push({ kind: 'str', text });
    else if (g.dol !== undefined) out.push({ kind: 'dol', text });
    else if (g.pnum !== undefined) out.push({ kind: 'pnum', text, val: Number(text.slice(1)) - 1 });
    else if (g.cast !== undefined) out.push({ kind: 'cast', text });
    else if (g.qid !== undefined) out.push({ kind: 'id', text, val: text.slice(1, -1).replace(/""/g, '"'), quoted: true });
    else if (g.num !== undefined) out.push({ kind: 'num', text });
    else if (g.id !== undefined) out.push({ kind: 'id', text, val: text.toLowerCase() });
    else out.push({ kind: 'op', text });
  }
  return out;
}

const is = (t, ...w) => !!t && t.kind === 'id' && !t.quoted && w.includes(t.val);
const op = (t, ...o) => !!t && t.kind === 'op' && o.includes(t.text);
const isParam = (t) => t.kind === 'pnum';

function matchParen(toks, i) {
  let d = 0;
  for (let j = i; j < toks.length; j++) {
    if (op(toks[j], '(', '[')) d++;
    else if (op(toks[j], ')', ']')) { d--; if (d === 0) return j; }
  }
  throw new Error('괄호 짝 없음');
}

function splitTop(toks, pred) {
  const parts = [];
  let cur = [], d = 0;
  for (const t of toks) {
    if (op(t, '(', '[')) d++;
    else if (op(t, ')', ']')) d--;
    if (d === 0 && pred(t)) { parts.push(cur); cur = []; } else cur.push(t);
  }
  parts.push(cur);
  return parts;
}
const commas = (toks) => (toks.length ? splitTop(toks, (t) => op(t, ',')).filter((p) => p.length) : []);

function findTop(toks, pred, start = 0) {
  let d = 0;
  for (let j = start; j < toks.length; j++) {
    const t = toks[j];
    if (op(t, '(', '[')) d++;
    else if (op(t, ')', ']')) d--;
    else if (d === 0 && pred(t)) return j;
  }
  return -1;
}

const NO_SPACE_FN = new Set(['in', 'values', 'and', 'or', 'not', 'exists', 'as', 'on', 'where', 'set', 'from', 'into', 'using',
  'select', 'when', 'then', 'else', 'over', 'filter', 'within', 'returning', 'conflict', 'any', 'all', 'is', 'between', 'like',
  'ilike', 'by', 'having', 'join', 'update', 'do', 'table', 'only']);

/** SQL 로 남기는 경로: 바인드 · 인라인 리터럴을 ? 로. */
function render(toks) {
  let out = '', prev = null, castLeft = 0, typeDepth = 0;
  for (const t of toks) {
    let piece;
    if (isParam(t) || t.kind === 'str' || t.kind === 'dol') piece = '?';
    else if (t.kind === 'num') piece = typeDepth > 0 ? t.text : '?';
    else piece = t.text;
    if (t.kind === 'cast') castLeft = 1;
    else if (castLeft && t.kind === 'id') castLeft = 2;
    else if (castLeft === 2 && op(t, '(')) typeDepth++;
    else if (typeDepth && op(t, ')')) { typeDepth--; if (!typeDepth) castLeft = 0; }
    else if (castLeft === 2 && !op(t, '[', ']')) castLeft = 0;
    let space = true;
    if (!prev) space = false;
    else if (op(t, ',', ')', ']', '.') || t.kind === 'cast') space = false;
    else if (op(prev, '(', '[', '.') || prev.kind === 'cast') space = false;
    else if (op(t, '(', '[') && prev.kind === 'id' && !NO_SPACE_FN.has(prev.val)) space = false;
    out += (space ? ' ' : '') + piece;
    prev = t;
  }
  return out;
}

function unquoteStr(text) {
  if (text[0] === 'E' || text[0] === 'e') {
    return text.slice(2, -1).replace(/''/g, "'").replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' })[c] ?? c);
  }
  if (text[0] === 'N' || text[0] === 'n') text = text.slice(1);
  return text.slice(1, -1).replace(/''/g, "'");
}

function stripCast(toks) {
  const j = findTop(toks, (t) => t.kind === 'cast');
  if (j > 0) toks = toks.slice(0, j);
  if (toks.length >= 4 && is(toks[0], 'cast') && op(toks[1], '(') && matchParen(toks, 1) === toks.length - 1) {
    const inner = toks.slice(2, -1);
    const k = findTop(inner, (t) => is(t, 'as'));
    if (k > 0) return stripCast(inner.slice(0, k));
  }
  return toks;
}

function num(text) {
  return /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) ? Number(text) : new NumText(text);
}

/** 바인드 · 리터럴 하나면 그 값 표지, 아니면 null (식). */
function valueOf(toks) {
  toks = stripCast(toks);
  while (toks.length >= 2 && op(toks[0], '(') && matchParen(toks, 0) === toks.length - 1) toks = toks.slice(1, -1);
  if (toks.length === 1) {
    const t = toks[0];
    if (isParam(t)) return new Bind(t.val);
    if (t.kind === 'str') return new Lit(unquoteStr(t.text));
    if (t.kind === 'num') return new Lit(num(t.text));
    if (is(t, 'null')) return new Lit(null);
    if (is(t, 'true')) return new Lit(true);
    if (is(t, 'false')) return new Lit(false);
    if (is(t, 'default')) return DEFAULT;
  }
  if (toks.length === 2 && op(toks[0], '-') && toks[1].kind === 'num') {
    const n = num(toks[1].text);
    return new Lit(typeof n === 'number' ? -n : new NumText('-' + n.s));
  }
  return null;
}
const expr = (toks) => valueOf(toks) ?? new SqlExpr(render(toks));

function qname(toks, i) {
  const parts = [];
  const t = toks[i];
  if (!t || t.kind !== 'id') throw new Error('테이블 이름 없음');
  parts.push(t.val);
  i++;
  while (op(toks[i], '.') && toks[i + 1] && toks[i + 1].kind === 'id') { parts.push(toks[i + 1].val); i += 2; }
  return [parts.slice(-2), i];
}

function colref(toks, quals) {
  if (toks.length === 1 && toks[0].kind === 'id' && !is(toks[0], 'null', 'true', 'false', 'default', 'not')) return toks[0].val;
  if (toks.length === 3 && toks[0].kind === 'id' && op(toks[1], '.') && toks[2].kind === 'id') return quals.has(toks[0].val) ? toks[2].val : null;
  if (toks.length === 5 && op(toks[1], '.') && op(toks[3], '.') && toks[4].kind === 'id') return quals.has(toks[2].val) ? toks[4].val : null;
  return null;
}

function assignments(toks) {
  const sets = [], same = [];
  for (const part of commas(toks)) {
    const j = findTop(part, (t) => op(t, '='));
    if (j <= 0) throw new Error('SET 식');
    const left = part.slice(0, j), right = part.slice(j + 1);
    if (op(left[0], '(')) {
      const cols = commas(left.slice(1, -1)).map((c) => c[c.length - 1].val);
      const r = op(right[0], '(') ? right.slice(1, -1) : is(right[0], 'row') ? right.slice(2, -1) : null;
      if (!r) throw new Error('다중 SET');
      const vals = commas(r);
      if (vals.length !== cols.length) throw new Error('다중 SET 수');
      cols.forEach((c, k) => sets.push([c, expr(vals[k])]));
      continue;
    }
    const col = left[left.length - 1].val;
    if (right.length === 3 && is(right[0], 'excluded') && op(right[1], '.') && right[2].val === col) { same.push(col); continue; }
    sets.push([col, expr(right)]);
  }
  return [sets, same];
}

function parseWhere(toks, quals) {
  const where = [], rest = [];
  if (findTop(toks, (t) => is(t, 'or')) >= 0) return [where, [toks]];
  const conj = [];
  let cur = [], d = 0, between = false;
  for (const t of toks) {
    if (op(t, '(', '[')) d++;
    else if (op(t, ')', ']')) d--;
    if (d === 0 && is(t, 'between')) between = true;
    if (d === 0 && is(t, 'and')) {
      if (between) between = false;
      else { conj.push(cur); cur = []; continue; }
    }
    cur.push(t);
  }
  conj.push(cur);
  const seen = new Set();
  for (const c of conj) {
    if (!c.length) continue;
    if (op(c[0], '(') && matchParen(c, 0) === c.length - 1) {
      const [w2, r2] = parseWhere(c.slice(1, -1), quals);
      if (w2.some(([col]) => seen.has(col))) rest.push(c);
      else { w2.forEach(([col]) => seen.add(col)); where.push(...w2); rest.push(...r2); }
      continue;
    }
    const got = whereOne(c, quals);
    if (got && !seen.has(got[0])) { seen.add(got[0]); where.push(got); } else rest.push(c);
  }
  return [where, rest];
}

function whereOne(c, quals) {
  const j = findTop(c, (t) => op(t, '='));
  if (j > 0) {
    const left = c.slice(0, j), right = c.slice(j + 1);
    let col = colref(left, quals);
    if (col) {
      if (right.length >= 3 && is(right[0], 'any') && op(right[1], '(') && matchParen(right, 1) === right.length - 1) {
        const v = valueOf(right.slice(2, -1));
        return v instanceof Bind ? [col, new AnyBind(v)] : null;
      }
      const v = valueOf(right);
      if (v !== null && v !== DEFAULT) return [col, v];
    }
    col = colref(right, quals);
    if (col) {
      const v = valueOf(left);
      if (v !== null && v !== DEFAULT) return [col, v];
    }
    return null;
  }
  let k = findTop(c, (t) => is(t, 'in'));
  if (k > 0 && !is(c[k - 1], 'not')) {
    const col = colref(c.slice(0, k), quals);
    const r = c.slice(k + 1);
    if (col && r.length && op(r[0], '(') && matchParen(r, 0) === r.length - 1) {
      const vals = commas(r.slice(1, -1)).map(valueOf);
      if (vals.length && vals.every((v) => v !== null && v !== DEFAULT)) return [col, vals];
    }
    return null;
  }
  k = findTop(c, (t) => is(t, 'is'));
  if (k > 0 && c.length === k + 2 && is(c[k + 1], 'null')) {
    const col = colref(c.slice(0, k), quals);
    if (col) return [col, new Lit(null)];
  }
  return null;
}

function guessTable(toks) {
  for (let j = 0; j < toks.length - 1; j++) {
    if (is(toks[j], 'into', 'update', 'from', 'truncate', 'table', 'copy') && toks[j + 1].kind === 'id') {
      let k = j + 1;
      if (is(toks[k], 'only', 'table') && toks[k + 1] && toks[k + 1].kind === 'id') k++;
      try { return qname(toks, k)[0]; } catch { return null; }
    }
  }
  return null;
}

function sqlWrite(toks, o = 'SQL') {
  const w = { op: o, sql: render(toks) };
  const t = guessTable(toks);
  if (t) w.table = t;
  return w;
}

/** 문장 하나 → 쓰기 틀 (바인드 미해결) 또는 null (쓰기가 아님). */
function parseStatement(toks) {
  if (!toks.length || toks[0].kind !== 'id') return null;
  const head = toks[0].val;
  try {
    if (head === 'insert') return parseInsert(toks);
    if (head === 'update') return parseUpdate(toks);
    if (head === 'delete') return parseDelete(toks);
    if (head === 'merge') return sqlWrite(toks, 'MERGE');
    if (head === 'with') {
      const j = findTop(toks, (t) => is(t, 'insert', 'update', 'delete', 'merge'));
      if (j < 0) return null;
      return sqlWrite(toks, is(toks[j], 'merge') ? 'MERGE' : 'SQL');
    }
    if (head === 'truncate' || head === 'call') return sqlWrite(toks);
    if (head === 'copy' && findTop(toks, (t) => is(t, 'from')) > 0) return sqlWrite(toks);
  } catch {
    return sqlWrite(toks, head === 'merge' ? 'MERGE' : 'SQL');
  }
  return null;
}

function parseInsert(toks) {
  let i = 1;
  if (is(toks[i], 'into')) i++;
  let table;
  [table, i] = qname(toks, i);
  if (is(toks[i], 'as')) i += 2;
  let cols = null;
  if (op(toks[i], '(')) {
    const e = matchParen(toks, i);
    cols = [];
    for (const c of commas(toks.slice(i + 1, e))) {
      if (c.length !== 1 || c[0].kind !== 'id') return sqlWrite(toks);
      cols.push(c[0].val);
    }
    i = e + 1;
  }
  if (is(toks[i], 'overriding')) while (toks[i] && !is(toks[i], 'values', 'select')) i++;
  let tuples = [];
  if (is(toks[i], 'default') && is(toks[i + 1], 'values')) { tuples = [[]]; cols = []; i += 2; }
  else if (is(toks[i], 'values')) {
    i++;
    while (op(toks[i], '(')) {
      const e = matchParen(toks, i);
      tuples.push(commas(toks.slice(i + 1, e)));
      i = e + 1;
      if (op(toks[i], ',')) i++; else break;
    }
  } else return sqlWrite(toks);
  const w = { op: 'INSERT', table, cols, tuples: tuples.map((tup) => tup.map(expr)) };
  if (is(toks[i], 'on') && is(toks[i + 1], 'conflict')) {
    i += 2;
    if (op(toks[i], '(')) {
      const e = matchParen(toks, i);
      w.conflict = commas(toks.slice(i + 1, e)).map((p) => (p.length === 1 ? p[0].val : render(p)));
      i = e + 1;
      if (is(toks[i], 'where')) while (toks[i] && !is(toks[i], 'do')) i++;
    } else if (is(toks[i], 'on') && is(toks[i + 1], 'constraint')) {
      w.conflict = ['constraint ' + toks[i + 2].val];
      i += 3;
    }
    if (!is(toks[i], 'do')) throw new Error('ON CONFLICT');
    if (is(toks[i + 1], 'nothing')) { w.op = 'INSERT_IGNORE'; i += 2; }
    else if (is(toks[i + 1], 'update') && is(toks[i + 2], 'set')) {
      w.op = 'UPSERT';
      i += 3;
      const end = findTop(toks, (t) => is(t, 'where', 'returning'), i);
      [w.set, w.sameAsInsert] = assignments(end < 0 ? toks.slice(i) : toks.slice(i, end));
      if (end >= 0 && is(toks[end], 'where')) {
        const r = findTop(toks, (t) => is(t, 'returning'), end);
        w.whereSql = render(r < 0 ? toks.slice(end + 1) : toks.slice(end + 1, r));
      }
    } else throw new Error('DO');
  }
  return w;
}

function parseUpdate(toks) {
  let i = 1;
  if (is(toks[i], 'only')) i++;
  let table;
  [table, i] = qname(toks, i);
  const quals = new Set([table[table.length - 1], table.join('.')]);
  if (is(toks[i], 'as')) { quals.add(toks[i + 1].val); i += 2; }
  else if (toks[i] && toks[i].kind === 'id' && !is(toks[i], 'set')) { quals.add(toks[i].val); i++; }
  if (!is(toks[i], 'set')) return sqlWrite(toks);
  i++;
  const end = findTop(toks, (t) => is(t, 'from', 'where', 'returning'), i);
  if (end >= 0 && is(toks[end], 'from')) return sqlWrite(toks);
  const [sets, same] = assignments(end < 0 ? toks.slice(i) : toks.slice(i, end));
  if (same.length) throw new Error('UPDATE EXCLUDED');
  const w = { op: 'UPDATE', table, set: sets };
  if (end >= 0 && is(toks[end], 'where')) {
    const r = findTop(toks, (t) => is(t, 'returning'), end);
    applyWhere(w, r < 0 ? toks.slice(end + 1) : toks.slice(end + 1, r), quals);
  }
  return w;
}

function parseDelete(toks) {
  let i = 1;
  if (is(toks[i], 'from')) i++;
  if (is(toks[i], 'only')) i++;
  let table;
  [table, i] = qname(toks, i);
  const quals = new Set([table[table.length - 1], table.join('.')]);
  if (is(toks[i], 'as')) { quals.add(toks[i + 1].val); i += 2; }
  else if (toks[i] && toks[i].kind === 'id' && !is(toks[i], 'where', 'using', 'returning')) { quals.add(toks[i].val); i++; }
  if (is(toks[i], 'using')) return sqlWrite(toks);
  const w = { op: 'DELETE', table };
  if (is(toks[i], 'where')) {
    const r = findTop(toks, (t) => is(t, 'returning'), i);
    applyWhere(w, r < 0 ? toks.slice(i + 1) : toks.slice(i + 1, r), quals);
  } else if (toks[i] && !is(toks[i], 'returning')) return sqlWrite(toks);
  return w;
}

function applyWhere(w, toks, quals) {
  const [where, rest] = parseWhere(toks, quals);
  if (where.length) w.where = where;
  if (rest.length) w.whereSql = rest.map(render).join(' AND ');
}

const splitStatements = (toks) => splitTop(toks, (t) => op(t, ';')).filter((s) => s.length);

// ---------------------------------------------------------------- 카탈로그

const PG_CATALOG_SQL = `
SELECT n.nspname, c.relname, a.attname, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
       pg_get_expr(d.adbin, d.adrelid) AS def, (a.attidentity <> '' OR a.attgenerated <> '') AS generated,
       COALESCE((SELECT k.n FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, n) WHERE k.attnum = a.attnum), 0)::int AS pkpos
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
  AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_'
ORDER BY n.nspname, c.relname, a.attnum`;

function buildCatalog(rows) {
  const cat = {}, pk = {};
  for (const r of rows) {
    const s = (cat[r.nspname] ||= {});
    const t = (s[r.relname] ||= { columns: [], primaryKey: [] });
    t.columns.push({ name: r.attname, type: r.type, nullable: !!r.nullable, default: r.def ?? null, generated: !!r.generated });
    if (r.pkpos) (pk[`${r.nspname}\u0000${r.relname}`] ||= []).push([r.pkpos, r.attname]);
  }
  for (const [k, cols] of Object.entries(pk)) {
    const [s, t] = k.split('\u0000');
    cat[s][t].primaryKey = cols.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  }
  return cat;
}

class Catalog {
  constructor(data = {}, schema = null) { this.data = data; this.schema = schema; }
  resolve(parts) {
    if (parts.length === 2) return parts;
    const t = parts[0];
    if (this.schema && this.data[this.schema] && this.data[this.schema][t]) return [this.schema, t];
    const hits = Object.keys(this.data).filter((s) => this.data[s][t]);
    if (hits.length === 1) return [hits[0], t];
    return [this.schema, t];
  }
  table(schema, table) { return (this.data[schema || ''] || {})[table] || null; }
  colType(schema, table, col) {
    const t = this.table(schema, table);
    const c = t && t.columns.find((x) => x.name === col);
    return c ? String(c.type || '').toLowerCase() : '';
  }
}

// ---------------------------------------------------------------- 값 다듬기

const MASK_RE = /(^|_)(app|api|access|private|secret)_?key(_|$)|password|passwd|token|secret/i;
const NUM_TYPES = /^(smallint|integer|bigint|int\d?|numeric|decimal|real|double precision|float\d?|serial|bigserial|smallserial|money)\b/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOW_EXPR = /^(now\(\)|current_timestamp(\(\d*\))?|localtimestamp(\(\d*\))?|current_date|current_time|clock_timestamp\(\)|statement_timestamp\(\)|transaction_timestamp\(\))(::.*)?$/i;

const maskedCol = (c) => !!c && MASK_RE.test(c);
const pad = (n, w = 2) => String(n).padStart(w, '0');
function localIso(d, ms = true) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    + (ms ? `.${pad(d.getMilliseconds(), 3)}` : '') + `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function fmtValue(v, coltype = '') {
  if (v === undefined || v === null) return null;
  if (v instanceof SqlExpr || typeof v === 'boolean' || typeof v === 'number' || v instanceof NumText || v instanceof DateVal) return v;
  if (typeof v === 'bigint') return new NumText(String(v));
  if (v instanceof Date) return coltype === 'date' ? new DateVal(localDate(v)) : localIso(v);
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return new Bytes(v.length);
  if (Array.isArray(v)) {
    if (coltype.startsWith('json')) return JSON.stringify(v);
    return v.map((x) => fmtValue(x, coltype.replace(/\[\]$/, '')));
  }
  if (typeof v === 'object') {
    if (typeof v.toPostgres === 'function') { try { return fmtValue(v.toPostgres((x) => x), coltype); } catch { return String(v); } }
    return JSON.stringify(v);
  }
  if (typeof v === 'string') {
    if (coltype === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new DateVal(v);
    if (NUM_TYPES.test(coltype) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return new NumText(v);
    if (coltype === 'boolean' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
    return v;
  }
  return String(v);
}

function unknownBind(v, mode) {
  if (mode === 'show') return fmtValue(v);
  if (v === undefined || v === null) return null;
  if (mode === 'hide') return '***';
  if (typeof v === 'boolean') return '<bool>';
  if (typeof v === 'number' || typeof v === 'bigint') return '<number>';
  if (v instanceof Date) return '<time>';
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return new Bytes(v.length);
  return `<text:${String(typeof v === 'object' ? JSON.stringify(v) : v).length}>`;
}

function cleanMessage(msg, replace = []) {
  msg = String(msg ?? '');
  const m = /(DETAIL|Detail|세부 ?정보|상세 ?정보)\s*:/.exec(msg);
  if (m) msg = msg.slice(0, m.index);
  msg = msg.split(/\s+/).filter(Boolean).join(' ');
  for (const [rx, to] of replace) msg = msg.replace(rx, to);
  return msg.trim();
}

// ---------------------------------------------------------------- YAML · JSON 쓰기

const PLAIN = /^[A-Za-z_][A-Za-z0-9_.\-]*$/;
const RESERVED = new Set(['null', 'true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n', '~']);
const yKey = (k) => (PLAIN.test(String(k)) && !RESERVED.has(String(k).toLowerCase()) ? String(k) : JSON.stringify(String(k)));
const yName = (s) => (/^[\w.\-/#]+$/.test(s) && !RESERVED.has(s.toLowerCase()) ? s : JSON.stringify(s));

function yVal(v) {
  if (v === null || v === undefined) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : JSON.stringify(String(v));
  if (v instanceof NumText) return v.s;
  if (v instanceof DateVal) return v.s;
  if (v instanceof SqlExpr) return '!sql ' + JSON.stringify(v.text);
  if (v instanceof Bytes) return `!bytes ${v.n}`;
  if (Array.isArray(v)) return '[' + v.map(yVal).join(', ') + ']';
  if (typeof v === 'object') return '{' + Object.entries(v).map(([k, x]) => `${yKey(k)}: ${yVal(x)}`).join(', ') + '}';
  return JSON.stringify(String(v));
}

function jVal(v) {
  if (v instanceof SqlExpr) return { $sql: v.text };
  if (v instanceof Bytes) return { $bytes: v.n };
  if (v instanceof DateVal) return v.s;
  if (v instanceof NumText) { const n = Number(v.s); return Number.isFinite(n) ? n : v.s; }
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) return v.map(jVal);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jVal(x)]));
  return v;
}

const KEY_ORDER = ['seq', 'op', 'table', 'rows', 'set', 'sameAsInsert', 'conflict', 'where', 'whereSql', 'sql', 'result', 'rolledBack'];

function writeLines(w) {
  const lines = [];
  let first = true;
  for (const k of KEY_ORDER) {
    if (!(k in w)) continue;
    const v = w[k];
    const pre = first ? '  - ' : '    ';
    first = false;
    if (k === 'rows') { lines.push(pre + 'rows:'); for (const r of v) lines.push('      - ' + yVal(r)); }
    else if (k === 'sameAsInsert' || k === 'conflict') lines.push(pre + `${k}: [` + v.map(yKey).join(', ') + ']');
    else if (k === 'table' || k === 'op') lines.push(pre + `${k}: ` + yName(v));
    else lines.push(pre + `${k}: ${yVal(v)}`);
  }
  return lines;
}

function testYaml(t) {
  const out = [`test: ${yName(t.id)}`, 'specs: [' + t.specs.map(yName).join(', ') + ']', `started: ${t.started}`];
  if (!t.writes.length) out.push('writes: []');
  else { out.push('writes:'); for (const w of t.writes) out.push(...writeLines(w)); }
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------- 정규화 (승인본)

function naturalCmp(a, b) {
  const pa = a.split(/(\d+)/).filter((x) => x !== ''), pb = b.split(/(\d+)/).filter((x) => x !== '');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    const dx = /^\d+$/.test(x), dy = /^\d+$/.test(y);
    if (dx && dy) { const c = BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0; if (c) return c; }
    else if (dx !== dy) return dx ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return pa.length - pb.length;
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
function normJsonStr(s) {
  if (s[0] === '{' || s[0] === '[') { try { return JSON.stringify(sortKeys(JSON.parse(s))); } catch { return s; } }
  return s;
}

function numeric(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof NumText) { const n = Number(v.s); return Number.isFinite(n) ? n : null; }
  return null;
}

function normalize(writes, catalog, cfg) {
  const idcols = [];
  const tables = [...new Set(writes.filter((w) => w.table).map((w) => w.table))];
  for (const tname of tables) {
    const parts = tname.split('.');
    const [schema, table] = parts.length === 2 ? parts : [null, parts[0]];
    for (const spec of cfg.ids) {
      const sp = spec.split('.');
      if (sp.length >= 2 && (sp.slice(0, -1).join('.') === tname || sp[sp.length - 2] === table)) idcols.push([tname, sp[sp.length - 1], true]);
    }
    if (!cfg.ids.length) {
      const t = catalog.table(schema, table);
      if (t && t.primaryKey.length === 1 && NUM_TYPES.test(catalog.colType(schema, table, t.primaryKey[0]))) idcols.push([tname, t.primaryKey[0], false]);
    }
  }
  const mapping = new Map();
  for (const [tname, col, explicit] of idcols) {
    const inserted = new Set(), seen = new Set();
    for (const w of writes) {
      if (w.table !== tname) continue;
      for (const r of w.rows || []) { const n = numeric(r[col]); if (n !== null) inserted.add(n); }
      for (const src of [w.set || {}, w.where || {}]) {
        const v = src[col];
        for (const x of Array.isArray(v) ? v : [v]) { const n = numeric(x); if (n !== null) seen.add(n); }
      }
    }
    const vals = (explicit ? [...new Set([...seen, ...inserted])] : [...seen].filter((x) => !inserted.has(x))).sort((a, b) => a - b);
    mapping.set(`${tname}\u0000${col}`, new Map(vals.map((v, i) => [v, `<${col}-${i + 1}>`])));
  }
  const nowCols = new Set(cfg.now);
  const nv = (tname, col, v) => {
    if (Array.isArray(v)) return v.map((x) => nv(tname, col, x));
    const m = mapping.get(`${tname}\u0000${col}`);
    if (m) { const n = numeric(v); if (n !== null && m.has(n)) return m.get(n); }
    if (nowCols.has(col) && v !== null) return '<now>';
    if (v instanceof SqlExpr && NOW_EXPR.test(v.text.trim())) return '<now>';
    if (typeof v === 'string') return UUID_RE.test(v) ? '<uuid>' : normJsonStr(v);
    return v;
  };
  const mapObj = (t, o) => Object.fromEntries(Object.entries(o).map(([c, x]) => [c, nv(t, c, x)]));
  return writes.map((w) => {
    const n = {};
    for (const k of KEY_ORDER) {
      if (!(k in w) || k === 'seq') continue;
      let v = w[k];
      if (k === 'rows') v = v.map((r) => mapObj(w.table, r));
      else if (k === 'set' || k === 'where') v = mapObj(w.table, v);
      else if (k === 'result' && 'message' in v) v = { ...v, message: cleanMessage(v.message, cfg.replace) };
      n[k] = v;
    }
    return n;
  });
}

function approvedYaml(writes, chosen, catalog, cfg) {
  const norm = normalize(writes, catalog, cfg);
  const groups = new Map();
  for (const w of norm) {
    const k = w.table || '(sql)';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  let keys;
  if (chosen.length) {
    keys = chosen.map((c) => {
      const parts = c.toLowerCase().split('.');
      let full = c;
      if (parts.length !== 2) { const [s, t] = catalog.resolve(parts); full = s ? `${s}.${t}` : t; }
      const hit = [...groups.keys()].find((g) => g === full || g.split('.').pop() === c);
      return hit || full;
    });
    keys = [...new Set(keys)].sort();
  } else keys = [...groups.keys()].sort();
  const lines = [];
  for (const k of keys) {
    const items = (groups.get(k) || []).map((w) => '{' + Object.entries(w).filter(([kk]) => kk !== 'table').map(([kk, vv]) =>
      kk === 'op' ? `${kk}: ${vv}` : kk === 'sameAsInsert' || kk === 'conflict' ? `${kk}: [` + vv.map(yKey).join(', ') + ']' : `${kk}: ${yVal(vv)}`).join(', ') + '}');
    if (!items.length) { lines.push(`${yName(k)}: []`); continue; }
    lines.push(`${yName(k)}:`);
    for (const s of items.sort(naturalCmp)) lines.push('  - ' + s);
  }
  return lines.length ? lines.join('\n') + '\n' : '{}\n';
}

// ---------------------------------------------------------------- 기록 → 쓰기 목록

function resolve(v, params) {
  if (v instanceof Bind) return params ? params[v.key] : undefined;
  if (v instanceof AnyBind) { const x = params ? params[v.bind.key] : undefined; return Array.isArray(x) ? x : [x]; }
  if (v instanceof Lit) return v.v;
  if (Array.isArray(v)) return v.map((x) => resolve(x, params));
  return v;
}

function renderRaw(raw, catalog, cfg) {
  const out = [];
  const stmts = splitStatements(tokenize(raw.text));
  let idx = -1;
  for (const st of stmts) {
    idx++;
    const tpl = parseStatement(st);
    if (!tpl) continue;
    let tname = null, schema = null, table = null;
    if (tpl.table) { [schema, table] = catalog.resolve(tpl.table); tname = schema ? `${schema}.${table}` : table; }
    const params = raw.values;
    let w;
    if (tpl.op === 'SQL' || tpl.op === 'MERGE') {
      w = { op: tpl.op };
      if (tname) w.table = tname;
      w.sql = tpl.sql;
    } else {
      const fv = (col, v) => (maskedCol(col) && v !== null && v !== undefined && !(v instanceof SqlExpr) ? '***' : fmtValue(v, catalog.colType(schema, table, col)));
      const resolvedMap = (pairs) => {
        const d = {};
        for (const [col, v] of pairs) {
          if (v === DEFAULT) continue;
          const x = resolve(v, params);
          d[col] = Array.isArray(v) || v instanceof AnyBind ? x.map((e) => fv(col, e)) : fv(col, x);
        }
        return d;
      };
      if (tpl.op === 'INSERT' || tpl.op === 'UPSERT' || tpl.op === 'INSERT_IGNORE') {
        let cols = tpl.cols, unknown = false;
        if (!cols) {
          const ti = catalog.table(schema, table);
          if (ti) cols = ti.columns.map((c) => c.name); else unknown = true;
        }
        const rows = tpl.tuples.map((tup) => {
          if (!unknown) return resolvedMap(cols.map((c, k) => [c, tup[k]]).filter(([, v]) => v !== undefined));
          const r = {};
          tup.forEach((v, k) => { if (v === DEFAULT) return; const x = resolve(v, params); r[`?${k + 1}`] = v instanceof Bind ? unknownBind(x, cfg.unknownBinds) : fmtValue(x); });
          return r;
        });
        w = { op: tpl.op, table: tname, rows };
        if (tpl.set && tpl.set.length) w.set = resolvedMap(tpl.set);
        if (tpl.sameAsInsert && tpl.sameAsInsert.length) w.sameAsInsert = tpl.sameAsInsert;
        if (tpl.conflict && tpl.conflict.length) w.conflict = tpl.conflict;
        if (tpl.whereSql) w.whereSql = tpl.whereSql;
      } else {
        w = { op: tpl.op, table: tname };
        if (tpl.set && tpl.set.length) w.set = resolvedMap(tpl.set);
        if (tpl.where && tpl.where.length) w.where = resolvedMap(tpl.where);
        if (tpl.whereSql) w.whereSql = tpl.whereSql;
      }
    }
    const res = raw.results ? raw.results[idx] : undefined;
    if (raw.error) w.result = { error: raw.error.code, message: cleanMessage(raw.error.message) };
    else if (res && res.rowCount != null) w.result = { rows: res.rowCount };
    if (raw.rolledBack) w.rolledBack = true;
    out.push(w);
  }
  return out;
}

const wild = (p) => new RegExp('^' + p.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

class Filter {
  constructor(cfg) { this.tables = cfg.excludeTables.map(wild); this.upd = cfg.updatesOnly; }
  tableExcluded(tname) {
    if (!tname) return false;
    const t = tname.toLowerCase(), bare = t.split('.').pop();
    return this.tables.some((rx) => rx.test(t) || rx.test(bare));
  }
  updatesOnly(w) {
    if (w.op !== 'UPDATE' || !w.set || !Object.keys(w.set).length) return -1;
    const t = (w.table || '').toLowerCase();
    return this.upd.findIndex((u) => {
      const ut = u.table.toLowerCase();
      return (ut === t || ut === t.split('.').pop()) && Object.keys(w.set).every((c) => u.columns.includes(c));
    });
  }
}

// ---------------------------------------------------------------- 시험 이름

const safe = (s) => String(s).replace(/[[\]]/g, '_').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || '_';
const SPEC_RE = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]{1,9})[-_]([A-Z][A-Z0-9]{1,9})[-_](\d{1,4})(?:[-_](\d{1,3}))?(?![A-Za-z0-9])/g;
function findSpecs(...texts) {
  const out = [];
  for (const t of texts) for (const m of String(t || '').matchAll(SPEC_RE)) {
    const s = `${m[1]}-${m[2]}-${m[3]}` + (m[4] ? `-${m[4]}` : '');
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function testInfo(args, root) {
  let name = null, file = null;
  const a = args[0];
  if (a && (typeof a === 'object' || typeof a === 'function')) { // vitest 의 문맥은 함수일 수 있다
    if (a.task && typeof a.task === 'object') { // vitest
      const names = [];
      for (let t = a.task; t && t.type !== undefined && t.file !== t; t = t.suite) if (t.name) names.unshift(t.name);
      name = names.join(' > ');
      file = (a.task.file && (a.task.file.filepath || a.task.file.name)) || null;
    } else if (typeof a.name === 'string' && ('diagnostic' in a || 'plan' in a || 'signal' in a)) { // node:test
      name = a.fullName || a.name;
      file = a.filePath || null;
    }
  }
  const ex = globalThis.expect;
  if ((!name || !file) && ex && typeof ex.getState === 'function') { // jest · vitest
    const s = ex.getState();
    name = name || s.currentTestName;
    file = file || s.testPath;
  }
  if (!file) file = process.argv[1] || 'unknown';
  if (file.startsWith('file://')) file = new URL(file).pathname;
  const group = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
  name = name || 'test';
  return { id: `${group}#${name}`, group, name, specs: findSpecs(name) };
}

// ---------------------------------------------------------------- 기록기

let IS_MAIN_THREAD = true;
try { IS_MAIN_THREAD = require('worker_threads').isMainThread; } catch { /* 없음 */ }

function runKey() {
  if (process.env.WRITE_REPORT_RUN) return process.env.WRITE_REPORT_RUN;
  if (!IS_MAIN_THREAD) return `p${process.pid}`; // vitest threads: 같은 프로세스
  const child = /^child/.test(process.env.NODE_TEST_CONTEXT || '') || !!process.env.VITEST_POOL_ID
    || (!!process.env.JEST_WORKER_ID && typeof process.send === 'function');
  return child ? `p${process.ppid}` : `p${process.pid}`;
}

class Recorder {
  constructor(cfg) {
    this.cfg = cfg;
    this.state = null; // null | 'body' | 'closing'
    this.cur = null;
    this.tests = [];
    this.catalog = new Catalog();
    this.catalogTried = false;
    this.watched = new Set();
    this.filter = new Filter(cfg);
    this.excluded = cfg.updatesOnly.map(() => 0);
    this.instance = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    this.run = runKey();
    this.timer = null;
  }

  begin(info) {
    if (this.state === 'body') {
      throw new Error(`쓰기 보고서: 시험 구간이 겹칩니다 (${this.cur.id} 실행 중에 ${info.id} 시작). 직렬로 실행하세요 (test.concurrent · concurrency 옵션 끄기).`);
    }
    if (this.state === 'closing') this.finalize();
    this.cur = { ...info, started: localIso(new Date()), raw: [], status: 'passed', touched: false };
    this.state = 'body';
  }

  async endBody(failed) {
    if (this.state !== 'body') return;
    const t = this.cur;
    t.status = failed ? 'failed' : 'passed';
    this.state = 'closing'; // 여기부터 새 쓰기는 기록하지 않는다
    await this.refreshCatalog(t);
    if (this.cur === t) this.maybeFinalize();
  }

  /**
   * 시험이 쓴 테이블 중 카탈로그에 없는 것이 있으면 그 풀 · 연결 설정으로 새 연결을 열어 읽는다.
   * 쓴 연결은 오류(22003 등) 뒤 트랜잭션이 중단돼 읽을 수 없으므로 쓰지 않는다.
   */
  async refreshCatalog(t) {
    try {
      let unknown = false;
      const sources = [];
      for (const raw of t.raw) {
        const c = raw.client;
        const src = c && (c[POOL] ? c[POOL].options : c.connectionParameters);
        if (src && !sources.includes(src)) sources.push(src);
        if (unknown) continue;
        try {
          for (const st of splitStatements(tokenize(raw.text))) {
            const tpl = parseStatement(st);
            if (tpl && tpl.table) { const [sc, tb] = this.catalog.resolve(tpl.table); if (!this.catalog.table(sc, tb)) unknown = true; }
          }
        } catch { /* 무시 */ }
      }
      if (!unknown) return;
      const { Client } = require('pg');
      for (const src of sources) {
        const c = new Client({ ...src, password: src.password, connectionTimeoutMillis: 5000 }); // pg 는 password 를 열거되지 않게 숨긴다
        try {
          await c.connect();
          const r = await this.origQuery.call(c, PG_CATALOG_SQL);
          const s = await this.origQuery.call(c, 'SELECT current_schema() AS s');
          for (const [sc, ts] of Object.entries(buildCatalog(r.rows))) Object.assign((this.catalog.data[sc] ||= {}), ts); // 테이블 단위로 합친다
          if (!this.catalog.schema) this.catalog.schema = s.rows[0] && s.rows[0].s;
        } catch { /* 다음 설정으로 */ } finally {
          await c.end().catch(() => {});
        }
      }
    } catch { /* 카탈로그 없이 계속 */ }
  }

  /** 시험의 트랜잭션이 모두 끝났으면 원본을 쓴다. */
  maybeFinalize() {
    if (this.state === 'closing' && !this.cur.raw.some((r) => r.pendingTx || (!r.results && !r.error))) this.finalize();
  }

  finalize() {
    const t = this.cur;
    if (!t) return;
    this.cur = null;
    this.state = null;
    for (const raw of t.raw) {
      if (raw.pendingTx) { const p = raw.pendingTx.pending; const i = p.indexOf(raw); if (i >= 0) p.splice(i, 1); raw.pendingTx = null; }
    }
    const writes = this.render(t, true);
    const file = `${t.group.split('/').map(safe).join('/')}/${safe(t.name)}.yaml`;
    if (!writes.length && !t.touched) {
      fs.rmSync(path.join(this.cfg.output, file), { force: true }); // 다시 돌았는데 이제 쓰지 않는 시험
      return;
    }
    const rec = { id: t.id, group: t.group, name: t.name, file,
      specs: t.specs, status: t.status, started: t.started, writes };
    const p = path.join(this.cfg.output, rec.file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, testYaml(rec));
    this.tests.push(rec);
    this.writePart();
    this.scheduleIndex();
  }

  render(t, count = false) {
    const writes = [];
    for (const raw of t.raw) {
      for (const w of renderRaw(raw, this.catalog, this.cfg)) {
        if (this.filter.tableExcluded(w.table)) continue;
        const i = this.filter.updatesOnly(w);
        if (i >= 0) { if (count) this.excluded[i]++; continue; }
        writes.push(w);
      }
    }
    return writes.map((w, n) => {
      const d = { seq: n + 1, ...w };
      return Object.fromEntries(KEY_ORDER.filter((k) => k in d).map((k) => [k, d[k]]));
    });
  }

  /** 남은 시험을 마무리하고 색인을 쓴다 (시험 묶음 끝 · 프로세스 종료). */
  flush() {
    try {
      if (this.state) this.finalize();
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.writePart();
      this.writeIndex();
    } catch { /* 무시 */ }
  }

  wants(client) {
    if (this.state !== 'body') return false;
    if (!this.watched.size) return true;
    return this.watched.has(client) || this.watched.has(client[POOL]);
  }

  // 색인: 프로세스(모듈 인스턴스)마다 조각을 쓰고, 조각을 모아 index.json 을 만든다
  partsDir() { return path.join(this.cfg.output, '.parts', this.run); }
  writePart() {
    try {
      fs.mkdirSync(this.partsDir(), { recursive: true });
      const data = { tests: this.tests.map((t) => ({ ...t, writes: t.writes.map(packWrite) })), catalog: this.catalog.data, excluded: this.excluded };
      const f = path.join(this.partsDir(), `${this.instance}.json`);
      fs.writeFileSync(f + '.tmp', JSON.stringify(data));
      fs.renameSync(f + '.tmp', f);
    } catch { /* 보고서 실패로 시험을 깨지 않는다 */ }
  }
  scheduleIndex() {
    if (!IS_MAIN_THREAD) { this.writeIndex(); return; } // vitest threads: 워커가 이벤트 없이 끝나므로 바로 쓴다
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.writeIndex(); }, 300);
  }
  /** 기존 index.json 과 합친다: 이번 실행 시험이 덮고, 원본 yaml 이 없어진 시험은 뺀다. catalog 는 테이블 단위로. */
  writeIndex() {
    try {
      const out = this.cfg.output;
      const partsRoot = path.join(out, '.parts');
      const merged = new Map(), catalog = {};
      const addCatalog = (c) => { for (const [s, ts] of Object.entries(c || {})) Object.assign((catalog[s] ||= {}), ts); };
      const idxPath = path.join(out, 'index.json');
      if (fs.existsSync(idxPath)) {
        try {
          const old = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
          for (const t of old.tests || []) merged.set(t.id, t);
          addCatalog(old.catalog);
        } catch { /* 깨진 색인은 새로 */ }
      }
      let excluded = this.cfg.updatesOnly.map(() => 0);
      const readParts = (dir, mine) => {
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
          let d;
          try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
          for (const t of d.tests) merged.set(t.id, { id: t.id, group: t.group, name: t.name, file: t.file, specs: t.specs, status: t.status, writes: t.writes });
          addCatalog(d.catalog);
          if (mine) excluded = excluded.map((a, i) => a + (d.excluded[i] || 0));
        }
      };
      // 다른 실행이 남긴 조각은 먼저 합치고 지운다 (이번 실행이 덮는다)
      if (fs.existsSync(partsRoot)) {
        for (const other of fs.readdirSync(partsRoot)) {
          if (other === this.run) continue;
          try { readParts(path.join(partsRoot, other), false); } catch { /* 무시 */ }
          fs.rmSync(path.join(partsRoot, other), { recursive: true, force: true });
        }
      }
      if (fs.existsSync(this.partsDir())) readParts(this.partsDir(), true);
      const idx = {
        format: 1, generatedAt: localIso(new Date(), false), repo: path.basename(this.cfg.root), stack: STACK,
        tests: [...merged.values()].filter((t) => fs.existsSync(path.join(out, t.file))),
        catalog,
        excluded: { tables: this.cfg.excludeTables, updatesOnly: this.cfg.updatesOnly.map((u, i) => ({ table: u.table, columns: u.columns, count: excluded[i] })) },
      };
      fs.mkdirSync(out, { recursive: true });
      const tmp = path.join(out, `index.json.${this.instance}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(idx, null, 1) + '\n');
      fs.renameSync(tmp, idxPath);
      if (fs.existsSync(this.cfg.viewer)) {
        const html = fs.readFileSync(this.cfg.viewer, 'utf8');
        const data = JSON.stringify(idx).replace(/<\//g, '<\\/');
        const tmpH = path.join(out, `index.html.${this.instance}.tmp`);
        fs.writeFileSync(tmpH, html.replace('/*__WRITE_REPORT_DATA__*/null', () => data));
        fs.renameSync(tmpH, path.join(out, 'index.html'));
      }
    } catch { /* 보고서 실패로 시험을 깨지 않는다 */ }
  }
}

// 색인용 JSON (index.json 의 writes 모양)
const packWrite = (w) => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, jVal(v)]));

// ---------------------------------------------------------------- pg 연결

function txOf(client) {
  return (client[TX] ||= { inTx: false, aborted: false, pending: [], sps: [] });
}

const TX_HEAD = /^(begin|start|commit|end|rollback|abort|savepoint|release|prepare)$/;

/** 트랜잭션 제어문 처리. 쓰기면 'write', 아니면 null. */
function txStatement(client, st, pendingCommit) {
  const t = txOf(client);
  const h = st[0] && st[0].kind === 'id' ? st[0].val : '';
  if (!TX_HEAD.test(h)) return null;
  if (h === 'prepare' && !is(st[1], 'transaction')) return null; // PREPARE 문장 준비는 트랜잭션이 아니다
  if (h === 'start' && !is(st[1], 'transaction')) return null;
  if (h === 'begin' || h === 'start') { t.inTx = true; t.aborted = false; t.pending = []; t.sps = []; return 'tx'; }
  if (h === 'savepoint') { t.sps.push([st[1] ? st[1].val : null, t.pending.length]); return 'tx'; }
  if (h === 'release') {
    const name = is(st[1], 'savepoint') ? st[2] && st[2].val : st[1] && st[1].val;
    const k = findSp(t, name);
    if (k >= 0) t.sps.splice(k);
    return 'tx';
  }
  if ((h === 'rollback' || h === 'abort') && st.some((x) => is(x, 'to'))) {
    const name = st[st.length - 1].val;
    const k = findSp(t, name);
    if (k >= 0) {
      const pos = t.sps[k][1];
      for (const raw of t.pending.splice(pos)) { raw.rolledBack = true; raw.pendingTx = null; }
      t.sps.splice(k + 1);
    }
    t.aborted = false;
    return 'tx';
  }
  if (h === 'rollback' || h === 'abort') { settle(t, true); return 'tx'; }
  if (h === 'commit' || h === 'end' || h === 'prepare') {
    const snap = t.pending;
    const aborted = t.aborted;
    t.pending = []; t.sps = []; t.inTx = false; t.aborted = false;
    pendingCommit.push({ snap, aborted, prepare: h === 'prepare' });
    return 'tx';
  }
  return null;
}

function findSp(t, name) {
  for (let k = t.sps.length - 1; k >= 0; k--) if (t.sps[k][0] === name) return k;
  return -1;
}

function settle(t, rolled, list) {
  const items = list || t.pending;
  for (const raw of items) { if (rolled) raw.rolledBack = true; raw.pendingTx = null; }
  if (!list) { t.pending = []; t.sps = []; t.inTx = false; t.aborted = false; }
  afterSettle();
}

function afterSettle() {
  const g = globalThis[G];
  if (g && g.active) g.active.maybeFinalize();
}

const WRITE_HEAD = /^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(insert|update|delete|merge|with|truncate|copy|call|begin|start|commit|end|rollback|abort|savepoint|release|prepare)\b/i;

function onQuery(client, text, values) {
  // 반환: 결과 · 오류를 받을 함수 (없으면 null)
  if (typeof text !== 'string' || !WRITE_HEAD.test(text)) return null;
  const g = globalThis[G];
  const rec = g && g.active;
  const stmts = splitStatements(tokenize(text));
  const pendingCommit = [];
  let isWrite = false;
  for (const st of stmts) {
    if (txStatement(client, st, pendingCommit)) continue;
    if (parseHeadWrite(st)) isWrite = true;
  }
  let raw = null, wait = null;
  if (isWrite && rec && rec.wants(client)) {
    if (!rec.catalogTried) rec.catalogWait = loadCatalog(rec, client);
    wait = rec.catalogWait; // 카탈로그를 읽는 동안 첫 쓰기는 기다린다
    raw = { text, values: Array.isArray(values) ? values : undefined, results: null, error: null, rolledBack: false, pendingTx: null, client };
    rec.cur.raw.push(raw);
    const t = txOf(client);
    if (t.inTx) { t.pending.push(raw); raw.pendingTx = t; }
  }
  if (!raw && !pendingCommit.length) return isWrite ? onlyAbort(client) : null;
  const hook = (err, res) => {
    if (raw) {
      if (err) raw.error = { code: err.code || err.name || 'ERROR', message: err.message };
      else raw.results = Array.isArray(res) ? res : [res];
    }
    if (err && txOf(client).inTx) txOf(client).aborted = true;
    for (const c of pendingCommit) {
      // 실패한 트랜잭션의 COMMIT 은 PostgreSQL 이 ROLLBACK 으로 끝낸다 (응답 command 도 ROLLBACK)
      const cmd = res && !Array.isArray(res) ? res.command : null;
      const rolled = !!err || cmd === 'ROLLBACK' || (cmd == null && c.aborted);
      if (c.prepare) settle(null, false, c.snap); else settle(null, rolled, c.snap);
    }
    if (raw) afterSettle();
  };
  hook.wait = wait;
  return hook;
}

function onlyAbort(client) {
  return (err) => { if (err && txOf(client).inTx) txOf(client).aborted = true; };
}

function parseHeadWrite(st) {
  const h = st[0] && st[0].kind === 'id' ? st[0].val : '';
  if (['insert', 'update', 'delete', 'merge', 'truncate', 'call'].includes(h)) return true;
  if (h === 'with') return findTop(st, (t) => is(t, 'insert', 'update', 'delete', 'merge')) >= 0;
  if (h === 'copy') return findTop(st, (t) => is(t, 'from')) > 0;
  return false;
}

/** 처음 쓰는 연결에서 카탈로그를 한 번 읽는다 (종료 때 조회하지 않는다). 쓰기보다 먼저 끝낸다. */
function loadCatalog(rec, client) {
  rec.catalogTried = true;
  const q = (sql) => rec.origQuery.call(client, sql);
  const inTx = txOf(client).inTx; // 트랜잭션 안이면 savepoint 로 감싸 카탈로그 실패가 시험을 깨지 않게
  return (async () => {
    try {
      if (inTx) await q('SAVEPOINT write_report_catalog');
      try {
        const r = await q(PG_CATALOG_SQL);
        const s = await q('SELECT current_schema() AS s');
        rec.catalog = new Catalog(buildCatalog(r.rows), s.rows[0] && s.rows[0].s);
      } finally {
        if (inTx) {
          await q('ROLLBACK TO SAVEPOINT write_report_catalog').catch(() => {});
          await q('RELEASE SAVEPOINT write_report_catalog').catch(() => {});
        }
      }
    } catch { /* 카탈로그 없이 계속 */ }
    rec.catalogWait = null;
  })();
}

function install(rec) {
  let pg;
  try { pg = require('pg'); } catch { throw new Error('쓰기 보고서: pg 모듈을 찾지 못했습니다 (npm i pg).'); }
  const Client = pg.Client;
  const proto = Client.prototype;
  if (!proto[Symbol.for('writeReport.patched')]) {
    const orig = proto.query;
    proto[Symbol.for('writeReport.orig')] = orig;
    proto[Symbol.for('writeReport.patched')] = true;
    proto.query = function writeReportQuery(config, values, callback) {
      let text, vals, cbIndex = -1;
      const args = Array.prototype.slice.call(arguments);
      if (typeof config === 'string') text = config;
      else if (config && typeof config === 'object') { text = config.text; vals = config.values; }
      if (Array.isArray(values)) vals = values;
      for (let i = args.length - 1; i >= 1; i--) if (typeof args[i] === 'function') { cbIndex = i; break; }
      let hook = null;
      try { hook = onQuery(this, text, vals); } catch { hook = null; }
      if (!hook) return orig.apply(this, args);
      const self = this;
      const wait = hook.wait;
      const send = () => orig.apply(self, args);
      if (cbIndex >= 0) {
        const cb = args[cbIndex];
        args[cbIndex] = function (err, res) { try { hook(err, res); } catch { /* 무시 */ } return cb.apply(this, arguments); };
        if (wait) { wait.then(send); return undefined; }
        return send();
      }
      if (config && typeof config === 'object' && typeof config.submit === 'function') {
        if (typeof config.once === 'function') {
          config.once('end', (res) => { try { hook(null, res); } catch { /* 무시 */ } });
          config.once('error', (err) => { try { hook(err); } catch { /* 무시 */ } });
        }
        if (wait) { wait.then(send); return config; }
        return send();
      }
      const observe = (ret) => {
        if (ret && typeof ret.then === 'function') ret.then((res) => { try { hook(null, res); } catch { /* 무시 */ } }, (err) => { try { hook(err); } catch { /* 무시 */ } });
        return ret;
      };
      return wait ? wait.then(() => observe(send())) : observe(send());
    };
    const origEnd = proto.end;
    proto.end = function writeReportEnd() {
      // 트랜잭션 안에서 연결을 닫으면 서버가 롤백한다
      const t = this[TX];
      if (t && t.inTx) settle(t, true);
      return origEnd.apply(this, arguments);
    };
  }
  rec.origQuery = proto[Symbol.for('writeReport.orig')];
}

// ---------------------------------------------------------------- 공개 API

let REC = null;

function recorder() {
  const g = (globalThis[G] ||= { active: null });
  if (!REC) {
    const cfg = loadConfig(findRoot());
    const rec = new Recorder(cfg);
    install(rec);
    REC = rec;
    process.on('exit', () => rec.flush());
    // vitest 는 포크 워커를 SIGTERM 으로 끝낸다 ('exit' 없음). 색인을 쓰고 기본 종료를 다시 일으킨다.
    const onTerm = () => {
      rec.flush();
      process.removeListener('SIGTERM', onTerm);
      if (process.listenerCount('SIGTERM') === 0) process.kill(process.pid, 'SIGTERM');
    };
    process.on('SIGTERM', onTerm);
  }
  g.active = REC;
  return REC;
}

/**
 * 시험 함수를 감싸 그 본문이 쓴 것을 기록한다. 준비(beforeEach) 쓰기는 들어가지 않는다.
 *   test('이름', recordWrites(async (t) => { ... }))
 * done 콜백 형식 시험은 지원하지 않는다 (async 로 쓴다).
 */
function recordWrites(fn) {
  return async function writeReportTest(...args) {
    const rec = recorder();
    rec.begin(testInfo(args, rec.cfg.root));
    let failed = true;
    try {
      const r = await fn.apply(this, args);
      failed = false;
      return r;
    } finally {
      await rec.endBody(failed);
    }
  };
}

/** 이 Pool · Client 에서 온 쓰기만 기록한다 (부르지 않으면 모든 연결). */
function watch(poolOrClient) {
  const rec = recorder();
  rec.watched.add(poolOrClient);
  if (poolOrClient && typeof poolOrClient.on === 'function' && Array.isArray(poolOrClient._clients)) {
    for (const c of poolOrClient._clients) c[POOL] = poolOrClient;
    poolOrClient.on('connect', (c) => { c[POOL] = poolOrClient; });
  }
  return poolOrClient;
}

/** 지금 시험이 쓴 것을 승인본과 비교한다. 테이블을 고르면 그 테이블만. */
function assertWrites(name, ...tables) {
  const rec = recorder();
  if (!rec.cur) throw new Error('쓰기 보고서: recordWrites(...) 로 감싼 시험 안에서 부르세요.');
  rec.cur.touched = true;
  const writes = rec.render(rec.cur);
  const text = approvedYaml(writes, tables, rec.catalog, rec.cfg);
  const cfg = rec.cfg;
  const rel = path.join(...rec.cur.group.split('/').map(safe), safe(name) + '.yaml');
  const ap = path.join(cfg.approved, rel);
  const rp = path.join(cfg.output, 'received', rel);
  if (process.env[APPROVE_ENV] === '1') {
    fs.mkdirSync(path.dirname(ap), { recursive: true });
    fs.writeFileSync(ap, text);
    fs.rmSync(rp, { force: true });
    return;
  }
  const old = fs.existsSync(ap) ? fs.readFileSync(ap, 'utf8') : null;
  if (old === text) { fs.rmSync(rp, { force: true }); return; }
  fs.mkdirSync(path.dirname(rp), { recursive: true });
  fs.writeFileSync(rp, text);
  const r = (p) => path.relative(cfg.root, p).split(path.sep).join('/');
  const head = old === null ? `쓰기 보고서: 승인본이 없습니다: ${r(ap)}` : `쓰기 보고서: 승인본과 다릅니다: ${r(ap)}`;
  const diff = old === null ? text.split('\n').slice(0, 40) : lineDiff(old, text).slice(0, 40);
  throw new AssertionError({ message: `${head}\n받은 값: ${r(rp)}\n승인: ${APPROVE_ENV}=1 로 시험 실행\n${diff.join('\n')}` });
}

/** 줄 단위 차이 (LCS). */
function lineDiff(a, b) {
  const x = a.replace(/\n$/, '').split('\n'), y = b.replace(/\n$/, '').split('\n');
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = ['--- approved', '+++ received'];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { out.push('  ' + x[i]); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) out.push('+ ' + y[j++]);
    else out.push('- ' + x[i++]);
  }
  return out;
}

// jest · vitest(globals) 는 모듈을 시험 파일마다 따로 읽고 process 'exit' 를 못 받을 수 있다.
// 시험 파일 맨 위에서 불러오면 그 파일 끝(afterAll)에 색인을 쓴다.
if (typeof globalThis.afterAll === 'function') {
  try { globalThis.afterAll(() => { if (REC) REC.flush(); }); } catch { /* 시험 안에서 불러온 경우 */ }
}

module.exports = {
  recordWrites,
  assertWrites,
  watch,
  // 시험 · 다른 도구용
  _internal: { tokenize, parseStatement, render, renderRaw, approvedYaml, normalize, loadConfig, Catalog, testYaml },
};
