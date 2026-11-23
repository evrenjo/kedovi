#!/usr/bin/env node
// 무거운 시험 순번 (실제 스택 · 설치 · 업그레이드 시험처럼 이 PC 에서 겹치면 안 되는 명령). 실행: kedovi heavy <명령> (node packs/core/bin/heavy.js <명령> 도 같다)
/*
 * 명령
 *   run [--name 이름] [--by 누가] [--dir 폴더] [--no-mise] -- <명령 …>   줄을 서고 차례가 오면 돌린다. 끝 코드 = 명령의 끝 코드. 오래 걸리니 백그라운드로
 *   status [--json]                                                     줄: 도는 것(시작 · 예상 끝) · 기다리는 것(예상 시작 · 끝) · 지금 부하와 기준
 *   set [--slots N] [--max-load 코어당 값] [--load-wait 분] [--reset]   이 PC 기준 바꾸기. 기다리는 작업도 다음 확인(3초) 때 읽는다
 * 기준 = kedovi heavy set → 환경 변수(KEDOVI_HEAVY_SLOTS · KEDOVI_HEAVY_MAX_LOAD · KEDOVI_HEAVY_LOAD_WAIT_MIN) → vars.verify.heavySlots · heavyMaxLoad · heavyLoadWaitMin
 * 예상 시간 = 같은 이름의 최근 성공 시간 중앙값 (.agents/heavy/history.json). 폴더에 mise 설정이 있으면 mise exec 안에서 돌린다 (도구 판 · corepack 캐시가 셸과 같게)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const H = require('../lib/heavy');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const head = dash >= 0 ? argv.slice(0, dash) : argv;
const opt = (k) => { const i = head.indexOf(`--${k}`); return i >= 0 ? head[i + 1] : undefined; };

const MISE_FILES = ['mise.toml', '.mise.toml', 'mise.local.toml', '.mise.local.toml', '.tool-versions', path.join('.config', 'mise.toml'), path.join('.mise', 'config.toml')];

/** dir 부터 위로 mise 설정이 있는가 (워크스페이스 루트 · 홈에서 멈춘다) */
function miseConfig(dir) {
  const stop = new Set([path.parse(dir).root, require('os').homedir()]);
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (stop.has(d)) return null;
    for (const f of MISE_FILES) if (fs.existsSync(path.join(d, f))) return path.join(d, f);
    if (d === ROOT || path.dirname(d) === d) return null;
  }
}

/**
 * 돌릴 명령을 mise exec 로 감쌀지: 폴더에 mise 설정이 있고 mise 가 있으면 감싼다 (이미 mise 환경이어도 해가 없다).
 * 에이전트 셸은 대화형 셸의 mise activate 를 거치지 않아 PATH 의 node · corepack 이 다른 판일 수 있다 (pnpm 캐시 못 찾음)
 */
function withMise(dir, cmd, shell) {
  if (head.includes('--no-mise') || process.env.KEDOVI_HEAVY_MISE === '0' || !miseConfig(dir)) return { cmd, shell };
  if (spawnSync('mise', ['--version'], { stdio: 'ignore', timeout: 5000 }).status !== 0) return { cmd, shell };
  return { cmd: shell ? ['mise', 'exec', '--', 'sh', '-c', cmd] : ['mise', 'exec', '--', ...cmd], shell: false, mise: true };
}

