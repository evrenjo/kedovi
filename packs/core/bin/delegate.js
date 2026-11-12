#!/usr/bin/env node
// 역할 위임 — 다른 도구(Claude Code ↔ Codex)의 모델에게 역할 작업을 맡긴다. 실행: node packs/core/bin/delegate.js <start|wait|run|list> …
/*
 * 한 도구 안의 서브에이전트는 자기 회사 모델만 쓴다. 그래서 상대 회사 모델이 맡은 역할은 그 도구의 비대화형 실행으로 넘긴다 (공식 기능).
 *   codex : codex exec --sandbox <read-only|workspace-write> -C <워크스페이스> [-m] [-c model_reasoning_effort=] -o <결과> -
 *   claude: claude -p [--model] [--effort] --permission-mode <plan|acceptEdits> --allowedTools … --disallowedTools git commit·push
 * 오래 걸리므로 백그라운드 작업으로 돈다:
 *   start --to codex|claude --role <역할> [--model m] [--effort e] [--mode write|read] [--scope <라벨>] [--group <묶음>]   작업 지시서는 stdin (또는 --task-file)
 *        --group: 토론(debate.js)처럼 한 번에 여러 모델을 돌리는 묶음. 묶음 안끼리는 동시 상한에 세지 않고 끝 알림도 묶음 단위
 *        리뷰 역할에 --scope 를 주면 같은 범위의 차수를 센다: 앞 차수 블로커를 지시서에 붙이고, 3차부터 시작할 때 경고한다
 *        → 작업 id 를 출력하고 바로 끝난다
 *   wait <id> [--timeout 초(기본 480)]   끝날 때까지(또는 timeout 까지) 기다린다. 끝났으면 결과(보고 · 바뀐 파일 · 종료 코드), 아니면 경과 시간 · 마지막 로그 한 줄
 *        결과 머리에: 실패 원인(사용량 한도 · 로그인 · 시간 초과 · 네트워크)과 대안 (사용량 한도면 상대 도구로 다시 시작하는 명령 한 줄) · 실행 중 대상이 바뀌었으면 「결과가 낡았을 수 있음」
 *        끝나면 개인 알림(kedovi notify my on)도 간다 (작업 끝 알림 기준 시간을 넘겼을 때)
 *   status [<id>]                         지금 진행 현황 한 번: 경과 · 읽은 파일 · 실행한 명령 · 고친 파일 수 · 최근 동작 · 최근 말 (id 를 빼면 마지막 실행 중 작업)
 *   watch [<id>]                          상대 에이전트가 읽고 실행하는 것을 생기는 대로 한 줄씩 (사용자가 다른 터미널에서 kedovi delegate watch). 끝나면 요약
 *        진행은 두 도구의 진행 이벤트(codex exec --json · claude -p --output-format stream-json)를 events.jsonl 에 받아 lib/delegate-progress.js 가 읽는다
 *   list                                  이 워크스페이스의 위임 작업
 *   run …                                 (내부) 앞에서 실행 — start 가 부른다
 *   --dry-run                             실행하지 않고 명령만
 * 위임받은 쪽은 리더의 대화를 모른다 — 지시서가 전부다. 커밋·push·PR 은 하지 않는다 (claude 는 도구로, codex 는 샌드박스 네트워크 차단으로 막힌다).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { load, git, stateDir } = require('../lib/workspace');
const { findCli } = require('../lib/cli');
const { REVIEW_ROLE, hasCheckLine, CHECK_MESSAGE, checkLevel, screenGapIds, screenBlock } = require('../lib/review');
const P = require('../lib/delegate-progress');

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes(`--${k}`);

const ws = load();
const ROOT = ws.root;
const JOBS = path.join(stateDir(ROOT), 'delegate');
fs.mkdirSync(JOBS, { recursive: true });

// ───────── 지시문 ─────────

/** 역할 정의 본문 — project 팩이 같은 이름으로 덮으면 그것 */
function roleBody(role) {
  for (const pk of [...(ws.packs || [])].reverse()) {
    const f = path.join(ROOT, 'packs', pk, 'agents', `${role}.md`);
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  }
  return null;
}

