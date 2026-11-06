// apiledger.js · lib/apiledger.js · lib/yaml-lite.js 점검 (임시 폴더만 쓴다). 실행: node apiledger.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Y = require('../lib/yaml-lite');
const L = require('../lib/apiledger');

const cases = [];
const it = (name, fn) => cases.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-apiledger-'));
const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const TOOL = path.join(__dirname, 'apiledger.js');
const run = (cwd, args) => spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });
const EXAMPLE = fs.readFileSync(path.join(__dirname, '..', 'assets', 'api-ledger', 'api-ledger.yaml'), 'utf8');

function workspace(repos, vars = {}) {
  const root = tmp();
  for (const r of repos) fs.mkdirSync(path.join(root, 'repos', r.name), { recursive: true });
  fs.writeFileSync(path.join(root, 'workspace.json'), JSON.stringify({ project: { name: 't' }, packs: ['core', 'backend'], repos, vars }));
  return root;
}

// ── yaml-lite ──
it('YAML: 맵 · 목록 · 흐름 · 따옴표 · 주석 · 블록 글', () => {
  const v = Y.parse([
    'a: 1  # 주석',
    'b: "x # 아님"',
    "c: 'it''s'",
    'd: { k: [1, "two", true], e: null }',
    'list:',
    '  - id: x',
    '    n: 2',
    '  - plain',
    'same:',
    '- 1',
    '- 2',
    'body: |',
    '  {"a": 1}',
    '  끝',
    'date: 2026-11-01',
  ].join('\n'));
  assert.deepStrictEqual(v, { a: 1, b: 'x # 아님', c: "it's", d: { k: [1, 'two', true], e: null }, list: [{ id: 'x', n: 2 }, 'plain'], same: [1, 2], body: '{"a": 1}\n끝\n', date: '2026-11-01' });
});
it('YAML: 틀린 들여쓰기 · 겹친 키 · 탭은 줄 번호와 함께 오류', () => {
  assert.throws(() => Y.parse('a: 1\n   b: 2\n'), /2행/);
  assert.throws(() => Y.parse('a: 1\na: 2\n'), /겹칩니다/);
  assert.throws(() => Y.parse('a:\n\t- 1\n'), /탭/);
  assert.throws(() => Y.parse('a: "열림\n'), /닫는/);
});
it('YAML: 예시 장부를 읽는다', () => {
  const l = Y.parse(EXAMPLE);
  assert.strictEqual(l.version, 1);
  assert.strictEqual(l.apis[0].endpoints[1].behaviors[0].observed.headers['Retry-After'], '1');
});

// ── 검사 ──
it('check: 예시 장부는 오류 0 · 미확인 3 · p99 없는 엔드포인트 경고', () => {
  const r = L.check(Y.parse(EXAMPLE), { today: new Date('2026-11-07T00:00:00Z') });
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.unverified.length, 3);
  assert.ok(r.warnings.some((w) => w.key === 'partner/list' && /p99Ms 미측정/.test(w.msg)));
  assert.deepStrictEqual(r.stale, []);
});
it('check: measured 필수 칸 · 상태 값 · 모르는 응답 칸 · timeout < p99 · 오래된 확인일', () => {
  const l = Y.parse([
    'version: 1',
    'apis:',
    '  - id: a',
    '    endpoints:',
    '      - id: e',
    '        path: /x',
    '        timeoutMs: 100',
    '        p99Ms: 200',
    '        p99Checked: 2026-01-01',
    '        p99Evidence: 로그',
    '        behaviors:',
    '          - id: m',
    '            what: 실측인데 근거 없음',
    '            status: measured',
    '          - id: s',
    '            what: 오래됨',
    '            status: measured',
    '            checked: 2026-09-01',
    '            evidence: 로그',
    '            observed: { status: 200, color: red }',
    '          - id: u',
    '            what: 상태 틀림',
    '            status: maybe',
    '          - id: w',
    '            what: 최악 없음',
    '            status: unverified',
  ].join('\n'));
  const r = L.check(l, { today: new Date('2026-11-07T00:00:00Z'), staleDays: 30 });
  const msgs = r.errors.map((e) => `${e.key}: ${e.msg}`).join('\n');
  assert.match(msgs, /a\/e\/m: measured 는 checked/);
  assert.match(msgs, /a\/e\/m: measured 는 evidence/);
  assert.match(msgs, /a\/e\/m: measured 는 observed/);
  assert.match(msgs, /a\/e\/s: observed\.color: 모르는 칸/);
  assert.match(msgs, /a\/e\/u: status 는/);
  assert.match(msgs, /a\/e\/w: unverified 는 worst/);
  assert.ok(r.warnings.some((w) => /timeoutMs 100 < p99Ms 200/.test(w.msg)));
  assert.deepStrictEqual(r.stale.map((s) => s.key).sort(), ['a/e (p99)', 'a/e/s']);
});
it('scenarios · faults: measured 는 observed, unverified 는 worst, 실패 주입은 같은 kind 의 worst · token-slow 는 토큰 엔드포인트만', () => {
  const l = Y.parse(EXAMPLE);
  const s = Object.fromEntries(L.scenarios(l).map((x) => [x.key, x.response]));
  assert.deepStrictEqual(s['partner/items/rate-limit'], { status: 429, headers: { 'Retry-After': '1' } });
  assert.deepStrictEqual(s['partner/items/empty-after-hours'], { status: 200, body: '' });
  const f = Object.fromEntries(L.faults(l).map((x) => [x.key, x]));
  assert.deepStrictEqual(f['partner/items#rate-limit'].response, { status: 429 }); // 실패 주입은 최악
  assert.deepStrictEqual(f['partner/items#transient-404'].response, { status: 404, failTimes: 3 });
  assert.deepStrictEqual(f['partner/items#slow'].response, { delayMs: 3000 });
  assert.strictEqual(f['partner/list#rate-limit'].from, '기본값');
  assert.ok(f['partner/token#token-slow']);
  assert.ok(!f['partner/items#token-slow']);
});
it('coverage: 빠진 동작 · 실패 주입 · 장부에 없는 항목', () => {
  const l = Y.parse(EXAMPLE);
  const all = L.scenarios(l).map((x) => x.key);
  const c = L.coverage(l, { behaviors: [...all.slice(1), 'partner/items/old'], faults: [] });
  assert.deepStrictEqual(c.missing, [all[0]]);
  assert.strictEqual(c.missingFaults.length, L.faults(l).length);
  assert.deepStrictEqual(c.unknown, ['partner/items/old']);
});

