// 리뷰 확인 (commit · push 전에 리뷰를 거쳤나): 리뷰한 상태를 repo 별로 기록하고, 지금 상태와의 차이(줄 수)를 센다. 기본 꺼짐 (agents.enforce.reviewBeforePush).
/*
 * 리뷰 기록 = 리뷰를 시작한 때의 작업 폴더 전체(추적 안 된 파일 포함)를 git tree 로 만든 해시. 임시 index 로 만들어 실제 index · 작업 폴더는 건드리지 않는다.
 * 리뷰 안 된 줄 수 = 지금 상태와 가장 가까운 기준(리뷰 기록들 · 이미 push 된 상태)의 차이. 리뷰 뒤 고친 만큼만 다시 센다 (기준 줄 수 reviewMinLines 이하면 통과).
 *   리뷰 기록과는 더한 줄만 센다 (리뷰어가 보지 못한 줄. 리뷰한 것의 일부만 commit · push 해도 통과). push 된 상태와는 더한 줄 + 뺀 줄.
 * 기록이 생기는 때: 다른 AI 에게 reviewer 위임이 끝남(delegate.js) · 교차 검토(cross-review.js) · reviewer 역할 에이전트를 띄움(hooks/agent-budget.js) · kedovi review mark
 * 기록 위치: 워크스페이스 밖 임시 상태 폴더의 review.json (이 PC 만). 없어지면 다시 경고가 날 뿐이다.
 * 쓰는 곳: hooks/review-gate.js · bin/review.js. 설정은 bin/kit.js resolveModels 의 enforce.reviewBeforePush · review
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { stateDir } = require('./workspace');

const KEEP = 12; // repo 마다 남기는 리뷰 기록 수
const SKIP_TTL = 60 * 60 * 1000; // 생략 표시는 1시간 안에 한 번만 쓴다
const REVIEW_ROLE = /review/i;

function git(dir, args, env) {
  try { return execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000, maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env }).trim(); } catch { return null; }
}
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/** 설정: { level: off|warn|block, repos: ['*'|이름…], minLines, paths: [pathspec…] } */
function settings(ROOT) {
  const out = { level: 'off', repos: ['*'], minLines: 0, paths: [] };
  try {
    const kit = require(path.join(ROOT, 'bin', 'kit.js'));
    const r = kit.resolveModels(ROOT, kit.loadWorkspace(ROOT));
    out.level = (r.enforce || {}).reviewBeforePush || 'off';
    Object.assign(out, r.review || {});
  } catch { /* 옛 워크스페이스: 꺼짐 */ }
  return out;
}

/** 대상 repo (코드 · 기획 repo 중 설정에 든 것, 폴더가 git repo 인 것). ws = lib/workspace.js load() */
function scope(ws, st) {
  const all = (st.repos || ['*']).includes('*');
  return (ws.repos || []).filter((r) => ['code', 'docs'].includes(r.kind || 'code') && (all || st.repos.includes(r.name)) && fs.existsSync(path.join(r.dir, '.git')));
}

/** 그 폴더가 속한 대상 repo. 아니면 null */
function repoOf(ws, st, dir) {
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  if (!top) return null;
  return scope(ws, st).find((r) => real(r.dir) === real(top)) || null;
}

/** 작업 폴더 전체의 tree 해시 (추적 안 된 파일 포함 · .gitignore 따름). 실제 index 는 그대로 */
function workTree(dir) {
  const idx = git(dir, ['rev-parse', '--git-path', 'index']);
  if (idx == null) return null;
  const tmp = path.join(os.tmpdir(), `kedovi-review-index-${process.pid}-${Date.now()}`);
  try {
    const src = path.resolve(dir, idx);
    if (fs.existsSync(src)) fs.copyFileSync(src, tmp);
    const env = { GIT_INDEX_FILE: tmp };
    if (git(dir, ['add', '-A', '--', '.'], env) == null) return null;
    return git(dir, ['write-tree'], env);
  } finally { fs.rmSync(tmp, { force: true }); fs.rmSync(`${tmp}.lock`, { force: true }); }
}
const headTree = (dir) => git(dir, ['rev-parse', '--verify', '-q', 'HEAD^{tree}']);

/** 이미 push 된 상태의 tree: 추적 브랜치, 없으면 원격 기본 브랜치와 갈라진 곳 */
function pushedTree(dir) {
  const up = git(dir, ['rev-parse', '--verify', '-q', '@{upstream}^{tree}']);
  if (up) return up;
  const base = git(dir, ['merge-base', 'HEAD', 'origin/HEAD']);
  return base ? git(dir, ['rev-parse', '--verify', '-q', `${base}^{tree}`]) : null;
}