// 리뷰 위임에 늘 붙이는 블로커 기준 (역할 정의를 project 팩이 덮어도 남는다)
const REVIEW_BAR = '**블로커 기준**: 블로커는 실제로 틀리는 입력 · 경로를 댈 수 있는 것만이다. 사용자가 보는 틀린 결과 · 화면, 잘못 저장 · 전송되는 데이터(주문 · 결제 · 계좌 같은 상태 포함), 보안 문제. 일어나는 경로를 대지 못하는 이론적인 경쟁 조건 · 가정한 시나리오, 요청 범위 밖의 구조 개선은 권장 이하로 둔다. 회귀는 머리로 판정하지 않는다: 지시서의 검사 결과를 근거로 하고, 검사가 덮지 않는 갈래는 「검사로 확인 필요: <무엇>」 으로 적는다.';

function buildPrompt({ role, mode, task, to, prior }) {
  const body = roleBody(role);
  const review = REVIEW_ROLE.test(role);
  return [
    `너는 이 워크스페이스의 **${role}** 역할이다. 다른 AI 에이전트(리더)가 이 일을 맡겼다. 리더와 대화를 공유하지 않으니 아래 작업 지시서가 전부다.`,
    `작업 폴더는 워크스페이스 루트다. 규칙은 ${to === 'codex' ? 'AGENTS.md' : 'CLAUDE.md(= AGENTS.md)'} 와 그 안의 「repo 별 작업 규칙」을 따른다. 답은 한국어로.`,
    mode === 'write'
      ? '지시서의 소유 파일(폴더)만 고친다. 그 밖의 변경이 필요하면 고치지 말고 보고에 적는다. **커밋·push·PR·배포·DB 반영은 하지 않는다.**'
      : `**읽기 전용이다.** 파일을 고치거나 상태를 바꾸는 명령을 실행하지 않는다.${to === 'claude' ? ` 셸은 읽기 명령(${READ_SHELL.slice(1).join(' · ')})만 된다. 하위 repo 는 \`cd repos/<이름> && git diff HEAD\` 처럼 (그룹 폴더면 \`repos/<그룹>/<이름>\`, 위치는 AGENTS.md 의 repo 표) 들어가서 돌린다.` : ''}`,
    '핸드오프(handoffs/) · TODO · 완료 조건 · 위임 작업 관리는 리더 몫이다. 건드리지 않고, 보고에 그에 관한 말(못 했다 · 안 했다)도 쓰지 않는다.',
    '끝나면 역할 정의의 「보고 형식」으로 답한다. 없으면: 결론 한 줄 · 바꾼 파일 · 실행한 검증(명령과 결과) · 추정/미확인.',
    ...(review ? ['', REVIEW_BAR] : []),
    ...(prior && prior.round > 1 ? ['', `# 앞 차수 리뷰 (같은 범위 「${prior.scope}」 ${prior.round}차)`, '',
      '앞 차수의 블로커다. 이번 블로커가 이 중 하나와 같은 영역(같은 파일 · 같은 상태 흐름)이면 `[반복]` 을 붙이고, 수정안 대신 반복되는 원인 구조를 한 줄로 적는다. 앞 지적이 고쳐졌는지도 확인한다.',
      ...(prior.blockers.length ? prior.blockers.map((b) => `- ${b}`) : ['- (앞 차수 블로커 없음)'])] : []),
    '', '# 역할 정의', '', body || `(packs/*/agents/${role}.md 없음. 일반 원칙으로 한다)`,
    '', '# 작업 지시서 (리더)', '', task.trim(), '',
  ].join('\n');
}

/** 읽기 전용 claude 리뷰어가 쓸 수 있는 셸 명령 (git -C 는 커밋까지 열리므로 cd 로 들어간다) */
const READ_SHELL = ['cd', 'git diff', 'git show', 'git log', 'git status', 'git blame', 'git ls-files', 'grep', 'rg', 'ls', 'wc'];

