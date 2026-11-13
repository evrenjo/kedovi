// trace Python · JS 점검: 테스트 찾기 · 실행 도구 · 서버 명령 · 언어 짐작 + 계측기 · 런타임 · Python 기록기를 실제로 돌려 본다 (python3 · typescript 가 있으면). 실행: node lang.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const T = require('./trace');
const py = require('./py');
const js = require('./js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-trace-lang-'));
const put = (rel, text) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const done = [];

// ── 언어 짐작 ──
assert.strictEqual(T.specLang({ test: 'tests/test_a.py::test_b' }), 'python');
assert.strictEqual(T.specLang({ test: 'e2e/order.spec.ts::담고 주문하기' }), 'node', 'JS 테스트는 :: 가 있어도 JS');
assert.strictEqual(T.specLang({ test: 'src/cart.test.tsx' }), 'node');
assert.strictEqual(T.specLang({ test: 'OrderTest#place' }), 'java');
assert.strictEqual(T.specLang({ web: 'goto /' }), 'web');
assert.strictEqual(T.specLang({ test: 'test_only_name' }), null, '이름만이면 폴더로 정한다');
assert.deepStrictEqual(T.splitCmd('uvicorn "app.main:app" --port 8000'), ['uvicorn', 'app.main:app', '--port', '8000']);
done.push('언어 짐작');

// ── Python: 테스트 찾기 · 실행 도구 · 서버 명령 ──
put('py/pyproject.toml', '[project]\nname = "x"\n[tool.uv]\n');
put('py/src/app/main.py', 'from fastapi import FastAPI\n\napp = FastAPI()\n');
put('py/tests/test_api.py', 'def test_place():\n    pass\n\nclass TestOrder:\n    def test_cancel(self):\n        pass\n');
put('py/tests/test_other.py', 'def test_place():\n    pass\n');
const pdir = path.join(tmp, 'py');
assert.ok(py.isPython(pdir));
assert.deepStrictEqual(py.findTest(pdir, 'tests/test_api.py::test_place').nodeid, 'tests/test_api.py::test_place');
assert.strictEqual(py.findTest(pdir, 'test_cancel').nodeid, 'tests/test_api.py::TestOrder::test_cancel', '클래스 안 메서드');
assert.strictEqual(py.findTest(pdir, 'TestOrder.test_cancel').nodeid, 'tests/test_api.py::TestOrder::test_cancel');
assert.strictEqual(py.findTest(pdir, 'test_place').many.length, 2, '여럿이면 고르게');
assert.strictEqual(py.findTest(pdir, 'test_none'), null);
assert.deepStrictEqual(py.runner(pdir), ['uv', ['run', 'python']]);
assert.deepStrictEqual(py.serveCommand(pdir, 8123), ['uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8123'], 'src 레이아웃의 FastAPI');
put('py/pytest.ini', '[pytest]\naddopts = -n auto\n');
assert.ok(py.pytestArgs(pdir, 'tests/x.py::t').join(' ').includes('-n 0'), 'xdist 를 쓰면 한 프로세스로');
put('dj/manage.py', '');
assert.strictEqual(py.serveCommand(path.join(tmp, 'dj'), 9000)[0], 'manage.py');
done.push('Python 찾기');

// ── JS: 테스트 지정 · Playwright 판별 · 실행기 · 서버 명령 · 기록 합치기 ──
put('web/package.json', JSON.stringify({ scripts: { test: 'vitest run', dev: 'vite', start: 'node dist/main.js' } }));
put('web/e2e/a.spec.ts', "import { test } from '@playwright/test'\n");
put('web/src/a.test.ts', "import { it } from 'vitest'\n");
put('web/playwright.config.ts', '');
const wdir = path.join(tmp, 'web');
assert.deepStrictEqual(js.parseTest('e2e/a.spec.ts::담고 · 주문(1)'), { file: 'e2e/a.spec.ts', name: '담고 · 주문(1)' });
assert.ok(js.isPlaywrightTest(wdir, 'e2e/a.spec.ts') && !js.isPlaywrightTest(wdir, 'src/a.test.ts'));
assert.strictEqual(js.pwConfig(wdir), 'playwright.config.ts');
assert.strictEqual(js.serveCommand(wdir, {}).cmd, 'npm run start', '개발 화면 서버(vite)가 아닌 스크립트');
const merged = js.mergeDumps([{ steps: [{ i: 0, k: 'line', c: 1, call: true, p: -1, site: -1 }, { i: 1, k: 'line', c: 2, call: true, p: 1, site: 0 }] }, { steps: [{ i: 0, k: 'line', c: 1, call: true, p: -1, site: -1 }, { i: 2, k: 'net', c: 1, site: 0 }] }], 30);
assert.deepStrictEqual(merged.steps.map((s) => [s.i, s.c, s.p, s.site]), [[0, 1, -1, -1], [1, 2, 1, 0], [2, 4, -1, -1], [3, 4, undefined, 2]], '번호 · 부모 · 호출 자리 다시 매김');
done.push('JS 찾기');

