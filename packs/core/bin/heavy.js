#!/usr/bin/env node
// 무거운 시험 순번 (실제 스택 · 설치 · 업그레이드 시험처럼 이 PC 에서 겹치면 안 되는 명령). 실행: kedovi heavy <명령>
/*
 * 명령
 *   run [--name 이름] [--by 누가] [--dir 폴더] -- <명령 …>   줄을 서고 차례가 오면 돌린다. 끝 코드 = 명령의 끝 코드. 오래 걸리니 백그라운드로
 *   status [--json]                                          줄: 도는 것(시작 · 예상 끝) · 기다리는 것(예상 시작 · 끝). 보고의 예상 종료는 이것으로
 * 동시 개수 vars.verify.heavySlots(기본 1). 예상 시간 = 같은 이름의 최근 성공 시간 중앙값 (.agents/heavy/history.json)
 */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const H = require('../lib/heavy');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const head = dash >= 0 ? argv.slice(0, dash) : argv;
const opt = (k) => { const i = head.indexOf(`--${k}`); return i >= 0 ? head[i + 1] : undefined; };

function slots() {
  try {
    const v = ((require('../lib/workspace').load(ROOT).vars || {}).verify || {}).heavySlots;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : 1;
  } catch { return 1; }
}

/** 줄을 서서 차례가 오면 cmd 를 돌린다 → 끝 코드. bin/verify.js full 도 쓴다 */
function runQueued({ name, by, dir, cmd, shell = false }) {
  return new Promise((resolve) => {
    const n = slots();
    const id = `${Date.now()}-${process.pid}`;
    H.enter(ROOT, { id, name, by, pid: process.pid });
    let shown = -1;
    const done = (code) => { H.leave(ROOT, id); resolve(code); };
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { H.leave(ROOT, id); process.exit(130); });
    const tick = () => {
      const r = H.tryStart(ROOT, id, n);
      if (r.gone) { H.enter(ROOT, { id, name, by, pid: process.pid }); return setTimeout(tick, 3000); }
      if (!r.started) {
        if (r.ahead !== shown) { shown = r.ahead; console.log(`⏳ ${name}: 앞에 ${r.ahead}개 (kedovi heavy status)`); for (const l of H.lines(ROOT, n).slice(1)) console.log(`   ${l}`); }
        return setTimeout(tick, 3000);
      }
      const exp = H.expected(ROOT, name);
      console.log(`▶ ${name} 시작 ${H.clock(Date.now())}${exp ? ` · 예상 끝 ${H.clock(Date.now() + exp)} (보통 ${H.mins(exp)})` : ' · 예상 시간 기록 없음'}`);
      const t0 = Date.now();
      const child = shell ? spawn(cmd, { cwd: dir, stdio: 'inherit', shell: true }) : spawn(cmd[0], cmd.slice(1), { cwd: dir, stdio: 'inherit' });
      child.on('error', (e) => { console.error(`✖ ${e.message}`); H.addHistory(ROOT, name, Date.now() - t0, false); done(127); });
      child.on('exit', (code, sig) => {
        const c = code == null ? (sig ? 128 : 1) : code;
        H.addHistory(ROOT, name, Date.now() - t0, c === 0);
        console.log(`${c === 0 ? '✔' : '✖'} ${name} ${c === 0 ? '통과' : `실패 (끝 코드 ${c})`} · ${H.mins(Date.now() - t0)}`);
        done(c);
      });
    };
    tick();
  });
}

async function main() {
  const cmd = head[0];
  if (cmd === 'status') {
    if (head.includes('--json')) { console.log(JSON.stringify(H.status(ROOT, slots()), null, 2)); return 0; }
    for (const l of H.lines(ROOT, slots())) console.log(l);
    return 0;
  }
  if (cmd === 'run') {
    const rest = dash >= 0 ? argv.slice(dash + 1) : [];
    if (!rest.length) { console.error('✖ 돌릴 명령이 필요합니다: kedovi heavy run --name <이름> -- <명령 …>'); return 2; }
    const name = opt('name') || path.basename(rest[0]);
    const dir = opt('dir') ? path.resolve(opt('dir')) : process.cwd();
    return runQueued({ name, by: opt('by'), dir, cmd: rest.length === 1 && /\s/.test(rest[0]) ? rest[0] : rest, shell: rest.length === 1 && /\s/.test(rest[0]) });
  }
  const fs = require('fs');
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 8).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  return cmd ? 2 : 0;
}

if (require.main === module) main().then((c) => process.exit(c));
module.exports = { runQueued };
