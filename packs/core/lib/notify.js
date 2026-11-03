// 메신저(텔레그램) 알림 공용 — 설정 읽기 · 보낼 문장 만들기 · 발송. 훅(hooks/notify.js)과 도구(bin/notify.js)가 쓴다.
'use strict';
/*
 * 채널 두 개
 *   개인  작업 끝 · 입력 대기 → 나만의 채팅 (봇과의 1:1). 켜기: 팀 기본 vars.notify.events ← 이 PC .agents/local.json notify.events
 *   팀    핸드오프 push · 설정 변경 push · 공지 → 팀 그룹방 vars.notify.teamChat. 고르기: vars.notify.team
 * 비밀값은 repo 밖 ~/.config/kedovi/telegram.env (권한 600)
 *   TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID   개인 봇 · 개인 채팅
 *   TELEGRAM_TEAM_BOT_TOKEN                 팀 봇 (관리자가 따로 전달)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const EVENTS = ['stop', 'notification'];
/**
 * 알림 수준 — 텔레그램으로 얼마나 받을지 하나로 정한다 (.agents/local.json notify.level)
 *   all       전체: 터미널 요청의 질문 · 답 전문 · 에이전트 시작 · 끝 · 진행 현황 · 결정 대기
 *   decisions 결과와 결정 (기본): 오래 걸린 요청의 답 앞부분 · 결정 대기(질문 · 권한)
 *   progress  진행 현황: 에이전트 시작 · 끝 · 진행 현황 · 끝남 한 줄 · 결정 대기 한 줄
 *   off       끄기 (채널 끊김 경고만)
 */
const LEVELS = ['all', 'decisions', 'progress', 'off'];
const LEVEL_LABEL = { all: '전체', decisions: '결과와 결정', progress: '진행 현황', off: '끄기' };
const RESULT_CLIP = 800; // 결과와 결정: 답 앞부분
const TEAM_EVENTS = ['handoff', 'settings', 'announce'];
const DEFAULT_MIN_SECONDS = 60;
const DEFAULT_DESK_SECONDS = 120; // 이 안에 키보드 · 마우스를 만졌으면 PC 앞에 있다고 본다
const API = () => process.env.KEDOVI_TELEGRAM_API || 'https://api.telegram.org'; // 시험용으로 바꿀 수 있다
const secretFile = () => path.join(process.env.KEDOVI_CONFIG_DIR || path.join(os.homedir(), '.config', 'kedovi'), 'telegram.env');

/** "1" · "stop,notification" · "off" … → 켜진 이벤트 목록 */
function parseEvents(value, all = EVENTS) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (!v || ['0', 'off', 'false', 'none'].includes(v)) return [];
  if (['1', 'on', 'true', 'all'].includes(v)) return all.slice();
  const want = v.split(',').map((s) => s.trim());
  return all.filter((e) => want.includes(e));
}

/**
 * ~/.config/kedovi/telegram.env (KEY=값 줄) + 비밀값 저장소(kedovi secret)의 봇 토큰. 없으면 {}
 * 토큰은 저장소(프로젝트 > 전역)가 telegram.env 보다 먼저다. 환경변수는 쓰는 곳에서 먼저 본다. root 가 없으면 전역만
 */