/** 두 tree 사이에 바뀐 줄 수 (더한 줄 + 뺀 줄, addedOnly 면 더한 줄만. 바이너리는 1). 핸드오프 기록은 뺀다. 셀 수 없으면 null */
function lines(dir, a, b, paths, addedOnly) {
  const spec = [...(paths && paths.length ? paths : ['.']), ':(exclude,top)handoffs'];
  const out = git(dir, ['diff', '--numstat', a, b, '--', ...spec]);
  if (out == null) return null;
  return out.split('\n').filter(Boolean).reduce((n, l) => { const [x, y] = l.split('\t'); return n + (x === '-' ? 1 : Number(x) + (addedOnly ? 0 : Number(y))); }, 0);
}

// 훅(CLAUDE_PROJECT_DIR)과 명령(작업 폴더)이 같은 워크스페이스를 다른 경로(심볼릭 링크)로 불러도 같은 기록을 본다
const file = (ROOT) => path.join(stateDir(real(ROOT)), 'review.json');
/** 기록 시각 → 이 PC 시각 'YYYY-MM-DD HH:MM' */
function when(iso) { const d = new Date(iso); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
function read(ROOT) { try { return { records: {}, skips: [], warned: {}, ...JSON.parse(fs.readFileSync(file(ROOT), 'utf8')) }; } catch { return { records: {}, skips: [], warned: {} }; } }
function write(ROOT, data) { try { fs.writeFileSync(file(ROOT), JSON.stringify(data, null, 2)); } catch { /* 기록은 부가 기능 */ } }

/** 지금 상태 { repo 이름: tree } (대상 repo 전부, 또는 names 만) */
function snapshot(ROOT, ws, st, names) {
  const out = {};
  for (const r of scope(ws, st)) {
    if (names && names.length && !names.includes(r.name)) continue;
    const t = workTree(r.dir);
    if (t) out[r.name] = t;
  }
  return out;
}

/** 리뷰 기록을 남긴다. trees 를 안 주면 지금 상태 */
function record(ROOT, ws, st, { by, trees, names } = {}) {
  const snap = trees || snapshot(ROOT, ws, st, names);
  const data = read(ROOT);
  const at = new Date().toISOString();
  for (const [name, tree] of Object.entries(snap)) {
    const list = (data.records[name] || []).filter((x) => x.tree !== tree);
    list.push({ tree, at, by: by || '' });
    data.records[name] = list.slice(-KEEP);
  }
  write(ROOT, data);
  return snap;
}

/** 한 번만 쓰는 생략 표시 */
function addSkip(ROOT, { reason, repo }) {
  const data = read(ROOT);
  data.skips = [...(data.skips || []).filter((s) => Date.now() - new Date(s.at).getTime() < SKIP_TTL), { reason, repo: repo || null, at: new Date().toISOString() }];
  write(ROOT, data);
}
function takeSkip(ROOT, repoName) {
  const data = read(ROOT);
  const live = (data.skips || []).filter((s) => Date.now() - new Date(s.at).getTime() < SKIP_TTL);
  const i = live.findIndex((s) => !s.repo || s.repo === repoName);
  if (i < 0) return null;
  const [used] = live.splice(i, 1);
  data.skips = live;
  write(ROOT, data);
  return used;
}

/**
 * 그 repo 의 리뷰 안 된 줄 수. kind: 'commit' = 작업 폴더 전체 · 'push' = HEAD.
 * → { repo, tree, unreviewed, last } 또는 null (볼 수 없음: 비교할 기준이 없다)
 */
function measure(ROOT, repo, st, kind) {
  const tree = kind === 'push' ? headTree(repo.dir) : workTree(repo.dir);
  if (!tree) return null;
  const recs = read(ROOT).records[repo.name] || [];
  const pushed = pushedTree(repo.dir);
  const counts = [...recs.map((x) => (x.tree === tree ? 0 : lines(repo.dir, x.tree, tree, st.paths, true))), pushed ? (pushed === tree ? 0 : lines(repo.dir, pushed, tree, st.paths)) : null].filter((n) => n != null);
  if (!counts.length) return null;
  return { repo: repo.name, tree, unreviewed: Math.min(...counts), last: recs[recs.length - 1] || null };
}

/** 같은 상태에 경고를 되풀이하지 않는다 (commit 뒤 바로 push) */
function warnedAlready(ROOT, repoName, tree) { return read(ROOT).warned[repoName] === tree; }
function markWarned(ROOT, repoName, tree) { const d = read(ROOT); d.warned[repoName] = tree; write(ROOT, d); }

/** 리뷰 전 검사: 지시서에 「검사: <명령> 통과」(검사가 없는 변경은 「검사: 없음 (사유)」) 줄이 있나 */
const hasCheckLine = (text) => /^[\s>*-]*\**검사\**\s*[:：]\s*\S/m.test(String(text || ''));
const CHECK_MESSAGE = '지시서에 검사 줄이 없습니다. 둘 중 하나를 넣습니다: 「검사: <명령> 통과」(빌드 · 테스트 · 회귀 검사를 돌려 통과시킨 뒤) 또는 「검사: 없음 (사유)」(문서만 바꾼 변경 등 검사할 것이 없을 때). 리뷰어가 회귀를 머리로 판정하지 않게 하려는 것입니다. 순서: 구현 → 해당 검사 → 리뷰 → 수정 → 해당 검사. 수준 바꾸기: kedovi team-mode enforce check off|warn|block';
/**
 * 화면 정본 대조: 리뷰 지시서가 정본(프로토타입 · 화면설계서)이 있는 화면을 다루는데 「화면 정본 대조」 블록
 * (정본 경로 · 요소 체크리스트 · 비교 스크린샷 · 블로커 기준, kedovi screens review <화면 ID>)이 없으면 그 화면 ID 들. screens 팩이 없으면 []
 */
function screenGapIds(ROOT, text) {
  const t = String(text || '');
  let ws; let S;
  try { ws = require('./workspace').load(ROOT); } catch { return []; }
  if (!(ws.packs || []).includes('screens')) return [];
  try { S = require(path.join(ws.root, 'packs', 'screens', 'bin', 'screens-inventory.js')); } catch { return []; }
  const has = (id) => new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(t);
  const done = (id) => new RegExp(`화면 정본 대조:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(t);
  return S.screenIds(ws).filter((id) => has(id) && !done(id)).filter((id) => { try { return S.canonOf(ws, id).verdict !== 'none'; } catch { return true; } });
}
/** 지시서에 넣을 화면 정본 대조 블록 (해당 없으면 ''). mode: review(리뷰 기준) · implement(구현 기준) */
function screenBlock(ROOT, ids, mode = 'review') {
  if (!ids.length) return '';
  try { const ws = require('./workspace').load(ROOT); return require(path.join(ws.root, 'packs', 'screens', 'bin', 'screens-inventory.js')).reviewBlock(ws, ids, mode); } catch { return ''; }
}
/** 알릴 말 (해당 없으면 ''). 막지 않는다 (screens 팩 「프로토타입대로 구현」). 구현 역할이면 구현 기준 블록을 넣으라고 한다 */
function prototypeGap(ROOT, text, mode = 'review') {
  const ids = screenGapIds(ROOT, text);
  if (!ids.length) return '';
  return mode === 'implement'
    ? `지시서가 정본이 있는 화면(${ids.slice(0, 4).join(' · ')})을 다루는데 화면 정본 블록이 없습니다. kedovi screens review ${ids.slice(0, 4).join(' ')} --implement 의 출력(정본 경로 · 프로토타입 소스 · 요소 체크리스트 · 「정본대로 만들고, 계약 · 원천 때문에 못 하면 멈추고 알린다」)을 지시서에 넣습니다`
    : `지시서가 정본이 있는 화면(${ids.slice(0, 4).join(' · ')})을 다루는데 화면 정본 대조 블록이 없습니다. kedovi screens review ${ids.slice(0, 4).join(' ')} 의 출력(정본 경로 · 요소 체크리스트 · 비교 스크린샷 · 「정본에 있는데 구현에 없는 요소 = 블로커」)을 지시서에 넣습니다`;
}
/** 수준 (off | warn | block, 기본 block) */
function checkLevel(ROOT) {
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); return (kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).enforce || {}).checkBeforeReview || 'block'; } catch { return 'block'; }
}

module.exports = { hasCheckLine, CHECK_MESSAGE, prototypeGap, screenGapIds, screenBlock, checkLevel, when, REVIEW_ROLE, settings, scope, repoOf, workTree, headTree, pushedTree, lines, snapshot, record, addSkip, takeSkip, measure, warnedAlready, markWarned, read };
