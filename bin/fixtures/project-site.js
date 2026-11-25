/**
 * 프로젝트 문서 사이트 시험 재료 (bin/site-test.js): 워크스페이스 docs-site/ 모양의 md 와 빌드 DB(site-db.json, 계약 v2 모양).
 * 예시 프로젝트 「주문 관리」. DB 는 데이터 쪽 빌드가 만드는 것과 같은 모양으로 손으로 적었다 (화면 시험용)
 */
'use strict';

const path = require('path');
const fs = require('fs');

const feat = (no, name, ms, stage, fn, ac, api, scr, tables) => `# ${no} ${name}

> 번호: ${no} · 이름: ${name} · 마일스톤: ${ms} · 단계: ${stage}

## 명세

### 목표

${name} 화면에서 판매자가 할 일을 정한다.

### 기능 목록

| ID | 기능 | 근거 |
|---|---|---|
${fn.map(([id, t]) => `| ${id} | ${t} | |`).join('\n')}

### 수용 기준

| ID | 조건 | 결과 |
|---|---|---|
${ac.map(([id, t]) => `| ${id} | ${t} | |`).join('\n') || '| | 명세 확정 때 쓴다 | |'}

## 설계

### API

| ID | 메서드 · 경로 | 하는 일 |
|---|---|---|
${api.map(([id, m, t]) => `| ${id} | \`${m}\` | ${t} |`).join('\n') || '| 없음 | | |'}

### 화면

| ID | 화면 |
|---|---|
${scr.map(([id, t]) => `| ${id} | ${t} |`).join('\n')}

### 데이터

${tables.map((t) => `- ${t}`).join('\n')}

## 검증

| 수용 기준 | 결과 |
|---|---|
${ac.map(([id, , r]) => `| ${id} | ${r} |`).join('\n') || '| 없음 | |'}
`;

const files = {
  'docs-site.json': JSON.stringify({
    title: '주문 관리',
    project: true,
    groups: [
      { group: '개요', files: ['개요.md', '개요/*.md'] },
      { group: '설계', files: ['설계/요구사항.md', '설계/아키텍처.md', '설계/개발표준.md', '설계/*.md', '설계/결정/**', '데이터/**', '화면/**'] },
      { group: '기능', files: ['기능/README.md', '기능/*.md'] },
      { group: '테스트', files: ['테스트/**'] },
      { group: '일정', files: ['일정/**'] },
      { group: '이슈', files: ['이슈/**'] },
      { group: '자료실', files: ['자료실/README.md', '자료실/**'] },
    ],
  }, null, 1),
  '개요.md': '# 프로젝트 개요\n\n판매자가 주문을 접수 · 출고 · 취소하고 주간 정산을 받는 관리 화면입니다.\n',
  '설계/요구사항.md': '# 요구사항\n\n| ID | 요구사항 | 맡은 기능 |\n|---|---|---|\n| REQ-001 | 판매자는 이메일과 휴대폰 인증으로 가입한다 | FN-001 |\n| REQ-004 | 상품 이미지는 5장까지 올린다 | FN-010 |\n| REQ-007 | 주문은 결제 완료 시점에 접수로 바뀐다 | FN-021 |\n| REQ-008 | 출고 전 주문은 판매자가 취소할 수 있다 | FN-024 |\n| REQ-012 | 정산은 매주 월요일 지난주 출고분으로 만든다 | FN-030 |\n',
  '설계/아키텍처.md': '# 아키텍처\n\n판매자 웹 → API 서버 → DB.\n',
  '설계/개발표준.md': '# 개발 표준\n\n- 커밋: `type: 요약` 한 줄\n',
  '설계/결정/DEC-005-취소사유.md': '# DEC-005 취소 사유는 고정 목록\n\n| ID | 결정 |\n|---|---|\n| DEC-005 | 취소 사유는 고정 목록 5개 + 기타 |\n',
  '데이터/주문.md': `# 주문 데이터

### shop.orders 주문
주문. 기능: FN-020 · FN-024 · 영역: 주문

| 컬럼 | 논리명 | 타입 | 널 | 키 | 참조 | 설명 |
|---|---|---|---|---|---|---|
| id | ID | bigint | N | PK | | |
| status | 상태 | varchar(20) | N | | | 결제 · 접수 · 출고 · 취소 |
| cancel_reason | 취소 사유 | varchar(30) | Y | | | DEC-005 |

### shop.order_items 주문 상품
주문 한 줄. 기능: FN-020 · 영역: 주문

