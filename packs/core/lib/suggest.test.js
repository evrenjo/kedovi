// 기능 추천 (lib/suggest.js · hooks/feature-suggest.js · bin/suggest.js) 점검
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-suggest-'));
process.env.KEDOVI_HOME = path.join(tmp, 'home');
delete process.env.KEDOVI_SUGGEST;
const S = require('./suggest');
const root = path.join(tmp, 'ws');
fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
const ws = { packs: ['core', 'screens'], repos: [{ name: 'api', kind: 'code', stacks: ['spring'] }], agents: { mode: 'fixed' }, vars: {} };
fs.writeFileSync(path.join(root, 'workspace.json'), JSON.stringify(ws));
const map = S.loadMap();
const fresh = () => ({ n: 1, last: 0, ids: [] });
const ctx = (prompt, session = fresh()) => ({ root, ws, local: {}, prompt, session });

// 지도: id 겹침 없음 · 정규식 · 필수 칸
const ids = new Set();
for (const e of map.entries) {
  assert(!ids.has(e.id), `id 겹침 ${e.id}`); ids.add(e.id);
  for (const k of ['id', 'say', 'why', 'cmd', 'scope']) assert(e[k], `${e.id}: ${k} 없음`);
  if (e.topic) new RegExp(e.topic, 'i');
  assert(!/—/.test(`${e.say}${e.why}`), `${e.id}: 장식 대시`);
}

// 주제 · 상태 조건
assert.strictEqual(S.pick(map, ctx('주문 API 디버깅 보여줘')).id, 'trace');
assert.strictEqual(S.pick(map, { ...ctx('주문 API 디버깅 보여줘'), ws: { ...ws, packs: [...ws.packs, 'trace'] } }), null, '이미 켠 팩은 추천하지 않음');
assert.strictEqual(S.pick(map, { ...ctx('주문 API 디버깅 보여줘'), ws: { ...ws, repos: [{ name: 'web', stacks: ['react'] }] } }), null, '스택이 안 맞으면 추천하지 않음');
assert.strictEqual(S.pick(map, ctx('프로토타입이랑 화면이 달라')).id, 'screens-locate');
assert.strictEqual(S.pick(map, ctx('오늘 날씨 어때')), null);
assert.strictEqual(S.pick(map, ctx('이거 동시에 병렬로 해줘')).id, 'team-auto');
assert.strictEqual(S.pick(map, { ...ctx('이거 동시에 병렬로 해줘'), ws: { ...ws, agents: { mode: 'auto' } } }), null);

// 세션 상한 · 간격 · 주제 없는 추천
assert.strictEqual(S.pick(map, ctx('디버깅', { n: 5, last: 3, ids: ['x'] })), null, '간격');
assert.strictEqual(S.pick(map, ctx('디버깅', { n: 9, last: 3, ids: ['x', 'y'] })), null, '세션 상한');
assert.strictEqual(S.pick(map, ctx('디버깅 해줘', { n: 9, last: 3, ids: ['trace'] })), null, '같은 세션에 같은 추천 없음 · 다른 주제 없음');
const any = S.pick(map, ctx('이 기능 좀 더 다듬어 줘', { n: 8, last: 0, ids: [] }));
assert(any && any.anytime, '요청 8개째부터 주제 없는 추천');
assert.strictEqual(S.pick(map, ctx('이 기능 좀 더 다듬어 줘', { n: 3, last: 0, ids: [] })), null);

// 결정 · 물은 횟수
S.decide(root, 'trace', 'no');
assert.strictEqual(S.pick(map, ctx('디버깅 보여줘')), null, '정한 것은 다시 묻지 않음');
S.reset(root, 'trace');
assert.strictEqual(S.pick(map, ctx('디버깅 보여줘')).id, 'trace');
S.decide(root, 'trace', 'yes', true);
assert.strictEqual(S.decisions(root).trace.all, true, '모든 프로젝트 결정');
assert.strictEqual(S.pick(map, ctx('디버깅 보여줘')), null);
S.reset(root);
assert(!S.decisions(root).trace, 'reset 은 모든 프로젝트 결정도 지움');
S.markAsked(root, 'trace'); S.markAsked(root, 'trace');
assert.strictEqual(S.pick(map, ctx('디버깅 보여줘')), null, '두 번 묻고 답이 없으면 쉼');
assert(S.askable('trace', {}, { trace: { n: 2, at: '2000-01-01T00:00:00Z' } }), '쉬는 기간이 지나면 다시');
assert(!S.askable('trace', {}, { trace: { n: 3, at: '2000-01-01T00:00:00Z' } }), '세 번이면 그만');
S.reset(root);
S.setOff(root, true);
assert(S.globallyOff(root));
S.setOff(root, false);

// 훅: 문맥 한 줄 · 같은 세션 두 번째는 간격 때문에 없음
const hook = path.join(__dirname, '..', 'hooks', 'feature-suggest.js');
const fire = (prompt) => spawnSync(process.execPath, [hook], { cwd: root, input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt, cwd: root }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
const r1 = fire('결제 API 디버깅 보여줘');
assert.strictEqual(r1.status, 0);
assert(/기능 추천 .*kedovi upgrade --add trace.*kedovi suggest set trace yes\|no/.test(r1.stdout), r1.stdout + r1.stderr);
assert.strictEqual(fire('프로토타입이랑 달라').stdout.trim(), '', '간격 안에는 추천 없음');
assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, '.agents', 'local.json'), 'utf8')).suggest.asked.trace.n, 1);

// 명령
const cli = (...a) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'suggest.js'), ...a], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
assert(/trace\s+물음 1번/.test(cli().stdout), cli().stdout);
assert.strictEqual(cli('set', 'trace', 'yes').status, 0);
assert(/trace\s+씀/.test(cli('list').stdout));
assert.strictEqual(cli('set', 'nope', 'yes').status, 1);
assert(/이미 씀 · 해당 없음/.test(cli().stdout), 'screens 팩이 켜져 screens-pack 은 해당 없음');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('suggest.test.js: 주제 · 상태 · 상한 · 결정 · 훅 · 명령 통과');
