// writes.js · lib/writes.js 점검 (임시 폴더만 쓴다). 실행: node writes.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const W = require('../lib/writes');
const C = require('./writes');

const cases = [];
const it = (name, fn) => cases.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-writes-'));
const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

/** 가짜 팩 폴더: jooq 기록기(manifest · 공통 파일 · core 화면 · properties 합치기) */
function fakePacks() {
  const p = tmp();
  const wr = path.join(p, 'stack-spring', 'assets', 'write-report');
  put(path.join(wr, 'common', 'WriteRecorder.java'), 'package __BASE_PACKAGE__.writereport;\nclass WriteRecorder {}\n');
  put(path.join(wr, 'jooq', 'JooqWriteListener.java'), 'package __BASE_PACKAGE__.writereport;\nclass JooqWriteListener {}\n');
  put(path.join(wr, 'common', 'write-report.properties'), 'output=build/write-report\nids=\n');
  put(path.join(p, 'core', 'assets', 'write-report', 'viewer.html'), '<html>/*__WRITE_REPORT_DATA__*/null</html>\n');
  put(path.join(wr, 'jooq', 'manifest.json'), JSON.stringify({
    title: 'Java · jOOQ',
    files: [
      { from: 'common/WriteRecorder.java', to: 'src/test/java/__BASE_PATH__/writereport/WriteRecorder.java' },
      { from: 'jooq/JooqWriteListener.java', to: 'src/test/java/__BASE_PATH__/writereport/JooqWriteListener.java' },
      { from: 'core:viewer.html', to: 'src/test/resources/write-report/viewer.html' },
      { from: 'common/write-report.properties', to: 'src/test/resources/write-report.properties', merge: 'properties' },
    ],
    deps: ['testImplementation 없음 (jOOQ 는 이미 있음)'],
    after: ['시험 기반 클래스에 @ExtendWith(WriteReportExtension.class)'],
    run: './gradlew test',
    approve: './gradlew test -DwriteReport.approve=true',
  }));
  fs.mkdirSync(path.join(p, 'backend'), { recursive: true });
  return p;
}

const FEATURE = `# 매출 기능

## FN-SAL-003 일 매출 집계

| 항목 | 내용 |
|---|---|
| 근거 | REQ-001 |

### 저장

| 스키마.테이블.컬럼 | 값 출처 | 조건 | 기본값 |
|---|---|---|---|
| shop.daily_sales.store_id | 입력 필드 storeId | 항상 | 없음 |
| shop.daily_sales.avg_price | shop.orders.amount 의 평균 | 행 없음이면 0 | 0 |
| shop.daily_sales.note | 상수 null | 항상 | null |
| shop.daily_sales.closed_at | 계산 | 마감한 날만 | null |

### 수용 기준

| ID | 조건 | 결과 |
|---|---|---|
| AC-SAL-003-1 | 주문이 있으면 | 평균을 저장 |

## FN-SAL-004 환불 조회

### 저장

없음
`;

const REPORT = {
  format: 1, generatedAt: '2026-11-05T10:03:00+09:00', repo: 'api', stack: 'jooq',
  tests: [
    { id: 'a.DailyTest#saves', group: 'a.DailyTest', name: 'saves', specs: ['AC-SAL-003-1'], status: 'passed', writes: [
      { seq: 1, op: 'INSERT', table: 'shop.daily_sales', rows: [{ store_id: 'S01', avg_price: 12345.678, note: null, memo: 'x' }], result: { rows: 1 } },
      { seq: 2, op: 'UPDATE', table: 'shop.daily_sales', set: { store_id: '<text:12>' }, where: { id: 1 }, result: { rows: 1 } },
    ] },
    { id: 'a.RefundTest#reads', group: 'a.RefundTest', name: 'reads', specs: ['FN-SAL-004'], status: 'passed', writes: [
      { seq: 1, op: 'DELETE', table: 'shop.refund_cache', where: { id: 3 }, result: { rows: 1 } },
    ] },
    { id: 'a.OtherTest#x', group: 'a.OtherTest', name: 'x', specs: [], status: 'passed', writes: [
      { seq: 1, op: 'SQL', table: 'shop.daily_sales', sql: 'INSERT INTO shop.daily_sales SELECT ?', result: { rows: 2 } },
    ] },
  ],
  catalog: { shop: {
    daily_sales: { columns: [{ name: 'store_id', type: 'character varying(10)' }, { name: 'avg_price', type: 'numeric(7,2)' }, { name: 'note', type: 'text' }, { name: 'memo', type: 'text' }, { name: 'closed_at', type: 'timestamp' }], primaryKey: ['store_id'] },
    orders: { columns: [{ name: 'amount', type: 'numeric(12,2)' }] },
  } },
};

