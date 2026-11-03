#!/usr/bin/env node
// 로드맵 도구: handoffs/PLAN.md 를 읽어 단계 흐름 · 지금 단계 표 · 이번에 생긴 것 · 다음 순서를 그린다. 실행: kedovi plan [명령] 또는 node packs/core/bin/plan.js [명령]
/*
 * 명령
 *   (없음)              완료 보고용 블록 (markdown: 흐름도 코드 블록 + 지금 단계 표 + 이번에 생긴 것 + 다음)
 *   --short             한 줄 요약 (세션 브리핑 · resume)
 *   --json              전광판 등 다른 도구용
 *   --stage <번호>      그 단계 기준으로 그린다 (기본: 진행 중인 단계)
 *   --report [시작 [끝]] 이슈형: 기간 보고 markdown (기본: 오늘까지 7일). 운영 반영 · 진행 중(상태별) · 새 접수 · 보류 · 멈춘 이슈
 *   init [--type t] [--switch]  PLAN.md 가 없으면 종류 · 진행 방식 · 스택별 기본 단계로 만든다. 기본 단계 그대로(kedovi:preset)면 스택에 맞게 단계를 더하고,
 *                       진행 방식이 바뀌어 단계가 다르면(아직 끝낸 단계가 없을 때만) 새 뼈대로 바꾼다 (사람이 고친 것은 그대로).
 *                       이슈형으로 바꿀 때(--switch: kedovi approach · type)는 고친 로드맵이어도 맨 앞에 `## 이슈` 절을 끼운다 (단계 표는 남기고 읽지 않는다)
 *   check               갱신 누락 경고 (⚠ 줄. 항상 exit 0). vars.plan.external(외부 일정 정본)이 있으면 경고 대신 그 위치 한 줄
 *   external <위치> | off  일정 정본이 밖(GitLab 마일스톤 등)이면 그 위치를 workspace.json vars.plan.external 에 적는다 (off = 지운다)
 * 숫자는 센 것만 쓴다: 커밋 · 새 파일 · ID(vars.plan.ids 접두사)는 단계 시작 날짜 이후 git 기록에서 센다. 시작 날짜가 없으면 세지 않는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { load, allRepos, git, localDate } = require('../lib/workspace');
const P = require('../lib/plan');
const PRESET = '<!-- kedovi:preset';

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const has = (k) => argv.includes(`--${k}`);

/** 스택 계층: workspace.json 팩(pack.json layer)과 repo 스택(stacks.json layer, parent 포함) → { db, ui } */
function layersOf(ws) {
  const set = new Set();
  const packsDir = path.resolve(__dirname, '..', '..');
  for (const pk of ws.packs || []) { try { const l = JSON.parse(fs.readFileSync(path.join(packsDir, pk, 'pack.json'), 'utf8')).layer; if (l) set.add(l); } catch { /* 팩 없음 */ } }
  let cat = [];
  try { cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'stacks.json'), 'utf8')).stacks || []; } catch { /* 목록 없음 */ }
  for (const r of ws.repos || []) for (const id of r.stacks || []) {
    const st = cat.find((c) => c.id === id);
    for (const e of [st, st && cat.find((c) => c.id === st.parent)].filter(Boolean)) if (e.layer) set.add(e.layer);
  }
  return { db: set.has('db'), ui: P.UI_LAYERS.some((l) => set.has(l)) };
}

