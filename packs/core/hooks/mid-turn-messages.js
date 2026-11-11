#!/usr/bin/env node
// 작업 중 받은 메시지 점검 (Claude Code) — 메인이 일하는 사이 사용자가 보낸 메시지를 처리했는지 멈출 때 한 번 되묻는다
/*
 * 까닭: 도구가 도는 중에 보낸 메시지는 그 도구가 끝나면 같은 차례 안에 끼워 넣어지는데, 도구 결과 옆에 붙어 들어가 놓치는 일이 있다
 *       (Claude Code 알려진 문제). 대화 기록에는 attachment.type = "queued_command" 로 남는다.
 * Stop: 이번 요청(마지막 사용자 메시지) 뒤에 끼어 든 사람 메시지를 찾는다. 이미 알린 것은 다시 알리지 않는다 (delivery_id 기록).
 *   답변에 「작업 중 받은 메시지:」 줄이 있으면 처리한 것으로 보고 통과. 없으면 한 번 막고 메시지 앞부분을 보여 준다.
 * 수준 agents.enforce.midTurnMessages: block(기본) · off
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, block, run, root, safeId } = require('../lib/hook');
const { stateDir } = require('../lib/workspace');

const MARK = /작업 중 받은 메시지\s*:/;

/** 이번 요청 안에 끼어 든 사람 메시지 [{ id, text }] (대화 기록 JSONL, 끝에서 마지막 사용자 메시지까지) */
function midTurn(transcript) {
  let rows;
  try { rows = fs.readFileSync(transcript, 'utf8').split('\n'); } catch { return []; }
  const out = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    let d;
    try { d = JSON.parse(rows[i]); } catch { continue; }
    if (d.type === 'user' && !d.isMeta && !d.isCompactSummary) {
      const c = (d.message || {}).content;
      if (typeof c === 'string' || (Array.isArray(c) && c.some((x) => x.type === 'text') && !c.some((x) => x.type === 'tool_result'))) break;
    }
    const a = d.type === 'attachment' ? d.attachment || {} : null;
    if (!a || a.type !== 'queued_command' || (a.commandMode && a.commandMode !== 'prompt')) continue;
    if (a.origin && a.origin.kind && a.origin.kind !== 'human') continue;
    const text = typeof a.prompt === 'string' ? a.prompt : '';
    if (!text.trim()) continue;
    out.unshift({ id: String(a.delivery_id || a.source_uuid || d.uuid || text.slice(0, 40)), text });
  }
  return out;
}

run(() => {
  const input = readInput();
  if (String(input.hook_event_name || '') !== 'Stop') return;
  const id = safeId(input.session_id);
  if (!id || !input.transcript_path) return;
  const ROOT = root();
  let level = 'block';
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); level = (kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).enforce || {}).midTurnMessages || level; } catch { /* 옛 워크스페이스 */ }
  if (level !== 'block') return;
  const file = path.join(stateDir(ROOT), `${id}.midturn.json`);
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 처음 */ }
  if (!Array.isArray(seen)) seen = [];
  const fresh = midTurn(input.transcript_path).filter((m) => !seen.includes(m.id));
  if (!fresh.length) return;
  fs.writeFileSync(file, JSON.stringify([...seen, ...fresh.map((m) => m.id)].slice(-200)));
  if (MARK.test(String(input.last_assistant_message || ''))) return;
  const list = fresh.map((m, i) => `${i + 1}) «${m.text.replace(/\s+/g, ' ').slice(0, 120)}${m.text.length > 120 ? '…' : ''}»`).join(' ');
  block(`이번 작업 중에 사용자 메시지 ${fresh.length}건이 끼어 들어왔습니다: ${list}. `
    + '각각 처리했는지 확인한다. 안 했으면 지금 처리하거나(맡길 일이면 에이전트에), 답변 끝에 `작업 중 받은 메시지: <요약> → 처리함 | 할 일로 남김(이유)` 줄을 적고 끝낸다. '
    + '끄기: kedovi team-mode enforce msg off');
});