/** 워크스페이스: repos/api(spring) · repos/plans(docs) · 보고서 */
function workspace(opts = {}) {
  const root = tmp();
  const repos = [{ name: 'api', stack: 'spring' }, { name: 'plans', kind: 'docs' }, ...(opts.repos || [])];
  for (const r of repos) fs.mkdirSync(path.join(root, 'repos', r.name), { recursive: true });
  put(path.join(root, 'workspace.json'), JSON.stringify({ project: { name: 't' }, packs: ['core'], repos, vars: opts.vars || { spring: { basePackage: 'com.acme.shop' } } }));
  put(path.join(root, 'repos', 'plans', '20-features', 'sales.md'), FEATURE);
  if (opts.report !== false) {
    put(path.join(root, 'repos', 'api', 'build', 'write-report', 'index.json'), JSON.stringify(REPORT));
    put(path.join(root, 'repos', 'api', 'build', 'write-report', 'index.html'), '<html></html>');
  }
  return root;
}
const run = (root, args, packs) => spawnSync(process.execPath, [path.join(__dirname, 'writes.js'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '', KEDOVI_NO_OPEN: '1', ...(packs ? { KEDOVI_WRITES_PACKS: packs } : {}) } });

it('add jooq: manifest 대로 복사 · 토큰 채움 · core 화면 · 다음 할 일', () => {
  const packs = fakePacks();
  const root = workspace({ report: false });
  const r = run(root, ['add', 'jooq'], packs);
  assert.strictEqual(r.status, 0, r.stderr);
  const dir = path.join(root, 'repos', 'api', 'src', 'test', 'java', 'com', 'acme', 'shop', 'writereport');
  assert.ok(fs.readFileSync(path.join(dir, 'WriteRecorder.java'), 'utf8').startsWith('package com.acme.shop.writereport;'));
  assert.ok(fs.existsSync(path.join(root, 'repos', 'api', 'src', 'test', 'resources', 'write-report', 'viewer.html')));
  assert.ok(/의존성: testImplementation/.test(r.stdout) && /@ExtendWith/.test(r.stdout) && /실행: \.\/gradlew test/.test(r.stdout) && /기대값 고정: .*approve=true/.test(r.stdout), r.stdout);
});

it('add: 있는 파일은 덮지 않고, properties 는 없는 키만 더한다', () => {
  const packs = fakePacks();
  const root = workspace({ report: false });
  const props = path.join(root, 'repos', 'api', 'src', 'test', 'resources', 'write-report.properties');
  put(props, 'output=out/wr\n');
  const java = path.join(root, 'repos', 'api', 'src', 'test', 'java', 'com', 'acme', 'shop', 'writereport', 'WriteRecorder.java');
  put(java, '// 내가 고친 것');
  const r = run(root, ['add', 'jooq'], packs);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(java, 'utf8'), '// 내가 고친 것');
  const p = fs.readFileSync(props, 'utf8');
  assert.ok(p.startsWith('output=out/wr\n') && /\nids=\n/.test(p) && (p.match(/^output=/gm) || []).length === 1, p);
  assert.ok(/키 더함 ids/.test(r.stdout) && /있음 \(덮지 않음\)/.test(r.stdout), r.stdout);
  // 두 번째는 더할 키가 없다
  const r2 = run(root, ['add', 'jooq', '--json'], packs);
  const j = JSON.parse(r2.stdout);
  assert.ok(j.files.every((f) => !f.written), r2.stdout);
});

it('합치기: properties 는 없는 키만 · spring.factories 는 값 목록에 덧붙인다', () => {
  let r = C.mergeProperties('a=1\n# c\n', 'a=2\nb=3\n');
  assert.strictEqual(r.text, 'a=1\n# c\n# kedovi writes add 가 더함\nb=3\n');
  assert.deepStrictEqual(r.added, ['b']);
  r = C.mergeProperties('x.Listener=a.One,\\\n  a.Two\nother=z\n', 'x.Listener=w.Mine\n', true);
  assert.strictEqual(r.text, 'x.Listener=a.One,a.Two,w.Mine\nother=z\n');
  assert.strictEqual(C.mergeProperties(r.text, 'x.Listener=w.Mine\n', true).added.length, 0);
});

