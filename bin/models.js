#!/usr/bin/env node
'use strict';
/*
 * 모델 카탈로그(packs/core/models.json) 관리 — 킷 개발용. 절차는 docs/model-catalog.md.
 *   node bin/models.js check         카탈로그 점검 (없는 ID · 퇴역 모델 추천 · 근거 빠짐 · 역할 빠짐 · 조사 시기)
 *   node bin/models.js doc           docs/team-models.md · docs/workflow.md 의 추천 표를 models.json 에서 다시 쓴다
 *   node bin/models.js doc --check   표가 models.json 과 다르면 실패 (selftest 가 쓴다)
 *   node bin/models.js livebench [--release YYYY-MM-DD]
 *                                    LiveBench(독립 측정) 최신 결과를 받아 카탈로그 모델 점수와, 카탈로그에 없는 새 Claude·GPT 모델을 보여 준다
 *   node bin/models.js watch [--accept] [--notify]
 *                                    주간 점검: 카탈로그 오래됨 · LiveBench 새 모델 · 요금제 페이지 낱말 변경. --accept 는 지금 페이지를 기준으로 저장, --notify 는 찾은 게 있으면 텔레그램(TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID)
 *   node bin/models.js livebench --write   모델마다 분야별 점수(strengths: 코딩 · 추론 · 데이터 분석 …)를 models.json 에 적는다. 팀 구성(자동 모드)이 쓴다
 * 의존성 없음.
 */
const fs = require('fs');
const path = require('path');

const KIT = path.resolve(__dirname, '..');
const CATALOG = path.join(KIT, 'packs', 'core', 'models.json');
const DOCS = [path.join('docs', 'team-models.md'), path.join('docs', 'workflow.md')];
const TOOLS = { claude: 'Claude Code', codex: 'OpenAI Codex' };
const OTHER = { claude: 'codex', codex: 'claude' };
const ROLE_ORDER = ['lead', 'analyst', 'architect', 'spec-writer', 'implementer', 'reviewer', 'tester', 'documenter'];

const loadCatalog = () => JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const entry = (v) => (typeof v === 'string' ? { model: v } : v || {});

