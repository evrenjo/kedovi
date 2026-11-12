#!/usr/bin/env node
// 역할 에이전트 상한 (Claude Code) — 한 요청(사용자 메시지 하나)에 동시 parallel 개 · 모두 total 개까지 Agent 도구를 허용한다.
//   UserPromptSubmit: 요청마다 개수를 새로 센다 · PreToolUse(Agent): 넘으면 막고 사용자에게 물으라고 알린다 · SubagentStop: 동시 개수를 줄인다
//   팀 모드(agent teams)인데 킷 역할을 이름(name) 없이 띄우면 막는다: 이름이 없으면 팀원이 아니라 서브에이전트로 돈다. 수준은 agents.enforce.teammateName (off | warn | block, 기본 block)
//   한 요청의 첫 킷 역할 에이전트 때 실행 방식 · 구성 한 줄을 알렸는지 넣는다 (막지 않는다). agents.enforce.rosterAnnounce (off | warn, 기본 warn)
// 상한은 bin/kit.js resolveModels 의 limits (프로필 ← workspace.json ← .agents/local.json 의 agents.limits). Codex 는 config.toml 의 동시 상한과 규칙으로.
// 3층 (작업 리더): 메인이 부르는 lead 역할은 leaders 상한, 리더(또는 역할 에이전트)가 부르는 팀원은 부른 쪽마다 members 상한, 모든 층 합계는 total.
//   누가 불렀는지 = PreToolUse 입력의 agent_id (서브에이전트 안이면 그 id, 메인이면 없음). SubagentStart 의 agent_id 를 앞서 허용한 호출과 짝지어 부모를 적고, SubagentStop 에 그 칸을 뺀다.
//   팀원(agent teams)은 SubagentStart · Stop 이 없어 요청마다 비운다.
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, deny, run, root, safeId } = require('../lib/hook');
const { judge } = require('../lib/teammode');
const { stateDir } = require('../lib/workspace');

const LEAD_ROLE = 'lead';
const HOUR = 3600000;

/** 같은 세션의 훅이 동시에 돌 때(병렬 호출) 상태 파일이 꼬이지 않게 잠근다. 2초 안에 못 잡으면 그냥 진행 */
function withLock(file, fn) {
  const lock = `${file}.lock`;
  const until = Date.now() + 2000;
  let got = false;
  while (!got && Date.now() < until) {
    try { fs.mkdirSync(lock); got = true; } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmdirSync(lock); } catch { /* 이미 풀림 */ }
      const t = Date.now() + 15; while (Date.now() < t) { /* 잠깐 기다림 */ }
    }
  }
  try { return fn(); } finally { if (got) try { fs.rmdirSync(lock); } catch { /* 없음 */ } }
}

/** 지금 도는 수: parent = 'main' | 부른 에이전트 id. kind = 'lead' | 'role' | undefined(모두) */
function count(st, parent, kind) {
  const hit = (x) => x.parent === parent && (!kind || (kind === 'lead') === (x.type === LEAD_ROLE));
  return Object.values(st.kids).filter(hit).length + st.pending.filter(hit).length;
}

/** 지금 도는 에이전트 나무 (현황 표시용): [{ id, type, members: [{ id, type }] }] */
function tree(st) {
  const kids = Object.entries(st.kids || {}).map(([id, x]) => ({ id, ...x }));
  return kids.filter((x) => x.parent === 'main').map((x) => ({ id: x.id, type: x.type, members: kids.filter((y) => y.parent === x.id).map((y) => ({ id: y.id, type: y.type })) }));
}

function main() {
  const input = readInput();
  const id = safeId(input.session_id);
  if (!id) return;
  const ws = root();
  const file = path.join(stateDir(ws), `${id}.agents.json`);
  return withLock(file, () => handle(input, ws, file));
}

