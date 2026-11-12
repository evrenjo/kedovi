#!/usr/bin/env node
// 화면 착수 전 확인 (Claude Code · Codex PreToolUse): 정본(프로토타입 · 화면설계서)이 있는 화면의 진입 파일(@spec 화면 ID)을
// 정본 요소 체크리스트 없이 고치려 하면 막는다. 체크리스트를 만들면(kedovi screens inventory) 그 뒤로는 통과한다.
/*
 * 까닭: 체크리스트 없이 구현하면 정본을 열어 보지 않고 기존 화면 · 디자인 시스템 모양으로 만들기 쉽다 (화면이 프로토타입과 달라지는 첫 원인).
 * 대상: screens 팩이 켜진 워크스페이스에서 repo 파일 편집(Edit · Write · MultiEdit · apply_patch). 파일 머리 30줄(새 파일은 쓰는 내용)의 @spec 에 화면 목록의 화면 ID 가 있고,
 *       그 화면의 정본을 찾았는데 체크리스트(handoffs/<누구든>/screens/<화면 ID>.md)가 없으면 막는다. 정본이 없으면 막지 않는다 (규칙대로 사용자에게 묻는 일)
 * 팀원 · 서브에이전트 · 위임 세션 안에서도 돈다 (구현은 거기서 한다).
 * 수준 agents.enforce.screenChecklist: block(기본) · warn(한 화면에 한 번 알림) · off. 바꾸기: kedovi team-mode enforce screens off|warn|block
 */
'use strict';
const fs = require('fs');
const path = require('path');

const headOf = (text) => String(text || '').split('\n').slice(0, 30).join('\n');
const specIds = (head) => { const out = new Set(); for (const m of head.matchAll(/@spec\s+([^\n]*)/g)) for (const id of m[1].split(/[^A-Za-z0-9_-]+/)) if (id) out.add(id); return out; };

/** 이 편집이 고치는 파일과 그 머리글 [{ file, head }] */
function targets(input, cwd) {
  const tool = String(input.tool_name || '');
  const ti = input.tool_input || {};
  const read = (f) => { try { return headOf(fs.readFileSync(f, 'utf8')); } catch { return ''; } };
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(tool)) { const f = path.resolve(cwd, ti.file_path || ti.notebook_path || ''); return [{ file: f, head: read(f) }]; }
  if (tool === 'Write') { const f = path.resolve(cwd, ti.file_path || ''); return [{ file: f, head: `${read(f)}\n${headOf(ti.content)}` }]; }
  const patch = String(ti.command || ti.patch || ti.input || '');
  if (tool === 'apply_patch' || /\*\*\* (Add|Update) File:/.test(patch)) {
    const out = [];
    for (const m of patch.matchAll(/^\*\*\* (Add|Update) File: (.+)$([\s\S]*?)(?=^\*\*\* |(?![\s\S]))/gm)) {
      const f = path.resolve(cwd, m[2].trim());
      out.push({ file: f, head: m[1] === 'Add' ? headOf(m[3].split('\n').map((l) => l.replace(/^\+/, '')).join('\n')) : read(f) });
    }
    return out;
  }
  return [];
}

/** 막을 화면 ID 들: 정본이 있는데 체크리스트가 없는 것 */
function missing(ws, input) {
  if (!(ws.packs || []).includes('screens')) return [];
  let S;
  try { S = require(path.join(ws.root, 'packs', 'screens', 'bin', 'screens-inventory.js')); } catch { return []; }
  const cwd = input.cwd || ws.root;
  const list = targets(input, cwd).filter((t) => (ws.repos || []).some((r) => r.kind !== 'docs' && r.kind !== 'legacy' && (t.file === r.dir || t.file.startsWith(r.dir + path.sep))));
  const ids = new Set();
  for (const t of list) for (const id of specIds(t.head)) ids.add(id);
  if (!ids.size) return [];
  const known = new Set(S.screenIds(ws));
  const out = [];
  for (const id of ids) {
    if (!known.has(id) || S.findChecklist(ws, id)) continue;
    let verdict = 'none';
    try { verdict = S.canonOf(ws, id).verdict; } catch { /* 정본 칸이 틀림: 막지 않고 inventory 가 알린다 */ }
    if (verdict !== 'none') out.push(id);
  }
  return out;
}

const message = (ids) => `화면 ${ids.join(' · ')} 의 정본(프로토타입 · 화면설계서)이 있는데 정본 요소 체크리스트가 없습니다. 고치기 전에 kedovi screens inventory ${ids[0]} 로 체크리스트를 만들고, 정본을 열어 영역 배치 · 요소를 확인한 뒤 데이터 원천을 채웁니다 (kedovi screens checklist ${ids[0]} --start). 원천이 없는 요소는 착수 전에 사용자에게 알립니다. 수준 바꾸기: kedovi team-mode enforce screens off|warn|block`;

function main() {
  const { readInput, deny, note, root, safeId } = require('../lib/hook');
  const { load, stateDir } = require('../lib/workspace');
  const input = readInput();
  if (String(input.hook_event_name || 'PreToolUse') !== 'PreToolUse') return;
  const R = root();
  let level = 'block';
  try { const kit = require(path.join(R, 'bin', 'kit.js')); level = (kit.resolveModels(R, kit.loadWorkspace(R)).enforce || {}).screenChecklist || level; } catch { /* 옛 워크스페이스 */ }
  if (level === 'off') return;
  let ws;
  try { ws = load(R); } catch { return; }
  const ids = missing(ws, input);
  if (!ids.length) return;
  if (level === 'block') { deny(message(ids)); return; }
  const mark = path.join(stateDir(R), `${safeId(input.session_id) || 'x'}.screengate-${safeId(ids.join('_'))}`);
  if (fs.existsSync(mark)) return;
  try { fs.writeFileSync(mark, '1'); } catch { /* 표식은 부가 */ }
  note(message(ids));
}

if (require.main === module) {
  try { main(); } catch { /* 훅은 세션을 깨지 않는다 */ }
  process.exit(0);
}
module.exports = { targets, specIds, missing };