| 컬럼 | 논리명 | 타입 | 널 | 키 | 참조 | 설명 |
|---|---|---|---|---|---|---|
| order_id | 주문 ID | bigint | N | PK,FK | shop.orders.id | |
| qty | 수량 | int | N | | | |
`,
  '화면/README.md': '# 화면 목록\n\n| ID | 화면 |\n|---|---|\n| SCR-ORD-01 | 주문 목록 |\n| SCR-ORD-03 | 주문 상세 |\n',
  '기능/README.md': '# 기능\n\n기능 하나에 한 문서.\n',
  '기능/001-회원관리.md': feat('001', '회원 관리', '1차 오픈', '배포', [['FN-001', '이메일 · 휴대폰 인증 가입'], ['FN-002', '휴대폰 인증 문자 발송'], ['FN-003', '로그인 · 로그인 유지 14일'], ['FN-004', '비밀번호 재설정']], [['AC-001-1', '같은 이메일로 두 번 가입할 수 없다', '통과'], ['AC-002-1', '인증 문자는 3분 뒤 만료된다', '통과'], ['AC-003-1', '5회 틀리면 10분 잠금', '통과']], [['API-MEM-01', 'POST /auth/signup', '가입'], ['API-MEM-02', 'POST /auth/sms', '인증 문자'], ['API-MEM-03', 'POST /auth/login', '로그인']], [['SCR-MEM-01', '로그인'], ['SCR-MEM-02', '가입']], ['members', 'sms_codes']),
  '기능/002-상품관리.md': feat('002', '상품 관리', '1차 오픈', '검증', [['FN-010', '상품 등록 (이미지 5장까지)'], ['FN-011', '이미지 업로드 · 순서 바꾸기'], ['FN-012', '재고 수량 조정'], ['FN-013', '판매 중지 · 재개']], [['AC-010-1', '이미지 6장째는 올라가지 않는다', '통과'], ['AC-012-1', '재고는 0 아래로 내려가지 않는다', '통과'], ['AC-013-1', '판매 중지 상품은 주문 화면에 안 보인다', '시험 중']], [['API-PRD-01', 'GET /products', '목록'], ['API-PRD-02', 'POST /products', '등록'], ['API-PRD-04', 'PATCH /products/{id}/stock', '재고']], [['SCR-PRD-01', '상품 목록'], ['SCR-PRD-02', '상품 등록']], ['products', 'product_images']),
  '기능/003-주문관리.md': feat('003', '주문 관리', '1차 오픈', '구현', [['FN-020', '주문 목록 · 상태 필터'], ['FN-021', '주문 상태 전이 (결제 → 접수 → 출고)'], ['FN-022', '송장 번호 입력'], ['FN-024', '출고 전 주문 취소 (사유 선택)']], [['AC-020-1', '상태 필터를 바꾸면 주소에 남는다', '아직'], ['AC-024-1', '출고된 주문은 취소 버튼이 보이지 않는다', '아직'], ['AC-024-2', '취소하면 재고가 돌아온다', '아직']], [['API-ORD-01', 'GET /orders', '목록'], ['API-ORD-02', 'GET /orders/{id}', '상세'], ['API-ORD-04', 'POST /orders/{id}/ship', '출고'], ['API-ORD-05', 'POST /orders/{id}/cancel', '출고 전 주문을 취소한다']], [['SCR-ORD-01', '주문 목록'], ['SCR-ORD-03', '주문 상세']], ['orders', 'order_items']),
  '기능/004-정산.md': feat('004', '정산', '2차 · 정산', '명세', [['FN-030', '주간 정산서 만들기'], ['FN-031', '수수료 계산'], ['FN-032', '정산서 내려받기']], [], [], [['SCR-STL-01', '정산 내역']], ['settlements']),
  '자료실/README.md': '# 자료실\n\n회의 자료 · 고객 제공 문서를 둔다.\n',
  '자료실/회의록/2026-11-20-킥오프.md': '# 2026-11-20 킥오프\n\n- 1차 범위 · 일정\n',
};

/** dir 에 원본을 쓰고 사이트를 만들어 out 에 쓴다. db = 빌드 DB (없으면 이 폴더의 site-db.json) */
function build(dir, out, db, opt = {}) {
  const write = (root, pages) => { for (const [p, c] of Object.entries(pages)) { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), c); } };
  // opt.labels = { 묶음: 표시 이름 } (프로필이 docs-site.json 에 넣는 탭 이름)
  const cfg = JSON.parse(files['docs-site.json']);
  if (opt.labels) for (const g of cfg.groups) if (opt.labels[g.group]) g.label = opt.labels[g.group];
  write(dir, { ...files, 'docs-site.json': JSON.stringify(cfg, null, 1) });
  const DS = require('../../packs/core/bin/docs-site');
  const res = DS.generate({ name: 'project', dir }, null, out);
  const dbj = db || JSON.parse(fs.readFileSync(path.join(__dirname, 'site-db.json'), 'utf8'));
  // 바뀐 점 보기: 003 주문 관리의 지난 판 셋 (lib/sitehist.js 모양). 지난 방문(11-20) 뒤 커밋 둘, 앞 커밋 하나 + 바탕
  if (!dbj.history) {
    const now = files['기능/003-주문관리.md'];
    const v2 = now.replace('출고 전 주문을 취소한다', '주문을 취소한다');
    const v1 = v2.replace('| AC-024-2 | 취소하면 재고가 돌아온다 | |\n', '');
    const v0 = v1.replace('## 검증', '## 검증 (초안)');
    const f = 'assets/history/fixture003.json';
    res.pages[f] = JSON.stringify({ v: 1, md: '기능/003-주문관리.md', texts: [now, v2, v1, v0], base: 3, commits: [
      { sha: 'c3c3c3c', at: '2026-11-24T15:20:00+09:00', by: 'kim', summary: 'docs: 주문 취소 API 사유 필수로', t: 0 },
      { sha: 'b2b2b2b', at: '2026-11-22T11:00:00+09:00', by: 'lee', summary: 'docs: 취소하면 재고 복구', t: 1 },
      { sha: 'a1a1a1a', at: '2026-11-18T09:00:00+09:00', by: 'hong', summary: 'docs: 검증 절 정리', t: 2 },
    ] });
    dbj.history = { '기능/003-주문관리.html': f };
  }
  res.pages['assets/site-db.json'] = JSON.stringify(dbj, null, 1);
  write(path.join(dir, out), res.pages);
  // API 명세 (Scalar 가 읽는다)
  write(path.join(dir, out), { 'assets/openapi/order-api.json': JSON.stringify({ openapi: '3.0.3', info: { title: '주문 관리 API', version: '1.0.0' }, paths: { '/orders/{id}/cancel': { post: { summary: '출고 전 주문 취소', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: { description: '취소됨' } } } } } }) });
  return path.join(dir, out);
}

module.exports = { files, build };
