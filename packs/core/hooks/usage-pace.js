#!/usr/bin/env node
// 사용량 알림 (Claude Code): 주간 속도가 빠르면 메인에 알리고, 맥락이 커진 리더 · 팀원에게 인계를 알린다. 막지 않는다 (막는 것은 agent-budget.js). 항상 exit 0
/*
 * UserPromptSubmit (메인): 단계 1 이상이면 지금 단계 · 줄어든 상한을 넣는다. 단계가 오를 때와 1시간마다 (agents.enforce.usagePace, off 면 끔)
 * PreToolUse (서브에이전트 · 팀원 안): 맥락이 vars.team.memberContextK(기본 200, 0 이면 끔)를 넘으면 지금 변경을 마치고 인계하라고 알린다. 5만 토큰 늘 때마다 다시
 *   큰 맥락은 호출마다 다시 읽혀 주간 한도를 빠르게 쓴다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, run, root, note, context, safeId, isTeammate } = require('../lib/hook');
const { stateDir } = require('../lib/workspace');
const P = require('../lib/usagepace');

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const save = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v)); } catch { /* 기록 실패 */ } };

/** 대화 기록 끝에서 마지막 호출의 맥락 크기 (토큰) */
function contextTokens(file) {
  let tail = '';
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    tail = buf.toString('utf8');
  } catch { return null; }
  for (const l of tail.split('\n').reverse()) {
    if (!l.includes('"usage"')) continue;
    try {
      const u = (JSON.parse(l).message || {}).usage;
      if (u) return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    } catch { /* 잘린 줄 */ }
  }
  return null;
}

/** 이 에이전트의 대화 기록: 서브에이전트 = <세션>/subagents/agent-<id>.jsonl · 팀원 = 자기 기록 */
function transcriptOf(input) {
  if (input.agent_transcript_path) return input.agent_transcript_path;
  const t = String(input.transcript_path || '');
  if (!input.agent_id || !t) return t;
  return path.join(t.replace(/\.jsonl$/, ''), 'subagents', `agent-${input.agent_id}.jsonl`);
}

function mainNote(ROOT, input, ws) {
  const kit = require(path.join(ROOT, 'bin', 'kit.js'));
  const r = kit.resolveModels(ROOT, kit.loadWorkspace(ROOT));
  const lv = (r.enforce || {}).usagePace || 'block';
  if (lv === 'off') return;
  const s = P.state(ws);
  if (!s.known || !s.level) return;
  const f = path.join(stateDir(ROOT), `${safeId(input.session_id)}.pace.json`);
  const st = readJson(f);
  if (s.level <= (st.level || 0) && Date.now() - (st.at || 0) < 3600000) return;
  save(f, { level: s.level, at: Date.now() });
  const l = P.limitsFor(r.limits || {}, s.level);
  const act = s.level === 1 ? '새 병렬 작업을 늘리지 말고 급하지 않은 일은 뒤로 미룬다'
    : `상한을 리더 ${l.leaders} × 팀원 ${l.members} · 요청당 ${l.total} 으로 줄였다${s.level === 3 ? '. 틀리면 비싼 구현(implementer-deep) 밖의 에이전트는 Opus 를 쓰지 않는다 (호출에 model: sonnet)' : ''}`;
  context(`주간 사용량 속도 경고: ${P.line(s)}. ${act}. 자세히: kedovi usage`);
}

function memberNote(ROOT, input, ws) {
  const raw = Number(((ws.vars || {}).team || {}).memberContextK);
  const limit = Number.isFinite(raw) && raw >= 0 && ((ws.vars || {}).team || {}).memberContextK !== '' && ((ws.vars || {}).team || {}).memberContextK !== undefined ? raw : 200;
  if (!limit) return;
  const file = transcriptOf(input);
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return; }
  const id = safeId(input.agent_id || input.session_id);
  const f = path.join(stateDir(ROOT), `${safeId(input.session_id)}.ctx-${id}.json`);
  const st = readJson(f);
  if (size - (st.size || 0) < 50 * 1024) return; // 기록이 조금 늘었으면 다시 읽지 않는다
  st.size = size;
  const t = contextTokens(file);
  const k = t ? Math.round(t / 1000) : 0;
  if (k < limit || k < (st.warned || 0) + 50) return save(f, st);
  st.warned = k;
  save(f, st);
  const lead = String(input.agent_type || '') === 'lead';
  note(`맥락이 약 ${k}K 토큰입니다 (기준 ${limit}K, vars.team.memberContextK). 호출마다 다시 읽혀 주간 사용량을 빠르게 씁니다. ${lead ? '지금 단계를 마치면 진행판에 적고, 남은 단계 · 결정 · 검사 명령을 메인에게 인계해 새 리더로 잇게 한다' : '지금 변경을 검사가 통과하는 지점까지 마치고, 바뀐 것 · 남은 것 · 검사 명령을 보고하고 끝낸다. 남은 일은 부른 쪽이 새 에이전트에게 맡긴다'}`);
}

run(() => {
  const input = readInput();
  const ev = String(input.hook_event_name || '');
  const ROOT = root();
  const ws = readJson(path.join(ROOT, 'workspace.json'));
  if (ev === 'UserPromptSubmit' && !input.agent_id) return mainNote(ROOT, input, ws);
  if (ev === 'PreToolUse' && (input.agent_id || isTeammate(input))) return memberNote(ROOT, input, ws);
}, { teammateEvents: ['PreToolUse'] });
