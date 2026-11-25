// 훅 공용 헬퍼 — Claude Code·Codex 양쪽에서 같은 스크립트가 돌도록 입출력 계약을 한곳에 둔다.
'use strict';
const fs = require('fs');
const path = require('path');
const { root, stateDir, launchedByClaude } = require('./workspace');

/** 어느 에이전트가 불렀는지 — kit 이 --agent=claude|codex 를 붙여 준다 */
function agent() {
  const a = process.argv.find((x) => x.startsWith('--agent='));
  return a ? a.slice(8) : (launchedByClaude() ? 'claude' : 'codex');
}

/** stdin JSON (session_id, cwd, hook_event_name, stop_hook_active …). 없거나 깨졌으면 {}. 터미널이면 기다리지 않는다. 한 번 읽고 기억한다 */
let cachedInput = null;
function readInput() {
  if (cachedInput) return cachedInput;
  try {
    cachedInput = process.stdin.isTTY ? {} : JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch { cachedInput = {}; }
  return cachedInput;
}

/**
 * 팀원 · 서브에이전트 안에서 도는 훅인가. 공식 입력: agent_id(서브에이전트) · teammate_name · team_name(팀 이벤트).
 * 팀원 세션(agent teams)은 별도 Claude Code 프로세스라 모든 이벤트에 그 필드가 온다고 장담할 수 없어, 대화 기록 머리의 agentName · teamName 도 본다
 */
// 리더 세션에서 팀원 · 서브에이전트를 지켜보는 이벤트 — 입력에 그쪽 agent_id · teammate_name 이 붙어 와도 리더 쪽 훅이다
const LEAD_SIDE_EVENTS = ['SubagentStart', 'SubagentStop', 'TeammateIdle', 'TaskCreated', 'TaskCompleted'];

function isTeammate(input) {
  if (!input) return false;
  if (input.agent_id && !LEAD_SIDE_EVENTS.includes(String(input.hook_event_name || ''))) return true; // 서브에이전트 안의 도구 이벤트
  if (!input.transcript_path) return false;
  try {
    const fd = fs.openSync(input.transcript_path, 'r');
    const buf = Buffer.alloc(32768);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return /"agentName":"[^"]+"[^\n]*"teamName":"|"teamName":"[^"]+"[^\n]*"agentName":"/.test(buf.toString('utf8', 0, n));
  } catch { return false; }
}

/** SessionStart 등: 평문을 에이전트 컨텍스트로 */
function context(text) { if (text) process.stdout.write(`${text.trim()}\n`); }

const NO_REPEAT = ' 앞서 쓴 답은 사용자 화면에 이미 나갔다. 그 답을 다시 쓰지 말고, 위에서 요구한 것만 이어서 짧게 쓴다.';
/** Stop: 멈추지 않고 reason 을 새 지시로 이어가게 한다 (두 도구 공통 JSON). 되돌아온 에이전트가 앞 답을 통째로 다시 쓰지 않게 끝에 한 줄을 붙인다 (답 자체를 고쳐 쓰게 하는 훅은 { redo: true }) */
function block(reason, { redo = false } = {}) { process.stdout.write(JSON.stringify({ decision: 'block', reason: redo ? reason : `${reason}${NO_REPEAT}` })); }

/** PreToolUse: 이 도구 호출을 막고 이유를 에이전트에게 (Claude Code 형식) */
function deny(reason) { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })); }

/** PreToolUse: 막지 않고 에이전트에게 알림만 (Claude Code additionalContext) */
function note(text) { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } })); }

/**
 * 훅은 세션을 깨지 않는다 — 본문을 감싸 예외를 삼키고 항상 exit 0.
 * 위임받아 도는 세션(delegate.js run 이 KEDOVI_DELEGATED=1 을 준다)에서는 아무것도 하지 않는다.
 * 팀원 · 서브에이전트 안에서도 기본은 아무것도 하지 않는다 (핸드오프 · 완료 조건 · 위임 정리 · 알림은 리더 몫). 팀원에서도 돌 이벤트만 opts.teammateEvents 로 연다
 */
function run(fn, { teammateEvents = [] } = {}) {
  if (process.env.KEDOVI_DELEGATED === '1') process.exit(0);
  const input = readInput();
  if (isTeammate(input) && !teammateEvents.includes(String(input.hook_event_name || ''))) process.exit(0);
  Promise.resolve().then(fn).catch((e) => { process.stderr.write(`[hook] ${e && e.message}\n`); }).finally(() => process.exit(0));
}

const safeId = (id) => String(id || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);

/** 세션 시작 시각을 기록한다 (이미 있으면 그대로). 워크스페이스 밖 임시 폴더라 gitignore 가 필요 없다 */
function markSessionStart(input) {
  const id = safeId(input && input.session_id);
  if (!id) return;
  const dir = stateDir(root());
  const f = path.join(dir, `${id}.start`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, String(Date.now()));
  // 3일 지난 표식은 지운다
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    try { if (Date.now() - fs.statSync(p).mtimeMs > 3 * 86400000) fs.unlinkSync(p); } catch { /* 경합 무시 */ }
  }
}

/** 기록된 세션 시작 시각(ms). 없으면 null */
function sessionStartedAt(input) {
  const id = safeId(input && input.session_id);
  if (!id) return null;
  try { return Number(fs.readFileSync(path.join(stateDir(root()), `${id}.start`), 'utf8')) || null; } catch { return null; }
}

/** 답 맨 앞의 요청 시각 줄(prompt-time 훅이 쓰게 하는 yyyy-MM-dd HH:mm:ss)을 뺀다: 첫 줄 · 첫 문장을 보는 검사가 시각을 답으로 읽지 않게 */
function dropStamp(text) {
  return String(text || '').replace(/^\s*[*_`]*\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?[*_`]*[ \t]*(?:\r?\n|$)/, '');
}

module.exports = { dropStamp, agent, readInput, isTeammate, context, block, deny, note, run, safeId, root, markSessionStart, sessionStartedAt };
