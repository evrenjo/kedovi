#!/usr/bin/env node
// 검증 2단: 작업마다는 바뀐 영역 시험, 전체 실제 스택 시험은 릴리스 직전 한 번. 실행: kedovi verify <명령>
/*
 * 명령
 *   areas [--repo R] [--dir 작업 폴더] [--base 기준] [--run]   바뀐 파일 → 돌릴 영역 시험(vars.verify.areaMap). --run 이면 차례로 돌린다
 *   full [--repo R] [--dir 작업 폴더] [--cmd "명령"]            전체 시험(vars.verify.fullCmd)을 무거운 시험 줄(kedovi heavy)에서 돌리고 통과면 커밋을 기록
 *   mark --repo R [--sha 커밋] [--by "어디서"]                  다른 곳(CI 등)에서 통과한 전체 시험을 기록
 *   status [--repo R]                                          설정 · repo 마다 전체 시험 기록이 머리 커밋과 같은지
 * vars.verify.fullSuite: release(기본) = 전체는 릴리스 직전 한 번 · per-item = 작업마다. repo 마다 다르면 workspace.json repos[].verify
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const V = require('../lib/verify');
const { runQueued } = require('./heavy');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (k) => argv.includes(`--${k}`);
const die = (m, code = 2) => { console.error(`✖ ${m}`); process.exit(code); };
const ws = require('../lib/workspace').load(ROOT);
const code = (ws.repos || []).filter((r) => (r.kind || 'code') === 'code');

function target() {
  const name = opt('repo');
  const r = name ? (ws.repos || []).find((x) => x.name === name) : code.length === 1 ? code[0] : null;
  if (!r && !opt('dir')) die(name ? `repo '${name}' 가 workspace.json 에 없습니다` : `--repo 를 주세요: ${code.map((x) => x.name).join(' · ')}`);
  const dir = opt('dir') ? path.resolve(opt('dir')) : r.dir;
  if (!fs.existsSync(dir)) die(`${dir} 가 없습니다 (kedovi install 로 clone)`);
  return { r, name: r ? r.name : path.basename(dir), dir };
}

function cmdAreas() {
  const t = target();
  const s = V.settings(ws, t.r);
  const ch = V.changed(t.dir, opt('base'));
  const p = V.plan(ch.files, s.areas);
  console.log(`바뀐 파일 ${ch.files.length}개 (${t.name}, 기준 ${ch.base || '없음'}) · 전체 시험: ${s.fullSuite === 'release' ? '릴리스 직전 한 번' : '작업마다'}`);
  if (!s.areas.length) console.log('영역 시험 대응표가 없습니다 (vars.verify.areaMap: {"경로 글롭": "명령"}). 프로젝트가 정한 바뀐 범위 시험을 돌린다');
  for (const c of p.cmds) console.log(`- ${c.cmd}  ← ${c.globs.join(' · ')} (${c.files.length}개)`);
  if (p.unmatched.length && s.areas.length) console.log(`대응표에 없는 파일 ${p.unmatched.length}개: ${p.unmatched.slice(0, 8).join(' · ')}${p.unmatched.length > 8 ? ' …' : ''} (단위 시험 · 프로젝트 기본 검사로)`);
  if (s.fullSuite === 'per-item' && s.fullCmd) console.log(`+ 전체 시험 (작업마다): kedovi verify full --repo ${t.name}`);
  if (!has('run')) return 0;
  for (const c of p.cmds) {
    console.log(`\n▶ ${c.cmd}`);
    const r = spawnSync(c.cmd, { cwd: t.dir, stdio: 'inherit', shell: true });
    if (r.status !== 0) { console.log(`✖ 실패: ${c.cmd} (끝 코드 ${r.status})`); return 1; }
  }
  console.log(`✔ 영역 시험 ${p.cmds.length}개 통과`);
  return 0;
}

async function cmdFull() {
  const t = target();
  const s = V.settings(ws, t.r);
  const cmd = opt('cmd') || s.fullCmd;
  if (!cmd) die('전체 시험 명령이 없습니다: --cmd "<명령>" 또는 vars.verify.fullCmd (repo 마다 다르면 repos[].verify.fullCmd)');
  const dirty = execFileSync('git', ['-C', t.dir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
  const sha = execFileSync('git', ['-C', t.dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['-C', t.dir, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  const t0 = Date.now();
  const c = await runQueued({ name: `full:${t.name}`, by: opt('by'), dir: t.dir, cmd, shell: true });
  if (c !== 0) return c;
  if (dirty) { console.log('⚠ 커밋 안 한 변경이 있어 통과 기록을 남기지 않았습니다 (기록은 커밋 기준). 커밋한 뒤 다시'); return 0; }
  V.record(ROOT, t.name, { sha, tree, cmd, ms: Date.now() - t0, by: 'kedovi verify full' });
  console.log(`✔ 전체 시험 통과 기록: ${t.name} ${sha.slice(0, 8)}`);
  return 0;
}

function cmdMark() {
  const t = target();
  const sha = execFileSync('git', ['-C', t.dir, 'rev-parse', opt('sha') || 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['-C', t.dir, 'rev-parse', `${sha}^{tree}`], { encoding: 'utf8' }).trim();
  V.record(ROOT, t.name, { sha, tree, cmd: null, by: opt('by') || '직접 기록' });
  console.log(`✔ 전체 시험 통과 기록: ${t.name} ${sha.slice(0, 8)} (${opt('by') || '직접 기록'})`);
  return 0;
}

function cmdStatus() {
  const list = opt('repo') ? [target()] : code.filter((r) => fs.existsSync(r.dir)).map((r) => ({ r, name: r.name, dir: r.dir }));
  for (const t of list) {
    const s = V.settings(ws, t.r);
    console.log(`${t.name}: 전체 시험 ${s.fullSuite === 'release' ? '릴리스 직전 한 번' : '작업마다'}${s.fullCmd ? ` (${s.fullCmd})` : ' (명령 없음: vars.verify.fullCmd)'} · 영역 시험 ${s.areas.length}개`);
    console.log(`  ${V.fullLine(V.fullState(ROOT, t.name, t.dir), t.name)}`);
  }
  if (!list.length) console.log('코드 repo 가 없습니다');
  return 0;
}

async function main() {
  const c = argv[0];
  if (c === 'areas') return cmdAreas();
  if (c === 'full') return cmdFull();
  if (c === 'mark') return cmdMark();
  if (c === 'status') return cmdStatus();
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 9).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  return c ? 2 : 0;
}

main().then((c) => process.exit(c));
