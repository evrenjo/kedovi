// 무거운 시험 순번: 실제 스택 시험처럼 이 PC 에서 동시에 돌면 안 되는 명령을 줄 세워 하나씩(vars.verify.heavySlots) 돌린다.
// 줄 · 기록은 워크스페이스의 .agents/heavy/ (gitignore). 예상 시간 = 같은 이름의 최근 성공 시간 중앙값. 쓰는 곳: bin/heavy.js · bin/verify.js full
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const dirOf = (root) => path.join(root, '.agents', 'heavy');
const QUEUE = 'queue.json';
const HISTORY = 'history.json';
const KEEP = 10; // 이름마다 남기는 최근 시간 수
const OVERRIDE = 'settings.json'; // kedovi heavy set 이 쓰는 이 PC 값 (기다리는 작업도 다음 확인 때 읽는다)

function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

/**
 * 설정: kedovi heavy set(.agents/heavy/settings.json) → 환경 변수 → workspace.json vars.verify → 기본. 기다리는 동안 확인마다 다시 읽는다
 *   slots = 동시 개수 (heavySlots · KEDOVI_HEAVY_SLOTS, 기본 1)
 *   maxLoad = 코어 하나당 1분 부하 기준 (heavyMaxLoad · KEDOVI_HEAVY_MAX_LOAD, 기본 0 = 보지 않음). 예 0.8 = 코어 10개면 부하 8 까지
 *   loadWaitMin = 부하 때문에 줄 맨 앞에서 이만큼 기다리면 부하가 높아도 하나는 시작 (heavyLoadWaitMin · KEDOVI_HEAVY_LOAD_WAIT_MIN, 기본 15, 0 = 끝까지 기다림)
 */
function settings(root) {
  let v = {};
  try { v = ((JSON.parse(fs.readFileSync(path.join(root, 'workspace.json'), 'utf8')).vars || {}).verify) || {}; } catch { /* 없음 */ }
  const o = readJson(path.join(dirOf(root), OVERRIDE), {}) || {};
  const pick = (ov, env, ws, ok, d) => { for (const x of [num(ov), num(process.env[env]), num(ws)]) if (x !== null && ok(x)) return x; return d; };
  return {
    slots: pick(o.slots, 'KEDOVI_HEAVY_SLOTS', v.heavySlots, (n) => Number.isInteger(n) && n > 0, 1),
    maxLoad: pick(o.maxLoad, 'KEDOVI_HEAVY_MAX_LOAD', v.heavyMaxLoad, (n) => Number.isFinite(n) && n >= 0, 0),
    loadWaitMin: pick(o.loadWaitMin, 'KEDOVI_HEAVY_LOAD_WAIT_MIN', v.heavyLoadWaitMin, (n) => Number.isFinite(n) && n >= 0, 15),
  };
}

/** 이 PC 값 고치기 (kedovi heavy set). null 이면 그 값을 지운다 */
function setOverride(root, patch) {
  const f = path.join(dirOf(root), OVERRIDE);
  const o = readJson(f, {}) || {};
  for (const [k, x] of Object.entries(patch)) { if (x === null) delete o[k]; else if (x !== undefined) o[k] = x; }
  fs.mkdirSync(dirOf(root), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(o, null, 2));
  return o;
}

/** 지금 부하: { load(1분 평균), cores, perCore }. Windows 는 부하 값이 0 이라 늘 통과 */
function load() {
  const cores = Math.max(1, (os.cpus() || []).length);
  const l = os.loadavg()[0] || 0;
  return { load: l, cores, perCore: l / cores };
}

/** 줄 파일을 잠그고 고친다 (mkdir 잠금, 10초 넘은 잠금은 버린다) */
function withQueue(root, fn) {
  const dir = dirOf(root);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'queue.lock');
  const until = Date.now() + 5000;
  let got = false;
  while (!got && Date.now() < until) {
    try { fs.mkdirSync(lock); got = true; } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmdirSync(lock); } catch { /* 이미 풀림 */ }
      const t = Date.now() + 20; while (Date.now() < t) { /* 잠깐 */ }
    }
  }
  try {
    const f = path.join(dir, QUEUE);
    const q = readJson(f, []);
    const live = (Array.isArray(q) ? q : []).filter((x) => alive(x.pid)); // 죽은 프로세스의 자리는 버린다
    const out = fn(live);
    fs.writeFileSync(f, JSON.stringify(live, null, 2));
    return out;
  } finally { if (got) try { fs.rmdirSync(lock); } catch { /* 없음 */ } }
}

/** 이름의 예상 시간(ms): 최근 성공 시간 중앙값, 기록이 없으면 null */
function expected(root, name) {
  const h = (readJson(path.join(dirOf(root), HISTORY), {})[name] || []).filter((x) => x.ok).map((x) => x.ms).sort((a, b) => a - b);
  return h.length ? h[Math.floor(h.length / 2)] : null;
}

function addHistory(root, name, ms, ok) {
  const f = path.join(dirOf(root), HISTORY);
  const h = readJson(f, {});
  h[name] = [...(h[name] || []), { ms, ok, at: Date.now() }].slice(-KEEP);
  try { fs.mkdirSync(dirOf(root), { recursive: true }); fs.writeFileSync(f, JSON.stringify(h, null, 2)); } catch { /* 기록은 부가 */ }
}

/**
 * 지금 줄: [{ id, name, by, pid, queuedAt, startedAt|null, expectMs, eta(예상 끝 · 시작 ms) }]
 * 도는 것은 시작 + 예상 시간, 기다리는 것은 앞 것들이 끝나는 시각(슬롯 수만큼 나란히)부터
 */
