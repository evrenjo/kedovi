#!/usr/bin/env node
// 메인 대화 전담 (Claude Code) — 메인 세션이 repo 파일을 직접 고치려 하면 백그라운드 에이전트에 맡기게 한다
/*
 * 까닭: 메인이 작업을 붙들고 있는 동안 사용자가 보낸 메시지는 작업 중간에 끼어 들어가 놓치기 쉽다 (Claude Code 알려진 문제).
 *       메인이 맡기고 바로 차례를 끝내면 다음 메시지는 새 차례로 받는다. 맡긴 에이전트는 백그라운드로 돌고 결과는 다음 차례에 알림으로 온다.
 * UserPromptSubmit: 이번 요청의 알림 표시를 지운다 · PreToolUse(Edit|Write|MultiEdit|NotebookEdit): 판정
 * - 대상: workspace.json 의 repo(코드 · 기획) 안 파일. 워크스페이스 기록(handoffs · topics · .agents 등) · 워크스페이스 밖은 메인이 직접 써도 된다
 * - 서브에이전트 · 팀원 안의 수정은 보지 않는다 (hook.run 이 건너뛴다)
 * - 수준 agents.enforce.mainDelegate: block(기본) = 막고 맡기라고 알린다 · warn = 요청마다 한 번 알림 · off
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, deny, note, run, root, safeId } = require('../lib/hook');
const { stateDir, load } = require('../lib/workspace');

function real(p) {
  try { return fs.realpathSync(p); } catch { try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); } catch { return p; } }
}

const MESSAGE = '메인은 사용자와 대화를 맡는다 (메인 대화 전담). 이 repo 파일 수정은 백그라운드 에이전트에 맡긴다: '
  + '작은 수정(한두 파일 · 지금 대화 맥락이 필요한 것)은 대화 사본 에이전트(Agent 도구의 fork 유형)로, 여러 파일 · 기능 단위는 역할 에이전트(implementer 등 · 독립 단위가 2개 이상이면 작업 리더)로. '
  + '맡긴 뒤 무엇을 맡겼는지 한 줄 보고하고 차례를 끝낸다 (결과는 다음 차례에 알림으로 온다). 빌드 · 테스트처럼 오래 걸리는 명령도 백그라운드로 돌린다. '
  + '끄기: kedovi team-mode enforce main off (팀 값이면 팀장이 --team)';

run(() => {
  const input = readInput();
  const id = safeId(input.session_id);
  if (!id) return;
  const ROOT = root();
  const mark = path.join(stateDir(ROOT), `${id}.maindelegate`);
  const ev = String(input.hook_event_name || '');
  if (ev === 'UserPromptSubmit') { try { fs.unlinkSync(mark); } catch { /* 없음 */ } return; }
  if (ev !== 'PreToolUse') return;
  let level = 'block';
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); level = (kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).enforce || {}).mainDelegate || level; } catch { /* 옛 워크스페이스 */ }
  if (level === 'off' || (level === 'warn' && fs.existsSync(mark))) return;
  const ti = input.tool_input || {};
  const file = ti.file_path || ti.notebook_path;
  if (!file) return;
  const abs = real(path.resolve(input.cwd || ROOT, file));
  let ws;
  try { ws = load(ROOT); } catch { return; }
  const inRepo = ws.repos.some((r) => [r.dir, real(r.dir)].some((d) => abs === d || abs.startsWith(d + path.sep)));
  if (!inRepo) return;
  if (level === 'block') { deny(MESSAGE); return; }
  fs.writeFileSync(mark, '1');
  note(MESSAGE);
});
