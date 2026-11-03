// workspace.js 의 git 도우미: 한글 경로가 8진수(\355\225\234…)로 깨지지 않는다 (core.quotepath=false). 실행: node workspace.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { git, gitAsync } = require('./workspace');

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-ws-git-'));
const run = (...a) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' });
run('init', '-q');
run('config', 'user.email', 't@example.com');
run('config', 'user.name', 't');
run('config', 'core.quotepath', 'true'); // 사용자 설정이 기본값(켬)이어도
fs.mkdirSync(path.join(d, '화면'));
fs.writeFileSync(path.join(d, '화면', '주문목록.md'), '# 주문\n');
run('add', '.');
run('commit', '-q', '-m', 'init');
fs.writeFileSync(path.join(d, '새파일.md'), 'x\n');

assert.strictEqual(git(d, ['log', '--name-only', '--pretty=']), '화면/주문목록.md', 'log --name-only 한글 그대로');
assert.strictEqual(git(d, ['status', '--porcelain']), '?? 새파일.md', 'status --porcelain 한글 그대로');
assert.ok(!/\\\d{3}/.test(git(d, ['ls-files'])), 'ls-files 에 8진수 없음');
gitAsync(d, ['ls-files']).then((r) => {
  assert.ok(r.ok && r.out.includes('화면/주문목록.md'), 'gitAsync 도 한글 그대로');
  fs.rmSync(d, { recursive: true, force: true });
  console.log('workspace.test.js ✔');
});
