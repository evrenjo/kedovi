// 실패 주입 세트 (kedovi apiledger add node 가 넣음): 엔드포인트마다 429 · 지연 · 빈 응답 · 일시 404 · 본문 멈춤 · 토큰 지연.
// 재료는 장부의 최악 응답(같은 kind), 없으면 기본 최악값. 일반 test 와 따로 CI 작업에서 돈다: node --test test-faults/api-ledger.cjs (node --test 의 기본 패턴이 test/ 아래를 모두 잡으므로 test/ 밖에 둔다)
// 단언: 예산 안에 끝난다 · 오류면 처리된 오류다 · 토큰 지연 중 동시 호출은 토큰을 한 번만 받는다
'use strict';
const { test, before, after } = require('node:test');
const assert = require('assert');
const S = require('../test/api-ledger/stub.cjs');
const X = require('../test/api-ledger/expectations.cjs');

const ledger = S.loadLedger();
const eps = new Map(require('../test/api-ledger/ledger.cjs').endpoints(ledger).map((e) => [e.key, e.ep]));
const done = [];
let stub;
before(async () => { stub = await S.startStub(ledger); });
after(async () => { await stub.close(); S.writeCovered('faults', done); });

const within = (p, ms) => Promise.race([p.then((v) => ({ v }), (e) => ({ e })), new Promise((ok) => setTimeout(() => ok({ late: true }), ms))]);

for (const f of S.faults(ledger)) {
  test(`${f.key} (${f.from})`, async () => {
    const ep = eps.get(f.endpointKey);
    // token-slow 는 토큰 엔드포인트의 지연이다: 그 토큰을 쓰는 호출을 calls[토큰 키] 에 둔다
    const call = X.calls[f.endpointKey];
    assert.ok(call, `expectations.cjs calls 에 ${f.endpointKey} 가 없다`);
    const budget = (X.budgetMs || {})[f.endpointKey] || (ep.timeoutMs || 5000) * 3;
    stub.reset();
    stub.use(f.endpointKey, f.response);
    const client = X.client(stub.urls);
    const n = f.kind === 'token-slow' ? 5 : 1;
    const t0 = Date.now();
    const rs = await Promise.all(Array.from({ length: n }, () => within(Promise.resolve().then(() => call(client)), budget + 500)));
    const took = Date.now() - t0;
    for (const r of rs) {
      assert.ok(!r.late, `${budget}ms 예산 안에 끝나지 않았다 (${took}ms)`);
      if (r.e) assert.ok(X.handled(r.e), `처리되지 않은 오류: ${r.e && (r.e.stack || r.e)}`);
    }
    if (f.kind === 'token-slow') assert.ok(stub.calls(f.endpointKey) <= 1, `토큰을 ${stub.calls(f.endpointKey)}번 받았다 (동시 갱신은 한 번으로)`);
    done.push(f.key);
  });
}
