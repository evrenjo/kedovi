// 장부 대조 시험 (kedovi apiledger add node 가 넣음): 장부의 동작마다 시뮬레이터가 응답하고 expectations.cjs 의 기대를 돌린다.
// measured → 실제로 본 응답(observed), unverified → 최악 응답(worst). 실행: node --test test/api-ledger/contract.test.cjs
'use strict';
const { test, before, after } = require('node:test');
const assert = require('assert');
const S = require('./stub.cjs');
const X = require('./expectations.cjs');

const ledger = S.loadLedger();
const covered = [];
let stub;
before(async () => { stub = await S.startStub(ledger); });
after(async () => { await stub.close(); S.writeCovered('behaviors', covered); });

test('장부 형식', () => {
  const r = S.check(ledger);
  assert.deepStrictEqual(r.errors.map((e) => `${e.key}: ${e.msg}`), []);
});

for (const s of S.scenarios(ledger)) {
  test(`${s.key} (${s.status}) ${s.what}`, async () => {
    const fn = X.behaviors[s.key];
    assert.ok(fn, `장부 동작 ${s.key} 의 기대가 expectations.cjs behaviors 에 없다`);
    stub.reset();
    stub.use(s.endpointKey, s.response);
    await fn({ client: X.client(stub.urls), stub, scenario: s });
    covered.push(s.key);
  });
}
