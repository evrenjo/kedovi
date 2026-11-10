#!/usr/bin/env node
// 세션 브리핑 — 프로젝트 · 로드맵(handoffs/PLAN.md: 한 줄 + 단계 흐름도 + 지금 단계 표) · 공지(NOTICE.md) · 마지막 핸드오프 · 진행 중 작업(미완 완료 조건) · 사용자가 등록한 TODO 를 짧게 적는다.
// 세션 시작 훅(hooks/session-brief.js)이 이 내용을 컨텍스트로 넘기고, kedovi start 의 첫 메시지 "세션 브리핑" 한 줄에 에이전트가 표로 보여 준다. 실행: node packs/core/bin/brief.js
'use strict';
const fs = require('fs');
const path = require('path');
const { load, devId, localDate } = require('../lib/workspace');
const { activeTopics, listTopics, isOpen, dueTopics } = require('../lib/topics');
const { referenceStatus, describe } = require('../lib/refs');

function briefText() {
const ws = load();
const ROOT = ws.root;
const id = devId(ROOT);
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
let TYPES = {};
try { TYPES = require(path.join(ROOT, 'bin', 'kit.js')).PROJECT_TYPES || {}; } catch { /* 옛 워크스페이스 */ }

const out = [];
const p = ws.project || {};
out.push(`프로젝트: ${p.title || p.name || path.basename(ROOT)} · ${TYPES[p.type] || p.type || '유형 없음'} · repo: ${(ws.repos || []).map((r) => r.name).join(', ') || '없음'}`);
const P = require('../lib/plan');
const plan = P.read(ROOT);
out.push(plan ? P.shortLine(plan, P.externalOf(ws), (ws.project || {}).type) : P.externalOf(ws) ? `일정 정본: ${P.externalOf(ws)}` : `로드맵 없음 (${P.FILE}). kedovi plan init 으로 만든다`);
// 처음 시작할 때 전체 위치가 보이게 — 흐름도와 지금 단계 표 (이번에 생긴 것은 git 을 세야 해서 kedovi plan 에서)
if (plan) {
  const cur = P.current(plan);
  out.push('', '로드맵 (아래 그림 · 표는 그대로 보여 준다):', '```', P.flow(plan), '```', ...(cur ? ['', P.detailTable(cur)] : []));
}
const refs = referenceStatus(ws);
if (refs.length) out.push(`참고 자료: ${refs.map(describe).join(' · ')}${refs.some((s) => s.state !== 'ok') ? ' (비어 있는 자료는 인용하지 말고 "문서 없음" 으로 답한다)' : ''}`);
const notice = read(path.join(ROOT, 'NOTICE.md')).trim();
if (notice) out.push('', '공지 (NOTICE.md):', ...notice.split('\n').slice(0, 8).map((l) => `  ${l}`));

const hdir = id ? path.join(ROOT, 'handoffs', id) : '';
const latest = hdir ? read(path.join(hdir, 'LATEST.md')) : '';
if (!latest) {
  out.push('', `첫 세션입니다${id ? ` (${id})` : ''}. 아직 핸드오프 기록이 없습니다.`,
    '시작: 요청을 바로 말하거나 go 스킬("시작")로 영향 범위 · 할 일 · 검증 계획을 먼저 받는다. 끝낼 때는 handoff 스킬("핸드오프")로 기록을 남긴다.');
} else {
  const date = (latest.match(/^#.*?\((\d{4}-\d{2}-\d{2})\)/m) || [])[1];
  const days = date ? Math.floor((new Date(localDate()) - new Date(date)) / 86400000) : null;
  const sec = (name) => { const s = latest.split(/^##\s+/m).find((x) => x.startsWith(name)); return s ? s.split('\n').slice(1).map((l) => l.replace(/^\s*[-*]\s+/, '').trim()).filter((l) => l && l !== '없음') : []; };
  out.push('', `마지막 핸드오프: ${date || '날짜 없음'}${days === 0 ? ' (오늘)' : days > 0 ? ` (${days}일 전)` : ''}`);
  out.push(...sec('오늘 핵심').slice(0, 3).map((l) => `  핵심: ${l}`));
  out.push(...sec('진행 중').slice(0, 3).map((l) => `  진행 중: ${l}`));
  const topics = activeTopics(ROOT, id, Date.now() - 14 * 86400000, localDate()).slice(0, 3);
  const openN = listTopics(ROOT, id).filter(isOpen).length;
  if (topics.length || openN) out.push('', `미완 작업 ${openN}건 (topics/ 진행 중 + 완료 조건 [ ]. 남은 일의 정본)${topics.length ? ':' : ''}`, ...topics.map((t) => `  ${t.name}: ${t.summary || t.status}${t.todo.length ? ` · 미완 ${t.todo.length}: ${t.todo.slice(0, 3).join('; ')}` : ''}${(t.waiting || []).length ? ` · 결정 대기 ${t.waiting.length}: ${t.waiting.slice(0, 2).join('; ')}` : ''}`));
  const due = dueTopics(ROOT, id);
  const dueLines = due.flatMap((t) => [...t.dueToday.map((x) => `  📅 오늘 예정 · ${t.name}: ${x.text}`), ...t.overdue.map((x) => `  ⚠ 지난 예약 ${x.date} · ${t.name}: ${x.text} (했으면 [x], 미루면 날짜를 고친다)`)]);
  const next = listTopics(ROOT, id).filter((t) => t.status === '진행 중').flatMap((t) => t.later.map((x) => ({ ...x, name: t.name }))).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (dueLines.length || next.length) out.push('', '날짜 예약 ([>])', ...dueLines.slice(0, 5), ...(next.length ? [`  다음 예약: ${next.slice(0, 3).map((x) => `${x.date} ${x.name}: ${x.text}`).join(' · ')}`] : []));
  const todo = read(path.join(hdir, 'TODO.md')).split('\n').filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, '').trim());
  out.push('', `내 TODO ${todo.length}건 (사용자가 등록한 것)${todo.length ? ':' : ''}`, ...todo.slice(0, 5).map((l) => `  - ${l}`), ...(todo.length > 5 ? [`  … 외 ${todo.length - 5}건`] : []));
}
return out.join('\n');
}

module.exports = { briefText };
if (require.main === module) process.stdout.write(`${briefText()}\n`);
