#!/usr/bin/env node
// 주간 사용량 속도 보기. 실행: kedovi usage [--json]
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../lib/usagepace');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ws = JSON.parse(fs.readFileSync(path.join(ROOT, 'workspace.json'), 'utf8'));
const kit = require(path.join(ROOT, 'bin', 'kit.js'));
const r = kit.resolveModels(ROOT, kit.loadWorkspace(ROOT));
const s = P.state(ws);
const lv = (r.enforce || {}).usagePace || 'block';
const applied = lv === 'block' && s.known ? s.level : 0;
const after = P.limitsFor(r.limits || {}, applied);
const show = (l) => `리더 ${l.leaders} × 팀원 ${l.members} · 메인 동시 ${l.parallel} · 요청당 ${l.total}`;
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ state: s, enforce: lv, plan: (r.limits || {}).room || null, limits: r.limits, applied: after }, null, 2));
  process.exit(0);
}
console.log(`요금제: ${((r.limits || {}).room || {}).label || '모름'} · 조절 수준: ${lv} (kedovi team-mode enforce pace)`);
console.log(P.line(s));
if (s.known) {
  const d = new Date(s.resetsAt);
  console.log(`주간 초기화: ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}${s.five ? ` · 5시간 창 ${Math.round(s.five.used)}%` : ' · 5시간 창 값 없음'}`);
} else console.log('값은 대화형 Claude Code 세션의 상태 줄이 첫 응답 뒤 적는다 (구독 계정만)');
console.log(`상한: ${show(r.limits || {})}${applied >= 2 ? ` → 지금 ${show(after)}` : ''}`);
if (applied === 3) console.log('절약 단계: implementer-deep 밖의 에이전트는 Opus 없이 부른다');
