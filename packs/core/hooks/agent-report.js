#!/usr/bin/env node
// 에이전트 보고 보관 (Claude Code) — 서브에이전트 · 리더 · 팀원(이름 없이 부른 역할 에이전트)의 긴 마지막 보고를 보고 페이지 파일로 옮긴다
/*
 * 까닭: 긴 보고가 그대로 메인(리더)에게 가면 메인 맥락을 차지하고, 메인이 사용자에게 보고하려고 다시 옮겨 쓴다.
 * SubagentStop: 마지막 보고(last_assistant_message, 없으면 agent_transcript_path 의 마지막 글)의 빈 줄 아닌 줄이
 *   vars.report.agentLines(기본 20)를 넘으면 .agents/reports/<날짜>/<시각>-<역할>.md 에 원문을 저장한다.
 *   수준 block(기본): 킷 역할 에이전트(.claude/agents/<역할>.md 가 있는 것)면 한 번 되돌려 「결론 · 핵심 3~5줄 · 자세히: <링크>」 로 다시 끝내게 한다
 *     (받는 쪽 맥락이 줄고, 필요하면 받는 쪽이 그 파일을 읽는다). 조사 · 계획 같은 다른 에이전트는 보관만 (결과 자체가 받는 쪽에 필요하다)
 *   warn: 보관만 · off: 하지 않는다. 수준 agents.enforce.agentReport
 * 보고는 이 PC 에만 (.agents/reports/, gitignore). 현황판 「보고 (이 PC)」 에 모인다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, block, run, root, safeId } = require('../lib/hook');
const { load } = require('../lib/workspace');
const R = require('../lib/reports');

const LINK = /자세히\s*[::]\s*\S+/;

/** 서브에이전트 대화 기록의 마지막 글 (옛 Claude Code: last_assistant_message 가 없을 때) */
function lastText(file) {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').trim().split('\n'); } catch { return ''; }
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    const m = e.message || {};
    if (e.type !== 'assistant' || m.role !== 'assistant') continue;
    const text = (Array.isArray(m.content) ? m.content : []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (text) return text;
  }
  return '';
}

run(() => {
  const input = readInput();
  if (String(input.hook_event_name || '') !== 'SubagentStop' || input.stop_hook_active) return;
  if (!safeId(input.session_id)) return;
  const ROOT = root();
  const text = String(input.last_assistant_message || '') || lastText(String(input.agent_transcript_path || ''));
  if (!text || LINK.test(text)) return;
  let level = 'block';
  let max = 20;
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); level = (kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).enforce || {}).agentReport || level; } catch { /* 옛 워크스페이스 */ }
  try { const v = Number((((load(ROOT).vars || {}).report) || {}).agentLines); if (Number.isFinite(v) && v > 0) max = v; } catch { /* 기본 */ }
  if (level === 'off') return;
  const lines = text.split('\n').filter((l) => l.trim()).length;
  if (lines <= max) return;
  const role = String(input.agent_type || 'agent');
  const { file, day, time } = R.newFile(ROOT, role);
  const first = (text.split('\n').find((l) => l.trim()) || '').replace(/^[#>*\s-]+/, '').replace(/^결론\s*[::]\s*/, '').split(/(?<=[.。])\s/)[0].replace(/[.。]$/, '').trim().slice(0, 60);
  fs.writeFileSync(file, `# ${role} 보고${first ? `: ${first}` : ''}\n\n> ${day} ${time} · ${role}${input.agent_id ? ` (${input.agent_id})` : ''} 의 마지막 보고 원문 · 훅이 보관 (kedovi report)\n\n${text}\n`);
  const own = fs.existsSync(path.join(ROOT, '.claude', 'agents', `${role}.md`));
  if (level !== 'block' || !own) return;
  const url = R.urlOf(ROOT, R.ensureServer(ROOT, { wait: false }), file);
  block(`보고가 깁니다 (${lines}줄, 기준 ${max}줄). 원문은 ${path.relative(ROOT, file)} 에 보관했습니다. 받는 쪽에는 결론 1줄 + 핵심 3~5줄 + 「자세히: ${url}」 만 다시 써서 끝낸다 (변경 파일 표 · 검증 표 · 근거는 그 파일에 있다). 오류 · 실패 · 받는 쪽이 정할 것 · 소유 밖 발견은 핵심에 남긴다. 끄기: kedovi team-mode enforce report off`);
});
