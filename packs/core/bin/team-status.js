#!/usr/bin/env node
// 팀 현황·인수인계. 실행: node packs/core/bin/team-status.js [--id <id>] [--take <id> --items 1,3|all] [--json] [--no-fetch]
/*
 * 모든 개발자의 handoffs/<id>/LATEST.md · 미완 작업(topics/ 진행 중 + 완료 조건 [ ]) · TODO.md(사용자가 등록한 것)를 모아 누가 언제 무엇을 얼마나 했는지 보여 준다.
 *   기준: git fetch 뒤 워크스페이스 upstream(@{u}) 의 파일 — 작업 폴더를 바꾸지 않는다(읽기 전용). 본인 폴더는 작업 폴더 것이 더 새로우면 그것.
 *   upstream 이 없으면 작업 폴더.
 * --id <id>            그 사람의 LATEST · TODO(번호 · 인수 여부) 전문
 * --take <id> --items  그 사람의 TODO 항목을 (사용자가 고른 것만) 내 TODO.md 로 옮긴다: "- 항목 ← <id> 에게서 인수 (날짜)". 원래 사람 폴더는 건드리지 않는다
 * 인수 표시가 다른 사람 TODO 에 있으면 원래 항목은 "인수됨" 으로 센다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { load, devId, git, localDate } = require('../lib/workspace');
const { parseTopicText, isOpen } = require('../lib/topics');

const args = process.argv.slice(2);
const val = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const JSON_OUT = args.includes('--json');
const STALE_DAYS = 3;
const TAKE_MARK = (id, date) => `← ${id} 에게서 인수 (${date})`;
const TAKE_RE = /\s*← (\S+) 에게서 인수 \((\d{4}-\d{2}-\d{2})\)\s*$/;

const ws = load();
const ROOT = ws.root;
const me = devId(ROOT);
const ROSTER = ((ws.team || {}).members || []).filter(Boolean).map((m) => (typeof m === 'string' ? m : m.username)).filter(Boolean); // 리더가 정한 명단 (kedovi team add, username). 비어 있으면 명단 없이 운영

// ───────── 읽기 — upstream 기준 ─────────
if (!args.includes('--no-fetch')) git(ROOT, ['fetch', '-q'], 15000);
const up = git(ROOT, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
const readUp = (rel) => (up ? git(ROOT, ['show', `${up}:${rel}`]) : null);
const readWt = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; } };

/** 그 사람의 미완 작업 — 본인은 작업 폴더, 남은 upstream */
function openTopics(id) {
  const dir = `handoffs/${id}/topics/`;
  let names = [];
  if (id === me || !up) { try { names = fs.readdirSync(path.join(ROOT, dir)).map((n) => dir + n); } catch { /* 없음 */ } }
  else names = (git(ROOT, ['-c', 'core.quotepath=false', 'ls-tree', '--name-only', up, '--', dir]) || '').split('\n');
  return names.filter((f) => /\.md$/.test(f) && !f.endsWith('/INDEX.md'))
    .map((f) => parseTopicText((id === me || !up ? readWt(f) : readUp(f)) || '', path.basename(f, '.md')))
    .filter(isOpen);
}

function people() {
  const ids = new Set();
  const listed = up ? (git(ROOT, ['-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', up, '--', 'handoffs/']) || '').split('\n') : [];
  for (const f of listed) { const m = f.match(/^handoffs\/([^/]+)\/(LATEST|TODO)\.md$/); if (m) ids.add(m[1]); }
  try {
    for (const d of fs.readdirSync(path.join(ROOT, 'handoffs'), { withFileTypes: true })) {
      if (d.isDirectory() && (!up || d.name === me)) ids.add(d.name);
    }
  } catch { /* handoffs 없음 */ }
  // 명단은 저장소 계정 username, 핸드오프 폴더는 git user.name — 폴더의 .account 로 잇는다
  const mapped = new Set([...ids].map(accountOf).filter(Boolean));
  for (const id of ROSTER) if (!mapped.has(id)) ids.add(id);
  return [...ids].sort();
}

/** 핸드오프 폴더(git user.name)의 저장소 계정 — kedovi install · start 가 handoffs/<id>/.account 에 적는다 */
function accountOf(id) {
  const t = (readUp(`handoffs/${id}/.account`) || readWt(`handoffs/${id}/.account`) || '').trim();
  return t || null;
}

/** 파일 하나 — 본인 것은 작업 폴더(아직 push 전일 수 있다), 남의 것은 upstream */
function readFile(id, name) {
  const rel = `handoffs/${id}/${name}`;
  if (id === me || !up) return readWt(rel) || readUp(rel);
  return readUp(rel) || readWt(rel);
}

