// check-datamodel.js · lib/datamodel.js · ERD 생성 점검: 정의서 읽기 · 「없음」 · 컨벤션 · 임시 기획 repo 에서 ERD 만들기 → 검사 · DDL. 실행: node check-datamodel.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const DM = require('../../core/lib/datamodel');
const { ddl } = require('../assets/erd/ddl');
const { checkModel, noTableIds } = require('./check-datamodel');

const ASSETS = path.join(__dirname, '..', 'assets', 'erd');
const tpl = fs.readFileSync(path.join(ASSETS, 'template.md'), 'utf8');

// 견본: 오류 · 주의 없음 (권장 컨벤션)
const m = DM.model({ 'shop.md': tpl });
assert.deepStrictEqual(m.tables.map((t) => t.id), ['shop.member', 'shop.orders', 'shop.order_item', 'shop.coupon']);
assert.strictEqual(m.rels.length, 3);
const conv = { naming: 'snake_case', pkType: 'bigint', auditColumns: 'created_at,updated_at', timeType: 'timestamptz' };
assert.deepStrictEqual(DM.check(m, conv), { errors: [], warns: [] }, '견본은 깨끗하다');
// 주제 영역 · 분류 · ERD 꼬리표, 영역이 일부에만 있으면 ⚠
{
  const t = (id) => m.tables.find((x) => x.id === id);
  assert.deepStrictEqual(t('shop.coupon').areas, ['주문', '회원']);
  assert.strictEqual(t('shop.orders').partition, 'created_at 월 단위', '영역 꼬리표가 다른 꼬리표를 깨지 않는다');
  const p = DM.parseFile('### a.code 코드\n값 목록. 분류: 코드 · ERD: 선 숨김\n\n| 컬럼 | 타입 | 키 |\n|---|---|---|\n| id | int | PK |\n\n### a.b 비\n설명. 영역: 주문\n\n| 컬럼 | 타입 | 키 |\n|---|---|---|\n| id | int | PK |\n', 'a.md');
  assert.ok(p.tables[0].code && p.tables[0].hideEdges && !p.tables[1].code);
  assert.match(DM.check(DM.model({ 'a.md': '### a.code 코드\n값. 분류: 코드\n\n| 컬럼 | 타입 | 키 |\n|---|---|---|\n| id | int | PK |\n\n### a.b 비\n설명. 영역: 주문\n\n| 컬럼 | 타입 | 키 |\n|---|---|---|\n| id | int | PK |\n' })).warns[0], /영역 꼬리표가 1\/2 테이블에만 있습니다. 없는 테이블: a\.code/);
}
const has = (list, re) => assert.ok(list.some((x) => re.test(x)), `${re} 없음:\n${list.join('\n')}`);
// 논리 참조 · 고정 스키마 · JSON 사유 · 영역 뒤 모르는 꼬리표
{
  assert.deepStrictEqual(m.lrels, [{ from: 'shop.member', fromCol: 'id', to: 'shop.coupon', toCol: 'issued_to', nullable: true, logical: true }], '견본의 논리 참조');
  const H = '| 컬럼 | 논리명 | 타입 | 널 | 키 | 참조 | 설명 |\n|---|---|---|---|---|---|---|\n';
  const src = [
    '### b.job_params 실행 파라미터', '파라미터. 기능: 없음 · 영역: 배치 실행 · 예외: 표준 그대로 · 고정 스키마: Spring Batch 6 표준 스크립트', '', H + '| JOB_ID | 작업 | BIGINT | N | | | |\n| create_time | 생성 | timestamp | N | | | |\n',
    '### b.item 항목', '항목. 기능: 없음 · 영역: 배치 실행', '', H + '| id | ID | bigint | N | PK | | |\n| sym | 종목 | varchar(6) | N | | 논리: b.sym | |\n| sym2 | 종목2 | varchar(6) | N | | 논리: b.sym.code | |\n| gone | 없음 | bigint | N | | 논리: x.none.id | |\n| raw | 원문 | jsonb | Y | | | 외부 원문 |\n| ok | 메타 | jsonb | Y | | | JSON 허용: 종류별 메타데이터 |\n| old | 옛 | bigint | N | | b.sym.id | |\n| both | 둘 | bigint | N | FK | 논리: b.sym.id | |\n| created_at | 생성 | timestamptz | N | | | |\n| updated_at | 수정 | timestamptz | N | | | |\n',
    '### b.sym 종목', '종목. 기능: 없음 · 영역: 종목', '', H + '| id | ID | bigint | N | PK | | |\n| code | 코드 | varchar(6) | N | UK | | |\n| created_at | 생성 | timestamptz | N | | | |\n| updated_at | 수정 | timestamptz | N | | | |\n',
  ].join('\n');
  const mm = DM.model({ 'b.md': src });
  const jp = mm.tables[0];
  assert.strictEqual(jp.fixed, 'Spring Batch 6 표준 스크립트');
  assert.deepStrictEqual(jp.areas, ['배치 실행'], '영역 뒤 모르는 꼬리표(예외: …)는 영역이 아니다');
  assert.deepStrictEqual(mm.lrels.map((r) => `${r.to}.${r.toCol}>${r.from}.${r.fromCol}`), ['b.item.sym>b.sym.', 'b.item.sym2>b.sym.code'], '테이블까지만 · 컬럼까지, 대상 없는 것은 빼고');
  const rr = DM.check(mm, { naming: 'snake_case', pkType: 'bigint', auditColumns: 'created_at,updated_at', timeType: 'timestamptz', jsonReason: 'Y' });
  assert.deepStrictEqual(rr.errors, [], '고정 스키마의 기본키 없음은 ✖ 가 아니다');
  has(rr.warns, /b\.job_params: 기본키\(PK\)가 없습니다 \(고정 스키마: Spring Batch 6/);
  assert.ok(!rr.warns.some((x) => /job_params.*(이름 규칙|공통 컬럼|시점 타입)/.test(x)), '고정 스키마는 이름 · 공통 컬럼 · 타입 규칙을 보지 않는다');
  has(rr.warns, /b\.item\.gone: 논리 참조 테이블 x\.none 이 정의서에 없습니다/);
  has(rr.warns, /b\.item\.raw: JSON 컬럼\(jsonb\)인데 설명에 「JSON 허용: <사유>」 가 없습니다/);
  assert.ok(!rr.warns.some((x) => /item\.(ok|sym|sym2):/.test(x)), 'JSON 허용 사유 · 맞는 논리 참조는 조용하다');
  has(rr.warns, /b\.item\.old: 참조\(b\.sym\.id\)가 있는데 키에 FK 가 없습니다 \(DB 외래키 없이 앱이 지키면 참조 칸에 「논리: b\.sym\.id」\)/);
  has(rr.warns, /b\.item\.both: FK 인데 참조가 「논리:」 입니다/);
  assert.ok(!DM.check(mm, { jsonReason: '' }).warns.some((x) => /JSON/.test(x)), 'jsonReason 이 비면 JSON 검사 안 함');
  assert.match(ddl({ title: 'b', tables: mm.tables }, ['b'], {}), /-- 논리 참조: DB 외래키 없이 앱이 지킨다[^\n]*\n--   b\.item\.sym -> b\.sym\n--   b\.item\.sym2 -> b\.sym\.code/);
}
const coupon = m.tables.find((t) => t.id === 'shop.coupon');
assert.ok(coupon.noFns && !coupon.fns.length, '「기능: 없음 (… D-4)」 는 기능 없음, 괄호 안 ID 는 기능이 아니다');
assert.ok(m.tables.find((t) => t.id === 'shop.order_item').noAudit, '「공통 컬럼: 없음」');
assert.ok(m.tables.find((t) => t.id === 'shop.orders').nullable !== true && m.tables.find((t) => t.id === 'shop.orders').columns.find((c) => c.name === 'coupon_id').nullable, '널 Y');
for (const f of fs.readdirSync(ASSETS).filter((x) => /\.(js|css|html|md)$/.test(x) && x !== 'elk.bundled.js')) assert.ok(!/—/.test(fs.readFileSync(path.join(ASSETS, f), 'utf8')), `${f}: 장식용 대시 없음`);

// 깨진 정의서: ✖ 와 ⚠
const bad = [
  '### a.t1 하나', '', '| 컬럼 | 논리명 | 타입 | 널 | 키 | 참조 | 설명 |', '|---|---|---|---|---|---|---|',
  '| id | ID | int | N | | | |', '| b_id | B | bigint | N | FK | a.nope.id | |', '| c_id | | bigint | N | FK | a.t2.zz | |', '| x | X | int | N | | | |', '| x | X | int | N | | | |',
  '', '#### 인덱스', '| 이름 | 컬럼 |', '|---|---|', '| ix | id |', '',
  '### a.t2', '기능: FN-404', '', '| 컬럼 | 타입 |', '|---|---|', '| id | int | PK |', '| Bad | int |', '',
  '### a.t2 또', '| 이름 | 값 |', '|---|---|',
].join('\n');
const mb = DM.model({ 'a.md': bad });
assert.strictEqual(mb.tables.find((t) => t.id === 'a.t1').columns.length, 5, '컬럼 표 뒤 인덱스 표는 컬럼이 아니다');
const rb = DM.check(mb, { naming: 'snake_case', pkType: 'bigint' });
has(rb.errors, /a\.t1: 기본키\(PK\)가 없습니다/);
has(rb.errors, /참조 테이블 a\.nope 이 없습니다/);
has(rb.errors, /참조 컬럼 a\.t2\.zz 이 없습니다/);
has(rb.errors, /a\.t1\.x: 같은 이름 컬럼/);
has(rb.errors, /칸 수가 머리\(2\)와 다릅니다/);
has(rb.errors, /같은 이름 테이블이 또 있습니다/);
has(rb.errors, /컬럼 표 머리에/);
has(rb.warns, /a\.t1\.c_id: 컬럼 논리명이 없습니다/);
has(rb.warns, /a\.t2: 테이블 논리명이 없습니다/);
has(rb.warns, /a\.t2\.Bad: 컬럼 이름 규칙/);
has(rb.warns, /a\.t1: 이 테이블을 쓰는 기능 ID 가 없습니다/);

// 기능 대조: 엔티티 목록의 「없음」 줄은 세지 않는다
const readme = '# 데이터\n\n| 엔티티 | 테이블 | 기능 ID |\n|---|---|---|\n| 시세 보기 | 없음 (외부 API) | FN-MEM-009 |\n';
assert.deepStrictEqual([...noTableIds({ 'README.md': readme })], ['FN-MEM-009']);
const index = { ids: Object.fromEntries(['FN-MEM-001', 'FN-MEM-002', 'FN-ORD-001', 'FN-MEM-009', 'FN-MEM-010'].map((x) => [x, [`f.html#${x}`]])) };
const rc = checkModel(m, { 'README.md': readme, 'shop.md': tpl }, index, {}, ['FN']);
assert.deepStrictEqual(rc.warns, ['기능 1/5개가 어느 테이블에도 없습니다: FN-MEM-010 (저장하지 않는 기능이면 엔티티 목록에 「테이블 없음」, 스프린트 방식에서 미룬 기능이면 「다음 스프린트」 로 적는다)']);
// 스프린트 방식: 「다음 스프린트」 줄의 기능도 세지 않는다
const later = `${readme}| (나중에) | 다음 스프린트 | FN-MEM-010 |\n`;
assert.deepStrictEqual(checkModel(m, { 'README.md': later, 'shop.md': tpl }, index, {}, ['FN']).warns, []);

// DDL: 범위 밖 FK 는 주석, 외래키를 DB 에 안 걸면 모두 주석, MySQL 은 COMMENT 를 컬럼에
const two = DM.model({ 'shop.md': tpl, 'pay.md': '### pay.receipt 영수증\n기능: FN-ORD-001\n\n| 컬럼 | 논리명 | 타입 | 널 | 키 | 참조 | 설명 |\n|---|---|---|---|---|---|---|\n| id | ID | bigint | N | PK | | |\n| order_id | 주문 | bigint | N | FK | shop.orders.id | |\n' });
two.title = '견본';
const pg = ddl(two, ['pay'], {});
assert.match(pg, /CREATE SCHEMA IF NOT EXISTS pay;/);
assert.match(pg, /-- 참조 대상 스키마가 내보내기 범위 밖: ALTER TABLE pay\.receipt/);
assert.match(pg, /검토용\. 실제 변경은 마이그레이션 도구로/);
assert.match(ddl(two, two.schemas, {}), /^ALTER TABLE pay\.receipt ADD CONSTRAINT fk_receipt_order_id FOREIGN KEY \(order_id\) REFERENCES shop\.orders \(id\);$/m);
assert.ok(!/^ALTER/m.test(ddl(two, two.schemas, { fkInDb: false })), 'fkInDb false 면 외래키는 주석');
assert.match(ddl(two, two.schemas, { dialect: 'mysql' }), /email varchar\(254\) NOT NULL COMMENT '이메일: 로그인 ID'/);
assert.match(ddl(two, two.schemas, { dialect: 'oracle' }), /COMMENT ON TABLE shop\.member IS '회원: 회원 계정';/);

// SQLite: 외래키는 CREATE TABLE 안(스키마 없는 테이블 이름), ALTER 없음, 주석은 SQL 주석
const lite = ddl(two, two.schemas, { dialect: 'sqlite' });
assert.match(lite, /SQLite DDL/);
assert.match(lite, /CONSTRAINT fk_receipt_order_id FOREIGN KEY \(order_id\) REFERENCES orders \(id\)/);
assert.ok(!/^ALTER/m.test(lite), 'SQLite 는 ALTER TABLE 로 외래키를 더하지 않는다');
assert.ok(!/CREATE SCHEMA|COMMENT ON/.test(lite));
assert.match(lite, /^  -- 이메일: 로그인 ID\n  email varchar\(254\) NOT NULL/m);
// SQLite 타입 검사: dialect sqlite 일 때만
const liteModel = DM.model({ 'main.md': '### main.note 메모\n기능: 없음\n\n| 컬럼 | 논리명 | 타입 | 널 | 키 | 참조 | 설명 |\n|---|---|---|---|---|---|---|\n| id | ID | INTEGER | N | PK | | |\n| body | 본문 | varchar(200) | N | | | |\n| created_at | 생성 일시 | TEXT | N | | | |\n' });
const liteWarn = DM.check(liteModel, { dialect: 'sqlite' }).warns;
assert.ok(liteWarn.some((w) => /main\.note\.body: SQLite 타입/.test(w)), 'varchar 는 SQLite 타입이 아니다');
assert.ok(!liteWarn.some((w) => /\.(id|created_at): SQLite 타입/.test(w)), 'INTEGER · TEXT 는 통과');
assert.ok(!DM.check(liteModel, {}).warns.some((w) => /SQLite 타입/.test(w)), 'dialect 가 없으면 보지 않는다');

// 임시 기획 repo: build → ERD 쪽 · 개요 블록 · 메뉴 ▶ · 뷰어 파일, 검사 exit 코드
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-datamodel-'));
const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); };
put('README.md', '# 기획\n');
put('40-functions.md', '# 기능정의\n\n| ID | 기능 |\n|---|---|\n| FN-MEM-001 | 가입 |\n| FN-MEM-002 | 로그인 |\n| FN-ORD-001 | 주문 |\n');
put('06-data/README.md', '# 데이터 설계\n\n엔티티 목록.\n');
put('06-data/shop.md', tpl);
const node = (args) => spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
const site = path.join(__dirname, '..', '..', 'core', 'bin', 'docs-site.js');
const check = path.join(__dirname, 'check-datamodel.js');
let r = node([site, 'build', dir, '--no-source']);
assert.strictEqual(r.status, 0, r.stderr);
assert.match(r.stdout, /ERD 06-data\/erd\.html \(테이블 4\)/);
for (const f of ['06-data/erd.html', 'assets/erd/erd.js', 'assets/erd/ddl.js', 'assets/erd/elk.bundled.js', 'assets/erd/elkjs-LICENSE.txt']) assert.ok(fs.existsSync(path.join(dir, 'docs-site', f)), f);
const erd = fs.readFileSync(path.join(dir, 'docs-site', '06-data', 'erd.html'), 'utf8');
assert.match(erd, /src="\.\.\/assets\/erd\/elk\.bundled\.js\?v=[0-9a-f]{8}"/);
assert.match(erd, /data-back="index\.html#erd-docs"/);
assert.ok(!/%(TITLE|ROOT|BACK|MODEL)%/.test(erd), '틀 자리표시 모두 채움');
assert.match(erd, /<div id="erd-app">/, '앱 자리');
assert.match(erd, /src="\.\.\/assets\/vendor\.js\?v=[0-9a-f]{8}"/, '화면 라이브러리(Preact)는 문서 사이트와 같은 파일');
assert.ok(fs.existsSync(path.join(dir, 'docs-site', 'assets', 'vendor.js')), 'assets/vendor.js');
{
  const js = fs.readFileSync(path.join(dir, 'docs-site', 'assets', 'erd', 'erd.js'), 'utf8');
  const cssText = fs.readFileSync(path.join(dir, 'docs-site', 'assets', 'erd', 'erd.css'), 'utf8');
  assert.ok(/function Mini\(/.test(js) && /erd\.fold:/.test(js) && /E\.fitTables = async function fitTables/.test(js), '미니맵 · 스키마 접기 · 스키마 맞춤');
  assert.ok(/async function printAreas/.test(js) && /erd\.hub/.test(js) && /const HUB = /.test(js) && /wrapId="areaWrap"/.test(js) && /id="hubs"/.test(js), '영역 보기 · 영역마다 PDF · 참조 많은 표 선 숨김');
  assert.ok(/COFFMAN_GRAHAM/.test(js) && /SEPARATE_CHILDREN/.test(js) && /class=\$\{`ed\$\{e\.cls\}/.test(js), '층 상한 배치 · 스키마별 따로 배치 · 스키마 사이 선');
  assert.match(cssText, /@media print \{ #ref, #mini \{ display: none/, '인쇄에는 미니맵을 넣지 않는다');
  assert.ok(/st\.arrange = 'area'; st\.overview = true/.test(js) && /E\.goArea = async function goArea/.test(js) && /'elk\.direction': down \? 'DOWN'/.test(js) && /class=\$\{`card/.test(js), '영역 덩어리 배치(위 → 아래) · 영역 개요 카드');
  assert.ok(/const lrels = E\.lrels = \[\]/.test(js) && /class=\$\{`sum\$\{/.test(js) && /id="lrefs"/.test(js) && /id="xarea"/.test(js) && /seg\('arrange'/.test(js), '논리 참조 점선 · 덩어리 사이 요약선 · 배치 고르기');
  assert.ok(/#erd-app \{ display: contents; \}/.test(cssText), '앱 틀은 body 세로 배치를 그대로');
}
const model = JSON.parse(/window\.ERD_MODEL = (.*);<\/script>/.exec(erd)[1]);
assert.deepStrictEqual(model.refs['FN-MEM-001'], ['../40-functions.html#FN-MEM-001'], '기능 ID → 근거 쪽');
assert.match(model.tables[0].src, /^shop\.html#shopmember-/, '정의서 쪽 절 주소');
const over = fs.readFileSync(path.join(dir, 'docs-site', '06-data', 'index.html'), 'utf8');
assert.match(over, /<h2 id="erd-docs">/);
assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'docs-site', 'assets', 'nav.js'), 'utf8').replace(/^window\.DS_NAV = /, '').replace(/;\n$/, '')).groups.some((g) => g.acts.some((a) => a.p === '06-data/erd.html' && a.h === '' && a.label === 'ERD 보기')), '메뉴(assets/nav.js) 묶음 제목 옆 ERD 바로 가기');
assert.match(over, /▶ ERD 보기/);
r = node([site, 'check', dir]);
assert.strictEqual(r.status, 0, r.stdout);
r = node([check, dir]);
assert.strictEqual(r.status, 0, r.stdout);
assert.match(r.stdout, /✔ .*06-data: 스키마 1 · 테이블 4 · 관계 3 · 논리 참조 1/);
put('06-data/shop.md', `${tpl}\n### shop.broken 깨짐\n\n| 컬럼 | 논리명 | 타입 | 널 | 키 | 참조 | 설명 |\n|---|---|---|---|---|---|---|\n| x | X | int | N | FK | shop.none.id | |\n`);
r = node([check, dir]);
assert.strictEqual(r.status, 1, '✖ 면 exit 1');
assert.match(r.stdout, /✖ 06-data\/shop\.md:\d+ shop\.broken: 기본키\(PK\)가 없습니다/);
// 정의서가 없으면 ERD 파일을 복사하지 않는다
fs.rmSync(path.join(dir, '06-data'), { recursive: true });
r = node([site, 'build', dir, '--no-source']);
assert.ok(!fs.existsSync(path.join(dir, 'docs-site', 'assets', 'erd')), '정의서가 없으면 assets/erd 없음');
fs.rmSync(dir, { recursive: true, force: true });
console.log('check-datamodel.test.js ✔');
