// extremes.js · lib/extremes.js 점검 (임시 폴더만 쓴다). 실행: node extremes.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const X = require('../lib/extremes');

const cases = [];
const it = (name, fn) => cases.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-extremes-'));
const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const TOOL = path.join(__dirname, 'extremes.js');
const run = (cwd, args) => spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });

// psql \gexec --csv 출력 모양 (표마다 머리 줄이 다시 나온다)
const CSV = [
  'table_name,column_name,column_type,row_count,null_count,max_len,max_bytes,min_value,max_value',
  'orders,id,integer,2,0,,,1,2100000000',
  'orders,code,character varying(10),2,0,10,10,,',
  'orders,memo,text,2,1,3,9,,',
  'orders,amount,"numeric(8,2)",2,0,,,-5.50,999999.99',
  'orders,qty,smallint,2,0,,,1,100',
  'orders,name,character varying(20),2,1,19,55,,',
  'table_name,column_name,column_type,row_count,null_count,max_len,max_bytes,min_value,max_value',
  'Weird Name,Col A,character varying(5),1,0,3,3,,',
  'Weird Name,ratio,double precision,1,0,,,0.1,0.9',
].join('\n');

it('parseStats: 반복 머리 줄 · 따옴표 칸 · 빈 값은 null', () => {
  const s = X.parseStats(CSV);
  assert.strictEqual(s.length, 8);
  assert.deepStrictEqual(s[3], { table: 'orders', column: 'amount', type: 'numeric(8,2)', rows: 2, nulls: 0, maxLen: null, maxBytes: null, min: '-5.50', max: '999999.99', line: 5 });
  assert.strictEqual(s[6].table, 'Weird Name');
  assert.throws(() => X.parseStats('a,b\n1,2'), /칸이 없습니다/);
  assert.strictEqual(X.parseStats(CSV.replace(/,/g, '\t').replace('"numeric(8\t2)"', 'numeric(8,2)')).length, 8);
});
it('check(DB 타입): 꽉 찬 varchar · 한도 근처 숫자 · 정수 최댓값 근처 · 여유 있는 칸은 조용', () => {
  const r = X.check(X.parseStats(CSV), { warnRatio: 0.9 });
  const by = Object.fromEntries(r.items.map((x) => [`${x.table}.${x.column}`, x]));
  assert.match(by['orders.code'].why, /= 한도/);
  assert.match(by['orders.amount'].why, /999999\.99/);
  assert.match(by['orders.id'].why, /2147483647/);
  assert.match(by['orders.name'].why, /19 \/ 20/);
  assert.ok(!by['orders.qty'] && !by['orders.memo'] && !by['Weird Name.Col A']);
  assert.strictEqual(r.skipped, 1); // double precision
  assert.ok(r.items.every((x) => x.level === '⚠'));
});
it('check(대상 정의): 좁은 새 정의 · NOT NULL 위반 · 소수 자리는 ✖ · ⚠', () => {
  const def = { code: { type: 'varchar(8)', nullable: false }, name: { type: 'varchar(30)', nullable: false }, amount: { type: 'numeric(7,1)' } };
  const target = (t, c) => (def[c] ? { ...def[c], from: '데이터 설계' } : null);
  const r = X.check(X.parseStats(CSV), { warnRatio: 0.9, target });
  const msgs = r.items.map((x) => `${x.level} ${x.column}: ${x.why}`).join('\n');
  assert.match(msgs, /✖ code: 최대 길이 10 > 8/);
  assert.match(msgs, /✖ name: null 1건인데 정의는 NOT NULL/);
  assert.match(msgs, /⚠ amount: 소수 2자리 > 1자리/);
  assert.match(msgs, /⚠ amount: 값 999999\.99/);
});
it('fixture: 글자는 합성(길이 · 바이트 맞춤) · 숫자는 극값 · null 행은 null 있는 칸만', () => {
  const f = X.fixture(X.parseStats(CSV));
  const [max, min, nulls] = f.tables.orders;
  assert.strictEqual(max.code, 'x'.repeat(10));
  assert.strictEqual([...max.name].length, 19);
  assert.strictEqual(Buffer.byteLength(max.name), 55);
  assert.strictEqual(max.id, 2100000000);
  assert.strictEqual(max.amount, '999999.99');
  assert.strictEqual(min.amount, '-5.50');
  assert.strictEqual(nulls.memo, null);
  assert.strictEqual(nulls.code, max.code);
  assert.strictEqual(f.tables['Weird Name'].length, 2); // null 없는 표는 nulls 행 없음
  assert.ok(!JSON.stringify(f).includes('홍'));
  assert.deepStrictEqual(Object.keys(X.fixture(X.parseStats(CSV), { tables: ['orders'] }).tables), ['orders']);
});

it('명령: add 는 SQL 을 넣고 덮지 않는다 · check --against design · --strict · fixture --out', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'repos', 'api'), { recursive: true });
  put(path.join(root, 'repos', 'plan', 'data', 'app.md'), [
    '### app.orders 주문',
    '주문. 기능: 없음',
    '',
    '| 컬럼 | 논리명 | 타입 | 널 | 키 | 참조 | 설명 |',
    '|---|---|---|---|---|---|---|',
    '| id | ID | integer | N | PK | | |',
    '| code | 코드 | varchar(8) | N | | | |',
    '| name | 이름 | varchar(30) | Y | | | |',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'workspace.json'), JSON.stringify({ project: { name: 't' }, packs: ['core', 'backend'], repos: [{ name: 'api', stack: 'spring' }, { name: 'plan', kind: 'docs' }], vars: {} }));
  let r = run(root, ['add', 'postgres', '--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\+ 만들 파일 tools\/extremes\/profile-postgres\.sql/);
  r = run(root, ['add', 'postgres']);
  assert.ok(fs.readFileSync(path.join(root, 'repos/api/tools/extremes/profile-postgres.sql'), 'utf8').includes('\\gexec'));
  assert.match(run(root, ['add', 'postgres']).stdout, /있음 \(덮지 않음\)/);
  assert.strictEqual(run(root, ['add', 'oracle']).status, 2);
  const csv = path.join(root, 'extremes.csv');
  fs.writeFileSync(csv, CSV);
  r = run(root, ['check', csv]);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /비교 대상 DB 지금 타입/);
  r = run(root, ['check', csv, '--against', 'design', '--strict']);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /✖ orders\.code varchar\(8\) \(데이터 설계\): 최대 길이 10 > 8/);
  r = run(root, ['check', csv, '--json']);
  assert.strictEqual(JSON.parse(r.stdout).columns, 8);
  r = run(root, ['fixture', csv, '--out', path.join(root, 'out', 'extremes.json')]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'out', 'extremes.json'), 'utf8')).tables.orders);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`✔ ${name}`); } catch (e) { failed++; console.log(`✖ ${name}\n${e.stack || e}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} 통과`);
  process.exit(failed ? 1 : 0);
})();
