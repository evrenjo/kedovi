#!/usr/bin/env node
// 작업 리더 진행판: 리더가 단계를 적고 메인 · 사용자가 표로 본다 (리더 · 그 팀원은 서브에이전트라 tmux 창이 없다). 실행: kedovi team step · kedovi team board
/*
 * 명령
 *   step --unit <단위> --stage <단계> [--left "남은 단계,…"] [--done "끝난 것"] [--next "다음"] [--eta HH:MM]   리더가 단계마다 · vars.team.leadReportMinutes 분마다
 *   step --unit <단위> --end 완료|막힘|결정 필요 [--done …]                              최종 보고 때 닫는다
 *   board [--all] [--json]                                                                 단위마다 단계 · 끝난 것 · 다음 · 예상 종료 · 갱신 (닫힌 지 2시간 넘은 것은 --all 때만)
 * 저절로 닫힘: 리더가 끝난 뒤 10분 넘게 소식 없음 · 보고 주기 4배(최소 2시간) 넘게 소식 없음. 그 뒤 같은 단위에 step 하면 이어서 연다
 * 예상 종료 = 실측: 지금 단계의 남은 몫 + 남은 단계(--left)마다 실측 시간(단계 종류별 최근 기록 · 무거운 시험 기록)의 범위(25~75%). 지난 예상과 실제의 비율(중앙값)로 고친다.
 *   단계 종류: 계획 · 구현 · 검증 · 빌드 · E2E · 리뷰 · 머지 · 배포 (단계 이름에서 알아봄). 기록이 없는 단계만 리더의 --eta 를 쓴다
 * 실측 기록 = .agents/status/_stats.json (단계가 바뀔 때 앞 단계 시간 · 끝날 때 예상과 실제 비율)
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

/**
 * 저절로 닫을 단위인가: 리더가 끝났는데(SubagentStop 이 stoppedAt 을 적음) 그 뒤 10분 넘게 소식이 없거나,
 * 보고 주기의 4배(최소 2시간) 넘게 소식이 없다. 리더가 --end 없이 끝나도 진행판에 「소식 없음」 으로 계속 남지 않게
 */
function staleEnd(u, mins, now = Date.now()) {
  if (u.endedAt) return null;
  if (u.stoppedAt && u.stoppedAt >= u.updatedAt && now - u.stoppedAt > 10 * 60000) return '리더 끝남 (최종 보고 없음)';
  if (now - u.updatedAt > Math.max(120, 4 * (mins || 15)) * 60000) return '멈춤 (소식 없음)';
  return null;
}