function commandFor({ to, model, effort, mode, outFile }) {
  if (to === 'codex') {
    return { bin: 'codex', args: ['exec', '--skip-git-repo-check', '--sandbox', mode === 'write' ? 'workspace-write' : 'read-only', '-C', ROOT,
      ...(model ? ['-m', model] : []), ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []), '--json', '-o', outFile, '-'] };
  }
  const tools = mode === 'write' ? 'Read,Grep,Glob,Edit,Write,Bash' : 'Read,Grep,Glob,Bash';
  // 읽기 전용: 셸은 읽기 명령만 허용 목록으로 (plan 모드라 그 밖의 명령은 돌지 않는다)
  const allowed = mode === 'write' ? tools : ['Read,Grep,Glob', ...READ_SHELL.map((c) => `Bash(${c}:*)`)].join(',');
  return { bin: 'claude', args: ['-p', '--output-format', 'stream-json', '--verbose', ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []),
    '--permission-mode', mode === 'write' ? 'acceptEdits' : 'plan', '--tools', tools, '--allowedTools', allowed,
    '--disallowedTools', 'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git reset:*)', 'Bash(rm -rf:*)'] };
}

/** repo 마다 바뀐 파일 목록 (git status) — 위임 전후를 비교해 이번에 바뀐 파일을 알린다 */
function dirtySnapshot() {
  const out = {};
  for (const r of [...ws.repos.map((x) => ({ name: x.name, dir: x.dir })), { name: '(워크스페이스)', dir: ROOT }]) {
    if (!fs.existsSync(r.dir)) continue;
    const s = git(r.dir, ['status', '--porcelain', '--untracked-files=all']);
    if (s !== null) out[r.name] = s.split('\n').filter(Boolean).map((l) => l.slice(3));
  }
  return out;
}

/** 실행 중 바뀌었는지 볼 지문: repo 마다 HEAD · 고친 파일의 크기 · 시각 */
function fingerprint() {
  const out = {};
  for (const r of [...ws.repos.map((x) => ({ name: x.name, dir: x.dir })), { name: '(워크스페이스)', dir: ROOT }]) {
    if (!fs.existsSync(r.dir)) continue;
    const head = git(r.dir, ['rev-parse', 'HEAD']);
    const s = git(r.dir, ['status', '--porcelain', '--untracked-files=all']);
    if (s === null) continue;
    const files = {};
    for (const f of s.split('\n').filter(Boolean).map((l) => l.slice(3))) {
      try { const st = fs.statSync(path.join(r.dir, f)); files[f] = `${st.size}:${Math.round(st.mtimeMs)}`; } catch { files[f] = '-'; }
    }
    out[r.name] = { head: head && head.trim(), files };
  }
  return out;
}

/** 시작 뒤 바뀐 것 → { repo: ['커밋 바뀜' | 파일] }. 쓰기 위임은 자기가 고친 파일(changed)을 빼고 본다 */
function staleSince(before, after, own = {}) {
  const out = {};
  for (const [repo, a] of Object.entries(after || {})) {
    const b = (before || {})[repo];
    if (!b) continue;
    const mine = new Set(own[repo] || []);
    const list = [];
    if (b.head !== a.head) list.push('커밋 바뀜');
    for (const f of new Set([...Object.keys(b.files), ...Object.keys(a.files)])) if (b.files[f] !== a.files[f] && !mine.has(f)) list.push(f);
    if (list.length) out[repo] = list.slice(0, 8);
  }
  return out;
}

/** 같은 범위의 앞 리뷰 위임 (7일 안) → { scope, round(이번 포함), blockers: 앞 차수 블로커 줄 } */
function priorReviews(role, scope) {
  if (!scope || !REVIEW_ROLE.test(role)) return null;
  const since = Date.now() - 7 * 86400000;
  const prev = [];
  for (const id of fs.readdirSync(JOBS).sort()) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(JOBS, id, 'meta.json'), 'utf8'));
      if (m.scope === scope && REVIEW_ROLE.test(m.role) && m.startedAt > since) prev.push(id);
    } catch { /* 깨진 기록 */ }
  }
  const blockers = [];
  for (const id of prev.slice(-3)) {
    let out = '';
    try { out = fs.readFileSync(path.join(JOBS, id, 'out.md'), 'utf8'); } catch { continue; }
    for (const l of out.split('\n')) if (/\[블로커\]/.test(l)) blockers.push(l.replace(/^\s*\d+\.\s*/, '').trim().slice(0, 200));
  }
  return { scope, round: prev.length + 1, blockers: blockers.slice(-12) };
}