// ── Next.js: 화면 서버 판별 · 설정에 로더 덧붙이기 · 화면 → 서버 기록 잇기 ──
put('nx/package.json', JSON.stringify({ scripts: { dev: 'next dev --webpack' } }));
put('nx/node_modules/next/package.json', '{"name":"next","version":"16.4.0"}');
put('nx/node_modules/vite/package.json', '{"name":"vite","version":"8.0.0"}');
assert.strictEqual(js.webFramework(path.join(tmp, 'nx')), 'next', 'next 스크립트가 있으면 Vite 보다 Next.js');
put('vt/package.json', JSON.stringify({ scripts: { dev: 'vite' } }));
put('vt/node_modules/vite/package.json', '{"name":"vite","version":"8.0.0"}');
put('vt/node_modules/next/package.json', '{"name":"next","version":"16.4.0"}');
assert.strictEqual(js.webFramework(path.join(tmp, 'vt')), 'vite', 'next 가 깔려만 있고 쓰지 않으면 Vite');
assert.strictEqual(js.webFramework(wdir), null, '화면 개발 서버 없음');
{
  const nd = require('../assets/js/next-dev.cjs');
  assert.deepStrictEqual([nd.nextInfo(path.join(tmp, 'nx')).turbo, nd.nextInfo(path.join(tmp, 'nx')).conditions], [false, true], '16 + --webpack');
  const o = { root: '/p', ts: '/t.js' };
  const t16 = nd.addLoader({ distDir: '.next/dev', turbopack: { rules: { '*.svg': { loaders: ['svgr'] } } } }, { turbo: true, rulesTop: true, conditions: true }, o);
  assert.ok(t16.turbopack.rules['*.svg'] && t16.turbopack.rules['*.tsx'].length === 2 && t16.turbopack.rules['*.tsx'][0].condition.all[1] === 'browser', '16: 브라우저 · 서버 규칙, 기존 규칙 유지');
  assert.strictEqual(t16.distDir, '.next/dev/kedovi-trace', '빌드 폴더 따로');
  assert.strictEqual(nd.addLoader(t16, { turbo: true }, o).turbopack.rules['*.tsx'].length, 2, '두 번 덧붙이지 않음');
  const t15 = nd.addLoader({ turbopack: { rules: { '*.tsx': { loaders: ['x'] } } } }, { turbo: true, rulesTop: true, conditions: false }, o);
  assert.ok(!Array.isArray(t15.turbopack.rules['*.ts']) && t15.turbopack.rules['*.tsx'].loaders.length === 2 && t15.turbopack.rules['*.tsx'].loaders[1].options.side === 'any', '15: 조건 없이, 사용자 로더 뒤에');
  let userCalled = false;
  const wp = nd.addLoader({ webpack: (c) => { userCalled = true; return c; } }, { turbo: false }, o);
  const out = wp.webpack({ module: { rules: [{ test: /x/ }] } }, { isServer: true });
  assert.ok(userCalled && out.module.rules.length === 2 && out.module.rules[0].enforce === 'pre' && out.module.rules[0].use[0].options.side === 'server', 'webpack: 사용자 설정 함수 뒤에 pre 로더');
}
{
  const { merge } = require('../assets/js/merge.cjs');
  const browser = { sid: 'b1', epoch: 1000, steps: [
    { i: 0, k: 'line', c: 1, d: 1, t: 0, call: true, p: -1, site: -1, ev: true, m: '클릭' },
    { i: 1, k: 'line', c: 2, d: 2, t: 1, call: true, p: 1, site: 0, m: 'order' },
    { i: 2, k: 'net', c: 2, d: 2, t: 50, site: 1 },
  ] };
  const server = { sid: 'server', epoch: 990, steps: [
    { i: 0, k: 'line', c: 1, d: 1, t: 0, call: true, p: -1, site: -1, m: 'Page' },
    { i: 1, k: 'line', c: 2, d: 1, t: 30, call: true, p: -1, site: -1, m: 'POST', from: 'b1:2' },
    { i: 2, k: 'line', c: 3, d: 2, t: 31, call: true, p: 2, site: 1, m: 'placeOrder' },
  ] };
  const m = merge([browser, server], 30);
  const by = (n) => m.steps.find((x) => x.m === n);
  assert.deepStrictEqual(m.steps.map((x) => x.m || x.k), ['Page', '클릭', 'order', 'POST', 'placeOrder', 'net'], '시각 순으로 섞음');
  assert.ok(by('POST').p === by('order').c && by('POST').d === 3 && by('placeOrder').d === 4 && by('POST').site === by('order').i, '화면이 보낸 요청의 서버 호출은 그 화면 호출 아래');
  assert.ok(by('Page').p === -1 && by('Page').d === 1 && !('from' in by('POST')), '연결 없는 서버 호출은 뿌리');
}
done.push('Next.js 설정 · 기록 잇기');

