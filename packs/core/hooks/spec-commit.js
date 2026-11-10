#!/usr/bin/env node
// PreToolUse(Bash) 훅 (Claude Code): 코드 repo 에서 git commit 하기 전에 새 진입 파일 중 기획 ID(@spec) 가 없는 것 · 화면 진입 파일(@spec SCR-…)이 바뀌었는데 정본 요소 체크리스트 판정이 없는 것을 알린다. 막지 않는다. 항상 exit 0
/*
 * 계산은 docs-site.js trace --new (커밋 안 한 파일 + push 안 한 커밋의 진입 파일). 기획 repo 가 없거나 vars.docs.traceOnCommit 이 off 면 조용하다.
 * 화면 이름 대조: backend.layout = component-web 이고 vars.backend.viewsOnCommit 이 off 가 아니면, 화면 폴더(views · pages)가 바뀐 커밋에 kedovi views check 의 어긋남을 알린다 (기획 repo 없어도).
 * 화면 체크리스트: screens 팩이 켜져 있고 vars.screens.checklistOnCommit 이 off 가 아니면, 바뀐 파일 머리 30줄의 @spec 화면 ID 마다 handoffs/<사람>/screens/<화면 ID>.md 를 본다.
 * 명령 문자열에서 git commit 과 폴더(cd <폴더> && · git -C <폴더>)를 찾는다 (review-gate.js 와 같은 방식). 알아보지 못하면 조용히 통과한다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { run, readInput, note, root } = require('../lib/hook');

const GIT = /(?:^|[;&|(]\s*)(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*git((?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+)|\s+-c\s+\S+|\s+--(?:no-pager|git-dir|work-tree)(?:=\S+)?)*)\s+commit\b([^;&|]*)/;
const unquote = (s) => String(s || '').replace(/^["']|["']$/g, '');

run(() => {
  const input = readInput();
  if (String(input.tool_name || '') !== 'Bash') return;
  const cmd = String((input.tool_input || {}).command || '');
  const m = cmd.match(GIT);
  if (!m || /\s--dry-run\b|\s--help\b|\s-h\b/.test(m[2])) return;
  const ROOT = root();
  const ws = require('../lib/workspace').load(ROOT);
  const hasDocs = ws.repos.some((r) => r.kind === 'docs');
  let dir = input.cwd || ROOT;
  const cds = [...cmd.slice(0, m.index + 1).matchAll(/(?:^|[;&|(]\s*)cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)];
  if (cds.length) dir = path.resolve(dir, unquote(cds[cds.length - 1][1]));
  const c = m[1].match(/-C\s+("[^"]+"|'[^']+'|\S+)/);
  if (c) dir = path.resolve(dir, unquote(c[1]));
  const repo = ws.repos.find((r) => r.kind === 'code' && (path.resolve(dir) + path.sep).startsWith(path.resolve(r.dir) + path.sep));
  if (!repo) return;
  const notes = [];
  if (hasDocs && String(((ws.vars || {}).docs || {}).traceOnCommit || 'warn') !== 'off') {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'packs', 'core', 'bin', 'docs-site.js'), 'trace', '--new'], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
    const out = String(r.stdout || '');
    const files = /기획 ID 가 없는 새 진입 파일/.test(out) ? out.split('\n').map((l) => l.trim()).filter((l) => l.startsWith(`${repo.name}/`)) : [];
    if (files.length) notes.push(`⚠ 기획 ID(@spec) 가 없는 새 진입 파일 ${files.length}개: ${files.slice(0, 8).join(', ')}${files.length > 8 ? ` 외 ${files.length - 8}개` : ''}. 커밋 전에 머리 주석에 // @spec <기능 ID> 를 달거나, 기획에 없는 기능이면 사용자에게 확인한다 (끄기: vars.docs.traceOnCommit off)`);
  }
  const screen = hasDocs ? screenChecklistNote(ws, repo) : '';
  if (screen) notes.push(screen);
  const views = viewsNote(ws, repo);
  if (views) notes.push(views);
  if (notes.length) note(notes.join('\n'));
});

/** component-web: 바뀐 파일이 화면 폴더(views)에 있고 프론트 · 백엔드 화면 이름이 어긋나면 알릴 말 (backend 팩 kedovi views check) */
function viewsNote(ws, repo) {
  const v = ws.vars || {};
  if (((v.backend || {}).layout) !== 'component-web' || ((v.backend || {}).viewsOnCommit || 'warn') === 'off') return '';
  const st = spawnSync('git', ['-C', repo.dir, 'status', '--porcelain', '-uall'], { encoding: 'utf8', timeout: 8000 });
  if (!String(st.stdout || '').split('\n').some((l) => /(^|\/)(views|pages)\//.test(l.slice(3)))) return '';
  let V;
  try { V = require(path.join(ws.root, 'packs', 'backend', 'bin', 'check-views.js')); } catch { return ''; }
  const r = V.compare(ws);
  if (!r.frontRoots.length || !r.backRoots.length) return '';
  const odd = [...r.onlyFront.map((x) => `프론트에만 ${x.rel}`), ...r.onlyBack.map((x) => `백엔드에만 ${x.at}`)];
  if (!odd.length) return '';
  return `⚠ 화면 이름이 어긋납니다 (component-web): ${odd.slice(0, 6).join(' · ')}${odd.length > 6 ? ` 외 ${odd.length - 6}개` : ''}. 프론트 화면 폴더와 백엔드 web/views/<화면> 이름을 맞추거나 vars.backend.viewsIgnore 에 넣는다 (kedovi views check, 끄기: vars.backend.viewsOnCommit off)`;
}

/** 바뀐 화면 진입 파일(@spec 화면 ID)에 정본 요소 체크리스트 판정이 없으면 알릴 말 */
function screenChecklistNote(ws, repo) {
  if (!(ws.packs || []).includes('screens')) return '';
  if (String(((ws.vars || {}).screens || {}).checklistOnCommit || 'warn') === 'off') return '';
  let S;
  try { S = require(path.join(ws.root, 'packs', 'screens', 'bin', 'screens-inventory.js')); } catch { return ''; }
  const st = spawnSync('git', ['-C', repo.dir, 'status', '--porcelain', '-uall'], { encoding: 'utf8', timeout: 8000 });
  const changed = String(st.stdout || '').split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));
  if (!changed.length) return '';
  const known = new Set(S.screenIds(ws));
  if (!known.size) return '';
  const ids = new Set();
  for (const f of changed.slice(0, 400)) {
    let head = '';
    try { head = fs.readFileSync(path.join(repo.dir, f), 'utf8').split('\n').slice(0, 30).join('\n'); } catch { continue; }
    for (const mm of head.matchAll(/@spec\s+([^\n]*)/g)) for (const id of mm[1].split(/[^A-Za-z0-9_-]+/)) if (known.has(id)) ids.add(id);
  }
  const gaps = [];
  for (const id of ids) {
    const f = S.findChecklist(ws, id);
    if (!f) { gaps.push(`${id} 체크리스트 없음`); continue; }
    const ck = S.checkChecklist(f);
    const left = ck.missingVerdict.length + ck.badVerdict.length;
    if (ck.empty) gaps.push(`${id} 요소 0개`);
    else if (left) gaps.push(`${id} 판정 없음 ${left}개`);
    else if (!ck.compareDone) gaps.push(`${id} 비교 미실행`);
  }
  if (!gaps.length) return '';
  return `⚠ 화면 진입 파일이 바뀌었는데 정본 요소 판정이 없습니다: ${gaps.join(' · ')}. kedovi screens inventory <화면 ID> 로 체크리스트를 만들고 판정(구현 · 다름 (이유) · 뺌 (결정 ID))을 채운 뒤 kedovi screens checklist <화면 ID>. 작업 중 커밋이면 그대로 진행해도 된다 (끄기: vars.screens.checklistOnCommit off)`;
}
