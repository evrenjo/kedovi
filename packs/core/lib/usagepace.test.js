// 주간 사용량 속도 (lib/usagepace.js · hooks/usage-status.js · usage-pace.js · agent-budget.js) 시험. Max · Ultra 모두
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-usage-'));
process.env.KEDOVI_USAGE_FILE = path.join(tmp, 'usage.json');
const P = require('./usagepace');
const now = 1800000000000;
// 창의 절반이 지난 때(기준 50%)에 used 를 썼다
const put = (used, five, at = now) => P.record({ seven_day: { used_percentage: used, resets_at: (now + P.WEEK / 2) / 1000 }, ...(five === undefined ? {} : { five_hour: { used_percentage: five, resets_at: (now + 3600000) / 1000 } }) }, at);
const lv = (used) => { put(used); return P.state({}, now).level; };
try {
  assert.strictEqual(P.state({}, now).known, false, '기록 없음');
  assert.deepStrictEqual([lv(50), lv(59), lv(60), lv(70), lv(80)], [0, 0, 1, 2, 3]);
  assert.strictEqual(P.record({}), false, '구독 값이 없으면 그대로');
  assert.strictEqual(P.state({}, now).used, 80);
  // 창 시작 직후 · 끝 무렵
  P.record({ seven_day: { used_percentage: 12, resets_at: (now + P.WEEK - 3600000) / 1000 } }, now);
  assert.strictEqual(P.state({}, now).level, 0, 'minUsed 아래');
  P.record({ seven_day: { used_percentage: 93, resets_at: (now + P.WEEK * 0.1) / 1000 } }, now);
  assert.strictEqual(P.state({}, now).level, 3, '90% 이상이고 앞섬');
  P.record({ seven_day: { used_percentage: 91, resets_at: (now + P.WEEK * 0.05) / 1000 } }, now);
  assert.strictEqual(P.state({}, now).level, 0, '90% 이상이어도 기준보다 뒤');
  // 낡음 · 창 끝남 · 팀 기준
  put(80, undefined, now - 3 * 3600000);
  assert.match(P.state({}, now).why, /낡음/);
  put(80);
  assert.strictEqual(P.state({}, now + P.WEEK).known, false);
  assert.strictEqual(P.state({ vars: { usage: { saveOver: '40', slowOver: '35' } } }, now).level, 1);
  // Ultra: 5시간 값 없음 · 상한 3×2·20
  put(70);
  assert.strictEqual(P.state({}, now).five, null);
  assert.deepStrictEqual(P.limitsFor({ parallel: 6, total: 20, leaders: 3, members: 2 }, 2), { parallel: 3, total: 10, leaders: 2, members: 1 });
  assert.deepStrictEqual(P.limitsFor({ parallel: 6, total: 20, leaders: 3, members: 2 }, 3), { parallel: 2, total: 7, leaders: 1, members: 1 });
  assert.deepStrictEqual(P.limitsFor({ parallel: 4, total: 10, leaders: 2, members: 2 }, 3), { parallel: 2, total: 4, leaders: 1, members: 1 });

  // 5시간 창: 값이 오면 Max · 인증 전 Ultra 모두 줄임 이상, 지난 창은 버림, 절약은 그대로
  put(50, 90); assert.deepStrictEqual([P.state({}, now).level, P.state({}, now).fiveHot], [2, true]);
  assert.match(P.line(P.state({}, now)), /5시간 90%/);
  put(50, 84); assert.strictEqual(P.state({}, now).level, 0);
  put(50, 90); assert.strictEqual(P.state({}, now + 2 * 3600000).level, 0, '지난 5시간 창');
  put(85, 90); assert.strictEqual(P.state({}, now).level, 3);
  put(70);

  // 상태 줄: 기록 · 전역 상태 줄 대신 돌리기 · 경고
  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const hooks = path.join(__dirname, '..', 'hooks');
  const status = (input, cfg) => { fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(cfg || {})); return spawnSync(process.execPath, [path.join(hooks, 'usage-status.js')], { cwd: tmp, encoding: 'utf8', input: JSON.stringify(input), env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: '' } }).stdout; };
  const reset = Math.floor((Date.now() + P.WEEK / 2) / 1000);
  assert.strictEqual(status({ rate_limits: { seven_day: { used_percentage: 20, resets_at: reset } } }), '주간 20%\n');
  assert.strictEqual(status({ rate_limits: { seven_day: { used_percentage: 20, resets_at: reset } } }, { statusLine: { command: 'cat >/dev/null; echo 내 상태' } }), '내 상태\n');
  assert.match(status({ rate_limits: { seven_day: { used_percentage: 75, resets_at: reset } } }, { statusLine: { command: 'echo 내 상태' } }), /^내 상태 · ⚠ 주간 75% \(속도 \+25 · 줄임\)\n$/);
  assert.strictEqual(status({}, { statusLine: { command: 'node x/usage-status.js' } }), '⚠ 주간 75% (속도 +25 · 줄임)\n', '자기 자신은 부르지 않음');

  // 맥락 교체 알림
  const ws = path.join(tmp, 'ws');
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws, 'workspace.json'), '{"project":{"name":"x"},"repos":[],"packs":["core"]}');
  const main = path.join(tmp, 's1.jsonl');
  const subDir = path.join(tmp, 's1', 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  const line = (k) => `${JSON.stringify({ message: { usage: { input_tokens: 1, cache_read_input_tokens: k * 1000, cache_creation_input_tokens: 0 } }, pad: 'x'.repeat(60000) })}\n`;
  fs.writeFileSync(main, '{}\n');
  const hook = (o) => spawnSync(process.execPath, [path.join(hooks, 'usage-pace.js'), '--agent=claude'], { cwd: ws, encoding: 'utf8', input: JSON.stringify({ session_id: 'u1', hook_event_name: 'PreToolUse', tool_name: 'Read', transcript_path: main, ...o }), env: { ...process.env, CLAUDE_PROJECT_DIR: ws } }).stdout;
  const sub = path.join(subDir, 'agent-a1.jsonl');
  fs.writeFileSync(sub, line(120));
  assert.strictEqual(hook({ agent_id: 'a1', agent_type: 'implementer' }), '', '기준 아래');
  fs.appendFileSync(sub, line(230));
  const first = hook({ agent_id: 'a1', agent_type: 'implementer' });
  assert.match(first, /맥락이 약 230K.*보고하고 끝낸다/);
  const doc = (first.match(/인계 파일 틀을 만들었다: (\S+)/) || [])[1];
  assert.ok(doc && fs.existsSync(path.join(ws, doc)), `인계 파일 틀: ${first}`);
  assert.match(fs.readFileSync(path.join(ws, doc), 'utf8'), /## 바뀐 파일[\s\S]*## 채울 것/);
  // 맥락 창 기준: 20만 창의 70% = 140K 에서 (비용 기준 200K 보다 먼저)
  const sub2 = path.join(subDir, 'agent-a2.jsonl');
  fs.writeFileSync(sub2, line(150));
  assert.match(hook({ agent_id: 'a2', agent_type: 'tester' }), /약 150K.*기준 140K.*renewContextPct/);
  fs.appendFileSync(sub, line(240));
  assert.strictEqual(hook({ agent_id: 'a1', agent_type: 'implementer' }), '', '5만 안 늘면 다시 안 알림');
  fs.appendFileSync(sub, line(285));
  assert.match(hook({ agent_id: 'a1', agent_type: 'implementer' }), /약 285K/);
  fs.writeFileSync(main, line(400));
  assert.strictEqual(hook({}), '', '메인은 세션 알림이 맡는다');

  // 메인 알림 문구가 실제 적용 수준과 맞는다: block = 줄였다 · warn = 줄이지 않음, 이 PC 값이 팀 값보다 세면 출처
  fs.mkdirSync(path.join(ws, 'bin'));
  fs.copyFileSync(path.join(__dirname, '..', '..', '..', 'bin', 'kit.js'), path.join(ws, 'bin', 'kit.js'));
  const prompt = (sid) => spawnSync(process.execPath, [path.join(hooks, 'usage-pace.js'), '--agent=claude'], { cwd: ws, encoding: 'utf8', input: JSON.stringify({ session_id: sid, hook_event_name: 'UserPromptSubmit' }), env: { ...process.env, CLAUDE_PROJECT_DIR: ws } }).stdout;
  const setWs = (enforce) => fs.writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ project: { name: 'x' }, repos: [], packs: ['core'], agents: { enforce } }));
  const live = (used) => P.record({ seven_day: { used_percentage: used, resets_at: (Date.now() + P.WEEK / 2) / 1000 } });
  live(82);
  setWs({ usagePace: 'block' });
  const blk = prompt('m1');
  assert.match(blk, /줄였다/); assert.match(blk, /Sonnet 으로 바꿔 띄운다/); assert.doesNotMatch(blk, /이 PC 값/);
  assert.strictEqual(prompt('m1'), '', '같은 단계 · 같은 수준이면 1시간 안에 다시 안 알림');
  setWs({ usagePace: 'warn' });
  const wrn = prompt('m1');
  assert.match(wrn, /줄이지 않았다 \(알림만, agents\.enforce\.usagePace=warn\)/, '수준을 바꾸면 바로 다시');
  assert.doesNotMatch(wrn, /줄였다|바꿔 띄운다/);
  fs.mkdirSync(path.join(ws, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.agents', 'local.json'), JSON.stringify({ agents: { enforce: { usagePace: 'block' } } }));
  assert.match(prompt('m2'), /줄였다.*팀 값은 warn 이지만 이 PC 값/);
  fs.rmSync(path.join(ws, '.agents', 'local.json'));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('usagepace.test.js OK');
