#!/usr/bin/env node
// 세션 상태 점검 (Claude Code) — 메모리 · 오래된 세션 · 팀원 tmux 기록. 막지 않고 요청 시작 때 한 줄로만 알린다. 항상 exit 0
/*
 * SessionStart · UserPromptSubmit:
 *   tmux 기록: 돌고 있는 tmux 서버(기본 · 팀원 창 소켓 claude-swarm-*)의 history-limit 을 vars.session.tmuxHistory(기본 50000) 이상으로 (그 뒤 만드는 창부터, 첫 팀원 창은 이전 값일 수 있다). 0 이면 하지 않는다. PostToolUse(Agent): 팀원을 띄운 직후에도
 * UserPromptSubmit (30분에 한 번):
 *   메모리: 이 PC 의 Claude Code 세션 나무(MCP · 셸 · 브라우저 포함) 합계가 vars.session.memoryWarnGB(기본 8)를 넘으면 세션 수 · 큰 세션 · 주인 없이 남은 브라우저 · MCP 를 한 줄로
 *   오래된 세션: 이 세션(claude 프로세스)이 vars.session.longHours(기본 8) 시간을 넘으면 핸드오프 뒤 새로 시작하라고 (같은 세션에 2시간마다)
 * 자세히: kedovi doctor 의 「메모리」 항목. 판정은 lib/procmem.js (Windows 는 하지 않는다)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readInput, context, run, root, safeId } = require('../lib/hook');
const { stateDir, load } = require('../lib/workspace');
const P = require('../lib/procmem');

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };

function settings(ROOT) {
  let v = {};
  try { v = ((load(ROOT).vars || {}).session) || {}; } catch { /* workspace.json 없음 */ }
  return { memGB: num(v.memoryWarnGB, 8), longHours: num(v.longHours, 8), tmuxHistory: num(v.tmuxHistory, 50000) };
}

/**
 * 돌고 있는 tmux 서버의 history-limit 을 올린다 (새 창부터). 기본 서버와 팀원 창 서버(소켓 claude-swarm-<번호>, Claude Code 가 따로 띄운다). 이미 크면 그대로
 */
function tmuxHistory(limit) {
  if (!limit || process.platform === 'win32') return;
  const uid = typeof process.getuid === 'function' ? process.getuid() : '';
  const socks = new Set(['default']);
  for (const d of [process.env.TMUX_TMPDIR, '/tmp', '/private/tmp'].filter(Boolean)) {
    try { for (const f of fs.readdirSync(path.join(d, `tmux-${uid}`))) if (f.startsWith('claude-swarm')) socks.add(f); } catch { /* 없음 */ }
  }
  for (const s of socks) {
    const cur = spawnSync('tmux', ['-L', s, 'show-options', '-gv', 'history-limit'], { encoding: 'utf8', timeout: 2000 });
    if (cur.status !== 0) continue; // tmux 없음 · 서버 없음
    if (Number(String(cur.stdout).trim()) >= limit) continue;
    spawnSync('tmux', ['-L', s, 'set-option', '-g', 'history-limit', String(limit)], { timeout: 2000 });
  }
}

/** 이 훅을 부른 claude 프로세스 (부모를 따라 올라간다) */
function ownSession(snap, procs) {
  const by = new Map(procs.map((p) => [p.pid, p]));
  let pid = process.ppid;
  for (let i = 0; i < 12 && pid > 1; i += 1) {
    const s = snap.sessions.find((x) => x.pid === pid);
    if (s) return s;
    pid = (by.get(pid) || {}).ppid || 0;
  }
  return null;
}

run(() => {
  const input = readInput();
  const ev = String(input.hook_event_name || '');
  const ROOT = root();
  const cfg = settings(ROOT);
  if (ev === 'SessionStart' || ev === 'UserPromptSubmit' || ev === 'PostToolUse') tmuxHistory(cfg.tmuxHistory); // PostToolUse(Agent): 팀원을 띄운 직후 (팀원 창 서버가 막 생겼을 때)
  if (ev !== 'UserPromptSubmit') return;
  const id = safeId(input.session_id);
  if (!id) return;
  const file = path.join(stateDir(ROOT), `${id}.health.json`);
  let st = {};
  try { st = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 처음 */ }
  const now = Date.now();
  if (st.checked && now - st.checked < 30 * 60000) return;
  st.checked = now;
  const procs = P.list();
  const snap = procs && P.snapshot(procs);
  const out = [];
  if (snap && cfg.memGB && snap.total > cfg.memGB * P.GB) {
    const big = snap.sessions.slice(0, 3).map((s) => `pid ${s.pid} ${P.gb(s.rss)} · ${P.hours(s.age)}`).join(', ');
    out.push(`⚠ 이 PC 의 Claude Code 메모리 합계 ${P.gb(snap.total)} (기준 ${cfg.memGB}GB): 세션 ${snap.sessions.length}개${big ? ` (큰 것 ${big})` : ''}${snap.orphans.length ? ` · 주인 없이 남은 브라우저 · MCP ${snap.orphans.length}개` : ''}${snap.docker !== null ? ` · Docker VM ${P.gb(snap.docker)} 따로` : ''}. 안 쓰는 세션 · 대기 팀원을 닫으라고 사용자에게 한 줄 알린다 (자세히: kedovi doctor)`);
  }
  const mine = snap && procs ? ownSession(snap, procs) : null;
  if (mine && cfg.longHours && mine.age > cfg.longHours * 3600 && (!st.longWarned || now - st.longWarned > 2 * 3600000)) {
    st.longWarned = now;
    out.push(`⚠ 이 세션이 ${P.hours(mine.age)} 째입니다 (기준 ${cfg.longHours}시간, 메모리 ${P.gb(mine.rss)}). 이번 요청을 마치면 핸드오프를 남기고 새로 시작하자고 사용자에게 한 줄 제안한다 (새 세션은 핸드오프로 이어진다)`);
  }
  try { fs.writeFileSync(file, JSON.stringify(st)); } catch { /* 기록 실패 */ }
  if (out.length) context(out.join('\n'));
});