// ── 계측기 + 런타임 (typescript 가 있으면) ──
const tsPath = js.tsPath(path.join(__dirname, '..', '..', '..'), { install: false });
if (tsPath) {
  const ts = require(tsPath);
  const { instrument, generated } = require('../assets/js/instrument.cjs');
  const src = `interface L { id: number; qty: number }
const password = 'x';
export class Svc {
  constructor(private repo: Map<number, number>) {}
  async place(lines: L[]) {
    let total = 0;
    const token = 'abc';
    for (const { id, qty } of lines) {
      const price = await this.find(id);
      if (!price) continue;
      total += price * qty;
    }
    try { check(total); } catch (e) { total = -1; }
    return { total };
  }
  async find(id: number) { return this.repo.get(id); }
}
function check(v: number) {
  if (v > 100) throw new RangeError('too big ' + v);
}
export const half = (x: number) => x / 2;
`;
  const r = instrument(src, 'svc.ts', { ts, src: 'src/svc.ts' });
  assert.ok(r && r.code.startsWith('// @ts-nocheck\n'), 'TS 는 타입 검사 끔');
  assert.strictEqual(r.code.split('\n').length, src.split('\n').length + 1, '줄바꿈은 @ts-nocheck 한 줄만');
  assert.deepStrictEqual(r.fns.map((f) => f[0]), ['constructor', 'place', 'find', 'check', 'half']);
  assert.ok(ts.createSourceFile('x.ts', r.code, ts.ScriptTarget.Latest, true).parseDiagnostics.length === 0, '계측한 코드도 문법 오류 없음');
  assert.strictEqual(instrument('return{a}', 'x.js', { ts }), null, '함수가 없으면 그대로');
  assert.deepStrictEqual(instrument('export async function POST(req){return 1}\nfunction helper(){return 2}', 'route.ts', { ts, src: 'src/app/(shop)/api/items/[id]/route.ts' }).fns.map((f) => [f[0], f[3]]), [['POST /api/items/[id]', 1], ['helper', 0]], 'Next.js 라우트 처리기 = 진입점');
  assert.strictEqual(instrument('export default function handler(req, res) { res.end() }', 'a.ts', { ts, src: 'pages/api/hello.ts' }).fns[0][0], 'API /api/hello');
  const dir = instrument("'use client'\nexport async function a(x){'use server'\nreturn x}\n", 'd.tsx', { ts, src: 'd.tsx' }).code;
  const dsf = ts.createSourceFile('d.tsx', dir, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.ok(dsf.parseDiagnostics.length === 0 && /^'use client';/.test(dsf.statements[0].getText(dsf)) && /\{'use server';const __k/.test(dir), '세미콜론 없는 지시문 뒤에 붙지 않음 (Next.js)');
  const mini = instrument('function f(a){return{a}}', 'm.js', { ts, src: 'm.js' }).code;
  assert.ok(/return __ak\.r/.test(mini), '압축 코드에서 낱말이 붙지 않게');
  assert.ok(generated('/** @generated by orval */', 'a.ts') && generated('x', 'src/api/generated/a.ts') && !generated('x', 'src/a.ts'), '생성된 코드 건너뜀');
  // 실행: 런타임 위에서 돌리고 단계 확인
  const vm = require('vm');
  const out = ts.transpileModule(r.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const ctx = { globalThis: null, module: { exports: {} }, setTimeout, Promise, Map, Object, JSON, Array, Number, String, Error, RangeError, Symbol, WeakSet, Set, Date, RegExp, ArrayBuffer, performance };
  ctx.globalThis = ctx;
  ctx.exports = ctx.module.exports;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'runtime.js'), 'utf8'), ctx);
  vm.runInContext(out, ctx);
  (async () => {
    const svc = new ctx.module.exports.Svc(new Map([[1, 30], [2, 50]]));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await svc.place([{ id: 1, qty: 1 }, { id: 3, qty: 1 }, { id: 2, qty: 2 }]))), { total: -1 });
    const st = ctx.__kedoviT.dump().steps;
    const calls = st.filter((s) => s.call);
    const place = calls.find((s) => s.m === 'place');
    assert.ok(place && place.args.lines.n === 3 && place.src === 'src/svc.ts' && place.ln === 6, '인자 · 원본 줄');
    assert.ok(calls.filter((s) => s.m === 'find').every((s) => s.p === place.c), 'await 너머 부모');
    assert.ok(st.some((s) => s.after && s.after.token === '***'), '비밀값 가림');
    assert.ok(st.some((s) => s.after && s.after.total === 130), '반복 회차 값');
    const ex = st.find((s) => s.k === 'ex');
    assert.ok(ex && ex.x.type === 'RangeError' && ex.x.at === 'src/svc.ts:19' && ex.x.caught === 'src/svc.ts:13', '예외 · 던진 곳 · 잡은 곳');
    assert.ok(st.some((s) => s.k === 'return' && s.c === place.c && s.ret.f && s.ret.f.total === -1), '반환값');
    done.push('JS 계측 · 런타임');
    pyPart();
  })().catch((e) => { console.error(e); process.exit(1); });
} else {
  done.push('JS 계측 건너뜀 (typescript 없음)');
  pyPart();
}

