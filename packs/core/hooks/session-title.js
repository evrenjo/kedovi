#!/usr/bin/env node
// SessionStart 훅 (Claude Code): 세션 제목을 기본 「[yyyy.MM.dd] <워크스페이스 폴더 이름>」 으로 정한다 (-n 없이 시작해도).
/*
 * 틀: workspace.json vars.session.title (자리: {date} = 시작한 날 yyyy.MM.dd · {folder} = 워크스페이스 폴더 이름 · {project} = 프로젝트 이름). off 면 하지 않는다.
 * 이미 제목이 있는 세션(-n · /rename · 이어 받은 세션)은 건드리지 않는다. 팀원 · 위임 세션은 hook.run 이 건너뛴다.
 * 출력: hookSpecificOutput.sessionTitle (/rename 과 같은 효과. 이름이 붙으면 Claude Code 가 첫 요청으로 제목을 만들지 않는다). 항상 exit 0
 */
'use strict';
const path = require('path');
const { run, readInput, root } = require('../lib/hook');

const DEFAULT = '[{date}] {folder}';

/** 틀 → 제목 (빈 문자열이면 하지 않음) */
function titleOf(tpl, { folder, project, now = new Date() }) {
  const t = String(tpl == null ? DEFAULT : tpl).trim();
  if (!t || /^(off|none|false)$/i.test(t)) return '';
  const p2 = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}.${p2(now.getMonth() + 1)}.${p2(now.getDate())}`;
  return t.replace(/\{date\}/g, date).replace(/\{folder\}/g, folder).replace(/\{project\}/g, project || folder).slice(0, 120);
}

if (require.main === module) {
  run(() => {
    const input = readInput();
    if (String(input.session_title || '').trim()) return; // -n · /rename · 이미 붙인 제목
    const R = root();
    let ws = {};
    try { ws = require('../lib/workspace').load(R); } catch { /* workspace.json 없음: 폴더 이름만 */ }
    const title = titleOf(((ws.vars || {}).session || {}).title, { folder: path.basename(R), project: (ws.project || {}).name });
    if (!title) return;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', sessionTitle: title } }));
  });
}

module.exports = { titleOf, DEFAULT };