/** 역할 이름·제목 — packs/core/agents/*.md */
function coreRoles() {
  const dir = path.join(KIT, 'packs', 'core', 'agents');
  const roles = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const head = (fs.readFileSync(path.join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
    const get = (k) => ((head.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || '').trim();
    return { name: get('name'), title: get('title') || get('name'), grade: get('grade') };
  });
  const rank = (n) => (ROLE_ORDER.includes(n) ? ROLE_ORDER.indexOf(n) : ROLE_ORDER.length);
  return roles.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

/** 점검 — { errors, warnings } */
function check(cat = loadCatalog(), today = new Date().toISOString().slice(0, 10)) {
  const errors = [];
  const warnings = [];
  const known = (tool, id) => (cat.tools[tool] || []).some((m) => m.id === id) || ((cat.aliases || {})[tool] || []).includes(id);
  const retired = (tool, id) => (cat.retired || []).find((r) => r.tool === tool && new RegExp(r.match).test(id));
  // 모델마다 근거 — 확인일과 출처가 있어야 추천을 다시 따져 볼 수 있다
  for (const [tool, list] of Object.entries(cat.tools || {})) {
    for (const m of list) {
      if (!m.checked) errors.push(`tools.${tool} ${m.id}: checked(확인일)가 없습니다`);
      if (!(m.sources || []).length) errors.push(`tools.${tool} ${m.id}: sources(공식 출처 URL)가 없습니다`);
      for (const b of m.bench || []) if (!b.source) errors.push(`tools.${tool} ${m.id}: 벤치마크 ${b.name} 에 source 가 없습니다`);
      const r = retired(tool, m.id);
      if (r) errors.push(`tools.${tool} ${m.id}: 퇴역 목록(${r.label})에 걸립니다. 선택지에서 빼세요`);
    }
  }
  for (const r of cat.retired || []) {
    if (!r.source) errors.push(`retired ${r.label}: source 가 없습니다`);
    if (!r.retiresAt && !r.note) errors.push(`retired ${r.label}: retiresAt 이 없으면 note 에 까닭(공지에 날짜 없음 등)을 적습니다`);
    if (r.replacement && !known(r.tool, r.replacement)) errors.push(`retired ${r.label}: 대체 모델 ${r.replacement} 가 목록에 없습니다`);
  }
  // 프로필 — 두 도구 모두 메인·역할 전부·교차 검토를 채우고, 목록에 있는 모델만 쓴다
  const coreList = coreRoles();
  const roles = coreList.map((r) => r.name);
  const gradeOf = Object.fromEntries(coreList.map((r) => [r.name, r.grade]));
  if (!(cat.profiles || {})[cat.defaultProfile]) errors.push(`defaultProfile ${cat.defaultProfile} 가 profiles 에 없습니다`);
  for (const [name, pf] of Object.entries(cat.profiles || {})) {
    if (!pf.label) errors.push(`profiles.${name}: label 이 없습니다`);
    for (const tool of Object.keys(TOOLS)) {
      const table = pf[tool] || {};
      // 등급 표 — 프로필에 없는 역할(grade 로 정하는 역할 · 팩이 더한 역할)이 쓴다
      const gt = (pf.grades || {})[tool] || {};
      for (const g of ['high', 'standard', 'low']) {
        if (!gt[g]) { errors.push(`profiles.${name}.grades.${tool}.${g} 가 없습니다`); continue; }
        if (!known(tool, entry(gt[g]).model)) errors.push(`profiles.${name}.grades.${tool}.${g} = ${entry(gt[g]).model}. ${tool} 모델 목록에 없습니다`);
      }
      for (const role of ['main', ...roles, 'crossReview']) if (!table[role] && !(gradeOf[role] && gt[gradeOf[role]])) errors.push(`profiles.${name}.${tool}.${role} 가 없습니다 (역할에 grade 를 두면 등급 표로 정해진다)`);
      for (const [role, v] of Object.entries(table)) {
        const e = entry(v);
        const runs = role === 'crossReview' ? OTHER[tool] : e.tool || tool;
        if (e.tool && !TOOLS[e.tool]) errors.push(`profiles.${name}.${tool}.${role}.tool = ${e.tool}. claude | codex`);
        if (role === 'main' && e.tool && e.tool !== tool) errors.push(`profiles.${name}.${tool}.main 은 위임할 수 없습니다 (메인은 실행 도구의 모델)`);
        if (!known(runs, e.model)) errors.push(`profiles.${name}.${tool}.${role} = ${e.model}. ${runs} 모델 목록에 없습니다`);
        const r = retired(runs, e.model);
        if (r) errors.push(`profiles.${name}.${tool}.${role} = ${e.model}. ${r.label} 퇴역${r.retiresAt ? `(${r.retiresAt})` : ''} → ${r.replacement}`);
        // 위임 역할은 상대 도구가 없는 PC 를 위해 같은 도구 대체 모델이 있어야 한다
        if (e.tool && e.tool !== tool && role !== 'crossReview') {
          if (!e.fallback) errors.push(`profiles.${name}.${tool}.${role}: ${e.tool} 로 위임하면 fallback(${tool} 모델)이 필요합니다`);
          else if (!known(tool, e.fallback)) errors.push(`profiles.${name}.${tool}.${role}.fallback = ${e.fallback}. ${tool} 모델 목록에 없습니다`);
        }
      }
    }
  }
  // 요금제 — 이름 · 여유도 · 출처. 감지 정규식이 깨지면 오류
  const rooms = Object.keys(cat.rooms || {});
  for (const tool of Object.keys(TOOLS)) {
    const list = ((cat.plans || {})[tool]) || [];
    if (!list.length) errors.push(`plans.${tool} 가 없습니다`);
    for (const pl of list) {
      if (!pl.id || !pl.label) errors.push(`plans.${tool}: id · label 이 필요합니다`);
      if (!rooms.includes(pl.room)) errors.push(`plans.${tool}.${pl.id}: room = ${pl.room}. ${rooms.join(' | ')}`);
      if (!(pl.sources || []).length) errors.push(`plans.${tool}.${pl.id}: sources(공식 출처)가 없습니다`);
      if (pl.detect) { try { new RegExp(pl.detect); } catch { errors.push(`plans.${tool}.${pl.id}: detect 정규식이 잘못됐습니다`); } }
    }
  }
  if ((cat.plans || {}).checked && daysBetween(cat.plans.checked, today) > (cat.reviewEveryDays || 45)) warnings.push(`요금제 확인일 ${cat.plans.checked} 에서 ${daysBetween(cat.plans.checked, today)}일 지났습니다. 공식 요금제 페이지를 다시 보세요 (docs/model-catalog.md)`);
  // 조사 시기 — 카탈로그가 오래되면 새 모델이 나왔는지 다시 본다 (실패는 아니다)
  const every = cat.reviewEveryDays || 45;
  const age = daysBetween(cat.catalogVersion, today);
  if (age > every) warnings.push(`카탈로그 확인일 ${cat.catalogVersion} 에서 ${age}일 지났습니다 (기준 ${every}일). docs/model-catalog.md 절차로 새 모델·퇴역 공지를 조사하세요`);
  for (const r of (cat.retired || []).filter((x) => x.retiresAt)) {
    const left = daysBetween(today, r.retiresAt);
    if (left >= 0 && left <= 30) warnings.push(`${r.label} 퇴역 ${left}일 전 (${r.retiresAt})`);
  }
  return { errors, warnings };
}

// ───────── LiveBench — 독립 측정. 사이트가 화면에 쓰는 CSV 를 그대로 받는다 (브라우저 불필요) ─────────

const LIVEBENCH = 'https://livebench.ai';

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
}

// 문제 세트 데이터 파일 위치. 2026-10 에 사이트가 /v1/ 아래로 옮겼다 (예전 위치는 404). 새 위치부터 본다
const DATA_DIRS = ['/v1', ''];
let dataDir = null;
const dataUrl = (file) => `${LIVEBENCH}${dataDir === null ? DATA_DIRS[0] : dataDir}/${file}`;
async function fetchData(file) {
  if (dataDir !== null) return fetchText(dataUrl(file));
  const errs = [];
  for (const d of DATA_DIRS) {
    try { const t = await fetchText(`${LIVEBENCH}${d}/${file}`); dataDir = d; return t; } catch (e) { errs.push(e.message); }
  }
  throw new Error(errs.join(' · ')); // 새 위치의 실패 원인이 가려지지 않게 둘 다
}

/** 가장 최신 문제 세트 날짜 — 사이트 스크립트에 든 날짜 목록의 마지막 */
async function latestRelease() {
  const html = await fetchText(`${LIVEBENCH}/`);
  const js = (html.match(/src="\.?(\/static\/js\/main\.[^"]+\.js)"/) || [])[1];
  if (!js) throw new Error('LiveBench 스크립트 위치를 못 찾았습니다. 사이트 구조가 바뀌었을 수 있습니다');
  const code = await fetchText(`${LIVEBENCH}${js}`);
  const lists = code.match(/\[("20\d\d-\d\d-\d\d",?){3,}\]/g) || [];
  const dates = lists.map((l) => JSON.parse(l)).sort((a, b) => b.length - a.length)[0] || [];
  if (!dates.length) throw new Error('LiveBench 문제 세트 날짜를 못 찾았습니다. --release 로 주세요');
  return dates.sort().pop();
}

const parseCsv = (text) => {
  const [head, ...rows] = text.trim().split('\n').map((l) => l.split(','));
  return rows.map((r) => Object.fromEntries(head.map((k, i) => [k, i ? parseFloat(r[i]) : r[i]])));
};

/** 사이트와 같은 계산 — 분야 = 과제 평균, 전체 = 분야 평균. 반환 [{ model, global, categories, cost }] */
async function liveBench(release) {
  const tag = release.replace(/-/g, '_');
  const table = await fetchData(`table_${tag}.csv`).then(parseCsv); // 위치(dataDir)를 먼저 정한다
  const [cats, cost] = await Promise.all([
    fetchData(`categories_${tag}.json`).then(JSON.parse),
    fetchData(`cost_${tag}.csv`).then(parseCsv).catch(() => []),
  ]);
  const costOf = Object.fromEntries(cost.map((c) => [c.model, c.cost_per_question]));
  return table.map((row) => {
    const categories = {};
    for (const [cat, tasks] of Object.entries(cats)) {
      const xs = tasks.map((t) => row[t]).filter((x) => !Number.isNaN(x) && x !== undefined);
      if (xs.length) categories[cat] = xs.reduce((a, b) => a + b, 0) / xs.length;
    }
    const vals = Object.values(categories);
    return { model: row.model, global: vals.reduce((a, b) => a + b, 0) / vals.length, categories, cost: costOf[row.model] };
  });
}

// LiveBench 분야 이름 → 작업 유형 (팀 구성 때 리더가 고르는 기준)
const AREAS = { 'Agentic Coding': '에이전트 코딩', Coding: '코딩', Reasoning: '추론', Mathematics: '수학', 'Data Analysis': '데이터 분석', Language: '언어', 'Instruction Following': '지시 따르기', IF: '지시 따르기' };

/** 카탈로그 모델마다 LiveBench 분야별 점수를 strengths 로 적는다 (--write). 변형(effort)마다 한 줄, 출처는 strengthsSource */
function writeStrengths(cat, rows, release) {
  const byName = new Map(rows.map((r) => [r.model, r]));
  for (const list of Object.values(cat.tools)) {
    for (const m of list) {
      const got = (m.livebench || []).map((n) => byName.get(n)).filter(Boolean);
      if (!got.length) { delete m.strengths; continue; }
      m.strengths = got.map((r) => ({ variant: r.model, ...Object.fromEntries(Object.entries(r.categories).map(([k, v]) => [AREAS[k] || k, Math.round(v * 10) / 10])) }));
    }
  }
  cat.strengthsSource = { name: 'LiveBench', release, source: dataUrl(`table_${release.replace(/-/g, '_')}.csv`), checked: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(CATALOG, `${JSON.stringify(cat, null, 2)}\n`);
}

async function cmdLiveBench(rest) {
  const i = rest.indexOf('--release');
  const release = i >= 0 ? rest[i + 1] : await latestRelease();
  const rows = await liveBench(release);
  const cat = loadCatalog();
  if (rest.includes('--write')) { writeStrengths(cat, rows, release); console.log(`✔ models.json strengths 갱신 (LiveBench ${release})`); return; }
  const mapped = new Map();
  for (const [tool, list] of Object.entries(cat.tools)) for (const m of list) for (const n of m.livebench || []) mapped.set(n, `${tool} ${m.id}`);
  const f = (x) => (x === undefined ? '-' : x.toFixed(1));
  const line = (r) => `${r.model.padEnd(40)} ${f(r.global).padStart(5)} ${f(r.categories['Agentic Coding']).padStart(7)} ${f(r.categories.Coding).padStart(6)} ${f(r.categories.Reasoning).padStart(6)} ${r.cost === undefined ? '     -' : `$${r.cost.toFixed(3)}`.padStart(7)}`;
  const head = `${'모델'.padEnd(38)} 전체  에이전틱  코딩   추론  문항당`;
  console.log(`LiveBench ${release} (${dataUrl(`table_${release.replace(/-/g, '_')}.csv`)})\n\n카탈로그 모델 (models.json 의 livebench 이름)\n${head}`);
  for (const r of rows.filter((x) => mapped.has(x.model)).sort((a, b) => b.global - a.global)) console.log(`${line(r)}  ← ${mapped.get(r.model)}`);
  // 카탈로그에 이름이 안 걸린 Claude·GPT 모델 — 새 모델일 수 있다. 전체 점수가 카탈로그 최저보다 높은 것만
  const floor = Math.min(...rows.filter((x) => mapped.has(x.model)).map((x) => x.global));
  const reviewed = new Set(cat.livebenchReviewed || []); // 검토했지만 목록에 넣지 않은 이름 (옛 세대 등)
  const fresh = rows.filter((x) => !mapped.has(x.model) && !reviewed.has(x.model) && /^(claude|gpt)-/.test(x.model) && x.global >= floor).sort((a, b) => b.global - a.global);
  if (fresh.length) {
    console.log(`\n카탈로그에 없는 Claude·GPT 모델 (전체 ${floor.toFixed(1)} 이상). docs/model-catalog.md 절차로 검토하고, 넣지 않을 것은 models.json livebenchReviewed 에 적는다\n${head}`);
    for (const r of fresh) console.log(line(r));
  } else console.log('\n새로 검토할 Claude·GPT 모델 없음');
}

// ───────── 주간 점검 (킷 repo 예약 파이프라인) — 새 모델 · 카탈로그 오래됨 · 요금제 페이지 변경을 찾아 알린다. 반영은 사람이 ─────────

// 요금제 페이지에서 요금제 이름으로 보이는 낱말 (가격은 API 가격과 섞여 쓰지 않는다)
const PLAN_WORDS = /\b(Free|Go|Plus|Pro|Max(?: \d+x)?|Team|Business|Enterprise|Edu|Ultra|Premium|Standard|Starter|Lite)\b/g;
const PLAN_PAGES = { claude: 'https://claude.com/pricing', codex: 'https://learn.chatgpt.com/docs/pricing' };

async function planWords(url) {
  const html = await fetchText(url);
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  return [...new Set(text.match(PLAN_WORDS) || [])].sort();
}

/** 점검 결과 줄 목록. accept = 지금 페이지 낱말을 기준으로 저장 (사람이 검토한 뒤) */
async function watch({ accept = false } = {}) {
  const cat = loadCatalog();
  const lines = [];
  const { errors, warnings } = check(cat);
  for (const e of errors) lines.push(`✖ 카탈로그: ${e}`);
  for (const w of warnings) lines.push(`⚠ ${w}`);
  // 새 모델 — LiveBench 에 카탈로그에 없는 Claude · GPT 모델
  try {
    const release = await latestRelease();
    const rows = await liveBench(release);
    const mapped = new Set(Object.values(cat.tools).flatMap((l) => l.flatMap((m) => m.livebench || [])));
    const reviewed = new Set(cat.livebenchReviewed || []);
    const floor = Math.min(...rows.filter((x) => mapped.has(x.model)).map((x) => x.global));
    const fresh = rows.filter((x) => !mapped.has(x.model) && !reviewed.has(x.model) && /^(claude|gpt)-/.test(x.model) && x.global >= floor);
    if (fresh.length) lines.push(`🆕 새 모델 후보 (LiveBench ${release}): ${fresh.map((x) => `${x.model} ${x.global.toFixed(1)}`).join(', ')}`);
  } catch (e) { lines.push(`⚠ LiveBench 확인 못 함: ${e.message}`); }
  // 요금제 페이지 — 요금제 이름 낱말이 기준과 달라졌나
  const saved = ((cat.plans || {}).watch) || {};
  const next = {};
  for (const [tool, url] of Object.entries(PLAN_PAGES)) {
    try {
      const words = await planWords(url);
      next[tool] = { url, words };
      const before = (saved[tool] || {}).words;
      if (!before) lines.push(`ℹ ${url}: 기준 낱말이 없습니다 (watch --accept 로 저장)`);
      else {
        const added = words.filter((w) => !before.includes(w));
        const gone = before.filter((w) => !words.includes(w));
        if (added.length || gone.length) lines.push(`💳 요금제 페이지가 바뀌었습니다 (${url}): ${added.length ? `새 낱말 ${added.join(', ')}` : ''}${added.length && gone.length ? ' · ' : ''}${gone.length ? `사라진 낱말 ${gone.join(', ')}` : ''}. docs/model-catalog.md 절차로 plans 를 확인`);
      }
    } catch (e) { lines.push(`⚠ ${url} 확인 못 함: ${e.message}`); next[tool] = saved[tool]; }
  }
  if (accept) {
    cat.plans.watch = Object.fromEntries(Object.entries(next).filter(([, v]) => v).map(([k, v]) => [k, { ...v, checked: new Date().toISOString().slice(0, 10) }]));
    fs.writeFileSync(CATALOG, `${JSON.stringify(cat, null, 2)}\n`);
    lines.push('✔ 요금제 페이지 기준 낱말을 저장했습니다 (models.json plans.watch)');
  }
  return lines;
}

// ───────── 추천 표 (팀 에이전트와 모델 · workflow 가 같은 표를 쓴다) ─────────

function cellText(cat, tool, v, session) {
  const { model, effort, tool: via } = entry(v);
  const runs = via || tool;
  const m = (cat.tools[runs] || []).find((x) => x.id === model);
  const label = (m && (m.doc || m.label)) || model;
  const tags = [...(via && via !== session ? [`${via === 'codex' ? 'Codex' : 'Claude'} 위임`] : []), ...(effort ? [effort] : [])];
  return tags.length ? `${label} (${tags.join(' · ')})` : label;
}

/** 실행 도구 하나의 추천 표 (markdown) */
function profileTable(cat, tool) {
  const names = Object.keys(cat.profiles || {});
  const head = names.map((n) => (n === cat.defaultProfile ? `**${cat.profiles[n].label}** (추천 기본)` : cat.profiles[n].label));
  const rows = [['메인(리드)', 'main'], ...coreRoles().map((r) => [r.title, r.name]), [`교차 검토 → ${OTHER[tool] === 'codex' ? 'Codex' : 'Claude'}`, 'crossReview']];
  const out = [`| 역할 | ${head.join(' | ')} |`, `|---|${names.map(() => '---').join('|')}|`];
  for (const [title, key] of rows) {
    const runs = key === 'crossReview' ? OTHER[tool] : tool;
    const grade = (coreRoles().find((r) => r.name === key) || {}).grade;
    const pick = (n) => (cat.profiles[n][tool] || {})[key] || (((cat.profiles[n].grades || {})[tool] || {})[grade]);
    out.push(`| ${title} | ${names.map((n) => cellText(cat, runs, pick(n), key === 'crossReview' ? runs : tool)).join(' | ')} |`);
  }
  return out.join('\n');
}

const MARK = (tool) => [`<!-- models:${tool}: node bin/models.js doc 가 packs/core/models.json 으로 쓴다. 손으로 고치지 않는다 -->`, `<!-- /models:${tool} -->`];

/** 문서의 표 구간을 다시 쓴다. 반환 [{ file, changed, missing }] */
function writeDocs(cat = loadCatalog(), { dryRun = false } = {}) {
  return DOCS.map((rel) => {
    const file = path.join(KIT, rel);
    let text = fs.readFileSync(file, 'utf8');
    const before = text;
    const missing = [];
    for (const tool of Object.keys(TOOLS)) {
      const [open, close] = MARK(tool);
      const a = text.indexOf(open);
      const b = text.indexOf(close);
      if (a < 0 || b < a) { missing.push(tool); continue; }
      text = `${text.slice(0, a + open.length)}\n${profileTable(cat, tool)}\n${text.slice(b)}`;
    }
    const changed = text !== before;
    if (changed && !dryRun) fs.writeFileSync(file, text);
    return { file: rel, changed, missing };
  });
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'check') {
    const { errors, warnings } = check();
    for (const w of warnings) console.log(`⚠ ${w}`);
    for (const e of errors) console.log(`✖ ${e}`);
    if (!errors.length) console.log(`✔ 모델 카탈로그 ${loadCatalog().catalogVersion}: 오류 없음`);
    process.exit(errors.length ? 1 : 0);
  }
  if (cmd === 'doc') {
    const verify = rest.includes('--check');
    const res = writeDocs(loadCatalog(), { dryRun: verify });
    let bad = 0;
    for (const r of res) {
      if (r.missing.length) { bad += 1; console.log(`✖ ${r.file}: 표 자리 표시(${r.missing.map((t) => `<!-- models:${t} … -->`).join(', ')})가 없습니다`); }
      if (r.changed) { if (verify) bad += 1; console.log(`${verify ? '✖' : '✔'} ${r.file}: ${verify ? '추천 표가 models.json 과 다릅니다. node bin/models.js doc' : '추천 표를 다시 썼습니다'}`); }
    }
    if (!bad && verify) console.log('✔ 추천 표가 models.json 과 같습니다');
    process.exit(bad ? 1 : 0);
  }
  if (cmd === 'watch') {
    watch({ accept: rest.includes('--accept') }).then(async (lines) => {
      const findings = lines.filter((l) => !/^(ℹ|✔)/.test(l));
      console.log(lines.length ? lines.join('\n') : '✔ 바뀐 것 없음');
      // 예약 파이프라인: 찾은 게 있으면 관리자 텔레그램으로 (CI 변수 TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID)
      // 결과를 로그에 남긴다 (CI 로그만 보고 보냈는지 알 수 있게)
      if (rest.includes('--notify') && findings.length) {
        // CI(예약 파이프라인)에서 변수가 빠졌으면 작업을 실패로 남긴다 (초록으로 지나가면 아무도 모른다)
        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) { console.log(`${process.env.CI ? '✖' : '⚠'} 알림 건너뜀: TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID 가 없습니다`); if (process.env.CI) process.exitCode = 1; }
        else {
          const { send } = require(path.join(KIT, 'packs', 'core', 'lib', 'notify.js'));
          await send(`🔎 [kedovi] 모델·요금제 주간 점검\n${findings.map((l) => `- ${l}`).join('\n')}`, { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID }, 15000)
            .then((r) => { if (r && r.ok) console.log(`✔ 텔레그램 알림 보냄 (${findings.length}건)`); else { console.error(`✖ 알림 실패: ${(r && r.description) || '응답 없음'}`); process.exitCode = 1; } })
            .catch((e) => { console.error(`✖ 알림 실패: ${e.message}`); process.exitCode = 1; });
        }
      } else if (rest.includes('--notify')) console.log('✔ 찾은 것 없음: 알림 안 보냄');
    }).catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
    return;
  }
  if (cmd === 'livebench') {
    cmdLiveBench(rest).catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });
    return;
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 12).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { check, profileTable, writeDocs };
