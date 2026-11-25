// 유형 · 분야 프로필: workspace.json project.type(유형) · project.domain(분야)에 따라 문서 사이트 탭 이름 · 중심 탭 · 대시보드 숫자 ·
// 마일스톤 이름 · 검증 단계 · 사람 관문 · 에이전트 도구 추천과, 그 프로필이 더하는 빈 쪽(docs-site/ 의 md 뼈대)을 정한다.
// 사이트 DB(lib/sitedb.js) · kedovi type · kedovi domain · upgrade 가 쓴다. Node 기본 모듈만.
'use strict';
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const DOMAINS = { web: '웹 · 앱', game: '게임', device: '웨어러블 · 장치', iot: 'IoT · 임베디드' };
/** 분야를 고르면 켜지는 규칙 팩 (web 은 없음) */
const DOMAIN_PACKS = { web: null, game: 'domain-game', device: 'domain-device', iot: 'domain-iot' };

const TYPE_PROFILE = {
  new: {
    labels: {}, mainTab: '기능', approach: '기능 단위 (명세 → 설계 → AI 구현 → 검증 → 배포)',
    dashboard: [['daysToMilestone', '오픈까지 남은 날'], ['featureProgress', '기능 진행'], ['openIssues', '열린 이슈'], ['dueThisWeek', '이번 주 마감']],
  },
  enhancement: {
    labels: { 기능: '개선' }, mainTab: '이슈', approach: '이슈형 처리 보드 (접수 → 분석 → 수정 → 검증 → 운영 반영) + 개선은 기능 단위',
    dashboard: [['openDefects', '열린 결함'], ['avgLeadDays', '평균 처리 시간'], ['releasedThisWeek', '이번 주 운영 반영'], ['overdue', '처리 기한 넘김']],
  },
  modernization: {
    labels: {}, mainTab: '설계', approach: '현행 분석 → 기능마다 정합표로 같음 확인 → 이관 리허설 → 전환',
    dashboard: [['daysToCutover', '전환까지 남은 날'], ['parityDone', '정합 완료 기능'], ['migrationRehearsal', '이관 리허설'], ['openDiffs', '열린 차이']],
  },
  consulting: {
    labels: { 기능: '요구 영역' }, mainTab: '설계', approach: '현행 분석 → 요구 정의 → 목표 모델 → 이행계획 (코드 없음, 문서가 결과물)',
    dashboard: [['deliverableProgress', '산출물 진행'], ['confirmedReqs', '확정 요구'], ['pendingDecisions', '결정 대기'], ['reviewComments', '검토 의견']],
  },
};