// ── 명령 ──
it('add: 미리보기는 쓰지 않고, 쓰면 있는 파일은 덮지 않는다 (java 는 기준 패키지 경로)', () => {
  const root = workspace([{ name: 'api', stack: 'spring' }], { spring: { basePackage: 'com.acme.shop' } });
  const repo = path.join(root, 'repos', 'api');
  let r = run(root, ['add', 'java', '--dry-run']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\+ 만들 파일 src\/test\/java\/com\/acme\/shop\/apiledger\/ApiLedgerStub\.java/);
  assert.ok(!fs.existsSync(path.join(repo, 'api-ledger.yaml')));
  put(path.join(repo, 'api-ledger.yaml'), 'version: 1\n');
  r = run(root, ['add', 'java']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /· 있음 \(덮지 않음\) api-ledger\.yaml/);
  assert.strictEqual(fs.readFileSync(path.join(repo, 'api-ledger.yaml'), 'utf8'), 'version: 1\n');
  const stub = fs.readFileSync(path.join(repo, 'src/test/java/com/acme/shop/apiledger/ApiLedgerStub.java'), 'utf8');
  assert.match(stub, /^package com\.acme\.shop\.apiledger;/);
  assert.match(fs.readFileSync(path.join(repo, 'ci/api-faults.gitlab-ci.yml'), 'utf8'), /- \.\/gradlew faultTest/);
});
it('add: 스택 repo 를 못 찾으면 안내, 모르는 스택은 사용법', () => {
  const root = workspace([{ name: 'web', stack: 'react' }]);
  assert.match(run(root, ['add', 'python']).stderr, /--repo <이름>/);
  assert.strictEqual(run(root, ['add', 'ruby']).status, 2);
});
it('check: 장부 없음 안내 · 형식 오류 exit 1 · --strict 는 오래된 확인일도 exit 1', () => {
  const root = workspace([{ name: 'svc', stack: 'node' }]);
  assert.match(run(root, ['check']).stdout, /장부가 없습니다/);
  const repo = path.join(root, 'repos', 'svc');
  put(path.join(repo, 'api-ledger.yaml'), EXAMPLE);
  let r = run(root, ['check', '--today', '2026-11-07']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /미확인 3/);
  assert.match(r.stdout, /covered\.json 없음/);
  r = run(root, ['check', '--today', '2027-01-01']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /재확인/);
  assert.strictEqual(run(root, ['check', '--today', '2027-01-01', '--strict']).status, 1);
  put(path.join(repo, 'api-ledger.yaml'), EXAMPLE.replace(/(\n +)status: measured/, '$1status: maybe'));
  r = run(root, ['check', '--json']);
  assert.strictEqual(r.status, 1);
  assert.ok(JSON.parse(r.stdout).ledgers[0].errors.length >= 1);
});