function readSecretFile() {
  const out = {};
  try {
    for (const line of fs.readFileSync(secretFile(), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*?)"?\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch { /* 없음 */ }
  return out;
}
function readSecrets(root) {
  const out = readSecretFile();
  try {
    const S = require('./secrets');
    for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_TEAM_BOT_TOKEN']) {
      const g = S.get(name, { root, env: {}, legacy: false });
      if (g) out[name] = g.value;
    }
  } catch { /* 저장소 없음 */ }
  return out;
}

function writeSecrets(values) {
  const file = secretFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // 저장소(kedovi secret)로 옮긴 봇 토큰은 저장소를 고친다 (파일에 쓰면 저장소의 옛 값이 먼저 읽힌다)
  try {
    const S = require('./secrets');
    const stored = new Set(S.list().filter((x) => x.scope === S.GLOBAL).map((x) => x.name));
    for (const name of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_TEAM_BOT_TOKEN']) {
      if (!(name in values) || !stored.has(name)) continue;
      if (values[name]) S.set(name, values[name], { scope: S.GLOBAL }); else S.rm(name, { scope: S.GLOBAL });
      values = { ...values };
      delete values[name];
    }
  } catch { /* 저장소 없음 */ }
  const merged = { ...readSecretFile(), ...values }; // 저장소 토큰은 파일로 옮겨 적지 않는다
  fs.writeFileSync(file, Object.entries(merged).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

function readLocal(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.agents', 'local.json'), 'utf8')); } catch { return {}; }
}

function projectName(root, ws) {
  return (ws && ws.project && (ws.project.title || ws.project.name)) || path.basename(root);
}

/**
 * 개인 채널 설정 = 팀 기본(workspace.json vars.notify) ← 이 PC(.agents/local.json notify).
 * { events, minSeconds, chat, token, source: 'local'|'team'|'off' }
 */
function personal(root, ws) {
  const team = (ws && ws.vars && ws.vars.notify) || {};
  const local = readLocal(root).notify || {};
  const secrets = readSecrets(root);
  const hasLocal = Object.prototype.hasOwnProperty.call(local, 'events') || LEVELS.includes(local.level);
  // 수준: 이 PC 값 → 옛 events 값(켜짐 = 결과와 결정) → 팀 기본(vars.notify.level · events)
  const legacy = (v) => (parseEvents(v).length ? 'decisions' : 'off');
  const level = process.env.KEDOVI_NOTIFY === '0' ? 'off'
    : LEVELS.includes(local.level) ? local.level
      : Object.prototype.hasOwnProperty.call(local, 'events') ? legacy(local.events)
        : LEVELS.includes(team.level) ? team.level : legacy(team.events);
  const events = level === 'off' ? [] : EVENTS.slice();
  const min = Number(local.minSeconds != null ? local.minSeconds : team.minSeconds);
  const desk = Number(local.deskSeconds != null ? local.deskSeconds : team.deskSeconds);
  return {
    level,
    away: local.away === true || local.channelAsk === 'text', // 자리 비움: 결정을 텔레그램 버튼 질문으로 (notify.js ask) · 결과는 시간과 상관없이
    remote: ['send', 'quiet'].includes(local.remote) ? local.remote : 'done', // 리모트 컨트롤(Claude 앱)로 이어진 세션: done = 작업 끝만 텔레그램 (기본, 결정은 앱이 알린다) · quiet = 보내지 않음 · send = 그대로
    events,
    minSeconds: Number.isFinite(min) && min >= 0 ? min : DEFAULT_MIN_SECONDS,
    deskSeconds: Number.isFinite(desk) && desk >= 0 ? desk : DEFAULT_DESK_SECONDS, // 0 = 자리 판단 안 함
    chat: String(local.chat || process.env.TELEGRAM_CHAT_ID || secrets.TELEGRAM_CHAT_ID || ''),
    // 채널을 켠 워크스페이스는 알림도 그 프로젝트 봇으로 (대화와 알림이 한 곳에, 다른 프로젝트와 섞이지 않게)
    token: (local.channel === true && channelToken(root)) || process.env.TELEGRAM_BOT_TOKEN || secrets.TELEGRAM_BOT_TOKEN || '',
    source: !events.length ? 'off' : hasLocal ? 'local' : 'team',
  };
}

/** 팀 채널 설정. teamChat 이 비면 꺼짐. { events, chat, token } */
function team(root, ws) {
  const v = (ws && ws.vars && ws.vars.notify) || {};
  const chat = String(v.teamChat || '');
  const secrets = readSecrets(root);
  return {
    events: chat && process.env.KEDOVI_NOTIFY !== '0' ? parseEvents(v.team == null || v.team === '' ? 'all' : v.team, TEAM_EVENTS) : [],
    chat,
    token: process.env.TELEGRAM_TEAM_BOT_TOKEN || secrets.TELEGRAM_TEAM_BOT_TOKEN || '',
  };
}

function clip(s, n) {
  s = String(s || '').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function duration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}분 ${s}초` : `${s}초`;
}

/**
 * 개인 채널: 훅 입력 → 보낼 문장. 보내지 않으면 null.
 * elapsed = 이번 요청 처리에 걸린 초 (모르면 null → 시간 조건 없이 보낸다)
 */
const levelOf = (cfg) => cfg.level || (cfg.events && cfg.events.length ? 'decisions' : 'off');
/** 키보드 · 마우스를 마지막으로 만진 뒤 지난 초. 모르면 null (macOS 만 잰다. 시험은 KEDOVI_IDLE_SECONDS) */
function idleSeconds() {
  if (process.env.KEDOVI_IDLE_SECONDS != null) { const n = Number(process.env.KEDOVI_IDLE_SECONDS); return Number.isFinite(n) ? n : null; }
  if (process.platform !== 'darwin') return null;
  try {
    const out = require('child_process').execFileSync('ioreg', ['-c', 'IOHIDSystem', '-d', '4'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/"HIDIdleTime"\s*=\s*(\d+)/);
    return m ? Number(m[1]) / 1e9 : null;
  } catch { return null; }
}
/** PC 앞에 있나 (끝남 · 위임 끝 · 에이전트 진행 · 음성을 보내지 않는다). 자리 비움을 켰거나 잴 수 없으면 false */
const atDesk = (cfg) => { if (cfg.away || !(cfg.deskSeconds > 0)) return false; const s = idleSeconds(); return s != null && s < cfg.deskSeconds; };

/**
 * 이 세션이 리모트 컨트롤(Claude 앱 연결)로 이어져 있나. 공식: 연결된 동안 훅에 CLAUDE_CODE_BRIDGE_SESSION_ID 가 있다 (Claude Code 2.1.199+).
 * 옛 버전은 세션 파일(~/.claude/sessions/<pid>.json)의 bridgeSessionId 로 본다 (문서에 없는 내부 파일, 못 읽으면 false). 시험은 KEDOVI_REMOTE_CONTROL=1|0
 */
function remoteControl(sessionId) {
  if (process.env.CLAUDE_CODE_BRIDGE_SESSION_ID) return true;
  if (process.env.KEDOVI_REMOTE_CONTROL != null) return process.env.KEDOVI_REMOTE_CONTROL === '1';
  if (!sessionId) return false;
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'sessions');
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      let j = null;
      try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
      if (!j || j.sessionId !== sessionId) continue;
      const v = String(j.version || '').split('.').map(Number);
      if (!j.bridgeSessionId || !(v[0] < 2 || (v[0] === 2 && (v[1] < 1 || (v[1] === 1 && v[2] < 199))))) return false; // 새 버전은 환경 변수가 없으면 끊긴 것
      try { process.kill(j.pid, 0); return true; } catch { return false; }
    }
  } catch { /* 폴더 없음 */ }
  return false;
}
/** 자리에 있을 때(자리 비움 아님, 전체 수준 아님)는 짧게: 선택 대기 한 줄 · 모든 작업 끝 한 줄만 */
const brief = (cfg) => !cfg.away && levelOf(cfg) !== 'all';
/** 에이전트 시작 · 끝 · 진행 현황을 보낼 때: 전체 수준이거나, 진행 현황 수준인데 자리 비움 */
const wantsProgress = (cfg) => levelOf(cfg) === 'all' || (levelOf(cfg) === 'progress' && !!cfg.away);

/**
 * 결정 대기(Notification) → 보낼 문장. 보내지 않으면 null.
 * 질문 · 권한 확인만 보낸다 (응답 뒤 입력 대기는 결과 알림과 겹친다). 채널 세션의 권한 확인은 플러그인이 버튼으로 보낸다.
 * 자리 비움이면 설명 · 보기 · 답 앞부분까지, 자리에 있으면 한 줄만 (brief). pending = 남은 팀원 · 백그라운드 작업이 있음
 */
function personalMessage(cfg, input, { project, agent, elapsed, question, prompt, replied, continued, desk, pending }) {
  const event = String(input.hook_event_name || '').toLowerCase();
  const level = levelOf(cfg);
  if (level === 'off' || !cfg.token || !cfg.chat) return null;
  const who = agent === 'codex' ? 'Codex' : 'Claude';
  if (event === 'notification') {
    const kind = waitKind(input, question);
    if (kind === 'idle') return null;
    if (kind === 'permission' && process.env.KEDOVI_CHANNEL === '1') return null;
    if (brief(cfg)) return kind === 'question' ? `❓ [${project}] ${who}: 선택할 것이 있습니다. 터미널에서 골라 주세요` : `${WAIT[kind][0]} [${project}] ${who}: ${WAIT[kind][1]}`; // 자리에 있으면 알리기만 (설명 · 보기는 자리 비움일 때)
    const detail = kind === 'question' ? (question && question !== '질문' ? question : '') : String(input.message || '');
    return `${WAIT[kind][0]} [${project}] ${who}: ${WAIT[kind][1]}${detail ? `\n${clip(detail, 500)}` : ''}`;
  }
  if (event !== 'stop' || replied) return null; // 텔레그램에서 온 요청은 Claude 가 reply 로 이미 답했다
  const answer = String(input.last_assistant_message || '').trim();
  if (level === 'all') {
    if (prompt) return mirrorMessage(prompt, answer, project);
    return answer ? `🤖 [${project}]${continued ? ' (이어서)' : ''}\n${answer}` : null;
  }
  if (input.stop_hook_active) return null; // 다른 Stop 훅이 이어 가게 한 차례는 결과가 아니다
  if (desk) return null; // PC 앞에 있으면 터미널에서 본다
  if (!cfg.away && elapsed != null && elapsed < cfg.minSeconds) return null; // 짧은 응답은 알리지 않는다 (자리 비움이면 모두)
  const took = elapsed != null ? ` (${duration(elapsed)})` : '';
  if (brief(cfg)) { // 자리에 있으면: 남은 작업이 있으면 쉬고, 결정 질문이면 선택 대기 한 줄, 아니면 끝 한 줄
    if (pending) return null;
    if (looksLikeDecision(answer)) return `❓ [${project}] ${who}: 선택할 것이 있습니다. 터미널에서 골라 주세요`;
    return `✅ [${project}] ${who} 모든 작업 끝${took}`;
  }
  const cut = (t) => { const head = t.slice(0, RESULT_CLIP); const soft = head.replace(/\s+\S*$/, ''); return head.length - soft.length < 40 ? soft : head; }; // 단어 중간이면 공백에서 (멀면 그대로)
  const body = answer.length > RESULT_CLIP ? `${cut(answer)}\n… (전문은 터미널)` : answer;
  return `✅ [${project}] ${who} 작업 끝${took}${body ? `\n\n${body}` : ''}`;
}

const WAIT = { question: ['❓', '질문 대기'], permission: ['🔐', '권한 확인 대기'], idle: ['⏳', '입력 대기'], other: ['⏳', '확인 대기'] };

/**
 * 입력 대기 종류. question = 질문 창(질문 도구를 띄운 기록이 있거나 elicitation) · permission = 도구 실행 허락 · idle = 응답 뒤 오래 입력 없음.
 * Claude Code 는 notification_type 을 주고, 옛 버전은 문구로만 나눈다
 */
function waitKind(input, question) {
  const type = String(input.notification_type || '');
  if (question || type === 'elicitation_dialog') return 'question';
  if (type === 'permission_prompt' || /permission/i.test(String(input.message || ''))) return 'permission';
  if (type === 'idle_prompt' || /waiting for your input/i.test(String(input.message || ''))) return 'idle';
  return 'other';
}

// ───────── 양방향 채널 (Claude Code 공식 telegram 플러그인, 개인 · 이 PC · 프로젝트마다) ─────────
// claude --channels plugin:telegram@claude-plugins-official 로 띄우면 봇에게 보낸 메시지가 세션에 들어오고 Claude 가 답한다.
// 기본은 꺼짐. kedovi notify my channel on 이 이 PC .agents/local.json notify.channel 을 켜고, kedovi start 가 플래그와 TELEGRAM_STATE_DIR 을 붙인다.
// 텔레그램은 봇 하나에 메시지를 받는 쪽이 하나뿐이라 **프로젝트마다 전용 봇 · 상태 폴더**를 둔다 (다른 프로젝트 세션과 대화가 섞이지 않게).
// 상태 폴더: ~/.claude/channels/telegram-<프로젝트>/{.env, access.json}. 채널을 켠 워크스페이스는 개인 알림도 그 봇으로 보낸다
const CHANNEL_PLUGIN = 'telegram@claude-plugins-official';
const claudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const channelsRoot = () => path.join(claudeHome(), 'channels');

function channelSlug(root) {
  let name = '';
  try { name = (JSON.parse(fs.readFileSync(path.join(root, 'workspace.json'), 'utf8')).project || {}).name || ''; } catch { /* 없음 */ }
  return String(name || path.basename(path.resolve(root))).replace(/[^A-Za-z0-9._-]/g, '_');
}

/** 이 워크스페이스의 플러그인 상태 폴더 */
const channelDir = (root) => path.join(channelsRoot(), `telegram-${channelSlug(root)}`);

/** 플러그인 설치 목록 (installed_plugins.json 의 이 플러그인 항목) */
function channelInstalls() {
  try { return [].concat(JSON.parse(fs.readFileSync(path.join(claudeHome(), 'plugins', 'installed_plugins.json'), 'utf8')).plugins[CHANNEL_PLUGIN] || []); } catch { return []; }
}

/**
 * 이 워크스페이스에서 쓸 수 있게 설치된 범위: 'local' · 'project' · 'user' · null.
 * 권장은 local (이 PC · 이 워크스페이스만 서버를 띄운다). user 는 이 PC 의 모든 Claude Code 세션이 서버를 띄운다
 */
function channelPluginScope(root) {
  const here = path.resolve(root);
  const entries = channelInstalls();
  const at = entries.find((e) => e.projectPath && path.resolve(e.projectPath) === here && (e.scope === 'local' || e.scope === 'project'));
  if (at) return at.scope;
  return entries.some((e) => !e.scope || e.scope === 'user') ? 'user' : null;
}

function tokenIn(dir) {
  try {
    const m = fs.readFileSync(path.join(dir, '.env'), 'utf8').match(/^TELEGRAM_BOT_TOKEN=(.*)$/m);
    return m ? m[1].trim() : '';
  } catch { return ''; }
}

/** 이 프로젝트 채널 봇 토큰 (없으면 '') */
const channelToken = (root) => tokenIn(channelDir(root));

/**
 * 같은 토큰을 쓰는 다른 프로젝트 상태 폴더 (telegram-<프로젝트>). 같은 봇을 두 곳이 받으면 서로 끊는다.
 * 플러그인 기본 폴더(telegram, kedovi 밖에서 claude --channels 로 쓸 때)는 { shared: true } 로 따로 알린다
 */
function channelTokenUsedElsewhere(root, token) {
  const mine = channelDir(root);
  let names = [];
  try { names = fs.readdirSync(channelsRoot()).filter((n) => n.startsWith('telegram-')); } catch { names = []; }
  const hit = names.map((n) => path.join(channelsRoot(), n)).find((d) => d !== mine && tokenIn(d) === token);
  if (hit) return { dir: hit, shared: false };
  const plain = path.join(channelsRoot(), 'telegram');
  return tokenIn(plain) === token ? { dir: plain, shared: true } : null;
}

function channelAccess(root) {
  try { return JSON.parse(fs.readFileSync(path.join(channelDir(root), 'access.json'), 'utf8')); } catch { return null; }
}

/** 이 PC 에서 켰는지 */
const channelOn = (root) => (readLocal(root).notify || {}).channel === true;

/**
 * 채널 세션의 선택지 질문 방식. dialog(기본) = 터미널 선택지 창(방향키 · 직접 입력), 텔레그램에는 질문과 선택지를 알림으로.
 * text = 창 대신 텔레그램 버튼 질문 (자리를 비울 때: 버튼 · 번호 · 직접 입력으로 답한다). kedovi notify my channel ask dialog|text
 */
/**
 * 끝 응답이 사용자에게 고르라는 결정 질문인가 (자리 비움 Stop 검사). 완료 보고의 번호 목록을 결정으로 보지 않게 좁게 본다:
 * 코드 블록 · 주소 · 「로드맵을 볼까요?」 줄을 빼고, 번호 보기 2개 이상이 있고, 보기를 고르라는 말이 있어야 한다:
 * 보기에 「권장」 이 붙었거나, 목록 바로 위 3줄 · 목록 뒤에 보기를 가리키는 말(어느 쪽 · 어떤 것 · 몇 번 · 중에서 · 번호로 · 고르 · 골라 · 선택).
 * 「다음 단계로 진행할까요?」 같은 예/아니오 질문 · 낱말 「결정」 만으로는 결정이 아니다
 */
function looksLikeDecision(text) {
  const t = String(text || '').replace(/```[\s\S]*?```/g, '').replace(/https?:\/\/\S+/g, '');
  const lines = t.split('\n').filter((l) => !/로드맵을 볼까요/.test(l));
  const isOpt = (l) => /^\s*(?:\*\*)?\d+[.)]\s+\S/.test(l) || /^\|\s*\d+\.?\s*(?:\(권장\))?\s*\|/.test(l);
  const at = lines.map((l, i) => (isOpt(l) ? i : -1)).filter((i) => i >= 0);
  if (at.length < 2) return false;
  const near = [...lines.slice(Math.max(0, at[0] - 3), at[0]), ...lines.slice(at[at.length - 1] + 1)];
  const points = (l) => /(어느 ?쪽|어떤 ?(것|걸|안|방식)|몇 ?번|중에서|중 하나|번호로|고르|골라|선택)/.test(l);
  return at.some((i) => /권장/.test(lines[i])) || near.some(points);
}

const channelAskMode = (root) => { const l = readLocal(root).notify || {}; return l.away === true || l.channelAsk === 'text' ? 'text' : 'dialog'; };

/** 시작 전 점검. findCli = 실행 파일 찾기 (lib/cli). { ready, problems[] } */
function channelCheck(root, findCli) {
  const problems = [];
  if (!findCli('bun')) problems.push('bun 이 없다 (플러그인 서버가 Bun 으로 돈다)');
  if (!channelPluginScope(root)) problems.push(`${CHANNEL_PLUGIN} 플러그인이 설치돼 있지 않다`);
  if (!channelToken(root)) problems.push('이 프로젝트 전용 봇이 없다');
  return { ready: !problems.length, problems };
}

/**
 * 채널 수신 상태. 플러그인 서버는 상태 폴더 bot.pid 에 자기 pid 를 적고, 새로 뜬 서버는 이전 것을 끈다.
 * { ok, reason } · ok = bot.pid 의 서버가 살아 있고 이 세션(같은 Claude Code 프로세스)에서 띄운 것. Windows 는 살아 있는지만 본다
 */
function channelHealth(root, me = process.pid) {
  let pid = 0;
  try { pid = parseInt(fs.readFileSync(path.join(channelDir(root), 'bot.pid'), 'utf8'), 10); } catch { /* 없음 */ }
  const last = channelLogLast(root);
  const why = last ? `. 마지막 기록: ${last}` : '';
  if (!pid) return { ok: false, reason: `수신 프로세스가 없다${why}` };
  try { process.kill(pid, 0); } catch { return { ok: false, reason: `수신 프로세스(${pid})가 꺼졌다${why}` }; }
  if (process.platform === 'win32') return { ok: true };
  let table = '';
  try { table = require('child_process').execFileSync('ps', ['-axo', 'pid=,ppid=,args='], { encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024 * 1024 }); } catch { return { ok: true }; }
  const rows = table.trim().split('\n').map((l) => { const m = l.trim().match(/^(\d+)\s+(\d+)\s?(.*)$/); return m ? [Number(m[1]), Number(m[2]), m[3]] : null; }).filter(Boolean);
  const parent = new Map(rows.map((r) => [r[0], r[1]]));
  const args = new Map(rows.map((r) => [r[0], r[2]]));
  const chain = (p) => { const out = []; for (let i = 0; p > 1 && i < 30; i++) { out.push(p); p = parent.get(p); } return out; };
  // 가까운 조상만 본다: 훅은 Claude Code → (셸) → 훅, 서버는 Claude Code → bun run → bun. 멀리 가면 터미널 앱 같은 공통 조상이 나온다
  const mine = new Set(chain(me).slice(1, 4));
  if (chain(pid).slice(1, 3).some((p) => mine.has(p))) return { ok: true };
  return { ok: false, reason: `${holderOf(chain(pid).slice(1, 4).map((p) => args.get(p) || ''))}이 이 봇을 받고 있다 (pid ${pid})` };
}

/** 수신 서버를 띄운 쪽 이름: 팀원(--agent-name) · 다른 채널 세션 · 다른 세션 */
function holderOf(ancestors) {
  const a = ancestors.find((x) => /--agent-name|--channels|claude/.test(x)) || '';
  const name = (a.match(/--agent-name[= ]([^\s]+)/) || [])[1];
  return name ? `팀원 ${name}` : /--channels/.test(a) ? '다른 채널 세션' : '다른 세션';
}

// ───────── 채널 세션만 수신 (bun 대리 실행) ─────────
// 텔레그램 봇은 한 곳에서만 받는다. 플러그인을 켠 프로젝트에서는 팀원 세션(tmux, 리더 환경 · --settings 를 물려받음)도 같은 봇의 서버를 띄우고,
// 시작하면서 bot.pid 의 리더 서버를 꺼 버린다. kedovi start 가 채널 세션의 PATH 앞에 이 bun 을 두어 --channels 로 시작한 세션만 서버를 띄우게 한다.
// 판정: 부모(Claude Code) 실행 인자에 --channels 가 있고 --agent-id 가 없으며 위임 세션(KEDOVI_DELEGATED=1)이 아님. 막은 것 · 띄운 것은 상태 폴더의 kedovi-channel.log 에 한 줄
const CHANNEL_LOG = 'kedovi-channel.log';
function channelShim(root, realBun) {
  if (!realBun || process.platform === 'win32') return null;
  const dir = path.join(channelDir(root), 'kedovi-bin');
  const log = path.join(channelDir(root), CHANNEL_LOG);
  if (path.dirname(realBun) === dir) { // 채널 세션 안에서 다시 kedovi start: PATH 에서 이 대리 실행을 빼고 진짜 bun 을 찾는다
    realBun = String(process.env.PATH || '').split(path.delimiter).filter((d) => d && d !== dir).map((d) => path.join(d, 'bun')).find((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }) || null;
    if (!realBun) return null;
  }
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const body = `#!/bin/sh
# kedovi: 텔레그램 채널 서버는 --channels 로 시작한 세션 하나만 띄운다 (팀원 · 위임 세션은 막는다). 그 밖의 bun 은 그대로 실행
case " $* " in
  *" --cwd "*telegram*" start "*)
    P="$(ps -o args= -p "$PPID" 2>/dev/null)"
    WHO="$(printf '%s' "$P" | sed -n 's/.*--agent-name[= ]\\([^ ]*\\).*/팀원 \\1/p')"
    if [ "$KEDOVI_DELEGATED" = 1 ] || [ -n "$WHO" ] || ! printf '%s' "$P" | grep -q -- '--channels'; then
      echo "$(date '+%m-%d %H:%M') 막음: \${WHO:-채널 아닌 세션} (pid $PPID)" >> ${q(log)}
      echo "kedovi: 이 세션은 텔레그램 채널을 받지 않는다 (--channels 로 시작한 세션만)" >&2
      exit 0
    fi
    echo "$(date '+%m-%d %H:%M') 띄움: 채널 세션 (pid $PPID)" >> ${q(log)}
    ;;
esac
exec ${q(realBun)} "$@"
`;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const f = path.join(dir, 'bun');
    let old = null;
    try { old = fs.readFileSync(f, 'utf8'); } catch { /* 처음 */ }
    if (old !== body) fs.writeFileSync(f, body, { mode: 0o755 });
    // 기록은 최근 50줄만
    try { const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean); if (lines.length > 50) fs.writeFileSync(log, `${lines.slice(-50).join('\n')}\n`); } catch { /* 없음 */ }
    return dir;
  } catch { return null; }
}
/** kedovi-channel.log 마지막 줄 (끊김 알림에 붙인다) */
function channelLogLast(root) {
  try { return fs.readFileSync(path.join(channelDir(root), CHANNEL_LOG), 'utf8').trim().split('\n').pop() || ''; } catch { return ''; }
}

/** LATEST.md 에서 한 줄 요약: "한 줄:" 줄 → 첫 본문 줄 */
function handoffLine(latest) {
  const lines = String(latest || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const tagged = lines.find((l) => /^[-*]?\s*\**한 줄\**\s*[:：]/.test(l));
  if (tagged) return tagged.replace(/^[-*]?\s*\**한 줄\**\s*[:：]\s*/, '');
  return (lines.find((l) => !l.startsWith('#') && !l.startsWith('<!--')) || '').replace(/^[-*]\s*/, '');
}

/** TODO.md(사용자가 등록한 할 일)의 항목 수 (체크 안 된 목록 항목) */
function todoCount(todo) {
  return String(todo || '').split('\n').filter((l) => /^\s*[-*]\s+(?!\[x\])/i.test(l)).length;
}

/**
 * 팀 채널: push 된 변경 → 보낼 문장들.
 * changes = { project, handoffs: [{ id, latest, todo, topics: [이름] }], plan: { author, text } | null, settings: [{ author, subject }] }
 */
function teamMessages(cfg, changes) {
  if (!cfg.chat || !cfg.token) return [];
  const out = [];
  const p = changes.project;
  if (cfg.events.includes('handoff')) {
    for (const h of changes.handoffs || []) {
      const line = handoffLine(h.latest);
      const n = todoCount(h.todo);
      const topics = (h.topics || []).length ? `\n작업: ${h.topics.slice(0, 5).join(', ')}` : '';
      out.push(`📝 [${p}] ${h.id} 핸드오프${line ? `: ${clip(line, 300)}` : ''}${topics}\nTODO ${n}건`);
    }
  }
  if (cfg.events.includes('handoff') && changes.plan) {
    const P = require('./plan');
    const plan = P.parse(changes.plan.text);
    if (plan) out.push(`🗺 [${p}] 로드맵 갱신 (${changes.plan.author})\n${P.shortLine(plan, changes.external || '')}\n\`\`\`\n${P.flow(plan, 40)}\n\`\`\``);
  }
  if (cfg.events.includes('settings') && (changes.settings || []).length) {
    const s = changes.settings;
    const authors = [...new Set(s.map((c) => c.author))].join(', ');
    out.push(`⚙️ [${p}] 설정 변경 (${authors})\n${s.slice(0, 5).map((c) => `- ${clip(c.subject, 120)}`).join('\n')}${s.length > 5 ? `\n외 ${s.length - 5}건` : ''}`);
  }
  return out;
}

