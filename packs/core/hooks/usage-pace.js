#!/usr/bin/env node
// 사용량 알림 (Claude Code): 주간 속도가 빠르면 메인에 알리고, 맥락이 커진 리더 · 팀원에게 인계를 알린다. 막지 않는다 (막는 것은 agent-budget.js). 항상 exit 0
/*
 * UserPromptSubmit (메인): 단계 1 이상이면 지금 단계 · 상한을 넣는다. 단계가 오를 때와 1시간마다 (agents.enforce.usagePace, off 면 끔). block 이면 「줄였다」, warn 이면 「줄이지 않음 · 권장」 으로 실제 적용과 맞춘다
 * PreToolUse (서브에이전트 · 팀원 안): 맥락이 vars.team.memberContextK(기본 200, 0 이면 끔)와 맥락 창의 vars.session.renewContextPct(기본 70)% 중 작은 것을 넘으면
 *   인계 파일 틀(.agents/reports/<날짜>/<시각>-handoff-<역할>.md: 작업 폴더 · 브랜치 · 바뀐 파일 · push 전 커밋 · 진행판 단계)을 만들고 지금 변경을 마치고 인계하라고 알린다. 5만 토큰 늘 때마다 다시
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
  if (s.level <= (st.level || 0) && st.lv === lv && Date.now() - (st.at || 0) < 3600000) return; // 수준을 바꾸면 바로 다시 알린다
  save(f, { level: s.level, lv, at: Date.now() });
  context(`주간 사용량 속도 경고: ${P.line(s)}. ${action(s.level, lv, P.limitsFor(r.limits || {}, s.level), ((r.teamEnforce || {}).usagePace) || lv)}. 자세히: kedovi usage`);
}

/** 단계 · 실제 수준(lv)에 맞는 조치 문구. block 일 때만 「줄였다 · 바꿔 띄운다」. 팀 값보다 센 이 PC 값이 적용 중이면 출처를 붙인다 */
function action(level, lv, l, teamLv) {
  if (level === 1) return '새 병렬 작업을 늘리지 말고 급하지 않은 일은 뒤로 미룬다';
  const cap = `리더 ${l.leaders} × 팀원 ${l.members} · 요청당 ${l.total}`;
  if (lv !== 'block') return `상한은 줄이지 않았다 (알림만, agents.enforce.usagePace=${lv}). 권장: 상한 ${cap}${level === 3 ? ', implementer-deep 밖의 에이전트는 호출에 model: sonnet' : ''}`;
  const from = teamLv !== lv ? ` (팀 값은 ${teamLv} 이지만 이 PC 값 .agents/local.json agents.enforce.usagePace=${lv} 이 적용 중. 바꾸기: kedovi team-mode enforce pace ${teamLv})` : '';
  return `상한을 ${cap} 으로 줄였다${level === 3 ? '. implementer-deep 밖의 Opus 호출은 훅이 Sonnet 으로 바꿔 띄운다' : ''}${from}`;
}

/** 마지막 호출의 맥락 크기 · 모델 (대화 기록 끝에서) → { tokens, model } | null */
function lastUsage(file) {
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
      const m = JSON.parse(l).message || {};
      const u = m.usage;
      if (u) return { tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), model: String(m.model || '') };
    } catch { /* 잘린 줄 */ }
  }
  return null;
}

/** 인계 기준 (K 토큰): vars.team.memberContextK(기본 200, 0 이면 끔)와 맥락 창의 vars.session.renewContextPct(기본 70)% 중 작은 것 */
function handoffLimit(ROOT, ws, use) {
  const num = (v, d) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : d; };
  const costK = num(((ws.vars || {}).team || {}).memberContextK, 200);
  if (!costK) return null;
  const pct = num(((ws.vars || {}).session || {}).renewContextPct, 70);
  let big = false;
  try { big = require(path.join(ROOT, 'bin', 'kit.js')).window1m(use.model); } catch { /* 옛 워크스페이스 */ }
  const windowK = big || use.tokens > 200000 ? 1000 : 200;
  const pctK = pct ? Math.round((windowK * pct) / 100) : Infinity;
  return pctK < costK ? { k: pctK, why: `맥락 창 ${windowK}K 의 ${pct}%, vars.session.renewContextPct` } : { k: costK, why: 'vars.team.memberContextK' };
}

