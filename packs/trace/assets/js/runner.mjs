// kedovi trace JS 실행기: 프로젝트의 Vite · Next.js · Vitest · Playwright 로 계측한 실행 한 번을 돌리고 기록을 모은다. kedovi trace run 이 띄운다 (cwd = 프로젝트)
/*
 * 설정은 환경 변수 KEDOVI_TRACE_JOB (JSON)
 *   { mode: 'web-steps' | 'web-pw' | 'web-manual' | 'vitest' | 'next-request', framework: 'vite' | 'next', root, ts, out, raw, maxSteps, maxHits,
 *     steps(문자열), spec, grep, project, pwConfig, tmp, timeout }
 * 결과: out 에 { trace, notes, response? } 를 쓴다
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const job = JSON.parse(process.env.KEDOVI_TRACE_JOB || '{}');
const root = path.resolve(job.root || process.cwd());
const req = createRequire(path.join(root, 'package.json'));
const notes = [];
const fromProject = async (name) => {
  let p;
  try { p = req.resolve(name); } catch { return null; }
  return import(pathToFileURL(p).href);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reEsc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // 테스트 이름 · 경로를 글자 그대로 (실행기들은 정규식으로 받는다)
process.once('SIGTERM', () => process.exit(143)); // 시간 초과로 끊겨도 exit 정리(Next.js 가 건드린 파일 되돌리기)가 돌게
const done = (trace, extra = {}) => { fs.writeFileSync(job.out, JSON.stringify({ trace, notes, ...extra })); };

/** 기록 묶음들 → 하나 (merge.cjs). 묶음의 알림은 이 실행의 알림으로 */
function merge(raw, extra = []) {
  const { merge: m } = req(path.join(HERE, 'merge.cjs'));
  const r = m([...(raw && raw.sessions || []), ...extra], job.maxHits || 30);
  for (const x of r.notes) if (!notes.includes(x)) notes.push(x);
  r.notes = [];
  return r;
}

/** Next.js: 프로젝트의 next 를 이 프로세스에서 띄운다 (화면 · 서버 코드 모두 기록). 처음 여는 경로를 미리 컴파일해 테스트 시간 초과를 피한다 */
async function nextServer(paths) {
  const { startNext } = req(path.join(HERE, 'next-dev.cjs'));
  const nx = await startNext({ root, port: job.port, ts: job.ts, out: job.raw, maxSteps: job.maxSteps, maxHits: job.maxHits });
  process.stdout.write(`… 계측한 Next.js 개발 서버 ${nx.url} (next ${nx.info.version} · ${nx.info.turbo ? 'Turbopack' : 'webpack'})\n`);
  for (const p of [...new Set(paths)].slice(0, 5)) {
    process.stdout.write(`… 미리 컴파일 ${p}\n`);
    try { await fetch(nx.url + p, { signal: AbortSignal.timeout(180000) }).then((r) => r.text()); } catch (e) { notes.push(`미리 열기 실패 ${p} (${e.message})`); }
  }
  nx.start();
  return { server: { close: () => nx.close() }, url: nx.url, next: nx };
}