function announceMessage(cfg, { project, author, text }) {
  if (!cfg.events.includes('announce') || !cfg.chat || !cfg.token) return null;
  return `📢 [${project}] ${author ? `${author}: ` : ''}${clip(text, 3000)}`;
}

const ZERO = /^0+$/;
const SETTINGS_PATH = /^(workspace\.json$|packs\/|bin\/)/;

/**
 * pre-push 입력(줄마다 "<local ref> <local sha> <remote ref> <remote sha>") → push 되는 변경.
 * { handoffs: [{ id, latest, todo, topics }], plan: { author, text } | null (로드맵 handoffs/PLAN.md 가 바뀌었을 때), settings: [{ author, subject }], refs: [{ remoteRef, sha }] }
 * git = (args) => 문자열 | null (lib/workspace 의 git 을 root 에 묶은 것)
 */
function collectPush(git, stdin, remote) {
  const out = { handoffs: [], plan: null, settings: [], refs: [] };
  const ids = new Map();
  let plan = null;
  const seen = new Set();
  for (const line of String(stdin || '').split('\n')) {
    const [, sha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!sha || ZERO.test(sha)) continue; // 브랜치 삭제
    out.refs.push({ remoteRef, sha });
    const range = remoteSha && !ZERO.test(remoteSha) ? [`${remoteSha}..${sha}`] : [sha, '--not', `--remotes=${remote}`];
    const commits = (git(['rev-list', '--no-merges', ...range]) || '').split('\n').filter(Boolean);
    for (const c of commits.reverse()) {
      if (seen.has(c)) continue;
      seen.add(c);
      const [head, ...files] = (git(['-c', 'core.quotepath=false', 'show', '--name-only', '--format=%an%x00%s', c]) || '').split('\n').filter(Boolean);
      if (!head) continue;
      const [author, subject] = head.split('\0');
      let isSettings = false;
      for (const f of files) {
        if (f === 'handoffs/PLAN.md') { plan = { sha, author }; continue; }
        const m = f.match(/^handoffs\/([^/]+)\/(.+)$/);
        if (m) {
          const h = ids.get(m[1]) || { id: m[1], sha, topics: new Set() };
          h.sha = sha;
          const t = m[2].match(/^topics\/(.+)\.md$/);
          if (t) h.topics.add(t[1]);
          ids.set(m[1], h);
        } else if (SETTINGS_PATH.test(f)) isSettings = true;
      }
      if (isSettings) out.settings.push({ author, subject });
    }
  }
  for (const h of ids.values()) {
    out.handoffs.push({
      id: h.id,
      latest: git(['show', `${h.sha}:handoffs/${h.id}/LATEST.md`]) || '',
      todo: git(['show', `${h.sha}:handoffs/${h.id}/TODO.md`]) || '',
      topics: [...h.topics],
    });
  }
  if (plan) {
    const text = git(['show', `${plan.sha}:handoffs/PLAN.md`]);
    if (text) out.plan = { author: plan.author, text };
  }
  return out;
}

