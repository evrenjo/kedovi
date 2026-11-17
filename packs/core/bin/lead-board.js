#!/usr/bin/env node
// 작업 리더 진행판: 리더가 단계를 적고 메인 · 사용자가 표로 본다 (리더 · 그 팀원은 서브에이전트라 tmux 창이 없다). 실행: kedovi team step · kedovi team board
/*
 * 명령
 *   step --unit <단위> --stage <단계> [--done "끝난 것"] [--next "다음"] [--eta HH:MM]   리더가 단계마다 · vars.team.leadReportMinutes 분마다
 *   step --unit <단위> --end 완료|막힘|결정 필요 [--done …]                              최종 보고 때 닫는다
 *   board [--all] [--json]                                                                 단위마다 단계 · 끝난 것 · 다음 · 예상 종료 · 갱신 (닫힌 지 2시간 넘은 것은 --all 때만)
 * 기록 = 워크스페이스의 .agents/status/<단위>.json (gitignore). 메인의 요청 시작 훅(lead-progress.js)도 이 파일을 읽어 진행 중인 단위를 한 줄씩 넣는다
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DIR = path.join(ROOT, '.agents', 'status');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
const has = (k) => argv.includes(`--${k}`);
const die = (m) => { console.error(`✖ ${m}`); process.exit(2); };

const slug = (s) => String(s).trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unit';
const clock = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 ${m % 60}분 전`; };

function reportMinutes() {
  try { const n = Number((((require('../lib/workspace').load(ROOT).vars || {}).team) || {}).leadReportMinutes); return Number.isFinite(n) && n >= 0 ? n : 15; } catch { return 15; }
}

/** 진행판 항목 (닫힌 지 2시간 넘은 것은 all 일 때만) */
function units({ all = false } = {}) {
  let names = [];
  try { names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of names) {
    try {
      const u = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      if (!all && u.endedAt && Date.now() - u.endedAt > 2 * 3600000) continue;
      if (!all && !u.endedAt && Date.now() - u.updatedAt > 24 * 3600000) continue; // 하루 넘게 소식 없는 것은 버려진 것
      out.push(u);
    } catch { /* 깨진 기록 */ }
  }
  return out.sort((a, b) => (!!a.endedAt - !!b.endedAt) || b.updatedAt - a.updatedAt);
}

/** 한 줄 요약 (훅 · 보고용) */
function line(u, mins = reportMinutes()) {
  const stale = !u.endedAt && mins && Date.now() - u.updatedAt > 2 * mins * 60000;
  return `${u.unit} · ${u.endedAt ? `끝(${u.end})` : u.stage}${u.done ? ` · 끝난 것: ${u.done}` : ''}${!u.endedAt && u.next ? ` · 다음: ${u.next}` : ''}${!u.endedAt && u.eta ? ` · 예상 종료 ${u.eta}` : ''} · ${ago(u.updatedAt)}${stale ? ' ⚠ 소식 없음' : ''}`;
}

function cmdStep() {
  const unit = opt('unit');
  if (!unit) die('--unit <단위 이름> 이 필요합니다');
  const end = opt('end');
  const stage = opt('stage');
  if (!stage && !end) die('--stage <단계> 또는 --end 완료|막힘|결정 필요 가 필요합니다');
  const eta = opt('eta');
  if (eta && !/^\d{1,2}:\d{2}$/.test(eta) && !/^\d{4}-\d{2}-\d{2}/.test(eta)) die('--eta 는 HH:MM (다른 날이면 YYYY-MM-DD HH:MM)');
  fs.mkdirSync(DIR, { recursive: true });
  const f = path.join(DIR, `${slug(unit)}.json`);
  let u = {};
  try { u = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* 처음 */ }
  if (u.endedAt && stage) u = {}; // 닫힌 단위를 다시 열면 새로
  const now = Date.now();
  u = { unit, startedAt: u.startedAt || now, history: u.history || [], ...u, updatedAt: now };
  if (stage) u.stage = stage;
  for (const k of ['done', 'next']) if (opt(k) !== undefined) u[k] = opt(k);
  if (eta) u.eta = eta;
  if (end) { u.end = end; u.endedAt = now; }
  u.history = [...u.history, { at: now, stage: u.stage, done: u.done, next: u.next, eta: u.eta, end: end || undefined }].slice(-50);
  fs.writeFileSync(f, JSON.stringify(u, null, 2));
  console.log(`✔ 진행판: ${line(u)}`);
  console.log('  메인에게도 같은 한 줄을 메시지로 보낸다 (단계 · 끝난 것 · 다음 · 예상 종료)');
  return 0;
}

function cmdBoard() {
  const list = units({ all: has('all') });
  if (has('json')) { console.log(JSON.stringify(list, null, 2)); return 0; }
  if (!list.length) { console.log('작업 리더 진행판: 진행 중인 단위 없음 (리더가 kedovi team step 으로 적는다)'); return 0; }
  const mins = reportMinutes();
  const cell = (s) => String(s == null || s === '' ? '-' : s).replace(/\|/g, '\\|');
  console.log(`작업 리더 진행판 (${clock(Date.now())} · 보고 주기 ${mins}분)\n`);
  console.log('| 단위 | 단계 | 끝난 것 | 다음 | 예상 종료 | 갱신 |');
  console.log('|---|---|---|---|---|---|');
  for (const u of list) {
    const stale = !u.endedAt && mins && Date.now() - u.updatedAt > 2 * mins * 60000;
    console.log(`| ${cell(u.unit)} | ${cell(u.endedAt ? `끝: ${u.end}` : u.stage)} | ${cell(u.done)} | ${cell(u.endedAt ? '' : u.next)} | ${cell(u.endedAt ? clock(u.endedAt) : u.eta)} | ${ago(u.updatedAt)}${stale ? ' ⚠' : ''} |`);
  }
  if (list.some((u) => !u.endedAt && mins && Date.now() - u.updatedAt > 2 * mins * 60000)) console.log(`\n⚠ = 보고 주기의 두 배(${2 * mins}분) 넘게 소식 없음. 리더가 멈췄는지 kedovi agents watch 로 본다`);
  try { const H = require('../lib/heavy'); const h = H.lines(ROOT); if (h.length > 1) console.log(`\n${h.join('\n')}`); } catch { /* 없음 */ }
  return 0;
}

if (require.main === module) {
  const c = argv[0];
  if (c === 'step') process.exit(cmdStep());
  if (c === 'board') process.exit(cmdBoard());
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 9).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  process.exit(c ? 2 : 0);
}

module.exports = { units, line, reportMinutes };
