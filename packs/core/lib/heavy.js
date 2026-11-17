// 무거운 시험 순번: 실제 스택 시험처럼 이 PC 에서 동시에 돌면 안 되는 명령을 줄 세워 하나씩(vars.verify.heavySlots) 돌린다.
// 줄 · 기록은 워크스페이스의 .agents/heavy/ (gitignore). 예상 시간 = 같은 이름의 최근 성공 시간 중앙값. 쓰는 곳: bin/heavy.js · bin/verify.js full
'use strict';
const fs = require('fs');
const path = require('path');

const dirOf = (root) => path.join(root, '.agents', 'heavy');
const QUEUE = 'queue.json';
const HISTORY = 'history.json';
const KEEP = 10; // 이름마다 남기는 최근 시간 수

function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
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
function tryStart(root, id, slots = 1) {
  return withQueue(root, (live) => {
    const running = live.filter((x) => x.startedAt).length;
    const waiting = live.filter((x) => !x.startedAt);
    const me = live.find((x) => x.id === id);
    if (!me) return { started: false, ahead: 0, gone: true };
    if (me.startedAt) return { started: true, ahead: 0 };
    const pos = waiting.indexOf(me);
    if (running < slots && pos < slots - running) { me.startedAt = Date.now(); return { started: true, ahead: 0 }; }
    return { started: false, ahead: running + pos };
  });
}
function leave(root, id) { withQueue(root, (live) => { const i = live.findIndex((x) => x.id === id); if (i >= 0) live.splice(i, 1); }); }

const mins = (ms) => (ms == null ? '?' : ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}초` : `${Math.round(ms / 60000)}분`);
const clock = (t) => { if (t == null) return '모름'; const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 사람이 읽는 줄 (kedovi heavy status · 보고) */
function lines(root, slots = 1) {
  const s = status(root, slots);
  if (!s.length) return ['무거운 시험 줄: 비어 있음'];
  const now = Date.now();
  return [`무거운 시험 줄: ${s.length}개 (동시 ${slots}개)`, ...s.map((x, i) => (x.startedAt
    ? `${i + 1}. ▶ ${x.name}${x.by ? ` (${x.by})` : ''} · 시작 ${clock(x.startedAt)} · ${mins(now - x.startedAt)} 째 · 예상 끝 ${clock(x.endAt)}${x.expectMs ? ` (보통 ${mins(x.expectMs)})` : ' (기록 없음)'}`
    : `${i + 1}. ⏳ ${x.name}${x.by ? ` (${x.by})` : ''} · 기다린 지 ${mins(now - x.queuedAt)} · 예상 시작 ${clock(x.startAt)} · 예상 끝 ${clock(x.endAt)}`))];
}

module.exports = { dirOf, status, enter, tryStart, leave, expected, addHistory, lines, mins, clock, alive };
