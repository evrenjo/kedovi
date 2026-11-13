// kedovi trace: Node SQL 기록 (기록할 때만). node:sqlite · pg · mysql2. 프로젝트 코드는 고치지 않는다
'use strict';
const SECRET = /passw|pwd|secret|token|apikey|api_key|credential|authorization/i;

function rec(q, params, ms, ok) {
  const T = globalThis.__kedoviT;
  if (!T || !T.sql) return;
  const val = (v) => (v === undefined ? null : typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v).slice(0, 500) : v instanceof Date ? v.toISOString() : v);
  let ps = [];
  if (Array.isArray(params)) ps = [params.map((v, i) => [i + 1, val(v)])];
  else if (params && typeof params === 'object') ps = [Object.entries(params).map(([k, v]) => [k, SECRET.test(k) ? '***' : val(v)])];
  T.sql({ ms: Math.round(ms * 100) / 100, ok, qs: [{ q: String(q).slice(0, 4000), ps }] });
}

const now = () => Number(process.hrtime.bigint()) / 1e6;

/** 동기 함수 감싸기 */
function timed(q, params, fn) {
  const t = now();
  try { const r = fn(); rec(q, params, now() - t, true); return r; } catch (e) { rec(q, params, now() - t, false); throw e; }
}

/** node:sqlite 의 DatabaseSync.prepare → StatementSync.run · get · all · iterate */
function sqlite() {
  let m;
  try { m = require('node:sqlite'); } catch { return; }
  const S = m.StatementSync && m.StatementSync.prototype;
  if (!S || S.__kedovi) return;
  for (const name of ['run', 'get', 'all']) {
    const orig = S[name];
    if (typeof orig !== 'function') continue;
    S[name] = function kedoviSql(...args) {
      const params = args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]) ? args[0] : args;
      return timed(this.sourceSQL, params, () => orig.apply(this, args));
    };
  }
  S.__kedovi = true;
  const D = m.DatabaseSync && m.DatabaseSync.prototype;
  if (D && typeof D.exec === 'function' && !D.__kedovi) {
    const exec = D.exec;
    D.exec = function kedoviExec(sql) { return timed(sql, [], () => exec.call(this, sql)); };
    D.__kedovi = true;
  }
}

/** pg: Client.prototype.query (콜백 · Promise 모두) */
function pg(Client) {
  const P = Client && Client.prototype;
  if (!P || P.__kedovi) return;
  const orig = P.query;
  P.query = function kedoviQuery(config, values, cb) {
    const q = typeof config === 'string' ? config : config && config.text;
    const params = Array.isArray(values) ? values : config && config.values;
    const t = now();
    const r = orig.apply(this, arguments);
    if (r && typeof r.then === 'function') r.then(() => rec(q, params, now() - t, true), () => rec(q, params, now() - t, false));
    else rec(q, params, now() - t, true);
    return r;
  };
  P.__kedovi = true;
}

/** mysql2: 진단 채널 mysql2:query · mysql2:execute (구독자가 없으면 비용 0) */
function mysql2() {
  let dc;
  try { dc = require('node:diagnostics_channel'); } catch { return; }
  if (typeof dc.tracingChannel !== 'function') return;
  for (const name of ['mysql2:query', 'mysql2:execute']) {
    const ch = dc.tracingChannel(name);
    const starts = new WeakMap();
    ch.subscribe({
      start(ctx) { starts.set(ctx, now()); },
      asyncEnd(ctx) { rec(ctx.query || ctx.sql, ctx.values, now() - (starts.get(ctx) || now()), !ctx.error); },
      error() {},
      end() {},
      asyncStart() {},
    });
  }
}

function install() { sqlite(); mysql2(); }

module.exports = { install, pg, sqlite, mysql2, rec };
