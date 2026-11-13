// kedovi trace 기록 합치기 (JS): 브라우저 페이지마다 · 서버 프로세스마다 따로 쌓인 기록 묶음을 단계 하나로 잇는다
'use strict';

/**
 * 기록 묶음(브라우저 페이지마다 · Next.js 서버) → 단계 하나로 (번호 · 부모 · 호출 자리를 다시 매김)
 * 묶음마다 시작 시각(epoch)이 있으면 실제 시각 순으로 섞는다. 서버 호출에 from(화면 묶음:호출)이 있으면 그 화면 호출 아래로 옮긴다
 */
function merge(list, maxHits) {
  const notes = [];
  const sessions = (list || []).filter((s) => s && s.steps && s.steps.length);
  sessions.sort((a, b) => (a.epoch || a.at || 0) - (b.epoch || b.at || 0));
  const base = [];
  let cb = 0;
  let truncated = false;
  sessions.forEach((s, k) => {
    base[k] = cb;
    cb += s.steps.reduce((m, x) => Math.max(m, x.c || 0), 0) + 1;
    truncated = truncated || s.truncated;
    for (const x of s.notes || []) if (!notes.includes(x)) notes.push(x);
  });
  const bySid = new Map(sessions.map((s, k) => [s.sid, k]));
  // 화면 호출의 깊이 (서버 쪽 나무를 그 아래로 내린다)
  const depthOf = sessions.map((s) => { const m = new Map(); for (const x of s.steps) if (x.call) m.set(x.c, x.d); return m; });
  const link = sessions.map((s) => {
    const pOf = new Map();
    for (const x of s.steps) if (x.call) pOf.set(x.c, x.p);
    const rootOf = (c) => { let r = c; for (let n = 0; n < 500 && pOf.has(r) && pOf.get(r) >= 0; n += 1) r = pOf.get(r); return r; };
    const roots = new Map(); // 뿌리 호출 → { k, c, d }
    for (const x of s.steps) {
      if (!x.call || x.p >= 0 || !x.from) continue;
      const [sid, c] = String(x.from).split(':');
      const k = bySid.get(sid);
      if (k === undefined) continue;
      roots.set(x.c, { k, c: Number(c), d: depthOf[k].get(Number(c)) || 1 });
    }
    return { rootOf, roots };
  });
  const entries = [];
  sessions.forEach((s, k) => { for (const st of s.steps) entries.push({ k, st, at: (s.epoch || s.at || 0) + (st.t || 0) }); });
  entries.sort((a, b) => a.at - b.at || a.k - b.k || a.st.i - b.st.i);
  const idx = sessions.map(() => new Map());
  entries.forEach((e, n) => idx[e.k].set(e.st.i, n));
  const t0 = sessions.reduce((m, s) => Math.min(m, s.epoch || s.at || 0), Infinity);
  const lastOf = new Map(); // 새 호출 번호 → 그 호출의 마지막 줄 단계
  const steps = entries.map((e, n) => {
    const { k, st } = e;
    const L = link[k];
    const r = L.roots.size ? L.roots.get(L.rootOf(st.c)) : null;
    const out = { ...st, i: n, c: st.c + base[k], d: st.d + (r ? r.d : 0), t: Math.round(e.at - t0) };
    delete out.from;
    if (st.call) out.p = st.p >= 0 ? st.p + base[k] : -1;
    if (st.site !== undefined) out.site = idx[k].has(st.site) ? idx[k].get(st.site) : -1;
    if (st.call && st.p < 0 && r) { out.p = r.c + base[r.k]; out.site = lastOf.has(out.p) ? lastOf.get(out.p) : -1; }
    if (st.k === 'line') lastOf.set(out.c, n);
    return out;
  });
  return { version: 1, lang: 'js', startedAt: 0, endedAt: steps.reduce((m, x) => Math.max(m, x.t || 0), 0), truncated, maxHits: maxHits || 30, notes, steps };
}

module.exports = { merge };
