// kedovi trace: JS · TS 기록 (웹 화면 = 계측한 Vite · Next.js 개발 서버 + 브라우저, 단위 테스트 = Vitest · Jest, 서버 = Node 로더 · Next.js)
// 계측 = assets/js/instrument.cjs (원본 소스에 같은 줄 안에서 기록 호출을 끼움). 파서 = 프로젝트의 typescript, 없으면 이 PC 캐시(~/.kedovi/cache/trace-ts)에 한 번 받는다
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ASSETS = path.join(__dirname, '..', 'assets', 'js');
const CACHE = path.join(os.homedir(), '.kedovi', 'cache', 'trace-ts'); // 이 PC 공용 (워크스페이스 목록 KEDOVI_HOME 과 따로)
const TS_VERSION = '6'; // 7(Go 판)은 JS 파서 API 가 없다

/** 파서(typescript) 경로: 프로젝트 것(6 이하, createSourceFile 있음) → 캐시 → 받기 */
function tsPath(dir, { install = true } = {}) {
  const tryOne = (p) => {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(p), '..', 'package.json'), 'utf8'));
      if (Number(String(pkg.version).split('.')[0]) >= 7) return null;
      return typeof require(p).createSourceFile === 'function' ? p : null;
    } catch { return null; }
  };
  try { const p = require.resolve('typescript', { paths: [dir] }); if (tryOne(p)) return p; } catch { /* 없음 */ }
  const cached = path.join(CACHE, 'node_modules', 'typescript', 'lib', 'typescript.js');
  if (fs.existsSync(cached) && tryOne(cached)) return cached;
  if (!install) return null;
  fs.mkdirSync(CACHE, { recursive: true });
  if (!fs.existsSync(path.join(CACHE, 'package.json'))) fs.writeFileSync(path.join(CACHE, 'package.json'), '{"private":true}\n');
  process.stdout.write(`… 소스 파서(typescript@${TS_VERSION})를 이 PC 에 한 번 받습니다 (${CACHE})\n`);
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['i', '--no-audit', '--no-fund', '--silent', `typescript@${TS_VERSION}`], { cwd: CACHE, stdio: 'inherit' });
  if (r.status !== 0 || !fs.existsSync(cached)) return null;
  return cached;
}

/** 테스트 지정: "<파일>::<테스트 이름>" · "<파일>" */
function parseTest(spec) {
  const s = String(spec || '');
  const i = s.indexOf('::');
  return i > 0 ? { file: s.slice(0, i), name: s.slice(i + 2) } : { file: s, name: '' };
}

/** Playwright 설정 파일 */
function pwConfig(dir) {
  return ['playwright.config.ts', 'playwright.config.mts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs'].find((f) => fs.existsSync(path.join(dir, f))) || null;
}

/** 이 테스트 파일은 Playwright(브라우저 e2e) 인가 */
function isPlaywrightTest(dir, file) {
  let text = '';
  try { text = fs.readFileSync(path.resolve(dir, file), 'utf8'); } catch { return false; }
  return /from\s+['"](@playwright\/test|playwright\/test)['"]|require\(['"]@playwright\/test['"]\)/.test(text);
}

/** 화면 개발 서버: Next.js (next.config 또는 next dev 스크립트) → Vite */
function webFramework(dir) {
  if (has(dir, 'next')) {
    let script = '';
    try { script = Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).scripts || {}).join(' '); } catch { /* 없음 */ }
    if (/\bnext\s+(dev|start|build)\b/.test(script) || ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs', 'next.config.mts'].some((f) => fs.existsSync(path.join(dir, f)))) return 'next';
  }
  return has(dir, 'vite') ? 'vite' : null;
}

const has = (dir, name) => { try { require.resolve(`${name}/package.json`, { paths: [dir] }); return true; } catch { return false; } };

/** 기록의 src(프로젝트 상대 경로) → 파일 */
function mapSources(dir, trace) {
  const out = {};
  for (const src of new Set((trace.steps || []).map((s) => s.src).filter(Boolean))) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, src), 'utf8'); } catch { continue; }
    out[src] = { path: src, text: text.length > 400000 ? text.slice(0, 400000) : text };
  }
  return out;
}

