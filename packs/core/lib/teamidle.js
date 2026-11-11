// 대기 팀원 점검 (Claude Code agent teams): 일을 마치고 대기(idle)로 오래 남은 팀원을 찾는다. 팀 설정 파일만 읽고 아무것도 종료하지 않는다.
/*
 * 팀원 목록 = <Claude 설정 폴더>/teams/session-<리더 세션 ID 앞 8자>/config.json 의 members (팀원마다 isActive: 일하는 중인가)
 *   종료 요청이 승인됐거나 TaskStop 으로 멈춘 팀원은 members 에서 빠진다
 * 대기 시작 시각은 TeammateIdle 훅(팀원 세션에서 돈다)이 적는다. 적힌 것이 없으면 리더 쪽 점검이 처음 본 때부터 센다
 * 기록 = 상태 폴더의 <팀 이름>.idle.json { idle: { 이름: 시각 }, warned: { 이름: 시각 } }
 * 쓰는 곳: hooks/team-idle.js. 수준 · 시간은 bin/kit.js resolveModels 의 enforce.idleTeammates · idle
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stateDir } = require('./workspace');

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const safe = (s) => String(s || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
const teamsDir = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'teams');
/**
 * 리더 세션의 팀 이름. 기본은 session-<세션 ID 앞 8자>. 이어서 시작(-c · --resume)하면 세션 ID 가 바뀌어도 팀은 처음 ID 이름 그대로라,
 * 그 이름의 팀이 없으면 팀 설정의 leadSessionId · 대화 기록의 마지막 team_name 으로 찾는다. 인자는 세션 ID 나 훅 입력({ session_id, transcript_path })
 */
const teamCache = new Map();
function teamOf(x) {
  if (x && typeof x === 'object' && x.team) return String(x.team); // 팀 이름을 바로 준 경우 (kedovi team 현황)
  const sessionId = String((x && typeof x === 'object' ? x.session_id : x) || '');
  const transcript = x && typeof x === 'object' ? x.transcript_path : null;
  const own = `session-${sessionId.slice(0, 8)}`;
  const key = `${sessionId}\n${transcript || ''}`;
  if (teamCache.has(key)) return teamCache.get(key);
  const has = (t) => fs.existsSync(path.join(teamsDir(), t, 'config.json'));
  let team = own;
  if (sessionId && !has(own)) {
    let found = null;
    try { found = fs.readdirSync(teamsDir()).find((t) => (readJson(path.join(teamsDir(), t, 'config.json')) || {}).leadSessionId === sessionId) || null; } catch { /* 팀 폴더 없음 */ }
    if (!found && transcript) {
      try { // 끝에서 4MB 안의 마지막 team_name (팀원을 띄운 Agent 호출 입력에 있다)
        const fd = fs.openSync(transcript, 'r');
        const size = fs.fstatSync(fd).size;
        const len = Math.min(size, 4 * 1024 * 1024);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, size - len);
        fs.closeSync(fd);
        const names = [...buf.toString('utf8').matchAll(/"team_name":"([A-Za-z0-9._-]+)"/g)].map((m) => m[1]);
        found = names.reverse().find(has) || null;
      } catch { /* 기록 없음 */ }
    }
    if (found) team = found;
  }
  teamCache.set(key, team);
  return team;
}
const file = (ROOT, team) => path.join(stateDir(real(ROOT)), `${safe(team)}.idle.json`);
const load = (ROOT, team) => ({ idle: {}, warned: {}, ...(readJson(file(ROOT, team)) || {}) });
const save = (ROOT, team, st) => fs.writeFileSync(file(ROOT, team), JSON.stringify(st));

/** 수준 · 시간(분). 옛 워크스페이스면 기본값 */
function settings(ROOT) {
  const d = { level: 'block', status: 'block', after: 10, remind: 30 };
  try {
    const kit = require(path.join(ROOT, 'bin', 'kit.js'));
    const r = kit.resolveModels(ROOT, kit.loadWorkspace(ROOT));
    return { level: (r.enforce || {}).idleTeammates || d.level, status: (r.enforce || {}).waitStatus || d.status, after: (r.idle || d).after, remind: (r.idle || d).remind };
  } catch { return d; }
}

/** TeammateIdle: 그 팀원의 대기 시작 시각을 적는다 */
function markIdle(ROOT, team, name, now = Date.now()) {
  if (!team || !name) return;
  const st = load(ROOT, team);
  st.idle[name] = now;
  delete st.warned[name];
  save(ROOT, team, st);
}