/** 처음 여는 경로: 단계 목록의 goto · 테스트 파일의 page.goto('…') */
function firstPaths() {
  if (job.mode === 'next-request') return []; // 요청 하나만: 컴파일도 그 요청 안에서 (미리 열면 다른 코드가 돈다)
  if (job.mode === 'web-pw') {
    let text = '';
    try { text = fs.readFileSync(path.resolve(root, job.spec), 'utf8'); } catch { /* 없음 */ }
    const list = [...text.matchAll(/\.goto\(\s*['"`](\/[^'"`$]*)['"`]/g)].map((m) => m[1]);
    return list.length ? list : ['/'];
  }
  if (job.mode === 'web-steps') { const list = parseSteps(job.steps).filter((x) => /^(goto|open)$/.test(x.verb) && /^\//.test(x.args[0] || '')).map((x) => x.args[0]); return list.length ? list : ['/']; }
  return ['/'];
}

async function devServer() {
  if (job.framework === 'next') return nextServer(firstPaths());
  const vite = await fromProject('vite');
  if (!vite) throw new Error('이 프로젝트에서 vite 를 찾지 못했습니다 (npm install 을 먼저)');
  const plugin = (await import(pathToFileURL(path.join(HERE, 'vite-plugin.mjs')).href)).default({ root, ts: job.ts, out: job.raw, maxSteps: job.maxSteps, maxHits: job.maxHits });
  const server = await vite.createServer({ root, plugins: [plugin], server: { port: job.port, strictPort: true, host: '127.0.0.1', open: false }, clearScreen: false, logLevel: 'warn', optimizeDeps: { force: false } });
  await server.listen();
  const url = `http://127.0.0.1:${job.port}`;
  process.stdout.write(`… 계측한 개발 서버 ${url}\n`);
  return { server, url };
}

async function browser(headless = true) {
  const pw = await fromProject('@playwright/test') || await fromProject('playwright');
  if (!pw) throw new Error('이 프로젝트에서 Playwright 를 찾지 못했습니다 (npm i -D @playwright/test 뒤 npx playwright install chromium)');
  const chromium = pw.chromium || (pw.default && pw.default.chromium);
  try { return await chromium.launch({ headless }); } catch (e) { throw new Error(`브라우저를 띄우지 못했습니다. npx playwright install chromium 이 필요할 수 있습니다\n${e.message.split('\n')[0]}`); }
}

/** 단계 목록: goto /x · click <선택자> · fill <선택자> <글> · press <키> · select <선택자> <값> · check <선택자> · hover <선택자> · wait <ms|선택자> */
function parseSteps(text) {
  return String(text || '').split(/\n|;(?=\s*(?:goto|open|click|fill|type|press|select|check|uncheck|hover|wait)\b)/i).map((x) => x.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^(\w+)\s*(.*)$/);
    const verb = m[1].toLowerCase();
    let rest = m[2].trim();
    const args = [];
    while (rest) {
      const q = rest.match(/^"((?:[^"\\]|\\.)*)"\s*|^'((?:[^'\\]|\\.)*)'\s*/);
      if (q) { args.push(q[1] ?? q[2]); rest = rest.slice(q[0].length); continue; }
      // 선택자는 공백을 품을 수 있다: fill 은 마지막 낱말 앞까지, 나머지는 끝까지
      if (/^(fill|type|select)$/.test(verb) && args.length === 0) { const i = rest.lastIndexOf(' '); if (i > 0) { args.push(rest.slice(0, i).trim()); rest = rest.slice(i + 1); continue; } }
      args.push(rest); rest = '';
    }
    return { verb, args, line };
  });
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
  await sleep(250);
}

async function runSteps(url, headless) {
  const b = await browser(headless);
  const page = await b.newPage({ baseURL: url });
  page.on('pageerror', (e) => { if (notes.length < 20) notes.push(`화면 오류: ${e.message.split('\n')[0]}`); });
  const steps = parseSteps(job.steps);
  if (!steps.length || !/^(goto|open)$/.test(steps[0].verb)) steps.unshift({ verb: 'goto', args: ['/'], line: 'goto /' });
  for (const s of steps) {
    process.stdout.write(`  · ${s.line}\n`);
    const [a, b2] = s.args;
    try {
      if (s.verb === 'goto' || s.verb === 'open') await page.goto(a || '/');
      else if (s.verb === 'click') await page.locator(a).first().click({ timeout: 10000 });
      else if (s.verb === 'fill' || s.verb === 'type') await page.locator(a).first().fill(b2 ?? '', { timeout: 10000 });
      else if (s.verb === 'press') await (b2 ? page.locator(a).first().press(b2) : page.keyboard.press(a));
      else if (s.verb === 'select') await page.locator(a).first().selectOption(b2);
      else if (s.verb === 'check') await page.locator(a).first().check();
      else if (s.verb === 'uncheck') await page.locator(a).first().uncheck();
      else if (s.verb === 'hover') await page.locator(a).first().hover();
      else if (s.verb === 'wait') await (/^\d+$/.test(a) ? sleep(Number(a)) : page.locator(a).first().waitFor({ timeout: 15000 }));
      else notes.push(`모르는 단계: ${s.line}`);
    } catch (e) {
      notes.push(`단계 실패: ${s.line} (${e.message.split('\n')[0]})`);
      break;
    }
    await settle(page);
  }
  await page.evaluate(() => globalThis.__kedoviT && globalThis.__kedoviT.flush(false)).catch(() => {});
  await sleep(400);
  await b.close();
}

async function runManual(url) {
  const b = await browser(false);
  const page = await b.newPage();
  await page.goto(url);
  process.stdout.write(`\n브라우저에서 재현하세요. 다 했으면 이 터미널에서 Enter (상한 ${job.timeout || 900}초)\n`);
  await new Promise((resolve) => {
    const t = setTimeout(resolve, (job.timeout || 900) * 1000);
    process.stdin.resume();
    process.stdin.once('data', () => { clearTimeout(t); resolve(); });
  });
  await page.evaluate(() => globalThis.__kedoviT && globalThis.__kedoviT.flush(false)).catch(() => {});
  await sleep(400);
  await b.close();
  process.stdin.pause();
}

/** 기존 Playwright 테스트: 사용자 설정을 감싸 주소만 계측 서버로 (webServer 끔 · 한 번에 하나) */
async function runPlaywrightTest(url) {
  const cfg = job.pwConfig ? path.resolve(root, job.pwConfig) : null;
  const dir = cfg ? path.dirname(cfg) : root;
  const wrapper = path.join(job.tmp, `pw-${Date.now()}.config.ts`);
  const imp = cfg ? `import base from ${JSON.stringify(cfg.replace(/\.(ts|mts|js|mjs|cjs)$/, ''))};` : 'const base: any = {};';
  fs.writeFileSync(wrapper, `// kedovi trace: 기록할 때만 쓰는 감싼 설정 (프로젝트 설정은 그대로)
${imp}
import path from 'node:path';
const b: any = (base as any) || {};
const url = ${JSON.stringify(url)};
const use = (u: any) => ({ ...(u || {}), baseURL: url, trace: 'off', video: 'off' });
const abs = (p: any, d: string) => (p ? path.resolve(${JSON.stringify(dir)}, p) : d);
export default {
  ...b,
  testDir: abs(b.testDir, ${JSON.stringify(dir)}),
  outputDir: ${JSON.stringify(path.join(job.tmp, 'pw-out'))},
  snapshotDir: b.snapshotDir ? abs(b.snapshotDir, '') : undefined,
  webServer: undefined,
  globalSetup: b.globalSetup ? abs(b.globalSetup, '') : undefined,
  globalTeardown: b.globalTeardown ? abs(b.globalTeardown, '') : undefined,
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: 'line',
  use: use(b.use),
  projects: b.projects ? b.projects.map((p: any) => ({ ...p, use: use(p.use) })) : undefined,
};
`);
  let cli;
  try { cli = req.resolve('@playwright/test/cli'); } catch { try { cli = req.resolve('playwright/cli'); } catch { throw new Error('이 프로젝트에서 Playwright 를 찾지 못했습니다'); } }
  const args = [cli, 'test', '-c', wrapper, reEsc(path.resolve(root, job.spec))];
  if (job.grep) args.push('-g', reEsc(job.grep));
  if (job.project) args.push('--project', job.project);
  process.stdout.write(`… playwright test ${job.spec}${job.grep ? ` -g "${job.grep}"` : ''}\n`);
  const code = await new Promise((resolve) => {
    const c = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '' } });
    let log = '';
    c.stdout.on('data', (d) => { log += d; });
    c.stderr.on('data', (d) => { log += d; });
    c.on('exit', (x) => { fs.writeFileSync(path.join(job.tmp, 'pw.log'), log); resolve(x); });
  });
  if (code !== 0) notes.push(`Playwright 테스트가 실패했습니다 (종료 코드 ${code}). 기록은 실패 지점까지. 로그: ${path.join(job.tmp, 'pw.log')}`);
  await sleep(700); // 마지막 조각
  try { fs.unlinkSync(wrapper); } catch { /* 없음 */ }
}

