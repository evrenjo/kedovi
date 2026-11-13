// kedovi trace Next.js 개발 서버: 프로젝트의 next 를 이 프로세스에서 띄우고(next({ dev })), 화면 · 서버 코드를 함께 기록한다
/*
 * 프로젝트의 next.config 는 고치지 않는다. 이 프로세스 안에서 설정 읽기(next/dist/server/config)를 감싸 계측 로더만 덧붙인다
 *   Turbopack = turbopack.rules (브라우저 · 서버 조건을 나눠서) · webpack = webpack(config) 에 pre 로더
 * 브라우저: HTML 응답의 <head> 바로 뒤에 기록 런타임을 넣는다 (Playwright 테스트 · 단계 목록 · 직접 조작 모두)
 * 서버: 서버 컴포넌트 · API 라우트 · 서버 액션 · 미들웨어(Node) 가 이 프로세스에서 돈다 → 여기 런타임이 기록한다
 *   요청마다 문맥(AsyncLocalStorage)을 두어 동시에 온 요청의 호출이 섞이지 않게, 화면이 보낸 요청이면 보낸 호출(x-kedovi-from)에 잇는다
 */
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createRequire } = require('module');
const { AsyncLocalStorage } = require('async_hooks');
const { collector } = require('./collector.cjs');

const LOADER = path.join(__dirname, 'next-loader.cjs');
const EXTS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'mts'];

/** 이 프로젝트의 next 버전 · 번들러 (Turbopack | webpack) */
function nextInfo(root) {
  const req = createRequire(path.join(root, 'package.json'));
  const version = JSON.parse(fs.readFileSync(req.resolve('next/package.json'), 'utf8')).version;
  const [major, minor] = version.split('.').map(Number);
  let script = '';
  try { const sc = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts || {}; script = Object.values(sc).find((x) => /\bnext\s+dev\b/.test(x)) || ''; } catch { /* 없음 */ }
  // 16 부터 Turbopack 이 기본 (--webpack 으로 끈다). 15 이하는 --turbo · --turbopack 일 때만
  const turbo = major >= 16 ? !/--webpack\b/.test(script) : /--turbo(pack)?\b/.test(script);
  // 규칙 위치: 15.3 부터 turbopack.rules (그 전 experimental.turbo.rules). 조건(browser · foreign) 문법은 16 부터
  return { version, major, minor, turbo, rulesTop: major > 15 || (major === 15 && minor >= 3), conditions: major >= 16 };
}

/** 설정에 계측 로더를 덧붙인다 (한 번만) */
function addLoader(c, info, opts) {
  if (!c || c.__kedovi) return c;
  Object.defineProperty(c, '__kedovi', { value: true });
  // 빌드 폴더를 따로: 사용자가 띄운 next dev(같은 폴더 잠금) · 평소 캐시와 섞이지 않게. .next 안이라 git 에 잡히지 않는다
  c.distDir = path.posix.join(String(c.distDir || '.next').split(path.sep).join('/'), 'kedovi-trace');
  const base = { root: opts.root, ts: opts.ts };
  if (info.turbo) {
    const loader = (side) => ({ loader: LOADER, options: { ...base, side } });
    const holder = info.rulesTop ? (c.turbopack = c.turbopack || {}) : ((c.experimental = c.experimental || {}).turbo = c.experimental.turbo || {});
    const rules = holder.rules = { ...(holder.rules || {}) };
    for (const ext of EXTS) {
      const key = `*.${ext}`;
      const had = rules[key];
      if (info.conditions) {
        const ours = [
          { condition: { all: [{ not: 'foreign' }, 'browser'] }, loaders: [loader('client')] },
          { condition: { all: [{ not: 'foreign' }, { not: 'browser' }] }, loaders: [loader('server')] },
        ];
        rules[key] = [...ours, ...(had ? [].concat(had) : [])];
      } else if (had && !Array.isArray(had) && typeof had === 'object' && Array.isArray(had.loaders)) {
        rules[key] = { ...had, loaders: [...had.loaders, loader('any')] }; // 로더는 뒤에서부터 돈다: 원본을 가장 먼저 받게 맨 뒤에
      } else if (!had) {
        rules[key] = { loaders: [loader('any')] }; // 15 이하: 조건 문법이 없다 (node_modules 는 로더가 건너뛰고, 서버에서 미리 그리는 것은 'use client' 파일만 빠진다)
      }
    }
  } else {
    const user = c.webpack;
    c.webpack = function kedoviWebpack(cfg, ctx) {
      const out = typeof user === 'function' ? user(cfg, ctx) : cfg;
      out.module = out.module || {};
      out.module.rules = [{ test: /\.[cm]?[jt]sx?$/, exclude: /[\\/]node_modules[\\/]/, enforce: 'pre', use: [{ loader: LOADER, options: { ...base, side: ctx && ctx.isServer ? 'server' : 'client' } }] }, ...(out.module.rules || [])];
      return out;
    };
  }
  return c;
}

/** 설정 읽기 함수를 감싼다: next 를 불러오기 전에 해야 한다 (next 모듈들이 불러올 때 이것을 받는다) */
function patchConfig(req, info, opts) {
  const p = req.resolve('next/dist/server/config');
  const mod = req(p);
  const orig = mod.default;
  if (typeof orig !== 'function' || orig.__kedovi) return;
  const wrapped = async function kedoviLoadConfig(phase, ...rest) {
    const c = await orig.call(this, phase, ...rest);
    return /development/.test(String(phase)) ? addLoader(c, info, opts) : c;
  };
  wrapped.__kedovi = true;
  const ex = { __esModule: true };
  for (const k of Object.keys(mod)) if (k !== 'default') Object.defineProperty(ex, k, { enumerable: true, get: () => mod[k] });
  ex.default = wrapped;
  require.cache[p].exports = ex;
}

