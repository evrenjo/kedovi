#!/usr/bin/env node
// 긴 답 점검 (Claude Code) — 마지막 답변 글이 길면(기준 줄 수 초과 · 큰 표) 보고 페이지로 옮기라고 한 번 되돌린다
/*
 * 까닭: 작업 보고가 길면 화면에서 다 읽지 못한다. 채팅은 결론 · 핵심 · 「자세히: <링크>」, 자세한 것은 kedovi report 페이지.
 * Stop: last_assistant_message 의 빈 줄 아닌 줄이 vars.report.maxLines(기본 25)를 넘거나, 표 줄이 12줄을 넘는데 「자세히:」 링크가 없으면 한 번 막는다 (요청마다 한 번)
 * 코드 블록 안 줄 · 오류 출력은 센다 (그대로 두라고 알린다). 사용자가 「자세히」 · 「전부」 · 「길게」 를 요청했으면 보지 않는다
 * 수준 agents.enforce.longAnswer (off | block, 기본 block)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, block, run, root, safeId } = require('../lib/hook');
const { stateDir, load } = require('../lib/workspace');

const LINK = /자세히\s*[::]\s*\S+/;
const WANTS_LONG = /자세히|전부|전체|길게|상세|모두 보여|다 보여|full|detail/i;

run(() => {
  const input = readInput();
  const id = safeId(input.session_id);
  if (!id) return;
  const ROOT = root();
  const ev = String(input.hook_event_name || '');
  const mark = path.join(stateDir(ROOT), `${id}.longanswer`);
  if (ev === 'UserPromptSubmit') {
    if (WANTS_LONG.test(String(input.prompt || '').replace(/<pasted_content[\s\S]*?<\/pasted_content[^>]*>/g, ''))) fs.writeFileSync(mark, 'skip');
    else { try { fs.unlinkSync(mark); } catch { /* 없음 */ } }
    return;
  }
  if (ev !== 'Stop' || input.stop_hook_active) return;
  if (fs.existsSync(mark)) return; // 길게 요청했거나 이번 요청에 이미 알림
  const text = String(input.last_assistant_message || '');
  if (!text || LINK.test(text)) return;
  let level = 'block';
  let max = 25;
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); level = (kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).enforce || {}).longAnswer || level; } catch { /* 옛 워크스페이스 */ }
  try { const v = Number((((load(ROOT).vars || {}).report) || {}).maxLines); if (Number.isFinite(v) && v > 0) max = v; } catch { /* 기본 */ }
  if (level !== 'block') return;
  const lines = text.split('\n').filter((l) => l.trim());
  const tableRows = lines.filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l)).length;
  if (lines.length <= max && tableRows <= 12) return;
  fs.writeFileSync(mark, 'warned');
  block(`답이 깁니다 (${lines.length}줄${tableRows > 12 ? ` · 표 ${tableRows}줄` : ''}, 기준 ${max}줄). 사용자는 화면에서 다 읽지 못합니다. kedovi report new "<제목>"(안 되면 node packs/core/bin/report.js new "<제목>")이 준 파일에 자세한 내용(바뀐 파일 · 검증 표 · 근거 · 남은 것)을 옮기고, 답을 결론 1줄 + 핵심 3~5줄 + 「자세히: <링크>」 로 다시 씁니다. 오류 · 실패 · 사용자가 정할 것은 채팅에 남깁니다. 끄기: kedovi team-mode enforce long off`);
});
