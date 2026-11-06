#!/usr/bin/env node
/**
 * 물은 것에 먼저 답하기 — 사용자 요청이 질문이면 답의 첫 줄이 그 질문의 답(예 · 아니오 · 모름 + 이유)이게 한다.
 * - UserPromptSubmit: 요청이 질문이면(물음표 · 「~지 않나 · 맞아 · 돼」 꼴로 끝남) 한 줄 알리고 표시를 남긴다. 질문이 아니면 표시를 지운다
 * - Stop: 수준이 block 이고 표시가 있는데 답변 첫 문장에 판단(네 · 아니요 · 됩니다 · 없습니다 · 모릅니다 등)이 없으면 한 번 막는다
 * - 수준 agents.enforce.answerFirst: warn(기본) = 알림만 · block = 알림 + 멈출 때 한 번 막기 · off
 * 팀원 · 서브에이전트는 보지 않는다. 항상 exit 0
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, context, block, run, root, safeId, isTeammate } = require('../lib/hook');
const { stateDir } = require('../lib/workspace');

// 끝 말투로 본 질문: 물음표, 또는 「~지 않나 · 맞아 · 돼 · 될까 · 없지 · 인가」 처럼 묻는 어미
const ASK_END = /(?:[?？]|(?:지\s*않나|잖아|않아|맞아|맞나|맞지|맞죠|돼|되나|될까|되지|되죠|되나요|돼요|없지|없나|있지|있나|아닌가|아냐|아니야|인가|일까|건가|는지|나요|까요|ㄹ까|을까|를까))\s*[.~!]*$/;
function looksLikeQuestion(prompt) {
  const text = String(prompt || '').replace(/<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g, '').trim();
  if (!text || text.startsWith('/')) return false;
  const last = text.split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
  return ASK_END.test(last);
}

// 답변 첫 문장의 판단: 예 · 아니오 · 맞다 · 된다 · 있다/없다 · 모른다 · 가능/불가
const JUDGE = /(^|[\s(「"'*])(네|예|아니(요|오|ㅂ니다|에요|다)|아닙니다|맞(습니다|아요|다|아)|틀(립니다|렸습니다|려요)|됩니다|돼요|됐습니다|됐어요|끝났습니다|끝났어요|안\s*됩니다|안\s*돼요|없습니다|없어요|있습니다|있어요|모릅니다|모르겠습니다|확인하지\s*못했습니다|가능합니다|불가능|문제(가\s*)?없|문제(가\s*)?있|yes|no)(?=$|[\s.,:!)」"'*])/i;
function answersFirst(message) {
  const first = String(message || '').trim().split(/\n\s*\n/)[0] || '';
  const sentence = first.split(/(?<=[.!?。])\s|\n/)[0] || first;
  return JUDGE.test(sentence.replace(/\*\*/g, ''));
}

if (require.main === module) run(() => {
  const input = readInput();
  const id = safeId(input.session_id);
  if (!id || isTeammate(input)) return;
  const ROOT = root();
  const mark = path.join(stateDir(ROOT), `${id}.question`);
  const ev = String(input.hook_event_name || '');
  let level = 'warn';
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); level = (kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).enforce || {}).answerFirst || level; } catch { /* 옛 워크스페이스 */ }
  if (level === 'off') return;
  if (ev === 'UserPromptSubmit') {
    if (!looksLikeQuestion(input.prompt)) { try { fs.unlinkSync(mark); } catch { /* 없음 */ } return; }
    fs.writeFileSync(mark, '1');
    context('질문으로 끝난 요청입니다: 답의 첫 줄은 이 질문의 답(예 · 아니오 · 모름 + 이유 한 줄)으로 쓰고, 작업 보고는 그 뒤에 둡니다.');
    return;
  }
  if (ev !== 'Stop' || input.stop_hook_active || level !== 'block' || !fs.existsSync(mark)) return;
  try { fs.unlinkSync(mark); } catch { /* 없음 */ } // 한 번만 막는다
  if (!input.last_assistant_message || answersFirst(input.last_assistant_message)) return;
  block('사용자가 질문했는데 답변 첫 문장에 그 답(예 · 아니오 · 모름 + 이유)이 없습니다. 첫 줄을 질문의 답으로 고쳐 다시 씁니다. 이미 답했으면 그대로 멈춥니다. 수준 바꾸기: kedovi team-mode enforce answer off|warn|block');
});

module.exports = { looksLikeQuestion, answersFirst };
