#!/usr/bin/env node
// 운영 결함 기록 검사 · 월간 집계. 실행: node packs/core/bin/defects.js <check|report> … (kedovi defects 가 이 도구를 부른다)
/*
 *   check [--id <id>]          작업별 기록 중 운영 결함(머리 「종류:」 가 vars.defects.kinds)의 빈 칸 · 잘못된 분류를 알린다 (있으면 exit 1). 기본: 모든 사람의 기록
 *   report [--month YYYY-MM]   그 달(발견 시각 기준) 결함 수 · 분류별 잠복 · 해소 시간 중앙값 (기본: 이번 달). --json 이면 JSON
 * 결함 기록 형식은 ticket 스킬. 잠복 = 원인 커밋(또는 발생:) 시각부터 발견까지, 해소 시간 = 발견부터 해소까지.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { load } = require('../lib/workspace');
const D = require('../lib/defects');

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const ws = load();
const ROOT = ws.root;
const cfg = D.settings(ws);
const usage = () => { console.error('사용: node packs/core/bin/defects.js check [--id <id>] · report [--month YYYY-MM] [--json]'); process.exit(3); };

/** handoffs/<id>/topics/*.md (archive 포함) 중 결함 기록 */
function records(only) {
  const out = [];
  const h = path.join(ROOT, 'handoffs');
  let ids = [];
  try { ids = fs.readdirSync(h, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { /* 없음 */ }
  for (const id of ids.filter((x) => !only || x === only)) {
    for (const sub of ['topics', path.join('archive', 'topics')]) {
      const dir = path.join(h, id, sub);
      let names = [];
      try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'INDEX.md'); } catch { continue; }
      for (const n of names) {
        const file = path.join(dir, n);
        let text = '';
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const defect = D.parseDefect(text, cfg);
        if (defect) out.push({ file: path.relative(ROOT, file), defect });
      }
    }
  }
  return out;
}

if (cmd === 'check') {
  const rs = records(opt('id'));
  let n = 0;
  for (const r of rs) for (const p of D.problems(r.defect, cfg)) { console.log(`✖ ${r.file}: ${p}`); n++; }
  if (n) { console.log(`✖ 결함 기록 ${n}건을 고친다 (형식: ticket 스킬 「결함 기록」)`); process.exit(1); }
  console.log(`✔ 결함 기록 ${rs.length}건: 발견 · 분류 · 해소 칸 이상 없음`);
} else if (cmd === 'report') {
  const month = opt('month') || D.monthOf(Date.now());
  if (!/^\d{4}-\d{2}$/.test(month)) usage();
  const dirs = [ROOT, ...((ws.repos || []).map((r) => r.dir).filter((d) => d && fs.existsSync(d)))];
  const r = D.report(records(), month, { dirs });
  if (argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`운영 결함 ${month}: ${r.count}건 (해소 안 됨 ${r.open}) · 잠복 중앙값 ${D.span(r.latency)} (${r.latencyN}건) · 해소 시간 중앙값 ${D.span(r.resolve)} (${r.resolveN}건)`);
  if (r.byCategory.length) {
    console.log('| 분류 | 건수 | 잠복 중앙값 | 해소 시간 중앙값 | 해소 시간 합 |');
    console.log('|---|---|---|---|---|');
    for (const c of r.byCategory) console.log(`| ${c.category} | ${c.count} | ${D.span(c.latency)} | ${D.span(c.resolve)} | ${D.span(c.resolveSum || null)} |`);
  }
  if (r.missing) console.log(`⚠ 발견 시각이 없어 뺀 기록 ${r.missing}건: node packs/core/bin/defects.js check`);
} else usage();