/** 실패 원인 — 로그 끝에서 찾는다 */
const FAILURES = [
  [/\b429\b|rate.?limit|usage limit|quota|too many requests|사용량/i, '사용량 한도(429)', '다른 모델(--model) · 상대 도구 리뷰어(--to) · 한도가 풀린 뒤 다시'],
  [/\b401\b|unauthori[sz]ed|not logged in|log ?in again|login required|auth\w* (?:expired|failed)|invalid api key/i, '로그인 만료 · 인증', '사용자에게 그 도구 로그인을 부탁 · 같은 도구 모델로 대신'],
  [/timed? ?out|timeout|ETIMEDOUT/i, '시간 초과', '범위를 나눠 다시 · 더 빠른 모델'],
  [/ENOTFOUND|ECONNRESET|ECONNREFUSED|network error|fetch failed/i, '네트워크', '연결 확인 뒤 다시'],
];
function failureOf(id) {
  let tail = '';
  try { tail = fs.readFileSync(path.join(JOBS, id, 'log.txt'), 'utf8').slice(-6000); } catch { return null; }
  const hit = FAILURES.find(([re]) => re.test(tail));
  return hit ? { cause: hit[1], alt: hit[2], limit: hit === FAILURES[0] } : null;
}
/** 사용량 한도로 실패한 위임을 상대 도구로 다시 시작하는 명령 한 줄 (지시서는 그 작업 폴더의 task.md) */
function retryLine(meta, dir) {
  const task = path.join(dir, 'task.md');
  if (!fs.existsSync(task)) return '';
  const q = (v) => (/^[\w./:@-]+$/.test(v) ? v : `'${String(v).replace(/'/g, `'\\''`)}'`);
  return ['node packs/core/bin/delegate.js start', '--to', meta.to === 'codex' ? 'claude' : 'codex', '--role', meta.role, '--mode', meta.mode,
    ...(meta.effort ? ['--effort', meta.effort] : []), ...(meta.scope ? ['--scope', q(meta.scope)] : []), '--task-file', q(task)].join(' ');
}

// ───────── 실행 ─────────

function parseJobArgs() {
  const to = opt('to');
  if (!['codex', 'claude'].includes(to)) throw new Error('--to 는 codex | claude');
  const role = opt('role');
  if (!role) throw new Error('--role <역할> 이 필요합니다');
  const mode = opt('mode', 'write');
  if (!['write', 'read'].includes(mode)) throw new Error('--mode 는 write | read');
  return { to, role, mode, model: opt('model'), effort: opt('effort'), scope: opt('scope'), group: opt('group') };
}

function readTask() {
  const f = opt('task-file');
  if (f) return fs.readFileSync(path.resolve(f), 'utf8');
  if (process.stdin.isTTY) return '';
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function start() {
  const job = parseJobArgs();
  let task = readTask();
  if (!task.trim()) throw new Error('작업 지시서가 비었습니다. stdin 이나 --task-file 로 주세요');
  const id = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${job.role}-${process.pid}`;
  const dir = path.join(JOBS, id);
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, 'out.md');
  const { bin, args } = commandFor({ ...job, outFile });
  const exe = findCli(bin);
  // 리뷰 전 검사: 지시서에 「검사:」 줄이 없으면 막거나 알린다 (agents.enforce.checkBeforeReview)
  const checkLv = REVIEW_ROLE.test(job.role) && !hasCheckLine(task) ? checkLevel(ROOT) : 'off';
  if (checkLv === 'block') { fs.rmSync(dir, { recursive: true, force: true }); console.log(`✖ ${CHECK_MESSAGE}`); process.exit(6); }
  if (checkLv === 'warn') console.log(`⚠ ${CHECK_MESSAGE}`);
  // 화면 정본 대조: 정본이 있는 화면을 다루면 정본 경로 · 요소 체크리스트를 지시서에 넣는다 (screens 팩). 리뷰 = 블로커 기준 · 그 밖 = 구현 기준(정본대로, 못 하면 멈춤)
  {
    const ids = screenGapIds(ROOT, task);
    const block = screenBlock(ROOT, ids, REVIEW_ROLE.test(job.role) ? 'review' : 'implement');
    if (block) { task = `${task.replace(/\s+$/, '')}\n\n${block}\n`; console.log(`ℹ 화면 정본 대조 블록을 지시서에 넣었습니다: ${ids.join(' · ')}`); }
  }
  const prior = priorReviews(job.role, job.scope);
  const meta = { id, ...job, cli: exe, args, startedAt: Date.now(), dir, round: prior ? prior.round : undefined };
  if (has('dry-run')) { console.log(JSON.stringify({ ...meta, prompt: `${buildPrompt({ ...job, task, prior }).slice(0, 300)}…` }, null, 2)); fs.rmSync(dir, { recursive: true, force: true }); return; }
  // Codex 샌드박스 안이면 네트워크가 막혀 상대 CLI 가 API 에 닿지 못한다 — 샌드박스 밖 실행 승인을 받아 다시 하게 한다
  if (process.env.CODEX_SANDBOX_NETWORK_DISABLED === '1') {
    console.log('✖ Codex 샌드박스 안이라 네트워크가 막혀 위임할 수 없습니다. 이 명령을 샌드박스 밖에서 실행하도록 사용자 승인을 요청해 다시 실행하세요');
    process.exit(4);
  }
  if (!exe) {
    console.log(`✖ ${bin} 가 이 PC 에 없어 위임하지 못했습니다. 리더에게 알린다 (같은 도구 모델로 대신하려면 리더가 역할을 직접 맡긴다)`);
    process.exit(3);
  }
  // 동시 상한 — 역할 에이전트 상한(kedovi ai show 의 limits.parallel)을 위임에도 적용한다
  // 같은 묶음(--group: 토론 한 번)의 작업은 서로 세지 않는다. 묶음 밖 작업만 상한에 센다
  const groupOf = (x) => { try { return JSON.parse(fs.readFileSync(path.join(JOBS, x, 'meta.json'), 'utf8')).group || null; } catch { return null; } };
  const busy = runningJobs().filter((x) => x !== id && !(job.group && groupOf(x) === job.group));
  let parallel = 2;
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); parallel = kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).limits.parallel || parallel; } catch { /* 옛 워크스페이스 */ }
  if (busy.length >= parallel) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`✖ 위임 작업이 이미 ${busy.length}개 돌고 있습니다 (동시 ${parallel}개). 먼저 wait 로 결과를 받으세요: ${busy.join(', ')}`);
    process.exit(5);
  }
  fs.writeFileSync(path.join(dir, 'prompt.md'), buildPrompt({ ...job, task, prior }));
  fs.writeFileSync(path.join(dir, 'task.md'), task);
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ ...meta, before: dirtySnapshot(), print: fingerprint(), reviewTrees: reviewSnapshot(job.role) }, null, 2));
  // 앞에서 도는 run 을 떼어 낸다 — 이 명령은 바로 끝나고, 결과는 wait 로 받는다
  const child = spawn(process.execPath, [__filename, 'run', '--job', id], { cwd: ROOT, detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`위임 시작: ${job.role} → ${bin}${job.model ? ` (${job.model}${job.effort ? ` · ${job.effort}` : ''})` : ''} · ${job.mode === 'write' ? '쓰기' : '읽기 전용'}`);
  console.log(`작업 id: ${id}`);
  if (prior && prior.round >= 3) console.log(`⚠ 같은 범위 「${prior.scope}」 ${prior.round}차 리뷰입니다. 지적을 차수마다 땜질하지 말고, 원인 구조를 정리했는지 · 남은 지적을 한계로 문서화할지 사용자에게 묻습니다 (앞 차수 블로커 ${prior.blockers.length}개를 지시서에 붙였습니다)`);
  console.log(`다음: node packs/core/bin/delegate.js wait ${id}`);
  console.log(`진행 보기 (사용자에게 알린다): kedovi delegate watch ${id} (다른 터미널에서 상대 에이전트가 읽고 실행하는 것이 줄마다 보인다) · 한 번만 보기: kedovi delegate status ${id}`);
}