// ── Node 템플릿 끝-끝: repo 에 넣고 가짜 클라이언트로 대조 시험 · 실패 주입을 실제로 돌린다 ──
it('Node 템플릿: 대조 시험 · 실패 주입이 돌고 covered.json 이 장부와 맞는다 (기대가 빠지면 실패)', () => {
  const root = workspace([{ name: 'svc', stack: 'express' }]);
  const repo = path.join(root, 'repos', 'svc');
  assert.strictEqual(run(root, ['add', 'node']).status, 0);
  // 빠르게 도는 작은 장부 (timeout 짧게)
  put(path.join(repo, 'api-ledger.yaml'), [
    'version: 1',
    'apis:',
    '  - id: p',
    '    endpoints:',
    '      - id: tok',
    '        method: POST',
    '        path: /token',
    '        auth: token',
    '        timeoutMs: 150',
    '        ok: { status: 200, body: \'{"t":"x"}\' }',
    '      - id: item',
    '        method: GET',
    '        path: /items/{id}',
    '        timeoutMs: 150',
    '        ok: { status: 200, body: \'{"id":"A"}\' }',
    '        behaviors:',
    '          - id: limited',
    '            kind: rate-limit',
    '            what: 429 와 Retry-After',
    '            status: measured',
    '            checked: 2026-11-01',
    '            evidence: 로그',
    '            observed: { status: 429, headers: { Retry-After: "1" } }',
    '          - id: empty',
    '            kind: empty',
    '            what: 빈 본문',
    '            status: unverified',
    '            worst: { status: 200, body: "" }',
  ].join('\n'));
  // 프로젝트 쪽: 시간 초과(본문 읽기 중 포함)를 분류하고, 토큰은 한 번만 받는 작은 클라이언트
  put(path.join(repo, 'test/api-ledger/expectations.cjs'), `
'use strict';
const assert = require('assert');
class ApiError extends Error { constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); } }
async function get(url, ms, init = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    return { res, text };
  } catch (e) { throw new ApiError(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK'); } finally { clearTimeout(t); }
}
function client(urls) {
  let token = null;
  const auth = () => (token = token || get(urls.p + '/token', 150, { method: 'POST' }).then(({ res, text }) => { if (!res.ok || !text) throw new ApiError('AUTH'); return JSON.parse(text).t; }));
  return {
    async item(id) {
      await auth();
      for (let i = 0; i < 2; i++) {
        const { res, text } = await get(urls.p + '/items/' + id, 150);
        if (res.status === 404 && i === 0) continue;
        if (res.status === 429) throw new ApiError('RATE_LIMITED', { retryAfterMs: Number(res.headers.get('retry-after') || 0) * 1000 });
        if (res.status === 404) throw new ApiError('NOT_FOUND');
        if (!text) throw new ApiError('EMPTY');
        return JSON.parse(text);
      }
    },
  };
}
module.exports = {
  client,
  calls: { 'p/item': (c) => c.item('A'), 'p/tok': (c) => c.item('A') },
  behaviors: {
    'p/item/limited': async ({ client: c }) => { await assert.rejects(c.item('A'), (e) => e.code === 'RATE_LIMITED' && e.retryAfterMs === 1000); },
    'p/item/empty': async ({ client: c }) => { await assert.rejects(c.item('A'), (e) => e.code === 'EMPTY'); },
  },
  handled: (e) => e instanceof ApiError,
  budgetMs: { 'p/item': 600, 'p/tok': 600 },
};
`);
  const node = (args) => spawnSync(process.execPath, ['--test', ...args], { cwd: repo, encoding: 'utf8', timeout: 60000 });
  let r = node(['test/api-ledger/contract.test.cjs']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  r = node(['test-faults/api-ledger.cjs']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const cov = JSON.parse(fs.readFileSync(path.join(repo, '.api-ledger/covered.json'), 'utf8'));
  assert.deepStrictEqual(cov.behaviors, ['p/item/empty', 'p/item/limited']);
  assert.strictEqual(cov.faults.length, 11); // 엔드포인트 2 × 5 + token-slow 1
  r = run(root, ['check', '--strict']);
  assert.match(r.stdout, /시험 대조: 장부 항목을 모두 다룸 \(실패 주입 포함\)/);
  // 장부에 동작을 더하고 기대를 안 쓰면 대조 시험이 실패한다
  fs.appendFileSync(path.join(repo, 'api-ledger.yaml'), '\n          - id: order\n            what: 순서 모름\n            status: unverified\n            worst: { status: 200, body: "[]" }\n');
  r = node(['test/api-ledger/contract.test.cjs']);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /p\/item\/order 의 기대가 expectations\.cjs behaviors 에 없다/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of cases) {
    try { await fn(); console.log(`✔ ${name}`); } catch (e) { failed++; console.log(`✖ ${name}\n${e.stack || e}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} 통과`);
  process.exit(failed ? 1 : 0);
})();