/**
 * 보내기. 기본은 마크다운 → 텔레그램 HTML. opts.html = 이미 HTML (변환하지 않음) · opts.markup = reply_markup (마지막 조각에) · opts.replyTo = 답장할 메시지 id
 */
async function send(text, { token, chat }, timeoutMs = 5000, opts = {}) {
  let last = null;
  const parts = chunks(text, 3500); // 텔레그램 한 메시지 4096자 (변환하면 태그만큼 늘어난다)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const extra = { ...(i === parts.length - 1 && opts.markup ? { reply_markup: opts.markup } : {}), ...(i === 0 && opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}) };
    const post = (body) => fetch(`${API()}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, link_preview_options: { is_disabled: true }, ...extra, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    }).then((r) => r.json());
    last = await post({ text: opts.html ? part : toTelegramHtml(part), parse_mode: 'HTML' });
    if (last && last.ok === false) last = await post({ text: opts.html ? part.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : part }); // 서식이 거부되면 원문 그대로
  }
  return last;
}

/** 음성 메시지 (OGG/OPUS · MP3 · M4A 는 텔레그램이 음성으로 재생한다). file = 로컬 경로 */
async function sendVoice(file, { token, chat }, { caption = '', timeoutMs = 20000 } = {}) {
  const form = new FormData();
  form.append('chat_id', String(chat));
  if (caption) form.append('caption', caption.slice(0, 1000));
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = { m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg' }[ext] || 'application/octet-stream';
  form.append('voice', new Blob([fs.readFileSync(file)], { type }), path.basename(file));
  return fetch(`${API()}/bot${token}/sendVoice`, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) }).then((r) => r.json());
}

// ───────── 결정 질문 (자리 비움) — 결정마다 메시지 + 답장 키보드(누르면 그 글자가 답) + ✏️ 직접 입력 ─────────

const escHtml = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * spec = { title?, decisions: [{ title, context?, options: [{ label, detail? }], recommended?: 0 부터 (기본 0) }] }
 * 반환 { head, messages: [html], keyboard } — 답 코드: "<결정>-<보기>" (1-1), 직접 입력: "<결정>: 내용" 또는 "<결정> ✏️" 버튼
 * 답 버튼: 보기마다 한 줄 「1-1 ✅ 보기 이름」(누르면 그 글자가 답, 앞의 번호가 답 코드). 한 번 누르면 접힌다(입력창 옆 ⌨ 로 다시 연다)
 */
function decisionMessages(spec) {
  const list = (spec && spec.decisions) || [];
  const n = list.length;
  const head = [`🟡 <b>결정 ${n}건</b>${spec.title ? ` · ${escHtml(spec.title)}` : ''}`,
    '버튼을 누르거나 <code>1-1, 2-1</code> 처럼 답하세요.',
    '보기에 없으면 ✏️ 버튼을 누르거나 <code>2: 원하는 내용</code> 처럼 적으세요.'].join('\n');
  const messages = list.map((d, i) => {
    const no = i + 1;
    const rec = Number.isInteger(d.recommended) ? d.recommended : 0;
    const ctx = String(d.context || '').trim();
    const long = ctx.length > 160 || ctx.split('\n').length > 3;
    return [`<b>${no}/${n}  ${escHtml(d.title)}</b>`,
      ...(ctx ? [`<blockquote${long ? ' expandable' : ''}>${escHtml(ctx)}</blockquote>`] : []),
      ...(d.options || []).map((o, k) => `${k === rec ? '✅' : '▫️'} <b>${no}-${k + 1}</b> ${escHtml(o.label)}${k === rec ? ' <i>(권장)</i>' : ''}${o.detail ? `\n      <i>${escHtml(o.detail)}</i>` : ''}`),
    ].join('\n');
  });
  const short = (t, max = 22) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > max ? `${x.slice(0, max - 1)}…` : x; };
  const rows = list.flatMap((d, i) => {
    const rec = Number.isInteger(d.recommended) ? d.recommended : 0;
    return [...(d.options || []).map((o, k) => [{ text: `${i + 1}-${k + 1}${k === rec ? ' ✅' : ''} ${short(o.label)}`.trim() }]), [{ text: `${i + 1} ✏️ 직접 입력` }]];
  });
  if (n > 1) rows.push([{ text: '모두 권장안' }]);
  const keyboard = { keyboard: rows, resize_keyboard: true, one_time_keyboard: true, input_field_placeholder: '버튼 · 1-1 · 2: 원하는 내용' };
  return { head, messages, keyboard };
}

/** ✏️ 직접 입력 — 그 결정 메시지에 답장하는 입력창을 연다 (ForceReply) */
function promptMessage(spec, no) {
  const d = ((spec && spec.decisions) || [])[no - 1];
  const n = ((spec && spec.decisions) || []).length;
  return {
    text: `✏️ <b>${no}/${n}${d ? `  ${escHtml(d.title)}` : ''}</b>\n원하는 답을 적어 주세요.`,
    markup: { force_reply: true, input_field_placeholder: `${no}번 답`.slice(0, 64) },
  };
}

/** 끝남 알림이 답 버튼을 걷을 때인가: 결정 질문을 이번 요청 전에 보냈고(= 그 뒤 답이 왔다) 이번 끝 응답이 새 결정 질문이 아님. 질문을 보낸 그 요청에서는 걷지 않는다 */
function shouldClearKeyboard({ pending, askedAt, turn, last }) {
  return !!(pending && askedAt && turn && askedAt < turn && !looksLikeDecision(last));
}

/** 답을 다 받았을 때 — 키보드를 걷고 받은 답을 한 번 보여 준다 */
function answeredMessage(summary) {
  return { text: `✔ <b>답을 받았습니다</b>${summary ? `\n${escHtml(summary)}` : ''}`, markup: { remove_keyboard: true } };
}

// ───────── 음성 — 결정 질문 · 끝남 보고를 짧게 읽어 준다 (텔레그램은 글을 읽어 주지 않아 음성 파일을 만든다) ─────────

const VOICE_SCOPES = ['both', 'decisions', 'done', 'all'];
const VOICE_SCOPE_LABEL = { both: '결정 질문 + 끝남 보고', decisions: '결정 질문만', done: '끝남 보고만', all: '모든 메시지' };

/** 이 PC 음성 설정 { on, scope, name } (기본: 꺼짐 · 결정 질문만 · Yuna) */
function voiceOf(root) {
  const v = (readLocal(root).notify || {}).voice || {};
  return { on: v.on === true, scope: VOICE_SCOPES.includes(v.scope) ? v.scope : 'decisions', name: v.name || 'Yuna' };
}
/** kind = decisions(결정 질문) · done(끝남 보고) · other(그 밖) */
const voiceWants = (v, kind) => v.on && (v.scope === 'all' || (v.scope === 'both' && kind !== 'other') || v.scope === kind);

/** 읽을 문장으로 — 코드 · 경로 · 주소 · 마크다운 기호를 빼고 길이를 줄인다 */
/**
 * 읽을 글자만 남긴다 (보고하듯 문장만): 코드 · 주소 · 파일 이름 · 커밋 해시 · 문서 ID · 괄호 안 · 기호와 이모지를 빼고,
 * 날짜는 「10월 7일」, 시각은 「9시 30분」, 「n / N」 은 「N 중 n」, · → : 는 쉼표로. say 가 기호를 이름으로 읽어 문맥이 끊기던 것을 막는다
 */
function speakable(text, max = 400) {
  let t = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S*\/\S+\.\w+/g, ' ')
    .replace(/\b[\w.-]+\.(?:js|mjs|ts|tsx|jsx|json|md|html?|css|py|java|kt|ya?ml|toml|sh|txt|ogg|m4a|png|pdf|sql|xml)\b/gi, ' ')
    .replace(/\(([^)]*)\)/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/(?<![\w-])(\d{4})-(\d{2})-(\d{2})(?![\w-])/g, (_, y, m, d) => ` ${Number(m)}월 ${Number(d)}일 `)
    .replace(/(?<![\w-])[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+(?:\s*[·,~]\s*\d+(?![\w-]))*(?![\w-])/g, ' ')
    .replace(/(?<!\w)(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?!\w)/g, ' ')
    .replace(/(\d+)\s*\/\s*(?:전체\s*)?(\d+)/g, '$2 중 $1')
    .replace(/(\d)\s*~\s*(\d)/g, '$1에서 $2')
    .replace(/(\d)\s*%/g, '$1 퍼센트')
    .replace(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g, (_, h, m) => `${Number(h)}시${Number(m) ? ` ${Number(m)}분` : ''}`)
    .replace(/(?:[⌘⌥⌃⇧]|\b(?:Shift|Cmd|Ctrl|Alt|Option)\b)(?:\s*\+?\s*(?:[⌘⌥⌃⇧]|Shift|Cmd|Ctrl|Alt|Option|F\d{1,2}|Enter|Esc|Tab|[A-Z0-9](?![a-z]))\b)+/gi, ' 단축키')
    .replace(/\s*(?:·|→|->|=>|←|⇒|—|–|\||:|：)\s*/g, ', ')
    .replace(/[^\p{L}\p{N}\s.,?!']/gu, ' ')
    .replace(/\s+([.,?!])/g, '$1')
    .replace(/([.,?!])(?:\s*[.,])+/g, '$1')
    .replace(/(^|[.?!]\s*),\s*/g, '$1')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[,.\s]+|[,\s]+$/g, '');
  if (t.length > max) t = `${t.slice(0, max).replace(/\s\S*$/, '').replace(/[,\s]+$/, '')}. 이하 생략.`;
  return t;
}

const ORDINAL = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째'];
function decisionsSpeech(spec) {
  const list = (spec && spec.decisions) || [];
  const parts = list.map((d, i) => {
    const rec = (d.options || [])[Number.isInteger(d.recommended) ? d.recommended : 0];
    return `${ORDINAL[i] || `${i + 1}번`}, ${d.title}. 권장은 ${rec ? String(rec.label).split(/[:：]/)[0] : '없음'}.`;
  });
  return speakable(`결정 ${list.length}건이 있습니다. ${parts.join(' ')} 버튼이나 번호로 답해 주세요.`, 900);
}

/** 끝남 보고 → 문단 · 목록 줄만 앞에서부터 (표 · 코드 · 제목 · 인용은 뺀다). 줄마다 한 문장으로 끊는다 */
function doneSpeech(md) {
  const src = String(md || '').replace(/```[\s\S]*?```/g, '\n');
  const out = [];
  for (const raw of src.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('|') || /^#{1,6}\s/.test(l) || /^[-*_]{3,}$/.test(l) || l.startsWith('>')) continue;
    const s = speakable(l.replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s*/, ''), 400);
    if (s.length < 2) continue;
    out.push(/[.?!]$/.test(s) ? s : `${s}.`);
    if (out.join(' ').length > 300 || out.length >= 5) break;
  }
  return speakable(out.join(' '), 350);
}

/**
 * 음성 파일 만들기 → 경로 또는 null. macOS: say + afconvert(M4A, 기본 도구). 그 밖: espeak-ng + ffmpeg(OGG/OPUS) 가 있을 때만
 * 반환 { file, error }
 */
/** macOS 에 깔린 목소리 [{ name, lang }] (say -v '?'). 다른 OS 는 빈 목록 */
function voiceList() {
  if (process.platform !== 'darwin') return [];
  try {
    return require('child_process').execFileSync('say', ['-v', '?'], { encoding: 'utf8', timeout: 10000 }).split('\n')
      .map((l) => l.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})\s/)).filter(Boolean).map((m) => ({ name: m[1].trim(), lang: m[2] }));
  } catch { return []; }
}

function tts(text, { name = 'Yuna', dir = os.tmpdir() } = {}) {
  const { execFileSync } = require('child_process');
  const base = path.join(dir, `kedovi-voice-${process.pid}-${Date.now()}`);
  try {
    if (process.platform === 'darwin') {
      // 없는 이름이면 say 가 기본 목소리로 조용히 바꿔 읽는다 → 미리 막는다 ("Yuna" 는 목록에 "Yuna (한국어(한국))" 처럼 나올 수 있다)
      const list = voiceList();
      if (list.length && !list.some((v) => v.name === name || v.name.startsWith(`${name} (`))) return { file: null, error: `목소리 '${name}' 가 이 Mac 에 없습니다. 한국어: ${list.filter((v) => v.lang === 'ko_KR').map((v) => v.name.replace(/ \(.*$/, '')).join(', ') || '없음'}` };
      execFileSync('say', ['-v', name, '-o', `${base}.aiff`, text], { stdio: 'ignore', timeout: 60000 });
      execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', `${base}.aiff`, `${base}.m4a`], { stdio: 'ignore', timeout: 60000 });
      fs.rmSync(`${base}.aiff`, { force: true });
      return { file: `${base}.m4a` };
    }
    execFileSync('espeak-ng', ['-v', 'ko', '-w', `${base}.wav`, text], { stdio: 'ignore', timeout: 60000 });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${base}.wav`, '-c:a', 'libopus', `${base}.ogg`], { stdio: 'ignore', timeout: 60000 });
    fs.rmSync(`${base}.wav`, { force: true });
    return { file: `${base}.ogg` };
  } catch (e) {
    return { file: null, error: process.platform === 'darwin' ? `목소리 '${name}' 로 음성을 만들지 못했습니다 (say -v '?' 로 목소리 확인)` : '음성을 만들 도구가 없습니다 (espeak-ng · ffmpeg 필요)' };
  }
}