/** 리더 세션의 팀원 (리더 제외). 팀 설정 파일이 없으면 null */
function members(sessionId) {
  const c = readJson(path.join(teamsDir(), teamOf(sessionId), 'config.json')); // sessionId = 세션 ID 나 훅 입력 (teamOf)
  if (!c || !Array.isArray(c.members)) return null;
  return c.members.filter((m) => m && m.name && m.agentId !== c.leadAgentId && m.agentType !== 'team-lead');
}

/** 대기 after 분 이상이고, 같은 팀원을 remind 분 안에 알린 적이 없는 팀원 [{ name, minutes }]. mark 면 알렸다고 적는다 */
function overdue(ROOT, sessionId, { after = 10, remind = 30 } = {}, { mark = true, now = Date.now() } = {}) {
  const list = members(sessionId);
  if (!list) return [];
  const team = teamOf(sessionId);
  const st = load(ROOT, team);
  const before = JSON.stringify(st);
  const names = new Set(list.map((m) => m.name));
  const states = memberStates(sessionId, { now });
  for (const k of Object.keys(st.idle)) if (!names.has(k)) delete st.idle[k]; // 종료된 팀원
  for (const k of Object.keys(st.warned)) if (!names.has(k)) delete st.warned[k];
  const out = [];
  for (const m of list) {
    if (m.isActive === true) { delete st.idle[m.name]; delete st.warned[m.name]; continue; } // 다시 일하는 중
    const ms = states.find((x) => x.name === m.name);
    if (ms && ms.state === 'working') { delete st.idle[m.name]; delete st.warned[m.name]; continue; } // 메시지함으로 본 일하는 중
    if (m.isActive !== false && !st.idle[m.name] && !(ms && ms.state === 'idle')) continue; // 상태 필드가 없는 판: TeammateIdle 기록 · 대기 알림이 있을 때만 대기로 본다
    if (!st.idle[m.name] && ms && ms.state === 'idle' && ms.since) st.idle[m.name] = ms.since;
    if (!st.idle[m.name]) st.idle[m.name] = now;
    const minutes = Math.floor((now - st.idle[m.name]) / 60000);
    if (minutes < after) continue;
    if (st.warned[m.name] && now - st.warned[m.name] < remind * 60000) continue;
    out.push({ name: m.name, minutes });
    if (mark) st.warned[m.name] = now;
  }
  if (JSON.stringify(st) !== before) save(ROOT, team, st);
  return out;
}

/** 리더에게 줄 문구 */
function message(list, { remind = 30 } = {}) {
  return `일을 마치고 대기 중인 팀원이 있습니다: ${list.map((x) => `${x.name}(대기 ${x.minutes}분)`).join(', ')}. `
    + '다시 맡길 일이 없으면 팀원마다 정식 종료 요청(SendMessage 의 shutdown_request)을 보내고, 몇 분 지나도 팀원 목록에 남아 있으면 TaskStop(task_id 에 팀원 이름)으로 멈춥니다. '
    + `남겨 둘 것이면 사용자 보고에 "대기 중: <역할> · 사유" 한 줄을 적습니다. 같은 팀원은 ${remind}분 뒤에 다시 알립니다. 수준 바꾸기: kedovi team-mode enforce idle off|warn|block`;
}

/**
 * 리더가 턴을 끝낼 때 남아 있는 것. Stop 훅 입력의 background_tasks([{ type: shell | teammate …, status, description, command }])와 팀 설정 파일로 본다
 * 팀원은 대기 중이어도 background_tasks 에 running 으로 오므로 일하는 중 · 대기는 팀 설정 파일의 isActive 로 가른다
 * → { bg: [설명], working: [이름], idle: [이름], any }
 */
function waiting(input) {
  const at = (() => { try { return tmuxAttach(input || {}); } catch { return null; } })();
  const tasks = Array.isArray(input && input.background_tasks) ? input.background_tasks : [];
  const bg = tasks.filter((t) => t && t.type !== 'teammate' && (!t.status || t.status === 'running')).map((t) => String(t.description || t.command || t.type || '작업').replace(/\s+/g, ' ').slice(0, 60));
  const states = memberStates(input || {});
  const working = states.filter((m) => m.state === 'working' || m.state === 'stopping').map((m) => m.name);
  const idle = states.filter((m) => m.state === 'idle').map((m) => m.name);
  return { bg, working, idle, attach: at ? at.cmd : '', any: !!(bg.length || working.length || idle.length) };
}

