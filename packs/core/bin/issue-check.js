#!/usr/bin/env node
// 이슈 · 댓글 · MR 본문을 올리기 전 검사 (비밀값 · 개인 경로 · 이메일 · 사설 IP · 금지 낱말 · 대상 repo 공개 여부 · 글 형식). 사용: node packs/core/bin/issue-check.js --file <본문 파일> [--repo <이름>] [--type <형식>]
'use strict';

/*
 * --file F     검사할 본문 (제목도 같이 보려면 첫 줄에 넣는다)
 * --repo R     workspace.json repos 의 이름. 그 repo 의 origin 이 공개면 경고한다 (막지는 않는다)
 * --type T     글 형식 (task · bug · issue · mr · done · comment …, lib/draft.js). 빈칸 자리표시자 · 필수 절 · 긴 글머리 · 이 PC 에만 있는 것을 본다.
 *              없으면 comment (필수 절 없이). 수준은 agents.enforce.draftCheck (block 이면 걸릴 때 exit 1). 제목 줄은 본문에서 빼고 넘긴다
 * 걸린 것은 줄 번호와 종류만 찍는다 (값은 찍지 않는다). 하나라도 걸리면 exit 1.
 * 금지 낱말: workspace.json vars.issue.forbid (배열, 고객사 · 사내 이름 등). 줄에 gitleaks:allow 가 있으면 비밀값 검사를 넘긴다.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const die = (m) => { console.error(`✖ ${m}`); process.exit(2); };

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** 비밀값 모양은 커밋 훅과 같은 목록 (bin/kit.js) */
function secretHits(root, text) {
  for (const f of [path.join(root, 'bin', 'kit.js'), path.join(__dirname, '..', '..', '..', 'bin', 'kit.js')]) {
    if (fs.existsSync(f)) return require(f).secretHits(text);
  }
  die('bin/kit.js 를 찾지 못했습니다. kedovi upgrade');
}

const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 비밀값 말고 공개 글에 나가면 안 되는 것: [종류, 줄 검사] */
function privateHits(text, forbid) {
  const rules = [
    ['개인 경로', /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^/\\\s]+/],
    ['이메일', /[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com)(?!noreply\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ['사설 IP', /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/],
    ...forbid.filter(Boolean).map((w) => ['금지 낱말', /^[\x20-\x7e]+$/.test(w) ? new RegExp(`(?<![A-Za-z0-9])${ESC(w)}(?![A-Za-z0-9])`, 'i') : new RegExp(ESC(w))]),
  ];
  const out = [];
  String(text).split('\n').forEach((l, i) => {
    for (const [kind, re] of rules) if (re.test(l)) out.push({ line: i + 1, kind });
  });
  return out;
}

function main() {
  const file = arg('file');
  if (!file) die('--file 이 필요합니다');
  if (!fs.existsSync(file)) die(`${file} 가 없습니다`);
  const text = fs.readFileSync(file, 'utf8');
  let ws = null;
  try { ws = require(path.join(__dirname, '..', 'lib', 'workspace.js')).load(); } catch { /* 워크스페이스 밖: 패턴만 */ }
  const root = (ws && ws.root) || process.cwd();
  const forbid = (ws && ws.vars && ws.vars.issue && Array.isArray(ws.vars.issue.forbid)) ? ws.vars.issue.forbid : [];

  const hits = [...secretHits(root, text).map((h) => ({ ...h, kind: `${h.kind} 모양` })), ...privateHits(text, forbid)].sort((a, b) => a.line - b.line);
  for (const h of hits) console.log(`✖ ${h.line}줄: ${h.kind}`);

  const name = arg('repo');
  if (name && ws) {
    const r = ws.repos.find((x) => x.name === name);
    if (!r) console.log(`⚠ workspace.json repos 에 '${name}' 이 없어 공개 여부를 보지 못했습니다`);
    else {
      let url = '';
      try { url = execFileSync('git', ['-C', r.dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { url = r.remote || ''; }
      const pub = url ? require(path.join(__dirname, '..', 'lib', 'visibility.js')).isPublic(url) : null;
      if (pub === true) console.log(`⚠ ${name} 은 공개 repo 입니다. 누구나 읽고 검색에 잡히며, 지워도 알림 메일 · 캐시에 남습니다`);
      else if (pub === false) console.log(`공개 여부: ${name} 은 비공개 (로그인해야 읽음)`);
      else console.log(`⚠ ${name} 의 공개 여부를 알 수 없습니다 (주소 · 네트워크). 공개라고 보고 씁니다`);
    }
  }
  // 글 형식 (lib/draft.js). 첫 줄이 제목이면(# 이 아니고 다음 줄이 비었으면) 빼고 본다. 줄 번호는 파일 기준
  let form = { hits: [], level: 'off' };
  try {
    const D = require(path.join(__dirname, '..', 'lib', 'draft.js'));
    const all = text.split('\n');
    const titled = all.length > 1 && all[0].trim() && !/^\s*(#|[-*+]\s|\*\*|\|)/.test(all[0]) && !all[1].trim();
    const body = titled ? ['', ...all.slice(1)].join('\n') : text;
    const r = name && ws ? ws.repos.find((x) => x.name === name) : null;
    form = D.checkFor(root, body, { type: arg('type') || 'comment', repoDir: r ? r.dir : null });
    if (form.level !== 'off') for (const h of form.hits) console.log(`${form.level === 'block' ? '✖' : '⚠'} ${D.format([h])[0]} (글 형식)`);
  } catch { /* 옛 core: 넘긴다 */ }
  const formBlock = form.level === 'block' ? form.hits.length : 0;
  if (hits.length || formBlock) { console.log(`✖ ${hits.length + formBlock}건: 해당 줄을 고치거나 *** 로 가린 뒤 다시 검사하세요${formBlock ? ' (글 형식: kedovi draft template <형식> · 끄기 · 알림만: 팀장이 kedovi team-mode enforce draft off|warn --team)' : ''}`); process.exit(1); }
  console.log(`✔ 비밀값 · 개인 경로 · 이메일 · 사설 IP · 금지 낱말 0건${form.level === 'off' ? '' : form.hits.length ? ` · 글 형식 ${form.hits.length}건 (알림만)` : ' · 글 형식 통과'}`);
}

if (require.main === module) main();

module.exports = { privateHits };
