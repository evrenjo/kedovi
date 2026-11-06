// runner-watch.js 점검 (로컬 가짜 GitLab API · 가짜 알림 명령 · 가짜 docker): 디스크 · 대기열 · 작업 시간 급증 · 오래 도는 작업 경보,
// 알림 실패면 다음 주기에 다시 · 같은 경보는 한 번 · 해소 알림 · --dry-run · 캐시 상한(docker 정리 · 캐시 폴더) · add(설정 · plist · systemd, 토큰 없음). 실행: node runner-watch.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const TOKEN = 'glpat-test-runner-0001';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-runner-watch-'));
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const Q = { pending: 6 };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const scope = u.searchParams.get('scope[]');
  let body = [];
  if (req.headers['private-token'] !== TOKEN) { res.writeHead(401); return res.end('{}'); }
  if (u.pathname === '/api/v4/projects/5/jobs') {
    if (scope === 'pending') body = Array.from({ length: Q.pending }, (_, i) => ({ id: 900 + i, name: 'build', created_at: ago(20) }));
    if (scope === 'success') body = [{ id: 80, name: 'build', duration: 600, web_url: 'http://git.test/j/80' }, ...[100, 110, 120, 105, 115, 108].map((d, i) => ({ id: 70 - i, name: 'build', duration: d })), ...[60, 62, 58, 61, 59].map((d, i) => ({ id: 50 - i, name: 'test', duration: d }))];
    if (scope === 'running') body = [{ id: 81, name: 'test', started_at: ago(30), web_url: 'http://git.test/j/81' }];
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
});

function run(args, env = {}) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(__dirname, 'runner-watch.js'), ...args], { cwd: tmp, env: { ...process.env, GITLAB_TOKEN: TOKEN, KEDOVI_CONFIG_DIR: path.join(tmp, 'config'), KEDOVI_SECRETS_BACKEND: 'file', ...env } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
}