/** Next.js 로컬 요청 한 번 (kedovi trace run --request) */
async function sendRequest(url) {
  const r = job.request;
  process.stdout.write(`… ${r.method} ${r.path}\n`);
  try {
    const res = await fetch(url + r.path, { method: r.method, headers: r.headers, body: r.body || undefined, redirect: 'manual', signal: AbortSignal.timeout((job.timeout || 900) * 1000) });
    const body = (await res.text()).slice(0, 20000);
    await sleep(300);
    return { status: res.status, headers: Object.fromEntries(res.headers), body };
  } catch (e) { return { status: 0, error: e.message }; }
}

async function runVitest() {
  const vn = await fromProject('vitest/node');
  if (!vn) throw new Error('이 프로젝트에서 vitest 를 찾지 못했습니다');
  const plugin = (await import(pathToFileURL(path.join(HERE, 'vite-plugin.mjs')).href)).default({ root, ts: job.ts, maxSteps: job.maxSteps, maxHits: job.maxHits });
  const setup = path.join(HERE, 'vitest-setup.mjs');
  plugin.config = (c) => { c.test = c.test || {}; c.test.setupFiles = [...[].concat(c.test.setupFiles || []), setup]; };
  process.env.KEDOVI_TRACE_RAW = job.raw;
  process.env.KEDOVI_TRACE_OPTS = JSON.stringify({ maxSteps: job.maxSteps, maxHits: job.maxHits });
  const v = await vn.startVitest('test', [job.spec], { run: true, watch: false, testNamePattern: job.grep ? reEsc(job.grep) : undefined, fileParallelism: false, reporters: ['dot'] }, { plugins: [plugin], root });
  const failed = v && v.state && v.state.getCountOfFailedTests ? v.state.getCountOfFailedTests() : 0;
  if (failed) notes.push(`테스트 ${failed}개가 실패했습니다. 기록은 실패 지점까지`);
  await (v && v.close && v.close());
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(job.raw, 'utf8')); } catch { notes.push('기록이 없습니다 (테스트 이름 · 파일 확인)'); }
  return raw || { version: 1, lang: 'js', steps: [], notes: [] };
}

