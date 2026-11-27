#!/usr/bin/env node
// 요청 장부 (Claude Code): 사용자 요청마다 번호를 붙여 기록하고, 열린 요청이 있으면 답변 끝에 표를 붙였는지 멈출 때 본다. 항상 exit 0
/*
 * 까닭: 진행판(kedovi team board)은 리더 단위만 보여서, 대화가 오가면 사용자가 말한 일이 반영됐는지 · 끝났는지 안 보인다.
 * 장부 = handoffs/<id>/topics/요청-목록.md (lib/requests.js). 상태 갱신 = kedovi requests set <번호> --status … --agent … --result …
 * UserPromptSubmit (메인): 요청을 적고 번호를 알린다. 맞장구(응 · 고마워) · 백그라운드 알림 · 다른 세션 · 에이전트 메시지는 적지 않고, 질문은 물음으로(답하면 Stop 이 닫음), 짧은 승인(진행해 · 배포해줘)은 열린 직전 요청에 붙인다.
 *   안내 문장은 세션 첫 요청과 30분마다, 그 사이는 번호만 한 줄
 * Stop (메인): 이번 요청 중 끼어 든 메시지(hooks/mid-turn-messages.js 와 같은 방식)도 적는다. 표 검사는 이번 차례에 업무 요청(새 요청 · 이어 붙인 승인 · 끼어 든 업무)이 있을 때만.
 *   열린 요청(완료 · 취소 아님)이 있는데 마지막 답변에 요청 표(코드 블록 고정폭 머리 「번호 상태 맡은 요청 결과」 + ─ 줄, 또는 마크다운 머리 「| 번호 | 요청 | … 상태 … |」)가 없으면 한 번 되돌려 붙이게 한다 (stop_hook_active 면 통과)
 * 수준 agents.enforce.requestLedger: block(기본, 기록 + 표 검사) · warn(기록만) · off(아무것도 안 함). 팀원 · 서브에이전트에서는 돌지 않는다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, run, root, context, block, safeId } = require('../lib/hook');
const { stateDir, devId } = require('../lib/workspace');
const L = require('../lib/requests');

function level(ROOT) {
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); return (kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).enforce || {}).requestLedger || 'block'; } catch { return 'block'; }
}

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const save = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v)); } catch { /* 기록 실패 */ } };

if (require.main === module) {
  run(() => {
    const input = readInput();
    const ev = String(input.hook_event_name || '');
    if (input.agent_id) return;
    const ROOT = root();
    const lv = level(ROOT);
    if (lv === 'off') return;
    const id = devId(ROOT);
    if (!id) return;
    const sid = safeId(input.session_id);

    if (ev === 'UserPromptSubmit') {
      const r = L.record(ROOT, id, input.prompt, {}, input);
      // 이번 차례의 요청 종류: Stop 이 표를 요구할지 본다 (업무 요청 · 이어 붙인 승인일 때만)
      if (sid) { const tf = path.join(stateDir(ROOT), `${sid}.reqturn.json`); save(tf, { kind: r.kind, at: Date.now() }); }
      if (!r.row) return;
      if (r.kind === 'ask') return context(`📋 물음 #${r.row.no} (업무 표에 올리지 않음. 답하면 닫힘. 이 물음이 고칠 일로 이어지면 다음 요청이 업무로 올린다)`);
      const st = sid ? path.join(stateDir(ROOT), `${sid}.requests.json`) : null;
      const seen = st ? readJson(st, {}) : {};
      const what = r.kind === 'go' ? `직전 요청 #${r.row.no} 에 이어 붙임` : `요청 #${r.row.no} 로 기록`;
      if (st && seen.at && Date.now() - seen.at < 30 * 60000) return context(`📋 ${what} (kedovi requests)`);
      if (st) save(st, { at: Date.now() });
      return context(`📋 ${what} (장부 handoffs/${id}/topics/${L.NAME}.md). 맡기면 kedovi requests set ${r.row.no} --agent <맡은 에이전트> --status 진행, 끝나면 --status 완료 --result "<결과 한 줄>" (보류 · 취소도). 열린 요청이 있으면 답변 끝에 kedovi requests table 의 표를 그대로 붙인다 (${L.formatOf(ROOT) === 'markdown' ? `마크다운 표, 머리 ${L.TABLE_HEAD}` : '코드 블록 안 고정폭 표: 번호 · 상태 · 맡은 · 요청 · 결과, 머리 아래 ─ 줄'})`);
    }

    if (ev !== 'Stop') return;
    let midWork = false;
    // 끼어 든 메시지도 적는다 (이미 적은 것은 delivery id 로 건너뜀)
    if (input.transcript_path && sid) {
      let mids = [];
      try { mids = require('./mid-turn-messages').midTurn(input.transcript_path); } catch { /* 옛 훅 */ }
      const f = path.join(stateDir(ROOT), `${sid}.reqmid.json`);
      const done = readJson(f, []);
      const fresh = mids.filter((m) => !done.includes(m.id));
      for (const m of fresh) { const k = L.record(ROOT, id, m.text).kind; if (k === 'new' || k === 'go') midWork = true; }
      if (fresh.length) save(f, [...done, ...fresh.map((m) => m.id)].slice(-200));
    }
    L.closeAsks(ROOT, id); // 답한 물음은 닫는다
    if (lv !== 'block' || input.stop_hook_active) return;
    // 질문 · 맞장구 · 백그라운드 알림 · 셸 출력 차례에는 표를 요구하지 않는다 (매번 표를 붙이게 하면 답이 되풀이된다)
    const turn = sid ? readJson(path.join(stateDir(ROOT), `${sid}.reqturn.json`), {}) : {};
    if (!midWork && turn.kind && !['new', 'go'].includes(turn.kind)) return;
    const rows = L.read(ROOT, id);
    const t = L.table(rows, 12, L.formatOf(ROOT));
    if (!t || L.TABLE_RE.test(String(input.last_assistant_message || ''))) return;
    block(`열린 요청 ${rows.filter((r) => L.isOpen(r) && L.isWork(r)).length}건이 있는데 답변 끝에 요청 표가 없습니다. 끝난 것 · 맡긴 것은 먼저 상태를 고치고(kedovi requests set <번호> --status 완료|진행|보류|취소 --agent … --result "…"), 답변 끝에 아래 표(kedovi requests table)를 붙여 끝낸다. 끄기: kedovi team-mode enforce req off\n\n${t}`);
  });
}

module.exports = { level };
