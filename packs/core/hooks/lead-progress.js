#!/usr/bin/env node
// 작업 리더 진행 (Claude Code): 리더가 보고 주기를 넘기면 알리고, 메인은 요청 시작 때 진행판을 본다. 막지 않는다. 항상 exit 0
/*
 * PreToolUse (작업 리더 서브에이전트 안): 진행판을 고치거나(kedovi team step) 메인에게 메시지를 보낸 지 vars.team.leadReportMinutes(기본 15)분이 지났으면
 *   「단계 보고: 진행판 + 메인에게 한 줄」 을 additionalContext 로 (주기마다 한 번). 리더인지 = 입력의 agent_type, 없으면 agent-budget 기록의 유형
 * UserPromptSubmit (메인): 진행 중인 단위(.agents/status/)가 바뀌었으면(새 단계 · 새로 소식 없음 · 닫힘) 그 단위만 한 줄씩 넣는다. 같으면 넣지 않는다 (세션별 <세션>.board.json). 0 이면 끔
 * SubagentStop (메인): 끝난 리더가 kedovi team step 으로 적은 단위에 끝난 시각을 적는다. 10분 안에 다시 적지 않으면 진행판이 저절로 닫는다 (lead-board.js staleEnd)
 * 리더가 팀원이 도는 채 끝내려 하면 agent-budget.js 의 SubagentStop 이 한 번 되돌린다 (agents.enforce.leadHold)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, run, root, note, context, safeId } = require('../lib/hook');
const { stateDir, load } = require('../lib/workspace');

function minutes(ROOT) {
  try { const n = Number((((load(ROOT).vars || {}).team) || {}).leadReportMinutes); return Number.isFinite(n) && n >= 0 ? n : 15; } catch { return 15; }
}

/** 이 서브에이전트가 작업 리더인가 */
function isLead(input, ROOT) {
  if (String(input.agent_type || '') === 'lead') return true;
  if (input.agent_type) return false;
  try {
    const st = JSON.parse(fs.readFileSync(path.join(stateDir(ROOT), `${safeId(input.session_id)}.agents.json`), 'utf8'));
    return ((st.kids || {})[String(input.agent_id)] || {}).type === 'lead';
  } catch { return false; }
}

const REPORTED = (input) => {
  const tool = String(input.tool_name || '');
  if (tool === 'SendMessage') return true;
  return tool === 'Bash' && /\bteam\s+step\b|lead-board\.js\s+step\b/.test(String((input.tool_input || {}).command || ''));
};

run(() => {
  const input = readInput();
  const ev = String(input.hook_event_name || '');
  const ROOT = root();
  const mins = minutes(ROOT);
  if (!mins) return;
  if (ev === 'UserPromptSubmit' && !input.agent_id) {
    let B;
    try { B = require('../bin/lead-board'); } catch { return; }
    const f = path.join(stateDir(ROOT), `${safeId(input.session_id)}.board.json`);
    let seen = {};
    try { seen = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* 처음 */ }
    const now = Date.now();
    const all = B.units();
    const key = (u) => `${u.updatedAt}|${u.endedAt || ''}|${!u.endedAt && now - u.updatedAt > 2 * mins * 60000 ? 'stale' : ''}`;
    const changed = all.filter((u) => seen[u.unit] !== key(u) && (!u.endedAt || seen[u.unit])); // 닫힘은 앞서 보여 준 단위만
    const next = Object.fromEntries(all.map((u) => [u.unit, key(u)]));
    try { fs.writeFileSync(f, JSON.stringify(next)); } catch { /* 기록 실패 */ }
    if (!changed.length) return;
    const live = all.filter((u) => !u.endedAt).length;
    context(`작업 리더 진행판 바뀐 것 (kedovi team board, 진행 중 ${live}개): ${changed.map((u) => B.line(u, mins)).join(' / ')}. 진행 현황 · 상태 줄의 예상 종료는 이것으로 적는다`);
    return;
  }
  if (ev === 'SubagentStop' && input.agent_id) {
    const f = path.join(stateDir(ROOT), `${safeId(input.session_id)}.leadunits-${safeId(input.agent_id)}.json`);
    let names = [];
    try { names = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return; }
    try { require('../bin/lead-board').markStopped(names); } catch { /* 옛 도구 */ }
    return;
  }
  if (ev !== 'PreToolUse' || !input.agent_id || !isLead(input, ROOT)) return;
  // 이 리더가 적는 단위를 기억한다 (끝날 때 진행판에 끝난 시각을 적으려고)
  const cmd = String((input.tool_input || {}).command || '');
  const um = String(input.tool_name || '') === 'Bash' && /\bteam\s+step\b|lead-board\.js\s+step\b/.test(cmd) && cmd.match(/--unit\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (um) {
    const uf = path.join(stateDir(ROOT), `${safeId(input.session_id)}.leadunits-${safeId(input.agent_id)}.json`);
    let names = [];
    try { names = JSON.parse(fs.readFileSync(uf, 'utf8')); } catch { /* 처음 */ }
    const name = um[1] || um[2] || um[3];
    if (!names.includes(name)) try { fs.writeFileSync(uf, JSON.stringify([...names, name])); } catch { /* 기록 실패 */ }
  }
  const f = path.join(stateDir(ROOT), `${safeId(input.session_id)}.lead-${safeId(input.agent_id)}.json`);
  let st = {};
  try { st = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* 처음 */ }
  const now = Date.now();
  const save = () => { try { fs.writeFileSync(f, JSON.stringify(st)); } catch { /* 기록 실패 */ } };
  if (REPORTED(input) || !st.last) { st.last = now; return save(); }
  if (now - st.last < mins * 60000) return;
  st.last = now; // 다음 알림은 한 주기 뒤
  save();
  note(`단계 보고 시각입니다 (마지막 보고 뒤 ${mins}분 넘음, vars.team.leadReportMinutes). 지금 단계를 진행판에 적고(kedovi team step --unit <단위> --stage <단계> --done "<끝난 것>" --next "<다음>" --eta <HH:MM>) 메인에게 같은 한 줄을 메시지로 보낸다. 무거운 시험을 기다리면 kedovi heavy status 의 예상 시작 · 끝으로 예상 종료를 정한다`);
}, { teammateEvents: ['PreToolUse'] });