const DOMAIN_PROFILE = {
  web: { milestones: ['1차 오픈', '2차'], ids: ['REQ', 'FN', 'AC', 'API', 'SCR'], unit: '기능: 명세(목표 · FN · AC) · 설계(API · 화면 · 데이터) · 검증', tiers: ['단위 시험', 'e2e', '화면 비교(프로토타입 ↔ 구현)'], gates: ['리뷰 블로커 0', '배포 승인'], tools: ['브라우저 자동화', '문서 사이트'], iface: 'OpenAPI', rules: ['스택 · 코딩 규칙', '화면 정본'] },
  game: { milestones: ['프로토타입', '버티컬 슬라이스', '알파', '베타', '골드', '라이브'], ids: ['REQ', 'FN', 'AC', 'BAL'], unit: '메카닉 · 시스템 명세(규칙 · 상태 · 입력 · 조정값) + 밸런스 표(BAL, 버전 관리) · 검증(시뮬레이션 · 플레이테스트)', tiers: ['에디터 자동 시험', '봇 시뮬레이션 (여러 판, 지표 비교)', '사람 플레이테스트'], gates: ['아트 확정', '손맛 · 재미', '최종 밸런스', '플랫폼 인증'], tools: ['Unreal MCP (UE 5.8)', 'Unity MCP · AI Gateway (베타)'], iface: '세이브 · 네트워크 메시지 형식', rules: ['엔진 판 · 성능 예산', '최종 아트는 AI 가 확정하지 않음'] },
  device: { milestones: ['POC', 'EVT', 'DVT', 'PVT', '양산'], ids: ['REQ', 'FN', 'AC', 'IF', 'HW', 'HAZ', 'RC'], unit: '요구사항 단위 + 위험(HAZ) · 위험 대책(RC) 연결, 대상 보드 판(HW), 펌웨어 · 앱 · 클라우드 몫을 나눔', tiers: ['정적 분석 (MISRA · CERT)', '단위', '에뮬레이터 (Renode · Wokwi)', 'HIL (실제 보드 · 전력 측정)'], gates: ['하드웨어 기동', '전력 · 전파 시험', '안전 검토', '인증 (FCC · CE · 블루투스, 건강 기능이면 의료 규격)'], tools: ['Nordic nRF Connect MCP', 'Wokwi MCP'], iface: 'BLE 통신 표(GATT) · AsyncAPI', rules: ['SDK 판 · 메모리 · 전력 예산', 'MISRA · CERT 규칙'] },
  iot: { milestones: ['POC', 'EVT', 'DVT', 'PVT', '출시'], ids: ['REQ', 'FN', 'AC', 'IF', 'HW', 'HAZ'], unit: '요구사항 단위 + 인터페이스 계약(IF: MQTT 주제 · 메시지) + 보드 판, V 모델 추적(요구 ↔ 시험 단계)', tiers: ['정적 분석', '단위', '에뮬레이터 (QEMU · Renode · Wokwi)', 'HIL 농장 (CI 에서 굽고 · 시리얼 확인)', '현장 원격 측정'], gates: ['하드웨어 기동', '보안 (EN 303 645 · IEC 62443)', 'EU 사이버 복원력법 · SBOM', '안전 (IEC 61508 · ISO 26262, 해당 시)'], tools: ['ESP-IDF MCP', 'Wokwi MCP', 'Renode'], iface: 'AsyncAPI (MQTT) · 레지스터 맵', rules: ['MCU · RTOS · SDK 판', '전력 · 메모리 예산', '금지 API'] },
};

const typeOf = (ws) => { const t = ((ws && ws.project) || {}).type; return TYPE_PROFILE[t] ? t : 'new'; };
const domainOf = (ws) => { const d = ((ws && ws.project) || {}).domain; return DOMAIN_PROFILE[d] ? d : 'web'; };

/** 사이트 DB 의 profile 칸. labels 는 유형 기본에 docs-site.json 묶음의 label 을 덮는다 */
function profileOf(ws, config = {}) {
  const type = typeOf(ws);
  const domain = domainOf(ws);
  const t = TYPE_PROFILE[type];
  const d = DOMAIN_PROFILE[domain];
  const labels = { ...t.labels };
  for (const g of Array.isArray(config.groups) ? config.groups : []) if (g && g.group && typeof g.label === 'string' && g.label.trim()) labels[g.group] = g.label.trim();
  return {
    type, domain, labels, mainTab: t.mainTab, approach: t.approach,
    dashboard: t.dashboard.map(([key, label]) => ({ key, label })),
    milestones: [...d.milestones], tiers: [...d.tiers], gates: [...d.gates], tools: [...d.tools], ids: [...d.ids], iface: d.iface, unit: d.unit, rules: [...d.rules],
  };
}

// ───────── 빈 쪽 (md 뼈대) ─────────

const TEMPLATE = path.join('기능', '_template.md');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
function listFiles(dir, rel = '') {
  let ents = [];
  try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return []; }
  return ents.sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => (e.isDirectory() ? listFiles(dir, path.join(rel, e.name)) : e.isFile() ? [path.join(rel, e.name)] : []));
}
/** 그 유형 · 분야가 더하는 빈 쪽 (docs-site/ 기준 경로, 기능 문서 틀 제외) */
const stubFiles = (key) => listFiles(path.join(ASSETS, 'profile', key)).filter((f) => f !== TEMPLATE);
/** 분야별 기능 문서 틀 (web = 기본 뼈대) */
const templateOf = (domain) => read(path.join(ASSETS, 'profile', domain, TEMPLATE)) || read(path.join(ASSETS, 'workspace', 'docs-site', TEMPLATE));