/** 음성으로도 보내기 (설정이 켜져 있고 이 종류를 원할 때). 실패해도 글 알림은 이미 갔으므로 조용히 null */
async function sendSpeech(root, cfg, kind, text) {
  const v = voiceOf(root);
  if (!voiceWants(v, kind) || !cfg.token || !cfg.chat || !text) return null;
  const { file, error } = tts(text, { name: v.name });
  if (!file) return { ok: false, error };
  try { return await sendVoice(file, cfg); } catch (e) { return { ok: false, error: e.message }; } finally { fs.rmSync(file, { force: true }); }
}

/**
 * 마크다운 → 텔레그램 HTML. 텔레그램은 표를 그리지 못해 표는 행마다 "• 첫 칸: 나머지" 목록으로,
 * **굵게** · # 제목 → <b>, `코드` · ``` 블록 → <code> · <pre>, - 목록 → •, [글](주소) → 링크. 나머지 글자는 HTML 이스케이프
 */
function toTelegramHtml(md) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (t) => {
    const codes = [];
    let x = String(t).replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    x = esc(x)
      .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, a, u) => `<a href="${u.replace(/"/g, '&quot;')}">${a}</a>`)
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1<i>$2</i>');
    return x.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  };
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const lines = String(md).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = l.match(/^\s*```/);
    if (fence) { // 코드 블록 (닫는 줄이 없으면 끝까지)
      const body = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      out.push(`<pre>${esc(body.join('\n'))}</pre>`);
      continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && isSep(lines[i + 1])) { // 표 → 목록
      const head = cells(l);
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
        const row = cells(lines[i]);
        const rest = row.slice(1).map((c, k) => (head.length > 2 && head[k + 1] ? `${inline(head[k + 1])} ${inline(c)}` : inline(c))).filter((x) => x.trim());
        out.push(`• <b>${inline(row[0])}</b>${rest.length ? `: ${rest.join(' · ')}` : ''}`);
      }
      i--;
      continue;
    }
    const h = l.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) { if (out.length && out[out.length - 1] !== '') out.push(''); out.push(`<b>${inline(h[1])}</b>`); continue; } // 제목 앞은 한 줄 띄운다
    if (/^\s*>\s?/.test(l)) { // 인용 → blockquote (이어진 줄을 묶는다)
      const body = [];
      for (; i < lines.length && /^\s*>\s?/.test(lines[i]); i++) body.push(inline(lines[i].replace(/^\s*>\s?/, '')));
      i--;
      out.push(`<blockquote>${body.join('\n')}</blockquote>`);
      continue;
    }
    const li = l.match(/^(\s*)[-*+]\s+(.*)$/);
    if (li) { out.push(`${li[1]}• ${inline(li[2])}`); continue; }
    out.push(inline(l));
  }
  return out.join('\n');
}

/** 긴 메시지 → 앞 keep 줄만 보이고 나머지는 접히는 인용 (코드 블록이 뒤에 있으면 접지 않는다). html 은 toTelegramHtml 결과 */
function foldHtml(html, keep = 10) {
  const lines = String(html).split('\n');
  if (lines.length <= keep + 3) return html;
  const tail = lines.slice(keep).join('\n');
  if (/<pre>|<blockquote/.test(tail)) return html;
  return `${lines.slice(0, keep).join('\n')}\n<blockquote expandable>${tail}</blockquote>`;
}

/** 4000자 안쪽으로 나눈다 (빈 줄 → 줄바꿈 → 글자 순으로 끊을 곳을 찾는다) */
function chunks(text, max = 4000) {
  const out = [];
  let rest = String(text || '');
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * 채널 세션에서 터미널 요청의 질문 · 답을 텔레그램으로 (양쪽에 같은 대화가 남게). 텔레그램에서 온 요청은 Claude 가 reply 로 보내므로 null
 * prompt = UserPromptSubmit 에서 적어 둔 터미널 요청 (없으면 텔레그램 요청 또는 기록 없음)
 */
function mirrorMessage(prompt, answer, project) {
  if (!prompt || !String(answer || '').trim()) return null;
  return `🖥 [${project}] 터미널\n${clip(prompt, 1000)}\n\n🤖\n${String(answer).trim()}`;
}

/** 봇 이름 (@username). 못 얻으면 null */
async function botName(token) {
  try {
    const body = await (await fetch(`${API()}/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) })).json();
    return body.ok && body.result ? `@${body.result.username}` : null;
  } catch { return null; }
}

