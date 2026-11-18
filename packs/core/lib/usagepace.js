// 주간 사용량 속도: Claude Code 상태 줄이 주는 요금제 사용률을 지난 시간과 견줘 단계를 정한다. 쓰는 곳: hooks/usage-status.js · agent-budget.js · usage-pace.js · bin/usage.js
/*
 * 기록 = ~/.cache/kedovi/usage.json (계정 한도는 프로젝트를 넘어 같이 쓴다. KEDOVI_USAGE_FILE 로 바꿈). 비밀값 없음
 * 7일 창 안에서 고르게 쓸 때의 사용률과 실제 사용률의 차이(over)로 판단한다. 요금제마다 값이 달라도 % 라서 Pro · Max · Ultra 가 같은 기준이다.
 * 단계 0 보통 · 1 알림 · 2 줄임(상한 절반) · 3 절약(상한 3분의 1, implementer-deep 밖은 Opus 안 씀). 값이 없거나 낡으면 단계 0 (막지 않는다)
 * 5시간 창: 값이 오면 요금제와 상관없이 본다. vars.usage.fivePct(기본 85) 이상이면 줄임 단계 이상. Ultra 인증 계정은 5시간 제한이 없어 값이 없을 수 있고, 그때는 주간만 본다
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const WEEK = 7 * 86400000;
const DEFAULTS = { warnOver: 10, slowOver: 20, saveOver: 30, minUsed: 15, hardPct: 90, fivePct: 85, maxAgeMin: 120 };
const LEVELS = ['보통', '알림', '줄임', '절약'];

const fileOf = () => process.env.KEDOVI_USAGE_FILE || path.join(os.homedir(), '.cache', 'kedovi', 'usage.json');

function settings(ws) {
  const v = (((ws || {}).vars || {}).usage) || {};
  return Object.fromEntries(Object.entries(DEFAULTS).map(([k, d]) => { const n = Number(v[k]); return [k, v[k] !== undefined && v[k] !== '' && Number.isFinite(n) && n >= 0 ? n : d]; }));
}

const win = (w) => {
  const used = Number((w || {}).used_percentage);
  const resets = Number((w || {}).resets_at);
  return Number.isFinite(used) ? { used, resetsAt: Number.isFinite(resets) && resets > 0 ? resets * 1000 : null } : null;
};

/** 상태 줄 입력의 rate_limits 를 저장한다. 없으면(구독이 아니거나 첫 응답 전) 그대로 둔다 */
function record(rateLimits, now = Date.now()) {
  const week = win((rateLimits || {}).seven_day);
  if (!week) return false;
  const f = fileOf();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ at: now, week, five: win(rateLimits.five_hour) }));
  fs.renameSync(tmp, f);
  return true;
}

/** 지금 상태 { known, why?, used, expected, over, level, label, resetsAt, five, at } */
function state(ws, now = Date.now()) {
  const c = settings(ws);
  let d;
  try { d = JSON.parse(fs.readFileSync(fileOf(), 'utf8')); } catch { return { known: false, why: '기록 없음', level: 0, label: LEVELS[0] }; }
  const w = d.week || {};
  if (!Number.isFinite(w.used) || !w.resetsAt) return { known: false, why: '기록 없음', level: 0, label: LEVELS[0] };
  if (w.resetsAt <= now) return { known: false, why: '주간 창이 새로 시작됨', level: 0, label: LEVELS[0] };
  if (now - d.at > c.maxAgeMin * 60000) return { known: false, why: `기록이 ${c.maxAgeMin}분 넘게 낡음`, level: 0, label: LEVELS[0], at: d.at };
  const expected = Math.max(0, Math.min(100, (1 - (w.resetsAt - now) / WEEK) * 100));
  const over = w.used - expected;
  let level = 0;
  if (w.used >= c.minUsed) {
    if (over >= c.saveOver || (w.used >= c.hardPct && over >= 0)) level = 3;
    else if (over >= c.slowOver) level = 2;
    else if (over >= c.warnOver) level = 1;
  }
  const five = d.five && (!d.five.resetsAt || d.five.resetsAt > now) ? d.five : null; // 지난 5시간 창은 버린다
  const fiveHot = !!five && five.used >= c.fivePct;
  if (fiveHot) level = Math.max(level, 2);
  return { known: true, used: w.used, expected, over, level, label: LEVELS[level], resetsAt: w.resetsAt, five, fiveHot, at: d.at };
}

/** 단계에 맞춘 상한 (2 = 절반 · 3 = 3분의 1, 올림 · 최소 1) */
function limitsFor(limits, level) {
  const f = level >= 3 ? 1 / 3 : level === 2 ? 1 / 2 : 1;
  const out = { ...limits };
  for (const k of ['parallel', 'total', 'leaders', 'members']) if (Number.isInteger(limits[k])) out[k] = Math.max(1, Math.ceil(limits[k] * f));
  return out;
}

const pct = (n) => `${Math.round(n)}%`;
/** 한 줄 설명 */
function line(s) {
  if (!s.known) return `주간 사용량 모름 (${s.why})`;
  const sign = s.over >= 0 ? '+' : '';
  return `주간 ${pct(s.used)} 사용 · 지금 시점 기준 ${pct(s.expected)} (${sign}${Math.round(s.over)}) · ${s.fiveHot ? `5시간 ${pct(s.five.used)} · ` : ''}단계 ${s.label}`;
}

/** 이 역할 호출이 절약 단계에서 Opus 를 쓰게 되나. model = 호출의 값, 없으면 역할 정의의 값 */
function usesTopModel(root, type, model) {
  if (model) return /opus|fable/i.test(String(model));
  if (!type || type === 'general-purpose') return true; // 메인 모델을 물려받는다
  try { const m = /^model:\s*(\S+)/m.exec(fs.readFileSync(path.join(root, '.claude', 'agents', `${type}.md`), 'utf8')); return !!m && /opus|fable/i.test(m[1]); } catch { return false; }
}

module.exports = { WEEK, DEFAULTS, LEVELS, fileOf, settings, record, state, limitsFor, line, usesTopModel };
