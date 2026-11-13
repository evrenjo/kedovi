// 실행 흐름 기록 런타임 (브라우저 · Node 공통): instrument.cjs 가 끼워 넣은 호출을 받아 단계(Java · Python 기록기와 같은 형식)로 쌓는다
/*
 * globalThis.__kedoviT = { d, e, l, r, x, f, c, s, w, mark, start, stop, dump }
 *   d(파일, 함수 목록) → 파일 번호 · e(파일, 함수, 인자) → 호출 · l(호출, 줄, 지역 변수) · r(호출, 반환값) · x(호출, 예외)
 *   f(호출) 끝 · c(호출, 예외, 줄) 잡음 · s / w await 앞 · 뒤 (지금 호출 되돌리기)
 *   mark(이름) 사용자 동작 (시나리오 한 단계): 그 뒤 부모 없는 호출(이벤트 핸들러 · 렌더 · 이펙트)이 이 아래에 붙는다
 * 값은 자기 속성의 값(data property)만 읽는다. 게터 · toString · toJSON 을 부르지 않는다 (실행이 바뀌지 않게)
 * 설정: globalThis.__kedoviTraceOpts = { maxSteps, maxHits, maxCalls, net } (없으면 기본값)
 */
(function kedoviTraceRuntime(G) {
  'use strict';
  if (G.__kedoviT && G.__kedoviT.real) return;
  const O = G.__kedoviTraceOpts || {};
  const MAX_STEPS = O.maxSteps || 5000;
  const MAX_HITS = O.maxHits || 30;
  const MAX_CALLS = O.maxCalls || 60; // 같은 함수가 부모 없이 이만큼 넘게 불리면 (다시 그리기 등) 수만 센다
  const PER_ACTION = O.perAction || 3000; // 사용자 동작 하나의 단계 예산: 넘으면 그 동작 안에서만 접고, 다음 동작부터 다시
  const MAX_FN = O.maxFnCalls || 20; // 한 동작 안에서 같은 함수를 이만큼 넘게 부르면 수만 센다
  let fnCount = new Map();
  const MAX_DEPTH = 3;
  const MAX_ITEMS = 20;
  const MAX_FIELDS = 40;
  const MAX_STR = 500;
  const SECRET = /passw|pwd|secret|token|apikey|api_key|credential|authorization|private_?key|cookie|session/i;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const EPOCH = Date.now(); // 시작 시각 (브라우저 · 서버 기록을 시간순으로 잇는다)

  const files = []; // [src, fns]
  const userClasses = new Set(); // 프로젝트 코드에서 선언한 클래스 이름: 이것과 일반 객체만 속까지 읽는다
  const steps = [];
  const dirty = new Set(); // 아직 보내지 않은 단계 번호 (새로 쌓였거나 뒤에 바뀐 것)
  let flushT = null; // 바뀐 단계는 곧바로 보낸다 (같은 순간의 것은 묶어서). 테스트가 끝나 페이지가 닫혀도 덜 잃게
  const soon = () => { if (!flushT && O.collect) { flushT = true; queueMicrotask(() => { flushT = null; T.flush(false); }); } };
  const push = (s) => { steps.push(s); dirty.add(s.i); soon(); return s; };
  const touch = (i) => { if (i >= 0) { dirty.add(i); soon(); } };
  const notes = [];
  const frames = new Map(); // 호출 번호 → 프레임
  const rootCalls = new Map(); // 함수 키 → 부모 없이 불린 수
  let seq = 0;
  let cur = null; // 지금 호출 프레임
  let mark = null; // 지금 사용자 동작 프레임
  let on = O.autoStart !== false;
  let truncated = false;
  let startedAt = 0;

  // ── 값 ──
  function typeName(v) {
    try {
      const p = Object.getPrototypeOf(v);
      const c = p && Object.prototype.hasOwnProperty.call(p, 'constructor') ? p.constructor : null;
      return c && typeof c === 'function' && c.name ? c.name : p === null ? 'Object' : 'Object';
    } catch (e) { return 'Object'; }
  }
  function ser(v, depth, path) {
    depth = depth || 0;
    const t = typeof v;
    if (v === null || v === undefined) return v === undefined ? { t: 'undefined' } : null;
    if (t === 'boolean') return v;
    if (t === 'number') return Number.isFinite(v) ? v : { t: 'number', v: String(v) };
    if (t === 'bigint') return { t: 'bigint', v: String(v) };
    if (t === 'string') return v.length > MAX_STR ? `${v.slice(0, MAX_STR)}…` : v;
    if (t === 'symbol') return { t: 'symbol', v: String(v.description || '') };
    if (t === 'function') return { t: 'function', v: v.name || '(익명)' };
    path = path || [];
    if (path.indexOf(v) >= 0) return { t: typeName(v), cycle: true, ref: 1 };
    try {
      if (v instanceof Date) return { t: 'Date', v: Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString() };
      if (v instanceof RegExp) return { t: 'RegExp', v: String(v.source) };
      if (v instanceof Error) return { t: v.name || 'Error', msg: String(v.message) };
      if (typeof Promise !== 'undefined' && v instanceof Promise) return { t: 'Promise' };
      if (typeof Node !== 'undefined' && v instanceof Node) {
        const el = v;
        return { t: el.constructor && el.constructor.name || 'Node', v: el.nodeType === 1 ? `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}>` : el.nodeName };
      }
      if (typeof Event !== 'undefined' && v instanceof Event) return { t: v.constructor.name, f: { type: v.type, target: ser(v.target, MAX_DEPTH - 1, path) } };
      if (v.$$typeof) return { t: 'ReactElement', v: typeof v.type === 'string' ? `<${v.type}>` : `<${v.type && (v.type.displayName || v.type.name) || '?'}>` };
      if (v.nativeEvent && v.type && 'currentTarget' in v) return { t: 'SyntheticEvent', f: { type: v.type, target: ser(v.target, MAX_DEPTH - 1, path) } };
      if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return { t: typeName(v), n: v.byteLength };
    } catch (e) { /* 다른 창 객체 등 */ }
    if (depth >= MAX_DEPTH) return Array.isArray(v) ? { t: 'Array', n: v.length, ref: 1 } : { t: typeName(v), ref: 1 };
    const p = path.concat([v]);
    if (Array.isArray(v)) {
      const items = [];
      for (let i = 0; i < v.length && i < MAX_ITEMS; i++) items.push(own(v, i, depth, p));
      if (v.length > MAX_ITEMS) items.push(`… ${v.length - MAX_ITEMS}개 더`);
      return { t: 'Array', n: v.length, items };
    }
    if (v instanceof Map) {
      const es = [];
      let i = 0;
      for (const [k, x] of v) { if (i++ >= MAX_ITEMS) break; es.push([ser(k, MAX_DEPTH, p), SECRET.test(String(k)) && x != null ? '***' : ser(x, depth + 1, p)]); }
      return { t: 'Map', n: v.size, entries: es };
    }
    if (v instanceof Set) {
      const items = [];
      let i = 0;
      for (const x of v) { if (i++ >= MAX_ITEMS) break; items.push(ser(x, depth + 1, p)); }
      return { t: 'Set', n: v.size, items };
    }
    let proto = null;
    try { proto = Object.getPrototypeOf(v); } catch (e) { /* 프록시 */ }
    const plain = proto === null || proto === Object.prototype;
    const lib = !plain && !userClasses.has(typeName(v));
    if (lib) depth = Math.max(depth, MAX_DEPTH - 1); // 라이브러리 객체: 공개 필드만, 그 아래는 이름만
    const f = {};
    let n = 0;
    let keys = [];
    try { keys = Object.keys(v); } catch (e) { return { t: typeName(v) }; }
    for (const k of keys) {
      if (n >= MAX_FIELDS) { f['…'] = '필드 더 있음'; break; }
      if (k.startsWith('__react') || k.startsWith('_reactInternals') || lib && k.startsWith('_')) continue;
      f[k] = SECRET.test(k) ? masked(v, k) : own(v, k, depth, p);
      n += 1;
    }
    return { t: typeName(v), f };
  }
  function own(o, k, depth, path) {
    let d;
    try { d = Object.getOwnPropertyDescriptor(o, k); } catch (e) { return { t: '?' }; }
    if (!d) return { t: 'undefined' };
    if (!('value' in d)) return { t: 'getter', note: '게터 (읽지 않음)' };
    return ser(d.value, depth + 1, path);
  }
  function masked(o, k) {
    try { const d = Object.getOwnPropertyDescriptor(o, k); return d && 'value' in d && d.value != null && d.value !== '' ? '***' : ser(d && d.value); } catch (e) { return '***'; }
  }
  const PRIM = (x) => x === null || (typeof x !== 'object' && typeof x !== 'function');
  /** 지역 변수 → { 이름: JSON 문자열 }. 같은 원시 값이면 앞 것을 다시 쓴다 */
  function snap(fr, vars) {
    const out = {};
    const raw = {};
    if (!vars) return out;
    for (const k of Object.keys(vars)) {
      let x;
      try { x = vars[k]; } catch (e) { continue; }
      const prev = fr.raw[k];
      let j;
      if (prev && prev[0] === x && PRIM(x)) j = prev[1];
      else if (SECRET.test(k) && x != null && x !== '') j = '"***"';
      else { try { j = JSON.stringify(ser(x)); } catch (e) { j = JSON.stringify({ t: typeof x, err: String(e && e.message) }); } }
      if (j === undefined) j = 'null';
      out[k] = j;
      raw[k] = [x, j];
    }
    fr.raw = raw;
    return out;
  }
  const parse = (o) => { const r = {}; for (const k of Object.keys(o)) r[k] = JSON.parse(o[k]); return r; };

  // ── 단계 ──
  function full() {
    if (steps.length >= MAX_STEPS) {
      if (!truncated) { truncated = true; notes.push(`단계 상한(${MAX_STEPS})에 닿아 멈춤`); }
      on = false;
      return true;
    }
    if (mark && steps.length - mark.startI >= PER_ACTION) {
      if (!mark.over) { mark.over = true; steps[mark.last].over = true; touch(mark.last); if (notes.length < 20) notes.push(`「${steps[mark.last].m}」 이 단계 예산(${PER_ACTION})을 넘어 그 안의 나머지는 접음`); }
      return true;
    }
    return false;
  }
  const ms = () => Math.round(now() - t0);
  function emitCall(fr, line, vars) {
    const fn = files[fr.file][1][fr.fn];
    const s = { i: steps.length, k: 'line', c: fr.id, d: fr.d, t: ms(), ln: line || fn[2], cls: fn[1], m: fn[0], src: files[fr.file][0], call: true, p: fr.parent ? fr.parent.id : -1, site: fr.parent ? fr.parent.last : -1, args: fr.args };
    if (fn[3] === 1) s.ent = true;
    if (fn[3] === 2) s.mw = true;
    if (fr.ev) { s.ev = true; delete s.src; }
    if (fr.from) s.from = fr.from;
    fr.pending = false;
    fr.last = steps.length;
    fr.vals = vars || {};
    push(s);
    return s;
  }
  function after(fr, vals) {
    if (fr.last < 0) return;
    let ch = null;
    for (const k of Object.keys(vals)) if (fr.vals[k] !== vals[k]) { ch = ch || {}; ch[k] = JSON.parse(vals[k]); }
    if (ch) { const s = steps[fr.last]; s.after = Object.assign(s.after || {}, ch); touch(fr.last); }
  }

  const T = {
    real: true,
    d(src, fns, classes) { files.push([src, fns]); for (const c of classes || []) userClasses.add(c); return files.length - 1; },
    e(file, fn, args) {
      if (!on) return 0;
      let parent = cur || mark;
      // 서버(Next.js 등): 요청마다 문맥이 다르면 앞 요청의 호출 아래에 붙이지 않는다. 화면에서 보낸 요청이면 그 호출을 남긴다
      const rq = O.ctx ? O.ctx() : undefined;
      if (O.ctx && parent && parent.rq !== rq) parent = null;
      const key = `${file}:${fn}`;
      let muted = false;
      if (parent) {
        if (parent.muted || (parent.hits[parent.curLine] || 0) > MAX_HITS) { muted = true; if (!parent.muted && parent.last >= 0) steps[parent.last].skippedCalls = (steps[parent.last].skippedCalls || 0) + 1; touch(parent.last); }
      }
      if (!cur) { const n = (rootCalls.get(key) || 0) + 1; rootCalls.set(key, n); if (n > MAX_CALLS) muted = true; }
      const nf = (fnCount.get(key) || 0) + 1;
      fnCount.set(key, nf);
      if (nf > MAX_FN && !muted) { muted = true; if (parent && !parent.muted && parent.last >= 0) { steps[parent.last].skippedCalls = (steps[parent.last].skippedCalls || 0) + 1; touch(parent.last); } }
      if (mark && mark.over) muted = true;
      seq += 1;
      const fr = { id: seq, file, fn, parent, d: parent ? parent.d + 1 : 1, hits: {}, curLine: 0, last: -1, vals: {}, raw: {}, pending: true, muted, ret: undefined, hasRet: false, err: null, rq };
      if (!parent && rq && rq.from) fr.from = rq.from;
      if (!muted) {
        const a = {};
        try { const o = snap(fr, args); for (const k of Object.keys(o)) a[k] = JSON.parse(o[k]); fr.raw = {}; } catch (e) { /* 값 */ }
        fr.args = a;
      }
      frames.set(fr.id, fr);
      cur = fr;
      return fr.id;
    },
    l(k, line, vars) {
      const fr = frames.get(k);
      if (!fr || fr.muted || !on) return;
      cur = fr;
      if (full()) return;
      fr.curLine = line;
      const h = (fr.hits[line] || 0) + 1;
      fr.hits[line] = h;
      if (fr.pending) { emitCall(fr, line, snap(fr, vars)); return; }
      if (h > MAX_HITS) { if (fr.last >= 0) { steps[fr.last].skipped = (steps[fr.last].skipped || 0) + 1; touch(fr.last); } return; }
      const vals = snap(fr, vars);
      after(fr, vals);
      fr.vals = vals;
      fr.last = steps.length;
      push({ i: steps.length, k: 'line', c: fr.id, d: fr.d, t: ms(), ln: line, cls: files[fr.file][1][fr.fn][1], m: files[fr.file][1][fr.fn][0], src: files[fr.file][0] });
    },
    r(k, v) { const fr = frames.get(k); if (fr) { fr.ret = v; fr.hasRet = true; } return v; },
    x(k, e) {
      const fr = frames.get(k);
      if (!fr) return;
      fr.err = e;
      if (fr.muted || !on || (fr.seenErr && fr.seenErr === e)) return;
      if (T._exSeen && T._exSeen.has(e)) return; // 안쪽 호출이 이미 기록
      try { (T._exSeen = T._exSeen || new WeakSet()).add(e); } catch (x) { /* 원시 값 throw */ }
      if (fr.pending) emitCall(fr, 0, {});
      const fn = files[fr.file][1][fr.fn];
      push({ i: steps.length, k: 'ex', c: fr.id, d: fr.d, t: ms(), ln: fr.curLine || fn[2], site: fr.last, x: { type: e && e.name || typeof e, msg: e && e.message !== undefined ? String(e.message) : String(e), at: `${files[fr.file][0]}:${fr.curLine || fn[2]}`, caught: null } });
      fr.exStep = steps.length - 1;
      T._lastEx = steps[steps.length - 1];
    },
    c(k, e, line) {
      const fr = frames.get(k);
      if (!fr || !on) return;
      for (let i = steps.length - 1; i >= 0 && i >= steps.length - 400; i--) if (steps[i].k === 'ex' && steps[i]._e === undefined && steps[i].x.caught === null) { steps[i].x.caught = `${files[fr.file][0]}:${line}`; touch(i); break; }
    },
    f(k) {
      const fr = frames.get(k);
      if (!fr) return;
      frames.delete(k);
      if (cur === fr) cur = fr.parent && frames.has(fr.parent.id) ? fr.parent : (fr.parent && fr.parent.ev ? null : null);
      if (fr.muted || !on) return;
      if (fr.pending) emitCall(fr, 0, {});
      const s = { i: steps.length, k: 'return', c: fr.id, d: fr.d, t: ms(), ln: fr.last >= 0 ? steps[fr.last].ln : undefined };
      if (fr.err) { s.ret = ser(fr.err); s.raised = true; } else s.ret = fr.hasRet ? ser(fr.ret) : { t: 'undefined' };
      push(s);
      // async 함수 · Promise 를 돌려주면 풀린 값을 나중에 채운다
      const pv = fr.hasRet ? fr.ret : null;
      if (pv && typeof pv === 'object' && typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(pv) || {}, 'then') !== 'undefined' && pv instanceof Promise) {
        pv.then((v) => { s.ret = { t: 'Promise', f: { 풀린값: ser(v) } }; touch(s.i); }, (e) => { s.ret = { t: 'Promise', f: { 거부: ser(e) } }; touch(s.i); });
      }
    },
    s(k, v) { const fr = frames.get(k); cur = fr && fr.parent && frames.has(fr.parent.id) ? fr.parent : null; return v; }, // await 앞: 부른 쪽으로
    w(k, v) { const fr = frames.get(k); if (fr) cur = fr; return v; }, // await 뒤: 이 호출로
    mark(label) {
      if (!on) return;
      if (mark) T.f(mark.id);
      seq += 1;
      const fr = { id: seq, file: -1, fn: -1, parent: null, d: 1, hits: {}, curLine: 0, last: -1, vals: {}, raw: {}, pending: false, muted: false, ev: true, startI: steps.length };
      frames.set(fr.id, fr);
      fnCount = new Map();
      rootCalls.clear();
      fr.last = steps.length;
      push({ i: steps.length, k: 'line', c: fr.id, d: 1, t: ms(), ln: 0, cls: '사용자 동작', m: String(label), call: true, p: -1, site: -1, args: {}, ev: true });
      mark = fr;
      cur = null;
    },
    net(info) {
      if (!on || steps.length >= MAX_STEPS) return; // 요청은 동작 예산을 넘어도 남긴다
      const fr = info.from || cur || mark; // 요청을 보낸 호출 (응답 때는 이미 끝났을 수 있다)
      if (!fr && O.netOwned) return; // 서버: 프레임워크가 스스로 보내는 요청(버전 확인 등)은 뺀다
      const s = { i: steps.length, k: 'net', c: fr ? fr.id : -1, d: fr ? fr.d : 1, t: ms(), site: fr ? fr.last : -1, x: info.x };
      if (fr && fr.last >= 0) s.ln = steps[fr.last].ln;
      push(s);
    },
    sql(info) { // Node: SQL 드라이버 감싸기에서
      if (!on || full()) return;
      const fr = cur;
      if (!fr || fr.muted) return;
      const s = { i: steps.length, k: 'sql', c: fr.id, d: fr.d, t: ms(), site: fr.last, x: info };
      if (fr.last >= 0) s.ln = steps[fr.last].ln;
      push(s);
    },
    current() { return cur || mark || null; },
    start() { on = true; startedAt = ms(); },
    stop() { if (mark) { T.f(mark.id); mark = null; } on = false; },
    /** 브라우저: 바뀐 단계만 개발 서버(kedovi trace 플러그인)로 보낸다. 페이지를 떠날 때도 */
    flush(final) {
      if (!dirty.size || typeof location === 'undefined' || !O.collect) return;
      const ids = [...dirty].sort((a, b) => a - b);
      dirty.clear();
      const body = JSON.stringify({ sid: SID, epoch: EPOCH, page: location.pathname + location.search, files: files.map((f) => f[0]), notes, truncated, steps: ids.map((i) => steps[i]) });
      try { origFetch(O.collect, { method: 'POST', body, keepalive: final && body.length < 60000, headers: { 'content-type': 'application/json' } }).catch(() => {}); } catch (e) { /* 페이지 닫힘 */ }
    },
    dump(extra) {
      for (const s of steps) delete s._e;
      return Object.assign({ version: 1, lang: 'js', epoch: EPOCH, startedAt, endedAt: ms(), truncated, maxHits: MAX_HITS, notes, steps }, extra || {});
    },
  };
  G.__kedoviT = T;
  const SID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const origFetch = typeof G.fetch === 'function' ? G.fetch.bind(G) : null;

  // ── 브라우저: 사용자 동작 자동 표시 · 개발 서버로 보내기 ──
  if (typeof document !== 'undefined' && O.collect) {
    const label = (el) => {
      if (!el || el.nodeType !== 1) return '';
      const t = el.closest && el.closest('button,a,[role=button],[role=tab],[role=menuitem],[role=option],label,input,select,textarea,summary') || el;
      const tag = t.tagName.toLowerCase();
      const name = (t.getAttribute('aria-label') || t.getAttribute('name') || t.getAttribute('placeholder') || (t.innerText || t.value || '').trim().replace(/\s+/g, ' ')).slice(0, 40);
      return `${tag}${name ? ` "${name}"` : ''}`;
    };
    const on2 = (type, fn) => document.addEventListener(type, fn, true);
    on2('click', (e) => T.mark(`클릭 ${label(e.target)}`));
    on2('change', (e) => { const t = e.target; if (t && /^(SELECT|INPUT|TEXTAREA)$/.test(t.tagName)) T.mark(`입력 ${label(t)}${t.type === 'password' ? '' : ` = ${String(t.type === 'checkbox' || t.type === 'radio' ? t.checked : t.value).slice(0, 40)}`}`); });
    on2('submit', (e) => T.mark(`제출 ${label(e.target)}`));
    on2('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') T.mark(`키 ${e.key} ${label(e.target)}`); });
    G.addEventListener('popstate', () => T.mark(`뒤로 · 앞으로 ${location.pathname}`));
    T.mark(`열기 ${location.pathname}${location.search}`);
    G.addEventListener('pagehide', () => T.flush(true));
  }

  // ── 네트워크 (브라우저 · Node 18+ fetch) ──
  const SKIP_NET = O.netSkip ? new RegExp(O.netSkip) : null;
  if (O.net !== false && typeof G.fetch === 'function' && !G.fetch.__kedovi) {
    const orig = G.fetch;
    const body = (b) => { try { return typeof b === 'string' ? (b.length > 20000 ? `${b.slice(0, 20000)}…` : b) : b == null ? null : `(${b.constructor && b.constructor.name})`; } catch (e) { return null; } };
    const wrapped = function fetch(input, init) {
      const from = T.current();
      const t = now();
      const method = (init && init.method) || (input && input.method) || 'GET';
      const url = typeof input === 'string' ? input : input && (input.url || String(input));
      if (SKIP_NET && SKIP_NET.test(String(url))) return orig.apply(this, arguments); // 개발 서버 내부 요청 (화면 갱신 등)
      let args = arguments;
      // 같은 주소의 서버(Next.js 등)로 가는 요청: 보낸 호출을 헤더로 알려 서버 기록을 그 아래에 잇는다
      if (O.link && from && typeof location !== 'undefined') {
        try {
          if (new URL(url, location.href).origin === location.origin) {
            const h = new Headers((init && init.headers) || (input && typeof input === 'object' && input.headers) || undefined);
            h.set('x-kedovi-from', `${SID}:${from.id}`);
            args = [input, Object.assign({}, init || {}, { headers: h })];
          }
        } catch (e) { /* 그대로 보낸다 */ }
      }
      const p = orig.apply(this, args);
      p.then((res) => {
        const x = { method: String(method).toUpperCase(), url, status: res.status, ms: Math.round(now() - t), req: body(init && init.body), res: null };
        res.clone().text().then((txt) => { x.res = body(txt); T.net({ from, x }); }, () => T.net({ from, x }));
      }, (e) => T.net({ from, x: { method: String(method).toUpperCase(), url, status: 0, ms: Math.round(now() - t), req: body(init && init.body), error: String(e && e.message || e) } }));
      return p;
    };
    wrapped.__kedovi = true;
    G.fetch = wrapped;
  }
  if (O.net !== false && typeof G.XMLHttpRequest === 'function' && !G.XMLHttpRequest.prototype.__kedovi) {
    const P = G.XMLHttpRequest.prototype;
    const open = P.open;
    const send = P.send;
    P.open = function (m, u) { this.__ak = { method: String(m).toUpperCase(), url: String(u) }; return open.apply(this, arguments); };
    P.send = function (b) {
      const info = this.__ak || {};
      if (SKIP_NET && SKIP_NET.test(String(info.url))) return send.apply(this, arguments);
      const from = T.current();
      const t = now();
      this.addEventListener('loadend', () => {
        let res = null;
        try { res = this.responseType === '' || this.responseType === 'text' ? String(this.responseText).slice(0, 20000) : `(${this.responseType})`; } catch (e) { /* 읽지 못함 */ }
        T.net({ from, x: { method: info.method, url: info.url, status: this.status, ms: Math.round(now() - t), req: typeof b === 'string' ? b.slice(0, 20000) : null, res } });
      });
      return send.apply(this, arguments);
    };
    P.__kedovi = true;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this));
