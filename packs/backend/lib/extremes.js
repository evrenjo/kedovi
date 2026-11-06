/**
 * 실데이터 극값 (kedovi extremes): 운영 DB 집계 CSV → 칸 길이 · 여유 검사 · 극값 fixture.
 * 집계 CSV 칸: table_name, column_name, column_type, row_count, null_count, max_len, max_bytes, min_value, max_value
 * (원문 없음: 글자 칸은 길이만, 숫자 칸은 최솟값 · 최댓값만). 타입 해석은 쓰기 보고서와 같은 함수(core lib/writes.js parseType).
 */
'use strict';
const W = require('../../core/lib/writes');

const COLS = ['table_name', 'column_name', 'column_type', 'row_count', 'null_count', 'max_len', 'max_bytes', 'min_value', 'max_value'];

/** CSV · TSV 한 줄 나누기 (따옴표 · "" 이스케이프) */
function splitLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"' && cur === '') q = true;
    else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** 집계 파일 읽기: [{ table, column, type, rows, nulls, maxLen, maxBytes, min, max }]. 머리 줄이 여러 번 나와도 된다 (psql \gexec) */
function parseStats(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const head = splitLine(lines[0], sep).map((h) => h.trim().toLowerCase());
  const missing = COLS.filter((c) => !head.includes(c));
  if (missing.length) throw new Error(`집계 파일 머리 줄에 칸이 없습니다: ${missing.join(', ')} (필요한 칸 ${COLS.join(', ')})`);
  const num = (v) => (v === '' || v == null || /^null$/i.test(v) ? null : Number(v));
  const out = [];
  for (const [i, l] of lines.entries()) {
    const cells = splitLine(l, sep);
    if (i > 0 && cells[0].trim().toLowerCase() === 'table_name') continue;
    if (i === 0) continue;
    const g = (c) => (cells[head.indexOf(c)] || '').trim();
    out.push({
      table: g('table_name'), column: g('column_name'), type: g('column_type'),
      rows: num(g('row_count')), nulls: num(g('null_count')), maxLen: num(g('max_len')), maxBytes: num(g('max_bytes')),
      min: g('min_value') === '' || /^null$/i.test(g('min_value')) ? null : g('min_value'),
      max: g('max_value') === '' || /^null$/i.test(g('max_value')) ? null : g('max_value'),
      line: i + 1,
    });
  }
  return out;
}

const intDigits = (v) => String(v).replace(/^-/, '').split('.')[0].replace(/^0+/, '').length;
const fracDigits = (v) => (String(v).split('.')[1] || '').replace(/0+$/, '').length;
const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * 칸 여유 검사. opts { warnRatio: 0.9, target(table, column) → { type, nullable, from } | null }
 * target 이 있으면 그 정의(예: 데이터 설계 · 새 스키마)와 비교하고, 없으면 DB 의 지금 타입과 비교한다.
 * 반환 { items: [{ table, column, type, from, level: '✖'|'⚠', why }], checked, skipped }
 */
