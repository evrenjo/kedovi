#!/usr/bin/env node
// AI 티 검사: 화면 코드(프로토타입 · 구현)에서 기계로 잡히는 「AI 가 만든 티」 를 파일:줄로 알린다. 경고만 하고 막지 않는다. 실행: kedovi screens slop [경로…]
/*
 * kedovi screens slop [경로…] [--changed] [--json] [--strict]
 *   경로를 안 주면 지금 폴더. --changed 는 git 에서 바뀐 파일만 (커밋 전 점검용). --strict 는 하나라도 있으면 끝 코드 1
 *   줄 끝(또는 윗줄)에 slop-ok 주석이 있으면 그 줄은 건너뛴다 (브랜드라서 일부러 쓴 것 등)
 * 잡는 것: 보라 계열 그라데이션 · 그라데이션 글자 · 색 번짐 그림자 · 흐린 색 덩어리 · 이모지 아이콘 · transition-all · 4px 단위가 아닌 일회성 간격 값
 *   · 800~900 굵기 · 대문자 + 넓은 자간 라벨 · 튀는 반복 애니메이션 · 화면 문구의 느낌표 · 자리 채우기 데이터(Lorem · 123,456)
 * 기준 출처: 언슬롭(heydamir/unslop, CC BY 4.0)의 AI 티 목록을 참고해 기계로 볼 수 있는 것만 골랐다. 방향 · 손질은 사람이나 언슬롭 스킬이 한다.
 * 의존성 없음.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EXT = /\.(html?|css|scss|sass|less|jsx|tsx|vue|svelte|astro|js|ts|mjs)$/i;
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.svelte-kit', '.git', 'vendor', 'storybook-static', 'docs-site', 'shots']);
const MARKUP = /\.(html?|jsx|tsx|vue|svelte|astro)$/i;
const PURPLE = '(?:purple|violet|fuchsia|indigo)';

/** 표시 하나 = { id, label, re, markupOnly?, fix } */
const SIGNS = [
  { id: 'gradient', label: '보라 계열 그라데이션', re: new RegExp(`\\b(?:from|via|to)-${PURPLE}-\\d{2,3}\\b|linear-gradient\\([^)]*(?:${PURPLE}|#(?:8b5cf6|7c3aed|a855f7|9333ea|6366f1|4f46e5|c084fc|a78bfa|d946ef))`, 'i'), fix: '단색 면 + 강조색 한 군데로' },
  { id: 'gradient-text', label: '그라데이션 글자', re: /\bbg-clip-text\b[^\n]*\btext-transparent\b|\btext-transparent\b[^\n]*\bbg-clip-text\b|background-clip:\s*text/i, fix: '글자는 단색 (본문 · 보조 · 흐림 세 단계)' },
  { id: 'glow', label: '색 번짐 그림자 (glow)', re: new RegExp(`\\bshadow-(?:${PURPLE}|pink|blue|cyan|sky|emerald)-\\d{2,3}\\b|box-shadow:[^;]*0\\s+0\\s+\\d{2,}px[^;]*(?:rgba?\\((?!\\s*0\\s*,\\s*0\\s*,\\s*0)|#(?!000))|drop-shadow-\\[[^\\]]*(?:rgba|#)`, 'i'), fix: '그림자는 검정 계열 낮은 불투명도, 대부분은 얇은 선으로' },
  { id: 'blob', label: '흐린 색 덩어리 배경', re: /\bblur-(?:2xl|3xl|\[\d{2,}px\])\b/i, fix: '장식 덩어리를 빼고 제품 화면 · 내용으로' },
  { id: 'emoji', label: '이모지 아이콘 · 장식', re: /[\u{1F300}-\u{1FAFF}\u{2728}\u{26A1}\u{2705}\u{274C}\u{2B50}\u{1F004}-\u{1F0CF}]/u, markupOnly: true, fix: '프로젝트 아이콘 세트(없으면 lucide) 한 벌로, 장식이면 뺀다' },
  { id: 'transition-all', label: 'transition-all', re: /\btransition-all\b|transition:\s*all\b/i, fix: '바뀌는 속성만 (color · opacity · transform)' },
  { id: 'odd-spacing', label: '4px 단위가 아닌 일회성 간격', re: /\b-?(?:m|p|gap|space-[xy]|inset|top|left|right|bottom)[trblxy]?-\[(\d+)px\]/, test: (m) => Number(m[1]) % 4 !== 0, fix: '4px 단위 간격 단계로' },
  { id: 'heavy-weight', label: '800~900 굵기', re: /\bfont-(?:extrabold|black)\b|font-weight:\s*(?:800|900)\b/i, fix: '굵기는 400~600 (제목도 600)' },
  { id: 'shouty-label', label: '대문자 + 넓은 자간 라벨', re: /\buppercase\b[^\n]*\btracking-(?:wide|wider|widest)\b|\btracking-(?:wide|wider|widest)\b[^\n]*\buppercase\b/i, fix: '문장형 대소문자, 자간 기본' },
  { id: 'loop-motion', label: '튀는 반복 애니메이션', re: /\banimate-(?:bounce|ping)\b|animation:[^;]*\b(?:bounce|pulse-glow|float|wiggle)\b[^;]*infinite/i, fix: '반복 움직임을 빼고 짧은 등장 한 번까지만' },
  { id: 'exclaim', label: '화면 문구의 느낌표', re: />[^<>{}\n]*[가-힣A-Za-z][^<>{}\n]*!\s*</, markupOnly: true, fix: '구체적인 문장으로, 느낌표 없이' },
  { id: 'placeholder', label: '자리 채우기 데이터', re: /lorem ipsum|\b123,456\b|John Doe|Acme Inc/i, fix: '실제처럼 보이는 예시 데이터로' },
];