/** 리뷰 확인을 켠 워크스페이스에서 reviewer 역할을 위임하면: 시작 때 상태 (끝나면 리뷰 기록이 된다. lib/review.js) */
function reviewSnapshot(role) {
  try {
    const R = require('../lib/review');
    if (!R.REVIEW_ROLE.test(role)) return null;
    const st = R.settings(ROOT);
    return st.level === 'off' ? null : R.snapshot(ROOT, ws, st);
  } catch { return null; }
}

/** 진행 이벤트(JSONL: codex --json · claude stream-json)를 events.jsonl 에 흘려 쓰며 끝날 때까지 기다린다 */
function runCli(meta, dir) {
  return new Promise((ok) => {
    const log = fs.openSync(path.join(dir, 'log.txt'), 'a');
    const ev = fs.openSync(path.join(dir, 'events.jsonl'), 'a');
    const child = spawn(meta.cli, meta.args, { cwd: ROOT, stdio: ['pipe', ev, log], env: delegateEnv() });
    child.on('error', (e) => ok({ status: null, signal: null, error: e }));
    child.on('close', (status, signal) => { fs.closeSync(ev); fs.closeSync(log); ok({ status, signal, error: null }); });
    child.stdin.end(fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8'));
  });
}

async function run() {
  const id = opt('job');
  const dir = path.join(JOBS, id);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const r = await runCli(meta, dir);
  // claude 의 결과 = stream-json 마지막 result (없으면 응답 글을 모은 것). codex 는 -o 파일
  if (meta.to === 'claude') { const out = P.finalText(readEvents(id)); if (out) fs.writeFileSync(path.join(dir, 'out.md'), out); }
  const after = dirtySnapshot();
  const changed = {};
  for (const [repo, files] of Object.entries(after)) {
    const was = new Set((meta.before || {})[repo] || []);
    const now = files.filter((f) => !was.has(f));
    if (now.length) changed[repo] = now;
  }
  const stale = meta.print ? staleSince(meta.print, fingerprint(), meta.mode === 'write' ? after : {}) : {};
  const endedAt = Date.now();
  if (r.status === 0 && meta.reviewTrees) { try { const R = require('../lib/review'); R.record(ROOT, ws, R.settings(ROOT), { by: `${meta.role} 위임 → ${meta.to}`, trees: meta.reviewTrees }); } catch { /* 기록은 부가 기능 */ } }
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ code: r.status, signal: r.signal, error: r.error && r.error.message, changed, stale, endedAt }, null, 2));
  return notifyDone(meta, r.status, endedAt);
}