/** 줄을 서서 차례가 오면 cmd 를 돌린다 → 끝 코드. bin/verify.js full 도 쓴다. 기준은 확인마다 다시 읽는다 */
function runQueued({ name, by, dir, cmd, shell = false }) {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${process.pid}`;
    H.enter(ROOT, { id, name, by, pid: process.pid });
    let shown = '';
    const done = (code) => { H.leave(ROOT, id); resolve(code); };
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { H.leave(ROOT, id); process.exit(130); });
    const tick = () => {
      const cfg = H.settings(ROOT);
      const r = H.tryStart(ROOT, id, cfg);
      if (r.gone) { H.enter(ROOT, { id, name, by, pid: process.pid }); return setTimeout(tick, 3000); }
      if (!r.started) {
        const why = r.load ? `부하 코어당 ${r.load.perCore.toFixed(2)} > 기준 ${r.load.maxLoad}` : `앞에 ${r.ahead}개`;
        const key = `${r.ahead}|${!!r.load}|${cfg.slots}|${cfg.maxLoad}`;
        if (key !== shown) { shown = key; console.log(`⏳ ${name}: ${why} (kedovi heavy status · 기준 바꾸기 kedovi heavy set)`); for (const l of H.lines(ROOT, cfg).slice(1)) console.log(`   ${l}`); }
        return setTimeout(tick, 3000);
      }
      if (r.load && r.load.forced) console.log(`⚠ ${name}: 부하가 기준보다 높지만 ${cfg.loadWaitMin}분 기다려 시작 (코어당 ${r.load.perCore.toFixed(2)} > ${r.load.maxLoad})`);
      const exp = H.expected(ROOT, name);
      const run = withMise(dir, cmd, shell);
      console.log(`▶ ${name} 시작 ${H.clock(Date.now())}${exp ? ` · 예상 끝 ${H.clock(Date.now() + exp)} (보통 ${H.mins(exp)})` : ' · 예상 시간 기록 없음'}${run.mise ? ' · mise exec 안에서' : ''}`);
      const t0 = Date.now();
      // 환경은 그대로 넘긴다 (HOME · PATH · COREPACK_HOME · XDG_* 등). spawn 기본값이 process.env
      const child = run.shell ? spawn(run.cmd, { cwd: dir, stdio: 'inherit', shell: true, env: process.env }) : spawn(run.cmd[0], run.cmd.slice(1), { cwd: dir, stdio: 'inherit', env: process.env });
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

function cmdSet() {
  if (head.includes('--reset')) { H.setOverride(ROOT, { slots: null, maxLoad: null, loadWaitMin: null }); }
  const patch = {};
  const take = (flag, key, ok, msg) => {
    const v = opt(flag);
    if (v === undefined) return true;
    if (v === 'off' || v === 'default') { patch[key] = null; return true; }
    const n = Number(v);
    if (!ok(n)) { console.error(`✖ --${flag} ${msg}`); return false; }
    patch[key] = n;
    return true;
  };
  if (!take('slots', 'slots', (n) => Number.isInteger(n) && n > 0, '는 1 이상 정수') || !take('max-load', 'maxLoad', (n) => Number.isFinite(n) && n >= 0, '는 코어당 부하 (0 = 보지 않음, 예 0.8)') || !take('load-wait', 'loadWaitMin', (n) => Number.isFinite(n) && n >= 0, '는 분 (0 = 끝까지 기다림)')) return 2;
  if (!Object.keys(patch).length && !head.includes('--reset')) { console.error('✖ 바꿀 값: --slots N · --max-load 코어당 값 · --load-wait 분 · --reset (값 대신 default 면 그 값만 지움)'); return 2; }
  if (Object.keys(patch).length) H.setOverride(ROOT, patch);
  const cfg = H.settings(ROOT);
  console.log(`✔ 이 PC 기준: 동시 ${cfg.slots}개 · 코어당 부하 ${cfg.maxLoad || '보지 않음'}${cfg.maxLoad ? ` · ${cfg.loadWaitMin ? `${cfg.loadWaitMin}분 기다리면 시작` : '끝까지 기다림'}` : ''} (기다리는 작업도 3초 안에 따른다)`);
  return 0;
}

async function main() {
  const cmd = head[0];
  if (cmd === 'status') {
    const cfg = H.settings(ROOT);
    if (head.includes('--json')) { console.log(JSON.stringify({ settings: cfg, load: H.load(), queue: H.status(ROOT, cfg.slots) }, null, 2)); return 0; }
    for (const l of H.lines(ROOT, cfg)) console.log(l);
    return 0;
  }
  if (cmd === 'set') return cmdSet();
  if (cmd === 'run') {
    const rest = dash >= 0 ? argv.slice(dash + 1) : [];
    if (!rest.length) { console.error('✖ 돌릴 명령이 필요합니다: kedovi heavy run --name <이름> -- <명령 …>'); return 2; }
    const name = opt('name') || path.basename(rest[0]);
    const dir = opt('dir') ? path.resolve(opt('dir')) : process.cwd();
    return runQueued({ name, by: opt('by'), dir, cmd: rest.length === 1 && /\s/.test(rest[0]) ? rest[0] : rest, shell: rest.length === 1 && /\s/.test(rest[0]) });
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 11).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  return cmd ? 2 : 0;
}

if (require.main === module) main().then((c) => process.exit(c));
module.exports = { runQueued, withMise, miseConfig };
