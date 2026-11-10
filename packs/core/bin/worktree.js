#!/usr/bin/env node
// 작업 리더 worktree: 같은 repo 를 여러 작업 리더가 동시에 고칠 때 리더마다 따로 쓰는 작업 폴더. 실행: kedovi worktree <명령> 또는 node packs/core/bin/worktree.js <명령>
/*
 * 명령
 *   add <repo> <단위>       .worktrees/<repo>/<단위>/ 에 지금 브랜치의 HEAD 로 작업 폴더를 만든다 (로컬 임시 브랜치 kedovi/<단위>, 원격에 올리지 않는다)
 *   list [--json]           작업 폴더 목록: repo · 단위 · 바뀐 파일 수 · 만든 시각
 *   merge <repo> <단위>     작업 폴더의 변경을 repo 본 작업 트리에 커밋하지 않은 변경으로 옮기고(3-way) 작업 폴더 · 임시 브랜치를 지운다.
 *                           겹쳐서 못 옮기면 아무것도 지우지 않고 겹친 파일을 알린다 (끝 코드 1)
 *   remove <repo> <단위>    옮기지 않고 지운다 (변경이 있으면 --force 가 있어야)
 * 커밋 · push 는 하지 않는다. 옮긴 변경은 평소처럼 사용자가 확인하고 커밋한다 (워크스페이스 커밋 규칙 그대로).
 * 통합 브랜치 직접 운영(branchMode trunk)이어도 쓴다: 임시 브랜치는 이 PC 에만 있고 merge 때 지운다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { load } = require('../lib/workspace');

const DIR = '.worktrees';
const UNIT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BRANCH = (unit) => `kedovi/${unit}`;

/** git 실행. ok = false 면 out 에 오류 */
function git(cwd, args, input) {
  try {
    return { ok: true, out: execFileSync('git', ['-C', cwd, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim() };
  } catch (e) { return { ok: false, out: String((e.stderr || '') + (e.stdout || '') || e.message).trim() }; }
}

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }

function repoOf(ws, name) {
  const r = ws.repos.find((x) => x.name === name);
  if (!r) fail(`workspace.json 에 없는 repo 입니다: ${name} (있는 것: ${ws.repos.map((x) => x.name).join(', ') || '없음'})`);
  if (!fs.existsSync(path.join(r.dir, '.git'))) fail(`${name} 이(가) git repo 가 아닙니다: ${r.dir} (kedovi install)`);
  return r;
}

const metaFile = (ws, repo, unit) => path.join(ws.root, DIR, repo, `${unit}.json`);
const wtDir = (ws, repo, unit) => path.join(ws.root, DIR, repo, unit);

function add(ws, repo, unit) {
  if (!UNIT.test(unit || '')) fail('단위 이름은 영문 · 숫자 · . _ - (64자까지). 예: FN-012 · order-list');
  const r = repoOf(ws, repo);
  const dir = wtDir(ws, repo, unit);
  if (fs.existsSync(dir)) fail(`이미 있습니다: ${path.relative(ws.root, dir)} (끝났으면 kedovi worktree merge ${repo} ${unit})`);
  const base = git(r.dir, ['rev-parse', 'HEAD']);
  if (!base.ok) fail(`${repo} 의 HEAD 를 읽지 못했습니다: ${base.out}`);
  const branch = git(r.dir, ['rev-parse', '--abbrev-ref', 'HEAD']).out || '';
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const made = git(r.dir, ['worktree', 'add', '-b', BRANCH(unit), dir, base.out]);
  if (!made.ok) fail(`worktree 를 만들지 못했습니다: ${made.out}`);
  fs.writeFileSync(metaFile(ws, repo, unit), `${JSON.stringify({ repo, unit, base: base.out, branch, at: new Date().toISOString() }, null, 2)}\n`);
  console.log(`✔ ${path.relative(ws.root, dir)} (${repo} · ${branch || 'HEAD'} 기준, 임시 브랜치 ${BRANCH(unit)})`);
  console.log('  팀원은 이 폴더 안의 파일만 고친다 (소유 파일 경로를 이 폴더 기준으로 준다). 의존성 설치가 필요한 repo 면 이 폴더에서 설치 명령을 먼저 돌린다.');
  console.log(`  끝나면 메인이: kedovi worktree merge ${repo} ${unit}`);
}

function list(ws, json) {
  const root = path.join(ws.root, DIR);
  const out = [];
  if (fs.existsSync(root)) {
    for (const repo of fs.readdirSync(root)) {
      const rd = path.join(root, repo);
      if (!fs.statSync(rd).isDirectory()) continue;
      for (const f of fs.readdirSync(rd).filter((x) => x.endsWith('.json'))) {
        let m = {};
        try { m = JSON.parse(fs.readFileSync(path.join(rd, f), 'utf8')); } catch { continue; }
        const dir = wtDir(ws, repo, m.unit);
        const st = fs.existsSync(dir) ? git(dir, ['status', '--porcelain']) : { ok: false, out: '' };
        out.push({ repo, unit: m.unit, dir: path.relative(ws.root, dir), branch: m.branch, at: m.at, changed: st.ok ? st.out.split('\n').filter(Boolean).length : null, missing: !fs.existsSync(dir) });
      }
    }
  }
  if (json) return console.log(JSON.stringify(out, null, 2));
  if (!out.length) return console.log('작업 리더 worktree 없음');
  console.log('| repo | 단위 | 기준 브랜치 | 바뀐 파일 | 만든 시각 |\n|---|---|---|---|---|');
  for (const x of out) console.log(`| ${x.repo} | ${x.unit} | ${x.branch || '-'} | ${x.missing ? '폴더 없음' : x.changed} | ${String(x.at || '').slice(0, 16).replace('T', ' ')} |`);
}

/** 작업 폴더 · 임시 브랜치 · 기록 지우기 */
function drop(ws, r, unit) {
  const dir = wtDir(ws, r.name, unit);
  if (fs.existsSync(dir)) {
    const rm = git(r.dir, ['worktree', 'remove', '--force', dir]);
    if (!rm.ok) fs.rmSync(dir, { recursive: true, force: true });
  }
  git(r.dir, ['worktree', 'prune']);
  git(r.dir, ['branch', '-D', BRANCH(unit)]);
  try { fs.unlinkSync(metaFile(ws, r.name, unit)); } catch { /* 없음 */ }
}

function readMeta(ws, repo, unit) {
  try { return JSON.parse(fs.readFileSync(metaFile(ws, repo, unit), 'utf8')); } catch { return null; }
}

function merge(ws, repo, unit) {
  const r = repoOf(ws, repo);
  const m = readMeta(ws, repo, unit);
  const dir = wtDir(ws, repo, unit);
  if (!m || !fs.existsSync(dir)) fail(`작업 폴더가 없습니다: ${DIR}/${repo}/${unit} (kedovi worktree list)`);
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
  const ap = git(r.dir, ['apply', '--3way', '--binary', '--whitespace=nowarn'], `${diff.out}\n`);
  if (!ap.ok) {
    const conflicts = git(r.dir, ['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
    console.error(`✖ ${repo} · ${unit}: 본 작업 트리와 겹쳐 옮기지 못했습니다. 작업 폴더는 그대로 둡니다`);
    if (conflicts.length) console.error(`  충돌 표시가 남은 파일 (본 작업 트리): ${conflicts.join(', ')}. 고친 뒤 git -C ${path.relative(ws.root, r.dir)} add <파일>`);
    console.error(`  git: ${ap.out.split('\n').slice(0, 6).join(' · ')}`);
    process.exit(1);
  }
  drop(ws, r, unit);
  console.log(`✔ ${repo} · ${unit}: 변경 ${files.length}개 파일을 ${path.relative(ws.root, r.dir) || r.dir} 작업 트리로 옮겼습니다 (커밋 안 함)`);
  for (const f of files.slice(0, 20)) console.log(`  ${f}`);
  if (files.length > 20) console.log(`  … 외 ${files.length - 20}개`);
  console.log('  다음: 통합 검사(빌드 · 테스트)를 돌리고 평소처럼 커밋');
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

function main(argv) {
  const [cmd, repo, unit] = argv.filter((a) => !a.startsWith('--'));
  const ws = load();
  if (cmd === 'add') return add(ws, repo, unit);
  if (cmd === 'merge') return merge(ws, repo, unit);
  if (cmd === 'remove') return remove(ws, repo, unit, argv.includes('--force'));
  if (!cmd || cmd === 'list') return list(ws, argv.includes('--json'));
  fail('사용법: kedovi worktree add|merge|remove <repo> <단위> · list [--json]');
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { DIR, BRANCH };