/** 답변에 상태 줄(「지금 도는 것:」으로 시작하는 줄)이 있는가 */
const hasStatus = (text) => /^[\s>*-]*\**지금 도는 것\**\s*[::]/m.test(String(text || ''));

const leftText = (w) => [w.bg.length ? `리더의 백그라운드 작업 ${w.bg.length}개(${w.bg.join(', ')})` : '', w.working.length ? `일하는 중인 팀원 ${w.working.join(', ')}` : '', w.idle.length ? `대기 중인 팀원 ${w.idle.join(', ')}` : ''].filter(Boolean).join(' · ');

/** 상태 줄이 없을 때 리더에게 줄 문구 */
function statusMessage(w) {
  return `남아 있는 것이 있는데 답변에 상태 줄이 없습니다 (${leftText(w)}). 사용자는 화면의 팀원 목록만으로 일하는 중과 대기를 구분하지 못합니다. `
    + `답변 끝에 한 줄을 적습니다: "지금 도는 것: <무엇, 없으면 없음> · 예상 종료: <언제쯤, 모르면 모름> · 사용자가 할 일: <있음(무엇) | 없음>"${w.attach ? ` · 팀원 창: ${w.attach}` : ''}.` + ' 대기 중인 팀원은 일하는 것으로 적지 않고 "대기 중: <역할> · 사유" 로 적습니다. 수준 바꾸기: kedovi team-mode enforce status off|block';
}

/** 끝남 알림에 덧붙일 한 줄. 남은 것이 없으면 '' */
function summary(w) {
  if (!w.any) return '';
  return `⏳ 일하는 팀원 ${w.working.length} · 대기 팀원 ${w.idle.length} · 리더 백그라운드 작업 ${w.bg.length}개${w.bg.length ? ' 대기 중' : ''}`;
}

/**
 * 승인 대기 팀원: 팀원 창에 권한 승인(예 · 아니오) · 입력 대기가 떠 있으면 팀원은 멈춘 채 리더에게 아무것도 오지 않는다.
 * 팀원 세션의 Notification 훅이 { at, msg, transcript } 를 <팀>.idle.json 의 wait 에 적고, 그 뒤 팀원 대화 기록이 바뀌면(승인하고 일을 이어 감) 풀린 것으로 본다
 */
/** 팀원 세션 입력 → { team, name } (입력 필드, 없으면 대화 기록 머리의 teamName · agentName) */
function who(input) {
  let team = input && input.team_name, name = input && input.teammate_name;
  if ((!team || !name) && input && input.transcript_path) {
    try {
      const fd = fs.openSync(input.transcript_path, 'r');
      const buf = Buffer.alloc(32768);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const head = buf.toString('utf8', 0, n);
      team = team || ((/"teamName":"([^"]+)"/.exec(head) || [])[1]);
      name = name || ((/"agentName":"([^"]+)"/.exec(head) || [])[1]);
    } catch { /* 기록 없음 */ }
  }
  return team && name ? { team, name } : null;
}
/** 팀원 세션 Notification: 승인 · 입력 대기를 적는다 */
function markWait(ROOT, input, now = Date.now()) {
  const w = who(input);
  if (!w) return null;
  const st = load(ROOT, w.team);
  st.wait = st.wait || {};
  st.wait[w.name] = { at: now, msg: String(input.message || input.notification_type || '').slice(0, 160), transcript: input.transcript_path || '' };
  save(ROOT, w.team, st);
  return w;
}
/** 리더 쪽: 아직 승인 · 입력을 기다리는 팀원 [{ name, minutes, msg }] (그 뒤 팀원 기록이 바뀌었으면 풀린 것) */
function waitingApproval(ROOT, input, { now = Date.now() } = {}) {
  const list = members(input);
  if (!list) return [];
  const team = teamOf(input);
  const st = load(ROOT, team);
  const names = new Set(list.map((m) => m.name));
  const out = [];
  let changed = false;
  for (const [name, w] of Object.entries(st.wait || {})) {
    let moved = false;
    try { moved = !!w.transcript && fs.statSync(w.transcript).mtimeMs > w.at + 3000; } catch { /* 기록 없음 */ }
    if (!names.has(name) || moved) { delete st.wait[name]; changed = true; continue; }
    out.push({ name, minutes: Math.floor((now - w.at) / 60000), msg: w.msg });
  }
  if (changed) save(ROOT, team, st);
  return out;
}
/** 이 대기를 리더에게 이미 알렸는가 (알렸다고 적는다). 같은 대기는 Stop 에서 한 번만 막는다 */
function waitWarned(ROOT, input, name) {
  const team = teamOf(input);
  const st = load(ROOT, team);
  const w = (st.wait || {})[name];
  if (!w || w.warned) return true;
  w.warned = Date.now();
  save(ROOT, team, st);
  return false;
}
/** 리더에게 줄 문구 */
function waitMessage(list) {
  return `팀원이 자기 창에서 승인 · 입력을 기다리며 멈춰 있습니다: ${list.map((x) => `${x.name}(${x.minutes}분${x.msg ? ` · ${x.msg}` : ''})`).join(', ')}. `
    + '팀원 창의 승인 질문은 리더 화면에 보이지 않습니다. 사용자에게 그 팀원 창(tmux 창 · in-process 면 팀원 전환)에서 승인하라고 바로 알립니다. 읽기 · 조회만 하는 명령이 매번 묻는다면 프로젝트 허용 목록(workspace.json claude.settings.permissions.allow)에 넣자고 제안합니다';
}

