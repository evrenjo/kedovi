#!/usr/bin/env node
// 착수 전 확인 점검 (Claude Code) — 요청마다 코드 repo 의 첫 수정(Edit · Write) 전에 답변에 「착수 전 확인:」 머리말과 목적(왜) · 성공 기준 칸이 있었는지 본다
/*
 * UserPromptSubmit: 이번 요청의 알림 기록을 지운다 · PreToolUse(Edit|Write|MultiEdit|NotebookEdit): 판정
 * - 메인이 구현을 맡길 때(PreToolUse Agent · Task)도 본다: 지시문에 코드 repo 경로가 있고 읽기 전용 에이전트(조사 · 리뷰)가 아니면. 메인 전담 모드에서는 메인이 직접 고치지 않아 이것이 첫 수정 시점이다. 팀원 · 리더 안의 위임은 보지 않는다
 * - 대상: workspace.json 의 코드 repo(kind code) 안 파일. 워크스페이스 기록(handoffs · topics) · 기획 repo · 워크스페이스 밖은 보지 않는다
 * - 예외: 문서 · 스타일 파일(md · txt · css 등)의 두 줄 이하 수정
 * - 머리말은 이번 요청과 바로 앞 요청의 답변에서 찾는다 (계획을 보이고 「진행해」 를 받은 경우)
 * - 머리말이 있어도 목적(왜) · 성공 기준(완료 기준) 칸이 없으면 같은 수준으로 알린다. 「착수 전 확인: 단순 수정 (이유)」 한 줄은 예외
 * - 수준 agents.enforce.planFirst: warn(기본) = 요청마다 한 번 알림(도구는 그대로 돈다, 맡기기는 첫 번 한 번 되돌린다) · block = 머리말을 보일 때까지 수정 · 맡기기를 막는다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { readInput, deny, note, run, root, safeId, isTeammate } = require('../lib/hook');
const { stateDir, load } = require('../lib/workspace');

const HEADER = /착수 전 확인\s*:/;
const SIMPLE = /착수 전 확인\s*:\s*단순 수정/;
const PURPOSE = /목적|왜/;
const SUCCESS = /성공\s*기준|완료\s*기준/;
// 읽기만 하는 에이전트: 종류 이름 또는 설명 · 이름이 조사 · 리뷰이고 구현 낱말이 없을 때
const READ_ONLY_TYPES = /^(explore|plan|claude-code-guide|statusline-setup)$/i;
const READ_ONLY_WORDS = /조사|리뷰|검토|분석|찾기|살펴|research|review|explore|investigat|audit/i;
const WRITE_WORDS = /구현|수정|고치|고쳐|추가|만들|바꾸|바꿔|적용|implement|fix|add|edit|write|refactor/i;
const LIGHT = /\.(md|mdx|markdown|txt|rst|adoc|css|scss|sass|less)$/i;
const lineCount = (s) => (typeof s === 'string' && s ? s.replace(/\n$/, '').split('\n').length : 0);

/** 링크(repos/<이름> → 다른 곳)를 풀어 비교한다. 새 파일이면 폴더를 푼다 */
function real(p) {
  try { return fs.realpathSync(p); } catch { try { return path.join(fs.realpathSync(path.dirname(p)), path.basename(p)); } catch { return p; } }
}

/** 바꾸는 줄 수 (Edit = 옛 · 새 중 큰 쪽, MultiEdit = 합, Write = 새 내용) */
function changedLines(tool, ti) {
  if (tool === 'Edit') return Math.max(lineCount(ti.old_string), lineCount(ti.new_string));
  if (tool === 'MultiEdit') return (ti.edits || []).reduce((n, e) => n + Math.max(lineCount(e.old_string), lineCount(e.new_string)), 0);
  if (tool === 'Write') return lineCount(ti.content);
  return Infinity;
}

/** 이번 요청과 바로 앞 요청의 답변 글 가운데 머리말이 든 글 (대화 기록 JSONL). 기록을 못 읽으면 true(통과), 없으면 null */
function headerShown(transcript) {
  let rows;
  try { rows = fs.readFileSync(transcript, 'utf8').split('\n'); } catch { return true; } // 기록을 못 읽으면 통과
  let prompts = 0;
  for (let i = rows.length - 1; i >= 0 && prompts < 2; i -= 1) {
    let d;
    try { d = JSON.parse(rows[i]); } catch { continue; }
    const c = (d.message || {}).content;
    if (d.type === 'user') {
      const real = !d.isMeta && !d.isCompactSummary && (typeof c === 'string' || (Array.isArray(c) && c.some((x) => x.type === 'text') && !c.some((x) => x.type === 'tool_result')));
      if (real) prompts += 1;
    } else if (d.type === 'assistant' && Array.isArray(c)) {
      const t = c.find((x) => x.type === 'text' && HEADER.test(x.text || ''));
      if (t) return t.text;
    }
  }
  return null;
}

