#!/usr/bin/env node
// 작업 폴더(worktree): 같은 repo 를 여러 작업 리더가 동시에 고칠 때 리더마다 따로 쓰는 폴더. 실행: kedovi worktree <명령> 또는 node packs/core/bin/worktree.js <명령>
/*
 * 명령
 *   add <repo> <단위> [--base <ref>]   .worktrees/<repo>/<단위>/ 에 지금 HEAD(또는 ref)로 작업 폴더를 만든다 (로컬 임시 브랜치 kedovi/<단위>, 원격에 올리지 않는다)
 *   add <repo> <단위> --branch <브랜치> 있는 브랜치를 그대로 받는다 (리뷰 · 그 브랜치에서 커밋할 때. merge 대신 그 폴더에서 커밋 · push 하고 clean 으로 정리)
 *   list [--json]                       이 워크스페이스 repo 의 모든 작업 폴더: 위치 종류(킷 · Claude · 직접 만듦) · 브랜치 · 바뀐 파일 · 상태
 *   merge <repo> <단위>                 작업 폴더의 변경을 repo 본 작업 트리에 커밋하지 않은 변경으로 옮기고(3-way) 작업 폴더 · 임시 브랜치를 지운다.
 *                                       겹쳐서 못 옮기면 아무것도 지우지 않고 겹친 파일을 알린다 (끝 코드 1)
 *   remove <repo> <단위> [--force]      옮기지 않고 지운다 (변경이 있으면 --force 가 있어야)
 *   clean [--dry-run] [--branches] [--now]
 *                                       끝난 작업 폴더를 지운다: 바뀐 파일이 없고 브랜치 내용이 기준 브랜치에 이미 있으며(squash 머지 포함) 한 시간 넘게 손대지 않은 것.
 *                                       킷 임시 브랜치(kedovi/…)도 지운다. 다른 브랜치는 --branches 또는 vars.git.cleanupMerged = true 일 때만.
 *                                       킷 밖(repos/ 안 등)에 직접 만든 작업 폴더 중 진행 중인 것은 .worktrees/<repo>/ 로 옮긴다. 폴더가 사라진 기록은 정리한다
 * 커밋 · push 는 하지 않는다. 옮긴 변경은 평소처럼 사용자가 확인하고 커밋한다 (워크스페이스 커밋 규칙 그대로).
 * 통합 브랜치 직접 운영(branchMode trunk)이어도 쓴다: 임시 브랜치는 이 PC 에만 있고 merge 때 지운다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { load } = require('../lib/workspace');
const W = require('../lib/worktrees');

const DIR = W.KIT_DIR;
const UNIT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BRANCH = (unit) => `kedovi/${unit}`;
const git = W.git;

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }

function repoOf(ws, name) {
  const r = ws.repos.find((x) => x.name === name);
  if (!r) fail(`workspace.json 에 없는 repo 입니다: ${name} (있는 것: ${ws.repos.map((x) => x.name).join(', ') || '없음'})`);
  if (!fs.existsSync(path.join(r.dir, '.git'))) fail(`${name} 이(가) git repo 가 아닙니다: ${r.dir} (kedovi install)`);
  return r;
}

const metaFile = (ws, repo, unit) => path.join(ws.root, DIR, repo, `${unit}.json`);
const wtDir = (ws, repo, unit) => path.join(ws.root, DIR, repo, unit);
const opt = (argv, k) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };

function add(ws, repo, unit, { base, branch: existing } = {}) {
  if (!UNIT.test(unit || '')) fail('단위 이름은 영문 · 숫자 · . _ - (64자까지). 예: FN-012 · order-list');
  const r = repoOf(ws, repo);
  const dir = wtDir(ws, repo, unit);
  if (fs.existsSync(dir)) fail(`이미 있습니다: ${path.relative(ws.root, dir)} (끝났으면 kedovi worktree merge ${repo} ${unit})`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (existing) {
    // 있는 브랜치: 로컬에 없으면 origin/<브랜치> 를 따라가는 로컬 브랜치로
    const local = git(r.dir, ['rev-parse', '--verify', '-q', `refs/heads/${existing}`]).ok;
    const made = local ? git(r.dir, ['worktree', 'add', dir, existing]) : git(r.dir, ['worktree', 'add', '--track', '-b', existing, dir, `origin/${existing}`]);
    if (!made.ok) fail(`worktree 를 만들지 못했습니다: ${made.out}`);
    const head = git(dir, ['rev-parse', 'HEAD']).out;
    fs.writeFileSync(metaFile(ws, repo, unit), `${JSON.stringify({ repo, unit, base: head, branch: existing, own: false, at: new Date().toISOString() }, null, 2)}\n`);
    console.log(`✔ ${path.relative(ws.root, dir)} (${repo} · 브랜치 ${existing} 그대로)`);
    console.log('  이 폴더에서 커밋 · push 한다 (merge 로 옮기지 않는다). 끝나면: kedovi worktree clean');
    return;
  }
  const from = git(r.dir, ['rev-parse', `${base || 'HEAD'}^{commit}`]);
  if (!from.ok) fail(`${repo} 의 ${base || 'HEAD'} 를 읽지 못했습니다: ${from.out}`);
  const branch = base ? base.replace(/^origin\//, '') : git(r.dir, ['rev-parse', '--abbrev-ref', 'HEAD']).out || '';
  const made = git(r.dir, ['worktree', 'add', '-b', BRANCH(unit), dir, from.out]);
  if (!made.ok) fail(`worktree 를 만들지 못했습니다: ${made.out}`);
  fs.writeFileSync(metaFile(ws, repo, unit), `${JSON.stringify({ repo, unit, base: from.out, branch, at: new Date().toISOString() }, null, 2)}\n`);
  console.log(`✔ ${path.relative(ws.root, dir)} (${repo} · ${branch || 'HEAD'} 기준, 임시 브랜치 ${BRANCH(unit)})`);
  console.log('  팀원은 이 폴더 안의 파일만 고친다 (소유 파일 경로를 이 폴더 기준으로 준다). 의존성 설치가 필요한 repo 면 이 폴더에서 설치 명령을 먼저 돌린다.');
  console.log(`  끝나면 메인이: kedovi worktree merge ${repo} ${unit}`);
}

const KIND = { kit: '킷', claude: 'Claude', other: '직접 만듦' };

function list(ws, json) {
  const out = W.scan(ws, { deep: true });
  if (json) return console.log(JSON.stringify(out.map(({ repoDir, ...x }) => x), null, 2));
  if (!out.length) return console.log('작업 폴더(worktree) 없음');
  const age = (t) => { if (!t) return '-'; const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
  console.log('| repo | 위치 | 종류 | 브랜치 | 마지막 손댐 | 상태 |\n|---|---|---|---|---|---|');
  for (const x of out) console.log(`| ${x.repo} | ${x.rel} | ${KIND[x.kind]} | ${x.branch || (x.detached ? '(분리된 HEAD)' : '-')} | ${age(x.activity)} | ${x.missing ? '폴더 없음 (clean 이 기록 정리)' : x.done ? '끝남 (clean 이 지움)' : x.why} |`);
  const stray = out.filter((x) => x.kind === 'other' && !x.missing);
  if (out.some((x) => x.done || x.missing) || stray.length) console.log(`\n정리: kedovi worktree clean${stray.length ? ` (직접 만든 ${stray.length}개 중 진행 중인 것은 ${DIR}/<repo>/ 로 옮긴다)` : ''}`);
}

/** 작업 폴더 · 임시 브랜치 · 기록 지우기 */
function drop(ws, r, unit) {
  const dir = wtDir(ws, r.name, unit);
  const m = readMeta(ws, r.name, unit) || {};
  if (fs.existsSync(dir)) {
    const rm = git(r.dir, ['worktree', 'remove', '--force', dir]);
    if (!rm.ok) fs.rmSync(dir, { recursive: true, force: true });
  }
  git(r.dir, ['worktree', 'prune']);
  if (m.own !== false) git(r.dir, ['branch', '-D', BRANCH(unit)]);
  try { fs.unlinkSync(metaFile(ws, r.name, unit)); } catch { /* 없음 */ }
  W.removeEmptyParents(dir, path.join(ws.root, DIR));
}

