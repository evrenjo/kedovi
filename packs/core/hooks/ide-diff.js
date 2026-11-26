#!/usr/bin/env node
/**
 * 차례 끝 변경 보고 · IDE diff (Claude Code). 설정: kedovi prefs ide · ide-max · change-report (lib/idediff.js)
 * - UserPromptSubmit: repo 마다 HEAD 와 고친 중이던 파일 내용을 적어 둔다 (이번 차례의 시작점)
 * - Stop: 시작점과 달라진 파일이 있으면 사용자 화면에 repo · 브랜치 · 커밋 · 푸시 · 바뀐 파일 표를 띄우고(systemMessage, 에이전트는 다시 쓰지 않는다),
 *   ide 가 off 가 아니면 바뀐 파일을 IDE 에 띄운다 (수정 = diff, 새 파일 = 열기, 같은 내용은 다시 안 띄움, 최대 ide-max 개). 같은 결과는 다시 알리지 않는다
 * 메인 세션만 (팀원 · 서브에이전트는 보지 않는다). 항상 exit 0
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, run, root, safeId, isTeammate } = require('../lib/hook');
const { stateDir, load } = require('../lib/workspace');
const D = require('../lib/idediff');

run(() => {
  const input = readInput();
  const id = safeId(input.session_id);
  if (!id || isTeammate(input)) return;
  const ROOT = root();
  const prefs = D.resolve(ROOT);
  if (prefs.open === 'off' && prefs.report === 'off') return;
  const base = path.join(stateDir(ROOT), 'ide', id);
  const ev = String(input.hook_event_name || '');
  if (ev === 'UserPromptSubmit') {
    let ws;
    try { ws = load(ROOT); } catch { return; }
    D.snapshot(ws.repos, path.join(base, 'turn'));
    return;
  }
  if (ev !== 'Stop' || !fs.existsSync(path.join(base, 'turn', 'meta.json'))) return;
  const list = D.changes(path.join(base, 'turn'));
  if (!list.length) return;
  // 같은 결과(파일 · 커밋 · 푸시 상태)는 다시 알리지 않는다 (다른 훅이 멈춤을 되돌려 다시 멈출 때)
  const sig = JSON.stringify(list.map((r) => [r.name, r.branch, r.commits, r.uncommitted, r.ahead, r.files.map((f) => [f.file, f.kind, f.mtime])]));
  const sigFile = path.join(base, 'last.json');
  let last = '';
  try { last = fs.readFileSync(sigFile, 'utf8'); } catch { /* 처음 */ }
  if (last === sig) return;
  fs.writeFileSync(sigFile, sig);
  const seenFile = path.join(base, 'seen.json');
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch { seen = {}; }
  const res = D.openInIde(list, prefs, { tmpRoot: path.join(stateDir(ROOT), 'ide-tmp'), seen });
  fs.writeFileSync(seenFile, JSON.stringify(seen));
  if (prefs.report === 'off' && !res.opened.length && !res.skipped) return;
  const text = prefs.report === 'off'
    ? `IDE 에 띄움: ${res.opened.length}개${res.skipped ? ` (${res.skipped})` : ''}`
    : D.reportText(list, res);
  if (text) process.stdout.write(JSON.stringify({ systemMessage: text }));
});
