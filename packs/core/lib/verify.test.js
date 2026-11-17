// 검증 2단 (lib/verify.js) · 무거운 시험 순번 (lib/heavy.js · bin/heavy.js) · 작업 리더 진행판 (bin/lead-board.js) 시험
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const V = require('./verify');
const H = require('./heavy');

// 1. 글롭: 폴더 이름 = 그 아래 전부 · ** 여러 단계 · * 한 단계
{
  const t = (g, f) => V.globRe(g).test(f);
  assert.ok(t('installer', 'installer/a/b.sh') && !t('installer', 'installer2/a.sh'));
  assert.ok(t('docs/', 'docs/x.md') && t('**/*.md', 'README.md') && t('**/*.md', 'a/b/c.md'));
  assert.ok(t('src/*.ts', 'src/a.ts') && !t('src/*.ts', 'src/a/b.ts'));
  assert.ok(t('src/**/db/*.sql', 'src/db/1.sql') && t('src/**/db/*.sql', 'src/x/y/db/1.sql'));
  assert.ok(t('docker-compose.yml', 'docker-compose.yml'));
}

// 2. 바뀐 파일 → 영역 시험 (명령마다 한 번, 대응표에 없는 파일은 따로)
{
  const areas = V.settings({ vars: { verify: { areaMap: { installer: 'make test-install', 'upgrade/**': ['make test-upgrade', 'make test-install'] } } } }).areas;
  const p = V.plan(['installer/a.sh', 'upgrade/x/y.sql', 'README.md'], areas);
  assert.deepStrictEqual(p.cmds.map((c) => [c.cmd, c.files.length]), [['make test-install', 2], ['make test-upgrade', 1]]);
  assert.deepStrictEqual(p.unmatched, ['README.md']);
  assert.strictEqual(V.settings({ vars: { verify: { fullSuite: 'nope' } } }).fullSuite, 'release');
  assert.strictEqual(V.settings({ vars: { verify: { fullSuite: 'release', fullCmd: 'a' } } }, { verify: { fullSuite: 'per-item' } }).fullSuite, 'per-item');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-verify-'));
try {
  // 3. 전체 시험 기록: 같은 커밋 = 통과 · 뒤에 커밋이 생기면 낡음 · 같은 트리면 통과
  const repo = path.join(tmp, 'app');
  fs.mkdirSync(repo);
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'maintenance.auto', 'false'); g('config', 'gc.auto', '0');
  fs.writeFileSync(path.join(repo, 'a.txt'), '1');
  g('add', '-A'); g('commit', '-qm', 'one');
  fs.writeFileSync(path.join(repo, 'b.txt'), '2');
  g('add', '-A'); g('commit', '-qm', 'two');
  assert.deepStrictEqual(V.changed(repo).files, ['b.txt']); // upstream 없으면 HEAD~1 기준
  fs.writeFileSync(path.join(repo, 'c.txt'), 'new');
  assert.deepStrictEqual(V.changed(repo).files, ['b.txt', 'c.txt']); // 새 파일도
  fs.rmSync(path.join(repo, 'c.txt'));
  assert.strictEqual(V.fullState(tmp, 'app', repo).ok, false);
  assert.match(V.fullLine(V.fullState(tmp, 'app', repo), 'app'), /기록 없음/);
  V.record(tmp, 'app', { sha: g('rev-parse', 'HEAD'), tree: g('rev-parse', 'HEAD^{tree}') });
  assert.strictEqual(V.fullState(tmp, 'app', repo).ok, true);
  fs.writeFileSync(path.join(repo, 'd.txt'), '3');
  g('add', '-A'); g('commit', '-qm', 'three');
  const st = V.fullState(tmp, 'app', repo);
  assert.ok(!st.ok && st.behind === 1, JSON.stringify(st));
  assert.match(V.fullLine(st, 'app'), /낡음.*커밋 1개/);
  g('commit', '-q', '--allow-empty', '-m', 'empty'); // 트리는 그대로
  g('revert', '--no-edit', 'HEAD~1');
  assert.strictEqual(V.fullState(tmp, 'app', repo).ok, true, '같은 트리면 통과');

  // 4. 무거운 시험 줄: 하나씩 · 예상 시간 = 최근 성공 중앙값 · 죽은 자리는 버림
  const root = path.join(tmp, 'ws');
  fs.mkdirSync(root);
  H.addHistory(root, 'stack', 600000, true); H.addHistory(root, 'stack', 1200000, true); H.addHistory(root, 'stack', 60000, false); H.addHistory(root, 'stack', 900000, true);
  assert.strictEqual(H.expected(root, 'stack'), 900000);
  H.enter(root, { id: 'a', name: 'stack', pid: process.pid });
  H.enter(root, { id: 'b', name: 'stack', pid: process.pid });
  H.enter(root, { id: 'dead', name: 'stack', pid: 999999 });
  assert.deepStrictEqual(H.tryStart(root, 'b', 1), { started: false, ahead: 1 });
  assert.deepStrictEqual(H.tryStart(root, 'a', 1), { started: true, ahead: 0 });
  const s = H.status(root, 1);
  assert.deepStrictEqual(s.map((x) => x.id), ['a', 'b'], '죽은 프로세스 자리는 버린다');
  assert.ok(s[1].startAt >= s[0].endAt - 5 && s[1].endAt - s[1].startAt === 900000, JSON.stringify(s));
  assert.match(H.lines(root, 1).join('\n'), /▶ stack[\s\S]*⏳ stack · 기다린 지 .* 예상 시작/);
  H.leave(root, 'a');
  assert.deepStrictEqual(H.tryStart(root, 'b', 1), { started: true, ahead: 0 });
  H.leave(root, 'b');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 5. bin/heavy.js run: 두 명령이 겹치지 않는다 (워크스페이스 사본에서)
(async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-heavy-'));
  try {
    fs.mkdirSync(path.join(ws, 'packs', 'core'), { recursive: true });
    for (const d of ['bin', 'lib']) fs.cpSync(path.join(__dirname, '..', d), path.join(ws, 'packs', 'core', d), { recursive: true });
    fs.writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ project: { name: 'x' }, repos: [], packs: ['core'] }));
    const log = path.join(ws, 'log.txt');
    const job = (n) => new Promise((resolve) => {
      const c = spawn(process.execPath, [path.join(ws, 'packs', 'core', 'bin', 'heavy.js'), 'run', '--name', 'stack', '--dir', ws, '--', `echo start${n} >> log.txt; sleep 1; echo end${n} >> log.txt`], { cwd: ws, stdio: 'ignore' });
      c.on('exit', resolve);
    });
    const codes = await Promise.all([job(1), job(2)]);
    assert.deepStrictEqual(codes, [0, 0]);
    const l = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.ok(/^start(\d)$/.test(l[0]) && l[1] === `end${l[0].slice(5)}`, `겹침: ${l.join(' ')}`);
    assert.strictEqual(H.expected(ws, 'stack') > 0, true);

    // 6. 진행판: 단계 · 닫기 · 표
    const lb = (...a) => execFileSync(process.execPath, [path.join(ws, 'packs', 'core', 'bin', 'lead-board.js'), ...a], { cwd: ws, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    lb('step', '--unit', '주문 API', '--stage', '구현', '--done', '분석', '--next', '시험 ∥ 리뷰', '--eta', '15:30');
    lb('step', '--unit', '로그인', '--stage', '리뷰');
    lb('step', '--unit', '로그인', '--end', '완료', '--done', '리뷰 블로커 0');
    const b = lb('board');
    assert.match(b, /\| 주문 API \| 구현 \| 분석 \| 시험 ∥ 리뷰 \| 15:30 \| 방금 \|/);
    assert.match(b, /\| 로그인 \| 끝: 완료 \| 리뷰 블로커 0 \|/);
    const B = require(path.join(ws, 'packs', 'core', 'bin', 'lead-board.js'));
    assert.deepStrictEqual(B.units().filter((u) => !u.endedAt).map((u) => u.unit), ['주문 API']);
    assert.throws(() => lb('step', '--unit', 'x', '--stage', 'y', '--eta', '내일'), /HH:MM/);
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
  console.log('verify.test.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
