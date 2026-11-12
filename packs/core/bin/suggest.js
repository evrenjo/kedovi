#!/usr/bin/env node
// 기능 추천 기록 (kedovi suggest): 대화 중 추천받은 킷 기능과 사용자 결정 보기 · 기록 · 다시 묻기 · 끄기.
/*
 *   kedovi suggest                       추천 목록과 상태 (씀 · 안 씀 · 물음 n번 · 아직)
 *   kedovi suggest set <id> yes|no [--all]   결정 기록. 다시 묻지 않는다 (--all = 이 PC 의 모든 프로젝트)
 *   kedovi suggest reset [<id>]          다시 묻게 (id 없으면 전부)
 *   kedovi suggest off|on [--all]        추천 끄기 · 켜기 (--all = 모든 프로젝트)
 * 저장: .agents/local.json 의 suggest (이 워크스페이스 · 이 PC), ~/.kedovi/suggest.json (모든 프로젝트)
 */
'use strict';
const fs = require('fs');
const S = require('../lib/suggest');
const { root, load } = require('../lib/workspace');

const USAGE = '사용법: kedovi suggest [list] · set <id> yes|no [--all] · reset [<id>] · off|on [--all]';

function main(argv) {
  const R = root();
  const all = argv.includes('--all');
  const [cmd = 'list', id, v] = argv.filter((a) => a !== '--all');
  const map = S.loadMap();
  const ids = map.entries.map((e) => e.id);
  if (cmd === 'set') {
    if (!ids.includes(id) || !['yes', 'no'].includes(v)) { console.error(`${USAGE}\nid: ${ids.join(' · ')}`); return 1; }
    S.decide(R, id, v, all);
    console.log(`✔ ${id}: ${v === 'yes' ? '씀' : '안 씀'} (${all ? '이 PC 의 모든 프로젝트' : '이 워크스페이스'}). 다시 묻지 않습니다. 되돌리기: kedovi suggest reset ${id}`);
    return 0;
  }
  if (cmd === 'reset') {
    if (id && !ids.includes(id)) { console.error(`없는 id: ${id}\nid: ${ids.join(' · ')}`); return 1; }
    S.reset(R, id);
    console.log(`✔ ${id || '모든 추천'}: 다시 물을 수 있게 했습니다`);
    return 0;
  }
  if (cmd === 'off' || cmd === 'on') {
    S.setOff(R, cmd === 'off', all);
    console.log(`✔ 기능 추천 ${cmd === 'off' ? '끔' : '켬'} (${all ? '이 PC 의 모든 프로젝트' : '이 워크스페이스'})`);
    return 0;
  }
  if (cmd !== 'list') { console.error(USAGE); return 1; }
  let ws = {};
  try { ws = load(R); } catch { /* 워크스페이스 밖 */ }
  let local = {};
  try { local = JSON.parse(fs.readFileSync(S.localFile(R), 'utf8')); } catch { /* 없음 */ }
  const decided = S.decisions(R);
  const asked = S.askedOf(R);
  console.log(`기능 추천 ${S.globallyOff(R) ? '꺼짐 (켜기: kedovi suggest on)' : '켜짐'}: 대화 주제에 맞으면 한 세션에 ${S.PER_SESSION}개까지 답 끝에 한 줄로 묻고, 정한 것은 다시 묻지 않습니다\n`);
  for (const e of map.entries) {
    const d = decided[e.id];
    const a = asked[e.id];
    const st = d ? `${d.v === 'yes' ? '씀' : '안 씀'} ${d.at}${d.all ? ' (모든 프로젝트)' : ''}`
      : !S.whenOk(e.when, { ws, local, root: R }) ? '이미 씀 · 해당 없음'
        : a ? `물음 ${a.n}번` : '아직';
    console.log(`  ${e.id.padEnd(15)} ${st.padEnd(18)} ${e.say}: ${e.cmd}`);
  }
  console.log(`\n${USAGE}`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main };
