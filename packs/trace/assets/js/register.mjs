// kedovi trace Node 로더: node --import <이 파일> 로 띄운 서버에서 프로젝트 소스를 계측한다 (module.registerHooks, Node 22.15+)
/*
 * 환경 변수: KEDOVI_TRACE_ROOT(프로젝트) · KEDOVI_TRACE_TS(typescript 경로) · KEDOVI_TRACE_RAW(기록 파일, 프로세스 번호가 붙는다)
 *           KEDOVI_TRACE_OPTS(JSON: maxSteps · maxHits) · KEDOVI_TRACE_ARMED=1 이면 처음부터 기록
 * 켜고 끄기: SIGUSR2 (처음 = 켜기, 다음 = 끄고 쓰기). 프로세스가 끝날 때도 쓴다
 * 빌드된 JS(dist/*.js)는 옆의 .map 으로 원본 TS 파일 · 줄로 되돌린다
 * SQL: node:sqlite · pg(Client.query) · mysql2(진단 채널) 를 기록하는 동안만 감싼다
 */
import Module, { createRequire, registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ROOT = path.resolve(process.env.KEDOVI_TRACE_ROOT || process.cwd());
const OPTS = JSON.parse(process.env.KEDOVI_TRACE_OPTS || '{}');
globalThis.__kedoviTraceOpts = { ...OPTS, autoStart: process.env.KEDOVI_TRACE_ARMED === '1', net: true };
require(path.join(HERE, 'runtime.js'));
const T = globalThis.__kedoviT;
const { instrument } = require('./instrument.cjs');
const ts = require(process.env.KEDOVI_TRACE_TS);
const SKIP = /[\\/](node_modules|\.git|coverage)[\\/]|\.d\.[cm]?ts$/;

// ── 소스맵 (빌드된 JS → 원본) ──
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeVlq(str) {
  const out = [];
  let v = 0;
  let shift = 0;
  for (const ch of str) {
    let d = B64.indexOf(ch);
    const cont = d & 32;
    d &= 31;
    v += d << shift;
    if (cont) shift += 5; else { out.push(v & 1 ? -(v >> 1) : v >> 1); v = 0; shift = 0; }
  }
  return out;
}
/** 대응표: 생성 줄 → [[생성 칸, 원본 파일 번호, 원본 줄], …] (압축돼 한 줄에 여러 줄이 든 코드도 칸으로 가른다) */
function lineMap(map) {
  const out = new Map();
  let src = 0;
  let line = 0;
  map.mappings.split(';').forEach((group, gl) => {
    let col = 0;
    const segs = [];
    for (const seg of group.split(',')) {
      if (!seg) continue;
      const v = decodeVlq(seg);
      col += v[0];
      if (v.length >= 4) { src += v[1]; line += v[2]; segs.push([col, src, line + 1]); }
    }
    if (segs.length) out.set(gl + 1, segs);
  });
  return out;
}
function sourceMapOf(file, code) {
  const m = code.match(/\/\/[#@] sourceMappingURL=([^\s]+)\s*$/);
  if (!m) return null;
  try {
    const raw = m[1].startsWith('data:') ? Buffer.from(m[1].split(',')[1], 'base64').toString('utf8') : fs.readFileSync(path.resolve(path.dirname(file), m[1]), 'utf8');
    const map = JSON.parse(raw);
    const base = path.resolve(path.dirname(file), map.sourceRoot || '');
    return { sources: map.sources.map((s) => path.resolve(base, s)), lines: lineMap(map) };
  } catch { return null; }
}

function instrumentFile(file, code) {
  const abs = path.resolve(file);
  if (!abs.startsWith(ROOT + path.sep) || SKIP.test(abs)) return null;
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
  let opts = { ts, src: rel(abs) };
  { // 빌드된 JS · tsx 가 변환한 코드: 소스맵 주석이 있으면 원본 파일 · 줄로
    const sm = sourceMapOf(abs, code);
    if (sm && sm.sources.length === 1 && fs.existsSync(sm.sources[0])) {
      const lines = sm.lines;
      let last = 1;
      opts = { ts, src: rel(sm.sources[0]), mapLine: (l, c) => {
        const segs = lines.get(l);
        if (!segs) return last;
        let hit = segs[0];
        for (const x of segs) { if (x[0] <= c) hit = x; else break; }
        last = hit[2];
        return hit[2];
      } };
    }
  }
  try { const r = instrument(code, abs, opts); return r ? r.code : null; } catch { return null; }
}

// tsx · ts-node 는 자체 로더를 쓴다. Node 22 에서는 동기 훅(registerHooks)과 함께 두면 통과만 하는 훅도 깨진다 (실측)
// → CommonJS 컴파일 단계에서 그 로더가 변환한 JS 를 계측하고, 인라인 소스맵으로 원본 TS 줄을 되돌린다
const ownLoader = /\btsx\b|ts-node|@swc-node|@esbuild-kit/.test(`${process.execArgv.join(' ')} ${process.env.NODE_OPTIONS || ''}`);
if (ownLoader || typeof registerHooks !== 'function') {
  const compile = Module.prototype._compile;
  Module.prototype._compile = function kedoviCompile(content, filename) {
    const out = typeof content === 'string' ? instrumentFile(filename, content) : null;
    return compile.call(this, out || content, filename);
  };
  if (typeof registerHooks !== 'function') process.stderr.write('kedovi trace: module.registerHooks 가 없는 Node 입니다 (22.15 미만). CommonJS 만 기록합니다\n');
} else {
  registerHooks({
    load(url, context, nextLoad) {
      const r = nextLoad(url, context);
      if (!url.startsWith('file:')) return r;
      const file = fileURLToPath(url);
      if (!/\.([cm]?[jt]sx?)$/.test(file)) return r;
      let src = r.source;
      if (src == null) { try { src = fs.readFileSync(file, 'utf8'); } catch { return r; } }
      const code = typeof src === 'string' ? src : Buffer.from(src).toString('utf8');
      // pg: Client.query 를 감싼다 (진단 채널이 아직 없다)
      if (/[\\/]node_modules[\\/]pg[\\/]lib[\\/]client\.js$/.test(file)) return { ...r, source: `${code}\n;require(${JSON.stringify(path.join(HERE, 'sql-hooks.cjs'))}).pg(module.exports);` };
      const out = instrumentFile(file, code);
      return out ? { ...r, source: out } : r;
    },
  });
}

require('./sql-hooks.cjs').install();

// ── 켜고 끄기 · 쓰기 ──
const RAW = process.env.KEDOVI_TRACE_RAW;
let written = false;
function write(why) {
  if (written || !RAW) return;
  written = true;
  T.stop();
  const d = T.dump();
  if (why) d.notes.push(why);
  try { fs.writeFileSync(`${RAW}.${process.pid}.json`, JSON.stringify(d)); } catch { /* 쓸 수 없음 */ }
}
let armed = process.env.KEDOVI_TRACE_ARMED === '1';
// 이 프로세스가 기록기를 올렸다고 남긴다: kedovi trace 는 이 번호에만 신호를 보낸다 (npm 이 띄운 셸 등은 신호에 죽을 수 있다)
if (RAW) { try { fs.mkdirSync(`${RAW}.pids`, { recursive: true }); fs.writeFileSync(path.join(`${RAW}.pids`, String(process.pid)), process.argv.slice(1).join(' ')); } catch { /* 없음 */ } }
process.on('SIGUSR2', () => {
  if (!armed) { armed = true; T.start(); return; }
  write();
});
process.on('exit', () => { if (armed) write(); });
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { if (armed) write(); process.exit(0); });
