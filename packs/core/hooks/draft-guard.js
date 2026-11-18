#!/usr/bin/env node
// 글 형식 검사 (Claude Code · Codex PreToolUse Bash): gh issue · pr 의 create · comment · edit 와 glab issue · mr 의 create · note · update 가 올리는 본문을 올리기 전에 본다.
/*
 * 보는 것 = lib/draft.js: 빈칸 자리표시자 · 필수 절(이슈 · MR, repo 의 GitHub · GitLab 틀이 먼저) · 긴 글머리(개조식) · 이 PC 에만 있는 것(보고 링크 · .agents · 임시 폴더 · 로컬 브랜치 · push 안 한 커밋) · 소스 코드 표현(이름 모양은 알림만)
 * 본문 = --body · -b · --description · -d · --message · -m 값, --body-file · -F 파일(- 면 명령 안 heredoc). $(cat <<'EOF' … EOF) 는 안의 글을 본다. 그 밖의 $변수 · $(명령) 본문은 알 수 없어 넘긴다
 * 수준 agents.enforce.draftCheck: block(기본) = 막기 · warn = 알림 · off. 팀원 · 서브에이전트 안에서도 본다
 * 출력 = 막을 때 deny JSON · 알릴 때 additionalContext. 예외는 삼키고 항상 exit 0
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, run, deny, note, root } = require('../lib/hook');
const { tokens } = require('./repo-guard');
const { parts } = require('./git-guard');
const D = require('../lib/draft');

// 도구 → 하위 명령 → 동작 → 형식
const TOOLS = {
  gh: { issue: { create: 'issue', comment: 'comment', edit: 'issue' }, pr: { create: 'mr', comment: 'comment', edit: 'mr', review: 'comment' } },
  glab: { issue: { create: 'issue', note: 'comment', update: 'issue' }, mr: { create: 'mr', note: 'comment', update: 'mr' } },
};
const BODY = new Set(['--body', '-b', '--description', '-d', '--message', '-m']);
const FILE = new Set(['--body-file', '-F']);
const WRAP = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time']);
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\s*\2\s*(?:\n|$|\))/;

/** 명령 → [{ type, body, dir }] (본문을 알 수 있는 것만). 단위 명령으로 나눠 cd 를 따라간다 (틀 · push 안 한 커밋은 그 repo 에서 본다) */
function bodies(cmd, cwd) {
  const out = [];
  let dir = cwd;
  for (const seg of parts(String(cmd))) {
    let t = tokens(seg.text);
    while (t.length && WRAP.has(t[0])) t = t.slice(1);
    if (t[0] === 'cd') { if (t[1] && !/[$`]/.test(t[1])) dir = path.resolve(dir, t[1].replace(/^~(?=\/|$)/, process.env.HOME || '~')); continue; }
    const tool = TOOLS[path.basename(t[0] || '')];
    const type = tool && (tool[t[1]] || {})[t[2]];
    if (!type) continue;
    let body = null;
    for (let j = 3; j < t.length; j++) {
      let [flag, val] = [t[j], t[j + 1]];
      const eq = /^(--[\w-]+)=([\s\S]*)$/.exec(flag);
      if (eq) [flag, val] = [eq[1], eq[2]];
      if (val === undefined) continue;
      if (BODY.has(flag)) {
        const h = HEREDOC.exec(val);
        if (h) body = h[3];
        else if (!/\$[({\w]|`/.test(val)) body = val;
      } else if (FILE.has(flag)) {
        if (val === '-') { const h = HEREDOC.exec(String(cmd)); if (h) body = h[3]; } else {
          try { body = fs.readFileSync(path.resolve(dir, val.replace(/^~(?=\/)/, process.env.HOME || '~')), 'utf8'); } catch { /* 아직 없는 파일 */ }
        }
      }
    }
    if (body !== null) out.push({ type, body, dir, what: `${t[0]} ${t[1]} ${t[2]}` });
  }
  return out;
}

if (require.main === module) run(() => {
  const input = readInput();
  if (input.tool_name !== 'Bash' && input.tool_name !== undefined) return;
  const cmd = String((input.tool_input || {}).command || '');
  if (!/\b(gh|glab)\b/.test(cmd)) return;
  const ROOT = root();
  const level = D.levelOf(ROOT);
  if (level === 'off') return;
  const cwd = input.cwd || process.cwd();
  const found = [];
  let stop = false;
  for (const b of bodies(cmd, cwd)) {
    const r = D.checkFor(ROOT, b.body, { type: b.type, repoDir: b.dir });
    if (r.hits.some((h) => !h.soft)) stop = true;
    if (r.hits.length) found.push(`${b.what}: ${D.format(r.hits).join(' · ')}`);
  }
  if (!found.length) return;
  const msg = `글 형식 검사 (사람이 읽는 글): ${found.join(' / ')}. 빈칸은 채우거나 「없음」, 긴 글머리는 나누고, 이 PC 에만 있는 링크 · 경로는 빼거나 올릴 수 있는 것으로 바꾸고, 코드 표현은 기능 · 화면 이름으로 쓴다. 틀: kedovi draft template <형식> · 규칙: .agents/rules/core--12-writing-format.md · 끄기 · 알림만: 팀장이 kedovi team-mode enforce draft off|warn --team`;
  if (level === 'block' && stop) deny(msg); else note(msg);
}, { teammateEvents: ['PreToolUse'] }); // 리더 · 팀원도 이슈 · MR 에 글을 올린다

module.exports = { bodies };
