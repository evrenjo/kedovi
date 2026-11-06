#!/usr/bin/env node
// 핸드오프 기록 도구 — 작업별 기록 · 크기 검사 · 색인 · 찾기 · 보관 · 정리. 실행: kedovi handoff <명령> [--id <id>] 또는 node packs/core/bin/handoff.js <명령>
/*
 * 기록 구조 (handoffs/<id>/)
 *   LATEST.md            마지막 상태 (짧게, 4KB 이내)
 *   TODO.md              사용자가 등록한 할 일 (사용자가 넣어 달라고 할 때만. 미완 업무는 topics/ 의 완료 조건이 정본)
 *   YYYY-Www.md          주간 기록 — 날짜마다 몇 줄 + 작업별 기록 링크 (하루 3KB 이내)
 *   topics/<작업>.md     작업별 기록 — 한 작업(티켓 · 요구사항 ID · 기능·화면)의 결정 · 원인 · 상태를 이어 쓴다. 미완 업무의 정본(상태: 진행 중 + 완료 조건 [ ])
 *   INDEX.md             작업 색인 (이 도구가 만든다, 손으로 고치지 않는다)
 *   archive/             오래된 주간 기록 (평소에는 읽지 않고 find 로만)
 *
 * 명령
 *   topic                 오늘 작업의 기록 이름 후보 (티켓 → 요구사항 ID → 기능·화면) + 기존 기록
 *   check                 크기 · 흩어진 파일 검사 · 로드맵(handoffs/PLAN.md) 갱신 누락 경고 (✖ 가 있으면 exit 1)
 *   index                 topics/ 머리말로 INDEX.md 를 다시 만든다
 *   find <검색어> [--all] 작업별 기록(모든 사람) → 주간 기록(보관 포함) 순으로 찾아 파일:줄 로 보여 준다
 *   archive [--weeks 8]   N 주 지난 주간 기록을 archive/ 로 옮긴다 (지우지 않는다)
 *   organize              이미 커진 기록 정리 후보 — 큰 파일 · 흩어진 파일 · 자주 나온 티켓·기능
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { load, devId, git, localDate, isoWeek, repoRel } = require('../lib/workspace');
const { parseTopic } = require('../lib/topics');
const defects = require('../lib/defects');

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);

const ws = load();
const ROOT = ws.root;
const HROOT = path.join(ROOT, 'handoffs');
const ID = opt('id') || devId(ROOT);
const defectCfg = defects.settings(ws);
const LIMIT = { latest: 4096, day: 3072, weekWarn: 60 * 1024, todoItems: 30, topicWarn: 40 * 1024 };
const KNOWN = new Set(['LATEST.md', 'TODO.md', 'INDEX.md', 'topics', 'archive']);
const WEEK_RE = /^\d{4}-W\d{2}\.md$/;
const TICKET_RE = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;
const REQ_RE = /\bREQ[-_][A-Z0-9-]+\b/gi;

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
const dirOf = (id) => path.join(HROOT, id);
const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
const rel = (f) => path.relative(ROOT, f);
/** 기록 이름으로 쓸 수 있게 — 한글 · 영문 · 숫자 · - _ . 만, 공백은 - */
const topicName = (s) => String(s).trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}._-]/gu, '').slice(0, 60);

function needId() {
  if (!ID) { console.error('✖ 개발자 id 가 없습니다. 워크스페이스 루트에서 git config user.name <id>'); process.exit(1); }
}

