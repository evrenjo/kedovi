#!/usr/bin/env node
// 요청 장부: 사용자 요청마다 번호 · 맡은 에이전트 · 상태 · 결과. 실행: kedovi requests
/*
 * 명령
 *   list [--all] [--json]                                                              열린 요청 (--all 이면 끝난 것까지)
 *   set <번호> [--status 접수|진행|완료|보류|취소] [--agent 이름] [--result "결과"]      상태 · 맡은 에이전트 · 결과 고치기
 *   table                                                                              열린 요청 표 (답변 끝에 붙이는 모양)
 *   add "<요청>"                                                                       손으로 한 줄 더하기 (훅이 못 본 요청)
 * 장부 = handoffs/<id>/topics/요청-목록.md. 요청 시작 훅(hooks/request-ledger.js)이 자동으로 적고, 열린 요청이 있으면 답변 끝 표를 검사한다
 */
'use strict';
const path = require('path');
const { devId } = require('../lib/workspace');
const L = require('../lib/requests');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
const has = (k) => argv.includes(`--${k}`);
const die = (m) => { console.error(`✖ ${m}`); process.exit(2); };

function me() {
  const id = devId(ROOT);
  if (!id) die('git config user.name 이 없습니다. 워크스페이스 루트에서 설정하세요');
  return id;
}

function cmdList() {
  const id = me();
  const rows = L.read(ROOT, id).filter((r) => has('all') || L.isOpen(r));
  if (has('json')) { console.log(JSON.stringify(rows, null, 2)); return 0; }
  if (!rows.length) { console.log(`열린 요청 없음 (장부: handoffs/${id}/topics/${L.NAME}.md)`); return 0; }
  console.log(L.HEAD);
  console.log('|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.no} | ${r.at} | ${r.text} | ${r.agent} | ${r.status} | ${r.result || '-'} |`);
  return 0;
}

function cmdSet() {
  const no = argv[1];
  if (!no || !/^\d+$/.test(no)) die('번호가 필요합니다: kedovi requests set <번호> --status 완료 --result "…"');
  const status = opt('status');
  if (status && !L.STATUSES.includes(status)) die(`--status 는 ${L.STATUSES.join(' · ')} 중 하나`);
  const patch = { status, agent: opt('agent'), result: opt('result') };
  if (Object.values(patch).every((v) => v === undefined)) die('--status · --agent · --result 중 하나는 있어야 합니다');
  const r = L.set(ROOT, me(), no, patch);
  if (!r) die(`#${no} 요청이 없습니다 (kedovi requests list --all)`);
  console.log(`✔ #${r.no} ${r.text} · ${r.agent} · ${r.status}${r.result ? ` · ${r.result}` : ''}`);
  return 0;
}

function cmdTable() {
  const t = L.table(L.read(ROOT, me()));
  console.log(t || '열린 요청 없음 (표를 붙이지 않아도 된다)');
  return 0;
}

function cmdAdd() {
  const text = argv.slice(1).filter((a) => !a.startsWith('--')).join(' ');
  if (!text.trim()) die('요청 내용이 필요합니다: kedovi requests add "<요청>"');
  const r = L.add(ROOT, me(), text, { agent: opt('agent') || '메인' });
  console.log(`✔ #${r.no} ${r.text}`);
  return 0;
}

if (require.main === module) {
  const c = argv[0];
  if (!c || c === 'list') process.exit(cmdList());
  if (c === 'set') process.exit(cmdSet());
  if (c === 'table') process.exit(cmdTable());
  if (c === 'add') process.exit(cmdAdd());
  console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(3, 9).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  process.exit(2);
}