function walk(dir, out = []) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of list) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(p, out); } else if (EXT.test(e.name) && !/\.min\.|\.test\.|\.spec\.|\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** git 에서 바뀐 화면 파일 (커밋 안 한 것 + 새 파일) */
function changedFiles(dir) {
  const top = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0) return [];
  const root = top.stdout.trim();
  const st = spawnSync('git', ['-C', root, 'status', '--porcelain', '-uall'], { encoding: 'utf8' });
  return String(st.stdout || '').split('\n').filter((l) => l && !/^D|^ D/.test(l)).map((l) => path.join(root, l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '')))
    .filter((f) => EXT.test(f) && !f.split(path.sep).some((s) => SKIP_DIR.has(s)) && fs.existsSync(f));
}

/** 한 파일 검사 → [{ file, line, id, label, text, fix }] */
function scanText(text, file = '') {
  const hits = [];
  const lines = String(text).split('\n');
  const markup = MARKUP.test(file);
  lines.forEach((l, i) => {
    if (/slop-ok/.test(l) || (i > 0 && /slop-ok/.test(lines[i - 1]))) return;
    if (l.length > 2000) return; // 압축된 줄
    const code = l.replace(/\/\/.*$|\/\*.*?\*\/|<!--.*?-->/g, '');
    for (const s of SIGNS) {
      if (s.markupOnly && !markup) continue;
      const m = s.test ? [...code.matchAll(new RegExp(s.re.source, `${s.re.flags}g`))].find((x) => s.test(x)) : code.match(s.re);
      if (!m) continue;
      hits.push({ file, line: i + 1, id: s.id, label: s.label, text: l.trim().slice(0, 120), fix: s.fix });
    }
  });
  return hits;
}

function scan(paths, { changed = false } = {}) {
  const files = new Set();
  for (const p of paths.length ? paths : ['.']) {
    const abs = path.resolve(p);
    if (changed) { for (const f of changedFiles(fs.existsSync(abs) && fs.statSync(abs).isDirectory() ? abs : path.dirname(abs))) if ((f + path.sep).startsWith(abs + path.sep) || f === abs || abs === path.resolve('.')) files.add(f); continue; }
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) walk(abs).forEach((f) => files.add(f)); else files.add(abs);
  }
  const hits = [];
  for (const f of files) {
    let text = '';
    try { if (fs.statSync(f).size > 1024 * 1024) continue; text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    hits.push(...scanText(text, f));
  }
  return { files: files.size, hits };
}

/** 한 줄 요약 (커밋 훅 · 지시서용): 종류별 개수 */
function summary(hits) {
  const by = new Map();
  for (const h of hits) by.set(h.label, (by.get(h.label) || 0) + 1);
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ');
}

/** 언슬롭 스킬이 이 PC · 워크스페이스에 있는가 (core 의 suggest.skillInstalled) */
function unslopInstalled(root = process.cwd()) {
  try { return require(path.join(__dirname, '..', '..', 'core', 'lib', 'suggest.js')).skillInstalled('unslop', root); } catch { return false; }
}

const INSTALL = {
  claude: 'claude plugin install unslop --marketplace heydamir/unslop',
  codex: 'git clone --depth 1 https://github.com/heydamir/unslop /tmp/unslop && cp -r /tmp/unslop/skills/unslop ~/.agents/skills/',
};

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 6).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    return;
  }
  const paths = argv.filter((x) => !x.startsWith('--'));
  const r = scan(paths, { changed: argv.includes('--changed') });
  if (argv.includes('--json')) { console.log(JSON.stringify({ ...r, unslop: unslopInstalled() }, null, 2)); return; }
  if (!r.hits.length) { console.log(`✔ AI 티 표시 없음 (화면 파일 ${r.files}개)`); return; }
  console.log(`⚠ AI 티 표시 ${r.hits.length}개 (화면 파일 ${r.files}개): ${summary(r.hits)}`);
  const cwd = process.cwd();
  for (const h of r.hits.slice(0, 80)) console.log(`  ${path.relative(cwd, h.file) || h.file}:${h.line}  ${h.label}  → ${h.fix}\n      ${h.text}`);
  if (r.hits.length > 80) console.log(`  … 외 ${r.hits.length - 80}개 (--json 으로 전체)`);
  console.log('\n브랜드라서 일부러 쓴 것이면 그 줄에 slop-ok 주석. 화면 전체를 다듬으려면 언슬롭 스킬로 방향부터 (screens 팩 「AI 티 없는 화면」 규칙).');
  if (!unslopInstalled()) console.log(`\n언슬롭(unslop) 스킬을 깔면 이 목록에서 끝나지 않고, 화면을 보고 제품에 맞는 방향을 제안한 뒤 간격 · 색 · 아이콘 · 문구 · 글꼴 · 배치 · 움직임 순으로 디자이너처럼 손질합니다 (라이브 주소만으로도 점검).\n  Claude Code: ${INSTALL.claude}\n  Codex: ${INSTALL.codex}`);
  if (argv.includes('--strict')) process.exit(1);
}

if (require.main === module) main();
module.exports = { SIGNS, scan, scanText, summary, changedFiles, unslopInstalled, INSTALL };
