#!/usr/bin/env node
// CI · 로컬 자원 경합 확인 (읽기만). 사용: kedovi gitlab busy [--repo R] [--json]  · 다른 도구는 require 해서 localLoad · busyPipelines · warnBeforeLocalTest 를 부른다
'use strict';

/*
 * busy [--repo R] [--json]
 *     이 repo(와 repos[].gitlab.runnerGroup 이 같은 repo)의 도는 · 대기 파이프라인, 이 PC 의 무거운 프로세스(docker · gradle · 테스트 등 CPU 를 많이 쓰는 것).
 *     러너가 이 PC 와 같은 머신이면(vars.gitlab.localRunner = true) 둘이 겹칠 때 경고한다. 끝 코드: 0 겹침 없음 · 2 겹침(경고).
 *
 * 다른 명령이 쓰는 함수 (require('packs/gitlab/bin/ci-load.js')):
 *   localLoad(ws)                         → { heavy: [{pid, cpu, cmd}], cpu }   이 PC 의 무거운 프로세스
 *   busyPipelines(ws, r, { except })      → [{ repo, id, ref, status }]       같은 러너 그룹의 도는 · 대기 파이프라인
 *   localWarn(ws)                         → 경고 한 줄 | null                    CI 를 기다리는 동안: 로컬 무거운 작업이 돌면
 *   warnBeforeLocalTest(ws, r)            → 경고 한 줄 | null                    로컬 장애 · 시간 시험 전에: 러너 작업이 돌면
 */

const { execFileSync } = require('child_process');

// 무거운 프로세스 이름 (vars.gitlab.localHeavy 정규식으로 바꿀 수 있다)
const HEAVY = /docker|com\.docker|containerd|qemu|vfkit|colima|lima|virtualization|java|gradle|mvn|kotlin|node|python|pytest|go$|cargo|rustc|k6|gitlab-runner/i;

function mr() { return require('./gitlab-mr.js'); }
function gv(ws) { return (ws.vars && ws.vars.gitlab) || {}; }

/** ps 로 CPU 를 많이 쓰는 무거운 프로세스. 한 프로세스 cpuMin(기본 50%) 이상이거나, 합이 sumMin(기본 150%) 이상이면 heavy 에 담는다 */
function localLoad(ws, opt = {}) {
  const v = gv(ws);
  let re = HEAVY;
  try { if (v.localHeavy) re = new RegExp(v.localHeavy, 'i'); } catch { /* 잘못된 정규식은 기본값 */ }
  const cpuMin = Number(v.localCpu) || 50;
  let out = opt.ps;
  if (out === undefined) {
    try { out = execFileSync('ps', ['-A', '-o', 'pid=,pcpu=,comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { out = ''; }
  }
  const all = String(out).split('\n').map((l) => /^\s*(\d+)\s+([\d.]+)\s+(.+)$/.exec(l)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), cpu: Number(m[2]), cmd: m[3].trim().split('/').pop() }))
    .filter((p) => p.pid !== process.pid && re.test(p.cmd));
  const cpu = Math.round(all.reduce((s, p) => s + p.cpu, 0));
  const big = all.filter((p) => p.cpu >= cpuMin).sort((x, y) => y.cpu - x.cpu);
  const heavy = big.length ? big : cpu >= cpuMin * 3 ? all.sort((x, y) => y.cpu - x.cpu).slice(0, 5) : [];
  return { heavy, cpu };
}

/** 같은 러너 그룹(repos[].gitlab.runnerGroup 이 같은 repo, 없으면 이 repo 만)의 도는 · 대기 파이프라인 */
async function busyPipelines(ws, r, opt = {}) {
  const M = mr();
  const group = r.gitlab.runnerGroup;
  const repos = group ? ws.repos.filter((x) => x.gitlab && x.gitlab.runnerGroup === group && x.gitlab.projectId !== undefined) : [r];
  const except = new Set((opt.except || []).map(String));
  const out = [];
  for (const x of repos) {
    for (const st of ['running', 'pending']) {
      let list = [];
      try { list = await M.api(ws, x, 'GET', `/pipelines?status=${st}&per_page=20&order_by=id&sort=desc`); } catch { list = []; }
      for (const p of list) if (!except.has(String(p.id))) out.push({ repo: x.name, id: p.id, ref: p.ref, sha: p.sha, status: p.status, url: p.web_url });
    }
  }
  return out;
}

const procLine = (heavy) => heavy.slice(0, 4).map((p) => `${p.cmd} ${Math.round(p.cpu)}%`).join(' · ');

/** CI 를 기다리는 동안: 러너가 이 PC 인데 로컬에서 무거운 작업이 돌면 한 줄 */
function localWarn(ws, opt) {
  if (gv(ws).localRunner !== true) return null;
  const { heavy } = localLoad(ws, opt);
  if (!heavy.length) return null;
  return `⚠ 러너가 이 PC 인데 로컬에서 무거운 작업이 돈다 (${procLine(heavy)}). CI 의 시간 · 부하 시험이 불안정할 수 있습니다`;
}

/** 로컬 장애 · 시간 시험 전에: 러너가 이 PC 인데 러너 작업이 돌면 한 줄 */
async function warnBeforeLocalTest(ws, r) {
  if (gv(ws).localRunner !== true) return null;
  const busy = await busyPipelines(ws, r);
  if (!busy.length) return null;
  return `⚠ 러너가 이 PC 인데 CI 파이프라인이 돈다 (${busy.slice(0, 3).map((p) => `${p.repo} #${p.id} ${p.ref} ${p.status}`).join(' · ')}). 로컬 장애 · 시간 시험은 끝난 뒤에 돌린다`;
}

async function main(argv) {
  const M = mr();
  const a = M.parseArgs(argv);
  const ws = M.loadWs();
  const r = M.repoOrOnly(ws, a.repo);
  const local = gv(ws).localRunner === true;
  const load = localLoad(ws);
  const busy = await busyPipelines(ws, r);
  const clash = local && load.heavy.length > 0 && busy.length > 0;
  if (a.json) {
    console.log(JSON.stringify({ repo: r.name, localRunner: local, pipelines: busy, heavy: load.heavy, cpu: load.cpu, clash }));
    process.exit(clash ? 2 : 0);
  }
  console.log(`repo: ${r.name}${r.gitlab.runnerGroup ? ` · 러너 그룹 ${r.gitlab.runnerGroup}` : ''} · 러너가 이 PC: ${local ? '예' : '아니오 (vars.gitlab.localRunner)'}`);
  console.log(`CI: ${busy.length ? busy.map((p) => `${p.repo} #${p.id} ${p.ref} ${p.status}`).join(' · ') : '도는 파이프라인 없음'}`);
  console.log(`이 PC: ${load.heavy.length ? procLine(load.heavy) : '무거운 작업 없음'} (해당 프로세스 CPU 합 ${load.cpu}%)`);
  if (clash) console.log('⚠ 겹침: 같은 머신에서 CI 와 로컬 무거운 작업이 함께 돈다. 시간 · 부하 시험은 한쪽이 끝난 뒤에');
  else if (!local) console.log('러너가 다른 머신이라 로컬 부하는 CI 에 영향이 없습니다');
  process.exit(clash ? 2 : 0);
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });

module.exports = { main, localLoad, busyPipelines, localWarn, warnBeforeLocalTest, HEAVY };
