// 작업 폴더 훑기 (lib/worktrees.js) · kedovi worktree clean (bin/worktree.js) · repo 그룹 추천 (bin/kit.js suggestGroups) 시험
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const W = require('./worktrees');

// 1. 그룹 추천: 주소 경로 · 이름 앞부분
{
  const kit = require(path.join(__dirname, '..', '..', '..', 'bin', 'kit.js'));
  assert.deepStrictEqual(kit.remoteNamespace('https://h.example/team/dcim/dcim-api.git'), ['team', 'dcim']);
  assert.deepStrictEqual(kit.remoteNamespace('git@h.example:team/tool.git'), ['team']);
  assert.strictEqual(kit.remoteNamespace('../local'), null);
  const names = ['dcim-api', 'dcim-ui', 'fms-api', 'fms-ui'];
  const byPath = kit.suggestGroups([...names.map((n) => ({ name: `co-${n}`, remote: `https://h/co/${n.split('-')[0]}/co-${n}.git` })), { name: 'sim', remote: 'https://h/co/sim.git' }]);
  assert.deepStrictEqual(byPath.remote, { 'co-dcim-api': 'dcim', 'co-dcim-ui': 'dcim', 'co-fms-api': 'fms', 'co-fms-ui': 'fms' });
  const flat = kit.suggestGroups([...names.map((n) => ({ name: `co-${n}`, remote: `https://h/co/co-${n}.git` })), { name: 'sim' }]);
  assert.strictEqual(flat.remote, null, '주소가 모두 같은 단계면 주소 기준 없음');
  assert.deepStrictEqual(flat.name, { 'co-dcim-api': 'dcim', 'co-dcim-ui': 'dcim', 'co-fms-api': 'fms', 'co-fms-ui': 'fms' });
  assert.deepStrictEqual(kit.suggestGroups([{ name: 'a-x' }, { name: 'a-y' }, { name: 'b' }]).name, null, '마지막 낱말은 그룹이 아니다');
  assert.strictEqual(kit.suggestGroups([{ name: 'dcim' }, { name: 'co-dcim-api' }, { name: 'co-dcim-ui' }, { name: 'co-x-a' }]).name, null, '그룹 없는 repo 이름과 겹치면 안 쓴다');
}

