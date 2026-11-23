// 무거운 시험 순번 (lib/heavy.js · bin/heavy.js) 시험: 설정 읽는 순서 · 코어당 부하 기준 · 오래 기다리면 시작 · 대기 중 기준 바꾸기 · status · mise 감싸기
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-heavy-')));
const ENV_KEYS = ['KEDOVI_HEAVY_SLOTS', 'KEDOVI_HEAVY_MAX_LOAD', 'KEDOVI_HEAVY_LOAD_WAIT_MIN'];
for (const k of ENV_KEYS) delete process.env[k];
try {
  const ws = path.join(tmp, 'ws');
  fs.mkdirSync(path.join(ws, 'packs', 'core'), { recursive: true });
  for (const d of ['bin', 'lib']) fs.cpSync(path.join(__dirname, '..', d), path.join(ws, 'packs', 'core', d), { recursive: true });
  fs.writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ project: { name: 'x' }, repos: [], packs: ['core'], vars: { verify: { heavySlots: 2, heavyMaxLoad: 0.9 } } }));
  const H = require(path.join(ws, 'packs', 'core', 'lib', 'heavy.js'));

  // 1. 설정: workspace.json → 환경 변수 → kedovi heavy set 순으로 덮는다
  assert.deepStrictEqual(H.settings(ws), { slots: 2, maxLoad: 0.9, loadWaitMin: 15 });
  process.env.KEDOVI_HEAVY_MAX_LOAD = '1.5';
  assert.strictEqual(H.settings(ws).maxLoad, 1.5);
  H.setOverride(ws, { maxLoad: 0.5, loadWaitMin: 1 });
  assert.deepStrictEqual(H.settings(ws), { slots: 2, maxLoad: 0.5, loadWaitMin: 1 });
  H.setOverride(ws, { maxLoad: null });
  assert.strictEqual(H.settings(ws).maxLoad, 1.5, '지우면 다음 값');
  delete process.env.KEDOVI_HEAVY_MAX_LOAD;

  // 2. 코어당 부하 기준: 넘으면 기다리고, 도는 것 없이 줄 맨 앞에서 loadWaitMin 을 기다리면 시작
  const busy = { load: 8, cores: 4, perCore: 2 };
  const cfg = { slots: 1, maxLoad: 1, loadWaitMin: 10 };
  H.enter(ws, { id: 'a', name: 'e2e', pid: process.pid });
  const t0 = Date.now();
  let r = H.tryStart(ws, 'a', cfg, t0, busy);
  assert.ok(!r.started && r.load && !r.load.forced, JSON.stringify(r));
  r = H.tryStart(ws, 'a', cfg, t0 + 9 * 60000, busy);
  assert.ok(!r.started, '아직 10분 전');
  assert.ok(H.lines(ws, cfg)[1].includes('부하 때문에'), H.lines(ws, cfg).join('\n'));
  r = H.tryStart(ws, 'a', cfg, t0 + 10 * 60000, busy);
  assert.ok(r.started && r.load.forced, '10분 기다리면 하나는 시작');
  H.enter(ws, { id: 'b', name: 'e2e', pid: process.pid });
  r = H.tryStart(ws, 'b', { ...cfg, slots: 2 }, t0 + 60 * 60000, busy);
  assert.ok(!r.started, '이미 도는 것이 있으면 부하가 높을 때 더 시작하지 않는다');
  assert.ok(H.tryStart(ws, 'b', { ...cfg, slots: 2 }, t0, { load: 2, cores: 4, perCore: 0.5 }).started, '부하가 낮으면 시작');
  assert.ok(!H.tryStart(ws, 'c', 1).started && H.tryStart(ws, 'c', 1).gone);
  H.leave(ws, 'a'); H.leave(ws, 'b');
  assert.ok(H.tryStart(ws, 'x', 1).gone);
  H.enter(ws, { id: 'n', name: 'n', pid: process.pid });
  assert.ok(H.tryStart(ws, 'n', 1).started, '숫자 slots (옛 호출) 는 부하를 보지 않는다');
  H.leave(ws, 'n');

  // 3. status: 사용법이 아니라 줄 · 부하 · 기준
  const tool = path.join(ws, 'packs', 'core', 'bin', 'heavy.js');
  const st = spawnSync(process.execPath, [tool, 'status'], { encoding: 'utf8', env: { ...process.env } });
  assert.strictEqual(st.status, 0);
  assert.match(st.stdout, /무거운 시험 줄: 비어 있음 \(동시 2개 · 부하 [\d.]+ · 코어 \d+개/);
  const js = JSON.parse(spawnSync(process.execPath, [tool, 'status', '--json'], { encoding: 'utf8' }).stdout);
  assert.strictEqual(js.settings.slots, 2);
  assert.ok(js.load.cores >= 1 && Array.isArray(js.queue));
  assert.strictEqual(spawnSync(process.execPath, [tool, 'set', '--slots', '0'], { encoding: 'utf8' }).status, 2);

  // 5. mise: 폴더에 mise 설정이 있고 mise 가 있을 때만 감싼다
  const { withMise, miseConfig } = require(tool);
  const repo = path.join(ws, 'repos', 'app');
  fs.mkdirSync(repo, { recursive: true });
  assert.strictEqual(miseConfig(repo), null);
  assert.deepStrictEqual(withMise(repo, ['pnpm', 'test'], false), { cmd: ['pnpm', 'test'], shell: false });
  fs.writeFileSync(path.join(repo, 'mise.toml'), '[tools]\nnode = "22"\n');
  assert.strictEqual(miseConfig(path.join(repo)), path.join(repo, 'mise.toml'));
  const hasMise = spawnSync('mise', ['--version'], { stdio: 'ignore' }).status === 0;
  const w = withMise(repo, 'pnpm test && pnpm lint', true);
  if (hasMise) assert.deepStrictEqual(w, { cmd: ['mise', 'exec', '--', 'sh', '-c', 'pnpm test && pnpm lint'], shell: false, mise: true });
  else assert.deepStrictEqual(w, { cmd: 'pnpm test && pnpm lint', shell: true });
  // 4. 기다리는 동안 기준을 바꾸면 다시 줄 서지 않고 따른다: 부하 기준을 아주 낮게 → 기다림 → set --max-load 0 → 시작
  H.setOverride(ws, { maxLoad: 0.000001, loadWaitMin: 0 });
  if (os.loadavg()[0] > 0) { // Windows 는 부하가 늘 0
    const child = spawn(process.execPath, [tool, 'run', '--name', 'w', '--no-mise', '--', process.execPath, '-e', 'process.exit(0)'], { cwd: ws });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const code = new Promise((res) => child.on('exit', res));
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    (async () => {
      for (let i = 0; i < 40 && !out.includes('부하 코어당'); i++) await sleep(200);
      assert.match(out, /부하 코어당/, out);
      assert.strictEqual(spawnSync(process.execPath, [tool, 'set', '--max-load', '0'], { encoding: 'utf8' }).status, 0);
      const c = await Promise.race([code, sleep(10000).then(() => 'timeout')]);
      assert.strictEqual(c, 0, `기준을 바꾸면 기다리던 작업이 시작한다: ${out}`);
      assert.match(out, /✔ w 통과/);
    })().catch((e) => { console.error(e); process.exitCode = 1; child.kill(); }).finally(finish);
  } else finish();
} catch (e) {
  fs.rmSync(tmp, { recursive: true, force: true });
  throw e;
}

function finish() {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!process.exitCode) console.log('heavy.test.js OK');
}
