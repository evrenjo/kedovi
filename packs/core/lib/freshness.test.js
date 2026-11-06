// freshness.js · hooks/fact-freshness.js 점검: 「확인일」 칸이 있는 표의 오래된 행 · 세션당 한 번 알림. 실행: node freshness.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const F = require('./freshness');

const now = new Date(2026, 10, 7, 12).getTime(); // 2026-11-07
const doc = [
  '# 운영 환경',
  '',
  '| 사실 | 값 | 확인 명령 | 확인일 |',
  '|---|---|---|---|',
  '| 러너 디스크 | 200GB | `df -h /` | 2026-09-01 |',
  '| 앱 메모리 상한 | 2GB | `docker inspect app` | 2026-11-01 |',
  '| 로그 경로 | /var/log/app | `ls /var/log/app` | |',
  '',
  '옛 표 (확인일 칸 없음)',
  '| 서버 | 용도 |',
  '|---|---|',
  '| app-01 | 2020-01-01 |',
  '',
  '```markdown',
  '| 사실 | 확인일 |',
  '|---|---|',
  '| 양식 예시 | 2020-01-01 |',
  '```',
].join('\n');
const rows = F.factRows(doc, now);
assert.strictEqual(rows.length, 3, '확인일 칸이 있는 표만, 코드 블록 안 양식은 뺀다');
const stale = F.staleRows(doc, 30, now);
assert.deepStrictEqual(stale.map((r) => [r.fact, r.date, r.age, r.command, r.line]), [['러너 디스크 = 200GB', '2026-09-01', 67, 'df -h /', 5]]);
assert.strictEqual(F.staleLine(stale[0]), '재확인 필요: 러너 디스크 = 200GB (확인일 2026-09-01 · 67일 전, 확인 명령 df -h /)');
assert.deepStrictEqual(F.undatedRows(doc, now).map((r) => r.fact), ['로그 경로 = /var/log/app']);
assert.strictEqual(F.staleRows(doc, 0, now).length, 0, '0 = 끔');
assert.deepStrictEqual(F.undatedRows('| 사실 | 확인일 |\n|---|---|\n| <항목> | <YYYY-MM-DD> |\n| 없음 | - |', now), [], '양식 자리표시 · - 는 확인일 없음으로 세지 않는다');
assert.strictEqual(F.daysOf({ vars: { docs: { factDays: '14' } } }), 14);
assert.strictEqual(F.daysOf({ vars: { docs: { factDays: 'off' } } }), 0);
assert.strictEqual(F.daysOf({}), 30);
// 사실 칸이 없으면 첫 칸
assert.deepStrictEqual(F.factRows('| 별칭 | 호스트 | 확인일 |\n|---|---|---|\n| dev | dev-db | 2026-11-06 |', now).map((r) => [r.fact, r.age]), [['dev', 1]]);

// 훅: Read 는 그 파일, Bash 는 읽는 명령의 .md. 같은 세션은 한 번만, 알림만 (막지 않는다)
const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-fresh-')));
fs.writeFileSync(path.join(ws, 'workspace.json'), '{}');
const old = doc.replace('2026-11-01', '2020-01-01');
fs.writeFileSync(path.join(ws, 'env.md'), old);
fs.writeFileSync(path.join(ws, 'plain.md'), '# 그냥 문서\n');
const hook = (input) => spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'fact-freshness.js')], { cwd: ws, input: JSON.stringify({ hook_event_name: 'PostToolUse', cwd: ws, ...input }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ws } });
const r1 = hook({ session_id: 'fresh-1', tool_name: 'Read', tool_input: { file_path: path.join(ws, 'env.md') } });
assert.strictEqual(r1.status, 0);
const ctx = JSON.parse(r1.stdout).hookSpecificOutput;
assert.strictEqual(ctx.hookEventName, 'PostToolUse');
assert.match(ctx.additionalContext, /재확인 필요: 러너 디스크 = 200GB \(확인일 2026-09-01 · \d+일 전, 확인 명령 df -h \/\)/);
assert.match(ctx.additionalContext, /앱 메모리 상한/);
assert.match(ctx.additionalContext, /근거로 쓰기 전에 확인 명령을 다시 돌린다/);
assert.strictEqual(hook({ session_id: 'fresh-1', tool_name: 'Read', tool_input: { file_path: path.join(ws, 'env.md') } }).stdout, '', '같은 세션 · 같은 파일은 한 번');
assert.match(hook({ session_id: 'fresh-2', tool_name: 'Bash', tool_input: { command: 'cd docs && sed -n 1,40p env.md | head' } }).stdout, /재확인 필요/, 'Bash 로 읽어도 (Codex)');
assert.strictEqual(hook({ session_id: 'fresh-3', tool_name: 'Read', tool_input: { file_path: path.join(ws, 'plain.md') } }).stdout, '');
assert.strictEqual(hook({ session_id: 'fresh-3', tool_name: 'Bash', tool_input: { command: 'rm env.md.bak; echo env.md' } }).stdout, '', '읽는 명령이 아니면 보지 않는다');
assert.strictEqual(hook({ session_id: 'fresh-4', tool_name: 'Read', tool_input: { file_path: path.join(ws, 'nope.md') } }).status, 0, '없는 파일도 exit 0');
fs.writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ vars: { docs: { factDays: 0 } } }));
assert.strictEqual(hook({ session_id: 'fresh-5', tool_name: 'Read', tool_input: { file_path: path.join(ws, 'env.md') } }).stdout, '', 'factDays 0 = 끔');
assert.strictEqual(spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'fact-freshness.js')], { input: '{깨진', encoding: 'utf8' }).status, 0, '깨진 입력도 exit 0');
fs.rmSync(ws, { recursive: true, force: true });
console.log('freshness.test.js ok');
