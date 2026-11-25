/**
 * 프로필(유형 · 분야) 시험 재료 (bin/site-test.js): 주문 관리 빌드 DB(site-db.json)에 프로필 칸을 더한 판.
 * 칸 모양은 데이터 쪽 계약 그대로 (profile · metrics · interfaces · features[].hw/risks/ifs/bal/tiers · ids 종류 BAL IF HW HAZ RC · relations bal/ifs/hw/risks).
 * enhancement(웹 · 운영) · game · device 세 판. 화면 시험용이라 값은 손으로 적었다
 */
'use strict';

const fs = require('fs');
const path = require('path');

const base = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'site-db.json'), 'utf8'));
const feat = (db, no) => db.features.find((f) => f.no === no);
const idDef = (db, id, kind, page, title) => { db.ids[id] = { page, title, kind }; };
const rel = (db, fn, key, ids) => { db.relations[fn] = db.relations[fn] || {}; db.relations[fn][key] = ids; };

/** 운영 · 유지보수 (enhancement) · 웹: 기능 탭 이름 「개선」, 중심 탭 이슈, 숫자 칸 넷 중 둘은 빌드가 못 구함(null) */
function enhancement() {
  const db = base();
  db.profile = {
    type: 'enhancement', domain: 'web', labels: { 기능: '개선' }, mainTab: '이슈',
    approach: '이슈형 처리 보드 (접수 → 분석 → 수정 → 검증 → 운영 반영) + 개선은 기능 단위',
    dashboard: [{ key: 'openDefects', label: '열린 결함' }, { key: 'avgLeadDays', label: '평균 처리 시간' }, { key: 'releasedThisWeek', label: '이번 주 운영 반영' }, { key: 'overdue', label: '처리 기한 넘김' }],
    milestones: ['1차 오픈', '2차'],
    tiers: ['단위 시험', 'e2e', '화면 비교(프로토타입 ↔ 구현)'], gates: ['리뷰 블로커 0', '배포 승인'], tools: ['브라우저 자동화', '문서 사이트'],
    ids: ['REQ', 'FN', 'AC', 'API', 'SCR'], iface: 'OpenAPI', unit: '기능: 명세(목표 · FN · AC) · 설계(API · 화면 · 데이터) · 검증', rules: ['스택 · 코딩 규칙', '화면 정본'],
  };
  db.metrics = { openDefects: { value: 3, sub: '접수 1 · 수정 2' }, avgLeadDays: { value: 2.5, sub: '지난 30일 닫힌 이슈 4건' }, releasedThisWeek: null, overdue: null };
  feat(db, '001').tiers = [{ tier: '단위 시험', result: '통과', where: 'CI' }, { tier: 'e2e', result: '통과', where: 'CI' }];
  feat(db, '002').tiers = [{ tier: '단위 시험', result: '통과', where: 'CI' }, { tier: 'e2e', result: '시험 중', where: '' }];
  return db;
}

/** 게임: 기능 002 에 밸런스 표 BAL- 둘 */
function game() {
  const db = base();
  db.profile = {
    type: 'new', domain: 'game', labels: {}, mainTab: '기능',
    approach: '기능 단위 (명세 → 설계 → AI 구현 → 검증 → 배포)',
    dashboard: [{ key: 'daysToMilestone', label: '오픈까지 남은 날' }, { key: 'featureProgress', label: '기능 진행' }, { key: 'openIssues', label: '열린 이슈' }, { key: 'dueThisWeek', label: '이번 주 마감' }],
    milestones: ['프로토타입', '버티컬 슬라이스', '알파', '베타', '골드', '라이브'],
    tiers: ['에디터 자동 시험', '봇 시뮬레이션 (여러 판, 지표 비교)', '사람 플레이테스트'], gates: ['아트 확정', '손맛 · 재미', '최종 밸런스', '플랫폼 인증'], tools: ['Unreal MCP (UE 5.8)', 'Unity MCP · AI Gateway (베타)'],
    ids: ['REQ', 'FN', 'AC', 'BAL'], iface: '세이브 · 네트워크 메시지 형식', unit: '메카닉 · 시스템 명세', rules: ['엔진 판 · 성능 예산'],
  };
  db.metrics = { daysToMilestone: null, featureProgress: null, openIssues: null, dueThisWeek: null };
  const f = feat(db, '002');
  f.bal = ['BAL-001', 'BAL-002'];
  f.tiers = [{ tier: '에디터 자동 시험', result: '통과', where: 'CI' }, { tier: '봇 시뮬레이션 (여러 판, 지표 비교)', result: '실패', where: '1000판 · 승률 61%' }];
  idDef(db, 'BAL-001', 'BAL', '설계/밸런스/README.html', '무기 피해량 표');
  idDef(db, 'BAL-002', 'BAL', '설계/밸런스/README.html', '드롭 확률 표');
  rel(db, 'FN-010', 'bal', ['BAL-001', 'BAL-002']);
  return db;
}

