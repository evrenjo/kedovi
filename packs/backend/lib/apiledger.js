/**
 * 외부 API 동작 장부 (api-ledger.yaml): 형식 검사 · 미확인 목록 · 오래된 확인일 · 시나리오 · 실패 주입 세트 · 시험 대조.
 * 형식 정본 packs/backend/assets/api-ledger/FORMAT.md. Node 기본 모듈만 쓴다.
 */
'use strict';
const Y = require('./yaml-lite');

const STATUS = ['measured', 'unverified'];
/** 실패 주입 세트의 표준 종류 (장부 behavior 의 kind 가 같으면 그 최악 응답을 재료로 쓴다) */
const FAULT_KINDS = ['rate-limit', 'slow', 'empty', 'transient-404', 'body-stall', 'token-slow'];
const KINDS = [...FAULT_KINDS, 'order', 'shape', 'other'];
const RESPONSE_KEYS = ['status', 'headers', 'body', 'delayMs', 'stallBodyMs', 'reset', 'failTimes'];
const DAY = 86400000;

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function dateOf(s) {
  if (!DATE_RE.test(String(s || ''))) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

function load(text) { return Y.parse(text); }

/** 응답 모양 검사: 문제 글 목록 */
function responseProblems(r, where) {
  const out = [];
  if (!isObj(r)) return [`${where} 는 맵이어야 합니다`];
  for (const k of Object.keys(r)) if (!RESPONSE_KEYS.includes(k)) out.push(`${where}.${k}: 모르는 칸 (쓸 수 있는 칸 ${RESPONSE_KEYS.join(' · ')})`);
  if (r.status != null && !(Number.isInteger(r.status) && r.status >= 100 && r.status <= 599)) out.push(`${where}.status: 100~599 정수여야 합니다`);
  for (const k of ['delayMs', 'stallBodyMs']) if (r[k] != null && !(typeof r[k] === 'number' && r[k] >= 0)) out.push(`${where}.${k}: 0 이상 숫자여야 합니다`);
  if (r.failTimes != null && !(Number.isInteger(r.failTimes) && r.failTimes >= 1)) out.push(`${where}.failTimes: 1 이상 정수여야 합니다`);
  if (r.headers != null && !isObj(r.headers)) out.push(`${where}.headers: 맵이어야 합니다`);
  if (r.reset != null && typeof r.reset !== 'boolean') out.push(`${where}.reset: true · false`);
  return out;
}

/** 장부 펼치기: [{ key, api, endpoint, ep, behavior }] (형식이 틀려도 읽을 수 있는 만큼) */
function endpoints(ledger) {
  const out = [];
  for (const api of (isObj(ledger) && Array.isArray(ledger.apis) ? ledger.apis : [])) {
    if (!isObj(api)) continue;
    for (const ep of Array.isArray(api.endpoints) ? api.endpoints : []) if (isObj(ep)) out.push({ key: `${api.id}/${ep.id}`, api: api.id, endpoint: ep.id, ep });
  }
  return out;
}

/**
 * 검사. opts { today: Date, staleDays: 30 }
 * 반환 { errors: [{ key, msg }], warnings: [{ key, msg }], unverified: [{ key, what, kind }], stale: [{ key, checked, days }], counts }
 */
function check(ledger, opts = {}) {
  const today = opts.today || new Date();
  const staleDays = Number(opts.staleDays || (isObj(ledger) && ledger.staleDays) || 30);
  const errors = [];
  const warnings = [];
  const unverified = [];
  const stale = [];
  const err = (key, msg) => errors.push({ key, msg });
  const warn = (key, msg) => warnings.push({ key, msg });
  const counts = { apis: 0, endpoints: 0, behaviors: 0, measured: 0, unverified: 0 };
  if (!isObj(ledger)) { err('', '장부가 맵이 아닙니다 (version · apis)'); return { errors, warnings, unverified, stale, counts, staleDays }; }
  if (ledger.version !== 1) err('', 'version: 1 이 있어야 합니다');
  if (!Array.isArray(ledger.apis) || !ledger.apis.length) err('', 'apis 목록이 비었습니다');
  const ageOf = (d) => Math.floor((today.getTime() - d.getTime()) / DAY);
  const apiIds = new Set();
  for (const [ai, api] of (Array.isArray(ledger.apis) ? ledger.apis : []).entries()) {
    if (!isObj(api) || !api.id) { err(`apis[${ai}]`, 'id 가 없습니다'); continue; }
    if (apiIds.has(api.id)) err(api.id, 'API id 가 겹칩니다');
    apiIds.add(api.id);
    counts.apis++;
    if (!Array.isArray(api.endpoints) || !api.endpoints.length) { err(api.id, 'endpoints 목록이 비었습니다'); continue; }
    const epIds = new Set();
    for (const [ei, ep] of api.endpoints.entries()) {
      if (!isObj(ep) || !ep.id) { err(`${api.id}/endpoints[${ei}]`, 'id 가 없습니다'); continue; }
      const key = `${api.id}/${ep.id}`;
      if (epIds.has(ep.id)) err(key, '엔드포인트 id 가 겹칩니다');
      epIds.add(ep.id);
      counts.endpoints++;
      if (!ep.path) err(key, 'path 가 없습니다 (예: /v1/quotes/{symbol}, TR 이면 그 이름)');
      if (ep.method && !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(ep.method)) err(key, `method 가 HTTP 메서드가 아닙니다: ${ep.method}`);
      // 시간: 엔드포인트별 timeout 은 실측 p99 근거로 (공용 기본값 금지)
      if (ep.timeoutMs == null) warn(key, 'timeoutMs 가 없습니다: 공용 기본 timeout 대신 이 엔드포인트 값을 둔다 (실측 p99 근거)');
      else if (!(typeof ep.timeoutMs === 'number' && ep.timeoutMs > 0)) err(key, 'timeoutMs 는 0 보다 큰 숫자');
      if (ep.p99Ms == null) warn(key, 'p99Ms 미측정: timeoutMs 의 근거가 없습니다');
      else if (!(typeof ep.p99Ms === 'number' && ep.p99Ms > 0)) err(key, 'p99Ms 는 0 보다 큰 숫자');
      else {
        if (!ep.p99Evidence) err(key, 'p99Ms 의 근거(p99Evidence: 로그 집계 · 측정 명령)가 없습니다');
        const d = dateOf(ep.p99Checked);
        if (!d) err(key, 'p99Checked 는 YYYY-MM-DD');
        else if (ageOf(d) > staleDays) stale.push({ key: `${key} (p99)`, checked: ep.p99Checked, days: ageOf(d) });
        if (typeof ep.timeoutMs === 'number' && ep.timeoutMs < ep.p99Ms) warn(key, `timeoutMs ${ep.timeoutMs} < p99Ms ${ep.p99Ms}: 정상 응답의 1% 넘게 시간 초과로 끊긴다`);
      }
      if (ep.ok != null) for (const m of responseProblems(ep.ok, 'ok')) err(key, m);
      if (ep.auth != null && ep.auth !== 'token') err(key, 'auth 는 token (토큰 발급 엔드포인트 표시) 만 씁니다');
      const bIds = new Set();
      for (const [bi, b] of (Array.isArray(ep.behaviors) ? ep.behaviors : []).entries()) {
        if (!isObj(b) || !b.id) { err(`${key}/behaviors[${bi}]`, 'id 가 없습니다'); continue; }
        const bk = `${key}/${b.id}`;
        if (bIds.has(b.id)) err(bk, '동작 id 가 겹칩니다');
        bIds.add(b.id);
        counts.behaviors++;
        if (!b.what) err(bk, 'what (무슨 동작인지 한 줄) 이 없습니다');
        if (b.kind != null && !KINDS.includes(b.kind)) err(bk, `kind 는 ${KINDS.join(' · ')} 중 하나`);
        if (!STATUS.includes(b.status)) { err(bk, 'status 는 measured(실측) · unverified(미확인)'); continue; }
        if (b.status === 'measured') {
          counts.measured++;
          const d = dateOf(b.checked);
          if (!d) err(bk, 'measured 는 checked(확인일 YYYY-MM-DD) 가 있어야 합니다');
          else if (d.getTime() > today.getTime() + DAY) err(bk, `checked 가 미래입니다: ${b.checked}`);
          else if (ageOf(d) > staleDays) stale.push({ key: bk, checked: b.checked, days: ageOf(d) });
          if (!b.evidence) err(bk, 'measured 는 evidence(근거: 로그 · 문서 · 실측 명령) 가 있어야 합니다');
          if (b.observed == null) err(bk, 'measured 는 observed(실제로 본 응답) 가 있어야 합니다');
        } else {
          counts.unverified++;
          unverified.push({ key: bk, what: b.what || '', kind: b.kind || '' });
          if (b.worst == null) err(bk, 'unverified 는 worst(최악 응답) 가 있어야 합니다: 시뮬레이터가 그것으로 응답한다');
        }
        for (const f of ['observed', 'worst']) if (b[f] != null) for (const m of responseProblems(b[f], f)) err(bk, m);
      }
    }
  }
  return { errors, warnings, unverified, stale, counts, staleDays };
}

/** 시나리오: 동작마다 스텁이 낼 응답 (measured → observed, unverified → worst). [{ key, endpointKey, behavior, response, status }] */
function scenarios(ledger) {
  const out = [];
  for (const e of endpoints(ledger)) {
    for (const b of Array.isArray(e.ep.behaviors) ? e.ep.behaviors : []) {
      if (!isObj(b) || !b.id) continue;
      const response = b.status === 'measured' ? (b.observed || b.worst) : (b.worst || b.observed);
      out.push({ key: `${e.key}/${b.id}`, endpointKey: e.key, behavior: b.id, status: b.status, kind: b.kind || '', what: b.what || '', response: response || {} });
    }
  }
  return out;
}

/**
 * 실패 주입 세트: 엔드포인트 × 표준 종류. 장부에 같은 kind 의 동작이 있으면 그 worst(없으면 observed)를, 없으면 기본 최악값.
 * token-slow 는 auth: token 엔드포인트에만. [{ key, endpointKey, kind, response, from }]
 */
function faults(ledger) {
  const out = [];
  for (const e of endpoints(ledger)) {
    const t = typeof e.ep.timeoutMs === 'number' ? e.ep.timeoutMs : 5000;
    const okBody = isObj(e.ep.ok) && e.ep.ok.body != null ? e.ep.ok.body : '{}';
    const defaults = {
      'rate-limit': { status: 429 },
      slow: { delayMs: t * 2 },
      empty: { status: 200, body: '' },
      'transient-404': { status: 404, failTimes: 1 },
      'body-stall': { status: 200, body: okBody, stallBodyMs: t * 2 },
      'token-slow': { delayMs: Math.round(t * 0.9) },
    };
    for (const kind of FAULT_KINDS) {
      if (kind === 'token-slow' && e.ep.auth !== 'token') continue;
      const b = (Array.isArray(e.ep.behaviors) ? e.ep.behaviors : []).find((x) => isObj(x) && x.kind === kind);
      const response = b ? (b.worst || b.observed) : defaults[kind];
      out.push({ key: `${e.key}#${kind}`, endpointKey: e.key, kind, response, from: b ? `${e.key}/${b.id}` : '기본값' });
    }
  }
  return out;
}

/** 시험 대조: covered.json { behaviors: [키], faults: [키], at } ↔ 장부. 반환 { missing: [키], missingFaults: [키], unknown: [키] } */
function coverage(ledger, covered) {
  const want = scenarios(ledger).map((s) => s.key);
  const wantF = faults(ledger).map((f) => f.key);
  const have = new Set((covered && covered.behaviors) || []);
  const haveF = new Set((covered && covered.faults) || []);
  return {
    missing: want.filter((k) => !have.has(k)),
    missingFaults: covered && covered.faults ? wantF.filter((k) => !haveF.has(k)) : [],
    unknown: [...have].filter((k) => !want.includes(k)),
  };
}

module.exports = { STATUS, FAULT_KINDS, KINDS, RESPONSE_KEYS, load, check, endpoints, scenarios, faults, coverage, responseProblems, dateOf };
