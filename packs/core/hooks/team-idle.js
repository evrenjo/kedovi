#!/usr/bin/env node
// 대기 표시 점검 (Claude Code) — 사용자가 화면만 보고 "일하는 중" 으로 알고 기다리지 않게 한다. 종료는 리더가 한다 (훅은 종료하지 않는다)
//   TeammateIdle(팀원 세션): 대기 시작 시각을 적는다. 출력 없음
//   Notification(팀원 세션): 권한 승인 · 입력 대기를 적는다 (팀원 창의 질문은 리더에게 보이지 않아, 리더가 모른 채 기다리게 된다). 출력 없음
//   Stop(리더): 아래 둘 중 걸리는 것을 한 번 막고 알린다 (block JSON 하나)
//     상태 줄: 대기 · 일하는 팀원이나 리더의 백그라운드 작업이 남았는데 답변에 「지금 도는 것:」 줄이 없다. agents.enforce.waitStatus (off | block, 기본 block)
//     대기 팀원: 대기 상한을 넘은 팀원이 있다. agents.enforce.idleTeammates (off | warn | block, 기본 block) · idleMinutes(기본 10) · idleRemindMinutes(기본 30)
//     오래 일함: 일하는 팀원 · 위임 작업이 실행 상한을 넘었다. agents.enforce.longRunning (off | warn | block, 기본 block) · runMinutes(기본 60)
//   UserPromptSubmit(리더): 대기 상한 · 실행 상한을 넘은 것을 평문 한 줄로 (warn · block)
//   승인 대기 팀원: UserPromptSubmit 은 평문 한 줄, Stop 은 팀원마다 한 번 막고 알린다 (사용자에게 그 창에서 승인하라고 알리게)
//   종료 요청 뒤 남은 팀원: 종료 요청(shutdown_request)을 보내고 1분이 지나도 팀원 목록에 남으면 TaskStop 하라고 알린다 (idleTeammates 수준. 요청마다 한 번)
// 판정은 lib/teamidle.js · lib/longrun.js
'use strict';
const { readInput, block, context, run, root, isTeammate } = require('../lib/hook');
const T = require('../lib/teamidle');
const L = require('../lib/longrun');

run(() => {
  const input = readInput();
  const ev = String(input.hook_event_name || '');
  const ROOT = root();
  if (ev === 'TeammateIdle') { L.markIdle(ROOT, input.team_name, input.teammate_name); return T.markIdle(ROOT, input.team_name, input.teammate_name); }
  if (ev === 'Notification') { if (isTeammate(input)) T.markWait(ROOT, input); return; }
  if (ev !== 'Stop' && ev !== 'UserPromptSubmit') return;
  if (ev === 'Stop' && input.stop_hook_active) return; // 한 번만
  const team = !!T.members(input); // 이어서 시작해 세션 ID 가 바뀐 리더도 팀을 찾게 입력째로
  const w = ev === 'Stop' ? T.waiting(input) : { any: false };
  const reasons = [];
  // 오래 일하는 팀원 · 위임 (팀이 없어도 위임은 본다)
  if (team || L.delegations(ROOT).length) {
    const lr = L.settings(ROOT);
    if (lr.level !== 'off' && (ev !== 'Stop' || lr.level === 'block')) {
      const list = L.overrun(ROOT, input, lr, { mark: ev === 'Stop' || lr.level === 'warn' }); // 막기 수준은 멈출 때 막아야 하므로 요청 시작 때는 적지 않는다
      if (list.length) reasons.push(L.message(list, lr));
    }
  }
  // 승인 · 입력을 기다리며 멈춘 팀원 (Stop 은 같은 대기를 한 번만 막는다)
  if (team) {
    const ap = T.waitingApproval(ROOT, input);
    const fresh = ev === 'Stop' ? ap.filter((x) => !T.waitWarned(ROOT, input, x.name)) : ap;
    if (fresh.length) reasons.push(T.waitMessage(fresh));
  }
  if (!team && !w.any && !reasons.length) return; // 남은 것이 없는 세션은 설정도 읽지 않는다
  const st = T.settings(ROOT);
  if (ev === 'Stop' && st.status === 'block' && w.any && !T.hasStatus(input.last_assistant_message)) reasons.push(T.statusMessage(w));
  if (team && st.level !== 'off' && (ev !== 'Stop' || st.level === 'block')) {
    const list = T.overdue(ROOT, input, st);
    if (list.length) reasons.push(T.message(list, st));
  }
  // 종료 요청 뒤 1분이 지나도 남은 팀원 (승인이 안 와 TaskStop 이 필요). 같은 요청은 한 번만
  if (team && st.level !== 'off' && (ev !== 'Stop' || st.level === 'block')) {
    const stuck = T.stuckShutdown(ROOT, input);
    if (stuck.length) reasons.push(T.shutdownMessage(stuck));
  }
  if (!reasons.length) return;
  if (ev === 'Stop') block(reasons.join('\n'));
  else context(`⚠ ${reasons.join(' ')}`);
}, { teammateEvents: ['TeammateIdle', 'Notification'] });