/** 단계 시작 이후 생긴 것: repo 별로 센다. 받지 않은 repo 는 건너뛴다 */
function created(ws, since) {
  const prefixes = String(((ws.vars || {}).plan || {}).ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  const idRe = prefixes.length ? new RegExp(`\\b(?:${prefixes.map((x) => x.replace(/[^A-Za-z0-9_-]/g, '')).join('|')})[-_]?[A-Za-z0-9-]*\\d\\b`, 'g') : null;
  let commits = 0;
  const files = new Set();
  const ids = new Map(prefixes.map((x) => [x, new Set()]));
  const skipped = [];
  for (const r of allRepos(ws)) {
    if (!fs.existsSync(path.join(r.dir, '.git'))) { if (!r.self) skipped.push(r.name); continue; }
    const log = git(r.dir, ['log', `--since=${since} 00:00`, '--no-merges', '--format=%H']);
    if (log == null) { skipped.push(r.name); continue; }
    commits += log.split('\n').filter(Boolean).length;
    const added = git(r.dir, ['-c', 'core.quotepath=false', 'log', `--since=${since} 00:00`, '--no-merges', '--diff-filter=A', '--name-only', '--format=']) || '';
    for (const f of added.split('\n').filter(Boolean)) files.add(`${r.name}/${f}`);
    if (idRe) {
      const diff = git(r.dir, ['log', `--since=${since} 00:00`, '--no-merges', '-p', '--format=', '--no-color'], 20000) || '';
      for (const l of diff.split('\n')) {
        if (!l.startsWith('+') || l.startsWith('+++')) continue;
        for (const m of l.match(idRe) || []) {
          const pre = prefixes.find((x) => m.toUpperCase().startsWith(x.toUpperCase()));
          if (pre) ids.get(pre).add(m);
        }
      }
    }
  }
  return { commits, files: files.size, ids: [...ids].map(([k, v]) => [k, v.size]), skipped };
}

/** 이슈형 보고: 상태별 건수 · 진행 중 이슈 표 · 멈춘 이슈 · 개선 후보 */
function issueBoard(plan) {
  const s = P.issueSummary(plan, localDate());
  const out = [`### 이슈 보드: 진행 ${s.active.length} · 이번 달 ${s.doneState || '완료'} ${s.month.length}${s.hold.length ? ` · 보류 ${s.hold.length}` : ''}`, '', '```', P.flow(plan), '```', '', P.issueTable(plan), ''];
  if (s.stale.length) out.push(`⚠ 멈춘 이슈 ${s.stale.length}개 (${s.staleDays}일 넘게 안 바뀜): ${s.stale.map((r) => `${[r.id, r.title].filter(Boolean).join(' ')} ${r.state} ${r.idle}일`).join(' · ')}`, '');
  if (plan.backlog) out.push(`개선 후보 ${plan.backlog.length}개${plan.backlog.length ? `: ${plan.backlog.slice(0, 5).join(' · ')}${plan.backlog.length > 5 ? ' …' : ''}` : ''}`, '');
  out.push(`**다음** → ${P.nextLine(plan)}`);
  if (plan.preset) out.push('', '⚠ 상태 목록이 기본값 그대로입니다. 프로젝트 흐름(브랜치 · 반영 절차)에 맞게 고칠지 사용자에게 묻는다.');
  return out.join('\n');
}

/** 이슈형 갱신 누락 경고 */
function issueCheck(plan) {
  const warn = [];
  if (plan.preset) warn.push('이슈 상태 목록이 기본값 그대로입니다. 프로젝트 흐름에 맞게 고칠지 사용자에게 묻는다');
  const s = P.issueSummary(plan, localDate());
  for (const r of s.stale) warn.push(`${[r.id, r.title].filter(Boolean).join(' ')}: ${r.state} 에서 ${r.idle}일째 안 바뀌었습니다. 상태 · 갱신 날짜를 확인한다`);
  for (const r of s.active) if (!r.start) warn.push(`${[r.id, r.title].filter(Boolean).join(' ')}: 시작 날짜가 없습니다`);
  for (const r of plan.issues.rows) if (r.state && !s.states.includes(r.state)) warn.push(`${[r.id, r.title].filter(Boolean).join(' ')}: 상태 '${r.state}' 가 상태 목록(${s.states.join(' · ')})에 없습니다`);
  for (const r of s.done) if (!r.released) warn.push(`${[r.id, r.title].filter(Boolean).join(' ')}: ${s.doneState} 인데 운영 반영 날짜가 없습니다`);
  return warn;
}

function report(ws, plan) {
  if (plan.issues) return issueBoard(plan);
  const no = Number(opt('stage'));
  const stage = no ? plan.stages.find((s) => s.no === no) : P.current(plan);
  const out = [`### 로드맵: 완료 ${P.doneCount(plan)} / 전체 ${plan.stages.length}${plan.changes.length ? ` · 분모 변경 ${plan.changes.length}건` : ''}${plan.releases.length ? ` · 지난 ${plan.sprint ? '스프린트' : '릴리스'} ${plan.releases.length}` : ''}`, '', '```', P.flow(plan), '```', ''];
  if (plan.sprint && plan.sprint.goal) out.push(`**이번 스프린트 목표** → ${plan.sprint.goal}${plan.sprint.end ? ` (끝 ${plan.sprint.end})` : ''}`, '');
  if (stage) out.push(P.detailTable(stage), '');
  if (stage && stage.start) {
    const c = created(ws, stage.start);
    out.push(`**${stage.name} 시작(${stage.start}) 이후 생긴 것**`, '',
      `- 커밋 ${c.commits} · 새 파일 ${c.files}${c.ids.map(([k, n]) => ` · ${k} ${n}`).join('')}`,
      ...(c.skipped.length ? [`- 세지 않은 repo: ${c.skipped.join(', ')} (받지 않음)`] : []), '');
  } else if (stage) out.push(`이번에 생긴 것: ${stage.name} 시작 날짜가 PLAN.md 에 없어 세지 않았습니다`, '');
  if (plan.changes.length) out.push(`분모 변경 (최근): ${P.latest(plan.changes)}`, '');
  if (plan.backlog) out.push(`백로그 ${plan.backlog.length}개${plan.backlog.length ? `: ${plan.backlog.slice(0, 5).join(' · ')}${plan.backlog.length > 5 ? ' …' : ''}` : ''}`, '');
  out.push(`**다음** → ${P.nextLine(plan)}`);
  const skill = P.skillOf(stage);
  if (skill) out.push(`**스킬** → \`${skill}\` (이 단계를 시작할 때 그 스킬을 따른다. 「진행 방식 합의」 가 있으면 거기부터)`);
  const ext = P.externalOf(ws);
  if (ext) out.push('', `일정 정본: ${ext} (이 로드맵은 참고용)`);
  else if (plan.preset) out.push('', `⚠ 기본 단계 그대로입니다. ${P.presetHint(plan)}.`);
  if (!ext) for (const w of P.missingStages(plan, layersOf(ws), (ws.project || {}).type, (ws.project || {}).approach)) out.push('', `⚠ ${w}`);
  return out.join('\n');
}

/** 갱신 누락 경고 */
function check(ws, plan, root) {
  const warn = [];
  if (P.externalOf(ws)) return []; // 일정 정본이 밖: PLAN.md 를 갱신하지 않으니 경고하지 않는다 (위치는 externalLine)
  if (!plan) return ['로드맵(handoffs/PLAN.md)이 없거나 단계 표가 없습니다. kedovi plan init 으로 만든다'];
  if (plan.issues) return issueCheck(plan);
  // 아이디어 단계 중이면 로드맵을 고칠지는 그 대화가 끝난 뒤에 묻는다 (첫 질문이 겹치지 않게)
  if (plan.preset) warn.push(`로드맵이 기본 단계 그대로입니다. ${P.presetHint(plan)}`);
  warn.push(...P.missingStages(plan, layersOf(ws), (ws.project || {}).type, (ws.project || {}).approach));
  // 진행 방식과 로드맵 모양이 다르면 (kedovi approach 가 손댄 로드맵을 그대로 둔 경우) 단계 표를 고치게 알린다
  const sprintShape = plan.stages.some((s) => s.name.replace(/\s+/g, '') === '스프린트계획');
  const ap = (ws.project || {}).approach;
  const oldEnh = plan.stages.map((s) => s.name).join('|') === P.OLD_ENHANCEMENT.join('|'); // 0.63 전 운영·고도화 기본 단계는 일부러 그대로 둔다
  if (plan.preset && !oldEnh && ((ap === 'sprint' && !sprintShape) || (ap === 'full' && sprintShape))) warn.push(`진행 방식(${ap === 'sprint' ? 'MVP · 스프린트' : '워터폴 · 전체'})과 로드맵 단계 모양이 다릅니다. 적어 둔 백로그 · 기록은 두고 단계 표만 진행 방식에 맞게 고칠지 사용자에게 묻는다`);
  const doing = plan.stages.filter((s) => s.state === 'doing');
  // 스프린트 끝 날짜(선택)가 지났는데 데모 전이면: 범위를 줄일지 끝 날짜를 고칠지 묻게
  const demo = plan.stages.find((s) => s.name === '데모');
  if (plan.sprint && plan.sprint.end && plan.sprint.end < localDate() && demo && demo.state !== 'done') warn.push(`이번 스프린트 끝 날짜(${plan.sprint.end})가 지났는데 데모 전입니다. 범위를 줄여 데모할지, 끝 날짜를 고칠지 사용자에게 묻는다`);
  else if (plan.sprint && !plan.sprint.goal && doing.some((s) => s.name.replace(/\s+/g, '') !== '스프린트계획' && !P.isIdea(s.name))) warn.push('이번 스프린트 목표가 비었습니다. 데모에서 보여 줄 한 줄을 `목표:` 에 적는다');
  if (!doing.length && P.doneCount(plan) < plan.stages.length) warn.push('진행(▶) 중인 단계가 없습니다. 지금 단계를 ▶ 로 둔다');
  for (const s of doing) {
    if (!s.start) warn.push(`${s.no}.${s.name}: 시작 날짜가 없습니다 (이번에 생긴 것을 셀 수 없다)`);
    if (s.detail && s.detail.total && s.detail.done === s.detail.total) warn.push(`${s.no}.${s.name}: 하위 작업이 모두 끝났습니다. 단계를 ✔ 로 바꾸고 완료 날짜를 적을지 확인한다`);
  }
  for (const s of plan.stages.filter((x) => x.state === 'done')) {
    if (s.detail && s.detail.done < s.detail.total) warn.push(`${s.no}.${s.name}: 완료(✔)인데 하위 작업이 ${s.detail.total - s.detail.done}개 남았습니다`);
  }
  // 오래 안 고쳤는데 그 사이 작업 기록(핸드오프)은 쌓였다 → 상태 갱신을 잊었을 수 있다
  const last = git(root, ['log', '-1', '--format=%cs', '--', P.FILE]);
  if (last && doing.length) {
    const since = git(root, ['log', `--since=${last} 23:59`, '--format=%H', '--', 'handoffs']) || '';
    const n = since.split('\n').filter(Boolean).length;
    if (n >= 5) warn.push(`로드맵을 ${last} 뒤로 고치지 않았는데 핸드오프 커밋이 ${n}개 쌓였습니다. 단계 상태를 확인한다`);
  }
  return warn;
}

/** 외부 일정 정본 안내 한 줄 (없으면 null) */
const externalLine = (ws) => (P.externalOf(ws) ? `일정 정본은 ${P.externalOf(ws)} (vars.plan.external). handoffs/PLAN.md 경고는 내지 않는다` : null);

/** kedovi plan external <위치> | off: workspace.json vars.plan.external 을 고친다 (다른 값 · 순서는 그대로) */
function setExternal(root, value) {
  const f = path.join(root, 'workspace.json');
  const ws = JSON.parse(fs.readFileSync(f, 'utf8'));
  ws.vars = ws.vars || {};
  ws.vars.plan = ws.vars.plan || {};
  const off = !value || /^(off|none|없음)$/i.test(value);
  ws.vars.plan.external = off ? '' : value;
  fs.writeFileSync(f, `${JSON.stringify(ws, null, 2)}\n`);
  console.log(off ? '✔ 외부 일정 정본을 지웠습니다. handoffs/PLAN.md 가 다시 정본이고 로드맵 경고가 다시 나온다' : `✔ 일정 정본: ${value} (workspace.json vars.plan.external). 로드맵 「기본 단계 그대로」 등 PLAN.md 경고를 내지 않는다. workspace.json 을 커밋한다`);
}

function main() {
  const ws = load();
  const root = ws.root;
  const file = path.join(root, P.FILE);
  if (argv[0] === 'external') {
    if (!argv[1]) return console.log(externalLine(ws) || '일정 정본: handoffs/PLAN.md (밖에 있으면: kedovi plan external "<위치, 예: GitLab 마일스톤 주소>")');
    return setExternal(root, argv.slice(1).join(' '));
  }
  if (argv[0] === 'init') {
    const type = opt('type') || (ws.project || {}).type || 'new';
    const approach = (ws.project || {}).approach;
    const layers = layersOf(ws);
    const want = P.stagesFor(type, layers, approach);
    if (fs.existsSync(file)) {
      // 기본 단계 그대로면 스택에 맞게 단계를 더한다 (상태 · 날짜는 옮긴다). 사람이 고친 PLAN.md 는 그대로
      const text = fs.readFileSync(file, 'utf8');
      const cur0 = P.parse(text);
      const wantIssue = !!P.presetOf(type, approach).issue;
      if (cur0 && cur0.issues && !wantIssue) {
        // 이슈형에서 단계형으로: 이슈를 적었으면 그대로 두고 알린다 (기본 뼈대 그대로면 새 단계로)
        if (cur0.preset && !cur0.issues.rows.length && !/바꾸기 전 로드맵/.test(text)) { fs.writeFileSync(file, `${P.template(type, layers, approach)}\n`); return console.log(`✔ ${P.FILE} 진행 방식에 맞게 다시 만듦 (${want.join(' → ')})`); }
        return console.log(`✔ ${P.FILE} 이슈 보드가 있어 그대로 둔다 (단계형으로 쓰려면 \`## 이슈\` 절을 지우고 단계 표를 둔다)`);
      }
      // 손댄 흔적: 끝낸 단계 · 첫 단계 밖의 날짜 · 끝 날짜 · 백로그 · 스프린트 목표 · 지난 기록 (첫 단계 시작 날짜는 시작했다는 뜻일 뿐)
      const touchedOf = (p) => !!p && (p.stages.some((x, i) => x.state === 'done' || x.end || (i > 0 && x.start)) || (p.backlog || []).length > 0 || (p.releases || []).length > 0 || !!(p.sprint && p.sprint.goal));
      if (wantIssue && !(cur0 && cur0.issues)) {
        // 단계형에서 이슈형으로: 기본 뼈대 그대로면 새로, 고친 로드맵은 --switch 일 때만 맨 앞에 이슈 절을 끼운다 (단계 표는 남는다)
        if (!cur0 || (cur0.preset && !touchedOf(cur0))) { fs.writeFileSync(file, `${P.template(type, layers, approach)}\n`); return console.log(`✔ ${P.FILE} 이슈 보드로 다시 만듦 (상태: ${P.ISSUE_STATES.join(' · ')})`); }
        if (!has('switch')) return console.log(`✔ ${P.FILE} 이미 있음 (그대로 둔다)`);
        const old = text.split('\n').filter((l) => !/^#\s/.test(l) && !l.includes(PRESET)).map((l) => l.replace(/^##\s/, '### '));
        fs.writeFileSync(file, `${P.template(type, layers, approach).trimEnd()}\n\n## 이슈형으로 바꾸기 전 로드맵 (${localDate()}. 읽지 않는다. 필요 없으면 지운다)\n\n${old.join('\n').trim()}\n`);
        return console.log(`✔ ${P.FILE} 이슈 보드로 바꿈 (전 로드맵은 아래 「이슈형으로 바꾸기 전 로드맵」 절에 남김)`);
      }
      // 0.63 전 운영·고도화 기본 단계(반복형)는 진행 방식을 바꿀 때만 새 뼈대로
      if (cur0 && cur0.preset && cur0.stages.map((x) => x.name).join('|') === P.OLD_ENHANCEMENT.join('|') && !has('switch')) return console.log(`✔ ${P.FILE} 이미 있음 (그대로 둔다)`);
      const up = P.upgradePreset(text, type, layers, approach);
      if (up) {
        fs.writeFileSync(file, up);
        return console.log(`✔ ${P.FILE} 기본 단계에 스택 단계를 더함 (${want.join(' → ')})`);
      }
      // 진행 방식을 바꿔 단계 모양이 다르면: 기본 단계 그대로이고 끝낸 단계가 없을 때만 새 뼈대로
      const cur = P.parse(text);
      // 0.74 전에 만든 신규 로드맵에는 아이디어 단계가 없다: 그 단계만 다른 것은 모양이 같다고 본다 (다시 만들면 백로그 · 스프린트 기록이 사라진다)
      const same = (raw) => { const names = raw.map((n) => (P.isIdea(n) ? P.IDEA_STAGE : n)); return names.join('|') === want.filter((n) => n !== P.IDEA_STAGE || names.includes(P.IDEA_STAGE)).join('|'); };
      // 손댄 흔적(끝낸 단계 · 날짜 · 백로그 · 스프린트 목표 · 지난 기록)이 있으면 그대로 둔다: 적어 둔 것이 사라지지 않게. 단계 표는 사람(에이전트)이 고친다
      if (cur && cur.preset && !touchedOf(cur) && !same(cur.stages.map((x) => x.name))) {
        fs.writeFileSync(file, `${P.template(type, layers, approach)}\n`);
        return console.log(`✔ ${P.FILE} 진행 방식에 맞게 다시 만듦 (${want.join(' → ')})`);
      }
      return console.log(`✔ ${P.FILE} 이미 있음 (그대로 둔다)`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${P.template(type, layers, approach)}\n`);
    if (approach === 'issue') return console.log(`✔ ${P.FILE} 만듦 (이슈 보드, 상태: ${P.ISSUE_STATES.join(' · ')})`);
    const extra = want.filter((x) => P.STACK_STAGES.some((st) => st.name === x));
    return console.log(`✔ ${P.FILE} 만듦 (${approach === 'sprint' ? '스프린트' : type} 기본 단계 ${want.length}개${extra.length ? `, 스택에 따라 ${extra.join(' · ')} 포함` : ''})`);
  }
  const plan = P.read(root);
  if (argv[0] === 'check') {
    if (externalLine(ws)) console.log(`· 로드맵: ${externalLine(ws)}`);
    for (const w of check(ws, plan, root)) console.log(`⚠ 로드맵: ${w}`);
    return;
  }
  if (!plan) {
    if (externalLine(ws)) return console.log(externalLine(ws));
    console.log(`로드맵이 없습니다 (${P.FILE}). 만들기: kedovi plan init`);
    process.exitCode = has('json') ? 1 : 0;
    return;
  }
  if (has('json')) return console.log(JSON.stringify({ ...P.toJson(plan), at: localDate() }, null, 2));
  if (has('report')) {
    if (!plan.issues) return console.log('기간 보고(--report)는 이슈형 로드맵에서만 됩니다. 단계형은 kedovi plan');
    const i = argv.indexOf('--report');
    const ds = argv.slice(i + 1, i + 3).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
    const to = ds[1] || localDate();
    const from = ds[0] || new Date(Date.parse(to) - 6 * 86400000).toISOString().slice(0, 10);
    return console.log(P.issueReport(plan, from, to));
  }
  if (has('short')) return console.log(P.shortLine(plan, P.externalOf(ws)));
  console.log(report(ws, plan));
}

if (require.main === module) main();
module.exports = { check, externalLine, created, layersOf };