async function run(opts, ROOT, dir, lang, h) {
  const { fail, freePort, finish, tail } = h;
  if (!fs.existsSync(path.join(dir, 'node_modules'))) fail(`${dir}: node_modules 가 없습니다. 먼저 npm install (또는 pnpm · yarn) 을 하세요`);
  const ts = tsPath(dir);
  if (!ts) fail('소스 파서(typescript)를 준비하지 못했습니다. 네트워크를 확인하거나 프로젝트에 typescript 를 devDependency 로 넣으세요');
  const tmp = path.join(ROOT, '.agents', 'traces', 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const stamp = Date.now();
  const job = { root: dir, ts, out: path.join(tmp, `${stamp}.js.json`), raw: path.join(tmp, `${stamp}.raw.json`), tmp, maxSteps: Number(opts.maxSteps) || (opts.web || opts.manual || /\.(spec|e2e)\./.test(String(opts.test || '')) ? 30000 : 5000), maxHits: Number(opts.maxHits) || 30, timeout: Number(opts.timeout) || 900 };
  let title;
  let entry;
  const fw = webFramework(dir);
  job.framework = fw;
  const NO_WEB = '화면 기록은 Next.js 또는 Vite 개발 서버가 있는 프로젝트만 됩니다';
  if (opts.request && fw === 'next' && !opts.serve) return runNextRequest(opts, ROOT, dir, job, h);
  if (opts.request) return runServer(opts, ROOT, dir, job, h);
  if (opts.test) {
    const t = parseTest(opts.test);
    if (!fs.existsSync(path.resolve(dir, t.file))) fail(`테스트 파일 ${t.file} 이 ${dir} 에 없습니다`);
    job.spec = t.file;
    job.grep = t.name || opts.grep || '';
    entry = `${t.file}${job.grep ? ` › ${job.grep}` : ''}`;
    title = job.grep || path.basename(t.file);
    if (isPlaywrightTest(dir, t.file)) {
      if (!fw) fail(`Playwright 테스트 기록: ${NO_WEB}`);
      job.mode = 'web-pw';
      job.pwConfig = pwConfig(dir);
      job.project = opts.project || '';
    } else {
      const runnerOf = testRunner(dir);
      if (!runnerOf) fail('테스트 실행기(Vitest · Jest)를 찾지 못했습니다');
      job.mode = runnerOf;
    }
  } else {
    if (!fw) fail(`화면 시나리오 기록: ${NO_WEB}`);
    const steps = typeof opts.web === 'string' && opts.web !== 'true' ? opts.web : opts.steps || '';
    job.mode = opts.manual || (!steps && !opts.scenario) ? 'web-manual' : 'web-steps';
    job.steps = steps;
    job.headed = !!opts.headed;
    entry = job.mode === 'web-manual' ? '직접 조작' : steps.replace(/\s*\n\s*/g, '; ');
    title = opts.title || (job.mode === 'web-manual' ? '화면 직접 조작' : `화면 ${(steps.match(/(?:goto|open)\s+(\S+)/i) || [])[1] || '/'}`);
  }
  if (job.mode === 'jest') return runJest(opts, ROOT, dir, job, h, { title, entry });
  if (job.mode !== 'vitest') job.port = await freePort();
  const logFile = path.join(tmp, `${stamp}.run.log`);
  const log = fs.createWriteStream(logFile);
  const manual = job.mode === 'web-manual';
  const child = spawn(process.execPath, [path.join(ASSETS, 'runner.mjs')], { cwd: dir, env: { ...process.env, KEDOVI_TRACE_JOB: JSON.stringify(job) }, stdio: [manual ? 'inherit' : 'ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log.write(d); const s = d.toString(); for (const l of s.split('\n')) if (/^(…|  ·|\n?브라우저에서)/.test(l)) process.stdout.write(`${l}\n`); });
  child.stderr.on('data', (d) => log.write(d));
  const timer = setTimeout(() => child.kill('SIGTERM'), (job.timeout + 60) * 1000);
  const code = await new Promise((r) => child.on('exit', r));
  clearTimeout(timer);
  log.end();
  let res = null;
  try { res = JSON.parse(fs.readFileSync(job.out, 'utf8')); } catch { /* 없음 */ }
  if (!res || res.error) fail(`${res && res.error ? res.error : `기록하지 못했습니다 (종료 코드 ${code})`}\n${tail(logFile)}`);
  const trace = res.trace;
  const notes = [...(res.notes || [])];
  if (!trace.steps.length) notes.push('프로젝트 코드가 불리지 않았습니다 (테스트 이름 · 시나리오 확인)');
  finish(ROOT, {
    title: opts.title || title, mode: job.mode === 'vitest' ? 'test' : 'web', entry, tool: job.framework === 'next' && job.mode !== 'vitest' ? `${job.mode} · next` : job.mode, lang: 'js', repo: path.basename(dir), include: [path.basename(dir)], at: new Date().toISOString(),
    request: null, response: null, notes, log: tail(logFile, 40),
  }, trace, mapSources(dir, trace), String(title).replace(/[^\w-]+/g, '-'));
  for (const f of [job.out, job.raw]) { try { fs.unlinkSync(f); } catch { /* 없음 */ } }
  return undefined;
}

/** 단위 테스트 실행기: package.json 의 test 스크립트 → 설치된 것 (vitest 먼저) */
function testRunner(dir) {
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { /* 없음 */ }
  const script = String((pkg.scripts || {}).test || '');
  if (/\bjest\b/.test(script) && has(dir, 'jest')) return 'jest';
  if (/\bvitest\b/.test(script) && has(dir, 'vitest')) return 'vitest';
  return has(dir, 'vitest') ? 'vitest' : has(dir, 'jest') ? 'jest' : null;
}

/** 여러 프로세스 · 페이지의 기록을 하나로 (번호 · 부모 · 호출 자리를 다시 매김, 시작 시각이 있으면 시각 순) */
function mergeDumps(dumps, maxHits) {
  return require(path.join(ASSETS, 'merge.cjs')).merge(dumps, maxHits);
}

/** Jest: 프로젝트 설정을 그대로 읽고(jest-config) 변환기만 감싼다. 한 프로세스(--runInBand)로 테스트 하나 */
async function runJest(opts, ROOT, dir, job, h, { title, entry }) {
  const { fail, finish, tail } = h;
  let jestBin;
  let jestConfig;
  try { jestBin = require.resolve('jest/bin/jest', { paths: [dir] }); jestConfig = require.resolve('jest-config', { paths: [path.dirname(require.resolve('jest/package.json', { paths: [dir] }))] }); } catch { fail('이 프로젝트에서 jest 를 찾지 못했습니다'); }
  const wrapper = path.join(job.tmp, `jest-${Date.now()}.config.cjs`);
  const JT = path.join(ASSETS, 'jest-transform.cjs');
  fs.writeFileSync(wrapper, `// kedovi trace: 기록할 때만 쓰는 감싼 Jest 설정 (프로젝트 설정은 그대로, 변환기만 감싼다)
const path = require('path');
const C = require(${JSON.stringify(jestConfig)});
const DIR = ${JSON.stringify(dir)};
module.exports = async () => {
  const init = C.readInitialOptions ? await C.readInitialOptions(undefined, { packageRootOrConfig: DIR }) : { config: {} };
  const { projectConfig } = await C.readConfig({ $0: 'jest', _: [] }, DIR);
  const transform = {};
  for (const [re, p, o] of projectConfig.transform || []) transform[re] = [${JSON.stringify(JT)}, { inner: p, innerConfig: o }];
  if (!Object.keys(transform).length) transform['\\.[cm]?[jt]sx?$'] = [${JSON.stringify(JT)}, { inner: require.resolve('babel-jest', { paths: [DIR] }), innerConfig: {} }];
  const cfg = { ...(init.config || {}) };
  delete cfg.projects;
  return { ...cfg, rootDir: projectConfig.rootDir, transform, cache: false, setupFilesAfterEnv: [...(projectConfig.setupFilesAfterEnv || []), ${JSON.stringify(path.join(ASSETS, 'jest-setup.cjs'))}] };
};
`);
  const logFile = path.join(job.tmp, `${Date.now()}.run.log`);
  const args = [jestBin, '--config', wrapper, '--runInBand', '--runTestsByPath', path.resolve(dir, job.spec), ...(job.grep ? ['-t', job.grep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')] : [])];
  process.stdout.write(`… jest ${job.spec}${job.grep ? ` -t "${job.grep}"` : ''}\n`);
  const env = { ...process.env, KEDOVI_TRACE_ROOT: dir, KEDOVI_TRACE_TS: job.ts, KEDOVI_TRACE_RAW: job.raw, KEDOVI_TRACE_OPTS: JSON.stringify({ maxSteps: job.maxSteps, maxHits: job.maxHits }) };
  const r = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', timeout: job.timeout * 1000 });
  fs.writeFileSync(logFile, `${r.stdout || ''}${r.stderr || ''}`);
  try { fs.unlinkSync(wrapper); } catch { /* 없음 */ }
  const notes = [];
  if (r.status !== 0) notes.push(`테스트가 실패했습니다 (종료 코드 ${r.status}). 기록은 실패 지점까지`);
  let trace = null;
  try { trace = JSON.parse(fs.readFileSync(job.raw, 'utf8')); } catch { fail(`기록이 없습니다 (테스트 이름 · 파일 확인)\n${tail(logFile)}`); }
  notes.push(...(trace.notes || []));
  trace.notes = [];
  if (!trace.steps.length) notes.push('프로젝트 코드가 불리지 않았습니다 (테스트 이름 확인)');
  finish(ROOT, { title: opts.title || title, mode: 'test', entry, tool: 'jest', lang: 'js', repo: path.basename(dir), include: [path.basename(dir)], at: new Date().toISOString(), request: null, response: null, notes, log: tail(logFile, 40) }, trace, mapSources(dir, trace), String(title).replace(/[^\w-]+/g, '-'));
  try { fs.unlinkSync(job.raw); } catch { /* 없음 */ }
  return undefined;
}

/** Next.js 로컬 요청: 계측한 Next 개발 서버를 이 킷이 띄우고 요청 한 번 (API 라우트 · 서버 액션 · 페이지). 주소의 포트는 쓰지 않는다 */
async function runNextRequest(opts, ROOT, dir, job, h) {
  const { fail, finish, tail, freePort } = h;
  const req = h.parseRequest(opts.request);
  const headers = {};
  for (const x of opts.headers || []) { const i = x.indexOf(':'); if (i > 0) headers[x.slice(0, i).trim()] = x.slice(i + 1).trim(); }
  if (opts.data && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = /^\s*[[{]/.test(opts.data) ? 'application/json' : 'text/plain';
  job.mode = 'next-request';
  job.port = await freePort();
  job.request = { method: req.method, path: `${req.u.pathname}${req.u.search}`, headers, body: opts.data || null };
  const logFile = path.join(job.tmp, `${Date.now()}.run.log`);
  const log = fs.createWriteStream(logFile);
  const child = spawn(process.execPath, [path.join(ASSETS, 'runner.mjs')], { cwd: dir, env: { ...process.env, KEDOVI_TRACE_JOB: JSON.stringify(job) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { log.write(d); for (const l of d.toString().split('\n')) if (/^(…|  ·)/.test(l)) process.stdout.write(`${l}\n`); });
  child.stderr.on('data', (d) => log.write(d));
  const timer = setTimeout(() => child.kill('SIGTERM'), (job.timeout + 60) * 1000);
  const code = await new Promise((r) => child.on('exit', r));
  clearTimeout(timer);
  log.end();
  let res = null;
  try { res = JSON.parse(fs.readFileSync(job.out, 'utf8')); } catch { /* 없음 */ }
  if (!res || res.error) fail(`${res && res.error ? res.error : `기록하지 못했습니다 (종료 코드 ${code})`}\n${tail(logFile)}`);
  const trace = res.trace;
  const notes = [...(res.notes || [])];
  if (!trace.steps.length) notes.push('요청이 프로젝트 코드를 타지 않았습니다 (경로 확인)');
  finish(ROOT, { title: opts.title || `${req.method} ${req.u.pathname}`, mode: 'request', entry: null, tool: 'next dev (kedovi)', lang: 'js', repo: path.basename(dir), include: [path.basename(dir)], at: new Date().toISOString(), request: { method: req.method, url: req.url, body: opts.data || null }, response: res.response || null, notes, log: tail(logFile, 40) }, trace, mapSources(dir, trace), `${req.method}-${req.u.pathname}`);
  for (const f of [job.out, job.raw]) { try { fs.unlinkSync(f); } catch { /* 없음 */ } }
  return undefined;
}

/** 서버 실행 명령: --serve 또는 package.json 스크립트 (start · serve · dev) */
function serveCommand(dir, opts) {
  if (opts.serve) return { cmd: opts.serve, label: opts.serve };
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { /* 없음 */ }
  const sc = pkg.scripts || {};
  const name = ['start', 'serve', 'dev', 'start:dev'].find((n) => sc[n] && !/\b(vite|next|webpack|react-scripts)\b/.test(sc[n]));
  return name ? { cmd: `npm run ${name}`, label: `npm run ${name} (${sc[name]})` } : null;
}

/** Node 서버: node --import register.mjs 로 띄우고, 요청 한 번 동안만 기록 (SIGUSR2 로 켜고 끔) */
async function runServer(opts, ROOT, dir, job, h) {
  const { fail, finish, tail, waitPort, request, killGroup } = h;
  const req = h.parseRequest(opts.request);
  const port = Number(req.u.port || 80);
  const sv = serveCommand(dir, opts);
  if (!sv) fail('서버 실행 명령을 찾지 못했습니다. --serve "node dist/main.js" 처럼 주세요');
  if (/\b(watch|--watch|nodemon)\b/.test(sv.cmd)) process.stdout.write('  ⚠ 감시 모드(watch) 명령입니다. 파일이 바뀌면 서버가 다시 떠 기록이 끊길 수 있습니다\n');
  const reg = require('url').pathToFileURL(path.join(ASSETS, 'register.mjs')).href;
  const env = { ...process.env, PORT: String(port), NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${reg}`.trim(), KEDOVI_TRACE_ROOT: dir, KEDOVI_TRACE_TS: job.ts, KEDOVI_TRACE_RAW: job.raw, KEDOVI_TRACE_OPTS: JSON.stringify({ maxSteps: job.maxSteps, maxHits: job.maxHits }) };
  const logFile = path.join(job.tmp, `${Date.now()}.run.log`);
  const log = fs.openSync(logFile, 'w');
  process.stdout.write(`… 서버 실행: ${sv.label} (로그 ${path.relative(ROOT, logFile)})\n`);
  const child = spawn(sv.cmd, { cwd: dir, env, shell: true, detached: true, stdio: ['ignore', log, log] });
  const died = new Promise((r) => child.once('exit', () => r('exit')));
  const up = await Promise.race([waitPort(req.u.hostname.replace(/^\[|\]$/g, ''), port, job.timeout * 1000), died]);
  if (up !== true) { killGroup(child); fail(`서버가 ${up === 'exit' ? '시작하다 끝났습니다' : '열리지 않았습니다'}.\n${tail(logFile)}`); }
  const pids = () => { try { return fs.readdirSync(`${job.raw}.pids`).map(Number).filter((p) => { try { process.kill(p, 0); return true; } catch { return false; } }); } catch { return []; } };
  const signal = () => { for (const p of pids()) { try { process.kill(p, 'SIGUSR2'); } catch { /* 끝남 */ } } };
  if (!pids().length) { killGroup(child); fail(`서버 프로세스에 기록기가 올라가지 않았습니다 (Node 22.15 이상 · NODE_OPTIONS 를 지우는 실행기인지 확인).\n${tail(logFile)}`); }
  signal();
  await new Promise((r) => setTimeout(r, 200));
  process.stdout.write(`… ${req.method} ${req.url}\n`);
  const headers = {};
  for (const x of opts.headers || []) { const i = x.indexOf(':'); if (i > 0) headers[x.slice(0, i).trim()] = x.slice(i + 1).trim(); }
  if (opts.data && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = /^\s*[[{]/.test(opts.data) ? 'application/json' : 'text/plain';
  const response = await request(req.method, req.url, headers, opts.data);
  await new Promise((r) => setTimeout(r, 300));
  signal();
  const want = pids();
  for (let i = 0; i < 50; i += 1) { if (want.every((p) => fs.existsSync(`${job.raw}.${p}.json`))) break; await new Promise((r) => setTimeout(r, 100)); }
  killGroup(child);
  const dumps = [];
  for (const p of want) { try { const d = JSON.parse(fs.readFileSync(`${job.raw}.${p}.json`, 'utf8')); if (d.steps.length) dumps.push(d); fs.unlinkSync(`${job.raw}.${p}.json`); } catch { /* 없음 */ } }
  try { fs.rmSync(`${job.raw}.pids`, { recursive: true, force: true }); } catch { /* 없음 */ }
  const trace = mergeDumps(dumps, job.maxHits);
  const notes = [...trace.notes];
  trace.notes = [];
  if (!trace.steps.length) notes.push('요청이 프로젝트 코드를 타지 않았습니다 (경로 · 포트 확인)');
  finish(ROOT, { title: opts.title || `${req.method} ${req.u.pathname}`, mode: 'request', entry: null, tool: sv.label, lang: 'js', repo: path.basename(dir), include: [path.basename(dir)], at: new Date().toISOString(), request: { method: req.method, url: req.url, body: opts.data || null }, response, notes, log: tail(logFile, 40) }, trace, mapSources(dir, trace), `${req.method}-${req.u.pathname}`);
  return undefined;
}

module.exports = { run, webFramework, tsPath, parseTest, isPlaywrightTest, pwConfig, mapSources, testRunner, mergeDumps, serveCommand };