function readMeta(ws, repo, unit) {
  try { return JSON.parse(fs.readFileSync(metaFile(ws, repo, unit), 'utf8')); } catch { return null; }
}

function merge(ws, repo, unit) {
  const r = repoOf(ws, repo);
  const m = readMeta(ws, repo, unit);
  const dir = wtDir(ws, repo, unit);
  if (!m || !fs.existsSync(dir)) fail(`작업 폴더가 없습니다: ${DIR}/${repo}/${unit} (kedovi worktree list)`);
  if (m.own === false) fail(`${DIR}/${repo}/${unit} 은 브랜치 ${m.branch} 를 그대로 쓰는 작업 폴더입니다. 그 폴더에서 커밋 · push 하고 끝나면 kedovi worktree clean`);
  // 새 파일까지 담으려고 임시 브랜치에 한 번 커밋한다 (이 PC 에만 있고 곧 지운다. repo 의 커밋 훅은 돌리지 않는다)
  git(dir, ['add', '-A']);
  const staged = git(dir, ['diff', '--cached', '--quiet']);
  if (!staged.ok) {
    const c = git(dir, ['-c', 'user.name=kedovi', '-c', 'user.email=kedovi@localhost', 'commit', '--no-verify', '-q', '-m', `kedovi worktree ${unit}`]);
    if (!c.ok) fail(`작업 폴더 변경을 묶지 못했습니다: ${c.out}`);
  }
  const diff = git(dir, ['diff', '--binary', m.base, 'HEAD']);
  if (!diff.ok) fail(`변경을 읽지 못했습니다: ${diff.out}`);
  if (!diff.out) { drop(ws, r, unit); return console.log(`✔ ${repo} · ${unit}: 바뀐 것이 없어 작업 폴더만 지웠습니다`); }
  const files = git(dir, ['diff', '--name-only', m.base, 'HEAD']).out.split('\n').filter(Boolean);
  const now = git(r.dir, ['rev-parse', '--abbrev-ref', 'HEAD']).out;
  if (m.branch && now && m.branch !== 'HEAD' && now !== m.branch) fail(`${repo} 의 지금 브랜치(${now})가 만들 때(${m.branch})와 다릅니다. ${m.branch} 로 돌아간 뒤 다시 하세요`);
  const ap = require('child_process').spawnSync('git', ['-C', r.dir, 'apply', '--3way', '--binary', '--whitespace=nowarn'], { input: `${diff.out}\n`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (ap.status !== 0) {
    const conflicts = git(r.dir, ['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
    console.error(`✖ ${repo} · ${unit}: 본 작업 트리와 겹쳐 옮기지 못했습니다. 작업 폴더는 그대로 둡니다`);
    if (conflicts.length) console.error(`  충돌 표시가 남은 파일 (본 작업 트리): ${conflicts.join(', ')}. 고친 뒤 git -C ${path.relative(ws.root, r.dir)} add <파일>`);
    console.error(`  git: ${String(ap.stderr || ap.stdout || '').trim().split('\n').slice(0, 6).join(' · ')}`);
    process.exit(1);
  }
  drop(ws, r, unit);
  console.log(`✔ ${repo} · ${unit}: 변경 ${files.length}개 파일을 ${path.relative(ws.root, r.dir) || r.dir} 작업 트리로 옮겼습니다 (커밋 안 함)`);
  for (const f of files.slice(0, 20)) console.log(`  ${f}`);
  if (files.length > 20) console.log(`  … 외 ${files.length - 20}개`);
  console.log('  다음: 통합 검사(빌드 · 테스트)를 돌리고 평소처럼 커밋. 끝난 작업 폴더가 더 있으면 kedovi worktree clean');
}

function remove(ws, repo, unit, force) {
  const r = repoOf(ws, repo);
  const dir = wtDir(ws, repo, unit);
  if (fs.existsSync(dir) && !force) {
    const st = git(dir, ['status', '--porcelain']);
    if (st.ok && st.out) fail(`변경이 남아 있습니다 (${st.out.split('\n').length}개). 옮기려면 kedovi worktree merge ${repo} ${unit}, 버리려면 --force`);
  }
  drop(ws, r, unit);
  console.log(`✔ ${repo} · ${unit}: 작업 폴더를 지웠습니다`);
}

/** 킷 밖 작업 폴더를 .worktrees/<repo>/<이름> 으로 옮긴다 (git worktree move). 반환: 새 경로 또는 오류 */
function adopt(ws, x) {
  const base = path.basename(x.path).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+/, '') || 'wt';
  let unit = base;
  for (let n = 2; fs.existsSync(wtDir(ws, x.repo, unit)) || fs.existsSync(metaFile(ws, x.repo, unit)); n++) unit = `${base}-${n}`;
  const dst = wtDir(ws, x.repo, unit);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const mv = git(x.repoDir, ['worktree', 'move', x.path, dst]);
  if (!mv.ok) return { error: mv.out.split('\n')[0] };
  fs.writeFileSync(metaFile(ws, x.repo, unit), `${JSON.stringify({ repo: x.repo, unit, base: x.base || x.head, branch: x.branch || 'HEAD', own: false, adopted: x.rel, at: new Date().toISOString() }, null, 2)}\n`);
  W.removeEmptyParents(x.path, ws.root);
  return { to: path.relative(ws.root, dst) };
}

function clean(ws, { dry, branches, now: ignoreIdle }) {
  const cleanupMerged = (((ws.vars || {}).git || {}).cleanupMerged) === true;
  const idleMin = ignoreIdle ? 0 : W.IDLE_MIN;
  const list = W.scan(ws, { deep: true, idleMin });
  if (!list.length) return console.log('작업 폴더(worktree) 없음');
  const rows = [];
  const pruned = new Set();
  for (const x of list) {
    if (x.missing) {
      if (!dry && !pruned.has(x.repoDir)) { git(x.repoDir, ['worktree', 'prune']); pruned.add(x.repoDir); }
      rows.push([x, dry ? '기록 정리 예정 (폴더 없음)' : '기록 정리 (폴더 없음)']);
      continue;
    }
    if (x.done) {
      const kitUnit = x.kind === 'kit' ? path.basename(x.path) : null;
      const temp = x.branch && x.branch.startsWith('kedovi/');
      const delBranch = x.branch && (temp || ((branches || cleanupMerged) && x.landed));
      if (dry) { rows.push([x, `지울 예정${delBranch ? ` (브랜치 ${x.branch} 도)` : ''}`]); continue; }
      const rm = git(x.repoDir, ['worktree', 'remove', x.path]);
      if (!rm.ok) { rows.push([x, `못 지움: ${rm.out.split('\n')[0]}`]); continue; }
      let note = '지움';
      if (delBranch) note += git(x.repoDir, ['branch', '-D', x.branch]).ok ? ` · 브랜치 ${x.branch} 지움` : ` · 브랜치 ${x.branch} 남김`;
      if (kitUnit) { try { fs.unlinkSync(metaFile(ws, x.repo, kitUnit)); } catch { /* 없음 */ } }
      W.removeEmptyParents(x.path, x.kind === 'kit' ? path.join(ws.root, DIR) : ws.root);
      rows.push([x, note]);
      continue;
    }
    // 진행 중: 킷 밖에 직접 만든 것은 손대지 않은 지 한 시간이 지났으면 .worktrees/ 로 옮긴다
    const idle = !x.activity || Date.now() - x.activity >= idleMin * 60000;
    if (x.kind === 'other' && idle && !x.locked) {
      if (dry) { rows.push([x, `남김 (${x.why}) · ${DIR}/${x.repo}/ 로 옮길 예정`]); continue; }
      const a = adopt(ws, x);
      rows.push([x, a.error ? `남김 (${x.why}) · 옮기지 못함: ${a.error}` : `남김 (${x.why}) · ${a.to} 로 옮김`]);
      continue;
    }
    rows.push([x, `남김 (${x.why})`]);
  }
  // 폴더 없는 킷 기록
  const metaRoot = path.join(ws.root, DIR);
  if (!dry && fs.existsSync(metaRoot)) {
    for (const repo of fs.readdirSync(metaRoot)) {
      const rd = path.join(metaRoot, repo);
      if (!fs.statSync(rd).isDirectory()) continue;
      for (const f of fs.readdirSync(rd).filter((n) => n.endsWith('.json'))) if (!fs.existsSync(path.join(rd, f.slice(0, -5)))) { try { fs.unlinkSync(path.join(rd, f)); } catch { /* 없음 */ } }
      try { if (!fs.readdirSync(rd).length) fs.rmdirSync(rd); } catch { /* 비어 있지 않음 */ }
    }
  }
  console.log(`작업 폴더 정리${dry ? ' (미리 보기)' : ''}\n`);
  console.log('| repo | 위치 | 종류 | 브랜치 | 결과 |\n|---|---|---|---|---|');
  for (const [x, note] of rows) console.log(`| ${x.repo} | ${x.rel} | ${KIND[x.kind]} | ${x.branch || '-'} | ${note} |`);
  const kept = rows.filter(([, n]) => n.startsWith('남김'));
  if (kept.length) console.log(`\n남긴 것 ${kept.length}개: 바뀐 파일은 merge(킷 작업 폴더) 또는 그 폴더에서 커밋, 머지 안 된 커밋은 MR 머지 뒤 다시 clean. 방금 손댄 것까지 보려면 --now`);
  if (!branches && !cleanupMerged && rows.some(([x]) => x.done && x.branch && !x.branch.startsWith('kedovi/'))) console.log('머지된 작업 브랜치는 남겼습니다 (vars.git.cleanupMerged = false). 함께 지우려면 --branches');
}

function main(argv) {
  const vals = [];
  for (let i = 0; i < argv.length; i++) { if (['--base', '--branch'].includes(argv[i])) { i++; continue; } if (!argv[i].startsWith('--')) vals.push(argv[i]); }
  const [cmd, repo, unit] = vals;
  const ws = load();
  if (cmd === 'add') return add(ws, repo, unit, { base: opt(argv, 'base'), branch: opt(argv, 'branch') });
  if (cmd === 'merge') return merge(ws, repo, unit);
  if (cmd === 'remove') return remove(ws, repo, unit, argv.includes('--force'));
  if (cmd === 'clean') return clean(ws, { dry: argv.includes('--dry-run'), branches: argv.includes('--branches'), now: argv.includes('--now') });
  if (!cmd || cmd === 'list') return list(ws, argv.includes('--json'));
  fail('사용법: kedovi worktree add <repo> <단위> [--base <ref> | --branch <브랜치>] · merge|remove <repo> <단위> · list [--json] · clean [--dry-run] [--branches] [--now]');
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { DIR, BRANCH };