/**
 * 위임 세션 환경. KEDOVI_DELEGATED: 워크스페이스 훅이 아무것도 하지 않는다 (lib/hook.js).
 * 텔레그램 채널을 쓰는 세션에서 위임하면 그 상태 폴더를 물려받은 플러그인 서버가 리더 세션의 수신을 끊는다. 토큰을 비워 서버가 뜨지 않게 한다
 * 비밀값(팩이 선언한 이름 · kedovi secret 목록 · 옛 위치 · 알려진 토큰 이름)도 넘기지 않는다. 위임받은 에이전트에게 필요하면 그 도구가 저장소에서 읽는다
 */
function delegateEnv() {
  const env = { ...process.env, KEDOVI_DELEGATED: '1', TELEGRAM_BOT_TOKEN: '' };
  require('../lib/secrets').scrubEnv(env, ROOT, ws.packs || [], [ws.vars && ws.vars.gitlab && ws.vars.gitlab.tokenEnv]);
  env.TELEGRAM_BOT_TOKEN = '';
  delete env.TELEGRAM_STATE_DIR;
  delete env.KEDOVI_CHANNEL;
  return env;
}

/** 끝나면 개인 알림(진행 현황 · 전체 수준만, notify.minSeconds 넘게 걸렸고 PC 앞에 없을 때). 결과와 결정 수준은 리더의 작업 끝 알림으로 충분하다 */
async function notifyDone(meta, code, endedAt) {
  try {
    const notify = require('../lib/notify');
    const cfg = notify.personal(ROOT, ws);
    const sec = (endedAt - meta.startedAt) / 1000;
    if (meta.group) return; // 토론 같은 묶음은 묶음이 끝날 때 한 번 (debate.js)
    if (!notify.wantsProgress(cfg) || !cfg.token || !cfg.chat || sec < cfg.minSeconds || notify.atDesk(cfg)) return;
    const mins = (sec / 60).toFixed(1);
    await notify.send(`🤖 [${notify.projectName(ROOT, ws)}] 위임 ${code === 0 ? '끝' : `실패(${code})`}: ${meta.role} → ${meta.to} · ${mins}분\n결과: node packs/core/bin/delegate.js wait ${meta.id}`, cfg);
  } catch { /* 알림은 부가 기능 */ }
}

