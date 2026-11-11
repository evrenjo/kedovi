#!/usr/bin/env node
// 죽은 참조 검사 — 문서가 백틱·링크로 가리키는 경로가 실제로 있는지 본다. 실행: node packs/core/bin/check-refs.js [--fail] [--json]
/*
 * 검사 대상: AGENTS.md · CLAUDE.md · README.md · packs/**\/*.md · .agents/rules/*.md · docs/**\/*.md
 * 제외: handoffs/ (지난 사실의 기록) · backup/ · node_modules · 코드 펜스(```) 안
 *
 * 경로로 보는 것
 *   - 백틱 안 토큰 중 `/` 를 포함하고 확장자로 끝나는 것 (`packs/core/bin/x.js`, `docs/a.md`)
 *   - 마크다운 링크 ](상대경로)
 * 건너뛰는 것
 *   - 자리표시자 `{} <> * … $` 가 든 것, URL, 절대경로·홈(~) 경로, 공백이 든 것
 *   - `scripts/` (개인 1회용, git 미공유라 남의 PC 에 없는 게 정상)
 *   - 아직 clone 하지 않은 repo 안의 경로 (repos/<이름> · repos/<그룹>/<이름> 이 아직 없을 때)
 *   - .gitignore 에 적힌 경로 (`.agents/local.md` 처럼 PC 마다 있을 수도 없을 수도 있는 개인 파일)
 *   - `refs:ignore` 가 적힌 줄 (일부러 없는 경로를 적는 자리)
 *   - `<!-- refs:ignore-start -->` ~ `<!-- refs:ignore-end -->` 구역, `<!-- refs:ignore-file -->` 가 있는 문서 전체 (설치 서버 경로처럼 워크스페이스 파일이 아닌 경로를 설명하는 자리)
 *   - 외부 주소로 가는 링크의 글자 ([`docs/x.md`](https://…) 의 `docs/x.md`)
 * 기준 경로: 워크스페이스 루트 → 그 문서 폴더 → 그 문서가 속한 팩 폴더 (하나라도 있으면 산 참조)
 *
 * --fail  죽은 참조가 있으면 exit 1 (pre-commit 이 쓴다). 없으면 기본적으로 exit 0
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'backup', '.backup', 'handoffs']);
const PLACEHOLDER = /[{}<>*…$]/;
const PATH_TOKEN = /^[A-Za-z0-9_.][A-Za-z0-9._/@+-]*\/[A-Za-z0-9._@+-]+\.[A-Za-z0-9]{1,10}$/;

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.name.endsWith('.md')) out.push(path.join(dir, e.name));
  }
  return out;
}

function findRoot(start) {
  let dir = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(dir, 'workspace.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start || process.cwd());
    dir = up;
  }
}

/** 검사할 문서 목록 (절대경로) */
function targetDocs(root) {
  const docs = ['AGENTS.md', 'CLAUDE.md', 'README.md'].map((f) => path.join(root, f)).filter((f) => fs.existsSync(f));
  docs.push(...walk(path.join(root, 'packs')), ...walk(path.join(root, '.agents', 'rules')), ...walk(path.join(root, 'docs')));
  return docs;
}

/** 문서가 속한 팩 폴더 — packs/<p>/… 이거나 .agents/rules/<p>--x.md */
function packDirOf(root, doc) {
  const rel = path.relative(root, doc).split(path.sep);
  if (rel[0] === 'packs' && rel[1]) return path.join(root, 'packs', rel[1]);
  if (rel[0] === '.agents' && rel[1] === 'rules' && rel[2] && rel[2].includes('--')) return path.join(root, 'packs', rel[2].split('--')[0]);
  return null;
}

/** .gitignore 에 적힌 경로(개인 지침 등 PC 마다 있을 수도 없을 수도 있는 파일) — 참조해도 죽은 참조로 보지 않는다 */
function ignoredPaths(root) {
  try {
    return fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!') && !/[*?[]/.test(l)).map((l) => l.replace(/^\//, '').replace(/\/$/, ''));
  } catch { return []; }
}

function repoList(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'workspace.json'), 'utf8')).repos || []; } catch { return []; }
}
const repoNames = (root) => repoList(root).map((r) => r.name);
/** repo 폴더 (repos/<이름> · repos/<그룹>/<이름>). packs/core/lib/workspace.js repoRel 과 같은 규칙 */
const repoRels = (root) => repoList(root).map((r) => ['repos', ...(r.group ? [r.group] : []), r.name].join('/'));