/**
 * 팀원마다 실제 상태 (팀 설정 · 메시지함으로 판정). 화면의 팀원 목록은 대기여도 「일하는 중」 처럼 돌아가 보여서 이것으로 가른다
 *   메시지함: <팀>/inboxes/<팀원>.json = 팀원이 받은 것(작업 지시 · shutdown_request), <팀>/inboxes/<리더>.json = 팀원이 보낸 것(보고 · idle_notification)
 *   state: working(일하는 중) · idle(대기) · stopping(종료 요청 뒤 아직 남음) · gone(tmux 창이 없어졌는데 등록만 남음)
 *   where: tmux(창 있음) · in-process(메인 프로세스 안, 창 없음. 창이 없어도 살아 있다) · pane-gone
 * → [{ name, type, state, since, where, shutdownAt, requestId }]
 */
function memberStates(input, { now = Date.now(), panes } = {}) {
  const list = members(input);
  if (!list) return [];
  const dir = path.join(teamsDir(), teamOf(input));
  const cfg = readJson(path.join(dir, 'config.json')) || {};
  const leadName = ((cfg.members || []).find((m) => m.agentId === cfg.leadAgentId || m.agentType === 'team-lead') || {}).name || 'team-lead';
  const box = (n) => { const j = readJson(path.join(dir, 'inboxes', `${n}.json`)); return Array.isArray(j) ? j : []; };
  const kind = (m) => { try { return (JSON.parse(m.text) || {}).type || ''; } catch { return ''; } };
  const ts = (m) => Date.parse(m && m.timestamp) || 0;
  const fromLead = box(leadName);
  if (panes === undefined) {
    panes = null;
    if (list.some((m) => String(m.tmuxPaneId || '').startsWith('%'))) {
      try {
        const r = require('child_process').spawnSync('tmux', ['list-panes', '-a', '-F', '#{pane_id}'], { encoding: 'utf8', timeout: 3000 });
        if (r.status === 0) panes = new Set(r.stdout.split('\n').filter(Boolean));
      } catch { /* tmux 없음 */ }
    }
  }
  return list.map((m) => {
    const got = box(m.name);
    const lastIn = got[got.length - 1];
    const sent = fromLead.filter((x) => x.from === m.name);
    const lastIdle = [...sent].reverse().find((x) => kind(x) === 'idle_notification');
    const pane = String(m.tmuxPaneId || '');
    const where = pane.startsWith('%') ? (panes && !panes.has(pane) ? 'pane-gone' : 'tmux') : 'in-process';
    const base = { name: m.name, type: m.agentType || '', where, shutdownAt: null, requestId: null };
    if (lastIn && kind(lastIn) === 'shutdown_request') {
      let rid = null; try { rid = JSON.parse(lastIn.text).requestId || null; } catch { /* 없음 */ }
      return { ...base, state: where === 'pane-gone' ? 'gone' : 'stopping', since: ts(lastIn), shutdownAt: ts(lastIn), requestId: rid };
    }
    if (where === 'pane-gone') return { ...base, state: 'gone', since: Math.max(ts(lastIn), ts(lastIdle), m.joinedAt || 0) };
    if (m.isActive === true) return { ...base, state: 'working', since: Math.max(ts(lastIn), m.joinedAt || 0) };
    if (m.isActive === false || (lastIdle && ts(lastIdle) >= ts(lastIn))) return { ...base, state: 'idle', since: lastIdle ? ts(lastIdle) : now };
    return { ...base, state: 'working', since: Math.max(ts(lastIn), m.joinedAt || 0) };
  });
}

