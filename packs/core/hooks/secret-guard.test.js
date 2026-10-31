// secret-guard.js 점검: 비밀값 파일 내용 출력 막기(Bash · Read) · 출력의 비밀값 모양 알림. 실행: node secret-guard.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const { isSecretFile, bashLeak, scanOutput } = require('./secret-guard');

const H = os.homedir();
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-secret-')));
fs.writeFileSync(path.join(tmp, '.env'), 'X=1\n');
fs.writeFileSync(path.join(tmp, '.env.local'), 'X=1\n');
fs.writeFileSync(path.join(tmp, '.env.example'), 'X=\n');

// 파일 판정
assert.ok(isSecretFile(path.join(H, '.pgpass')) && isSecretFile(path.join(tmp, '.env')) && isSecretFile(path.join(tmp, '.env.production')));
assert.ok(!isSecretFile(path.join(tmp, '.env.example')) && !isSecretFile(path.join(tmp, '.env.sample')));
assert.ok(isSecretFile(path.join(H, '.ssh', 'id_ed25519')) && !isSecretFile(path.join(H, '.ssh', 'id_ed25519.pub')) && !isSecretFile(path.join(H, '.ssh', 'known_hosts')));
assert.ok(isSecretFile(path.join(H, '.gitlab-runner', 'config.toml')) && isSecretFile('/srv/tls/server.key') && isSecretFile('/srv/tls/ca.pem'));
assert.ok(!isSecretFile(path.join(tmp, 'config.toml')) && !isSecretFile(path.join(tmp, 'README.md')));

// 막는 것: 내용을 출력
const leak = (c) => !!bashLeak(c, tmp);
for (const c of ['cat ~/.pgpass', "awk -F: '{print $5}' ~/.pgpass", 'awk \'{print}\' $HOME/.pgpass', 'head -3 .env', 'sed -n 1p .env.local', 'grep PASSWORD .env', 'less ~/.ssh/id_rsa',
  'cat .env | sort', 'tail ~/.gitlab-runner/config.toml', 'cat .env*', 'cd /x && cat ~/.pgpass', 'diff .env .env.example', 'cat < .env']) assert.ok(leak(c), c);
// 통과: 존재 · 권한 · 세기 · 키 이름 · 파일로 · 불러오기 · 예시 · 공개 키
for (const c of ['ls -l ~/.pgpass', 'test -f .env && echo ok', 'stat .env', 'wc -l .env', "awk -F: '{print NF}' ~/.pgpass", "awk 'END{print NR}' .env", 'grep -c PASSWORD .env', 'grep -q X .env',
  'cut -d= -f1 .env', 'cat .env | wc -l', 'cp .env /tmp/backup.env', 'sed -i "" s/a/b/ .env', 'cat .env > /tmp/copy', 'source .env && npm start', 'cat .env.example', 'cat ~/.ssh/id_ed25519.pub', 'cat README.md',
  'openssl x509 -in ca.pem -noout -subject', 'sha256sum ~/.ssh/id_rsa']) assert.ok(!leak(c), c);

// 출력 검사
assert.deepStrictEqual(scanOutput('READONLY_PASSWORD=Zx81qPm0vLr7tYc2'), ['READONLY_PASSWORD= 값']);
assert.ok(scanOutput('token ' + 'glpat' + '-AbCdEfGhIjKlMnOpQrSt12').includes('GitLab 개인 토큰(glpat-)'));
assert.ok(scanOutput('--token ' + 'glrt' + '-t1_abcdefghijklmnopqrstuv').includes('GitLab 러너 토큰(glrt-)'));
assert.ok(scanOutput('-----BEGIN OPENSSH ' + 'PRIVATE KEY-----\nb3Bl').includes('PEM 개인 키'));
assert.ok(scanOutput('DATABASE_URL=postgres://app:s3cr3tpw@db:5432/app').includes('DB 접속 주소의 비밀번호'));
assert.ok(scanOutput('db.local:5432:app:reader:hunter2pw').includes('.pgpass 비밀번호 칸'));
for (const ok of ['commit a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', 'HEAD_SHA=a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', 'DATABASE_URL=postgres://app:***@db/app', 'NODE_ENV=production', 'PASSWORD=changeme', '✔ 115 passed', 'PATH=/usr/local/bin:/usr/bin']) assert.deepStrictEqual(scanOutput(ok), [], ok);

// 훅: 모든 세션에서 막음 (팀원도), Read 도구, PostToolUse 알림에 값을 다시 찍지 않음
const hook = (input) => spawnSync(process.execPath, [path.join(__dirname, 'secret-guard.js')], { cwd: tmp, input: JSON.stringify({ cwd: tmp, ...input }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } }).stdout;
const deny = (o) => /"permissionDecision":"deny"/.test(o);
assert.ok(deny(hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: "awk -F: '{print $1,$5}' ~/.pgpass" } })));
assert.ok(deny(hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', agent_id: 'a1', tool_input: { command: 'cat .env' } })));
assert.ok(deny(hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(tmp, '.env.local') } })));
assert.strictEqual(hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(tmp, '.env.example') } }), '');
const post = hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'x' }, tool_response: { stdout: 'READONLY_PASSWORD=Zx81qPm0vLr7tYc2\n', stderr: '' } });
assert.ok(/노출 가능성/.test(post) && /교체할지 묻는다/.test(post) && !post.includes('Zx81qPm0'), post);
assert.strictEqual(hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: { stdout: 'ok\n' } }), '');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('secret-guard ok');
