#!/usr/bin/env node
// 화면 디자인 요청 (Claude Code · Codex UserPromptSubmit): 프로토타입 · 시안 · 화면 디자인을 만들거나 다듬는 말이 오면 「AI 티 없는 화면」 순서를 그 자리에서 넣는다.
// 손대기 전에 방향 5줄 제안 · 언슬롭(unslop) 스킬이 있으면 그것으로 손질, 없으면 깔면 얻는 것을 보이고 권함 (사용자가 안 쓰기로 정했으면 권하지 않음).
/*
 * 한 세션에 한 번 (상태: stateDir 의 <세션>.ailook). 「AI 티 · 촌스럽 · 언슬롭」 처럼 직접 말하면 다시 넣는다.
 * 설치 권유는 기능 추천(feature-suggest)의 unslop 항목과 겹치지 않게 같은 세션 기록(<세션>.suggest 의 ids)과 물은 기록을 함께 쓴다.
 * 출력: 평문 (두 도구 모두 문맥에 더함). 항상 exit 0
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { run, readInput, context, safeId, root, agent } = require('../../core/lib/hook');

const TOPIC = /프로토타입|시안|목업|랜딩\s*페이지|와이어프레임|화면\s*디자인|디자인.{0,8}(?:다듬|개선|세련|바꿔|손봐)|AI\s*티|AI\s*가\s*만든\s*(?:것\s*)?같|촌스럽|예쁘게|unslop|언슬롭/i;
const DIRECT = /AI\s*티|AI\s*가\s*만든\s*(?:것\s*)?같|촌스럽|unslop|언슬롭/i;
const RULE = '.agents/rules/screens--15-ai-look.md';

/** 넣을 말 (installed: 언슬롭 있음 · pitch: 설치를 권해도 됨 · who: claude | codex) */
function message({ installed, pitch, who }) {
  const head = `화면 디자인 작업 (screens 팩 「AI 티 없는 화면」, 먼저 \`${RULE}\` 를 읽는다): 프로토타입 · 시안을 만들거나 다듬는 일이면 손대기 전에 방향 5줄(제품 · 성격 · 세계 · 색을 쓸 순간 · 시그니처)을 제안하고 승인받는다. 그 전에 프로젝트의 디자인 시스템 · 아이콘 · 브랜드 색 · 글꼴을 찾아 넣는다. 확인 질문이 필요하면 방향과 함께 묻는다. 화면 품질 기준도 설계부터 그린다: 상태(로딩 · 데이터 없음 · 오류 · 권한 없음) · 입력 오류 문구 · 라벨 · 누르는 영역 24px · 포커스 모양 · 320px 폭 (\`.agents/rules/screens--10-prototype-fidelity.md\` 「화면 품질 기준」), 다 그리면 \`kedovi screens quality <화면 ID> --design\`. 구현(프로토타입대로 만들기)이면 새로 디자인하지 않고 「프로토타입대로 구현」 을 따른다.`;
  if (installed) return `${head} 언슬롭(unslop) 스킬이 깔려 있다: 승인 뒤 손질은 그 스킬로 한다 (${who === 'codex' ? '$unslop' : '/unslop'}).`;
  if (!pitch) return `${head} 손질은 규칙의 기준과 \`kedovi screens slop\` 으로 한다.`;
  const cmd = who === 'codex' ? '저장소 github.com/heydamir/unslop 의 skills/unslop 폴더를 ~/.agents/skills/ 에 복사' : '`claude plugin install unslop --marketplace heydamir/unslop` (이 PC 의 모든 프로젝트)';
  return `${head} 언슬롭(unslop) 스킬이 없다: 방향 제안과 함께 깔면 얻는 것을 한두 줄로 보이고 권한다 (「설치할까요?」 만 묻지 않는다): 화면을 보고 AI 티를 위치까지 짚음 · 제품에 맞는 방향 · 간격 · 색 · 아이콘 · 문구 · 글꼴 · 배치 · 움직임 순으로 디자이너처럼 손질 · 라이브 주소만으로 점검. 지금은 규칙의 기준과 \`kedovi screens slop\`(기계로 잡히는 것만)으로 한다는 것도 말한다. 좋다고 하면 ${cmd} 를 실행하고 새 세션부터 쓰인다고 알린다. 답이 나오면 \`kedovi suggest set unslop yes|no\` 로 기록한다.`;
}

if (require.main === module) {
  run(() => {
    const input = readInput();
    const prompt = String(input.prompt || input.user_prompt || '');
    if (!TOPIC.test(prompt)) return;
    const R = root();
    const id = safeId(input.session_id);
    const { stateDir } = require('../../core/lib/workspace');
    const dir = stateDir(R);
    const mark = id ? path.join(dir, `${id}.ailook`) : '';
    if (mark && fs.existsSync(mark) && !DIRECT.test(prompt)) return;
    let S = null;
    try { S = require('../../core/lib/suggest'); } catch { /* 추천 모듈 없음 */ }
    const installed = S ? S.skillInstalled('unslop', R) : false;
    // 사용자가 안 쓰기로 정했거나, 이 세션에서 기능 추천이 이미 권했으면 다시 권하지 않는다
    const sfile = id ? path.join(dir, `${id}.suggest`) : '';
    let sess = null;
    try { sess = JSON.parse(fs.readFileSync(sfile, 'utf8')); } catch { /* 없음 */ }
    const decided = S ? S.decisions(R).unslop : null;
    const pitch = !installed && !decided && !(sess && (sess.ids || []).includes('unslop'));
    context(message({ installed, pitch, who: agent() === 'codex' ? 'codex' : 'claude' }));
    try {
      if (mark) fs.writeFileSync(mark, new Date().toISOString());
      if (pitch && S) {
        S.markAsked(R, 'unslop');
        if (sfile) fs.writeFileSync(sfile, JSON.stringify({ n: 0, last: 0, ...(sess || {}), ids: [...((sess && sess.ids) || []), 'unslop'] }));
      }
    } catch { /* 상태는 편의 */ }
  });
}

module.exports = { TOPIC, DIRECT, message };
