#!/usr/bin/env node
// 기능 추천 (Claude Code · Codex UserPromptSubmit): 대화 주제 · 워크스페이스 상태에 맞는 킷 기능(팩 · 명령 · 설정)이 아직 안 쓰이고
// 사용자가 정한 적이 없으면, 에이전트에게 "답 끝에 한 줄로 쓸지 묻기" 후보 하나를 넣는다. 사용자가 정하면(kedovi suggest set) 다시 묻지 않는다.
// 지도 packs/core/suggest-map.json · 로직 lib/suggest.js (세션 상한 · 간격 · 물은 횟수). 끄기: kedovi suggest off [--all]. 출력: 평문 (두 도구 모두 문맥에 더함)
'use strict';
const fs = require('fs');
const path = require('path');
const { run, readInput, context, safeId, root } = require('../lib/hook');
const { stateDir, load } = require('../lib/workspace');
const S = require('../lib/suggest');

if (require.main === module) {
  run(() => {
    const input = readInput();
    const R = root();
    if (S.globallyOff(R)) return;
    const id = safeId(input.session_id);
    if (!id) return;
    const file = path.join(stateDir(R), `${id}.suggest`);
    let session = { n: 0, last: 0, ids: [] };
    try { session = { ...session, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* 처음 */ }
    session.n += 1;
    const save = () => { try { fs.writeFileSync(file, JSON.stringify(session)); } catch { /* 상태는 편의 */ } };
    let ws;
    try { ws = load(R); } catch { save(); return; }
    let local = {};
    try { local = JSON.parse(fs.readFileSync(S.localFile(R), 'utf8')); } catch { /* 없음 */ }
    const e = S.pick(S.loadMap(), { root: R, ws, local, prompt: input.prompt || input.user_prompt || '', session });
    if (e) {
      session.ids.push(e.id);
      session.last = session.n;
      try { S.markAsked(R, e.id); } catch { /* 기록은 편의 */ }
      context(S.line(e));
    }
    save();
  });
}
