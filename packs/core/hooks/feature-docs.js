#!/usr/bin/env node
// PreToolUse(Bash) 훅: 기능 문서 · 설계 문서 갱신 알림 (막지 않는다, 항상 exit 0).
//   워크스페이스 커밋에서 docs-site/기능/*.md 의 단계(머리 줄 「단계:」)가 바뀌면 → 그 기능의 설계 · 검증 절과 설계 문서를 같은 커밋에서 맞췄는지
//   코드 repo 커밋이 기능 ID(FN · AC · API · SCR, 커밋할 줄에 든 것)를 건드리면 → 그 기능 문서의 단계 · 절을 갱신할지
//   MR · PR 머지 명령(glab mr merge · gh pr merge · kedovi gitlab merge)이면 → 머지된 기능의 단계를 올릴지
// 끄기: workspace.json vars.docs.featureDocsOnCommit = "off". 사이트는 kedovi docs serve 가 떠 있으면 저절로, 아니면 kedovi docs build.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { run, readInput, note, root } = require('../lib/hook');

const GIT_COMMIT = /(?:^|[;&|(]\s*)(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*git((?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+)|\s+-c\s+\S+|\s+--(?:no-pager|git-dir|work-tree)(?:=\S+)?)*)\s+commit\b([^;&|]*)/;
const MERGE = /(?:^|[;&|(]\s*)(?:glab\s+mr\s+merge|gh\s+pr\s+merge|kedovi\s+gitlab\s+merge|node\s+\S*gitlab-mr\.js\s+merge)\b/;
const unquote = (s) => String(s || '').replace(/^["']|["']$/g, '');
const ID_RE = /(?<![\w-])[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+(?![\w-])/g;

/** 기능 문서들 → [{ md, no, name, stage, ids:Set }] */
function features(src) {
  const SD = require('../lib/sitedb');
  const dir = path.join(src, SD.FEATURE_DIR);
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => /\.md$/i.test(f) && !/^(_|readme\.md$)/i.test(f)); } catch { return []; }
  return names.map((f) => {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const meta = SD.featureMeta(text) || {};
    const p = SD.featureParts(text);
    return { md: `${SD.FEATURE_DIR}/${f}`, no: meta.no || '', name: meta.name || f, stage: meta.stage || '', ids: new Set([...p.fn.map((x) => x.id), ...p.ac.map((x) => x.id), ...p.api, ...p.scr]) };
  });
}
const label = (f) => `${f.no ? `${f.no} ` : ''}${f.name}`;

/** 워크스페이스 커밋: 올리는 기능 문서 중 단계 줄이 바뀐 것 [{ md, from, to }] */
function stageChanges(rootDir) {
  const r = spawnSync('git', ['-C', rootDir, '-c', 'core.quotePath=false', 'diff', '--cached', '-U0', '--no-color', '--', 'docs-site/기능'], { encoding: 'utf8', timeout: 8000 });
  const out = [];
  let file = null, from = null, to = null;
  const flush = () => { if (file && to !== null && from !== to) out.push({ md: file, from, to }); };
  for (const l of String(r.stdout || '').split('\n')) {
    let m;
    if ((m = /^\+\+\+ b\/docs-site\/(.+)$/.exec(l))) { flush(); file = m[1]; from = null; to = null; continue; }
    if ((m = /^([-+])(?!--|\+\+).*단계\s*[:：]\s*([^·\s|]+)/.exec(l))) { if (m[1] === '-') from = m[2]; else to = m[2]; }
  }
  flush();
  return out;
}

/** 코드 repo 커밋: 올리는 줄(staged)에 든 기능 ID */
function stagedIds(dir) {
  const r = spawnSync('git', ['-C', dir, 'diff', '--cached', '-U0', '--no-color'], { encoding: 'utf8', timeout: 8000, maxBuffer: 32 * 1024 * 1024 });
  const ids = new Set();
  for (const l of String(r.stdout || '').split('\n')) if (l.startsWith('+') && !l.startsWith('+++')) for (const id of l.match(ID_RE) || []) ids.add(id);
  return ids;
}

run(() => {
  const input = readInput();
  if (String(input.tool_name || '') !== 'Bash') return;
  const cmd = String((input.tool_input || {}).command || '');
  const ROOT = root();
  const ws = require('../lib/workspace').load(ROOT);
  if (String(((ws.vars || {}).docs || {}).featureDocsOnCommit || 'warn') === 'off') return;
  const src = path.join(ROOT, 'docs-site');
  if (!fs.existsSync(path.join(src, '기능'))) return;
  const after = '사이트: kedovi docs serve 가 떠 있으면 저절로, 아니면 kedovi docs build (끄기: vars.docs.featureDocsOnCommit off)';
  if (MERGE.test(cmd)) {
    note(`기능 문서 갱신 확인: 이 머지로 끝난 기능이 있으면 docs-site/기능/<번호>-<이름>.md 머리 줄의 단계를 올리고(구현 → 검증 → 배포), 검증 절의 결과 칸과 바뀐 설계(API · 화면 · 데이터)를 같은 커밋에 맞춘다. ${after}`);
    return;
  }
  const m = cmd.match(GIT_COMMIT);
  if (!m || /\s--dry-run\b|\s--help\b|\s-h\b/.test(m[2])) return;
  let dir = input.cwd || ROOT;
  const cds = [...cmd.slice(0, m.index + 1).matchAll(/(?:^|[;&|(]\s*)cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)];
  if (cds.length) dir = path.resolve(dir, unquote(cds[cds.length - 1][1]));
  const c = m[1].match(/-C\s+("[^"]+"|'[^']+'|\S+)/);
  if (c) dir = path.resolve(dir, unquote(c[1]));
  const inside = (d) => (path.resolve(dir) + path.sep).startsWith(path.resolve(d) + path.sep);
  const repo = ws.repos.find((r) => r.kind === 'code' && inside(r.dir));
  if (repo) {
    const ids = stagedIds(repo.dir);
    if (!ids.size) return;
    const hit = features(src).map((f) => ({ f, ids: [...ids].filter((x) => f.ids.has(x)) })).filter((x) => x.ids.length);
    if (!hit.length) return;
    note(`기능 문서 갱신 확인: 이 커밋이 기능 ${hit.slice(0, 4).map((x) => `${label(x.f)}(${x.ids.slice(0, 4).join(' · ')}, 단계 ${x.f.stage || '없음'})`).join(' · ')}${hit.length > 4 ? ` 외 ${hit.length - 4}개` : ''} 을 건드린다. 구현이 시작 · 끝났으면 기능 문서 머리 줄의 단계를, API · 화면 · 데이터가 바뀌었으면 설계 절과 설계 문서를 워크스페이스에서 같이 고친다. ${after}`);
    return;
  }
  if (!inside(ROOT) || ws.repos.some((r) => inside(r.dir))) return;
  const changed = stageChanges(ROOT);
  if (!changed.length) return;
  const list = changed.slice(0, 4).map((x) => `${x.md} ${x.from || '없음'} → ${x.to}`).join(' · ');
  note(`기능 단계가 바뀐다: ${list}. 같은 커밋에서 확인: 설계로 가면 설계 절(API · 화면 · 데이터 표)과 설계/ 문서, 검증으로 가면 검증 절의 테스트 · 결과, 배포면 마일스톤 진행. ${after}`);
});