/**
 * 팀원 tmux 창에 붙는 명령. Claude Code 는 팀원 창을 소켓 claude-swarm-<리더 프로세스 번호> 의 세션에 만든다 (세션마다 소켓이 바뀐다).
 * 팀 설정의 tmuxPaneId(%n)가 들어 있는 소켓을 찾는다 → { socket, session, cmd(읽기 전용), cmdRw } | null
 */
function tmuxAttach(input) {
  if (process.platform === 'win32') return null;
  const list = members(input) || [];
  const panes = new Set(list.map((m) => String(m.tmuxPaneId || '')).filter((p) => p.startsWith('%')));
  if (!panes.size) return null;
  const uid = typeof process.getuid === 'function' ? process.getuid() : '';
  const dirs = [process.env.TMUX_TMPDIR, '/tmp', '/private/tmp'].filter(Boolean).map((d) => path.join(d, `tmux-${uid}`));
  const { spawnSync } = require('child_process');
  const seen = new Set();
  for (const dir of dirs) {
    let socks = [];
    try { socks = fs.readdirSync(dir).filter((f) => f.startsWith('claude-swarm')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t).map((x) => x.f); } catch { continue; }
    for (const sock of socks) {
      if (seen.has(sock)) continue;
      seen.add(sock);
      const r = spawnSync('tmux', ['-L', sock, 'list-panes', '-a', '-F', '#{pane_id} #{session_name}'], { encoding: 'utf8', timeout: 2000 });
      if (r.status !== 0) continue;
      const hit = r.stdout.split('\n').map((l) => l.split(' ')).find(([id]) => panes.has(id));
      if (hit) return { socket: sock, session: hit[1], cmd: `tmux -L ${sock} attach -r -t ${hit[1]}`, cmdRw: `tmux -L ${sock} attach -t ${hit[1]}` };
    }
  }
  return null;
}

const STATE_TEXT = { working: '일하는 중', idle: '대기', stopping: '종료 요청 뒤 남음', gone: '종료됨(등록만 남음)' };
const WHERE_TEXT = { tmux: 'tmux 창', 'in-process': '메인 안(창 없음)', 'pane-gone': '창 없어짐' };

/** 종료 요청을 보내고 after 초가 지났는데 남아 있는 팀원 (아직 알리지 않은 요청만, mark 면 알렸다고 적는다) */
function stuckShutdown(ROOT, input, { after = 60, mark = true, now = Date.now() } = {}) {
  const list = memberStates(input, { now }).filter((x) => (x.state === 'stopping' || x.state === 'gone') && x.shutdownAt && now - x.shutdownAt >= after * 1000);
  if (!list.length) return [];
  const team = teamOf(input);
  const st = load(ROOT, team);
  st.shutdownWarned = st.shutdownWarned || {};
  const out = list.filter((x) => !st.shutdownWarned[`${x.name}|${x.requestId || x.shutdownAt}`]);
  if (mark && out.length) { for (const x of out) st.shutdownWarned[`${x.name}|${x.requestId || x.shutdownAt}`] = now; save(ROOT, team, st); }
  return out.map((x) => ({ ...x, minutes: Math.max(1, Math.floor((now - x.shutdownAt) / 60000)) }));
}

function shutdownMessage(list) {
  return `종료 요청을 보냈는데 승인 없이 남아 있는 팀원이 있습니다: ${list.map((x) => `${x.name}(${x.minutes}분 · ${WHERE_TEXT[x.where]})`).join(', ')}. `
    + 'TaskStop(task_id 에 팀원 이름)으로 멈춥니다. tmux 창이 없어도 메인 프로세스 안에서 살아 있을 수 있으니 창 유무로 종료됐다고 판단하지 않습니다 (확인: kedovi team). 수준 바꾸기: kedovi team-mode enforce idle off|warn|block';
}

module.exports = { tmuxAttach, teamsDir, memberStates, STATE_TEXT, WHERE_TEXT, stuckShutdown, shutdownMessage, settings, markIdle, members, overdue, message, teamOf, waiting, hasStatus, statusMessage, summary, who, markWait, waitingApproval, waitWarned, waitMessage };
