/**
 * 외부 API 시뮬레이터 (kedovi apiledger add node 가 넣음). 장부(api-ledger.yaml)를 읽어 API 마다 로컬 HTTP 서버를 띄운다.
 * 응답 칸: status · headers · body · delayMs(머리 전 지연) · stallBodyMs(본문 절반 뒤 멈춤) · reset(연결 끊기) · failTimes(앞 N 번만, 뒤는 ok)
 * 쓰는 법: const stub = await startStub(); stub.urls.<api id>; stub.use('<api>/<endpoint>', 응답); stub.calls(키); await stub.close()
 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const L = require('./ledger.cjs');

const ledgerPath = () => process.env.API_LEDGER || path.resolve(process.cwd(), 'api-ledger.yaml');
const loadLedger = (file = ledgerPath()) => L.load(fs.readFileSync(file, 'utf8'));

function routeRe(p) {
  return new RegExp(`^${String(p).split(/\{[^}]+\}/).map((s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('[^/]+')}$`);
}

async function startStub(ledger = loadLedger()) {
  const eps = L.endpoints(ledger);
  const state = new Map(); // key → { response, used, calls }
  const reset = () => { for (const e of eps) state.set(e.key, { response: null, used: 0, calls: 0 }); };
  reset();
  const servers = [];
  const urls = {};
  const sockets = new Set();
  for (const apiId of [...new Set(eps.map((e) => e.api))]) {
    const mine = eps.filter((e) => e.api === apiId).map((e) => ({ ...e, re: routeRe(e.ep.path) }));
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const e = mine.find((x) => x.re.test(url) && (!x.ep.method || x.ep.method === req.method));
      if (!e) { res.writeHead(599); res.end('장부에 없는 경로'); return; }
      const st = state.get(e.key);
      st.calls++;
      let r = st.response;
      if (r && r.failTimes != null && st.used >= r.failTimes) r = null;
      if (r) st.used++;
      reply(req, res, r || e.ep.ok || { status: 200, body: '' }, e.ep.ok || {});
    });
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    urls[apiId] = `http://127.0.0.1:${server.address().port}`;
    servers.push(server);
  }
  return {
    urls,
    ledger,
    use(key, response) { if (!state.has(key)) throw new Error(`장부에 없는 엔드포인트: ${key}`); const st = state.get(key); st.response = response; st.used = 0; },
    calls: (key) => (state.get(key) || {}).calls || 0,
    reset,
    close: async () => { for (const s of sockets) s.destroy(); await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok)))); },
  };
}

function reply(req, res, r, ok) {
  const go = () => {
    if (r.reset) { req.socket.destroy(); return; }
    const body = r.body != null ? r.body : r.status && r.status !== (ok.status || 200) ? '' : ok.body;
    const text = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const headers = { 'content-type': 'application/json', ...(r.headers || {}) };
    if (!r.stallBodyMs) { res.writeHead(r.status || 200, headers); res.end(text); return; }
    const buf = Buffer.from(text || '{"stalled":true}');
    res.writeHead(r.status || 200, { ...headers, 'content-length': String(buf.length) });
    res.write(buf.subarray(0, Math.floor(buf.length / 2)));
    const t = setTimeout(() => res.end(buf.subarray(Math.floor(buf.length / 2))), r.stallBodyMs);
    res.on('close', () => clearTimeout(t));
  };
  if (r.delayMs) { const t = setTimeout(go, r.delayMs); res.on('close', () => clearTimeout(t)); } else go();
}

/** 시험이 다룬 항목을 .api-ledger/covered.json 에 남긴다 (kedovi apiledger check 가 장부와 대조) */
function writeCovered(part, keys) {
  const dir = path.resolve(process.cwd(), '.api-ledger');
  const file = path.join(dir, 'covered.json');
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 처음 */ }
  cur[part] = [...new Set(keys)].sort();
  cur.at = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cur, null, 2)}\n`);
}

module.exports = { startStub, loadLedger, writeCovered, scenarios: L.scenarios, faults: L.faults, check: L.check };
