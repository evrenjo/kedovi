#!/usr/bin/env node
// 역할 에이전트 상한 (Claude Code) — 한 요청(사용자 메시지 하나)에 동시 parallel 개 · 모두 total 개까지 Agent 도구를 허용한다.
//   UserPromptSubmit: 요청마다 개수를 새로 센다 · PreToolUse(Agent): 넘으면 막고 사용자에게 물으라고 알린다 · SubagentStop: 동시 개수를 줄인다
//   팀 모드(agent teams)인데 킷 역할을 이름(name) 없이 띄우면 막는다: 이름이 없으면 팀원이 아니라 서브에이전트로 돈다. 수준은 agents.enforce.teammateName (off | warn | block, 기본 block)
//   한 요청의 첫 킷 역할 에이전트 때 실행 방식 · 구성표를 알렸는지 한 줄 넣는다 (막지 않는다). agents.enforce.rosterAnnounce (off | warn, 기본 warn)
// 상한은 bin/kit.js resolveModels 의 limits (프로필 ← workspace.json ← .agents/local.json 의 agents.limits). Codex 는 config.toml 의 동시 상한과 규칙으로.
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, deny, run, root, safeId } = require('../lib/hook');
const { judge } = require('../lib/teammode');
const { stateDir } = require('../lib/workspace');

run(() => {
  const input = readInput();
  const id = safeId(input.session_id);
  if (!id) return;
  const ws = root();
  const file = path.join(stateDir(ws), `${id}.agents.json`);
  let st = { running: 0, turn: 0, at: Date.now() };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* 처음 */ }
  if (Date.now() - st.at > 6 * 3600000) st = { running: 0, turn: 0, at: Date.now() }; // 오래된 기록은 버린다
  const save = () => { st.at = Date.now(); fs.writeFileSync(file, JSON.stringify(st)); };
  const ev = input.hook_event_name;
  if (ev === 'UserPromptSubmit') { st.turn = 0; st.running = 0; return save(); } // 팀원(agent teams)은 SubagentStop 이 없어 동시 수도 요청마다 새로 센다
  if (ev === 'SubagentStop') { st.running = Math.max(0, st.running - 1); return save(); }
  if (ev !== 'PreToolUse') return;
  let limits = { parallel: 4, total: 10 };
  let nameCheck = 'block';
  let roster = 'warn';
  try {
    const kit = require(path.join(ws, 'bin', 'kit.js'));
    const r = kit.resolveModels(ws, kit.loadWorkspace(ws));
    limits = r.limits || limits;
    nameCheck = (r.enforce || {}).teammateName || nameCheck;
    roster = (r.enforce || {}).rosterAnnounce || roster;
  } catch { /* 옛 워크스페이스 — 기본값 */ }
  // 팀 모드: 킷 역할(.claude/agents/<역할>.md)을 이름 없이 띄우면 서브에이전트로 돈다. 킷 역할이 아닌 유형(조사용 내장 에이전트 등) · fork · isolation 호출은 팀원이 아니라 보지 않는다
  const ti = input.tool_input || {};
  const type = String(ti.subagent_type || '');
  const warns = [];
  const kitRole = !!type && /^[A-Za-z0-9._-]+$/.test(type) && fs.existsSync(path.join(ws, '.claude', 'agents', `${type}.md`));
  if (nameCheck !== 'off' && kitRole && !String(ti.name || '').trim() && !ti.isolation && judge(ws).team) {
    const msg = `팀 모드입니다. 역할 에이전트(${type})를 이름 없이 띄우면 팀원이 아니라 서브에이전트로 돕니다. Agent 도구에 name(역할 이름, 예: ${type})을 주어 팀원으로 띄우세요. 처음 띄우는 것이면 먼저 실행 방식 한 줄과 구성표를 사용자에게 알립니다 (team 스킬)`;
    if (nameCheck === 'block') return deny(`${msg}. 수준 바꾸기: kedovi team-mode enforce name warn|off`);
    warns.push(msg);
  }
  // 리뷰 전 검사: 리뷰 역할 에이전트의 지시문에 「검사: <명령> 통과」 줄이 없으면 막는다 (agents.enforce.checkBeforeReview)
  try {
    const R = require('../lib/review');
    if (kitRole && R.REVIEW_ROLE.test(type) && !R.hasCheckLine(ti.prompt)) {
      const lv = R.checkLevel(ws);
      if (lv === 'block') return deny(R.CHECK_MESSAGE);
      if (lv === 'warn') warns.push(R.CHECK_MESSAGE);
    }
    if (kitRole && R.REVIEW_ROLE.test(type) && R.prototypeGap) { const gap = R.prototypeGap(ws, ti.prompt); if (gap) warns.push(gap); }
  } catch { /* 옛 워크스페이스 */ }
  if (st.turn >= limits.total) {
    return deny(`역할 에이전트 상한: 이번 요청에 이미 ${st.turn}개를 불렀습니다 (한 요청 ${limits.total}개). 새로 부르지 말고 앞 에이전트에게 이어서 맡기거나 직접 하세요. 꼭 더 필요하면 이유와 함께 사용자에게 물어보세요 (사용자가 답하면 다시 셉니다). 상한은 kedovi ai show 의 limits`);
  }
  if (st.running >= limits.parallel) {
    return deny(`역할 에이전트 상한: 지금 ${st.running}개가 돌고 있습니다 (동시 ${limits.parallel}개). 먼저 끝난 결과를 받고 부르세요`);
  }
  if (roster !== 'off' && kitRole && st.turn === 0) warns.push('이번 요청의 첫 역할 에이전트입니다. 실행 방식 한 줄("팀 모드로 진행" 또는 "서브에이전트로 진행 · 사유")과 구성표(역할 · 모델 · 강도 · 이유)를 사용자에게 아직 알리지 않았으면 지금 알립니다 (team 스킬)');
  st.running += 1;
  st.turn += 1;
  save();
  // 리뷰 확인을 켠 워크스페이스: reviewer 역할을 띄우면 지금 상태를 리뷰 기록으로 남긴다 (lib/review.js)
  try {
    const R = require('../lib/review');
    if (kitRole && R.REVIEW_ROLE.test(type)) { const rs = R.settings(ws); if (rs.level !== 'off') R.record(ws, require('../lib/workspace').load(ws), rs, { by: `${type} 역할 에이전트` }); }
  } catch { /* 기록은 부가 기능 */ }
  if (warns.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: warns.map((w) => `⚠ ${w}`).join('\n') } }));
});