server.listen(0, '127.0.0.1', async () => {
  try {
    const port = server.address().port;
    // 가짜 알림: 표시 파일이 있으면 실패(끝 코드 2), 받은 내용은 쌓아 둔다
    const inbox = path.join(tmp, 'inbox.txt');
    const failFlag = path.join(tmp, 'fail');
    const fake = path.join(tmp, 'fake-notify.js');
    fs.writeFileSync(fake, `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(require('fs').existsSync(${JSON.stringify(failFlag)})){console.error('telegram 502');process.exit(2)}require('fs').appendFileSync(${JSON.stringify(inbox)},s+'\\n----\\n')})`);
    const cfgFile = path.join(tmp, 'rw', 'runner-watch.json');
    fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
    fs.writeFileSync(cfgFile, JSON.stringify({
      name: 'demo',
      gitlab: { host: `127.0.0.1:${port}`, apiBase: `http://127.0.0.1:${port}/api/v4`, projects: [5] },
      disk: { paths: [tmp], maxPct: 0 },
      cache: { docker: { prune: false } },
      notify: { cmd: [process.execPath, fake], repeatMin: 180 },
    }));
    const inboxText = () => (fs.existsSync(inbox) ? fs.readFileSync(inbox, 'utf8') : '');

    // --dry-run: 경보만 보이고 알림 · 상태 파일 없음
    let r = await run(['check', '--config', cfgFile, '--dry-run']);
    assert.ok(r.code === 0 && /경보 4개 \(dry-run/.test(r.out) && !inboxText() && !fs.existsSync(cfgFile.replace(/\.json$/, '.state.json')), r.out);
    assert.ok(/디스크 .* \d+% \(상한 0%/.test(r.out) && /대기열 project 5: pending 6개 · 가장 오래 20분/.test(r.out) && /작업 시간 급증 project 5 build: 10분 \(최근 중앙값 2분\)/.test(r.out) && /작업이 오래 돈다 project 5 test: 30분째/.test(r.out), r.out);

    // 알림 명령이 실패하면(끝 코드 2) 보내지 못한 알림으로 남기고, 다음 주기에 다시 보낸다
    fs.writeFileSync(failFlag, '');
    r = await run(['check', '--config', cfgFile]);
    assert.ok(r.code === 0 && /✖ 알림 실패, 다음 주기에 다시: 알림 명령 끝 코드 2: telegram 502/.test(r.out) && !inboxText(), r.out);
    r = await run(['status', '--config', cfgFile]);
    assert.ok(/보내지 못한 알림 1건/.test(r.out) && /지금 경보 4개/.test(r.out) && /마지막 알림 실패/.test(r.out), r.out);
    fs.rmSync(failFlag);
    r = await run(['check', '--config', cfgFile]);
    assert.ok(/알림 보냄 \(1건\)/.test(r.out), r.out);
    const first = inboxText();
    assert.ok((first.match(/## 러너 감시 demo/g) || []).length === 1 && /⚠ 대기열 project 5/.test(first) && !/계속:/.test(first), first);
    // 같은 경보는 repeatMin 안에 다시 알리지 않는다
    r = await run(['check', '--config', cfgFile]);
    assert.ok(!/알림 보냄/.test(r.out) && inboxText() === first, r.out);
    // 대기열이 풀리면 해소 알림
    Q.pending = 0;
    r = await run(['check', '--config', cfgFile]);
    assert.ok(/✔ 해소: 대기열 project 5/.test(inboxText().slice(first.length)) && /알림 보냄/.test(r.out), r.out);
    // 토큰이 없으면 대기열 · 작업 시간을 못 봤다고 경보 (조용히 넘어가지 않는다)
    r = await run(['check', '--config', cfgFile, '--dry-run', '--json'], { GITLAB_TOKEN: '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
    assert.ok(JSON.parse(r.out).alerts.some((x) => x.key === 'token'), r.out);

    // 캐시 상한: docker 빌드 캐시 · 회수 가능한 이미지가 상한을 넘으면 정리 (새 옵션이 안 되면 옛 옵션), dry-run 은 할 것만
    const W = require('./runner-watch.js');
    const calls = [];
    const docker = (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'system') return { status: 0, stdout: '{"Type":"Images","Size":"40GB","Reclaimable":"31.2GB (78%)"}\n{"Type":"Build Cache","Size":"25.5GB","Reclaimable":"25.5GB"}\n' };
      if (args.includes('--max-used-space')) return { status: 1, stderr: 'unknown flag: --max-used-space' };
      return { status: 0, stdout: '' };
    };
    const cfg = { cache: { docker: { prune: true, builderKeepGB: 20, imageUntilHours: 168 }, dirs: [], maxGB: 1, clean: false } };
    let c = W.cacheCheck(cfg, true, { docker });
    assert.ok(c.actions.length === 2 && c.actions.every((x) => /^\(dry-run\)/.test(x)) && calls.length === 1, JSON.stringify(c));
    c = W.cacheCheck(cfg, false, { docker });
    assert.ok(/빌드 캐시 25\.5GB → 20GB 로 정리/.test(c.actions[0]) && calls.includes('builder prune -f --keep-storage 20gb') && calls.includes('image prune -af --filter until=168h'), calls.join('\n'));
    // 러너 캐시 폴더: 상한을 넘으면 경보, clean 이면 오래된 항목부터 지운다
    const cache = path.join(tmp, 'cache');
    fs.mkdirSync(cache);
    for (const [n, t] of [['old', 1000], ['mid', 2000], ['new', 3000]]) { fs.writeFileSync(path.join(cache, n), 'x'); fs.utimesSync(path.join(cache, n), t, t); }
    const GBv = 1024 ** 3;
    const dirSize = (p) => (p === cache ? fs.readdirSync(cache).length * GBv : GBv);
    const cfg2 = { cache: { docker: { prune: false }, dirs: [cache], maxGB: 2, clean: false } };
    c = W.cacheCheck(cfg2, false, { dirSize });
    assert.ok(c.alerts.length === 1 && /3\.0GB \(상한 2GB, 자동 정리 꺼짐/.test(c.alerts[0].text) && fs.readdirSync(cache).length === 3, JSON.stringify(c));
    cfg2.cache.clean = true;
    c = W.cacheCheck(cfg2, false, { dirSize });
    assert.ok(!c.alerts.length && /오래된 항목 1개 지움/.test(c.actions[0]) && !fs.existsSync(path.join(cache, 'old')) && fs.existsSync(path.join(cache, 'new')), JSON.stringify(c));

    // add: 워크스페이스에서 설정 · launchd plist(600초) · systemd service/timer. 토큰은 파일에 없다. --repo 면 스크립트까지 복사해 혼자 돈다
    const ws = path.join(tmp, 'ws');
    fs.mkdirSync(path.join(ws, 'repos', 'infra'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ project: { name: 'shop' }, repos: [{ name: 'api', gitlab: { host: 'gitlab.example.com', projectId: 12 } }, { name: 'infra', gitlab: { host: 'gitlab.example.com', projectId: 13 } }] }));
    const addRun = (args) => new Promise((resolve) => {
      const ch = spawn(process.execPath, [path.join(__dirname, 'gitlab-mr.js'), 'runner-watch', 'add', ...args], { cwd: ws, env: { ...process.env, GITLAB_TOKEN: TOKEN, KEDOVI_CONFIG_DIR: path.join(tmp, 'config') } });
      let out = ''; ch.stdout.on('data', (d) => { out += d; }); ch.stderr.on('data', (d) => { out += d; }); ch.on('close', (code) => resolve({ code, out }));
    });
    r = await addRun(['--dry-run']);
    const dir = path.join(tmp, 'config', 'runner-watch', 'shop');
    assert.ok(r.code === 0 && /\[dry-run\] 만듦 runner-watch\.json/.test(r.out) && !fs.existsSync(dir), r.out);
    r = await addRun([]);
    assert.ok(r.code === 0 && /launchctl bootstrap gui/.test(r.out) && /systemctl --user enable --now kedovi-runner-watch-shop\.timer/.test(r.out), r.out);
    const conf = JSON.parse(fs.readFileSync(path.join(dir, 'runner-watch.json'), 'utf8'));
    assert.deepStrictEqual(conf.gitlab.projects, [12, 13]);
    const pl = fs.readFileSync(path.join(dir, 'com.kedovi.runner-watch.shop.plist'), 'utf8');
    assert.ok(/<key>StartInterval<\/key><integer>600<\/integer>/.test(pl) && pl.includes(path.join(__dirname, 'runner-watch.js')) && /<string>check<\/string>/.test(pl), pl);
    assert.ok(/OnUnitActiveSec=600/.test(fs.readFileSync(path.join(dir, 'kedovi-runner-watch-shop.timer'), 'utf8')));
    const all = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    assert.ok(!all.includes(TOKEN) && !/PRIVATE-TOKEN|GITLAB_TOKEN=/.test(all), '토큰은 파일에 없다');
    // 있는 설정은 덮지 않는다
    r = await addRun(['--interval', '300']);
    assert.ok(/= runner-watch\.json \(있음/.test(r.out) && /<integer>300<\/integer>/.test(fs.readFileSync(path.join(dir, 'com.kedovi.runner-watch.shop.plist'), 'utf8')), r.out);
    r = await addRun(['--repo', 'infra']);
    const sdir = path.join(ws, 'repos', 'infra', 'ops', 'runner-watch');
    assert.ok(r.code === 0 && fs.existsSync(path.join(sdir, 'runner-watch.js')) && /notify\.cmd/.test(r.out), r.out);
    const scfg = JSON.parse(fs.readFileSync(path.join(sdir, 'runner-watch.json'), 'utf8'));
    assert.ok(!scfg.workspace && scfg.gitlab.projects.join() === '12,13');
    console.log('runner-watch.test.js OK');
  } catch (e) {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