(async () => {
  try {
    if (job.mode === 'vitest') { const t = await runVitest(); for (const n of t.notes || []) notes.push(n); t.notes = []; done(t); process.exit(0); }
    const { server, url, next } = await devServer();
    let serverDump = null;
    let response = null;
    try {
      if (job.mode === 'next-request') response = await sendRequest(url);
      else if (job.mode === 'web-pw') await runPlaywrightTest(url);
      else if (job.mode === 'web-manual') await runManual(url);
      else await runSteps(url, job.headed !== true);
    } finally {
      if (next) serverDump = next.dump();
      await server.close();
    }
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(job.raw, 'utf8')); } catch { /* 없음 */ }
    if (!raw && !(serverDump && serverDump.steps.length)) notes.push('브라우저 기록이 오지 않았습니다 (화면이 열리지 않았거나 프로젝트 코드가 불리지 않음)');
    const extra = serverDump ? [{ sid: 'server', page: '(서버)', epoch: serverDump.epoch, notes: serverDump.notes, truncated: serverDump.truncated, steps: serverDump.steps }] : [];
    done(merge(raw, extra), response ? { response } : {});
    process.exit(0);
  } catch (e) {
    fs.writeFileSync(job.out, JSON.stringify({ error: e.message }));
    process.exit(1);
  }
})();