/** next dev 가 프로젝트에 쓰는 파일(타입 설정 · 에이전트 안내 등)을 기록 전 모습으로 되돌린다 */
const TOUCHED = ['tsconfig.json', 'jsconfig.json', 'next-env.d.ts', 'AGENTS.md', 'CLAUDE.md'];
function keepFiles(root) {
  const snap = TOUCHED.map((f) => { const p = path.join(root, f); try { return [p, fs.readFileSync(p)]; } catch { return [p, null]; } });
  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    for (const [p, buf] of snap) {
      try {
        if (buf === null) { if (fs.existsSync(p)) fs.unlinkSync(p); } else if (!fs.readFileSync(p).equals(buf)) fs.writeFileSync(p, buf);
      } catch { /* 지워졌으면 */ if (buf !== null) { try { fs.writeFileSync(p, buf); } catch { /* 쓸 수 없음 */ } } }
    }
  };
  process.once('exit', restore);
  return restore;
}

/** HTML 응답의 <head> 뒤에 글을 넣는다 (바이트 그대로, 압축은 요청에서 뺐다) */
function injectHtml(res, tag) {
  let done = false;
  const html = (h) => /text\/html/i.test(String(h || res.getHeader('content-type') || ''));
  const wh = res.writeHead;
  res.writeHead = function (code, ...rest) {
    const hdr = rest.find((x) => x && typeof x === 'object');
    if (hdr && !Array.isArray(hdr)) { const ct = Object.keys(hdr).find((k) => k.toLowerCase() === 'content-type'); if (ct && html(hdr[ct])) { for (const k of Object.keys(hdr)) if (k.toLowerCase() === 'content-length') delete hdr[k]; } }
    if (html()) res.removeHeader('content-length');
    return wh.call(this, code, ...rest);
  };
  const fix = (chunk) => {
    if (done || chunk == null || typeof chunk === 'function') return chunk;
    if (!html()) { done = true; return chunk; }
    const buf = Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk));
    const at = buf.indexOf('<head');
    if (at < 0) return chunk;
    const end = buf.indexOf('>', at);
    if (end < 0) return chunk;
    done = true;
    if (!res.headersSent) res.removeHeader('content-length');
    return Buffer.concat([buf.subarray(0, end + 1), Buffer.from(tag), buf.subarray(end + 1)]);
  };
  const w = res.write;
  res.write = function (chunk, ...rest) { return w.call(this, fix(chunk), ...rest); };
  const e = res.end;
  res.end = function (chunk, ...rest) { return e.call(this, fix(chunk), ...rest); };
}

/**
 * opts: { root, port, ts, out(브라우저 기록 파일), maxSteps, maxHits }
 * → { url, info, close(), dump() (서버 기록), start() }
 */
async function startNext(opts) {
  const root = path.resolve(opts.root);
  const req = createRequire(path.join(root, 'package.json'));
  const info = nextInfo(root);
  // 서버 기록: 준비(첫 컴파일 · 미리 열기) 동안은 끄고, start() 뒤부터
  const als = new AsyncLocalStorage();
  globalThis.__kedoviTraceOpts = { maxSteps: opts.maxSteps || 30000, maxHits: opts.maxHits || 30, autoStart: false, net: true, netOwned: true, ctx: () => als.getStore() };
  require('./runtime.js');
  const T = globalThis.__kedoviT;
  delete globalThis.__kedoviTraceOpts;
  const restore = keepFiles(root);
  patchConfig(req, info, opts);
  process.env.NODE_ENV = 'development';
  process.env.NEXT_TELEMETRY_DISABLED = '1';
  const next = req('next');
  const app = (next.default || next)({ dev: true, dir: root, hostname: '127.0.0.1', port: opts.port, ...(info.turbo ? { turbopack: true } : { webpack: true }) });
  const handle = app.getRequestHandler();
  await app.prepare();
  const col = collector(opts.out);
  const runtime = fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8');
  const bOpts = { maxSteps: opts.maxSteps || 30000, maxHits: opts.maxHits || 30, collect: '/__kedovi/trace', link: true, netSkip: '/_next/|/__nextjs|/__kedovi/' };
  const tag = `<script>globalThis.__kedoviTraceOpts=${JSON.stringify(bOpts)};\n${runtime}</script>`;
  const server = http.createServer((rq, res) => {
    if (rq.url.startsWith('/__kedovi/trace')) { col.handle(rq, res); return; }
    delete rq.headers['accept-encoding'];
    const f = String(rq.headers['x-kedovi-from'] || '');
    delete rq.headers['x-kedovi-from'];
    injectHtml(res, tag);
    als.run({ from: f || null, url: rq.url }, () => handle(rq, res));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(opts.port, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${opts.port}`;
  return {
    url,
    info,
    start() { T.start(); },
    dump() { T.stop(); return T.dump(); },
    async close() {
      await new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); setTimeout(r, 3000); });
      try { await app.close(); } catch { /* 이미 닫힘 */ }
      restore();
    },
  };
}

module.exports = { startNext, nextInfo, addLoader };