// ── Python 기록기 (python3 가 있으면): 표준 라이브러리만으로 작은 pytest 없는 실행 ──
function pyPart() {
  const ver = spawnSync('python3', ['-c', 'import sys;print(sys.version_info[:2] >= (3, 8))'], { encoding: 'utf8' });
  if (ver.status !== 0 || !/True/.test(ver.stdout)) { finish('Python 기록 건너뜀 (python3 없음)'); return; }
  put('rec/app/svc.py', `import asyncio


class Svc:
    def __init__(self, repo):
        self.repo = repo

    def place(self, lines):
        total = 0
        api_token = "abc"
        for pid, qty in lines:
            price = self.repo.get(pid)
            if price is None:
                continue
            total += price * qty
        try:
            check(total)
        except ValueError as e:
            total = -1
        return {"total": total}


def check(v):
    if v > 100:
        raise ValueError(f"too big {v}")


async def later(x):
    await asyncio.sleep(0)
    return half(x)


def half(x):
    return x / 2
`);
  put('rec/run.py', `import asyncio, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import kedovi_trace
from app.svc import Svc, later
rec = kedovi_trace.recorder()
rec.start()
Svc({1: 30, 2: 50}).place([(1, 1), (3, 1), (2, 2)])
asyncio.run(later(8))
rec.stop()
`);
  const out = path.join(tmp, 'py.json');
  const env = { ...process.env, PYTHONPATH: path.join(__dirname, '..', 'assets', 'python'), KEDOVI_TRACE_OUT: out, KEDOVI_TRACE_ROOT: path.join(tmp, 'rec'), PYTHONDONTWRITEBYTECODE: '1' };
  for (const engine of ['monitoring', 'settrace']) {
    const r = spawnSync('python3', [path.join(tmp, 'rec', 'run.py')], { env: { ...env, KEDOVI_TRACE_ENGINE: engine }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const st = JSON.parse(fs.readFileSync(out, 'utf8')).steps;
    const calls = st.filter((s) => s.call);
    const place = calls.find((s) => s.m === 'place');
    assert.ok(place && place.src === 'app/svc.py' && place.cls === 'app.svc.Svc' && place.args.lines.n === 3, `${engine}: 인자 · 소속`);
    assert.ok(!('__class__' in place.args), `${engine}: 숨은 변수 뺌`);
    assert.ok(st.some((s) => s.after && s.after.api_token === '***'), `${engine}: 비밀값 가림`);
    assert.ok(st.some((s) => s.after && s.after.total === 130), `${engine}: 반복 회차 값`);
    const ex = st.find((s) => s.k === 'ex');
    assert.ok(ex && ex.x.type === 'ValueError' && ex.x.at === 'app/svc.py:25' && ex.x.caught === 'app/svc.py:18', `${engine}: 예외 · 던진 곳 · 잡은 곳`);
    const later = calls.find((s) => s.m === 'later');
    const halfC = calls.find((s) => s.m === 'half');
    assert.ok(later && halfC && halfC.p === later.c, `${engine}: await 너머 부모`);
    assert.strictEqual(calls.filter((s) => s.m === 'later').length, 1, `${engine}: await 로 멈췄다 이어진 것은 같은 호출`);
  }
  finish('Python 기록(monitoring · settrace)');
}

function finish(last) {
  done.push(last);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`lang.test.js: ${done.join(' · ')} 통과`);
}