// ── 실측 예상 ──
const STATS = path.join(DIR, '_stats.json');
const KEEP = 20;
/** 단계 이름 → 종류 (실측을 모으는 열쇠). 모르는 이름은 그 이름 그대로 */
function stageKind(name) {
  const s = String(name || '').toLowerCase();
  if (/e2e|통합\s*시험|playwright|cypress/.test(s)) return 'E2E';
  if (/build|빌드|컴파일/.test(s)) return '빌드';
  if (/리뷰|검토|review/.test(s)) return '리뷰';
  if (/verify|검증|시험|테스트|test|ci\b|파이프라인/.test(s)) return '검증';
  if (/구현|수정|개발|고치|고침|implement|fix|코딩/.test(s)) return '구현';
  if (/계획|분석|조사|설계|파악|plan/.test(s)) return '계획';
  if (/배포|deploy|릴리스|release|publish/.test(s)) return '배포';
  if (/머지|merge|\bmr\b|push|마무리|정리/.test(s)) return '머지';
  return s.replace(/\s*\d+\s*차$/, '').trim() || '기타';
}
const readStats = () => { try { return JSON.parse(fs.readFileSync(STATS, 'utf8')); } catch { return { stages: {}, ratios: [] }; } };
function saveStats(st) { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(STATS, JSON.stringify(st, null, 2)); } catch { /* 기록은 부가 */ } }
/** 단계 시간 하나를 기록 (30초 ~ 12시간만) */
function addStage(st, kind, ms) {
  if (!(ms >= 30000 && ms <= 12 * 3600000)) return;
  st.stages = st.stages || {};
  st.stages[kind] = [...(st.stages[kind] || []), ms].slice(-KEEP);
}
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)))];
/** 종류의 실측: { lo, mid, hi, n } (단계 기록 + 그 종류로 읽히는 무거운 시험 기록). 없으면 null */
function measured(kind, st = readStats()) {
  let xs = [...((st.stages || {})[kind] || [])];
  try {
    const h = JSON.parse(fs.readFileSync(path.join(ROOT, '.agents', 'heavy', 'history.json'), 'utf8'));
    for (const [name, list] of Object.entries(h)) if (stageKind(name) === kind) xs.push(...list.filter((x) => x.ok).map((x) => x.ms));
  } catch { /* 무거운 시험 기록 없음 */ }
  xs = xs.filter((x) => x > 0).sort((a, b) => a - b);
  if (!xs.length) return null;
  return { lo: q(xs, 0.25), mid: q(xs, 0.5), hi: q(xs, 0.75), n: xs.length };
}
/** 지난 예상 대비 실제 비율 (기록 3개 이상일 때, 0.5~2 로 묶음). 없으면 1 */
function factor(st = readStats()) {
  const r = (st.ratios || []).filter((x) => x > 0).sort((a, b) => a - b);
  return r.length >= 3 ? Math.min(2, Math.max(0.5, q(r, 0.5))) : 1;
}
const leftOf = (u) => String(u.left || '').split(/[,，·>→]+/).map((x) => x.trim()).filter(Boolean);
/**
 * 실측 예상 종료: { lo, mid, hi (시각 ms), unknown: [기록 없는 단계], factor }. 실측이 하나도 없으면 null.
 * 지금 단계 = 실측 - 이 단계에서 지난 시간 (이미 넘었으면 0), 남은 단계 = 실측 범위의 합
 */
function estimate(u, now = Date.now(), st = readStats()) {
  if (u.endedAt) return null;
  const parts = [];
  const unknown = [];
  const cur = measured(stageKind(u.stage), st);
  const spent = now - (u.stageAt || u.updatedAt || now);
  if (cur) parts.push({ lo: Math.max(0, cur.lo - spent), mid: Math.max(0, cur.mid - spent), hi: Math.max(0, cur.hi - spent) });
  else if (u.stage) unknown.push(u.stage);
  for (const name of leftOf(u)) {
    const m = measured(stageKind(name), st);
    if (m) parts.push(m); else unknown.push(name);
  }
  if (!parts.length) return null;
  const f = factor(st);
  const sum = (k) => parts.reduce((a, x) => a + x[k], 0) * f;
  return { lo: now + sum('lo'), mid: now + sum('mid'), hi: now + sum('hi'), unknown, factor: f };
}
/** 예상 종료 글 (실측 범위 · 기록 없는 단계 · 리더 값) */
function etaText(u, now = Date.now()) {
  if (u.endedAt) return '';
  const e = estimate(u, now);
  if (!e) return u.eta ? `${u.eta} (리더)` : '';
  const range = clock(e.lo) === clock(e.hi) ? clock(e.mid) : `${clock(e.lo)}~${clock(e.hi)}`;
  return `${range} (실측${e.unknown.length ? `, 기록 없음: ${e.unknown.join(' · ')}${u.eta ? ` · 리더 ${u.eta}` : ''}` : ''})`;
}

