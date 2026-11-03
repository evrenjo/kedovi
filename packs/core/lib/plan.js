// 로드맵(handoffs/PLAN.md) 읽기·그리기: 단계 흐름 · 영역 × 하위 작업 표 · 한 줄 요약 · JSON. 사용: kedovi plan, 세션 브리핑, handoff check
/*
 * PLAN.md 형식 (사람이 고치는 정본. 상태만 사람이 판단하고 숫자는 도구가 센다)
 *   | # | 단계 | 상태 | 시작 | 완료 |     단계 표. 상태: ✔ 완료 · ▶ 진행 · ○ 미착수 · ◇ 미분해
 *   ## <단계 이름>                        하위 작업 (그 단계를 시작할 때 쪼갠다)
 *     표: 첫 열 = 영역, 나머지 열 = 하위 작업, 칸 = ✔ ▶ ○ (- 는 해당 없음)
 *     또는 체크 목록: - [x] 끝남 · - [ ] 남음
 *   ## 분모 변경                          - YYYY-MM-DD · 무엇 n → m · 사유
 *   ## 지난 릴리스 · 지난 스프린트        (반복형) - YYYY-MM-DD · 릴리스(스프린트) · 한 줄
 *   ## 이번 스프린트                      (스프린트) 목표: 한 줄 · 끝: YYYY-MM-DD(선택) · - [ ] 이번 스프린트 기능 = 「구현」 단계의 하위 작업
 *   ## 백로그                             (스프린트) - 나중에 붙일 기능 한 줄씩 (지금 만들지 않는다)
 *   <!-- kedovi:preset -->                 기본 단계 그대로 (프로젝트에 맞게 고치면 지운다)
 * 이슈형(진행 방식 issue, 운영·유지보수): 단계 표 대신 이슈 보드. `## 이슈` 절이 있으면 이슈형으로 읽고 단계 표는 읽지 않는다
 *   ## 이슈                               상태: 접수 · 분석 · 수정 · 검증 · 운영 반영 · 보류   (이 줄로 상태 목록을 바꾼다. 보류 · 대기 = 멈춤, 그 밖의 마지막 = 완료)
 *     | 이슈 | 제목 | 상태 | 브랜치 | 시작 | 갱신 | 운영 반영 |   멈춤 기준: 14일 (선택, 갱신 · 시작 뒤로 이만큼 지나면 ⚠)
 *   ## 개선 후보                          - 착수 전 개선 아이디어 한 줄씩 (착수하면 이슈 표로 옮긴다)
 * 스택에 따라 끼우는 단계: DB 계층이 있으면 「데이터 설계」, 화면 계층(웹 · 모바일 · 데스크톱 등)이 있으면 「화면설계」.
 *   (아키텍처·)설계 다음, 구현 앞. 데이터 설계 → 화면설계 순 (화면이 보여 줄 데이터 · 저장 구조가 먼저). 반복형은 단계를 늘리지 않고 첫 단계(분석 · 스프린트 계획) 체크 목록에.
 * 진행 방식(workspace.json project.approach): sprint(스프린트) 이면 반복형 「스프린트 계획 → 구현 → 데모 → 회고」, issue(이슈형)면 이슈 보드, full(전체)·없음이면 종류별 기본 단계.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join('handoffs', 'PLAN.md');
const PRESET_MARK = '<!-- kedovi:preset';

// 종류별 기본 단계: 공개 출처의 흔한 구성 (SDLC 7단계 · 행정기관 정보시스템 구축·운영 지침 · 레거시 전환 가이드 · NIA ISP·ISMP 공통가이드)
const PRESETS = {
  new: { stages: ['계획', '요구사항 분석', '설계', '구현', '테스트', '배포', '운영'] },
  modernization: { stages: ['AS-IS 분석', '범위·계획', '요구사항', '아키텍처·설계', '구현', '테스트', '데이터 이관', '전환', '안정화'] },
  // 운영·고도화 + 전체 = 고도화(개발형). 이슈마다 운영 반영하는 운영·유지보수는 진행 방식 이슈형
  enhancement: { stages: ['요구사항', '설계', '구현', '테스트', '오픈'] },
  consulting: { stages: ['착수', '환경·현황 분석', '목표 모델·요구사항 상세화', '이행 계획', '최종 보고'] },
  // 스프린트: 기간이 아니라 기능 단위. 끝까지 동작하는 최소 기능부터, 스프린트마다 데모 · 회고하고 백로그에서 하나씩 붙인다
  sprint: { stages: ['스프린트 계획', '구현', '데모', '회고'], cycle: true, checksAt: '스프린트 계획', backlog: true },
  // 이슈형: 이슈마다 따로 운영에 반영되고 여러 이슈가 서로 다른 상태에 있다 → 단계 대신 이슈 보드
  issue: { stages: [], issue: true },
};
// 0.63 전 운영·고도화 기본 단계 (반복형). 이 단계 그대로인 로드맵은 진행 방식을 바꿀 때(kedovi approach · type)만 새 뼈대로 바꾼다
const OLD_ENHANCEMENT = ['접수', '분석', '구현', '테스트', '배포'];
/** 종류 · 진행 방식 → 기본 단계 묶음 */
function presetOf(type, approach) {
  if (approach === 'issue') return PRESETS.issue;
  if (approach === 'sprint') return PRESETS.sprint;
  return PRESETS[type] || PRESETS.new;
}
const ISSUE_STATES = ['접수', '분석', '수정', '검증', '운영 반영', '보류'];
const STALE_DAYS = 14;

