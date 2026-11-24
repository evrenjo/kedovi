#!/usr/bin/env node
// SessionStart 훅 (Claude Code · Codex) — 방향 인터뷰 전(workspace.json project.onboarded === false)이고 이 PC 가 팀장이면
// 첫 요청보다 kickoff 스킬(방향 인터뷰)을 먼저 하라고 한 줄 넘긴다. onboarded 가 없는 옛 워크스페이스 · 팀원 · 서브에이전트는 아무것도 하지 않는다. 항상 exit 0
'use strict';
const fs = require('fs');
const path = require('path');
const { run, context, root } = require('../lib/hook');

/** 방향 인터뷰를 할 차례인가: onboarded 가 정확히 false 이고, 팀장이 없거나 이 PC 가 팀장 */
function due(ROOT) {
  let ws;
  try { ws = JSON.parse(fs.readFileSync(path.join(ROOT, 'workspace.json'), 'utf8')); } catch { return false; }
  if (!ws.project || ws.project.onboarded !== false) return false;
  try {
    const T = require('../lib/team');
    if (!T.roster(ws).leads.length) return true;
    return !!T.whoAmI(ROOT, ws).lead;
  } catch { return true; }
}

if (require.main === module) {
  run(() => {
    if (!due(root())) return;
    context('🧭 방향 인터뷰 전인 새 워크스페이스다 (project.onboarded=false). 사용자의 첫 요청에 답하기 전에 kickoff 스킬을 읽고 방향 인터뷰(무엇 · 누가 → 유형 → 기존 자료 → 첫 기능 · 마일스톤 → 개발 표준 → 규칙)를 한 번에 한 질문씩(주제 n/N) 시작한다. 사용자가 나중에 하자고 하면 미루고 요청을 처리한다.');
  });
}

module.exports = { due };