/** 장치(웨어러블): 기능 003 에 보드 판 · 위험 · 인터페이스 · 검증 단계, 인터페이스 명세 = AsyncAPI(JSON · YAML) + OpenAPI */
function device() {
  const db = base();
  db.profile = {
    type: 'new', domain: 'device', labels: {}, mainTab: '기능',
    approach: '기능 단위 (명세 → 설계 → AI 구현 → 검증 → 배포)',
    dashboard: [{ key: 'daysToMilestone', label: '오픈까지 남은 날' }, { key: 'featureProgress', label: '기능 진행' }, { key: 'openIssues', label: '열린 이슈' }, { key: 'dueThisWeek', label: '이번 주 마감' }],
    milestones: ['POC', 'EVT', 'DVT', 'PVT', '양산'],
    tiers: ['정적 분석 (MISRA · CERT)', '단위', '에뮬레이터 (Renode · Wokwi)', 'HIL (실제 보드 · 전력 측정)'],
    gates: ['하드웨어 기동', '전력 · 전파 시험', '안전 검토', '인증 (FCC · CE · 블루투스)'], tools: ['Nordic nRF Connect MCP', 'Wokwi MCP'],
    ids: ['REQ', 'FN', 'AC', 'IF', 'HW', 'HAZ', 'RC'], iface: 'BLE 통신 표(GATT) · AsyncAPI', unit: '요구사항 단위 + 위험 · 대책 연결, 대상 보드 판', rules: ['SDK 판 · 메모리 · 전력 예산', 'MISRA · CERT 규칙'],
  };
  db.metrics = { daysToMilestone: { value: 18, sub: 'EVT · 12월 12일' }, featureProgress: { value: '1 / 4', sub: '배포 1 · 진행 2 · 대기 1' }, openIssues: { value: 2, sub: '수정 2' }, dueThisWeek: null };
  const f = feat(db, '003');
  f.hw = ['HW-B2'];
  f.risks = ['HAZ-003', 'RC-003-1'];
  f.ifs = ['IF-BLE-01'];
  f.tiers = [
    { tier: '정적 분석 (MISRA · CERT)', result: '통과', where: 'CI' },
    { tier: '단위', result: '통과', where: 'CI' },
    { tier: '에뮬레이터 (Renode · Wokwi)', result: '실패', where: 'Renode' },
  ];
  feat(db, '001').tiers = [{ tier: '정적 분석 (MISRA · CERT)', result: '통과', where: 'CI' }, { tier: 'HIL (실제 보드 · 전력 측정)', result: '통과', where: 'HW-B2 (EVT)' }];
  idDef(db, 'HW-B2', 'HW', '설계/아키텍처.html', '메인 보드 B2 (EVT)');
  idDef(db, 'HAZ-003', 'HAZ', '설계/아키텍처.html', '피부 접촉부 과열');
  idDef(db, 'RC-003-1', 'RC', '설계/아키텍처.html', '충전 중 온도 41도 넘으면 충전 멈춤');
  idDef(db, 'IF-BLE-01', 'IF', '설계/아키텍처.html', '수면 데이터 알림 (GATT)');
  for (const fn of ['FN-020', 'FN-021', 'FN-022', 'FN-024']) { rel(db, fn, 'hw', ['HW-B2']); rel(db, fn, 'risks', ['HAZ-003', 'RC-003-1']); rel(db, fn, 'ifs', ['IF-BLE-01']); }
  db.interfaces = [
    { repo: 'band-fw', kind: 'asyncapi', title: '수면 밴드 메시지', file: 'assets/asyncapi/band-fw.json', channels: [
      { name: 'band/{id}/sleep', action: 'send', messages: [{ name: 'SleepSample', fields: ['ts', 'hr', 'motion', 'stage'] }, { name: 'SleepSummary', fields: ['date', 'score'] }] },
      { name: 'band/{id}/cmd', action: 'receive', messages: [{ name: 'SetAlarm', fields: ['at', 'vibe'] }] },
    ] },
    { repo: 'band-gw', kind: 'asyncapi', title: '게이트웨이 메시지', file: 'assets/asyncapi/band-gw.yaml', channels: [] },
    { repo: 'order-api', kind: 'openapi', title: '주문 관리 API', file: 'assets/openapi/order-api.json', channels: [] },
  ];
  return db;
}

module.exports = { enhancement, game, device };
