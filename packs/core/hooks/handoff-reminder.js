#!/usr/bin/env node
// Stop 훅 — 이번 세션에 작업 repo 로 push 했는데 그 뒤 오늘 핸드오프가 없으면, 사용자에게 핸드오프 여부를 묻게 한다.
/*
 * 출력 계약: 막을 때만 {"decision":"block","reason":…} JSON, 아니면 아무것도 출력하지 않는다. 항상 exit 0.
 *
 * - push 판정은 도구 중립으로 git 에서 한다 — 원격 추적 ref 의 reflog 에 남는 "update by push" 기록의 시각.
 *   (transcript 형식은 도구마다 달라 보지 않는다)
 * - "이번 세션" = SessionStart 훅이 남긴 세션 시작 시각 이후. 표식이 없으면 오늘 0시 이후.
 * - 대상 repo = workspace.json repos (워크스페이스 repo 자신은 제외 — 핸드오프 푸시가 다시 훅을 부르는 루프 방지)
 * - 핸드오프 완료 = handoffs/{id}/{ISO주차}.md 에 오늘 섹션(## YYYY-MM-DD)이 있고 LATEST.md 가 마지막 push 이후에 갱신됨
 * - stop_hook_active 면 통과 (직전 stop 을 이 훅이 막았다 — 루프 방지)
 * - 워크스페이스 루트 .handoff-snooze 첫 줄이 이 세션 id 또는 오늘 날짜면 통과 (사용자가 "나중에" 라고 한 경우)
 * - 프로젝트 설정 vars.handoff.afterPush: ask(기본) = 사용자에게 묻게 · auto = 묻지 않고 핸드오프하게 · off = 보지 않는다
 * - 묶기 vars.handoff.bundleHours(기본 3): 오늘 핸드오프를 한 지 이 시간이 지나지 않았으면 그 뒤 push 는 시간이 지난 뒤 멈출 때 한 번에 기록한다 (push 마다 기록 커밋이 쌓이지 않게)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { run, readInput, block, sessionStartedAt } = require('../lib/hook');
const { load, devId, git, localDate, isoWeek } = require('../lib/workspace');

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** 이 repo 에서 since(ms) 이후 마지막 push 시각(ms). 없으면 0 */
function lastPushSince(repoDir, since) {
  const common = git(repoDir, ['rev-parse', '--git-common-dir']);
  if (!common) return 0;
  const logs = path.join(path.resolve(repoDir, common), 'logs', 'refs', 'remotes');
  let last = 0;
  for (const f of walk(logs)) {
    try { if (fs.statSync(f).mtimeMs < since) continue; } catch { continue; }
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/ (\d{9,}) [+-]\d{4}\t(.*)$/);
      if (!m || !/^update by push/.test(m[2])) continue;
      const ts = Number(m[1]) * 1000;
      if (ts >= since && ts > last) last = ts;
    }
  }
  return last;
}

function snoozed(rootDir, input) {
  let want;
  try { want = fs.readFileSync(path.join(rootDir, '.handoff-snooze'), 'utf8').split('\n')[0].trim(); } catch { return false; }
  return !!want && (want === String(input.session_id || '') || want === localDate());
}

/** 프로젝트 설정: { mode: ask | auto | off, bundleMs } */
function settings(ws) {
  const h = ((ws.vars || {}).handoff) || {};
  const mode = ['ask', 'auto', 'off'].includes(String(h.afterPush)) ? String(h.afterPush) : 'ask';
  const n = Number(h.bundleHours);
  return { mode, bundleMs: (Number.isFinite(n) && n >= 0 ? n : 3) * 3600000 };
}

run(() => {
  const input = readInput();
  if (input.stop_hook_active) return;
  const ws = load();
  const cfg = settings(ws);
  if (cfg.mode === 'off') return;
  if (snoozed(ws.root, input)) return;

  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const since = sessionStartedAt(input) || midnight.getTime();

  let lastPush = 0;
  const pushedRepos = [];
  for (const r of ws.repos) {
    if (!fs.existsSync(r.dir)) continue;
    const t = lastPushSince(r.dir, since);
    if (t) { pushedRepos.push(r.name); if (t > lastPush) lastPush = t; }
  }
  if (!lastPush) return;

  const id = devId(ws.root) || '{id}';
  const hdir = path.join(ws.root, 'handoffs', id);
  const today = localDate();
  let weekHasToday = false;
  try { weekHasToday = fs.readFileSync(path.join(hdir, `${isoWeek()}.md`), 'utf8').includes(`## ${today}`); } catch { /* 없음 */ }
  let latestAt = 0;
  try { latestAt = fs.statSync(path.join(hdir, 'LATEST.md')).mtimeMs; } catch { /* 없음 */ }
  if (weekHasToday && latestAt >= lastPush) return;
  // 묶기: 오늘 핸드오프를 한 지 얼마 안 됐으면 이번 push 는 다음 핸드오프에 함께 적는다
  if (weekHasToday && latestAt && Date.now() - latestAt < cfg.bundleMs) return;

  const sid = input.session_id ? String(input.session_id) : today;
  if (cfg.mode === 'auto') {
    block(
      `이번 세션에 작업 repo(${pushedRepos.join(', ')})로 push 했는데 그 뒤 핸드오프(handoffs/${id}/)가 아직 없습니다. ` +
      '프로젝트 설정(vars.handoff.afterPush = auto)에 따라 **묻지 않고** handoff 스킬로 지금 기록합니다 (이 설정이 기록 커밋 · push 승인이다). ' +
      `오늘 섹션(## ${today})이 이미 있으면 새로 만들지 말고 그 섹션에 덧붙이고, LATEST.md 를 고쳐 기록 커밋 하나로 올립니다. ` +
      '진행 중 작업을 작업 브랜치로 push 할지는 묻지 않고 「이 PC 에만 있음」 으로 적습니다. 기록 외의 다른 작업을 새로 시작하지 않습니다.'
    );
    return;
  }
  block(
    `이번 세션에 작업 repo(${pushedRepos.join(', ')})로 push 했는데 그 뒤 오늘 핸드오프(handoffs/${id}/)가 아직 없습니다. ` +
    '**먼저 사용자에게 "핸드오프 할까요?" 라고 묻고, 하겠다는 답을 받은 뒤에만** handoff 스킬을 따라 진행하세요. ' +
    `사용자가 나중에 하겠다고 하면 워크스페이스 루트의 .handoff-snooze 파일 첫 줄에 \`${sid}\` 를 적고 멈추세요(이 세션 동안 다시 묻지 않습니다). ` +
    '묻는 것 외에 다른 작업을 새로 시작하지 않습니다.'
  );
});