function check(stats, opts = {}) {
  const warn = Number(opts.warnRatio || 0.9);
  const items = [];
  let checked = 0;
  let skipped = 0;
  for (const s of stats) {
    const t = opts.target ? opts.target(s.table, s.column) : null;
    const type = t && t.type ? t.type : s.type;
    const from = t && t.type ? t.from : 'DB';
    const ty = W.parseType(type);
    const add = (level, why) => items.push({ table: s.table, column: s.column, type, from, level, why });
    if (t && t.nullable === false && s.nulls > 0) add('✖', `null ${s.nulls}건인데 정의는 NOT NULL`);
    if (!ty) { skipped++; continue; }
    checked++;
    if (ty.kind === 'str') {
      if (!Number.isFinite(ty.n) || s.maxLen == null) continue;
      if (s.maxLen > ty.n) add('✖', `최대 길이 ${s.maxLen} > ${ty.n}`);
      else if (s.maxLen === ty.n) add('⚠', `최대 길이 ${s.maxLen} = 한도 (여유 0)`);
      else if (s.maxLen / ty.n >= warn) add('⚠', `최대 길이 ${s.maxLen} / ${ty.n} (${pct(s.maxLen / ty.n)}, 여유 ${ty.n - s.maxLen}자)`);
      if (/\bbyte\b/i.test(type) && s.maxBytes != null && s.maxBytes > ty.n) add('✖', `최대 바이트 ${s.maxBytes} > ${ty.n} byte`);
      continue;
    }
    const vals = [s.min, s.max].filter((v) => v != null && /^-?\d+(\.\d+)?$/.test(String(v)));
    if (!vals.length) continue;
    const big = vals.reduce((a, b) => (Math.abs(Number(b)) > Math.abs(Number(a)) ? b : a));
    if (ty.kind === 'int') {
      const r = Math.abs(Number(big)) / ty.max;
      if (r > 1) add('✖', `값 ${big} > ${ty.max}`);
      else if (r >= warn) add('⚠', `값 ${big} / 최댓값 ${ty.max} (${pct(r)})`);
      continue;
    }
    if (ty.kind === 'num' && Number.isFinite(ty.p)) {
      const room = ty.p - ty.s;
      const d = intDigits(big);
      if (d > room) add('✖', `정수 ${d}자리 > ${room}자리 (${big})`);
      else {
        const r = Math.abs(Number(big)) / 10 ** room;
        if (r >= warn) add('⚠', `값 ${big} / 한도 ${10 ** room} 미만 (${pct(r)})`);
      }
      const f = Math.max(...vals.map(fracDigits));
      if (f > ty.s) add('⚠', `소수 ${f}자리 > ${ty.s}자리 (반올림)`);
    }
  }
  return { items, checked, skipped };
}

/** 합성 글자: 글자 수 len, 바이트 수가 bytes 에 가깝게 (3바이트 글자 섞기). 원문과 무관 */
function synthText(len, bytes) {
  if (!len) return '';
  const wide = bytes && bytes > len ? Math.min(len, Math.round((bytes - len) / 2)) : 0;
  return '가'.repeat(wide) + 'x'.repeat(len - wide);
}

/**
 * 극값 fixture: 표마다 max · min · nulls 행. 글자는 합성(길이 · 바이트만 맞춤), 숫자는 집계한 최댓값 · 최솟값.
 * 반환 { tables: { 표: [{ _case, 칸: 값 }] } }
 */
function fixture(stats, opts = {}) {
  const only = opts.tables && opts.tables.length ? new Set(opts.tables) : null;
  const byTable = new Map();
  for (const s of stats) {
    if (only && !only.has(s.table)) continue;
    if (!byTable.has(s.table)) byTable.set(s.table, []);
    byTable.get(s.table).push(s);
  }
  const tables = {};
  for (const [t, cols] of byTable) {
    const isText = (s) => s.maxLen != null;
    const numOf = (v) => (v == null ? null : /^-?\d+$/.test(v) && Math.abs(Number(v)) <= Number.MAX_SAFE_INTEGER ? Number(v) : v);
    const max = { _case: 'max' };
    const min = { _case: 'min' };
    const nulls = { _case: 'nulls' };
    for (const s of cols) {
      if (isText(s)) { max[s.column] = synthText(s.maxLen, s.maxBytes); min[s.column] = s.maxLen ? 'x' : ''; } else if (s.max != null || s.min != null) { max[s.column] = numOf(s.max); min[s.column] = numOf(s.min); } else { max[s.column] = null; min[s.column] = null; }
      nulls[s.column] = s.nulls > 0 ? null : max[s.column];
    }
    tables[t] = cols.some((s) => s.nulls > 0) ? [max, min, nulls] : [max, min];
  }
  return { note: '운영 DB 집계로 만든 합성 극값 (글자는 길이 · 바이트만 맞춘 합성, 숫자는 집계 최댓값 · 최솟값). 키 · 제약 칸은 시험에서 맞춘다', tables };
}

module.exports = { COLS, parseStats, splitLine, check, fixture, synthText };