// 스택에 따라 끼우는 단계 · 단계를 맡는 스킬 (단계를 시작할 때 그 스킬의 「진행 방식 합의」 부터)
const STACK_STAGES = [{ name: '데이터 설계', when: 'db', skill: 'datamodel' }, { name: '화면설계', when: 'ui', skill: 'screens' }];
// 신규 구축의 첫 단계: 무엇을 왜 만드는지 대화로 정하고 전체 그림 · MVP 범위를 잡는다 (idea 스킬). 건너뛰면 상태를 「✔ 건너뜀」
const IDEA_STAGE = '아이디어 · 전체 그림';
const STAGE_SKILLS = { ...Object.fromEntries(STACK_STAGES.map((x) => [x.name, x.skill])), [IDEA_STAGE]: 'idea', '아키텍처·설계': 'architecture' };
const norm = (n) => String(n).replace(/\s+/g, '');
const isIdea = (name) => norm(name) === norm(IDEA_STAGE); // 「아이디어·전체 그림」 처럼 띄어쓰기가 달라도
/** 기본 단계 그대로인 로드맵에 붙이는 안내: 아이디어 단계 중이면 그 대화가 끝난 뒤에 묻는다 (첫 질문이 겹치지 않게) */
const presetHint = (plan) => (plan.stages.find((s) => s.state === 'doing' && isIdea(s.name)) ? `「${IDEA_STAGE}」 이 끝나면 프로젝트에 맞게 고칠지 사용자에게 묻는다` : '프로젝트에 맞게 고칠지 사용자에게 묻는다');
const skillOf = (stage) => (stage ? STAGE_SKILLS[Object.keys(STAGE_SKILLS).find((k) => norm(k) === norm(stage.name))] || null : null);
const UI_LAYERS = ['frontend', 'desktop', 'mobile', 'watch', 'tv'];

/** 종류 · 스택(layers: { db, ui })에 맞는 단계 목록 */
function stagesFor(type, layers = {}, approach) {
  const p = presetOf(type, approach);
  const idea = type === 'new' && !p.issue ? [IDEA_STAGE] : []; // 신규 구축은 MVP · 워터폴 모두 아이디어부터
  const extra = p.cycle ? [] : STACK_STAGES.filter((x) => layers[x.when]).map((x) => x.name);
  const at = p.stages.findIndex((x) => x === '구현');
  if (!extra.length || at < 0) return [...idea, ...p.stages];
  return [...idea, ...p.stages.slice(0, at), ...extra, ...p.stages.slice(at)];
}

/** 이미 만든 로드맵에 스택에 맞는 단계가 빠졌으면 경고 문장 (사람이 고친 PLAN.md 는 건드리지 않는다) */
function missingStages(plan, layers = {}, type, approach) {
  if (!plan || plan.issues || presetOf(type, approach).cycle || presetOf(type, approach).issue) return [];
  const have = new Set(plan.stages.map((s) => norm(s.name)));
  const miss = STACK_STAGES.filter((x) => layers[x.when] && !have.has(norm(x.name)));
  if (!miss.length) return [];
  const who = miss.map((x) => ({ db: 'DB', ui: '화면' }[x.when])).join(' · ');
  return [`스택에 ${who}${/화면$/.test(who) ? '이' : ' 가'} 있는데 ${miss.map((x) => `「${x.name}」`).join(' · ')} 단계가 없습니다 (산출물: ${miss.map((x) => `${x.skill} 스킬`).join(' · ')}. 구현 앞에 넣을지 사용자에게 묻는다)`];
}

/** 기본 단계 그대로(<!-- kedovi:preset -->)인 PLAN.md 를 스택에 맞게 다시 쓴다. 단계 상태 · 날짜는 그대로 옮긴다. 바꿀 것이 없으면 null */
function upgradePreset(text, type, layers = {}, approach) {
  if (!String(text).includes(PRESET_MARK) || presetOf(type, approach).issue) return null;
  const plan = parse(text);
  if (!plan) return null;
  const names = plan.stages.map((x) => (isIdea(x.name) ? IDEA_STAGE : x.name)); // 띄어쓰기가 다른 아이디어 단계도 같은 이름으로
  const want = stagesFor(type, layers, approach).filter((n) => n !== IDEA_STAGE || names.includes(IDEA_STAGE)); // 이미 만든 로드맵에 아이디어 단계를 끼우지 않는다
  if (want.join('|') === names.join('|') || !names.every((n) => want.includes(n))) return null;
  const lines = text.split('\n');
  const head = lines.findIndex((l) => /^\s*\|/.test(l) && /단계/.test(l) && /상태/.test(l));
  if (head < 0) return null;
  let end = head + 1;
  while (end < lines.length && /^\s*\|/.test(lines[end])) end++;
  const old = new Map(plan.stages.map((x) => [isIdea(x.name) ? IDEA_STAGE : x.name, x]));
  const rows = want.map((n, i) => { const o = old.get(n); return `| ${i + 1} | ${o ? o.name : n} | ${STATE[o ? o.state : 'todo']} | ${o ? o.start : ''} | ${o ? o.end : ''} |`.replace(/ {2,}\|/g, ' |'); });
  return [...lines.slice(0, head + 2), ...rows, ...lines.slice(end)].join('\n');
}

