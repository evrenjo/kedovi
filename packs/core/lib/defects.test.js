// defects.js · budget.js 이력 점검: 결함 기록 칸 검사 · 월간 집계(잠복 · 해소 시간 · 예산 초과율). 실행: node defects.test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');
const D = require('./defects');
const B = require('./budget');

const cfg = D.settings({});
assert.strictEqual(cfg.categories.length, 10);
assert.deepStrictEqual(D.settings({ vars: { defects: { categories: '수명, 환경' } } }).categories, ['수명', '환경'], '분류 목록은 vars 로 바꾼다');
assert.strictEqual(D.parseDefect('# 기능 기록\n상태: 진행 중\n', cfg), null, '종류 줄이 없으면 결함 기록이 아니다');
assert.strictEqual(D.parseDefect('종류: 기능 개발\n', cfg), null);
const head = (x) => `관련: OPS-12\n상태: ${x.status || '진행 중'}\n종류: 운영 결함\n${x.body || ''}`;
const p = (x) => D.problems(D.parseDefect(head(x), cfg), cfg);
assert.deepStrictEqual(p({}).length, 2, '발견 · 분류 없음');
assert.deepStrictEqual(p({ body: '발견: 2026-11-03 10:20\n분류: 수명\n' }), []);
assert.match(p({ body: '발견: 2026-11-03 10:20\n분류: 기타\n' })[0], /분류 「기타」 가 목록에 없다/);
assert.match(p({ status: '완료', body: '발견: 2026-11-03\n분류: 수명\n' })[0], /해소 시각/);
assert.match(p({ status: '완료', body: '발견: 2026-11-03\n해소: 2026-11-02\n분류: 수명\n' })[0], /앞이다/);
assert.match(p({ body: '발견: 어제\n분류: 수명\n' })[0], /읽지 못했다/);

// 월간 집계: 잠복 = 원인 커밋(또는 발생) → 발견, 해소 = 발견 → 해소. 다른 달은 뺀다
const rec = (b) => ({ file: 'x.md', defect: D.parseDefect(head({ body: b }), cfg) });
const recs = [
  rec('발견: 2026-11-04 12:00\n해소: 2026-11-04 15:30\n분류: CI 자원\n발생: 2026-11-04 08:30\n'),
  rec('발견: 2026-11-10 00:00\n해소: 2026-11-11 00:00\n분류: 외부 API 가정\n원인 커밋: abc1234\n'),
  rec('발견: 2026-11-12 00:00\n분류: 외부 API 가정\n'),
  rec('발견: 2026-10-30 00:00\n분류: 수명\n'),
  rec('분류: 수명\n'),
];
const r = D.report(recs, '2026-11', { timeOf: (sha) => (sha === 'abc1234' ? new Date('2026-11-06T12:00:00').getTime() : null) });
assert.strictEqual(r.count, 3);
assert.strictEqual(r.open, 1);
assert.strictEqual(r.missing, 1, '발견 없는 기록은 뺀다고 센다');
const api = r.byCategory.find((c) => c.category === '외부 API 가정');
assert.strictEqual(api.count, 2);
assert.strictEqual(api.latency, 3.5 * 1440, '원인 커밋 → 발견 3.5일');
assert.strictEqual(api.resolve, 1440);
assert.strictEqual(r.byCategory.find((c) => c.category === 'CI 자원').latency, 210);
assert.strictEqual(D.span(3.5 * 1440), '3.5일');
assert.strictEqual(D.span(210), '3.5시간');

// budget 이력: start · extend · done 이 .agents/history/budget.jsonl 에, report 가 월간 집계
const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-defects-')));
fs.writeFileSync(path.join(ws, 'workspace.json'), '{}');
const run = (...a) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'budget.js'), ...a], { cwd: ws, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ws } });
assert.strictEqual(run('start', '주문 탭', '30m').status, 0);
assert.strictEqual(run('extend', '주문 탭', '10').status, 0);
assert.strictEqual(run('done', '주문 탭').status, 0);
const log = B.readLog(ws);
assert.deepStrictEqual(log.map((e) => e.event), ['start', 'extend', 'done']);
assert.strictEqual(log[2].minutes, 40);
assert.ok(fs.existsSync(path.join(ws, '.agents', 'history', 'budget.jsonl')));
const month = B.monthOf(Date.now());
const rep = run('report', '--json');
assert.strictEqual(rep.status, 0);
assert.strictEqual(JSON.parse(rep.stdout).done, 1);
assert.match(run('report').stdout, new RegExp(`시간 예산 ${month}: 끝낸 작업 1건 · 예산 초과 0건 \\(0%\\)`));
assert.notStrictEqual(run('report', '--month', '11월').status, 0);
const t0 = new Date('2026-11-02T09:00:00').getTime();
const entries = [
  { event: 'start', name: 'a', minutes: 30, start: t0, at: t0 },
  { event: 'done', name: 'a', minutes: 30, start: t0, elapsed: 20, at: t0 + 20 * 60000 },
  { event: 'done', name: 'b', minutes: 30, start: t0, elapsed: 60, at: t0 + 60 * 60000 },
  { event: 'done', name: 'c', minutes: 60, start: t0, elapsed: 70, at: t0 + 70 * 60000 },
  { event: 'start', name: 'd', minutes: 30, start: t0, at: t0 },
  { event: 'done', name: 'e', minutes: 30, start: t0, elapsed: 5, at: new Date('2026-10-30T09:00:00').getTime() },
];
const br = B.report(entries, '2026-11', t0 + 3 * 86400000);
assert.deepStrictEqual([br.done, br.over, br.over15, br.medianElapsed, br.unclosed], [3, 2, 1, 60, 1]);
assert.ok(Math.abs(br.overRate - 2 / 3) < 1e-9);

// defects.js check · report (작업별 기록에서)
const topics = path.join(ws, 'handoffs', 'kim', 'topics');
fs.mkdirSync(topics, { recursive: true });
fs.writeFileSync(path.join(topics, 'OPS-1.md'), head({ status: '완료', body: '발견: 2026-11-03 10:00\n해소: 2026-11-03 12:00\n분류: 수명\n' }));
fs.writeFileSync(path.join(topics, '주문-탭.md'), '관련: 주문\n상태: 진행 중\n');
const dx = (...a) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'defects.js'), ...a], { cwd: ws, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: ws } });
assert.strictEqual(dx('check').status, 0);
assert.match(dx('report', '--month', '2026-11').stdout, /운영 결함 2026-11: 1건 \(해소 안 됨 0\)/);
fs.writeFileSync(path.join(topics, 'OPS-2.md'), head({ status: '완료', body: '발견: 2026-11-05\n' }));
const bad = dx('check');
assert.strictEqual(bad.status, 1);
assert.match(bad.stdout, /OPS-2\.md: 분류\(분류:\)가 없다/);
assert.match(bad.stdout, /OPS-2\.md: 상태가 완료인데 해소 시각/);
fs.rmSync(ws, { recursive: true, force: true });
console.log('defects.test.js ok');