/** 봇이 받은 최근 메시지의 채팅 목록 (setup 에서 채팅 ID 를 찾는다) */
async function recentChats(token) {
  const res = await fetch(`${API()}/bot${token}/getUpdates`, { signal: AbortSignal.timeout(8000) });
  const body = await res.json();
  if (!body.ok) throw new Error(body.description || '토큰을 확인하세요');
  const seen = new Map();
  for (const u of body.result || []) {
    const c = (u.message || u.channel_post || u.my_chat_member || {}).chat;
    if (c) seen.set(String(c.id), { type: c.type, name: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || c.type });
  }
  return [...seen].map(([id, c]) => ({ id, ...c }));
}

module.exports = {
  LEVELS, LEVEL_LABEL, wantsProgress, brief, remoteControl, levelOf, idleSeconds, atDesk, DEFAULT_DESK_SECONDS,
  EVENTS, TEAM_EVENTS, DEFAULT_MIN_SECONDS, secretFile, parseEvents, readSecrets, writeSecrets, readLocal, projectName, waitKind, CHANNEL_PLUGIN, channelDir, channelInstalls, channelPluginScope, channelToken, channelTokenUsedElsewhere, channelAccess, channelOn, channelAskMode, looksLikeDecision, channelCheck, channelHealth, channelShim, channelLogLast, holderOf,
  personal, team, personalMessage, teamMessages, announceMessage, handoffLine, todoCount, collectPush, send, sendVoice, decisionMessages, promptMessage, answeredMessage, shouldClearKeyboard, VOICE_SCOPES, VOICE_SCOPE_LABEL, voiceOf, voiceWants, speakable, decisionsSpeech, doneSpeech, tts, voiceList, sendSpeech, foldHtml, chunks, toTelegramHtml, mirrorMessage, recentChats, botName, duration,
};
