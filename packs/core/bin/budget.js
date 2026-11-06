#!/usr/bin/env node
// 시간 예산 — 작업을 시작할 때 예상 시간을 적고, 끝나면 닫는다. 실행: node packs/core/bin/budget.js <start|extend|done|status|report> … (kedovi budget 도 같다)
/*
 *   start "<작업>" <시간>    예: start "주문 탭" 30m (30 · 30분 · 1h · 1.5시간). 같은 이름이 있으면 새로 시작
 *   extend "<작업>" <시간>   사용자가 더 하기로 했을 때: 예산을 그만큼 늘리고 알림을 다시 켠다
 *   done ["<작업>"]          끝냄 (이름이 없으면 전부). 예산 대비 걸린 시간을 출력한다
 *   status                  지금 예산과 경과
 *   report [--month YYYY-MM] [--json]   월간 집계 (끝낸 작업 수 · 예산 대비 걸린 시간 · 예산 초과율 · 중앙값). 기본: 이번 달
 * 이력: .agents/history/budget.jsonl (start · extend · done 한 줄씩, 이 PC 전용). 운영 결함의 잠복 · 해소 시간은 defects.js report
 * 경과가 예산의 1.5배를 넘으면 hooks/budget-check.js 가 요청 시작 때 알리고, 멈출 때 한 번 막아 계속할지 사용자에게 묻게 한다.
 */
'use strict';
const { root } = require('../lib/workspace');
const B = require('../lib/budget');

const [cmd, name, amount] = process.argv.slice(2);
const ROOT = root();
const list = B.load(ROOT);
const fail = (m) => { console.error(`✖ ${m}`); process.exit(1); };

if (cmd === 'start' || cmd === 'extend') {
  const min = B.parseMinutes(amount);
  if (!name || !min) fail(`사용법: node packs/core/bin/budget.js ${cmd} "<작업>" <시간>  (예: 30m · 1h)`);
  const i = list.findIndex((b) => b.name === name);
  if (cmd === 'extend') {
    if (i < 0) fail(`예산이 없는 작업입니다: ${name} (지금: ${list.map((b) => b.name).join(', ') || '없음'})`);
    list[i] = { ...list[i], minutes: list[i].minutes + min, warned: false };
    B.save(ROOT, list);
    B.record(ROOT, { event: 'extend', name, minutes: list[i].minutes, add: min, start: list[i].start });
    console.log(`✔ 예산 늘림: ${B.line(list[i])}`);
  } else {
    const b = { name, minutes: min, start: Date.now(), warned: false };
    if (i >= 0) list[i] = b; else list.push(b);
    B.save(ROOT, list);
    B.record(ROOT, { event: 'start', name, minutes: min, start: b.start });
    console.log(`✔ 예산 시작: ${name} ${min}분. ${Math.round(min * B.OVER)}분을 넘으면 계속할지 묻게 알립니다. 끝나면: node packs/core/bin/budget.js done "${name}"`);
  }
} else if (cmd === 'done') {
  const hit = name ? list.filter((b) => b.name === name) : list;
  if (!hit.length) fail(name ? `예산이 없는 작업입니다: ${name}` : '열린 예산이 없습니다');
  B.save(ROOT, list.filter((b) => !hit.includes(b)));
  for (const b of hit) B.record(ROOT, { event: 'done', name: b.name, minutes: b.minutes, start: b.start, elapsed: B.elapsed(b) });
  for (const b of hit) console.log(`✔ 끝: ${B.line(b)}${B.elapsed(b) > b.minutes ? ` (${B.elapsed(b) - b.minutes}분 넘음)` : ''}`);
} else if (cmd === 'status' || !cmd) {
  if (!list.length) console.log('열린 예산 없음');
  for (const b of list) console.log(`${B.over(b) ? '⏰' : '⏱'} ${B.line(b)}`);
} else if (cmd === 'report') {
  const i = process.argv.indexOf('--month');
  const month = i > 0 ? process.argv[i + 1] : B.monthOf(Date.now());
  if (!/^\d{4}-\d{2}$/.test(String(month))) fail('사용법: node packs/core/bin/budget.js report [--month YYYY-MM] [--json]');
  const r = B.report(B.readLog(ROOT), month);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
  console.log(`시간 예산 ${month}: 끝낸 작업 ${r.done}건 · 예산 초과 ${r.over}건 (${pct(r.overRate)}) · 1.5배 넘김 ${r.over15}건`);
  console.log(`  걸린 시간 중앙값 ${r.medianElapsed == null ? '-' : `${Math.round(r.medianElapsed)}분`} · 예산 중앙값 ${r.medianBudget == null ? '-' : `${Math.round(r.medianBudget)}분`} · 예산 대비 중앙값 ${pct(r.medianRatio)} · 합계 ${r.elapsedSum}분 / 예산 ${r.budgetSum}분`);
  if (r.unclosed) console.log(`  ⚠ done 없이 하루가 지난 예산 ${r.unclosed}건 (집계에서 빠짐). 끝낼 때 done 을 부른다`);
  if (!r.done) console.log(`  이력: ${B.logFile(ROOT)} (이 PC 전용)`);
} else fail('사용법: node packs/core/bin/budget.js start|extend "<작업>" <시간> · done ["<작업>"] · status · report [--month YYYY-MM]');
