#!/usr/bin/env node
// 사람이 읽는 글의 틀 · 올리기 전 검사. 실행: kedovi draft <명령>
/*
 * 명령
 *   list                                   형식 목록
 *   template <형식>                        틀 (task 작업 항목 · bug 결함 · mr MR·PR · done 완료 댓글 · weekly 주간보고 · report 보고 · plan 기획 문서)
 *   check --file F [--type 형식|issue|comment|wiki] [--repo R]
 *                                          빈칸 자리표시자 · 필수 절 · 긴 글머리(개조식) · 이 PC 에만 있는 것(보고 링크 · .agents · 임시 폴더 · 로컬 브랜치 · push 안 한 커밋)
 *                                          issue = 작업 항목 · 결함 중 맞는 쪽, comment · wiki = 필수 절 없이. repo 에 GitLab · GitHub 틀이 있으면 그 절이 먼저
 *   staged <repo 폴더>                     커밋 훅용: 올리려는 md 의 더한 줄만 본다. 새 문서는 같은 폴더 _template.md 의 절까지
 * 수준 agents.enforce.draftCheck: block(기본) = 걸리면 exit 1 · warn = 알리고 통과 · off = 보지 않음 (kedovi team-mode enforce draft)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const D = require('../lib/draft');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m, code = 2) => { console.error(`✖ ${m}`); process.exit(code); };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };

function wsRepoDir(name) {
  if (!name) return null;
  try {
    const ws = require('../lib/workspace').load();
    const r = ws.repos.find((x) => x.name === name);
    return r ? r.dir : null;
  } catch { return null; }
}

/** 결과 출력 → 끝 코드 */
function finish(hits, level, where) {
  if (!hits.length) { console.log(`✔ 글 형식 검사 통과${where ? ` (${where})` : ''}`); return 0; }
  const mark = level === 'block' ? '✖' : '⚠';
  for (const h of hits) console.log(`${mark} ${where ? `${where} ` : ''}${D.format([h])[0]}`);
  console.log(`${mark} 글 형식 ${hits.length}건: 고친 뒤 다시 검사 (틀: kedovi draft template <형식> · 규칙: core--12-writing-format · 끄기 · 알림만: 팀장이 kedovi team-mode enforce draft off|warn --team)`);
  return level === 'block' ? 1 : 0;
}

function cmdCheck() {
  const file = opt('file');
  if (!file) die('--file 이 필요합니다');
  if (!fs.existsSync(file)) die(`${file} 가 없습니다`);
  const level = D.levelOf(ROOT);
  if (level === 'off') { console.log('글 형식 검사 꺼짐 (kedovi team-mode enforce draft)'); return 0; }
  const type = opt('type');
  if (type && !D.FORMATS[type] && !['issue', 'comment', 'wiki'].includes(type)) die(`형식 '${type}' 을 모릅니다. kedovi draft list`);
  const r = D.checkFor(ROOT, fs.readFileSync(file, 'utf8'), { type, repoDir: wsRepoDir(opt('repo')) });
  if (r.from) console.log(`필수 절: repo 틀 ${r.from}`);
  else if (r.type) console.log(`형식: ${D.FORMATS[r.type].label}`);
  return finish(r.hits, level);
}

const SKIP = /(^|\/)(_template\.md|originals\/|md\/|docs-site\/|html\/|\.gitlab\/|\.github\/|node_modules\/)/;

/** 커밋 훅: 올리려는 md 파일의 더한 줄 (새 파일은 전부 + 같은 폴더 _template.md 의 절) */
function cmdStaged() {
  const dir = argv[1] ? path.resolve(argv[1]) : process.cwd();
  const level = D.levelOf(ROOT);
  if (level === 'off') return 0;
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  let list;
  try { list = git('diff', '--cached', '--name-status', '--diff-filter=AM', '-z'); } catch { return 0; }
  const parts = list.split('\0').filter(Boolean);
  const ws = readJson(path.join(ROOT, 'workspace.json'));
  const local = readJson(path.join(ROOT, '.agents', 'local.json'));
  const v = D.varsOf(ws);
  const bullets = D.bulletsFor(D.prefsOf(ws, local), 'plan');
  let all = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [st, f] = [parts[i], parts[i + 1]];
    if (!/\.md$/i.test(f) || SKIP.test(f)) continue;
    let text;
    try { text = git('show', `:${f}`); } catch { continue; }
    let added = null;
    let sections = null;
    if (st === 'M') {
      added = new Set();
      let diff = '';
      try { diff = git('diff', '--cached', '-U0', '--', f); } catch { /* 없음 */ }
      for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
        const s = Number(m[1]);
        const n = m[2] === undefined ? 1 : Number(m[2]);
        for (let k = 0; k < n; k++) added.add(s + k);
      }
      if (!added.size) continue;
    } else {
      // 새 문서: 같은 폴더의 틀이 있으면 그 절(자리표시자 없는 ## · ### 제목)
      const tpl = path.join(dir, path.dirname(f), '_template.md');
      try {
        sections = fs.readFileSync(tpl, 'utf8').split('\n').map((l) => /^#{2,3}\s+(.+)$/.exec(l.trim())).filter((m) => m && !/[<>]/.test(m[1])).map((m) => [m[1].trim()]);
      } catch { sections = null; }
    }
    const hits = D.check(text, { sections: sections || null, bullets, bulletMax: v.bulletMax, localPatterns: v.localPatterns, added: added || undefined });
    all = all.concat(hits.map((h) => ({ ...h, file: f })));
  }
  if (!all.length) return 0;
  const mark = level === 'block' ? '✖' : '⚠';
  for (const h of all) console.error(`${mark} ${h.file} ${D.format([h])[0]}`);
  console.error(`${mark} 글 형식 ${all.length}건${level === 'block' ? ': 커밋을 막았습니다' : ''}. 고친 뒤 다시 커밋 (규칙: core--12-writing-format · 끄기 · 알림만: 팀장이 kedovi team-mode enforce draft off|warn --team)`);
  return level === 'block' ? 1 : 0;
}

function main() {
  const cmd = argv[0];
  if (cmd === 'list') {
    for (const [k, f] of Object.entries(D.FORMATS)) console.log(`${k.padEnd(7)} ${f.label}${f.sections ? ` · 필수 절: ${f.sections.map((s) => s[0]).join(' · ')}` : ''}`);
    console.log('issue   작업 항목 · 결함 중 맞는 쪽 (check 에서) · comment · wiki = 필수 절 없이');
    return 0;
  }
  if (cmd === 'template') {
    const t = D.template(argv[1]);
    if (!t) die(`형식을 고르세요: ${Object.keys(D.FORMATS).join(' · ')}`);
    console.log(t);
    return 0;
  }
  if (cmd === 'check') return cmdCheck();
  if (cmd === 'staged') return cmdStaged();
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 12).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  return cmd ? 2 : 0;
}

if (require.main === module) process.exit(main());
