// 기능 · 설정 추천 (feature-suggest 훅 · kedovi suggest): 대화 주제 · 워크스페이스 상태에 맞는 킷 기능을 가끔 한 줄 추천하고,
// 사용자가 정한 것(씀 · 안 씀)은 다시 묻지 않는다.
/*
 * 지도: packs/core/suggest-map.json (entries: id · topic · when · say · why · cmd · scope · anytime)
 * 결정: 이 워크스페이스 · 이 PC = .agents/local.json 의 suggest.decided, 모든 프로젝트 = ~/.kedovi/suggest.json 의 decided (--all)
 * 물은 기록: .agents/local.json 의 suggest.asked { id: { n, at } }. 답 없이 2번 물으면 14일 쉬고, 3번이면 다시 묻지 않는다 (reset 으로 되살림)
 * 세션 상한: 한 세션에 2개, 추천 사이 요청 4개 이상, anytime(주제 없이) 항목은 요청 8개째부터. 상태: stateDir 의 <세션>.suggest
 * 의존성 없음.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const PER_SESSION = 2;
const GAP = 4;
const ANYTIME_AFTER = 8;
const REST_DAYS = 14;
const MAX_ASK = 3;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`); };
const localFile = (root) => path.join(root, '.agents', 'local.json');
const globalFile = () => path.join(process.env.KEDOVI_HOME || path.join(os.homedir(), '.kedovi'), 'suggest.json');
const get = (o, dot) => String(dot).split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

function loadMap(dir = path.join(__dirname, '..')) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'suggest-map.json'), 'utf8'));
}

/** 상태 조건: 모두 맞아야 추천 (이미 쓰는 기능은 추천하지 않는다) */
function whenOk(when, ctx) {
  if (!when) return true;
  const { ws, local, root } = ctx;
  const packs = ws.packs || [];
  if (when.packOn && !packs.includes(when.packOn)) return false;
  if (when.packOff && packs.includes(when.packOff)) return false;
  for (const k of [].concat(when.unset || [])) if (!empty(get(ws, k))) return false;
  for (const k of [].concat(when.localUnset || [])) if (!empty(get(local, k))) return false;
  for (const [k, v] of Object.entries(when.not || {})) if (get(ws, k) === v) return false;
  if (when.stack) {
    const re = new RegExp(when.stack, 'i');
    if (!(ws.repos || []).some((r) => re.test(JSON.stringify([r.stacks || [], r.languages || []])))) return false;
  }
  if (when.notify) {
    let on = false;
    try { const N = require('./notify'); const p = N.personal(root, ws); on = !!p.chat && p.level !== 'off'; } catch { /* 알림 모듈 없음 */ }
    if ((when.notify === 'off') === on) return false;
  }
  if (when.localNot) for (const [k, v] of Object.entries(when.localNot)) if (get(local, k) === v) return false;
  return true;
}

/** 결정 { id: { v: 'yes'|'no', at, all? } } (이 워크스페이스가 모든 프로젝트 결정보다 먼저) */
function decisions(root) {
  const g = readJson(globalFile()).decided || {};
  const l = (readJson(localFile(root)).suggest || {}).decided || {};
  const out = {};
  for (const [k, v] of Object.entries(g)) out[k] = { ...v, all: true };
  return Object.assign(out, l);
}

function askedOf(root) { return (readJson(localFile(root)).suggest || {}).asked || {}; }

function globallyOff(root) {
  return readJson(localFile(root)).suggest?.off === true || readJson(globalFile()).off === true || process.env.KEDOVI_SUGGEST === '0';
}

/** 지금 물어도 되는가 (결정 없음 · 물은 횟수 · 쉬는 기간) */
function askable(id, decided, asked, now = Date.now()) {
  if (decided[id]) return false;
  const a = asked[id];
  if (!a) return true;
  if (a.n >= MAX_ASK) return false;
  if (a.n >= 2 && now - Date.parse(a.at || 0) < REST_DAYS * 86400000) return false;
  return true;
}

/**
 * 이번 요청에 넣을 추천 하나 (없으면 null)
 * ctx = { root, ws, local, prompt, session: { n, last, ids } }
 */
function pick(map, ctx, now = Date.now()) {
  const s = ctx.session;
  if (s.ids.length >= PER_SESSION) return null;
  if (s.ids.length && s.n - s.last < GAP) return null;
  const text = String(ctx.prompt || '');
  const decided = decisions(ctx.root);
  const asked = askedOf(ctx.root);
  const ok = (e) => !s.ids.includes(e.id) && askable(e.id, decided, asked, now) && whenOk(e.when, ctx);
  const byTopic = (map.entries || []).find((e) => e.topic && new RegExp(e.topic, 'i').test(text) && ok(e));
  if (byTopic) return byTopic;
  if (s.n >= ANYTIME_AFTER && text.length >= 8) return (map.entries || []).find((e) => e.anytime && ok(e)) || null;
  return null;
}

function markAsked(root, id, now = new Date()) {
  const f = localFile(root);
  const l = readJson(f);
  l.suggest = l.suggest || {};
  l.suggest.asked = l.suggest.asked || {};
  const a = l.suggest.asked[id] || { n: 0 };
  l.suggest.asked[id] = { n: a.n + 1, at: now.toISOString() };
  writeJson(f, l);
}

/** 결정 기록: v = yes(씀) · no(안 씀). all = 모든 프로젝트 */
function decide(root, id, v, all = false) {
  const f = all ? globalFile() : localFile(root);
  const o = readJson(f);
  const box = all ? o : (o.suggest = o.suggest || {});
  box.decided = box.decided || {};
  box.decided[id] = { v, at: new Date().toISOString().slice(0, 10) };
  writeJson(f, o);
}

/** 다시 묻게: id 없으면 전부. 이 워크스페이스와 모든 프로젝트 결정 모두에서 지운다 */
function reset(root, id) {
  const lf = localFile(root);
  const l = readJson(lf);
  if (l.suggest) {
    for (const k of ['decided', 'asked']) if (l.suggest[k]) { if (id) delete l.suggest[k][id]; else delete l.suggest[k]; }
    writeJson(lf, l);
  }
  const gf = globalFile();
  if (fs.existsSync(gf)) {
    const g = readJson(gf);
    if (g.decided) { if (id) delete g.decided[id]; else delete g.decided; }
    writeJson(gf, g);
  }
}

function setOff(root, off, all = false) {
  const f = all ? globalFile() : localFile(root);
  const o = readJson(f);
  if (all) o.off = off; else { o.suggest = o.suggest || {}; o.suggest.off = off; }
  writeJson(f, o);
}

/** 추천 문맥 한 줄 (에이전트에게) */
function line(e) {
  return `기능 추천 (지금 대화 · 작업에 맞을 때만. 답을 다 한 뒤 끝에 한 줄로 쓸지 묻는다. 맞지 않으면 무시하고 기록도 하지 않는다): ${e.say}: ${e.why} → \`${e.cmd}\` (${e.scope}). 사용자가 답하면 \`kedovi suggest set ${e.id} yes|no\` 로 기록한다 (모든 프로젝트에서 그만 묻기를 원하면 --all). yes 면 위 명령을 실행할지 확인하고 실행한다. 같은 대화에서 다시 꺼내지 않는다.`;
}

module.exports = { loadMap, whenOk, decisions, askedOf, askable, pick, markAsked, decide, reset, setOff, globallyOff, line, localFile, globalFile, PER_SESSION, GAP, ANYTIME_AFTER };