const STATE = { done: '✔', doing: '▶', todo: '○', unsplit: '◇' };
const LABEL = { done: '완료', doing: '진행', todo: '미착수', unsplit: '미분해' };

function stateOf(cell) {
  const c = String(cell || '').trim();
  if (/^(✔|✅|완료|done)/i.test(c) || /^v$/i.test(c)) return 'done';
  if (/^(▶|진행|doing)/i.test(c)) return 'doing';
  if (/^(◇|미분해)/.test(c)) return 'unsplit';
  if (/^(-|해당 ?없음|n\/a)$/i.test(c)) return 'na';
  return 'todo';
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((x) => x.trim());
const isSep = (line) => /^\s*\|?\s*:?-{2,}/.test(line) && /^[\s|:-]+$/.test(line);
const stripNo = (s) => String(s).replace(/^\s*\d+\s*[.)]?\s*/, '').trim();

/** 연속한 표 줄 묶음 → { head, rows } (구분줄 제외) */
function tables(lines) {
  const out = [];
  let cur = null;
  for (const l of lines) {
    if (/^\s*\|/.test(l)) {
      if (!cur) { cur = { head: cells(l), rows: [] }; out.push(cur); } else if (!isSep(l)) cur.rows.push(cells(l));
    } else cur = null;
  }
  return out;
}

/** 본문을 ## 절로 나눈다 → [{ title, lines }] (첫 항목은 머리말) */
function sections(text) {
  const out = [{ title: '', lines: [] }];
  for (const l of text.split('\n')) {
    const m = l.match(/^##\s+(.+?)\s*$/);
    if (m) out.push({ title: m[1], lines: [] }); else out[out.length - 1].lines.push(l);
  }
  return out;
}

const bullets = (lines) => lines.filter((l) => /^\s*[-*]\s+\S/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, '').trim());

/** 하위 작업 절 → { kind: 'table'|'list', cols, areas: [{ name, cells: [state] }], done, total } */
function parseDetail(lines) {
  const t = tables(lines)[0];
  if (t && t.head.length >= 2) {
    const cols = t.head.slice(1);
    const areas = t.rows.filter((r) => r[0]).map((r) => ({ name: r[0], cells: cols.map((_, i) => stateOf(r[i + 1])) }));
    const all = areas.flatMap((a) => a.cells).filter((s) => s !== 'na');
    return { kind: 'table', cols, areas, done: all.filter((s) => s === 'done').length, total: all.length };
  }
  const items = lines.map((l) => l.match(/^\s*[-*]\s+\[( |x|X|~)\]\s+(.+)$/)).filter(Boolean)
    .map((m) => ({ name: m[2].trim(), state: m[1].toLowerCase() === 'x' ? 'done' : 'todo' }));
  if (!items.length) return null;
  return { kind: 'list', items, done: items.filter((i) => i.state === 'done').length, total: items.length };
}

