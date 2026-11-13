// kedovi trace JS 실행기: 프로젝트의 Vite · Vitest · Playwright 로 계측한 실행 한 번을 돌리고 기록을 모은다. kedovi trace run 이 띄운다 (cwd = 프로젝트)
/*
 * 설정은 환경 변수 KEDOVI_TRACE_JOB (JSON)
 *   { mode: 'web-steps' | 'web-pw' | 'web-manual' | 'vitest', root, ts, out, raw, maxSteps, maxHits,
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
const done = (trace, extra = {}) => { fs.writeFileSync(job.out, JSON.stringify({ trace, notes, ...extra })); };

/** 브라우저 기록 묶음(페이지마다) → 단계 하나로 이어 붙이기 (번호 · 부모 · 호출 자리를 다시 매김) */
function merge(raw) {
  const sessions = (raw && raw.sessions || []).sort((a, b) => a.at - b.at);
  const steps = [];
  let cBase = 0;
  let truncated = false;
  for (const s of sessions) {
    const map = new Map();
    const list = s.steps.sort((a, b) => a.i - b.i);
    list.forEach((st, k) => map.set(st.i, steps.length + k));
    let maxC = 0;
    for (const st of list) {
      const n = { ...st, i: map.get(st.i), c: st.c + cBase };
      if (st.c > maxC) maxC = st.c;
      if (st.call) n.p = st.p >= 0 ? st.p + cBase : -1;
      if (st.site !== undefined) n.site = map.has(st.site) ? map.get(st.site) : -1;
      steps.push(n);
    }
    cBase += maxC + 1;
    truncated = truncated || s.truncated;
    for (const x of s.notes || []) if (!notes.includes(x)) notes.push(x);
  }
  return { version: 1, lang: 'js', startedAt: 0, endedAt: steps.length ? Math.max(...steps.map((x) => x.t || 0)) : 0, truncated, maxHits: job.maxHits || 30, notes: [], steps };
}

async function devServer() {
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
    const { server, url } = await devServer();
    try {
      if (job.mode === 'web-pw') await runPlaywrightTest(url);
      else if (job.mode === 'web-manual') await runManual(url);
      else await runSteps(url, job.headed !== true);
    } finally { await server.close(); }
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(job.raw, 'utf8')); } catch { /* 없음 */ }
    if (!raw) notes.push('브라우저 기록이 오지 않았습니다 (화면이 열리지 않았거나 프로젝트 코드가 불리지 않음)');
    done(merge(raw));
    process.exit(0);
  } catch (e) {
    fs.writeFileSync(job.out, JSON.stringify({ error: e.message }));
    process.exit(1);
  }
})();
