#!/usr/bin/env node
/**
 * 서브에이전트 권한 질문 거절 (Claude Code PermissionRequest)
 * 까닭: 서브에이전트(작업 리더 · 그 아래 팀원)의 권한 질문은 메인 화면에만 뜬다. 자리를 비우면 아무도 답하지 않아 몇 시간씩 멈춘다.
 *   --dangerously-skip-permissions 여도 묻는 것: 위험한 rm · 명시한 ask 규칙 · 셸이 풀지 못하는 복합 명령(작업 폴더 밖 읽기 막음일 때)
 * 입력에 agent_id 가 있으면(서브에이전트 · 프로세스 안 팀원) 바로 거절하고 다른 방법을 알린다. 메인 세션의 질문은 그대로 둔다
 * 수준 agents.enforce.permissionAsk: block(기본) = 거절 · off = 그대로 묻기
 * 어느 수준이든 질문이 온 것을 상태 폴더 perm/<agent_id>.json 에 적는다: kedovi agents watch 가 「⏸ 권한 질문」 으로 보인다 (그 뒤 기록이 이어지면 풀린 것)
 * 출력 = 거절할 때만 decision JSON. 항상 exit 0
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, run, root, safeId } = require('../lib/hook');
const { stateDir } = require('../lib/workspace');

/** 거절 문구: 무엇이 막혔는지에 따라 다른 길을 알린다 (위험한 삭제는 돌아가지 말고 넘긴다) */
function denyMessage(tool, input) {
  const cmd = String((input || {}).command || '');
  const head = '권한 질문은 사용자 화면에만 떠서 답을 받을 수 없다 (서브에이전트). 기다리지 않게 거절했다.';
  if (tool === 'Bash' && /(^|[;&|(\s])(sudo\s+)?(rm|rmdir)\s/.test(cmd)) {
    return `${head} 삭제 명령은 다른 방법으로 돌아가 실행하지 않는다 (스크립트로 감싸기 포함). 지울 경로와 까닭을 보고에 적어 리더 · 메인에게 넘기고 나머지 일을 계속한다.`;
  }
  if (tool === 'Bash') {
    return `${head} 명령이 길게 이어진 복합 명령(여러 번의 cd · 하위 셸 · 긴 파이프)이면 단순한 명령 여러 번으로 나누거나 같은 내용을 스크립트 파일로 써서 bash <파일> 로 실행한다. 단순한 명령인데 물었으면 프로젝트 규칙이 묻게 한 명령(ask 규칙)이다: 실행하지 말고 명령과 까닭을 보고에 적어 리더 · 메인에게 넘긴다.`;
  }
  return `${head} 이 도구(${tool})가 꼭 필요하면 무엇을 왜 하려는지 보고에 적어 리더 · 메인에게 넘기고 나머지 일을 계속한다.`;
}

if (require.main === module) run(() => {
  const input = readInput();
  if (String(input.hook_event_name || '') !== 'PermissionRequest' || !input.agent_id) return;
  const ROOT = root();
  let level = 'block';
  const id = safeId(input.agent_id);
  if (id) {
    try {
      const dir = path.join(stateDir(ROOT), 'perm');
      fs.mkdirSync(dir, { recursive: true });
      const ti = input.tool_input || {};
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ at: Date.now(), tool: String(input.tool_name || ''), what: String(ti.command || ti.file_path || ti.url || '').replace(/\s+/g, ' ').slice(0, 120), session: String(input.session_id || '') }));
    } catch { /* 기록 실패는 넘긴다 */ }
  }
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); level = (kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).enforce || {}).permissionAsk || level; } catch { /* 옛 워크스페이스 */ }
  if (level !== 'block') return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: `${denyMessage(String(input.tool_name || ''), input.tool_input)} (끄기: kedovi team-mode enforce perm off)` } } }));
}, { teammateEvents: ['PermissionRequest'] }); // 서브에이전트 · 팀원 안의 질문이 대상이다

module.exports = { denyMessage };
