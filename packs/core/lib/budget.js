// 시간 예산 — 작업마다 예상 시간을 적어 두고 경과를 본다. bin/budget.js(선언) 와 hooks/budget-check.js(알림)가 같이 쓴다. 의존성 없음
// 기록: 상태 폴더의 budget.json [{ name, minutes, start, warned }]. 이 PC · 이 워크스페이스만. 끝낸 것 · 하루 지난 것은 지운다
// 이력: .agents/history/budget.jsonl 에 start · extend · done 을 한 줄씩 (이 PC 전용, gitignore). report 가 월간 집계를 낸다
'use strict';
const fs = require('fs');
const path = require('path');
const { stateDir } = require('./workspace');

const OVER = 1.5; // 예산의 이 배를 넘으면 알린다
const file = (root) => path.join(stateDir(root), 'budget.json');

function load(root) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(file(root), 'utf8')); } catch { /* 없음 */ }
  const day = Date.now() - 86400000;
  return (Array.isArray(list) ? list : []).filter((b) => b && b.name && b.minutes > 0 && b.start > day);
}
const save = (root, list) => fs.writeFileSync(file(root), JSON.stringify(list, null, 2));

/** "30" · "30m" · "30분" · "1h" · "1.5h" · "1시간" → 분. 못 읽으면 null */
function parseMinutes(s) {
  const m = String(s || '').trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|분|h|시간)?$/i);
  if (!m) return null;
  const n = Number(m[1]) * (/^(h|시간)$/i.test(m[2] || '') ? 60 : 1);
  return n > 0 ? Math.round(n) : null;
}

const elapsed = (b, now = Date.now()) => Math.floor((now - b.start) / 60000);
const over = (b, now = Date.now()) => elapsed(b, now) > b.minutes * OVER;
const line = (b, now = Date.now()) => `${b.name} 예산 ${b.minutes}분 · 경과 ${elapsed(b, now)}분`;

// ───────── 이력 · 월간 집계 ─────────
const logFile = (root) => path.join(root, '.agents', 'history', 'budget.jsonl');

/** 이력 한 줄 { at, event: start|extend|done, name, minutes, start, elapsed? }. 실패해도 명령은 계속한다 */
function record(root, entry) {
  try {
    fs.mkdirSync(path.dirname(logFile(root)), { recursive: true });
    fs.appendFileSync(logFile(root), JSON.stringify({ at: Date.now(), ...entry }) + '\n');
  } catch { /* 기록 못 함: 집계에서 빠질 뿐 */ }
}

function readLog(root) {
  let t = '';
  try { t = fs.readFileSync(logFile(root), 'utf8'); } catch { return []; }
  return t.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x && x.event && x.name);
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const monthOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/**
 * 월간 집계 (끝낸 시각 기준). 반환 { month, done, over, overRate, over15, medianElapsed, medianBudget, medianRatio, budgetSum, elapsedSum, unclosed, rows }
 * over = 예산을 넘긴 작업 수, over15 = 1.5배(알림 기준)를 넘긴 수. unclosed = 그 달에 시작해 done 없이 하루가 지난 것 (예산 목록에서 사라짐)
 */
function report(entries, month, now = Date.now()) {
  const rows = entries.filter((e) => e.event === 'done' && monthOf(e.at) === month).map((e) => {
    const el = e.elapsed != null ? e.elapsed : Math.floor((e.at - e.start) / 60000);
    return { name: e.name, minutes: e.minutes, elapsed: el, ratio: e.minutes > 0 ? el / e.minutes : null };
  });
  const closed = new Set(entries.filter((e) => e.event === 'done').map((e) => `${e.name}\u0000${e.start}`));
  const unclosed = entries.filter((e) => e.event === 'start' && monthOf(e.at) === month && now - e.start > 86400000 && !closed.has(`${e.name}\u0000${e.start}`)).length;
  const over = rows.filter((r) => r.elapsed > r.minutes).length;
  return {
    month, done: rows.length, over, overRate: rows.length ? over / rows.length : null, over15: rows.filter((r) => r.elapsed > r.minutes * OVER).length,
    medianElapsed: median(rows.map((r) => r.elapsed)), medianBudget: median(rows.map((r) => r.minutes)), medianRatio: median(rows.map((r) => r.ratio).filter((x) => x != null)),
    budgetSum: rows.reduce((a, r) => a + r.minutes, 0), elapsedSum: rows.reduce((a, r) => a + r.elapsed, 0), unclosed, rows,
  };
}

module.exports = { OVER, load, save, parseMinutes, elapsed, over, line, logFile, record, readLog, report, monthOf };