/** PLAN.md 본문 → 로드맵 객체. 단계 표가 없으면 null */
function parse(text) {
  const secs = sections(text || '');
  const issueSec = secs.slice(1).find((s) => stripNo(s.title) === '이슈');
  if (issueSec) return parseIssues(secs, issueSec, text);
  let stages = null;
  for (const s of secs) {
    const t = tables(s.lines).find((x) => x.head.some((h) => /단계/.test(h)) && x.head.some((h) => /상태/.test(h)));
    if (!t) continue;
    const col = (re) => t.head.findIndex((h) => re.test(h));
    const [ci, cn, cs, cstart, cend] = [col(/^#|번호/), col(/단계/), col(/상태/), col(/시작/), col(/완료|끝/)];
    stages = t.rows.filter((r) => r[cn]).map((r, i) => ({
      no: Number((ci >= 0 && r[ci]) || i + 1) || i + 1,
      name: stripNo(r[cn]),
      state: (() => { const v = stateOf(r[cs]); return v === 'na' ? 'todo' : v; })(),
      start: cstart >= 0 ? (r[cstart] || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || '' : '',
      end: cend >= 0 ? (r[cend] || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || '' : '',
      detail: null,
    }));
    break;
  }
  if (!stages) return null;
  const byName = new Map(stages.map((s) => [s.name, s]));
  const plan = { stages, changes: [], releases: [], backlog: null, sprint: null, preset: text.includes(PRESET_MARK) };
  let iteration = null;
  for (const s of secs.slice(1)) {
    const name = stripNo(s.title);
    if (/^분모 ?변경/.test(name)) plan.changes = bullets(s.lines);
    else if (/^지난 ?(릴리스|스프린트)/.test(name)) plan.releases = bullets(s.lines);
    else if (/^백로그/.test(name)) plan.backlog = bullets(s.lines);
    else if (/^이번 ?스프린트/.test(name)) {
      iteration = parseDetail(s.lines);
      const goal = s.lines.map((l) => l.match(/^\s*목표\s*[:：]\s*(.+?)\s*$/)).find(Boolean);
      const end = s.lines.map((l) => l.match(/^\s*끝\s*[:：]\s*(\d{4}-\d{2}-\d{2})/)).find(Boolean);
      plan.sprint = { goal: goal && !/^<.*>$/.test(goal[1]) ? goal[1] : '', end: end ? end[1] : '' };
    }
    else if (byName.has(name)) byName.get(name).detail = parseDetail(s.lines);
  }
  // 스프린트: 「이번 스프린트」 체크 목록 = 「구현」 단계의 하위 작업 (구현 절을 따로 쓰지 않았으면)
  const impl = stages.find((x) => x.name === '구현');
  if (iteration && impl && !impl.detail) impl.detail = iteration;
  return plan;
}

const DATE = /\d{4}-\d{2}-\d{2}/;
const dateIn = (v) => (String(v || '').match(DATE) || [''])[0];

/** 이슈형 로드맵: `## 이슈` 절(상태 줄 · 표) + `## 개선 후보` */
function parseIssues(secs, sec, text) {
  const line = sec.lines.map((l) => l.match(/^\s*상태\s*[:：]\s*(.+?)\s*$/)).find(Boolean);
  const states = line ? line[1].split(/\s*[·,|/]\s*/).map((x) => x.trim()).filter(Boolean) : [...ISSUE_STATES];
  const stale = sec.lines.map((l) => l.match(/멈춤\s*기준\s*[:：]\s*(\d+)/)).find(Boolean);
  const t = tables(sec.lines).find((x) => x.head.some((h) => /상태/.test(h)));
  const rows = [];
  if (t) {
    const col = (re) => t.head.findIndex((h) => re.test(h));
    const c = { id: col(/이슈|번호|^id$|티켓/i), title: col(/제목|내용/), state: col(/상태/), branch: col(/브랜치/), start: col(/시작|접수일/), updated: col(/갱신|변경/), released: col(/반영|오픈|배포/) };
    for (const r of t.rows) {
      const v = (k) => (c[k] >= 0 ? r[c[k]] || '' : '');
      if (!v('id') && !v('title')) continue;
      rows.push({ id: v('id'), title: v('title'), state: v('state'), branch: v('branch').replace(/`/g, ''), start: dateIn(v('start')), updated: dateIn(v('updated')), released: dateIn(v('released')) });
    }
  }
  const ideas = secs.slice(1).find((s) => /^개선 ?후보|^백로그/.test(stripNo(s.title)));
  return { mode: 'issue', stages: [], changes: [], releases: [], sprint: null, backlog: ideas ? bullets(ideas.lines) : null, preset: text.includes(PRESET_MARK),
    issues: { states, rows, staleDays: stale ? Number(stale[1]) : STALE_DAYS } };
}

const holdState = (states, s) => /보류|대기|중단/.test(s) && states.includes(s);
const doneStateOf = (states) => [...states].reverse().find((s) => !/보류|대기|중단/.test(s)) || '';
/** 이슈 하나의 구분: done(운영 반영) · hold(보류) · active */
function issueKind(states, r) {
  if (holdState(states, r.state)) return 'hold';
  if (r.state === doneStateOf(states) || (r.released && !states.includes(r.state))) return 'done';
  return 'active';
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** 이슈 보드 요약 → { states, counts(상태별 진행 중 건수), active, hold, stale, month(이번 달 운영 반영), done } */
function issueSummary(plan, today = todayStr()) {
  const { states, rows, staleDays } = plan.issues;
  const done = doneStateOf(states);
  const counts = Object.fromEntries(states.filter((s) => s !== done && !holdState(states, s)).map((s) => [s, 0]));
  const active = []; const hold = []; const finished = [];
  for (const r of rows) {
    const k = issueKind(states, r);
    if (k === 'hold') hold.push(r); else if (k === 'done') finished.push(r);
    else { active.push(r); counts[r.state] = (counts[r.state] || 0) + 1; }
  }
  const stale = active.map((r) => ({ ...r, idle: (r.updated || r.start) ? daysBetween(r.updated || r.start, today) : null })).filter((r) => r.idle !== null && r.idle > staleDays);
  const month = finished.filter((r) => r.released && r.released.slice(0, 7) === today.slice(0, 7));
  return { states, doneState: done, counts, active, hold, stale, month, done: finished, staleDays };
}
const issueLabel = (r) => [r.id, r.title].filter(Boolean).join(' ');

function read(root) {
  try { return parse(fs.readFileSync(path.join(root, FILE), 'utf8')); } catch { return null; }
}

const current = (plan) => plan.stages.find((s) => s.state === 'doing') || null;
const doneCount = (plan) => (plan.issues ? issueSummary(plan).done.length : plan.stages.filter((s) => s.state === 'done').length);

/** 날짜 목록(분모 변경 · 지난 릴리스)에서 가장 최근 줄: 적은 순서(위가 최신 · 아래가 최신)와 상관없이 날짜로. 같은 날이면 목록이 최신을 위에 두는 꼴이면 위의 것 */
function latest(list) {
  if (!list || !list.length) return null;
  const d = (x) => (String(x).match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
  const top = d(list[0]) > d(list[list.length - 1]);
  return list.reduce((a, x) => (d(x) > d(a) || (d(x) === d(a) && !top) ? x : a));
}

/** 지금 단계 안에서 다음 칸: 진행 칸이 먼저, 없으면 첫 미착수 칸 */
function nextCell(stage) {
  const d = stage && stage.detail;
  if (!d) return null;
  if (d.kind === 'list') { const i = d.items.findIndex((x) => x.state !== 'done'); return i < 0 ? null : { item: i, label: d.items[i].name }; }
  for (const want of ['doing', 'todo']) {
    for (let a = 0; a < d.areas.length; a++) {
      const c = d.areas[a].cells.indexOf(want);
      if (c >= 0) return { area: a, col: c, label: `${d.areas[a].name} ${d.cols[c]}` };
    }
  }
  return null;
}

/** 다음 순서 한 줄 */
function nextLine(plan) {
  if (plan.issues) {
    const s = issueSummary(plan);
    if (s.stale.length) return `멈춘 이슈 확인 (${s.stale.map(issueLabel).slice(0, 3).join(' · ')})`;
    const old = [...s.active].sort((a, b) => (a.updated || a.start || '9').localeCompare(b.updated || b.start || '9'))[0];
    return old ? `${issueLabel(old)} (${old.state})` : '진행 중 이슈 없음';
  }
  const cur = current(plan);
  if (cur) {
    const n = nextCell(cur);
    if (n) return `${cur.name}: ${n.label}`;
    const after = plan.stages.find((s) => s.no > cur.no && s.state !== 'done');
    return after ? `${cur.name} 마무리 → ${after.name}` : `${cur.name} 마무리`;
  }
  const first = plan.stages.find((s) => s.state !== 'done');
  return first ? `${first.name} 시작` : '모든 단계 완료';
}

/** 화면 폭: 한글·전각은 2칸 */
function width(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) ? 2 : 1;
  }
  return w;
}
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));

const stageMark = (s) => {
  if (s.state === 'doing' && s.detail) return `${STATE.doing} ${s.detail.done}/${s.detail.total}`;
  return STATE[s.state];
};

/** 단계 흐름: 단계 이름 줄 · 상태 줄 · 지금 위치(▲) 줄. 폭을 넘으면 다음 줄로 */
function flow(plan, maxWidth = 76) {
  const ARROW = ' → ';
  if (plan.issues) {
    // 이슈 보드: 상태별 진행 중 건수 → 완료 상태는 이번 달 건수, 보류는 따로
    const s = issueSummary(plan);
    const parts = Object.entries(s.counts).map(([k, n]) => `${k} ${n}`);
    if (s.doneState) parts.push(`${s.doneState} ${s.month.length} (이번 달)`);
    const lines = [];
    let cur = '';
    for (const x of parts) { if (cur && width(cur + ARROW + x) > maxWidth) { lines.push(cur); cur = `→ ${x}`; } else cur = cur ? cur + ARROW + x : x; }
    if (cur) lines.push(cur);
    if (s.hold.length) lines.push(`보류 ${s.hold.length}`);
    return lines.join('\n');
  }
  const blocks = plan.stages.map((s) => {
    const name = `${s.no}.${s.name}`;
    const mark = stageMark(s);
    return { name, mark, here: s.state === 'doing', w: Math.max(width(name), width(mark)) };
  });
  const rows = [];
  let row = [];
  let used = 0;
  for (const b of blocks) {
    const need = (row.length ? width(ARROW) : 0) + b.w;
    if (row.length && used + need > maxWidth) { rows.push(row); row = []; used = 0; }
    used += (row.length ? width(ARROW) : 0) + b.w;
    row.push(b);
  }
  if (row.length) rows.push(row);
  const out = [];
  rows.forEach((r, ri) => {
    const lead = ri ? ARROW.trimStart() : '';
    const gap = ' '.repeat(width(lead));
    out.push(lead + r.map((b) => pad(b.name, b.w)).join(ARROW).trimEnd());
    out.push(gap + r.map((b) => pad(b.mark, b.w)).join(' '.repeat(width(ARROW))).trimEnd());
    if (r.some((b) => b.here)) out.push(gap + r.map((b) => pad(b.here ? '▲ 지금' : '', b.w)).join(' '.repeat(width(ARROW))).trimEnd());
  });
  return out.join('\n');
}

const bar = (done, total, n = 10) => {
  if (!total) return '';
  const k = Math.round((done / total) * n);
  return `${'■'.repeat(k)}${'□'.repeat(n - k)} ${done}/${total}`;
};

/** 지금 단계의 하위 작업 표 (markdown) */
function detailTable(stage) {
  const d = stage.detail;
  if (!d) return `${stage.no}.${stage.name}: 하위 작업을 아직 쪼개지 않았습니다 (PLAN.md 의 \`## ${stage.name}\` 절에 쪼갠다)`;
  const n = nextCell(stage);
  const sym = (s, hit) => (hit ? '◀다음' : s === 'na' ? '-' : STATE[s]);
  if (d.kind === 'list') {
    return [`**${stage.no}.${stage.name}** ${bar(d.done, d.total)}`, '',
      ...d.items.map((it, i) => `- ${sym(it.state, n && n.item === i)} ${it.name}`)].join('\n');
  }
  const head = ['영역', ...d.cols, '진행'];
  const lines = [`**${stage.no}.${stage.name}** ${bar(d.done, d.total)}`, '', `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  d.areas.forEach((a, ai) => {
    const own = a.cells.filter((s) => s !== 'na');
    lines.push(`| ${a.name} | ${a.cells.map((s, ci) => sym(s, n && n.area === ai && n.col === ci)).join(' | ')} | ${own.filter((s) => s === 'done').length}/${own.length} |`);
  });
  return lines.join('\n');
}

/** 외부 일정 정본(vars.plan.external: GitLab 마일스톤 등)의 위치. 비었으면 '' (PLAN.md 가 정본) */
const externalOf = (ws) => String((((ws || {}).vars || {}).plan || {}).external || '').trim();

/** 한 줄 요약: 세션 브리핑 · resume · 알림. ext = 외부 일정 정본 위치 (있으면 「기본 단계 그대로」 안내 대신 그 위치) */
function shortLine(plan, ext = '') {
  if (plan.issues) {
    const s = issueSummary(plan);
    const by = Object.entries(s.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`);
    return [`이슈 진행 ${s.active.length}${by.length ? ` (${by.join(' · ')})` : ''}`, `이번 달 ${s.doneState || '완료'} ${s.month.length}`,
      ...(s.hold.length ? [`보류 ${s.hold.length}`] : []), ...(s.stale.length ? [`⚠ 멈춤 ${s.stale.length} (${s.staleDays}일 넘게 안 바뀜)`] : []),
      ...(plan.backlog ? [`개선 후보 ${plan.backlog.length}`] : []), ...(ext ? [`일정 정본: ${ext}`] : plan.preset ? ['상태 목록이 기본값 그대로 (프로젝트 흐름에 맞게 고칠지 사용자에게 묻는다)'] : [])].join(' · ');
  }
  const cur = current(plan);
  const parts = [`로드맵 완료 ${doneCount(plan)}/${plan.stages.length}`];
  if (cur) parts.push(`지금 ${cur.no}.${cur.name}${cur.detail ? ` ${cur.detail.done}/${cur.detail.total}` : ''}${skillOf(cur) ? ` (${skillOf(cur)} 스킬)` : ''}`);
  parts.push(`다음 ${nextLine(plan)}`);
  if (plan.sprint && plan.sprint.goal) parts.splice(1, 0, `스프린트 목표 「${plan.sprint.goal}」${plan.sprint.end ? ` (끝 ${plan.sprint.end})` : ''}`);
  if (plan.backlog) parts.push(`백로그 ${plan.backlog.length}`);
  if (ext) parts.push(`일정 정본: ${ext}`);
  else if (plan.preset) parts.push(`기본 단계 그대로 (${presetHint(plan)})`);
  return parts.join(' · ');
}

function toJson(plan) {
  if (plan.issues) {
    const s = issueSummary(plan);
    return { mode: 'issue', states: s.states, counts: s.counts, active: s.active, hold: s.hold, stale: s.stale.map((r) => ({ id: r.id, title: r.title, state: r.state, idle: r.idle })),
      releasedThisMonth: s.month.length, done: s.done.length, backlog: plan.backlog, preset: plan.preset, next: nextLine(plan) };
  }
  const cur = current(plan);
  return {
    done: doneCount(plan), total: plan.stages.length, current: cur ? cur.no : null, next: nextLine(plan), preset: plan.preset,
    stages: plan.stages.map((s) => ({ no: s.no, name: s.name, state: s.state, start: s.start || null, end: s.end || null,
      sub: s.detail ? { done: s.detail.done, total: s.detail.total, ...(s.detail.kind === 'table' ? { cols: s.detail.cols, areas: s.detail.areas } : { items: s.detail.items }) } : null })),
    changes: plan.changes, releases: plan.releases.length, backlog: plan.backlog, sprint: plan.sprint,
  };
}

/** 이슈 보드 표 (markdown): 진행 중 · 보류. 멈춘 이슈는 ⚠ */
function issueTable(plan) {
  const s = issueSummary(plan);
  const rows = [...s.active, ...s.hold];
  if (!rows.length) return '진행 중 이슈 없음';
  const staleIds = new Set(s.stale.map(issueLabel));
  return ['| 이슈 | 제목 | 상태 | 브랜치 | 갱신 |', '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.state}${staleIds.has(issueLabel(r)) ? ' ⚠' : ''} | ${r.branch ? `\`${r.branch}\`` : ''} | ${r.updated || r.start} |`)].join('\n');
}

/** 주간(기간) 보고 markdown: 기간 안 운영 반영 · 새 접수 · 진행 중(상태별) · 보류 · 멈춘 이슈 */
function issueReport(plan, from, to) {
  const s = issueSummary(plan, to);
  const inRange = (d) => d && d >= from && d <= to;
  const list = (rs) => (rs.length ? rs.map((r) => `- ${issueLabel(r)}${r.branch ? ` (\`${r.branch}\`)` : ''}`) : ['- 없음']);
  const released = plan.issues.rows.filter((r) => inRange(r.released));
  const opened = plan.issues.rows.filter((r) => inRange(r.start));
  const out = [`## 주간 보고 (${from} ~ ${to})`, '', `진행 ${s.active.length} · ${s.doneState || '완료'} ${released.length} · 새 접수 ${opened.length}${s.hold.length ? ` · 보류 ${s.hold.length}` : ''}`, '',
    `### ${s.doneState || '완료'}`, '', ...released.map((r) => `- ${issueLabel(r)} (${r.released})`), ...(released.length ? [] : ['- 없음']), '',
    '### 진행 중', ''];
  for (const st of Object.keys(s.counts)) {
    const rs = s.active.filter((r) => r.state === st);
    if (rs.length) out.push(`**${st}** ${rs.length}`, ...list(rs), '');
  }
  if (!s.active.length) out.push('- 없음', '');
  out.push('### 새 접수', '', ...list(opened), '');
  if (s.hold.length) out.push('### 보류', '', ...list(s.hold), '');
  if (s.stale.length) out.push(`### 멈춘 이슈 (${s.staleDays}일 넘게 안 바뀜)`, '', ...s.stale.map((r) => `- ${issueLabel(r)} · ${r.state} · ${r.idle}일`), '');
  return out.join('\n').trimEnd();
}

/** 새 PLAN.md 뼈대 (종류 · 진행 방식별 기본 단계) */
function template(type, layers = {}, approach) {
  const p = presetOf(type, approach);
  if (p.issue) return issueTemplate();
  const stages = stagesFor(type, layers, approach);
  const rows = stages.map((s, i) => `| ${i + 1} | ${s} | ${i === 0 ? STATE.doing : STATE.todo} | | |`);
  // 반복형 단계 확인 목록은 스프린트 계획 등 반복 첫 단계에 (아이디어 단계 다음)
  const skills = stages.filter((x) => STAGE_SKILLS[x]).map((x) => `${x} → \`${STAGE_SKILLS[x]}\``);
  const sp = p === PRESETS.sprint;
  // 반복형: 단계를 늘리지 않고 첫 단계(분석 · 스프린트 계획)에서 스키마 · 화면 변경 여부를 본다. 스프린트면 이번 스프린트 기능만
  const scope = sp ? '이번 스프린트 기능만. ' : '';
  const checks = p.cycle ? [
    ...(sp ? ['- [ ] 이번 스프린트의 목표(데모에서 보여 줄 한 줄)와 기능을 사용자와 정해 `## 이번 스프린트` 에 적는다 (첫 스프린트는 끝까지 동작하는 최소 기능 하나)'] : []),
    ...(sp && stages.includes(IDEA_STAGE) ? ['- [ ] (첫 스프린트) 시스템 구성 1차: MVP 를 돌릴 서비스 · DB · 미들웨어 · 서버 사양을 `architecture` 스킬로 기획 repo 의 시스템 구성도에 그린다'] : []),
    ...STACK_STAGES.filter((x) => layers[x.when]).map((x) => `- [ ] ${x.when === 'db' ? '스키마' : '화면'} 변경 여부 (${scope}있으면 \`${x.skill}\` 스킬로 ${x.when === 'db' ? '테이블 정의서' : '화면(프로토타입 · 화면 목록)'}${x.when === 'db' ? '를' : '을'} 고친다)`),
  ] : [];
  return [
    '# 로드맵', '',
    `${PRESET_MARK}: 기본 단계입니다. 프로젝트에 맞게 고친 뒤 이 줄을 지우세요 -->`, '',
    '프로젝트 전체의 큰 단계와 진행 상태의 정본이다. 그림과 숫자는 `kedovi plan` 이 그린다 (상태만 사람이 고른다).', '',
    `- 상태: ${STATE.done} 완료 · ${STATE.doing} 진행 · ${STATE.todo} 미착수 · ${STATE.unsplit} 미분해 (하위 작업을 아직 안 쪼갬)`,
    '- 하위 작업은 그 단계를 시작할 때 `## <단계 이름>` 절에 쪼갠다. 영역이 있으면 표(첫 열 영역, 나머지 열 하위 작업), 없으면 체크 목록(`- [ ]`)',
    '- 단계·영역·하위 작업 수(분모)가 바뀌면 `## 분모 변경` 에 한 줄: `- YYYY-MM-DD · 무엇 n → m · 사유`',
    ...(stages.includes(IDEA_STAGE) ? [`- 「${IDEA_STAGE}」: 무엇을 왜 만드는지 사용자와 대화해 전체 그림과 첫 범위(MVP)를 정한다 (\`idea\` 스킬). 이미 정해져 있으면 상태를 \`✔ 건너뜀\` 으로 두고 넘어간다`] : []),
    ...(sp ? [
      '- 진행 방식 스프린트: 이번 스프린트에 넣지 않는 기능은 `## 백로그` 에 한 줄씩 적고 만들지 않는다. 기간이 아니라 기능 단위다 (끝 날짜는 정하고 싶을 때만)',
      `- 데모: 실행 방법(명령 · 주소 · 화면)과 함께 돌아가는 결과를 보여 주고 사용자가 확인한다. 회고: \`## 지난 스프린트\` 에 \`- YYYY-MM-DD · S<번호> <목표> · 잘 된 것 · 바꿀 것\` 한 줄, 백로그에서 다음 스프린트 후보를 추천하고 단계 상태를 처음으로 되돌린다${stages.includes(IDEA_STAGE) ? ` (「${IDEA_STAGE}」 은 그대로)` : ''}`,
    ] : p.cycle ? ['- 반복형: 릴리스가 끝나면 `## 지난 릴리스` 에 한 줄 남기고 단계 상태를 처음으로 되돌린다'] : []),
    ...(skills.length ? [`- 단계별 스킬: ${skills.join(' · ')} (단계를 시작할 때 그 스킬을 따른다. 스킬에 「진행 방식 합의」 가 있으면 거기부터)`] : []),
    ...(type === 'new' && stages.includes('설계') ? ['- 「설계」: 서버 아키텍처(서비스 · DB · 미들웨어 · 서버 사양, 단계별 구성도)는 `architecture` 스킬로 기획 repo 의 시스템 구성도에 그린다'] : []),
    '',
    '| # | 단계 | 상태 | 시작 | 완료 |',
    '|---|---|---|---|---|',
    ...rows, '',
    ...(checks.length ? [`## ${p.checksAt}`, '', ...checks, ''] : []),
    ...(sp ? ['## 이번 스프린트', '', '목표: <데모에서 보여 줄 한 줄>', '끝: <YYYY-MM-DD, 정하고 싶을 때만>', ''] : []),
    ...(p.backlog ? ['## 백로그', ''] : []),
    '## 분모 변경', '',
    ...(p.cycle ? [sp ? '## 지난 스프린트' : '## 지난 릴리스', ''] : []),
  ].join('\n');
}

/** 이슈형 PLAN.md 뼈대 */
function issueTemplate() {
  return [
    '# 로드맵', '',
    `${PRESET_MARK}: 기본 상태 목록입니다. 프로젝트 흐름(브랜치 · 반영 절차)에 맞게 \`상태:\` 줄을 고친 뒤 이 줄을 지우세요 -->`, '',
    '진행 방식 이슈형(운영 · 유지보수): 이슈마다 따로 운영에 반영한다. 단계 흐름 대신 이슈 보드다. 그림과 숫자는 `kedovi plan` 이 그린다.', '',
    '- 이슈를 시작하면 표에 한 줄(상태 = 첫 상태, 시작 날짜). 상태가 바뀌면 상태와 갱신 날짜를, 운영에 반영하면 운영 반영 날짜를 고친다',
    '- `상태:` 줄이 상태 목록이다. 보류 · 대기는 멈춤, 그 밖의 마지막 상태가 완료다',
    `- 갱신(없으면 시작) 뒤로 \`멈춤 기준\` 일(기본 ${STALE_DAYS}) 넘게 안 바뀐 이슈는 \`kedovi plan\` 이 ⚠ 로 알린다`,
    '- 착수 전 개선 아이디어는 `## 개선 후보` 에 한 줄씩, 착수하면 이슈 표로 옮긴다. 주간 보고: `kedovi plan --report`', '',
    '## 이슈', '',
    `상태: ${ISSUE_STATES.join(' · ')}`, '',
    '| 이슈 | 제목 | 상태 | 브랜치 | 시작 | 갱신 | 운영 반영 |',
    '|---|---|---|---|---|---|---|', '',
    '## 개선 후보', '',
  ].join('\n');
}

/** 이슈 보드 절만 (단계형 로드맵을 이슈형으로 바꿀 때 앞에 끼운다) */
function issueSection() {
  return ['## 이슈', '', `상태: ${ISSUE_STATES.join(' · ')}`, '', '| 이슈 | 제목 | 상태 | 브랜치 | 시작 | 갱신 | 운영 반영 |', '|---|---|---|---|---|---|---|', ''].join('\n');
}

module.exports = { externalOf, presetHint, isIdea, IDEA_STAGE, OLD_ENHANCEMENT, ISSUE_STATES, issueSummary, issueTable, issueReport, issueTemplate, issueSection, latest, FILE, PRESETS, presetOf, STACK_STAGES, STAGE_SKILLS, UI_LAYERS, skillOf, stagesFor, missingStages, upgradePreset, STATE, LABEL, parse, read, current, doneCount, nextCell, nextLine, width, flow, detailTable, shortLine, toJson, template, bar };