/** 진행판 항목 (닫힌 지 2시간 넘은 것은 all 일 때만). 저절로 닫을 단위는 닫아 기록한다 */
function units({ all = false } = {}) {
  let names = [];
  try { names = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')); } catch { return []; }
  const out = [];
  const mins = reportMinutes();
  const now = Date.now();
  for (const f of names) {
    try {
      const file = path.join(DIR, f);
      const u = JSON.parse(fs.readFileSync(file, 'utf8'));
      const why = staleEnd(u, mins, now);
      if (why) {
        Object.assign(u, { end: why, endedAt: now, auto: true });
        try { fs.writeFileSync(file, JSON.stringify(u, null, 2)); } catch { /* 읽기 전용 */ }
      }
      if (!all && u.endedAt && now - u.endedAt > 2 * 3600000) continue;
      out.push(u);
    } catch { /* 깨진 기록 */ }
  }
  return out.sort((a, b) => (!!a.endedAt - !!b.endedAt) || b.updatedAt - a.updatedAt);
}

/** 리더(agent)가 끝났다고 적는다 (lead-progress.js 의 SubagentStop). 그 리더가 적은 열린 단위만 */
function markStopped(unitNames, now = Date.now()) {
  for (const name of unitNames || []) {
    const f = path.join(DIR, `${slug(name)}.json`);
    try {
      const u = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (u.endedAt) continue;
      u.stoppedAt = now;
      fs.writeFileSync(f, JSON.stringify(u, null, 2));
    } catch { /* 없음 */ }
  }
}

/** 한 줄 요약 (훅 · 보고용) */
function line(u, mins = reportMinutes()) {
  const stale = !u.endedAt && mins && Date.now() - u.updatedAt > 2 * mins * 60000;
  const eta = u.endedAt ? '' : etaText(u);
  return `${u.unit} · ${u.endedAt ? `끝(${u.end})` : u.stage}${u.done ? ` · 끝난 것: ${u.done}` : ''}${!u.endedAt && u.next ? ` · 다음: ${u.next}` : ''}${eta ? ` · 예상 종료 ${eta}` : ''} · ${ago(u.updatedAt)}${stale ? ' ⚠ 소식 없음' : ''}`;
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
  if (u.endedAt && stage && u.auto) { delete u.end; delete u.endedAt; delete u.auto; delete u.stoppedAt; } // 저절로 닫힌 단위는 이어서
  else if (u.endedAt && stage) u = {}; // 닫힌 단위를 다시 열면 새로
  const now = Date.now();
  u = { unit, startedAt: u.startedAt || now, history: u.history || [], ...u, updatedAt: now };
  const st = readStats();
  // 단계가 바뀌거나 끝나면 앞 단계의 실제 시간을 기록한다 (다음 예상의 실측)
  if (u.stage && u.stageAt && ((stage && stageKind(stage) !== stageKind(u.stage)) || end)) addStage(st, stageKind(u.stage), now - u.stageAt);
  if (stage && (!u.stage || stageKind(stage) !== stageKind(u.stage) || !u.stageAt)) u.stageAt = now;
  if (stage) u.stage = stage;
  for (const k of ['done', 'next', 'left']) if (opt(k) !== undefined) u[k] = opt(k);
  if (eta) u.eta = eta;
  if (end) {
    u.end = end; u.endedAt = now;
    // 처음 실측 예상과 실제의 비율을 남긴다 (완료일 때만. 다음 예상을 고친다)
    if (/완료/.test(end) && u.pred0 && u.pred0.mid - u.pred0.at > 60000) st.ratios = [...(st.ratios || []), (now - u.pred0.at) / (u.pred0.mid - u.pred0.at)].slice(-KEEP);
  } else {
    const e = estimate(u, now, st);
    if (e) { u.pred = { at: now, lo: e.lo, mid: e.mid, hi: e.hi }; if (!u.pred0 && leftOf(u).length) u.pred0 = u.pred; }
  }
  saveStats(st);
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
    console.log(`| ${cell(u.unit)} | ${cell(u.endedAt ? `끝: ${u.end}` : u.stage)} | ${cell(u.done)} | ${cell(u.endedAt ? '' : u.next)} | ${cell(u.endedAt ? clock(u.endedAt) : etaText(u))} | ${ago(u.updatedAt)}${stale ? ' ⚠' : ''} |`);
  }
  const st = readStats();
  const kinds = Object.keys(st.stages || {});
  if (kinds.length) console.log(`\n실측 (단계 종류별 중앙값): ${kinds.map((k) => { const m = measured(k, st); return m ? `${k} ${Math.round(m.mid / 60000)}분(${m.n}회)` : ''; }).filter(Boolean).join(' · ')}${factor(st) !== 1 ? ` · 지난 예상 보정 ×${factor(st).toFixed(2)}` : ''}`);
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

module.exports = { units, line, reportMinutes, staleEnd, markStopped, slug, stageKind, measured, estimate, etaText, factor, readStats };