/** "## 제목" 마다 본문 */
function sections(md) {
  const out = {};
  let cur = null;
  for (const l of String(md || '').split('\n')) {
    const h = l.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = h[1]; out[cur] = []; continue; }
    if (cur) out[cur].push(l);
  }
  return out;
}
const firstLines = (lines, n = 2) => (lines || []).map((l) => l.replace(/^\s*[-*]\s+/, '').trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('`handoffs/')).slice(0, n);
const findSection = (secs, ...keys) => { const k = Object.keys(secs).find((t) => keys.some((x) => t.includes(x))); return k ? secs[k] : []; };
const todoItems = (md) => String(md || '').split('\n').filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, '').trim());
const daysSince = (d) => (d ? Math.floor((new Date(localDate()) - new Date(d)) / 86400000) : null);

function collect() {
  const list = people().map((id) => {
    const latest = readFile(id, 'LATEST.md');
    const todo = readFile(id, 'TODO.md');
    const date = ((latest || '').match(/^#.*?\((\d{4}-\d{2}-\d{2})\)/m) || [])[1] || null;
    const secs = sections(latest);
    return {
      id, date, days: daysSince(date),
      core: firstLines(findSection(secs, '오늘 핵심'), 2),
      doing: firstLines(findSection(secs, '진행 중'), 3),
      branches: firstLines(findSection(secs, '작업 브랜치'), 10),
      todo: todoItems(todo), latest, todoRaw: todo, open: openTopics(id).map((t) => ({ name: t.name, left: t.todo })),
      joined: !!(latest || todo), inRoster: ROSTER.includes(id) || ROSTER.includes(accountOf(id)),
    };
  });
  // 인수 — 다른 사람 TODO 의 "← <id> 에게서 인수" 표시로 원래 항목을 찾는다
  for (const p of list) {
    p.taken = new Map(); // 원래 항목 텍스트 → 가져간 사람
    for (const q of list) {
      if (q.id === p.id) continue;
      for (const t of q.todo) {
        const m = t.match(TAKE_RE);
        if (m && m[1] === p.id) p.taken.set(t.replace(TAKE_RE, '').trim(), q.id);
      }
    }
    p.todoOpen = p.todo.filter((t) => !p.taken.has(t.replace(TAKE_RE, '').trim()));
  }
  return list;
}

const source = up ? `${up} (git fetch 후, 본인 폴더는 이 PC 작업 폴더)` : '이 PC 작업 폴더 (upstream 없음. push 된 남의 핸드오프는 git pull 후에 보인다)';

// ───────── 인수 — 내 TODO 로 옮긴다 ─────────
function take(from, which) {
  if (!me) { console.error('✖ git config user.name 이 없습니다. 워크스페이스 루트에서 설정하세요'); process.exit(1); }
  if (from === me) { console.error('✖ 본인 작업은 인수할 수 없습니다'); process.exit(1); }
  const all = collect();
  const p = all.find((x) => x.id === from);
  if (!p) { console.error(`✖ ${from} 의 핸드오프가 없습니다 (있는 사람: ${all.map((x) => x.id).join(', ') || '없음'})`); process.exit(1); }
  const picks = which === 'all' ? p.todo.map((_, i) => i + 1) : String(which || '').split(',').map((x) => parseInt(x, 10)).filter((n) => n >= 1 && n <= p.todo.length);
  if (!picks.length) { console.error(`✖ --items 에 옮길 번호(1~${p.todo.length}) 또는 all 을 주세요`); process.exit(1); }
  const file = path.join(ROOT, 'handoffs', me, 'TODO.md');
  let mine = readWt(path.relative(ROOT, file)) || `# TODO (${me})\n`;
  const today = localDate();
  const added = [];
  const skipped = [];
  for (const n of picks) {
    const text = p.todo[n - 1].replace(TAKE_RE, '').trim();
    if (p.taken.has(text)) { skipped.push(`${n}. ${text} (이미 인수: ${p.taken.get(text)})`); continue; }
    mine = `${mine.replace(/\s*$/, '')}\n- ${text} ${TAKE_MARK(from, today)}\n`;
    added.push(`${n}. ${text}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, mine);
  const out = { from, to: me, file: path.relative(ROOT, file), added, skipped };
  if (JSON_OUT) return console.log(JSON.stringify(out, null, 2));
  console.log(`인수 ${from} → ${me}  (${out.file})`);
  for (const a of added) console.log(`  + ${a}`);
  for (const s of skipped) console.log(`  = ${s}`);
  console.log(added.length ? '→ handoff 로 이 TODO.md 를 commit · push 하면 팀 현황에 "인수됨" 으로 보인다' : '옮긴 항목 없음');
}

// ───────── 보기 ─────────
function detail(id) {
  const p = collect().find((x) => x.id === id);
  if (!p) { console.error(`✖ ${id} 의 핸드오프가 없습니다`); process.exit(1); }
  if (JSON_OUT) return console.log(JSON.stringify({ ...p, taken: Object.fromEntries(p.taken), source }, null, 2));
  console.log(`# ${id}: 마지막 핸드오프 ${p.date || '없음'}${p.days !== null ? ` (${p.days}일 전)` : ''}\n기준: ${source}\n`);
  console.log(p.latest ? p.latest.trim() : '(LATEST.md 없음)');
  console.log('\n## 미완 작업 (topics/ 진행 중 + 완료 조건 [ ]. 이어받으려면 그 기록을 읽고 이어서 한다)');
  if (!p.open.length) console.log('(없음)');
  for (const t of p.open) console.log(`- ${t.name}: ${t.left.slice(0, 5).join(' / ')}${t.left.length > 5 ? ` … (${t.left.length}개)` : ''}  (handoffs/${id}/topics/${t.name}.md)`);
  console.log('\n## TODO (사용자가 등록한 것, 번호는 --take 에 쓴다)');
  if (!p.todo.length) console.log('(없음)');
  p.todo.forEach((t, i) => {
    const base = t.replace(TAKE_RE, '').trim();
    console.log(`${i + 1}. ${t}${p.taken.has(base) ? `  [인수됨 → ${p.taken.get(base)}]` : ''}`);
  });
}

function overview() {
  const list = collect();
  if (JSON_OUT) return console.log(JSON.stringify({ source, me, roster: ROSTER, restrict: !!(ws.team || {}).restrict, people: list.map((p) => ({ ...p, latest: undefined, todoRaw: undefined, taken: Object.fromEntries(p.taken) })) }, null, 2));
  console.log(`팀 현황: ${localDate()}\n기준: ${source}`);
  const P = require('../lib/plan');
  const plan = P.parse(readUp('handoffs/PLAN.md') || readWt('handoffs/PLAN.md') || ''); // 팀 공용 로드맵
  if (plan) console.log(P.shortLine(plan, P.externalOf(ws), (ws.project || {}).type));
  if (ROSTER.length) {
    const missing = list.filter((p) => p.inRoster && !p.joined).map((p) => p.id);
    const outside = list.filter((p) => !p.inRoster && p.joined).map((p) => p.id);
    console.log(`명단 ${ROSTER.length}명 · 합류 ${ROSTER.length - missing.length}명${missing.length ? ` · 미합류 ${missing.join(', ')}` : ''}${outside.length ? ` · 명단에 없음 ${outside.join(', ')}` : ''}${(ws.team || {}).restrict ? ' · 명단 제한 켜짐' : ''}`);
  }
  console.log('');
  if (!list.length) return console.log('핸드오프가 아직 없습니다 (handoffs/<id>/ 가 비어 있음)');
  for (const p of list) {
    if (!p.joined) { console.log(`■ ${p.id}: 미합류 (명단에만 있음, 아직 kedovi install · 합류 기록 없음)\n`); continue; }
    const stale = p.days !== null && p.days > STALE_DAYS ? `  ⚠ ${p.days}일째 갱신 없음` : '';
    const who = p.id === me ? `${p.id} (나)` : p.id;
    const tag = ROSTER.length && !p.inRoster ? '  (명단에 없음)' : '';
    if (!p.date) console.log(`■ ${who}: 합류함 · 핸드오프 아직 없음${tag}`);
    else console.log(`■ ${who}: 마지막 ${p.date}${p.days !== null ? ` (${p.days === 0 ? '오늘' : `${p.days}일 전`})` : ''}${stale}${tag}`);
    if (p.core.length) console.log(`  핵심   ${p.core.join(' / ')}`);
    if (p.doing.length) console.log(`  진행 중 ${p.doing.join(' / ')}`);
    for (const b of p.branches) console.log(`  브랜치 ${b}`);
    console.log(`  미완 작업 ${p.open.length}건${p.open.length ? ` — ${p.open.slice(0, 3).map((t) => `${t.name}(${t.left.length})`).join(' · ')}${p.open.length > 3 ? ' …' : ''}` : ''}`);
    const takenN = p.todo.length - p.todoOpen.length;
    console.log(`  TODO ${p.todoOpen.length}건${takenN ? ` (인수됨 ${takenN}건)` : ''}${p.todoOpen.length ? ` — ${p.todoOpen.slice(0, 3).map((t) => t.replace(TAKE_RE, '').split(': ')[0].replace(/\*\*/g, '')).join(' · ')}${p.todoOpen.length > 3 ? ' …' : ''}` : ''}`);
    console.log('');
  }
  console.log('자세히: --id <id> · 인수: --take <id> --items <번호,…|all>');
}

if (val('take')) take(val('take'), val('items'));
else if (val('id')) detail(val('id'));
else overview();
