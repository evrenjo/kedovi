#!/usr/bin/env node
// 실행 흐름 디버깅 전체 점검 (npm run test:trace): Spring 예제 앱으로 테스트 기록 · 로컬 서버 요청 기록 → 페이지 · 자료 주소까지
// JDK 17+ 와 Gradle(PATH)이 있어야 한다. 처음에는 Spring · H2 · datasource-proxy 를 받느라 몇 분 걸린다. npm test 는 이것을 돌리지 않는다
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const KIT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-trace-e2e-'));
const ws = path.join(tmp, 'ws');
const run = (args, opt = {}) => spawnSync(process.execPath, args, { cwd: ws, encoding: 'utf8', timeout: 900000, ...opt });
const get = (url) => new Promise((resolve) => http.get(url, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', (e) => resolve({ status: 0, body: e.message })));
const ok = [];
const check = (name, cond, extra = '') => { ok.push([name, !!cond]); console.log(`${cond ? '✔' : '✖'} ${name}${extra ? `  ${extra}` : ''}`); };

(async () => {
  assert.strictEqual(spawnSync(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', ws, '--type', 'new', '--packs', 'trace'], { encoding: 'utf8' }).status, 0, 'init');
  fs.cpSync(path.join(KIT, 'packs', 'trace', 'bin', 'fixtures', 'spring-shop'), path.join(ws, 'repos', 'shop'), { recursive: true });
  const tool = path.join(ws, 'packs', 'trace', 'bin', 'trace.js');
  check('trace 팩 설치', fs.existsSync(tool));
  const json = (out) => { const m = out.match(/파일: (\S+)/); return m ? JSON.parse(fs.readFileSync(path.join(ws, m[1]), 'utf8')) : null; };

  // 1. 테스트 기록 (API)
  const a = run([tool, 'run', '--dir', 'repos/shop', '--test', 'OrderApiTraceTest#placeOrder']);
  const A = json(a.stdout);
  check('테스트 기록 끝남', a.status === 0 && A, a.stderr.slice(-400));
  if (A) {
    const calls = A.trace.steps.filter((s) => s.call).map((s) => `${s.cls.split('.').pop()}.${s.m}`);
    check('필터 → 컨트롤러 → 서비스 → 엔티티', ['RequestIdFilter.doFilterInternal', 'OrderController.place', 'OrderService.place', 'Product.decrease', 'OrderService.discount'].every((c) => calls.includes(c)), calls.join(' > '));
    check('접근자 · 한 줄 생성자 건너뜀', !calls.some((c) => /\.(qty|productId|lines|memberId|getName)$/.test(c)));
    const sql = A.trace.steps.filter((s) => s.k === 'sql').flatMap((s) => s.x.qs);
    check('SQL · 바인딩 값', sql.some((q) => /from member/.test(q.q) && q.ps[0][0][1] === 1) && sql.some((q) => /^update product/.test(q.q)), `${sql.length}건`);
    const vals = JSON.stringify(A.trace.steps.map((s) => s.after || {}));
    check('조회한 엔티티 값', /"name":"마우스"/.test(vals) && /"stock":0/.test(vals));
    check('비밀번호 필드 가림', /"password":"\*\*\*"/.test(vals) && !/secret-pw/.test(JSON.stringify(A)));
    check('소스 묶음', Object.values(A.files).some((f) => f.path === 'src/main/java/com/example/shop/order/OrderService.java' && /class OrderService/.test(f.text)));
  }

  // 2. 테스트 기록 (배치)
  const b = run([tool, 'run', '--dir', 'repos/shop', '--test', 'OrderApiTraceTest#dailySales']);
  const Bt = json(b.stdout);
  check('배치 기록 · 회차마다 SQL', Bt && Bt.trace.steps.filter((s) => s.k === 'sql').length === 3 && Bt.trace.steps.some((s) => s.k === 'return' && s.ret && s.ret.n === 3), b.stderr.slice(-300));
  check('SQL 날짜는 이 PC 날짜', Bt && JSON.stringify(Bt.trace.steps.filter((s) => s.k === 'sql')).match(/"java\.sql\.Date","v":"\d{4}-\d\d-\d\d"/));

  // 3. 로컬 서버 요청 기록
  const c = run([tool, 'run', '--dir', 'repos/shop', '--request', 'POST http://localhost:18080/api/orders', '--data', '{"memberId":2,"lines":[{"productId":10,"qty":1},{"productId":12,"qty":5}]}', '--timeout', '300']);
  const C = json(c.stdout);
  check('서버 요청 기록 · 응답', C && C.meta.response.status === 200 && /"skipped":\["모니터"\]/.test(C.meta.response.body), c.stderr.slice(-300));
  check('서버 요청: 필터부터', C && C.trace.steps[0].cls.endsWith('RequestIdFilter'));
  check('기록 뒤 서버 꺼짐', !spawnSync('lsof', ['-i', ':18080', '-sTCP:LISTEN']).stdout.toString().trim());
  check('운영 주소 거부', run([tool, 'run', '--dir', 'repos/shop', '--request', 'GET http://example.com/x']).status === 1);

  // 4. 페이지 · 자료
  const link = (a.stdout.match(/링크: (\S+)/) || [])[1];
  const page = link ? await get(link) : { status: 0, body: '' };
  const data = link ? await get(link.replace(/\.html$/, '.json')) : { status: 0, body: '' };
  check('페이지 · 자료 주소', page.status === 200 && /실행 흐름 기록/.test(page.body) && data.status === 200 && /"steps"/.test(data.body));
  const list = run([tool, 'list']).stdout;
  check('목록', (list.match(/http:\/\/127\.0\.0\.1:\d+\/traces\//g) || []).length >= 3);
  check('gitignore', /\.agents\/traces\//.test(fs.readFileSync(path.join(ws, '.gitignore'), 'utf8')));
  run([path.join(ws, 'packs', 'core', 'bin', 'report.js'), 'stop']);

  const bad = ok.filter(([, v]) => !v);
  console.log(bad.length ? `\n✖ ${bad.length}개 실패 (작업 폴더 ${tmp})` : `\n✔ 전부 통과 (${ok.length}개)`);
  if (!bad.length) fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(bad.length ? 1 : 0);
})();
