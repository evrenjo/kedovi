#!/usr/bin/env node
// SessionStart 훅 (Claude Code · Codex) — 팀과 다른 개인 모델 설정(이 PC 프로필 · 직접 지정 · 상한)이 적용 중이면 1줄로 알린다. 게이트웨이 목록에 없는 모델 환경변수가 있으면 ⚠ 1줄 더. 모두 팀 값이면 아무것도 쓰지 않는다. 항상 exit 0
// 판정은 bin/kit.js profileNotice (이 PC 프로필은 팀보다 낮은 것만 적용, 상한은 팀 값 이내). 되돌리기: kedovi models profile team
'use strict';
const path = require('path');
const { run, context, root } = require('../lib/hook');

run(() => {
  const ROOT = root();
  const kit = require(path.join(ROOT, 'bin', 'kit.js'));
  if (!kit.profileNotice) return;
  const ws = kit.loadWorkspace(ROOT);
  const lines = [];
  const notice = kit.profileNotice(ROOT, ws);
  if (notice) lines.push(`🎚 ${notice}`);
  // 게이트웨이 목록에 없는 모델을 가리키는 Claude Code 모델 환경변수 (저장된 목록만 본다, 네트워크 없음)
  try {
    const miss = kit.gatewayAliasCheck ? kit.gatewayAliasCheck(kit.resolveModels(ROOT, ws).access).problems : [];
    if (miss.length) lines.push(`⚠ 게이트웨이에 없는 모델: ${miss.map((x) => x.key).join(' · ')} (kedovi doctor 로 확인)`);
  } catch { /* 알림만 하는 훅 */ }
  if (lines.length) context(lines.join('\n'));
});
