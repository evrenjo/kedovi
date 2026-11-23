#!/usr/bin/env node
// 팀원 끝남 기다리기 (Claude Code 작업 리더용): 리더가 차례를 끝내지 않고 팀원이 끝날 때까지 이 명령 안에서 기다린다.
/*
 * 까닭: 리더가 팀원이 도는 채 차례를 끝내면 Claude Code 가 그때마다 메인에 중간 알림(「… is waiting on its own background work」)을 보낸다.
 *   메인은 알림마다 한 차례를 돌아 맥락 전체를 다시 읽는다 (대기 한 번에 알림 한 번, 리더 하나가 수십 번).
 *   이 명령은 앞에서(백그라운드 아님) 돌며 팀원 하나가 끝나면 바로 끝난다. 팀원 결과 알림은 리더의 다음 도구 호출 사이에 들어온다.
 * 실행: node packs/core/bin/agent-wait.js --session <세션 id> --parent <리더 agent id> [--max 540]
 *       node packs/core/bin/agent-wait.js <팀원 agent id> … [--max 540]      (Agent 도구 결과의 agentId 로)
 *   기록 = hooks/agent-budget.js 가 적는 상태 폴더의 <세션>.agents.json (kids: 팀원 id → 부른 쪽 · 역할). SubagentStop 에 그 칸이 빠진다
 *   종료 코드 0 = 팀원 하나 이상 끝남 (또는 기다릴 팀원 없음) · 3 = --max 초가 지남 (아직 도는 팀원을 찍는다. 같은 명령을 다시)
 * 읽기만 한다. 팀원을 멈추거나 메시지를 보내지 않는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
const FLAGS = new Set(['--session', '--parent', '--max', '--every']);
const ids = argv.filter((a, i) => !a.startsWith('--') && !FLAGS.has(argv[i - 1]));

function stateFiles() {
  const { stateDir } = require('../lib/workspace');
  const dir = stateDir(ROOT);
  const sid = opt('session');
  if (sid) return [path.join(dir, `${String(sid).replace(/[^A-Za-z0-9._-]/g, '_')}.agents.json`)];
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.agents.json')).map((f) => path.join(dir, f)); } catch { return []; }
}

/** 지금 도는 기다릴 팀원 → [{ id, type }] */
function running(files) {
  const parent = opt('parent');
  const out = [];
  for (const f of files) {
    let st;
    try { st = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    for (const [id, v] of Object.entries(st.kids || {})) {
      const mine = parent ? String(v.parent) === String(parent) : ids.some((x) => id === x || (x.length >= 6 && (id.startsWith(x) || x.startsWith(id))));
      if (mine) out.push({ id, type: v.type || '에이전트' });
    }
  }
  return out;
}

function main() {
  if (!opt('parent') && !ids.length) {
    console.error('✖ --session <세션> --parent <리더 id> 또는 기다릴 팀원 agent id 가 필요합니다');
    return 2;
  }
  const maxSec = Math.max(1, Number(opt('max')) || 540);
  const every = Math.max(1, Number(opt('every')) || 3) * 1000;
  const files = stateFiles();
  const start = running(files);
  if (!start.length) { console.log('기다릴 팀원 없음 (모두 끝났거나 기록 없음). 받은 결과로 다음 순서를 진행한다'); return 0; }
  const until = Date.now() + maxSec * 1000;
  const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { const t = Date.now() + ms; while (Date.now() < t) { /* 기다림 */ } } };
  for (;;) {
    sleep(every);
    const now = running(files);
    const done = start.filter((x) => !now.some((y) => y.id === x.id));
    if (done.length) {
      console.log(`✔ 끝난 팀원: ${done.map((x) => `${x.type}(${x.id})`).join(' · ')}${now.length ? ` · 아직 도는 팀원: ${now.map((x) => `${x.type}(${x.id})`).join(' · ')}` : ''}`);
      console.log('결과 알림을 받아 확인하고 다음 순서로 넘어간다. 남은 팀원을 기다릴 때는 차례를 끝내지 말고 이 명령을 다시 부른다');
      return 0;
    }
    if (Date.now() >= until) {
      console.log(`⏳ ${maxSec}초 동안 끝난 팀원 없음 · 도는 팀원: ${now.map((x) => `${x.type}(${x.id})`).join(' · ')}`);
      console.log('보고 주기가 됐으면 진행판(kedovi team step)과 메인 메시지로 단계를 알리고, 같은 명령으로 다시 기다린다. 팀원이 멈춘 것 같으면 메인에게 「끊어 달라」 를 보낸다');
      return 3;
    }
  }
}

if (require.main === module) process.exit(main());
module.exports = { running };
