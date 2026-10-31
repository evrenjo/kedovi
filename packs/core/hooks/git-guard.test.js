// git-guard.js 점검: 팀원 · 위임 세션이 워크스페이스 루트 repo 에 git 쓰기 · 어디서든 push 를 하면 막는다. 실행: node git-guard.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { findGit } = require('./git-guard');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-gitguard-')));
const ws = path.join(tmp, 'ws');
const app = path.join(ws, 'repos', 'app');
fs.mkdirSync(path.join(ws, '.git'), { recursive: true });
fs.mkdirSync(path.join(app, '.git'), { recursive: true });
fs.writeFileSync(path.join(ws, 'workspace.json'), '{"repos":[]}');

const kinds = (cmd, cwd = ws) => findGit(cmd, cwd, ws).map((x) => `${x.kind}:${x.sub}`);

// 루트에서 쓰기는 막고 읽기는 통과
assert.deepStrictEqual(kinds('git commit -am x'), ['root:commit']);
assert.deepStrictEqual(kinds('git status && git log -3 && git diff && git branch && git stash list && git fetch'), []);
assert.deepStrictEqual(kinds('git reset --hard HEAD~1'), ['root:reset']);
assert.deepStrictEqual(kinds('git checkout -- a.txt'), ['root:checkout']);
assert.deepStrictEqual(kinds('git stash'), ['root:stash']);
assert.deepStrictEqual(kinds('git clean -fd'), ['root:clean']);
assert.deepStrictEqual(kinds('git branch -D old'), ['root:branch']);
// repo 안은 통과 (-C · cd), push 는 어디서든 막음
assert.deepStrictEqual(kinds('git -C repos/app commit -m x && git -C repos/app reset --hard'), []);
assert.deepStrictEqual(kinds('cd repos/app && git commit -m x'), []);
assert.deepStrictEqual(kinds('git commit -m x', app), []);
assert.deepStrictEqual(kinds('git -C repos/app push -f origin HEAD:develop'), ['push:push']);
// 사고 재현: cd 가 실패하면(없는 폴더) 루트에서 돈다
assert.deepStrictEqual(kinds('cd repos/infra-missing; git commit --allow-empty -m x'), ['root:commit']);
assert.deepStrictEqual(kinds('mkdir -p repos/new && cd repos/new && git init && git add -A'), []);
// 위치를 모르면 막는다 ($변수 · cd -)
assert.deepStrictEqual(kinds('cd "$REPO" && git commit -m x'), ['unknown:commit']);
assert.deepStrictEqual(kinds('git -C $DIR reset --hard'), ['unknown:reset']);
assert.deepStrictEqual(kinds('cd "$REPO" && git status'), []);
// 스크립트 안 · bash -c 안
fs.writeFileSync(path.join(ws, 'deploy.sh'), '#!/bin/bash\ncd /nowhere/infra\ngit commit -a -m wip\ngit reset --hard\n');
fs.writeFileSync(path.join(ws, 'ok.sh'), '#!/bin/sh\nset -e\ncd repos/app\ngit commit -m ok\n');
fs.writeFileSync(path.join(ws, 'loose.sh'), '#!/bin/sh\ncd repos/app\ngit commit -m ok\n');
assert.deepStrictEqual(kinds('bash deploy.sh'), ['root:commit', 'root:reset']);
assert.deepStrictEqual(kinds('./deploy.sh'), ['root:commit', 'root:reset']);
assert.deepStrictEqual(kinds('sh ok.sh'), []);
// cd 뒤 연결: ; · 줄바꿈이면 cd 가 실패해도 이어진다 → 막고 -C 절대경로 안내. && · || exit · set -e 면 통과
assert.deepStrictEqual(kinds('sh loose.sh'), ['unsafe-cd:commit']);
assert.deepStrictEqual(kinds('cd repos/app; git commit -m x'), ['unsafe-cd:commit']);
assert.deepStrictEqual(kinds('cd repos/app || exit 1; git reset --hard'), []);
assert.deepStrictEqual(kinds('set -eu; cd repos/app; git stash'), []);
assert.deepStrictEqual(kinds(`cd repos/app; git -C ${app} commit -m x`), []);
assert.deepStrictEqual(kinds('cd repos/app; git status; git log'), []);
assert.deepStrictEqual(kinds('bash -c "cd repos/app && git push"'), ['push:push']);
assert.deepStrictEqual(findGit('bash deploy.sh', ws, ws)[0].via, 'deploy.sh');

// 훅: 리더는 통과, 서브에이전트(agent_id) · 위임 세션(KEDOVI_DELEGATED)은 막음
const hook = (input, env = {}) => spawnSync(process.execPath, [path.join(__dirname, 'git-guard.js')], { cwd: ws, input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, KEDOVI_DELEGATED: '', CLAUDE_PROJECT_DIR: ws, ...env } });
const bash = (command, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: ws, ...extra });
const deny = (r) => /"permissionDecision":"deny"/.test(r.stdout);
assert.strictEqual(hook(bash('git commit -am x')).stdout, '', '리더 루트 커밋은 조용');
const lead = hook(bash('git reset --hard'));
assert.ok(!deny(lead) && /additionalContext/.test(lead.stdout) && /리더라 막지 않음/.test(lead.stdout), '리더는 경고만');
assert.strictEqual(hook(bash('git -C repos/app push origin HEAD')).stdout, '', '리더 push 는 조용');
const sub = hook(bash('git commit -am x', { agent_id: 'a1' }));
assert.ok(deny(sub) && /루트 repo/.test(sub.stdout), '서브에이전트 루트 커밋 막음');
assert.ok(deny(hook(bash('git -C repos/app push'), { KEDOVI_DELEGATED: '1' })), '위임 세션 push 막음');
assert.ok(!deny(hook(bash('git -C repos/app commit -m x', { agent_id: 'a1' }))), '맡은 repo 커밋 통과');
assert.strictEqual(hook(bash('git commit -am x', { agent_id: 'a1' })).status, 0);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('git-guard ok');
