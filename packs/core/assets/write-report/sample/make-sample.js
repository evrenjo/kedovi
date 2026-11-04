/**
 * 쓰기 보고서 표본 데이터 (킷 개발용). 난수 없이 늘 같은 index.json 객체를 돌려준다.
 * 스키마 shop · billing, 테이블 13 (customers 34컬럼 1,205행), 시험 12, 모든 작업 · 실패 · 롤백 · 마스킹 · 자릿수 넘침.
 * 쓰는 곳: sample/build-sample.js · bin/site-test.js
 */
'use strict';

function makeSample() {
  const col = (name, type, nullable = true, def = null, generated = false) => ({ name, type, nullable, default: def, generated });
  const catalog = {
    shop: {
      customers: {
        columns: [
          col('id', 'bigint', false, "nextval('shop.customers_id_seq'::regclass)"),
          col('customer_no', 'character varying(20)', false),
          col('name', 'character varying(50)', false),
          col('name_kana', 'character varying(50)'),
          col('email', 'character varying(120)'),
          col('phone', 'character varying(20)'),
          col('mobile', 'character varying(20)'),
          col('birth_date', 'date'),
          col('gender', 'character(1)'),
          col('grade', 'character varying(10)', false, "'BASIC'::character varying"),
          col('points', 'integer', false, '0'),
          col('credit_limit', 'numeric(10,2)'),
          col('zip_code', 'character varying(10)'),
          col('address1', 'character varying(200)'),
          col('address2', 'character varying(200)'),
          col('city', 'character varying(50)'),
          col('region', 'character varying(50)'),
          col('country', 'character(2)', false, "'KR'::bpchar"),
          col('marketing_opt_in', 'boolean', false, 'false'),
          col('sms_opt_in', 'boolean', false, 'false'),
          col('referrer_id', 'bigint'),
          col('source_key', 'character varying(40)'),
          col('first_order_at', 'timestamp with time zone'),
          col('last_order_at', 'timestamp with time zone'),
          col('order_count', 'integer', false, '0'),
          col('total_spent', 'numeric(12,2)', false, '0'),
          col('memo', 'text'),
          col('tags', 'text[]'),
          col('profile', 'jsonb'),
          col('status', 'character varying(10)', false, "'ACTIVE'::character varying"),
          col('deleted', 'boolean', false, 'false'),
          col('created_at', 'timestamp with time zone', false, 'now()'),
          col('updated_at', 'timestamp with time zone', false, 'now()'),
          col('search_text', 'tsvector', true, null, true),
        ],
        primaryKey: ['id'],
      },
      orders: {
        columns: [
          col('id', 'bigint', false, "nextval('shop.orders_id_seq'::regclass)"),
          col('order_no', 'character varying(20)', false),
          col('customer_id', 'bigint', false),
          col('status', 'character varying(12)', false, "'NEW'::character varying"),
          col('total', 'numeric(12,2)', false),
          col('discount', 'numeric(7,2)', false, '0'),
          col('ordered_at', 'timestamp with time zone', false),
          col('cancelled_at', 'timestamp with time zone'),
          col('cancel_reason', 'character varying(100)'),
          col('created_at', 'timestamp with time zone', false, 'now()'),
          col('updated_at', 'timestamp with time zone', false, 'now()'),
        ],
        primaryKey: ['id'],
      },
      order_items: {
        columns: [
          col('id', 'bigint', false, "nextval('shop.order_items_id_seq'::regclass)"),
          col('order_id', 'bigint', false),
          col('product_id', 'bigint', false),
          col('qty', 'smallint', false),
          col('unit_price', 'numeric(10,2)', false),
          col('amount', 'numeric(12,2)', true, null, true),
        ],
        primaryKey: ['id'],
      },
      products: {
        columns: [
          col('id', 'bigint', false),
          col('sku', 'character varying(30)', false),
          col('name', 'character varying(100)', false),
          col('price', 'numeric(10,2)', false),
          col('active', 'boolean', false, 'true'),
        ],
        primaryKey: ['id'],
      },
      inventory: {
        columns: [
          col('product_id', 'bigint', false),
          col('warehouse', 'character varying(10)', false),
          col('qty', 'integer', false, '0'),
          col('reserved', 'integer', false, '0'),
          col('updated_at', 'timestamp with time zone', false, 'now()'),
        ],
        primaryKey: ['product_id', 'warehouse'],
      },
      daily_sales: {
        columns: [
          col('store_id', 'character varying(10)', false),
          col('sale_date', 'date', false),
          col('order_count', 'integer', false),
          col('gross', 'numeric(12,2)', false),
          col('avg_price', 'numeric(7,2)'),
          col('note', 'text'),
          col('updated_at', 'timestamp with time zone', false, 'now()'),
        ],
        primaryKey: ['store_id', 'sale_date'],
      },
      audit_log: {
        columns: [col('id', 'bigint', false), col('actor', 'character varying(40)'), col('action', 'text'), col('at', 'timestamp with time zone', false, 'now()')],
        primaryKey: ['id'],
      },
      coupons: {
        columns: [col('code', 'character varying(16)', false), col('rate', 'numeric(3,2)', false), col('expires_on', 'date')],
        primaryKey: ['code'],
      },
    },
    billing: {
      invoices: {
        columns: [
          col('id', 'bigint', false, "nextval('billing.invoices_id_seq'::regclass)"),
          col('invoice_no', 'character varying(20)', false),
          col('order_id', 'bigint', false),
          col('amount', 'numeric(12,2)', false),
          col('tax', 'numeric(10,2)', false, '0'),
          col('status', 'character varying(10)', false, "'OPEN'::character varying"),
          col('issued_at', 'timestamp with time zone', false),
          col('paid_at', 'timestamp with time zone'),
          col('external_ref', 'uuid'),
        ],
        primaryKey: ['id'],
      },
      payments: {
        columns: [
          col('id', 'bigint', false, "nextval('billing.payments_id_seq'::regclass)"),
          col('invoice_id', 'bigint', false),
          col('method', 'character varying(10)', false),
          col('amount', 'numeric(12,2)', false),
          col('card_last4', 'character(4)'),
          col('approved_at', 'timestamp with time zone'),
        ],
        primaryKey: ['id'],
      },
      api_clients: {
        columns: [
          col('id', 'bigint', false),
          col('name', 'character varying(20)', false),
          col('api_key', 'character varying(64)', false),
          col('client_secret', 'character varying(64)', false),
          col('scopes', 'text[]'),
          col('created_at', 'timestamp with time zone', false, 'now()'),
        ],
        primaryKey: ['id'],
      },
      refunds: {
        columns: [col('id', 'bigint', false), col('payment_id', 'bigint', false), col('amount', 'numeric(12,2)', false), col('reason', 'text')],
        primaryKey: ['id'],
      },
      ledger_entries: {
        columns: [
          col('id', 'bigint', false),
          col('account', 'character varying(20)', false),
          col('debit', 'numeric(14,2)', false, '0'),
          col('credit', 'numeric(14,2)', false, '0'),
          col('posted_on', 'date', false),
          col('attachment', 'bytea'),
        ],
        primaryKey: ['id'],
      },
    },
  };

  const tests = [];
  const T = (group, name, status, writes, specs = []) => {
    writes.forEach((w, i) => { w.seq = i + 1; });
    // 키 순서를 형식 표 순서로
    const order = ['seq', 'op', 'table', 'rows', 'set', 'sameAsInsert', 'conflict', 'where', 'whereSql', 'sql', 'result', 'rolledBack'];
    writes = writes.map((w) => Object.fromEntries(order.filter((k) => w[k] !== undefined).map((k) => [k, w[k]])));
    tests.push({ id: `${group}#${name}`, group, name, file: `${group}/${name}.yaml`, specs, status, writes });
  };
  const NOW = { $sql: 'now()' };

  // 주문
  T('com.example.shop.OrderServiceTest', 'createsOrder', 'passed', [
    { op: 'INSERT', table: 'shop.orders', rows: [{ order_no: 'O-20261104-001', customer_id: 7, status: 'NEW', total: 45000, discount: 0, ordered_at: '2026-11-04T09:00:00+09:00' }], result: { rows: 1 } },
    { op: 'INSERT', table: 'shop.order_items', rows: [
      { order_id: '<id-1>', product_id: 101, qty: 2, unit_price: 12000 },
      { order_id: '<id-1>', product_id: 205, qty: 1, unit_price: 21000 },
    ], result: { rows: 2 } },
    { op: 'UPDATE', table: 'shop.inventory', set: { reserved: { $sql: 'reserved + ?' }, updated_at: NOW }, where: { product_id: 101, warehouse: 'W1' }, result: { rows: 1 } },
  ], ['FN-ORD-001']);
  T('com.example.shop.OrderServiceTest', 'cancelsOrder', 'passed', [
    { op: 'UPDATE', table: 'shop.orders', set: { status: 'CANCELLED', cancelled_at: '2026-11-04T10:00:00+09:00', cancel_reason: '고객 요청' }, where: { id: 42 }, whereSql: 'status <> ?', result: { rows: 1 } },
    { op: 'DELETE', table: 'shop.order_items', where: { order_id: [42, 43] }, result: { rows: 3 } },
  ], ['FN-ORD-004']);
  T('com.example.shop.OrderServiceTest', 'upsertsInventory', 'passed', [
    { op: 'UPSERT', table: 'shop.inventory', rows: [
      { product_id: 101, warehouse: 'W1', qty: 30, reserved: 0 },
      { product_id: 102, warehouse: 'W1', qty: 5, reserved: 0 },
    ], set: { reserved: 0, updated_at: NOW }, sameAsInsert: ['qty'], conflict: ['product_id', 'warehouse'], result: { rows: 2 } },
  ]);
  T('com.example.shop.OrderServiceTest', 'ignoresDuplicateProduct', 'passed', [
    { op: 'INSERT_IGNORE', table: 'shop.products', rows: [{ id: 101, sku: 'SKU-101', name: '머그컵', price: 12000 }], conflict: ['id'], result: { rows: 0 } },
    { op: 'INSERT', table: 'shop.products', rows: [{ id: 300, sku: 'SKU-300', name: '텀블러 (스테인리스 500ml)', price: 25000, active: true }], result: { rows: 1 } },
  ]);

  // 고객 가져오기 (넓은 테이블 1,200행)
  const regions = ['서울', '부산', '대구', '인천', '광주', '대전'];
  const custRows = [];
  for (let i = 1; i <= 1200; i++) {
    const r = {
      customer_no: `C${String(i).padStart(6, '0')}`,
      name: `고객${i}`,
      email: i % 17 === 0 ? null : `user${i}@example.com`,
      phone: `02-555-${String(1000 + (i % 9000)).padStart(4, '0')}`,
      mobile: i % 5 === 0 ? null : `010-1234-${String(i % 10000).padStart(4, '0')}`,
      birth_date: `19${70 + (i % 30)}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
      gender: i % 2 ? 'M' : 'F',
      grade: ['BASIC', 'SILVER', 'GOLD'][i % 3],
      points: (i * 37) % 5000,
      credit_limit: i === 777 ? 123456789.5 : Math.round((i * 13.37) % 100000 * 100) / 100,
      zip_code: String(10000 + i),
      address1: `${regions[i % 6]} 중앙로 ${i}`,
      city: regions[i % 6],
      country: 'KR',
      marketing_opt_in: i % 3 === 0,
      sms_opt_in: false,
      source_key: `legacy-${i}`,
      memo: i === 5 ? '첫 줄\n둘째 줄: 아주 긴 메모가 들어가면 칸이 넘치지 않고 잘려 보여야 한다. 마우스를 올리면 전체가 보인다.' : null,
      tags: i % 10 === 0 ? '{vip,early}' : null,
      profile: i % 50 === 0 ? '{"lang":"ko","tz":"Asia/Seoul"}' : null,
      status: 'ACTIVE',
      created_at: '<now>',
      updated_at: '<now>',
    };
    if (i === 1001) r.name = '아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주아주 긴 이름';
    custRows.push(r);
  }
  T('com.example.shop.CustomerImportTest', 'importsCustomers', 'passed', [
    { op: 'INSERT', table: 'shop.customers', rows: custRows.slice(0, 600), result: { rows: 600 } },
    { op: 'INSERT', table: 'shop.customers', rows: custRows.slice(600), result: { rows: 600 } },
    { op: 'UPDATE', table: 'shop.customers', set: { referrer_id: 3, updated_at: NOW }, where: { customer_no: ['C000010', 'C000011', 'C000012'] }, result: { rows: 3 } },
  ], ['FN-CUS-010', 'FN-CUS-011']);
  T('com.example.shop.CustomerImportTest', 'mergesCustomers', 'passed', [
    { op: 'MERGE', table: 'shop.customers', sql: 'MERGE INTO shop.customers c USING staging.customers s ON c.customer_no = s.customer_no WHEN MATCHED THEN UPDATE SET name = s.name, updated_at = now() WHEN NOT MATCHED THEN INSERT (customer_no, name) VALUES (s.customer_no, s.name)', result: { rows: 14 } },
    { op: 'MERGE', table: 'shop.customers', rows: [{ customer_no: 'C009999', name: '병합 고객', grade: 'GOLD' }], set: { grade: 'GOLD', updated_at: NOW }, conflict: ['customer_no'], result: { rows: 1 } },
  ]);
  T('com.example.shop.CustomerImportTest', 'rollsBackOnDuplicate', 'passed', [
    { op: 'INSERT', table: 'shop.customers', rows: [{ customer_no: 'C000001', name: '중복 고객', email: 'dup@example.com' }], result: { rows: 1 }, rolledBack: true },
    { op: 'INSERT', table: 'shop.customers', rows: [{ customer_no: 'C000001', name: '중복 고객', email: 'dup@example.com' }], result: { error: '23505', message: 'duplicate key value violates unique constraint "customers_customer_no_key"' }, rolledBack: true },
  ]);

  // 일별 매출 배치
  T('com.example.batch.DailySalesJobTest', 'savesDailySales', 'failed', [
    { op: 'INSERT', table: 'shop.daily_sales', rows: [
      { store_id: 'S01', sale_date: '2026-11-04', order_count: 120, gross: 1481400, avg_price: 12345.67, note: null },
      { store_id: 'S02', sale_date: '2026-11-04', order_count: 3, gross: 370370.37, avg_price: 123456.79, note: '정수부 넘침' },
      { store_id: 'S03', sale_date: '2026-11-04', order_count: 7, gross: 86.415, avg_price: 12.345, note: '소수 자릿수 넘침' },
    ], result: { error: '22003', message: 'numeric field overflow' } },
  ], ['FN-SAL-003']);
  T('com.example.batch.DailySalesJobTest', 'purgesOldSales', 'passed', [
    { op: 'SQL', table: 'shop.daily_sales', sql: 'DELETE FROM shop.daily_sales WHERE sale_date < ? AND store_id IN (SELECT id FROM shop.stores WHERE closed)', result: { rows: 31 } },
    { op: 'DELETE', table: 'shop.daily_sales', where: { store_id: 'S09' }, whereSql: 'sale_date < current_date - ?', result: { rows: 2 } },
    { op: 'INSERT', table: 'shop.daily_sales', sql: 'INSERT INTO shop.daily_sales (store_id, sale_date, order_count, gross) SELECT store_id, ?, count(*), sum(total) FROM shop.orders GROUP BY store_id', result: { rows: 4 } },
  ]);

  // 청구
  T('com.example.billing.InvoiceServiceTest', 'issuesInvoice', 'passed', [
    { op: 'INSERT', table: 'billing.invoices', rows: [{ invoice_no: 'INV-0001', order_id: '<id-1>', amount: 45000, tax: 4500, status: 'OPEN', issued_at: '<now>', external_ref: '<uuid>' }], result: { rows: 1 } },
    { op: 'INSERT', table: 'billing.payments', rows: [{ invoice_id: '<id-2>', method: 'CARD', amount: 49500, card_last4: '4242', approved_at: '2026-11-04T09:05:00+09:00' }], result: { rows: 1 } },
    { op: 'UPDATE', table: 'billing.invoices', set: { status: 'PAID', paid_at: NOW }, where: { id: '<id-2>' }, whereSql: 'status = ?', result: { rows: 1 } },
    { op: 'INSERT', table: 'billing.ledger_entries', rows: [
      { id: 1, account: 'AR', debit: 49500, credit: 0, posted_on: '2026-11-04', attachment: { $bytes: 2048 } },
      { id: 2, account: 'SALES', debit: 0, credit: 49500, posted_on: '2026-11-04', attachment: null },
    ], result: { rows: 2 } },
  ], ['FN-BIL-001']);
  T('com.example.billing.ApiClientTest', 'registersClient', 'failed', [
    { op: 'INSERT', table: 'billing.api_clients', rows: [{ id: 1, name: 'partner-portal', api_key: '***', client_secret: '***', scopes: '{read,write}' }], result: { rows: 1 } },
    { op: 'INSERT', table: 'billing.api_clients', rows: [{ id: 2, name: '<text:28>', api_key: '***', client_secret: '***' }], result: { error: '22001', message: 'value too long for type character varying(20)' }, rolledBack: true },
  ]);
  T('com.example.billing.ApiClientTest', 'refundsPayment', 'skipped', []);

  return {
    format: 1,
    generatedAt: '2026-11-05T10:03:00+09:00',
    repo: 'sample-app',
    stack: 'jooq',
    tests,
    catalog,
    excluded: {
      tables: ['batch_*', 'qrtz_*', 'flyway_schema_history'],
      updatesOnly: [{ table: 'shop.inventory', columns: ['updated_at'], count: 530 }],
    },
  };
}

module.exports = { makeSample };