function status(root, slots = 1) {
  const q = withQueue(root, (live) => live.map((x) => ({ ...x })));
  const now = Date.now();
  const free = []; // 슬롯마다 비는 시각
  const out = [];
  for (const x of q.filter((y) => y.startedAt)) {
    const exp = expected(root, x.name);
    const end = exp ? Math.max(now, x.startedAt + exp) : null;
    free.push(end);
    out.push({ ...x, expectMs: exp, endAt: end });
  }
  while (free.length < slots) free.push(now);
  for (const x of q.filter((y) => !y.startedAt)) {
    free.sort((a, b) => (a === null) - (b === null) || a - b);
    const startAt = free[0];
    const exp = expected(root, x.name);
    out.push({ ...x, expectMs: exp, startAt, endAt: startAt !== null && exp ? startAt + exp : null });
    free[0] = startAt !== null && exp ? startAt + exp : null;
  }
  return out;
}

/** 줄 서기 (이미 있으면 그대로). 차례는 tryStart 로 */
function enter(root, { id, name, by, pid }) {
  withQueue(root, (live) => { if (!live.some((x) => x.id === id)) live.push({ id, name, by, pid, queuedAt: Date.now(), startedAt: null }); });
}
/**
 * 차례면 시작 표시. slots 는 숫자 또는 settings() 결과 { slots, maxLoad, loadWaitMin }.
 * 부하 기준(maxLoad > 0)을 넘으면 기다린다. 이미 도는 것이 없고 줄 맨 앞에서 loadWaitMin 분을 기다렸으면 부하가 높아도 시작한다 (다른 앱 부하만으로 끝없이 기다리지 않게)
 * 반환: { started, ahead, gone?, load? (부하 때문에 기다림 · 강제 시작이면 { perCore, maxLoad, forced }) }
 */
function tryStart(root, id, slots = 1, now = Date.now(), cur = null) {
  const cfg = typeof slots === 'object' && slots ? slots : { slots, maxLoad: 0, loadWaitMin: 0 };
  return withQueue(root, (live) => {
    const running = live.filter((x) => x.startedAt).length;
    const waiting = live.filter((x) => !x.startedAt);
    const me = live.find((x) => x.id === id);
    if (!me) return { started: false, ahead: 0, gone: true };
    if (me.startedAt) return { started: true, ahead: 0 };
    const pos = waiting.indexOf(me);
    if (!(running < cfg.slots && pos < cfg.slots - running)) return { started: false, ahead: running + pos };
    if (cfg.maxLoad > 0) {
      const l = cur || load();
      if (l.perCore > cfg.maxLoad) {
        if (!me.loadWaitAt) me.loadWaitAt = now; // 부하 때문에 기다리기 시작한 때
        const forced = running === 0 && pos === 0 && cfg.loadWaitMin > 0 && now - me.loadWaitAt >= cfg.loadWaitMin * 60000;
        if (!forced) return { started: false, ahead: running + pos, load: { perCore: l.perCore, maxLoad: cfg.maxLoad, forced: false } };
        me.startedAt = now;
        return { started: true, ahead: 0, load: { perCore: l.perCore, maxLoad: cfg.maxLoad, forced: true } };
      }
    }
    me.startedAt = now;
    return { started: true, ahead: 0 };
  });
}
function leave(root, id) { withQueue(root, (live) => { const i = live.findIndex((x) => x.id === id); if (i >= 0) live.splice(i, 1); }); }

const mins = (ms) => (ms == null ? '?' : ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}초` : `${Math.round(ms / 60000)}분`);
const clock = (t) => { if (t == null) return '모름'; const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 사람이 읽는 줄 (kedovi heavy status · 보고) */
function loadLine(cfg) {
  const l = load();
  return `부하 ${l.load.toFixed(1)} · 코어 ${l.cores}개 (코어당 ${l.perCore.toFixed(2)}, 기준 ${cfg.maxLoad > 0 ? `${cfg.maxLoad}${cfg.loadWaitMin ? ` · ${cfg.loadWaitMin}분 기다리면 시작` : ''}` : '보지 않음'})`;
}

function lines(root, slots) {
  const cfg = slots === undefined ? settings(root) : typeof slots === 'object' ? slots : { slots, maxLoad: 0, loadWaitMin: 0 };
  const s = status(root, cfg.slots);
  if (!s.length) return [`무거운 시험 줄: 비어 있음 (동시 ${cfg.slots}개 · ${loadLine(cfg)})`];
  const now = Date.now();
  return [`무거운 시험 줄: ${s.length}개 (동시 ${cfg.slots}개 · ${loadLine(cfg)})`, ...s.map((x, i) => (x.startedAt
    ? `${i + 1}. ▶ ${x.name}${x.by ? ` (${x.by})` : ''} · 시작 ${clock(x.startedAt)} · ${mins(now - x.startedAt)} 째 · 예상 끝 ${clock(x.endAt)}${x.expectMs ? ` (보통 ${mins(x.expectMs)})` : ' (기록 없음)'}`
    : `${i + 1}. ⏳ ${x.name}${x.by ? ` (${x.by})` : ''} · 기다린 지 ${mins(now - x.queuedAt)}${x.loadWaitAt ? ` (부하 때문에 ${mins(now - x.loadWaitAt)})` : ''} · 예상 시작 ${clock(x.startAt)} · 예상 끝 ${clock(x.endAt)}`))];
}

module.exports = { dirOf, settings, setOverride, load, status, enter, tryStart, leave, expected, addHistory, lines, mins, clock, alive };