/** 인계 파일 틀: 바뀐 파일 · 브랜치 · 작업 폴더 · 진행판 최근 단계를 채워 .agents/reports/ 에 만든다 → 파일 경로 */
function handoffFile(ROOT, input, k) {
  const R = require('../lib/reports');
  const { execFileSync } = require('child_process');
  const cwd = input.cwd || ROOT;
  const git = (...a) => { try { return execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim(); } catch { return ''; } };
  const top = git('rev-parse', '--show-toplevel');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  const changed = git('status', '--porcelain').split('\n').filter(Boolean);
  const ahead = git('log', '--oneline', '-5', '@{upstream}..HEAD').split('\n').filter(Boolean);
  let units = [];
  try { units = require('../bin/lead-board').units().filter((u) => !u.endedAt).slice(0, 3); } catch { /* 진행판 없음 */ }
  const role = String(input.agent_type || '에이전트');
  const { file, day, time } = R.newFile(ROOT, `handoff-${role}`);
  const rel = (p) => path.relative(ROOT, p) || '.';
  const L = [`# 인계: ${role} (${day} ${time}, 맥락 약 ${k}K)`, '',
    '> 맥락 기준을 넘어 훅이 만든 틀이다. 채운 칸은 사실이고, 「채울 것」 만 에이전트가 쓴다. 새 에이전트는 이 파일만 읽고 이어 간다.', '',
    '## 위치', '', '| 항목 | 값 |', '|---|---|',
    `| 작업 폴더 | \`${top ? rel(top) : rel(cwd)}\` |`, `| 브랜치 | ${branch || '-'} |`, `| 에이전트 | ${role} (${String(input.agent_id || '-')}) |`, ''];
  L.push(`## 바뀐 파일 (${changed.length}개, 커밋 전)`, '', ...(changed.length ? changed.slice(0, 40).map((x) => `- \`${x}\``) : ['- 없음']), ...(changed.length > 40 ? [`- 외 ${changed.length - 40}개`] : []), '');
  if (ahead.length) L.push('## push 전 커밋', '', ...ahead.map((x) => `- ${x}`), '');
  if (units.length) L.push('## 진행판 최근 단계', '', ...units.map((u) => `- ${u.unit} · ${u.stage || '-'}${u.done ? ` · 끝난 것: ${u.done}` : ''}${u.next ? ` · 다음: ${u.next}` : ''}`), '');
  L.push('## 채울 것', '', '- 끝난 것: ', '- 남은 것 (순서대로): ', '- 정한 것 · 근거: ', '- 검사 명령과 마지막 결과: ', '- 주의 (건드리면 안 되는 것 · 막힌 것): ', '');
  fs.writeFileSync(file, L.join('\n'));
  return rel(file);
}

function memberNote(ROOT, input, ws) {
  const file = transcriptOf(input);
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return; }
  const id = safeId(input.agent_id || input.session_id);
  const f = path.join(stateDir(ROOT), `${safeId(input.session_id)}.ctx-${id}.json`);
  const st = readJson(f);
  if (size - (st.size || 0) < 50 * 1024) return; // 기록이 조금 늘었으면 다시 읽지 않는다
  st.size = size;
  const use = lastUsage(file);
  if (!use) return save(f, st);
  const lim = handoffLimit(ROOT, ws, use);
  const k = Math.round(use.tokens / 1000);
  if (!lim || k < lim.k || k < (st.warned || 0) + 50) return save(f, st);
  st.warned = k;
  if (!st.handoff || !fs.existsSync(path.join(ROOT, st.handoff))) {
    try { st.handoff = handoffFile(ROOT, input, k); } catch { st.handoff = null; }
  }
  save(f, st);
  const lead = String(input.agent_type || '') === 'lead';
  const doc = st.handoff ? ` 인계 파일 틀을 만들었다: ${st.handoff} (위치 · 바뀐 파일 · 진행판은 채워 둠). 「채울 것」 만 쓰고 보고 끝에 「자세히: ${st.handoff}」 를 붙인다.` : '';
  note(`맥락이 약 ${k}K 토큰입니다 (기준 ${lim.k}K, ${lim.why}). 호출마다 다시 읽혀 주간 사용량을 빠르게 쓰고, 더 크면 자동 압축으로 앞 내용을 잃습니다.${doc} ${lead ? '지금 단계를 마치면 진행판에 적고, 남은 단계 · 결정 · 검사 명령을 메인에게 인계해 새 리더로 잇게 한다' : '지금 변경을 검사가 통과하는 지점까지 마치고, 바뀐 것 · 남은 것 · 검사 명령을 보고하고 끝낸다. 남은 일은 부른 쪽이 새 에이전트에게 맡긴다'}`);
}

run(() => {
  const input = readInput();
  const ev = String(input.hook_event_name || '');
  const ROOT = root();
  const ws = readJson(path.join(ROOT, 'workspace.json'));
  if (ev === 'UserPromptSubmit' && !input.agent_id) return mainNote(ROOT, input, ws);
  if (ev === 'PreToolUse' && (input.agent_id || isTeammate(input))) return memberNote(ROOT, input, ws);
}, { teammateEvents: ['PreToolUse'] });