/** 한 줄에서 경로 후보를 뽑는다 */
function candidates(line) {
  const out = [];
  line = line.replace(/\[((?:[^\]\\]|\\.)*)\]\((?:[a-z][a-z0-9+.-]*:|\/\/)[^)]*\)/gi, ' '); // 외부 주소 링크는 글자까지 뺀다 (글자는 그 주소의 경로)
  for (const m of line.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim().replace(/^\.\//, '').replace(/[:#].*$/, '');
    if (PATH_TOKEN.test(t)) out.push(t);
  }
  for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
    const t = m[1].replace(/^\.\//, '').replace(/#.*$/, '');
    if (t && !/^[a-z]+:/i.test(t) && /\.[A-Za-z0-9]{1,10}$/.test(t)) out.push(t);
  }
  return out;
}

/** 죽은 참조 목록 [{ file, line, ref }] */
function findDeadRefs(root) {
  root = root || findRoot();
  const repos = repoNames(root);
  const rels = repoRels(root);
  const ignored = ignoredPaths(root);
  const dead = [];
  const okCache = new Set();
  for (const doc of targetDocs(root)) {
    const docRel = path.relative(root, doc).split(path.sep).join('/');
    const packDir = packDirOf(root, doc);
    const text = fs.readFileSync(doc, 'utf8');
    if (/<!--\s*refs:ignore-file\s*-->/.test(text)) continue;
    let fence = false;
    let skip = false;
    text.split('\n').forEach((line, i) => {
      if (/<!--\s*refs:ignore-start\s*-->/.test(line)) { skip = true; return; }
      if (/<!--\s*refs:ignore-end\s*-->/.test(line)) { skip = false; return; }
      if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
      if (skip || fence || line.includes('refs:ignore')) return;
      for (const ref of new Set(candidates(line))) {
        if (PLACEHOLDER.test(ref) || ref.startsWith('/') || ref.startsWith('~') || /\s/.test(ref)) continue;
        if (/(^|\/)scripts\//.test(ref) || /(^|\/)handoffs\//.test(ref)) continue;
        if (ignored.some((g) => ref === g || ref.startsWith(`${g}/`))) continue; // gitignore 대상 (개인 파일)
        const parts = ref.split('/');
        if (repos.includes(parts[0]) && !fs.existsSync(path.join(root, parts[0]))) continue; // 아직 clone 안 한 repo (옛 배치)
        const repoRel = rels.find((x) => ref === x || ref.startsWith(`${x}/`));
        if (repoRel && !fs.existsSync(path.join(root, repoRel))) continue; // 아직 clone 안 한 repo (repos/<이름> · repos/<그룹>/<이름>)
        // 생성 룰 경로(.agents/rules/<팩>--<파일>) — 그 팩을 안 쓰는 워크스페이스에는 생성되지 않는다. 원본이 있으면 산 참조
        const gen = ref.match(/^\.agents\/rules\/([^/]+?)--(.+)$/);
        if (gen && fs.existsSync(path.join(root, 'packs', gen[1], 'rules', gen[2].replace(/--/g, '/')))) continue;
        const key = `${path.dirname(doc)}|${ref}`;
        if (okCache.has(key)) continue;
        const bases = [root, path.dirname(doc), packDir].filter(Boolean);
        if (bases.some((b) => fs.existsSync(path.resolve(b, ref)))) { okCache.add(key); continue; }
        dead.push({ file: docRel, line: i + 1, ref });
      }
    });
  }
  return dead;
}

module.exports = { findDeadRefs, targetDocs };

if (require.main === module) {
  const args = process.argv.slice(2);
  const root = findRoot();
  const dead = findDeadRefs(root);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(dead, null, 2) + '\n');
  } else if (!dead.length) {
    console.log(`✔ 죽은 참조 0건 (문서 ${targetDocs(root).length}개)`);
  } else {
    console.log(`✖ 죽은 참조 ${dead.length}건: 가리키는 대상이 없다`);
    for (const d of dead.slice(0, 50)) console.log(`  ${d.file}:${d.line}  →  \`${d.ref}\``);
    if (dead.length > 50) console.log(`  … 외 ${dead.length - 50}건`);
    console.log('  파일을 옮겼다면: node packs/core/bin/rename-ref.js <old> <new> --apply');
    console.log('  일부러 없는 경로를 적는 자리라면: 자리표시자(<…>)를 넣거나 그 줄에 refs:ignore 주석');
    console.log('  설치 서버 경로처럼 워크스페이스 파일이 아닌 경로를 설명하는 구역이면: <!-- refs:ignore-start --> … <!-- refs:ignore-end -->, 문서 전체면 <!-- refs:ignore-file -->');
  }
  process.exit(args.includes('--fail') && dead.length ? 1 : 0);
}