/** 작업별 기록 머리 — 첫 # 제목 · 관련 · 상태 · 마지막 · 한 줄 */
function topicMeta(file) {
  const t = read(file);
  const get = (k) => ((t.match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || '').trim();
  return { name: path.basename(file, '.md'), title: ((t.match(/^#\s+(.+)$/m) || [])[1] || path.basename(file, '.md')).trim(),
    related: get('관련'), status: get('상태') || '진행 중', last: get('마지막'), summary: get('한 줄'), size: Buffer.byteLength(t) };
}
const topicsOf = (id) => ls(path.join(dirOf(id), 'topics')).filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'INDEX.md').map((e) => path.join(dirOf(id), 'topics', e.name));

// ───────── topic ─────────

function cmdTopic() {
  needId();
  const found = new Map(); // 이름 → 근거
  const add = (name, why) => { const n = topicName(name); if (n && !found.has(n)) found.set(n, why); };
  for (const r of ws.repos || []) {
    if (!fs.existsSync(r.dir)) continue;
    const branch = git(r.dir, ['symbolic-ref', '--short', '-q', 'HEAD']) || '';
    for (const t of branch.match(TICKET_RE) || []) add(t, `${repoRel(r)} 브랜치 ${branch}`);
    const recent = git(r.dir, ['log', '--since=midnight', '--pretty=%s']) || '';
    for (const t of new Set(recent.match(TICKET_RE) || [])) add(t, `${repoRel(r)} 오늘 커밋`);
    for (const t of new Set(recent.match(REQ_RE) || [])) add(t.toUpperCase(), `${repoRel(r)} 오늘 커밋`);
    // 기능 브랜치 이름 (feature/order-list → order-list). 기본 브랜치는 빼고
    const m = branch.match(/^(?:feature|feat|fix|bugfix|hotfix|refactor)\/(.+)$/);
    if (m && !(m[1].match(TICKET_RE) || []).length) add(m[1], `${repoRel(r)} 브랜치 ${branch}`);
    // 오늘 바꾼 파일의 화면·모듈 경로 (가장 많이 나온 폴더 2개)
    const files = (git(r.dir, ['log', '--since=midnight', '--name-only', '--pretty=']) || '').split('\n').concat((git(r.dir, ['status', '--porcelain']) || '').split('\n').map((l) => l.replace(/^[ MADRCTU?!]{1,2} /, '').replace(/^.* -> /, ''))).filter(Boolean); // git() 이 앞 공백을 잘라 첫 줄은 상태 글자가 한 칸일 수 있다. 한글 경로는 git() 이 quotepath 를 꺼서 그대로
    const counts = {};
    for (const f of files) { const parts = f.split('/').filter((x) => !/^(src|main|java|kotlin|resources|app|lib|components|pages|test|tests|com|org)$/.test(x) && !x.includes('.')); const key = parts.slice(-2).join('-'); if (key) counts[key] = (counts[key] || 0) + 1; }
    for (const [k] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2)) add(k, `${repoRel(r)} 오늘 바꾼 경로`);
  }
  const existing = topicsOf(ID).map(topicMeta).sort((a, b) => String(b.last).localeCompare(String(a.last)));
  console.log(`작업별 기록 이름 정하기 (${ID})\n순서: 티켓 번호 → 요구사항 ID → 기능·화면 이름. 기존 기록과 같은 일이면 기존 이름을 쓴다\n`);
  console.log('후보');
  if (!found.size) console.log('  (브랜치·커밋에서 찾지 못함. 대화의 기능·화면 이름으로 정한다. 예: 주문-목록)');
  for (const [n, why] of found) {
    const same = existing.find((t) => t.name === n || t.related.includes(n));
    console.log(`  ${n}  ← ${why}${same ? `  (기존 기록 ${same.name} 에 이어 쓴다)` : ''}`);
  }
  console.log(`\n기존 기록 ${existing.length}개 (최근 순)`);
  for (const t of existing.slice(0, 15)) console.log(`  ${t.name}  · ${t.status} · ${t.last || '날짜 없음'}${t.summary ? ` · ${t.summary.slice(0, 60)}` : ''}`);
}

// ───────── check ─────────

function daySection(text, date) {
  const i = text.indexOf(`## ${date}`);
  if (i < 0) return '';
  const j = text.indexOf('\n## ', i + 3);
  return j < 0 ? text.slice(i) : text.slice(i, j);
}

function cmdCheck() {
  needId();
  const d = dirOf(ID);
  const out = [];
  const bad = (m) => out.push(['✖', m]);
  const warn = (m) => out.push(['⚠', m]);
  const latest = read(path.join(d, 'LATEST.md'));
  if (Buffer.byteLength(latest) > LIMIT.latest) bad(`LATEST.md ${kb(Buffer.byteLength(latest))} > ${kb(LIMIT.latest)}. 핵심·진행 중·결정만 남기고 자세한 내용은 작업별 기록(topics/)으로 옮긴다`);
  const week = path.join(d, `${isoWeek()}.md`);
  const day = daySection(read(week), localDate());
  if (Buffer.byteLength(day) > LIMIT.day) bad(`오늘 주간 기록 ${kb(Buffer.byteLength(day))} > ${kb(LIMIT.day)}. 날짜 섹션은 작업마다 한두 줄 + 작업별 기록 링크만`);
  for (const e of ls(d).filter((x) => x.isFile() && WEEK_RE.test(x.name))) {
    const n = fs.statSync(path.join(d, e.name)).size;
    if (n > LIMIT.weekWarn) warn(`${e.name} ${kb(n)}: 큰 주간 기록. 지난 주면 archive 로, 이번 주면 오늘 섹션을 줄인다`);
  }
  const todo = read(path.join(d, 'TODO.md')).split('\n').filter((l) => /^\s*[-*]\s+/.test(l)).length;
  if (todo > LIMIT.todoItems) warn(`TODO.md 항목 ${todo}개 > ${LIMIT.todoItems}. 끝났거나 안 할 항목을 지울지 사용자에게 묻는다`);
  for (const f of topicsOf(ID)) {
    const m = topicMeta(f);
    if (m.size > LIMIT.topicWarn) warn(`topics/${path.basename(f)} ${kb(m.size)}: 맨 위 "## 요약" 을 갱신하고 오래된 날짜 섹션은 요약으로 줄인다`);
    // 미완 업무의 정본은 작업 기록이다 (TODO.md 는 사용자가 등록한 것만). 상태와 완료 조건이 없으면 남은 일을 알 수 없어 막는다
    const t = parseTopic(f);
    const name = `topics/${path.basename(f)}`;
    if (!t.hasStatus) bad(`${name}: "상태:" 줄이 없다. 머리(관련 · 상태 · 마지막 · 한 줄)를 쓴다 (진행 중 | 완료 | 보류)`);
    else if (t.status === '진행 중' && !t.hasCriteria) bad(`${name}: 진행 중인데 "## 완료 조건" 이 없다. 끝낸 기준을 3~7개 적고 남은 것은 [ ] 로 둔다`);
    else if (t.status === '진행 중' && !t.todo.length && !t.checked.length && !t.waiting.length && !t.scheduled.length) bad(`${name}: 진행 중인데 완료 조건이 비어 있다. 남은 일을 [ ] 로 적는다`);
    else if (t.status === '진행 중' && !t.todo.length && !t.waiting.length && !t.later.length && !t.badSchedule.length) warn(`${name}: 완료 조건이 모두 [x] 다. 끝났으면 상태를 완료로 바꾼다`);
    // 날짜 예약 [>] YYYY-MM-DD: 날짜가 없거나 없는 날이면 언제 다시 볼지 알 수 없어 막는다. 지났으면 했는지 · 미룰지 정하게 알린다
    if (t.badSchedule && t.badSchedule.length) bad(`${name}: 날짜 예약 [>] 에 날짜(YYYY-MM-DD)가 없거나 잘못됐다: ${t.badSchedule.map((x) => x.raw).slice(0, 3).join(' / ')}. 「- [>] 2026-11-02 할 일」 꼴로 쓴다`);
    // 운영 결함 기록(머리 「종류:」 가 vars.defects.kinds): 발견 · 분류 · 해소 칸이 없으면 월간 집계에서 빠지므로 막는다
    const defect = defects.parseDefect(read(f), defectCfg);
    if (defect) for (const p of defects.problems(defect, defectCfg)) bad(`${name}: 결함 기록 ${p}`);
    if (t.status === '진행 중' && t.overdue && t.overdue.length) warn(`${name}: 지난 예약 ${t.overdue.length}개 (${t.overdue.map((x) => `${x.date} ${x.text}`).slice(0, 2).join(' / ')}). 했으면 [x], 미루면 날짜를 고친다`);
  }
  const stray = ls(d).filter((e) => !KNOWN.has(e.name) && !(e.isFile() && WEEK_RE.test(e.name))).map((e) => e.name);
  if (stray.length) warn(`흩어진 파일 ${stray.length}개 (${stray.slice(0, 4).join(', ')}${stray.length > 4 ? ' …' : ''}): 작업 메모면 topics/ 로 옮긴다`);
  const oldWeeks = ls(d).filter((e) => e.isFile() && WEEK_RE.test(e.name) && weeksAgo(e.name) > 8).length;
  if (oldWeeks) warn(`8주 지난 주간 기록 ${oldWeeks}개: kedovi handoff archive`);
  // 로드맵(팀 공용 handoffs/PLAN.md): 단계 상태 갱신을 잊었는지
  const { check: planCheck, externalLine } = require('./plan');
  if (externalLine(ws) && !has('json')) console.log(`· 로드맵: ${externalLine(ws)}`);
  for (const m of planCheck(ws, require('../lib/plan').read(ROOT), ROOT)) warn(`로드맵: ${m}`);
  if (has('json')) return console.log(JSON.stringify({ id: ID, findings: out.map(([k, m]) => ({ level: k === '✖' ? 'error' : 'warn', message: m })) }, null, 2));
  if (!out.length) console.log(`✔ 핸드오프 기록 크기 정상 (${ID})`);
  for (const [k, m] of out) console.log(`${k} ${m}`);
  // 보고 끝 질문 (스킬 지시를 놓치기 쉬워 검사 출력 끝에 둔다)
  if (fs.existsSync(path.join(ROOT, 'handoffs', 'PLAN.md'))) console.log('→ 핸드오프 보고 맨 끝에 「로드맵을 볼까요?」 를 선택지 질문(보기 · 안 보기)으로 묻는다. 보기면 node packs/core/bin/plan.js 출력을 그대로 붙인다');
  process.exit(out.some(([k]) => k === '✖') ? 1 : 0);
}

function weeksAgo(name) {
  const [y, w] = name.replace('.md', '').split('-W').map(Number);
  const [cy, cw] = isoWeek().split('-W').map(Number);
  return (cy - y) * 52 + (cw - w);
}

// ───────── index ─────────

function cmdIndex() {
  needId();
  const list = topicsOf(ID).map(topicMeta).sort((a, b) => (a.status === '완료') - (b.status === '완료') || String(b.last).localeCompare(String(a.last)));
  const lines = [`# 작업 색인 (${ID})`, '', '<!-- 생성 파일: node packs/core/bin/handoff.js index 가 topics/ 머리로 만든다. 손으로 고치지 않는다 -->', ''];
  if (!list.length) lines.push('작업별 기록이 아직 없다.');
  else lines.push('| 작업 | 상태 | 마지막 | 한 줄 | 관련 |', '|---|---|---|---|---|',
    ...list.map((t) => `| [${t.name}](topics/${encodeURI(t.name)}.md) | ${t.status} | ${t.last} | ${t.summary.replace(/\|/g, '\\|')} | ${t.related.replace(/\|/g, '\\|')} |`));
  fs.mkdirSync(dirOf(ID), { recursive: true });
  fs.writeFileSync(path.join(dirOf(ID), 'INDEX.md'), `${lines.join('\n')}\n`);
  console.log(`✔ handoffs/${ID}/INDEX.md (작업 ${list.length}개)`);
}

// ───────── find ─────────

function cmdFind() {
  const q = argv.slice(1).filter((x) => !x.startsWith('--') && x !== opt('id')).join(' ').trim();
  if (!q) { console.error('사용법: kedovi handoff find <검색어> [--all] [--id <id>]'); process.exit(1); }
  const needle = q.toLowerCase();
  const people = opt('id') ? [opt('id')] : ls(HROOT).filter((e) => e.isDirectory()).map((e) => e.name);
  const hitsIn = (file, max) => {
    const lines = read(file).split('\n');
    const out = [];
    lines.forEach((l, i) => { if (out.length < max && l.toLowerCase().includes(needle)) out.push(`  ${rel(file)}:${i + 1}: ${l.trim().slice(0, 160)}`); });
    return out;
  };
  let total = 0;
  console.log(`기록 찾기: "${q}"\n\n작업별 기록`);
  for (const id of people) for (const f of topicsOf(id)) {
    const m = topicMeta(f);
    const nameHit = m.name.toLowerCase().includes(needle) || m.related.toLowerCase().includes(needle);
    const h = hitsIn(f, 5);
    if (nameHit || h.length) { total += 1; console.log(`■ ${rel(f)}  · ${m.status} · ${m.last}${m.summary ? ` · ${m.summary.slice(0, 60)}` : ''}`); h.forEach((x) => console.log(x)); }
  }
  if (!total) console.log('  (없음)');
  console.log('\n주간 기록 (최근 순, 보관 포함)');
  const weekly = [];
  for (const id of people) {
    for (const sub of ['', 'archive']) for (const e of ls(path.join(dirOf(id), sub))) if (e.isFile() && WEEK_RE.test(e.name)) weekly.push(path.join(dirOf(id), sub, e.name));
  }
  weekly.sort((a, b) => path.basename(b).localeCompare(path.basename(a)));
  let shown = 0;
  for (const f of weekly) {
    const h = hitsIn(f, has('all') ? 50 : 3);
    if (!h.length) continue;
    shown += 1;
    if (!has('all') && shown > 8) { console.log('  … 더 있음 (--all)'); break; }
    console.log(`■ ${rel(f)}`); h.forEach((x) => console.log(x));
  }
  if (!shown) console.log('  (없음)');
  console.log('\n필요한 줄 근처만 읽는다 (파일:줄). 큰 파일을 통째로 읽지 않는다');
}

// ───────── archive ─────────

function cmdArchive() {
  needId();
  const weeks = Number(opt('weeks', 8));
  const d = dirOf(ID);
  const moved = [];
  for (const e of ls(d).filter((x) => x.isFile() && WEEK_RE.test(x.name) && weeksAgo(x.name) > weeks)) {
    fs.mkdirSync(path.join(d, 'archive'), { recursive: true });
    const tracked = git(ROOT, ['ls-files', '--error-unmatch', path.join('handoffs', ID, e.name)]) !== null;
    if (tracked) git(ROOT, ['mv', path.join('handoffs', ID, e.name), path.join('handoffs', ID, 'archive', e.name)]);
    else fs.renameSync(path.join(d, e.name), path.join(d, 'archive', e.name));
    moved.push(e.name);
  }
  console.log(moved.length ? `✔ archive/ 로 옮김 ${moved.length}개: ${moved.join(', ')} (지우지 않음, find 로 찾는다)` : `옮길 주간 기록 없음 (${weeks}주 기준)`);
}

// ───────── organize ─────────

function cmdOrganize() {
  needId();
  const d = dirOf(ID);
  const files = ls(d).filter((e) => e.isFile()).map((e) => ({ name: e.name, size: fs.statSync(path.join(d, e.name)).size })).sort((a, b) => b.size - a.size);
  console.log(`기록 정리 후보 (${ID}): 지우지 않는다. 작업별 기록으로 나누고, 원본은 archive/ 로\n`);
  console.log('큰 파일');
  for (const f of files.slice(0, 10)) console.log(`  ${f.name.padEnd(36)} ${kb(f.size)}${WEEK_RE.test(f.name) ? '' : KNOWN.has(f.name) ? '' : '  ← 흩어진 파일 (topics/ 후보)'}`);
  const counts = {};
  for (const f of files.filter((x) => WEEK_RE.test(x.name) || !KNOWN.has(x.name))) {
    const t = read(path.join(d, f.name));
    for (const m of new Set(t.match(TICKET_RE) || [])) {
      const n = (t.match(new RegExp(`\\b${m}\\b`, 'g')) || []).length;
      counts[m] = counts[m] || { n: 0, files: [] };
      counts[m].n += n;
      counts[m].files.push(f.name);
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1].n - a[1].n).slice(0, 25);
  console.log('\n자주 나온 티켓 (작업별 기록 후보)');
  if (!top.length) console.log('  (없음. 기능·화면 이름으로 나눈다)');
  for (const [k, v] of top) console.log(`  ${k.padEnd(14)} ${String(v.n).padStart(4)}회 · ${[...new Set(v.files)].slice(0, 5).join(', ')}`);
  const have = new Set(topicsOf(ID).map((f) => path.basename(f, '.md')));
  console.log(`\n이미 있는 작업별 기록 ${have.size}개`);
  console.log('\n다음: handoff-organize 스킬 절차대로 후보마다 topics/<이름>.md 를 만들고(find 로 근거 줄을 모아 요약), 끝나면 archive · index · check');
}

const COMMANDS = { topic: cmdTopic, check: cmdCheck, index: cmdIndex, find: cmdFind, archive: cmdArchive, organize: cmdOrganize };
if (!COMMANDS[cmd]) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 22).map((l) => l.replace(/^ \* ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
COMMANDS[cmd]();