/** 진행 중 로그의 마지막 줄 (지금 무엇을 하는지) */
function lastLogLine(id) {
  try {
    const lines = fs.readFileSync(path.join(JOBS, id, 'log.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
    const l = lines[lines.length - 1] || '';
    return l.length > 200 ? `${l.slice(0, 200)}…` : l;
  } catch { return ''; }
}

function report(id) {
  const dir = path.join(JOBS, id);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const res = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  let out = '';
  try { out = fs.readFileSync(path.join(dir, 'out.md'), 'utf8').trim(); } catch { /* 없음 */ }
  const mins = ((res.endedAt - meta.startedAt) / 60000).toFixed(1);
  const lines = [`# 위임 결과: ${meta.role} → ${meta.to}${meta.model ? ` (${meta.model})` : ''} · ${res.code === 0 ? '완료' : `실패 (종료 코드 ${res.code}${res.error ? `, ${res.error}` : ''})`} · ${mins}분${meta.round ? ` · 「${meta.scope}」 ${meta.round}차 리뷰` : ''}`];
  const fail = res.code !== 0 || !out ? failureOf(id) : null;
  if (fail) lines.push('', `⚠ 실패 원인: ${fail.cause} · 대안: ${fail.alt}`);
  const retry = fail && fail.limit ? retryLine(meta, dir) : '';
  if (retry) lines.push(`  상대 도구로 다시: ${retry}`);
  else if (res.code !== 0 || !out) lines.push('', `⚠ ${res.code !== 0 ? '실패' : '보고가 비었음'}: 원인을 로그에서 찾지 못했습니다. 로그 끝: ${lastLogLine(id) || '(없음)'}`);
  const stale = Object.entries(res.stale || {});
  if (stale.length) lines.push('', `⚠ 실행 중 대상이 바뀌어 결과가 낡았을 수 있음: ${stale.map(([repo, l]) => `${repo} ${l.join(', ')}`).join(' · ')}. 바뀐 부분이 리뷰 · 검사 대상이면 다시 돌린다`);
  // 2차부터, 블로커 줄에 붙은 [반복] 만 센다 (규칙 문구를 인용한 줄은 세지 않는다)
  const again = meta.round > 1 ? out.split('\n').filter((l) => /\[블로커\]/.test(l) && /\[반복\]/.test(l)).length : 0;
  if (again) lines.push('', `⚠ 앞 차수와 같은 영역의 블로커 ${again}개 ([반복]): 땜질을 멈추고 원인 구조를 정리할지 사용자와 정한다`);
  const changed = Object.entries(res.changed || {});
  lines.push('', '## 이번에 바뀐 파일 (git status 기준)', ...(changed.length ? changed.map(([repo, fs2]) => `- ${repo}: ${fs2.join(', ')}`) : ['- 없음']));
  lines.push('', `## ${meta.to} 의 보고`, '', out || '(보고 없음)');
  if (res.code !== 0 || !out) lines.push('', `로그: ${path.join(dir, 'log.txt')}`);
  console.log(lines.join('\n'));
  return res.code === 0;
}

/** 진행 이벤트 (없으면 빈 목록) */
function readEvents(id) {
  try { return P.parse(fs.readFileSync(path.join(JOBS, id, 'events.jsonl'), 'utf8')); } catch { return []; }
}
const metaOf = (id) => {
  if (!id || !fs.existsSync(path.join(JOBS, id, 'meta.json'))) throw new Error(`작업 id 가 없습니다: ${id} (목록: kedovi delegate list)`);
  return { ...JSON.parse(fs.readFileSync(path.join(JOBS, id, 'meta.json'), 'utf8')), root: ROOT };
};
const resultOf = (id) => { try { return JSON.parse(fs.readFileSync(path.join(JOBS, id, 'result.json'), 'utf8')); } catch { return null; } };

/** status <id>: 지금 진행 현황 한 번 */
function status() {
  const id = argv[1] || runningJobs().slice(-1)[0];
  const meta = metaOf(id);
  const res = resultOf(id);
  console.log(P.render(P.summarize(readEvents(id), meta, res), meta, res));
}

/** watch <id>: 상대 에이전트가 하는 일을 생기는 대로 한 줄씩 (끝나면 결과 요약). 사용자가 다른 터미널에서 본다 */
async function watch() {
  const id = argv[1] || runningJobs().slice(-1)[0];
  const meta = metaOf(id);
  console.log(`● ${meta.role} → ${meta.to}${meta.model ? ` (${meta.model})` : ''} · ${meta.mode === 'write' ? '쓰기' : '읽기 전용'} · 작업 ${id} (끝내기: Ctrl+C, 작업은 계속 돈다)`);
  let seen = 0;
  for (;;) {
    const evs = readEvents(id);
    const lines = P.actions(evs, meta);
    for (const l of lines.slice(seen)) console.log(`  ${l}`);
    seen = lines.length;
    const res = resultOf(id);
    if (res) { console.log(P.render(P.summarize(evs, meta, res), meta, res)); return; }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function wait() {
  const id = argv[1];
  if (!id || !fs.existsSync(path.join(JOBS, id))) throw new Error(`작업 id 가 없습니다: ${id} (목록: node packs/core/bin/delegate.js list)`);
  const limit = Number(opt('timeout', 480)) * 1000;
  const t0 = Date.now();
  while (!fs.existsSync(path.join(JOBS, id, 'result.json'))) {
    if (Date.now() - t0 > limit) {
      const meta = metaOf(id);
      console.log(`${P.render(P.summarize(readEvents(id), meta), meta)}\n다시: node packs/core/bin/delegate.js wait ${id} · 사용자 화면에서 보기: kedovi delegate watch ${id}`);
      process.exit(2);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  process.exit(report(id) ? 0 : 1);
}

/** 아직 끝나지 않은 작업 id (하루 지난 것은 버려진 것으로 본다) */
function runningJobs() {
  const day = Date.now() - 86400000;
  return fs.readdirSync(JOBS).filter((id) => {
    if (fs.existsSync(path.join(JOBS, id, 'result.json'))) return false;
    try { return JSON.parse(fs.readFileSync(path.join(JOBS, id, 'meta.json'), 'utf8')).startedAt > day; } catch { return false; }
  });
}

function list() {
  const ids = fs.readdirSync(JOBS).sort();
  if (!ids.length) return console.log('위임 작업 없음');
  for (const id of ids) {
    let st = '실행 중';
    try { const r = JSON.parse(fs.readFileSync(path.join(JOBS, id, 'result.json'), 'utf8')); st = r.code === 0 ? '완료' : `실패(${r.code})`; } catch { /* 실행 중 */ }
    console.log(`${id}  ${st}`);
  }
}

(async () => {
  try {
    if (cmd === 'start') start();
    else if (cmd === 'run') await run();
    else if (cmd === 'wait') await wait();
    else if (cmd === 'status') status();
    else if (cmd === 'watch') await watch();
    else if (cmd === 'list') list();
    else { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 18).map((l) => l.replace(/^ \* ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
  } catch (e) { console.error(`✖ ${e.message}`); process.exit(1); }
})();
