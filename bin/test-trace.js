#!/usr/bin/env node
// 실행 흐름 디버깅 전체 점검 (npm run test:trace [-- --only java,python,react,node]): 예제 앱마다 테스트 기록 · 로컬 서버 요청 기록 → 페이지 · 자료 주소까지
// java = Spring (JDK 17+ · Gradle) · python = FastAPI (uv) · react = Vite + React (npm · Playwright 브라우저) · node = Express + Jest (npm, Node 22.15+)
// 도구가 없는 언어는 건너뛴다. 처음에는 의존성을 받느라 몇 분 걸린다. npm test 는 이것을 돌리지 않는다
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
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;
const want = (lang) => !ONLY || ONLY.has(lang);
const have = (cmd, args = ['--version']) => spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;
const check = (name, cond, extra = '') => { ok.push([name, !!cond]); console.log(`${cond ? '✔' : '✖'} ${name}${extra ? `  ${extra}` : ''}`); };

(async () => {
  assert.strictEqual(spawnSync(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', ws, '--type', 'new', '--packs', 'trace'], { encoding: 'utf8' }).status, 0, 'init');
  fs.cpSync(path.join(KIT, 'packs', 'trace', 'bin', 'fixtures', 'spring-shop'), path.join(ws, 'repos', 'shop'), { recursive: true });
  const tool = path.join(ws, 'packs', 'trace', 'bin', 'trace.js');
  check('trace 팩 설치', fs.existsSync(tool));
  const json = (out) => { const m = out.match(/파일: (\S+)/); return m ? JSON.parse(fs.readFileSync(path.join(ws, m[1]), 'utf8')) : null; };
  const callsOf = (T) => T.trace.steps.filter((s) => s.call).map((s) => s.m);
  const fixtureCopy = (name, to) => fs.cpSync(path.join(KIT, 'packs', 'trace', 'bin', 'fixtures', name), path.join(ws, 'repos', to), { recursive: true });
  let a = { stdout: '' };

  // ── Python (FastAPI · pytest · uvicorn) ──
  if (want('python') && have('uv')) {
    fixtureCopy('fastapi-shop', 'pyshop');
    const p = run([tool, 'run', '--dir', 'repos/pyshop', '--test', 'test_place_order']);
    const P = json(p.stdout);
    check('Python 테스트 기록: 미들웨어 → 라우트 → 서비스 → 저장소', P && ['request_id', 'place_order', 'place', 'member', 'decrease', 'discount', 'save'].every((m) => callsOf(P).includes(m)), (p.stderr || '').slice(-300));
    check('Python SQL · 바인딩 값', P && P.trace.steps.some((s) => s.k === 'sql' && /from member/.test(s.x.qs[0].q) && s.x.qs[0].ps[0][0][1] === 1));
    check('Python 반복 회차 값 · 반환값', P && P.trace.steps.some((s) => s.after && s.after.skipped && s.after.skipped.n === 1) && P.trace.steps.some((s) => s.k === 'return' && s.ret && s.ret.f && s.ret.f.status));
    check('Python 소스 묶음', P && P.files['src/shop/order/service.py'] && /class OrderService/.test(P.files['src/shop/order/service.py'].text));
    const q = run([tool, 'run', '--dir', 'repos/pyshop', '--request', 'POST http://localhost:18781/api/orders', '--data', '{"member_id":2,"lines":[{"product_id":12,"qty":1}]}', '--timeout', '300']);
    const Q = json(q.stdout);
    check('Python 서버 요청 기록 · 응답', Q && Q.meta.response.status === 200 && callsOf(Q).includes('place_order'), (q.stderr || '').slice(-300));
    check('Python 기록 뒤 서버 꺼짐', !spawnSync('lsof', ['-i', ':18781', '-sTCP:LISTEN']).stdout.toString().trim());
    a = p;
  } else if (want('python')) console.log('… Python 건너뜀 (uv 없음)');

  // ── React (Vite · Playwright e2e · 단계 목록 · Vitest) ──
  if (want('react') && have('npm')) {
    fixtureCopy('react-shop', 'web');
    const inst = spawnSync('npm', ['i', '--no-audit', '--no-fund'], { cwd: path.join(ws, 'repos', 'web'), encoding: 'utf8', timeout: 600000 });
    const br = spawnSync('npx', ['playwright', 'install', 'chromium'], { cwd: path.join(ws, 'repos', 'web'), encoding: 'utf8', timeout: 600000 });
    check('React 예제 설치', inst.status === 0 && br.status === 0, (inst.stderr || br.stderr || '').slice(-300));
    const e = run([tool, 'run', '--dir', 'repos/web', '--test', 'e2e/order.spec.ts::담고 주문하기']);
    const E = json(e.stdout);
    if (!a.stdout) a = e;
    const marks = E ? E.trace.steps.filter((s) => s.ev).map((s) => s.m) : [];
    check('React e2e 기록: 사용자 동작 → 핸들러 → 요청', E && marks.some((m) => /주문하기/.test(m)) && ['placeOrder', 'postOrder', 'add', 'total'].every((m) => callsOf(E).includes(m)), (e.stdout + e.stderr).slice(-300));
    const nets = E ? E.trace.steps.filter((s) => s.k === 'net') : [];
    check('React 요청 · 본문', nets.some((s) => s.x.method === 'GET' && /api\/products/.test(s.x.url)) && nets.some((s) => s.x.method === 'POST' && /"total":1800/.test(s.x.req) && /orderId/.test(s.x.res)));
    check('React 원본 TSX 줄 · 소스', E && E.files['src/App.tsx'] && E.trace.steps.some((s) => s.call && s.m === 'placeOrder' && s.ln === 17));
    const w = run([tool, 'run', '--dir', 'repos/web', '--web', 'goto /; click text=담기 bag; click text=주문하기; wait [role=status]']);
    const W = json(w.stdout);
    check('React 단계 목록 기록 (가짜 백엔드)', W && W.trace.steps.some((s) => s.k === 'net' && s.x.method === 'POST' && s.x.status === 200), (w.stdout + w.stderr).slice(-300));
    const v = run([tool, 'run', '--dir', 'repos/web', '--test', 'src/cart.test.ts::재고 안에서 담고 등급 할인']);
    const V = json(v.stdout);
    check('Vitest 기록', V && ['add', 'total'].every((m) => callsOf(V).includes(m)), (v.stdout + v.stderr).slice(-300));
  } else if (want('react')) console.log('… React 건너뜀 (npm 없음)');

  // ── Node 서버 (Express · Jest · tsc 빌드 · tsx) ──
  const nodeOk = Number(process.versions.node.split('.')[0]) > 22 || Number(process.versions.node.split('.')[1]) >= 15;
  if (want('node') && have('npm') && nodeOk) {
    fixtureCopy('node-shop', 'node');
    const nd = path.join(ws, 'repos', 'node');
    const inst = spawnSync('npm', ['i', '--no-audit', '--no-fund'], { cwd: nd, encoding: 'utf8', timeout: 600000 });
    const build = spawnSync('npm', ['run', 'build'], { cwd: nd, encoding: 'utf8' });
    check('Node 예제 설치 · 빌드', inst.status === 0 && build.status === 0, (inst.stderr || build.stderr || '').slice(-300));
    const j = run([tool, 'run', '--dir', 'repos/node', '--test', 'test/order.test.ts::담고 주문하기']);
    const J = json(j.stdout);
    if (!a.stdout) a = j;
    check('Jest 기록: 미들웨어 → 라우트 → 서비스 → 저장소 · SQL', J && ['미들웨어', 'POST /api/orders', 'place', 'decrease', 'save'].every((m) => callsOf(J).includes(m)) && J.trace.steps.some((s) => s.k === 'sql'), (j.stdout + j.stderr).slice(-300));
    for (const [m, port] of [['start', 18785], ['dev', 18786]]) {
      const r = run([tool, 'run', '--dir', 'repos/node', '--request', `POST http://localhost:${port}/api/orders`, '--data', '{"memberId":1,"lines":[{"productId":10,"qty":2}]}', '--serve', `npm run ${m}`, '--timeout', '300']);
      const R = json(r.stdout);
      check(`Node 서버 요청 기록 (npm run ${m}): 원본 TS 줄`, R && R.meta.response.status === 200 && R.trace.steps.some((s) => s.call && s.m === 'place' && s.src === 'src/service.ts' && s.ln === 9), (r.stdout + r.stderr).slice(-300));
      check(`Node 기록 뒤 서버 꺼짐 (${m})`, !spawnSync('lsof', ['-i', `:${port}`, '-sTCP:LISTEN']).stdout.toString().trim());
    }
  } else if (want('node')) console.log(`… Node 건너뜀 (${nodeOk ? 'npm 없음' : 'Node 22.15 이상 필요'})`);

  if (want('java')) {

  // 1. 테스트 기록 (API)
  a = run([tool, 'run', '--dir', 'repos/shop', '--test', 'OrderApiTraceTest#placeOrder']);
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

  }

  // 4. 페이지 · 자료 (마지막으로 돈 언어의 첫 기록)
  const link = (a.stdout.match(/링크: (\S+)/) || [])[1];
  const page = link ? await get(link) : { status: 0, body: '' };
  const data = link ? await get(link.replace(/\.html$/, '.json')) : { status: 0, body: '' };
  check('페이지 · 자료 주소', page.status === 200 && /실행 흐름 기록/.test(page.body) && data.status === 200 && /"steps"/.test(data.body));
  const list = run([tool, 'list']).stdout;
  check('목록', (list.match(/http:\/\/127\.0\.0\.1:\d+\/traces\//g) || []).length >= 1);
  check('gitignore', /\.agents\/traces\//.test(fs.readFileSync(path.join(ws, '.gitignore'), 'utf8')));
  run([path.join(ws, 'packs', 'core', 'bin', 'report.js'), 'stop']);

  const bad = ok.filter(([, v]) => !v);
  console.log(bad.length ? `\n✖ ${bad.length}개 실패 (작업 폴더 ${tmp})` : `\n✔ 전부 통과 (${ok.length}개)`);
  if (!bad.length) fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(bad.length ? 1 : 0);
})();