/** 머리말 글 판정: ok · 목적 또는 성공 기준 칸이 빠짐(missing) */
function judge(text) {
  if (text === true || SIMPLE.test(text)) return 'ok';
  const body = text.slice(text.search(HEADER));
  return PURPOSE.test(body) && SUCCESS.test(body) ? 'ok' : 'missing';
}

run(() => {
  const input = readInput();
  const id = safeId(input.session_id);
  if (!id) return;
  const ROOT = root();
  const mark = path.join(stateDir(ROOT), `${id}.planfirst`);
  const ev = String(input.hook_event_name || '');
  if (ev === 'UserPromptSubmit') { try { fs.unlinkSync(mark); } catch { /* 없음 */ } return; }
  if (ev !== 'PreToolUse') return;
  let level = 'warn';
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); level = (kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).enforce || {}).planFirst || level; } catch { /* 옛 워크스페이스 */ }
  if (level === 'off' || (level === 'warn' && fs.existsSync(mark))) return;
  const tool = String(input.tool_name || '');
  const ti = input.tool_input || {};
  let ws;
  try { ws = load(ROOT); } catch { return; }
  const codeRepos = ws.repos.filter((r) => r.kind === 'code');
  const delegate = tool === 'Agent' || tool === 'Task';
  if (delegate) {
    if (isTeammate(input)) return;
    const text = `${ti.description || ''} ${ti.name || ''} ${ti.prompt || ''}`;
    const label = `${ti.description || ''} ${ti.name || ''}`;
    if (READ_ONLY_TYPES.test(String(ti.subagent_type || '')) || (READ_ONLY_WORDS.test(label) && !WRITE_WORDS.test(label))) return;
    const mentions = codeRepos.some((r) => { const rel = path.relative(ROOT, r.dir).split(path.sep).join('/'); return text.includes(rel) || text.includes(r.dir) || text.includes(real(r.dir)); });
    if (!mentions) return;
  } else {
    const file = ti.file_path || ti.notebook_path;
    if (!file) return;
    const abs = real(path.resolve(input.cwd || ROOT, file));
    const inCode = codeRepos.some((r) => [r.dir, real(r.dir)].some((d) => abs === d || abs.startsWith(d + path.sep)));
    if (!inCode) return;
    if (LIGHT.test(abs) && changedLines(tool, ti) <= 2) return;
  }
  const shown = headerShown(input.transcript_path);
  if (shown && judge(shown) === 'ok') return;
  const what = (shown
    ? '「착수 전 확인:」 에 목적(왜) · 성공 기준 칸이 없습니다. 맨 앞에 이 변경의 목적과 끝났다고 볼 확인 방법을 적고 사용자 확인을 받습니다. 요청 · 기록으로 채울 수 없으면 interview 스킬로 하나씩 묻습니다. '
    : delegate ? '이번 요청에서 「착수 전 확인:」 없이 코드 수정을 에이전트에게 맡기려 합니다. 맡기기 전에 `착수 전 확인:` 머리말로 목적(왜) · 성공 기준 · 영향 범위 · 공유 상태 · 구조 결정 · 검증 · 시간 예산을 보이고 사용자 확인을 받습니다 (go 스킬 3단계). 요청에 목적 · 성공 기준 · 범위(예: 어떤 조건 · 어떤 화면)가 없으면 추측해 정하지 말고 interview 스킬로 먼저 묻습니다. '
    : '이번 요청에서 「착수 전 확인:」 없이 코드를 고치려 합니다. 기능 변경 · 공유 상태 변경이면 먼저 `착수 전 확인:` 머리말로 목적(왜) · 성공 기준 · 영향 범위 · 공유 상태 · 구조 결정 · 검증 · 시간 예산을 보이고 사용자 확인을 받습니다 (go 스킬 3단계). 목적 · 성공 기준을 모르면 interview 스킬로 먼저 묻습니다. ')
    + '오타 · 한두 줄 같은 단순 수정이면 `착수 전 확인: 단순 수정 (이유)` 한 줄을 적고 이어 갑니다. 수준 바꾸기: kedovi team-mode enforce plan off|warn|block';
  // 맡기기는 알림이면 이미 늦다: 알림 수준에서도 요청마다 첫 번 한 번은 되돌리고, 다시 맡기면 통과
  if (level === 'block' || delegate) { if (level !== 'block') fs.writeFileSync(mark, '1'); deny(what); return; }
  fs.writeFileSync(mark, '1');
  note(what);
});
