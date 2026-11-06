/**
 * 장부 대조 · 실패 주입 시험이 부르는 프로젝트 쪽 연결 (kedovi apiledger add node 가 넣음. 이 파일은 프로젝트가 채운다).
 *
 * client(urls)      : 시뮬레이터 주소로 프로젝트의 외부 API 클라이언트를 만든다
 * calls[엔드포인트] : 그 엔드포인트를 부르는 프로젝트 코드 한 번 (실패 주입이 쓴다)
 * behaviors[동작]   : 장부 동작마다 기대. measured 는 그 응답에 기대는 동작을, unverified 는 최악 응답을 견디는지 단언한다
 * handled(err)      : 프로젝트가 처리한 오류인가 (분류된 오류 → true, 예상 못 한 예외 → false)
 * budgetMs[엔드포인트] : 재시도까지 포함한 총 허용 시간 (없으면 timeoutMs × 3)
 *
 * 장부에 있는데 여기 없는 동작 · 엔드포인트는 시험이 실패한다 (빠짐 없이 다루게).
 */
'use strict';
const assert = require('assert');

module.exports = {
  // 예: client: (urls) => createPartnerClient({ baseUrl: urls.partner }),
  client: (urls) => ({ baseUrl: urls.partner }),

  calls: {
    // 'partner/items': (client) => client.getItem('A1'),
  },

  behaviors: {
    // measured: 코드가 이 동작에 기대도 된다
    // 'partner/items/rate-limit': async ({ client, stub }) => {
    //   await assert.rejects(client.getItem('A1'), (e) => e.code === 'RATE_LIMITED' && e.retryAfterMs === 1000);
    // },
    // unverified: 최악 응답을 견뎌야 한다 (빈 본문 → 처리된 오류 또는 빈 결과, 예상 못 한 예외 금지)
    // 'partner/items/empty-after-hours': async ({ client }) => {
    //   const r = await client.getItem('A1').catch((e) => e);
    //   assert.ok(r === null || r.code === 'EMPTY_RESPONSE');
    // },
  },

  handled: (err) => Boolean(err && err.code),

  budgetMs: {},
};
void assert;