function handle(input, ws, file) {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 처음 */ }
  st = { turn: 0, kids: {}, pending: [], at: Date.now(), ...st };
  if (!st.kids || typeof st.kids !== 'object') st.kids = {};
  if (!Array.isArray(st.pending)) st.pending = [];
  if (Date.now() - st.at > 6 * HOUR) st = { turn: 0, kids: {}, pending: [], at: Date.now() }; // 오래된 기록은 버린다
  for (const [k, v] of Object.entries(st.kids)) if (Date.now() - (v.at || 0) > 6 * HOUR) delete st.kids[k];
  st.pending = st.pending.filter((x) => Date.now() - (x.at || 0) < 10 * 60000);
  const save = () => { st.at = Date.now(); delete st.running; fs.writeFileSync(file, JSON.stringify(st)); };
  const ev = input.hook_event_name;
  if (ev === 'UserPromptSubmit') { st.turn = 0; st.pending = []; return save(); } // 팀원(agent teams)은 Start · Stop 이 없어 대기 칸을 요청마다 비운다
  if (ev === 'SubagentStart') {
    const kid = String(input.agent_id || '');
    const type = String(input.agent_type || '');
    if (!kid) return;
    let i = st.pending.findIndex((x) => x.type === type || (!x.type && type === 'general-purpose'));
    if (i < 0) i = 0;
    const p = st.pending.splice(i, 1)[0];
    st.kids[kid] = { parent: p ? p.parent : 'main', type: p ? p.type : type, at: Date.now() };
    return save();
  }
  if (ev === 'SubagentStop') {
    const kid = String(input.agent_id || '');
    if (st.kids[kid]) delete st.kids[kid];
    else { const j = st.pending.findIndex((x) => x.parent === 'main'); if (j >= 0) st.pending.splice(j, 1); } // 짝을 못 찾으면(업그레이드 전에 띄운 것) 메인 대기 하나를 뺀다
    for (const [k, v] of Object.entries(st.kids)) if (v.parent === kid) delete st.kids[k]; // 부른 쪽이 끝나면 그 팀원도 끝난 것
    return save();
  }
  if (ev !== 'PreToolUse') return;
  const parent = input.agent_id ? String(input.agent_id) : 'main';
  let limits = { parallel: 4, total: 10, leaders: 1, members: 2 };
  let nameCheck = 'block';
  let roster = 'warn';
  try {
    const kit = require(path.join(ws, 'bin', 'kit.js'));
    const r = kit.resolveModels(ws, kit.loadWorkspace(ws));
    limits = { ...limits, ...(r.limits || {}) };
    nameCheck = (r.enforce || {}).teammateName || nameCheck;
    roster = (r.enforce || {}).rosterAnnounce || roster;
  } catch { /* 옛 워크스페이스 — 기본값 */ }
  // 팀 모드: 킷 역할(.claude/agents/<역할>.md)을 이름 없이 띄우면 서브에이전트로 돈다. 킷 역할이 아닌 유형(조사용 내장 에이전트 등) · fork · isolation 호출은 팀원이 아니라 보지 않는다
  const ti = input.tool_input || {};
  const type = String(ti.subagent_type || '');
  const warns = [];
  const kitRole = !!type && /^[A-Za-z0-9._-]+$/.test(type) && fs.existsSync(path.join(ws, '.claude', 'agents', `${type}.md`));
  const isLead = type === LEAD_ROLE;
  // 작업 리더는 팀 모드여도 서브에이전트로 띄운다 (이름을 주면 팀원이 되어 그 아래 팀원이 병렬로 못 돈다)
  if (isLead && parent === 'main' && String(ti.name || '').trim() && judge(ws).team) return deny('작업 리더(lead)는 팀 모드여도 이름(name) 없이 서브에이전트로 띄운다. 이름을 주면 팀원이 되어 그 아래 팀원이 병렬로 돌지 않는다 (team 스킬 「작업 리더」)');
  if (nameCheck !== 'off' && kitRole && !isLead && parent === 'main' && !String(ti.name || '').trim() && !ti.isolation && judge(ws).team) {
    const msg = `팀 모드입니다. 역할 에이전트(${type})를 이름 없이 띄우면 팀원이 아니라 서브에이전트로 돕니다. Agent 도구에 name(역할 이름, 예: ${type})을 주어 팀원으로 띄우세요. 처음 띄우는 것이면 먼저 구성 한 줄(실행 방식 포함)을 사용자에게 알립니다 (team 스킬)`;
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
    if (kitRole && R.prototypeGap) { const gap = R.prototypeGap(ws, ti.prompt, R.REVIEW_ROLE.test(type) ? 'review' : 'implement'); if (gap) warns.push(gap); }
  } catch { /* 옛 워크스페이스 */ }
  // 리더(또는 역할 에이전트) 안에서 이름을 주면 팀원(agent teams)이 되어 보고가 메인으로 가고, 리더는 결과를 못 받고 끝난다
  if (parent !== 'main' && String(ti.name || '').trim()) return deny('작업 리더 · 역할 에이전트 안에서는 팀원을 이름(name) 없이 부른다. 이름을 주면 팀원 세션이 되어 보고가 메인으로 가고 리더는 결과를 못 받는다. 이름 없이 다시 부르고, 팀원 결과를 받을 때까지 기다린 뒤 보고한다');
  if (isLead && parent !== 'main') return deny('작업 리더(lead)는 메인만 부른다. 리더 안에서 다른 리더를 부르지 않고, 팀원(역할 에이전트)을 부른다');
  if (st.turn >= limits.total) {
    return deny(`역할 에이전트 상한: 이번 요청에 이미 ${st.turn}개를 불렀습니다 (한 요청 ${limits.total}개). 새로 부르지 말고 앞 에이전트에게 이어서 맡기세요 (메인 대화 전담이 꺼져 있으면 직접 해도 된다). 꼭 더 필요하면 이유와 함께 사용자에게 물어보세요 (사용자가 답하면 다시 셉니다). 상한은 kedovi ai show 의 limits`);
  }
  if (parent === 'main' && isLead && count(st, 'main', 'lead') >= limits.leaders) {
    return deny(`작업 리더 상한: 리더가 이미 ${count(st, 'main', 'lead')}명 돌고 있습니다 (리더 동시 ${limits.leaders}명, 이 PC 요금제 기준). 끝난 리더의 결과를 받은 뒤 다음 단위를 맡기거나, 남은 단위를 도는 리더에게 이어서 맡기세요. 상한은 kedovi ai show`);
  }
  if (parent === 'main' && !isLead && count(st, 'main', 'role') >= limits.parallel) {
    return deny(`역할 에이전트 상한: 지금 ${count(st, 'main', 'role')}개가 돌고 있습니다 (동시 ${limits.parallel}개). 먼저 끝난 결과를 받고 부르세요`);
  }
  if (parent !== 'main' && count(st, parent) >= limits.members) {
    return deny(`팀원 상한: 이 에이전트가 부른 팀원이 이미 ${count(st, parent)}명 돌고 있습니다 (리더당 팀원 동시 ${limits.members}명). 끝난 팀원의 결과를 받고 부르거나, 같은 역할은 앞 팀원에게 이어서 맡기세요`);
  }
  if (parent === 'main' && roster !== 'off' && kitRole && st.turn === 0) warns.push('이번 요청의 첫 역할 에이전트입니다. 「구성 (팀 모드 | 서브에이전트): 역할 모델·강도 · …」 한 줄을 사용자에게 아직 알리지 않았으면 지금 알립니다. 같은 세션에서 앞과 같은 구성이면 생략. 표는 승인이 필요할 때만 (team 스킬)');
  st.pending.push({ parent, type, at: Date.now() });
  st.turn += 1;
  save();
  // 리뷰 확인을 켠 워크스페이스: reviewer 역할을 띄우면 지금 상태를 리뷰 기록으로 남긴다 (lib/review.js)
  try {
    const R = require('../lib/review');
    if (kitRole && R.REVIEW_ROLE.test(type)) { const rs = R.settings(ws); if (rs.level !== 'off') R.record(ws, require('../lib/workspace').load(ws), rs, { by: `${type} 역할 에이전트` }); }
  } catch { /* 기록은 부가 기능 */ }
  if (warns.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: warns.map((w) => `⚠ ${w}`).join('\n') } }));
}

if (require.main === module) run(main, { teammateEvents: ['PreToolUse'] }); // 리더 · 팀원 안의 Agent 호출도 센다
module.exports = { count, tree, LEAD_ROLE };