/** docs-site.json 이 손대지 않은 뼈대인가 (build 가 채우는 title · source · pagesUrl 과 묶음의 label 은 빼고 비교) */
function bareMenu(cfg) {
  const { source: _s, pagesUrl: _p, title: _t, ...menu } = cfg || {};
  return JSON.stringify({ ...menu, groups: (menu.groups || []).map(({ label: _l, ...g }) => g) });
}

/** docs-site.json 쓰기: 뼈대처럼 묶음 하나를 한 줄로 */
function menuJson(cfg) {
  const one = (v) => JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ').replace(/\[ /g, '[').replace(/ \]/g, ']');
  const body = Object.entries(cfg).map(([k, v]) => (k === 'groups' && Array.isArray(v)
    ? `  "groups": [\n${v.map((g) => `    ${one(g)}`).join(',\n')}\n  ]`
    : `  ${JSON.stringify(k)}: ${one(v)}`));
  return `{\n${body.join(',\n')}\n}\n`;
}

/**
 * 워크스페이스 docs-site/ 에 지금 유형 · 분야의 빈 쪽을 없는 것만 더한다. 사람이 고친 파일은 건드리지 않는다.
 * 기능 문서 틀은 뼈대 그대로(어느 분야의 틀이든 손대지 않음)일 때만 분야 틀로 바꾸고, 뼈대 그대로인 docs-site.json 이면 탭 이름(label)을 유형대로.
 * docs-site/ 가 없거나 옛 사이트 출력이면 하지 않는다. 반환 = 알릴 줄
 */
function applyProfile(root, ws) {
  const src = path.join(root, 'docs-site');
  try { if (!fs.statSync(src).isDirectory() || fs.existsSync(path.join(src, 'assets', 'site.json'))) return []; } catch { return []; }
  const type = typeOf(ws);
  const domain = domainOf(ws);
  const lines = [];
  const made = [];
  for (const key of [type, domain]) {
    for (const rel of stubFiles(key)) {
      const to = path.join(src, rel);
      if (fs.existsSync(to)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(ASSETS, 'profile', key, rel), to);
      made.push(rel.split(path.sep).join('/'));
    }
  }
  if (made.length) lines.push(`프로필 쪽 ${made.length}개 더함 (docs-site/): ${made.join(' · ')}`);
  const tplFile = path.join(src, TEMPLATE);
  const cur = read(tplFile);
  const want = templateOf(domain);
  if (cur !== null && want && cur !== want && Object.keys(DOMAINS).map(templateOf).includes(cur)) {
    fs.writeFileSync(tplFile, want);
    lines.push(`기능 문서 틀을 ${DOMAINS[domain]} 분야 틀로: docs-site/기능/_template.md`);
  }
  const cfgFile = path.join(src, 'docs-site.json');
  let cfg = null;
  let skel = null;
  try { cfg = JSON.parse(read(cfgFile)); skel = JSON.parse(read(path.join(ASSETS, 'workspace', 'docs-site', 'docs-site.json'))); } catch { /* 없거나 깨짐: 그대로 */ }
  if (cfg && skel && Array.isArray(cfg.groups) && bareMenu(cfg) === bareMenu(skel)) {
    const labels = TYPE_PROFILE[type].labels;
    const groups = cfg.groups.map(({ label: _l, ...g }) => (labels[g.group] ? { ...g, label: labels[g.group] } : g));
    const next = { ...cfg, groups };
    if (JSON.stringify(next) !== JSON.stringify(cfg)) {
      fs.writeFileSync(cfgFile, menuJson(next));
      const shown = Object.entries(labels).map(([g, l]) => `${g} → ${l}`).join(' · ');
      lines.push(shown ? `문서 사이트 탭 이름: ${shown} (docs-site/docs-site.json)` : '문서 사이트 탭 이름을 기본으로 (docs-site/docs-site.json)');
    }
  }
  return lines;
}

module.exports = { DOMAINS, DOMAIN_PACKS, TYPE_PROFILE, DOMAIN_PROFILE, profileOf, typeOf, domainOf, stubFiles, templateOf, applyProfile, bareMenu, menuJson };