it('add --dry-run: 쓰지 않는다 · --dir 은 모듈 아래로', () => {
  const packs = fakePacks();
  const root = workspace({ report: false });
  const r = run(root, ['add', 'jooq', '--dir', 'batch', '--dry-run', '--json'], packs);
  assert.strictEqual(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.ok(j.files[0].path.startsWith('batch/src/test/java/com/acme/shop/'), j.files[0].path);
  assert.ok(!fs.existsSync(path.join(root, 'repos', 'api', 'batch')));
});

it('add: 팩 · 기록기 · repo 가 없으면 알린다', () => {
  const packs = fakePacks();
  const root = workspace({ report: false });
  let r = run(root, ['add', 'sqlalchemy'], packs);
  assert.strictEqual(r.status, 1);
  assert.ok(/fastapi · django · flask · python 중 하나가 든 repo 가 없습니다/.test(r.stderr), r.stderr);
  r = run(root, ['add', 'jdbc'], packs);
  assert.ok(r.status === 1 && /jdbc 기록기가 없습니다/.test(r.stderr), r.stderr);
  fs.rmSync(path.join(packs, 'backend'), { recursive: true });
  const root2 = workspace({ report: false, repos: [{ name: 'py', stack: 'flask' }] });
  r = run(root2, ['add', 'sqlalchemy'], packs);
  assert.ok(r.status === 1 && /backend 팩이 없습니다/.test(r.stderr), r.stderr);
  assert.strictEqual(run(root, ['add', 'mybatis'], packs).status, 2);
});

it('repo 고르기: python 계열 · node 계열 · --repo', () => {
  const ws = { vars: {}, repos: [{ name: 'web', stack: 'react' }, { name: 'py', stack: ['django'] }, { name: 'srv', stack: 'nestjs' }] };
  assert.strictEqual(C.pickRepo(ws, 'sqlalchemy').name, 'py');
  assert.strictEqual(C.pickRepo(ws, 'node-pg').name, 'srv');
  assert.strictEqual(C.pickRepo(ws, 'node-pg', 'web').name, 'web');
  assert.strictEqual(C.values({ vars: { fastapi: { package: 'svc' } } }, 'sqlalchemy', {}).tokens.__PACKAGE__, 'svc');
});

it('저장 표 읽기: 기능 절 · 수용 기준 ID · 「없음」', () => {
  const f = W.features({ 'p/sales.md': FEATURE });
  assert.deepStrictEqual(f.map((x) => x.id), ['FN-SAL-003', 'FN-SAL-004']);
  assert.ok(f[0].ids.has('AC-SAL-003-1'));
  assert.strictEqual(f[0].save.rows.length, 4);
  assert.deepStrictEqual(f[0].save.rows[1], { target: 'shop.daily_sales.avg_price', schema: 'shop', table: 'daily_sales', column: 'avg_price', source: 'shop.orders.amount 의 평균', cond: '행 없음이면 0', def: '0', line: 14 });
  assert.ok(f[1].save.none && !f[1].save.rows.length);
});

it('타입 범위: numeric · varchar · 정수, 값 출처 너비', () => {
  assert.strictEqual(W.valueRisk('numeric(7,2)', 12345.678).level, '⚠');   // 정수 5자리 = 한도, 소수는 반올림
  assert.strictEqual(W.valueRisk('numeric(7,2)', 123456.1).level, '✖');
  assert.strictEqual(W.valueRisk('numeric(7,2)', 12.5), null);
  assert.strictEqual(W.valueRisk('varchar(10)', '<text:12>').level, '✖');
  assert.strictEqual(W.valueRisk('character varying(3)', 'abc').level, '⚠');
  assert.strictEqual(W.valueRisk('varchar(3)', '***'), null);
  assert.strictEqual(W.valueRisk('smallint', 40000).level, '✖');
  assert.strictEqual(W.valueRisk('varchar(3)', { $sql: 'now()' }), null);
  assert.strictEqual(W.valueRisk('varchar(3)', { $bytes: 10 }), null);
  assert.strictEqual(W.showValue({ $sql: 'now()' }), '식 now()');
  assert.strictEqual(W.showValue({ $bytes: 4 }), '바이트 4');
  assert.ok(W.wider('numeric(12,2)', 'numeric(7,2)') && !W.wider('numeric(5,2)', 'numeric(7,2)'));
  assert.ok(W.wider('text', 'varchar(20)') && W.wider('bigint', 'integer') && !W.wider('integer', 'text'));
});

it('check: 표에 없는 쓰기 · 안 쓴 컬럼 · 타입 범위 · 「없음」 인데 씀 · 기능 ID 없는 시험', () => {
  const res = W.check(REPORT, W.features({ 'p/sales.md': FEATURE }));
  const g3 = res.groups.find((g) => g.id === 'FN-SAL-003');
  assert.deepStrictEqual(g3.unlisted.map((u) => `${u.table}.${u.column}`), ['shop.daily_sales.memo']);
  assert.deepStrictEqual(g3.unused.map((u) => u.target), ['shop.daily_sales.closed_at']);
  const risks = g3.risks.map((r) => `${r.level} ${r.column} ${r.why}`);
  assert.ok(risks.some((r) => /^✖ store_id 길이 12 > 10/.test(r)), risks.join('\n'));
  assert.ok(risks.some((r) => /^⚠ avg_price/.test(r)), risks.join('\n'));
  assert.ok(risks.some((r) => /^✖ avg_price 값 출처 shop\.orders\.amount numeric\(12,2\)/.test(r)), risks.join('\n'));
  const g4 = res.groups.find((g) => g.id === 'FN-SAL-004');
  assert.deepStrictEqual(g4.unlisted.map((u) => `${u.table}.${u.column}`), ['shop.refund_cache.*']);
  const none = res.groups.find((g) => g.id === null);
  assert.strictEqual(none.unknown, 1);
  assert.strictEqual(res.violations, 4); // memo · store_id 길이 · avg_price 값 출처 · refund_cache 삭제
});

it('kedovi writes check: 출력 · --json · --strict · --report', () => {
  const root = workspace();
  let r = run(root, ['check']);
  assert.strictEqual(r.status, 0, r.stderr);
  for (const s of ['■ 보고서: api · jooq · 시험 3개', '✖ FN-SAL-003 일 매출 집계', '■ 표에 없는 쓰기 1', 'shop.daily_sales.memo', '■ 안 쓴 컬럼 1', '■ 타입 범위 위험', '저장 표가 「없음」 인데 시험이 썼습니다', '컬럼을 모르는 문장 1개', '✖ 위반 4건']) assert.ok(r.stdout.includes(s), `${s}\n${r.stdout}`);
  r = run(root, ['check', '--strict']);
  assert.strictEqual(r.status, 1);
  r = run(root, ['check', '--json']);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.violations, 4);
  assert.strictEqual(j.reports[0].repo, 'api');
  const other = path.join(tmp(), 'index.json');
  put(other, JSON.stringify({ ...REPORT, tests: [REPORT.tests[0]] }));
  r = run(root, ['check', '--report', other, '--json']);
  assert.strictEqual(JSON.parse(r.stdout).violations, 3, r.stdout);
});

it('check · open: 보고서가 없으면 만드는 법', () => {
  const root = workspace({ report: false });
  let r = run(root, ['check']);
  assert.strictEqual(r.status, 0);
  assert.ok(/보고서 없음.*kedovi writes add/.test(r.stdout), r.stdout);
  assert.strictEqual(run(root, ['check', '--strict']).status, 1);
  r = run(root, ['open']);
  assert.ok(r.status === 1 && /보고서 없음/.test(r.stdout));
});

it('open: 화면 경로 · 모듈 아래 보고서도 찾는다', () => {
  const root = workspace({ report: false });
  put(path.join(root, 'repos', 'api', 'batch', 'target', 'write-report', 'index.json'), JSON.stringify(REPORT));
  put(path.join(root, 'repos', 'api', 'batch', 'target', 'write-report', 'index.html'), '<html></html>');
  const r = run(root, ['open']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/^api\/batch: .*batch\/target\/write-report\/index\.html/.test(r.stdout), r.stdout);
});

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`✔ ${name}`); } catch (e) { failed++; console.log(`✖ ${name}\n  ${e.stack.split('\n').slice(0, 3).join('\n  ')}`); }
}
process.exit(failed ? 1 : 0);
