// ops.js · assets/ops 점검: 템플릿 넣기(값 치환 · 실행 권한 · 덮지 않음) · bash 문법 · preflight 판정(가짜 docker). 실행: node ops.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ops = require('./ops');

const ASSETS = path.join(__dirname, '..', 'assets', 'ops');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-ops-'));

// 모든 파일이 KINDS 에 들어 있고, 스크립트는 bash 문법이 맞다
{
  const listed = Object.values(ops.KINDS).flatMap((k) => k.files).sort();
  assert.deepStrictEqual(fs.readdirSync(ASSETS).sort(), listed, 'assets/ops 의 파일 = KINDS 의 파일');
  for (const f of listed.filter((x) => x.endsWith('.sh'))) {
    const r = spawnSync('bash', ['-n', path.join(ASSETS, f)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${f} 문법: ${r.stderr}`);
  }
  // 장식 대시 금지 (화면 문구)
  for (const f of listed) assert.ok(!fs.readFileSync(path.join(ASSETS, f), 'utf8').includes('—'), `${f} 에 장식 대시`);
}

// 대상 repo 고르기 · 값
{
  const repoA = path.join(tmp, 'a'); const repoB = path.join(tmp, 'b');
  fs.mkdirSync(path.join(repoA, 'deploy'), { recursive: true }); fs.mkdirSync(repoB, { recursive: true });
  fs.writeFileSync(path.join(repoA, 'deploy', 'compose.yml'), 'services: {}\n');
  const ws = { repos: [{ name: 'a', dir: repoA }, { name: 'b', dir: repoB }, { name: 'docs', kind: 'docs', dir: tmp }], vars: { 'branch.release': 'main-release', ops: { metricsPrefix: 'svc_life' } } };
  assert.throws(() => ops.target(ws, {}), /compose 파일.*없습니다/, '루트에 compose 가 없으면 고르지 못한다');
  assert.strictEqual(ops.target(ws, { dir: 'deploy' }).repo.name, 'a', '--dir 폴더에 compose 가 있는 repo');
  assert.throws(() => ops.target(ws, { repo: 'nope' }), /'nope'/);
  assert.strictEqual(ops.target(null, { dir: repoA }).base, repoA, '절대 경로 --dir 은 워크스페이스 없이');
  const v = ops.values(ws, {});
  assert.deepStrictEqual(v, { opsDir: 'ops', prefix: 'svc_life', releaseBranch: 'main-release' });
  assert.throws(() => ops.values(ws, { prefix: 'bad-name' }), /지표 이름/);
  assert.throws(() => ops.values({ vars: { 'ops.dir': '../x' } }, {}), /상대 경로/);

  // 넣기: 값 치환 · 실행 권한 · 있는 파일은 덮지 않음
  const t = ops.target(ws, { repo: 'a', dir: 'deploy' });
  const items = ops.plan(['lifecycle', 'alerts', 'preflight'], t, v);
  assert.deepStrictEqual(items.map((x) => x.to), ['deploy/ops/lifecycle-test.sh', 'deploy/ops/lifecycle.gitlab-ci.yml', 'deploy/ops/container-metrics.sh', 'deploy/ops/container-lifecycle.rules.yml', 'deploy/ops/preflight.sh', 'deploy/ops/preflight.conf']);
  for (const it of items) assert.ok(!/__[A-Z_]+__/.test(it.content), `${it.to} 에 치환 안 된 값`);
  const ci = items.find((x) => x.to.endsWith('.gitlab-ci.yml')).content;
  assert.match(ci, /\$CI_COMMIT_BRANCH == "main-release"/);
  assert.match(ci, /bash deploy\/ops\/lifecycle-test\.sh/);
  assert.match(items.find((x) => x.to.endsWith('rules.yml')).content, /svc_life_memory_anon_bytes/);
  assert.match(items.find((x) => x.to.endsWith('container-metrics.sh')).content, /PREFIX="\$\{PREFIX:-svc_life\}"/);
  fs.mkdirSync(path.join(repoA, 'deploy', 'ops'), { recursive: true });
  fs.writeFileSync(path.join(repoA, 'deploy', 'ops', 'preflight.conf'), 'MINE=1\n');
  ops.write(ops.plan(['lifecycle', 'alerts', 'preflight'], t, v));
  assert.strictEqual(fs.readFileSync(path.join(repoA, 'deploy', 'ops', 'preflight.conf'), 'utf8'), 'MINE=1\n', '있는 파일은 덮지 않는다');
  assert.ok(fs.statSync(path.join(repoA, 'deploy', 'ops', 'preflight.sh')).mode & 0o100, '.sh 는 실행 권한');
  assert.ok(!(fs.statSync(path.join(repoA, 'deploy', 'ops', 'container-lifecycle.rules.yml')).mode & 0o100));
}

// preflight 판정: 가짜 docker (설정 해시 · 컨테이너 · 이미지) + 파일로 흉내 낸 배치 조회
{
  const bin = path.join(tmp, 'bin'); const dep = path.join(tmp, 'dep');
  fs.mkdirSync(bin); fs.mkdirSync(path.join(dep, 'ops'), { recursive: true });
  fs.writeFileSync(path.join(dep, 'compose.yml'), 'services: {}\n');
  // 서비스 api(설정 바뀜) · web(그대로) · batch(같은 태그 새 이미지)
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
case "$*" in
  "compose config -q") exit 0 ;;
  "compose config --services") printf 'api\\nweb\\nbatch\\n' ;;
  "compose config --hash=*") printf 'api h-api-new\\nweb h-web\\nbatch h-batch\\n' ;;
  "compose ps -aq "*) echo "c-\${@: -1}" ;;
  "inspect -f "*) case "\${@: -1}" in c-api) echo 'h-api-old|sha:1|app/api:1|running' ;; c-web) echo 'h-web|sha:2|app/web:1|running' ;; c-batch) echo 'h-batch|sha:3|app/batch:1|running' ;; esac ;;
  "image inspect -f "*) case "\${@: -1}" in app/batch:1) echo 'sha:9' ;; app/api:1) echo 'sha:1' ;; *) echo 'sha:2' ;; esac ;;
  *) echo "가짜 docker: 모르는 호출 $*" >&2; exit 1 ;;
esac
`, { mode: 0o755 });
  const rows = path.join(tmp, 'rows');
  const conf = (extra) => { const p = path.join(dep, 'ops', 'preflight.conf'); fs.writeFileSync(p, `WAIT_MAX=3\nPOLL_SEC=1\nBATCH_QUERY='cat ${rows}'\nMINUTE_JOBS='^MINUTE_'\nSTATES='\napi|block|세션이 사라진다\nbatch|warn|도는 작업이 끊긴다\n'\n${extra || ''}`); return p; };
  const run = (args, env) => spawnSync('bash', [path.join(ASSETS, 'preflight.sh'), ...args], { cwd: dep, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env, PREFLIGHT_CONF: (env && env.PREFLIGHT_CONF) || conf() } });

  fs.writeFileSync(rows, '');
  let r = run(['web']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /web: 그대로/); assert.match(r.stdout, /바뀌는 컨테이너가 없어 건너뜀/); assert.match(r.stdout, /통과/);

  r = run(['api']);
  assert.strictEqual(r.status, 1, '설정이 바뀐 block 서비스는 멈춘다');
  assert.match(r.stdout, /api: 재생성\(설정 변경\): 세션이 사라진다 \[멈춤\]/);
  assert.match(run(['api'], { PREFLIGHT_FORCE: '1' }).stdout, /강제 진행/);
  assert.strictEqual(run(['--force', 'api']).status, 0);

  r = run(['batch']);
  assert.strictEqual(r.status, 0, r.stdout);
  assert.match(r.stdout, /batch: 재생성\(이미지 변경: app\/batch:1\): 도는 작업이 끊긴다/);
  assert.match(r.stdout, /도는 배치 0/);

  fs.writeFileSync(rows, '7|DAILY_SETTLE|STARTED|10:00:00\n');
  r = run(['batch']);
  assert.strictEqual(r.status, 1); assert.match(r.stdout, /분 주기가 아닌 배치가 돈다/);

  fs.writeFileSync(rows, '8|MINUTE_SYNC|STARTED|10:37:00\n');
  r = run(['batch']);
  assert.strictEqual(r.status, 1, '틈이 안 오면 멈춘다'); assert.match(r.stdout, /\(분 주기\)/); assert.match(r.stdout, /3초 안에 틈이 없음/);

  // 틈이 오면 진행하고 -- 뒤 명령을 바로 실행한다
  fs.writeFileSync(rows, '9|MINUTE_SYNC|STARTED|10:38:00\n');
  const done = path.join(tmp, 'ran');
  r = spawnSync('bash', ['-c', `(sleep 1; : > ${rows}) & bash ${path.join(ASSETS, 'preflight.sh')} batch -- touch ${done}; s=$?; wait; exit $s`], { cwd: dep, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PREFLIGHT_CONF: conf() } });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /틈: 도는 배치 0, 진행 \(\d초 기다림\)/);
  assert.ok(fs.existsSync(done), '통과 뒤 명령 실행');

  // 조회 실패 = 확인 못 함 → 멈춤. BATCH_SERVICES 밖이면 건너뜀
  r = run(['batch'], { PREFLIGHT_CONF: conf("BATCH_QUERY='exit 3'\n") });
  assert.strictEqual(r.status, 1); assert.match(r.stdout, /도는 배치를 확인하지 못함/);
  r = run(['batch'], { PREFLIGHT_CONF: conf("BATCH_QUERY='exit 3'\nBATCH_SERVICES='worker'\n") });
  assert.strictEqual(r.status, 0); assert.match(r.stdout, /배치 서비스\(worker\)가 없어 건너뜀/);
}

// 명령: 도움말 · 모르는 하위 명령
{
  assert.strictEqual(spawnSync(process.execPath, [path.join(__dirname, 'ops.js'), 'nope'], { encoding: 'utf8' }).status, 2);
  assert.match(spawnSync(process.execPath, [path.join(__dirname, 'ops.js'), '--help'], { encoding: 'utf8' }).stdout, /kedovi ops add lifecycle\|alerts\|preflight\|all/);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('ops.test.js ok');