// 2. 작업 폴더: 끝난 것은 지우고, 진행 중인데 킷 밖에 있는 것은 .worktrees/ 로 옮긴다
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-wt-')));
try {
  const ws = path.join(tmp, 'ws');
  fs.mkdirSync(path.join(ws, 'packs', 'core'), { recursive: true });
  for (const d of ['bin', 'lib']) fs.cpSync(path.join(__dirname, '..', d), path.join(ws, 'packs', 'core', d), { recursive: true });
  fs.writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ project: { name: 'x' }, repos: [{ name: 'app', kind: 'code' }], packs: ['core'] }));
  const repo = path.join(ws, 'repos', 'app');
  fs.mkdirSync(repo, { recursive: true });
  const g = (cwd, ...a) => { const r = spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...a], { encoding: 'utf8' }); return r.stdout.trim(); };
  g(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), '1\n');
  g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'init');
  const wtRoot = path.join(ws, 'repos', 'app-wt');
  // done: 직접 만든, 커밋 없음 · squash: 커밋했지만 내용이 main 에 이미 · busy: 바뀐 파일 있음 · ahead: 머지 안 된 커밋 · gone: 폴더 사라짐
  g(repo, 'worktree', 'add', '-q', '-b', 'done', path.join(wtRoot, 'done'));
  g(repo, 'worktree', 'add', '-q', '-b', 'squash', path.join(wtRoot, 'squash'));
  fs.writeFileSync(path.join(wtRoot, 'squash', 'b.txt'), 'b\n'); g(path.join(wtRoot, 'squash'), 'add', '-A'); g(path.join(wtRoot, 'squash'), 'commit', '-qm', 'b');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n'); g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'squash merge of b');
  g(repo, 'worktree', 'add', '-q', '-b', 'busy', path.join(wtRoot, 'busy'));
  fs.writeFileSync(path.join(wtRoot, 'busy', 'c.txt'), 'wip\n');
  g(repo, 'worktree', 'add', '-q', '-b', 'ahead', path.join(wtRoot, 'ahead'));
  fs.writeFileSync(path.join(wtRoot, 'ahead', 'd.txt'), 'd\n'); g(path.join(wtRoot, 'ahead'), 'add', '-A'); g(path.join(wtRoot, 'ahead'), 'commit', '-qm', 'd');
  g(repo, 'worktree', 'add', '-q', '-b', 'gone', path.join(tmp, 'gone'));
  fs.rmSync(path.join(tmp, 'gone'), { recursive: true, force: true });
  const tool = (...a) => spawnSync(process.execPath, [path.join(ws, 'packs', 'core', 'bin', 'worktree.js'), ...a], { cwd: ws, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ws } });
  const kitAdd = tool('add', 'app', 'FN-1');
  assert.strictEqual(kitAdd.status, 0, kitAdd.stderr);

  const ws0 = require('./workspace').load(ws);
  const s = W.scan(ws0, { deep: true, idleMin: 0 });
  const by = (n) => s.find((x) => path.basename(x.path) === n);
  assert.strictEqual(by('done').kind, 'other');
  assert.strictEqual(by('FN-1').kind, 'kit');
  assert.ok(by('done').done && by('squash').done && by('FN-1').done, JSON.stringify(s.map((x) => [x.rel, x.why])));
  assert.match(by('busy').why, /바뀐 파일 1개/);
  assert.match(by('ahead').why, /커밋 1개/);
  assert.ok(by('gone').missing);
  assert.ok(!W.scan(ws0, { deep: true }).find((x) => path.basename(x.path) === 'done').done, '방금 만든 것은 남긴다');

  const dry = tool('clean', '--dry-run', '--now');
  assert.match(dry.stdout, /지울 예정/);
  assert.ok(fs.existsSync(path.join(wtRoot, 'done')), '미리 보기는 지우지 않는다');
  const out = tool('clean', '--now');
  assert.strictEqual(out.status, 0, out.stderr);
  assert.ok(!fs.existsSync(path.join(wtRoot, 'done')) && !fs.existsSync(path.join(wtRoot, 'squash')), out.stdout);
  assert.ok(!fs.existsSync(path.join(ws, '.worktrees', 'app', 'FN-1')) && !fs.existsSync(path.join(ws, '.worktrees', 'app', 'FN-1.json')));
  assert.ok(fs.existsSync(path.join(ws, '.worktrees', 'app', 'busy', 'c.txt')) && fs.existsSync(path.join(ws, '.worktrees', 'app', 'ahead', 'd.txt')), '진행 중인 것은 .worktrees/ 로 옮긴다');
  assert.ok(!fs.existsSync(wtRoot), '비게 된 repos/app-wt/ 는 지운다');
  const branches = g(repo, 'branch', '--format=%(refname:short)').split('\n');
  assert.ok(!branches.includes('kedovi/FN-1') && branches.includes('done') && branches.includes('busy'), `킷 임시 브랜치만 지운다: ${branches}`);
  assert.ok(!g(repo, 'worktree', 'list').includes(path.join(tmp, 'gone')), '사라진 폴더 기록 정리');
  const after = W.scan(ws0, { deep: true, idleMin: 0 });
  assert.deepStrictEqual(after.map((x) => [path.basename(x.path), x.kind]).sort(), [['ahead', 'kit'], ['busy', 'kit']]);
  const busy = tool('merge', 'app', 'busy');
  assert.strictEqual(busy.status, 1, '옮겨 온 작업 폴더는 브랜치 그대로라 merge 하지 않는다');
  // 다시 정리: 바뀐 것을 버리고 ahead 를 main 에 머지하면 둘 다 끝남
  fs.rmSync(path.join(ws, '.worktrees', 'app', 'busy', 'c.txt'));
  g(repo, 'merge', '-q', 'ahead');
  const again = tool('clean', '--now', '--branches');
  assert.ok(!fs.existsSync(path.join(ws, '.worktrees', 'app')), again.stdout);
  assert.ok(!g(repo, 'branch', '--format=%(refname:short)').split('\n').includes('ahead'), '--branches 면 머지된 브랜치도');
  g(repo, 'branch', 'feat');
  const add2 = tool('add', 'app', 'rev', '--branch', 'feat');
  assert.ok(add2.status === 0 && fs.existsSync(path.join(ws, '.worktrees', 'app', 'rev', 'a.txt')), add2.stderr);
  assert.strictEqual(g(path.join(ws, '.worktrees', 'app', 'rev'), 'rev-parse', '--abbrev-ref', 'HEAD'), 'feat');
  const sum = W.summary(ws0);
  assert.deepStrictEqual([sum.total, sum.stray], [1, 0]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('worktrees.test.js OK');
