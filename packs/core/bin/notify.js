#!/usr/bin/env node
// 메신저(텔레그램) 알림 설정·발송. 실행: kedovi notify my|team <명령> (kedovi 이 이 도구로 옮겨 부른다) 또는 node packs/core/bin/notify.js <명령>
/*
 * 개인 채널 (이 PC · 이 워크스페이스). 설정 화면은 kedovi notify setup
 *   level all|decisions|progress|off   알림 수준: 전체 · 결과와 결정(기본) · 진행 현황 · 끄기
 *   min <초>                       결과 알림 기준 (이보다 짧게 끝난 요청은 보내지 않는다. 0 = 모두)
 *   away on|off                    자리 비움: 결정은 텔레그램 버튼 질문으로 (ask) · 결과는 시간과 상관없이. 자리에 있으면 선택 대기 · 모든 작업 끝 한 줄만
 *   remote done|quiet|send         리모트 컨트롤(Claude 앱)로 이어진 세션: done = 작업 끝만 텔레그램(기본, 결정은 앱이 알린다) · quiet = 텔레그램 쉼 · send = 그대로 보냄
 *   voice on|off · scope both|decisions|done|all · name <목소리> · test   음성: 결정 질문 · 끝남 보고를 짧게 읽어 보낸다 (기본 꺼짐 · 결정+끝남 · Yuna, macOS 기본 도구)
 * 세션이 부르는 것 (자리 비움 · 채널)
 *   ask --file <결정.json>         결정 질문: 머리 + 결정마다 메시지 + 답 버튼(1-1 ✅ · ✏️ · 모두 권장안). 음성 설정이면 음성도
 *   prompt <번호>                  ✏️ 직접 입력: 그 결정에 답장하는 입력창을 연다
 *   answered "<받은 답 요약>"       답 버튼을 걷는다
 *   say [--done] [--fold <줄>]     마크다운(stdin) → 텔레그램 서식(제목 · 목록 · 인용 · 긴 뒷부분 접기). --done 은 끝남 보고(음성)
 *   setup [--new] [--no-on]        개인 봇 토큰 저장 + 봇과의 1:1 채팅 ID 를 찾아 저장 (봇에게 먼저 아무 말이나 보낸다). 자동 알림이 꺼져 있으면 켠다 (직접 off 한 PC 는 그대로)
 *                                  토큰은 숨김 입력(터미널) 또는 표준 입력. 이미 있으면 그 토큰으로 다시 찾고, --new 면 새 토큰을 받는다. 인자(setup <토큰>)도 받지만 셸 기록에 남는다
 *   on [stop,notification] [--chat <id>] [--min <초>]   켠다 (.agents/local.json notify)
 *   off                            끈다 (팀 기본이 켜져 있어도)
 *   reset                          이 PC 값을 지우고 팀 기본을 따른다
 *   remove [--team]                개인 봇(토큰 · 채팅 ID) 제거 · --team 은 팀 봇 토큰 제거 (이 PC 의 모든 워크스페이스 공통 파일)
 *   channel remove                 양방향 채널 제거: 끄기 + 이 프로젝트 상태 폴더(봇 토큰 · 허용 목록) · local 플러그인 설치 삭제
 *   channel progress <분|off>      채널 세션 진행 현황: 사용자 입력 없이 N 분(기본 5) 넘게 작업하면 N 분마다 지금 하는 일을 보낸다
 *   channel ask dialog|text        채널 세션 질문 방식: dialog(기본) 터미널 선택지 창 · text 텔레그램 버튼 질문(= 자리 비움)
 *   channel on [--new]|off|status  양방향 채널 (기본 꺼짐): 이 프로젝트 전용 봇에게 보낸 메시지가 Claude Code 세션에 들어오고 답이 온다
 *                                  봇 토큰은 숨김 입력 또는 표준 입력 (--new = 봇 바꾸기. 인자로도 받지만 셸 기록에 남는다)
 *                                  on = Bun · 공식 telegram 플러그인 확인(없으면 user 범위로 설치) · 프로젝트 봇(다른 곳에서 쓰는 봇은 거부) · 내 채팅만 허용
 *                                  → kedovi start 가 --channels 와 TELEGRAM_STATE_DIR(프로젝트 상태 폴더)을 붙인다. 이 워크스페이스 알림도 그 봇으로
 * 팀 채널
 *   setup --team [--new]           팀 봇 토큰 저장 (관리자에게 받는다) + 봇이 들어간 그룹방 ID 보여 주기
 *   team-chat <id|off>             팀 그룹방 지정 (workspace.json vars.notify.teamChat, 팀 설정)
 *   announce "<내용>"              팀 방에 공지
 * 공통
 *   status                         지금 설정
 *   test [--team]                  테스트 메시지
 *   pre-push <remote>              .githooks/pre-push 가 부른다. push 가 끝나면 핸드오프·설정 변경을 팀 방에 알린다 (push 를 막지 않는다)
 * 비밀값: ~/.config/kedovi/telegram.env (권한 600). 토큰은 어떤 출력에도 찍지 않는다.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { root: findRoot, load, devId, git, stateDir } = require('../lib/workspace');
const notify = require('../lib/notify');

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const has = (k) => argv.includes(`--${k}`);
const positional = () => argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--') && ['chat', 'min', 'file', 'fold'].includes(all[i - 1].slice(2))));

const ROOT = findRoot();
const ws = (() => { try { return load(ROOT); } catch { return {}; } })();
const PROJECT = notify.projectName(ROOT, ws);
const localFile = path.join(ROOT, '.agents', 'local.json');

function writeLocal(fn) {
  const cur = notify.readLocal(ROOT);
  fn(cur);
  if (cur.notify && !Object.keys(cur.notify).length) delete cur.notify;
  fs.mkdirSync(path.dirname(localFile), { recursive: true });
  fs.writeFileSync(localFile, JSON.stringify(cur, null, 2) + '\n');
}

const ARGV_TOKEN_WARN = '  ⚠ 토큰을 인자로 주면 셸 기록 · 프로세스 목록에 남습니다. 다음부터는 인자 없이 실행해 숨김 입력에 넣으세요';
/** 봇 토큰: 인자(옛 방식, 경고) → 숨김 입력 · 표준 입력(없거나 --new 일 때) → 이미 있는 것 */
async function readToken(given, stored, prompt) {
  if (given) { console.log(ARGV_TOKEN_WARN); return given; }
  if (stored && !has('new')) return stored;
  const typed = String(await require('../lib/secrets').readHidden(`${prompt} (입력은 보이지 않습니다${stored ? '. 비우면 그대로' : ''}): `) || '').trim();
  return typed || stored || '';
}

async function setup() {
  const isTeam = has('team');
  const key = isTeam ? 'TELEGRAM_TEAM_BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN';
  const token = await readToken(positional()[0], notify.readSecrets()[key], isTeam ? '팀 봇 토큰 (관리자에게 받은 것)' : '개인 봇 토큰 (@BotFather /newbot)');
  if (!token) throw new Error(`토큰이 없습니다. 터미널에서 kedovi notify ${isTeam ? 'team' : 'my'} setup 을 실행해 숨김 입력에 넣으세요`);
  const chats = await notify.recentChats(token);
  const file = notify.writeSecrets({ [key]: token });
  console.log(`✓ 토큰 저장: ${file}`);
  if (isTeam) {
    const groups = chats.filter((c) => c.type !== 'private');
    const cur = notify.team(ROOT, ws).chat;
    if (cur) console.log(`  팀 방: ${cur} (workspace.json)`);
    else if (groups.length) console.log(`  봇이 본 그룹방:\n${groups.map((c) => `    ${c.id}  ${c.name}`).join('\n')}\n  팀 방 지정: kedovi notify team chat <id>`);
    else console.log('  그룹방이 아직 보이지 않습니다. 봇을 팀 방에 초대하고 방에서 아무 말이나 한 뒤 다시 실행하세요.');
    return;
  }
  const mine = chats.filter((c) => c.type === 'private');
  if (!mine.length) { console.log('  봇과의 대화가 아직 없습니다. 텔레그램에서 봇에게 아무 말이나 보낸 뒤 다시 실행하세요.'); return; }
  const chat = mine[mine.length - 1];
  notify.writeSecrets({ TELEGRAM_CHAT_ID: chat.id });
  console.log(`✓ 내 채팅: ${chat.id} (${chat.name})`);
  // test 가 오면 "연동 끝" 으로 알기 쉽다. 자동 알림(작업 끝 · 입력 대기)도 켜 둔다
  if (!notify.personal(ROOT, ws).events.length) {
    const ln = notify.readLocal(ROOT).notify || {};
    const offByMe = ln.events === 'off' || ln.level === 'off'; // 전에 직접 끈 것은 그대로 둔다
    if (has('no-on') || offByMe) console.log('  ⚠ 자동 알림은 꺼져 있습니다 (test 만 옵니다). 켜기: kedovi notify my on');
    else { writeLocal((l) => { l.notify = { ...(l.notify || {}), level: 'decisions' }; delete l.notify.events; }); console.log('✓ 알림 수준: 결과와 결정 (오래 걸린 요청의 결과 · 질문 · 권한 확인). 바꾸기: kedovi notify setup'); }
  }
  status();
  console.log('  시험: kedovi notify my test');
}

/** 옛 명령: on = 결과와 결정 수준 (--min 은 그대로) */
function on() {
  const events = positional()[0] ? notify.parseEvents(positional()[0]) : notify.EVENTS;
  if (!events.length) throw new Error(`이벤트는 ${notify.EVENTS.join(', ')} 중에서 고릅니다`);
  writeLocal((l) => {
    l.notify = l.notify || {};
    l.notify.level = 'decisions';
    delete l.notify.events;
    if (opt('chat')) l.notify.chat = opt('chat');
    if (opt('min') != null) l.notify.minSeconds = Number(opt('min'));
  });
  status();
}

function status() {
  const p = notify.personal(ROOT, ws);
  const t = notify.team(ROOT, ws);
  const local = notify.readLocal(ROOT).notify || {};
  const prog = Number(local.channelProgress != null ? local.channelProgress : 5);
  console.log(`알림 수준  ${notify.LEVEL_LABEL[p.level]}${p.source === 'team' ? ' (팀 기본)' : ''}${p.away ? ' · 자리 비움' : ''}`);
  console.log(`           결과는 ${p.away ? '모든 요청' : `${p.minSeconds}초 넘게 걸린 요청`} · 진행 현황 ${prog ? `${prog}분마다` : '끔'} (전체 · 진행 현황 수준일 때)`);
  console.log(`           자리에 있으면 선택 대기 · 모든 작업 끝 한 줄만, 설명 · 보기 · 답 앞부분은 자리 비움일 때 (전체 수준은 늘 전문)`);
  console.log(`           리모트 컨트롤(Claude 앱) 연결 중: ${{ send: '텔레그램도 모두 보냄', quiet: '텔레그램 쉼', done: '텔레그램은 작업 끝만 (결정은 앱이 알린다)' }[p.remote]} (kedovi notify my remote done|quiet|send)`);
  console.log(`           PC 앞이면 끝남 알림 생략: ${p.deskSeconds ? `${p.deskSeconds}초 안에 키보드 · 마우스를 만졌을 때${notify.idleSeconds() == null ? ' (이 PC 는 잴 수 없어 늘 보냄)' : ''}` : '끔'} (kedovi notify my desk <초>|off)`);
  const v = notify.voiceOf(ROOT);
  console.log(`음성       ${v.on ? `켜짐 · ${notify.VOICE_SCOPE_LABEL[v.scope]} · 목소리 ${v.name}` : '꺼짐'} (kedovi notify my voice on|off)`);
  console.log(`개인 봇    ${p.token ? '있음 (이 PC 의 모든 워크스페이스 공통. 알림 첫머리의 [프로젝트 이름]으로 구분)' : '없음 → kedovi notify setup'} · 채팅 ${p.chat || '없음'}`);
  // 개인 봇이 다른 프로젝트의 양방향 채널 봇과 같으면, 이 워크스페이스 알림이 그 프로젝트 대화방으로 섞여 들어간다
  const secretToken = notify.readSecrets().TELEGRAM_BOT_TOKEN;
  const clash = secretToken && !notify.channelOn(ROOT) && notify.channelTokenUsedElsewhere(ROOT, secretToken);
  if (clash && !clash.shared) console.log(`           ⚠ 개인 봇이 다른 프로젝트의 채널 봇(${path.basename(clash.dir).replace(/^telegram-/, '')})과 같습니다. 이 워크스페이스 알림도 그 대화방으로 갑니다. 개인용 봇을 따로 만들어 kedovi notify my setup --new (토큰은 숨김 입력)`);
  console.log(`양방향     ${notify.channelOn(ROOT) ? '켜짐' : '꺼짐'}`);
  console.log(`팀 방      ${t.chat ? `${t.events.join(', ') || '꺼짐'} → ${t.chat}` : '없음'}${t.chat && !t.token ? ' · 팀 봇 없음' : ''}`);
}

async function test() {
  const cfg = has('team') ? notify.team(ROOT, ws) : notify.personal(ROOT, ws);
  if (!cfg.token || !cfg.chat) throw new Error(`봇 토큰·채팅이 없습니다. status 로 확인하세요 (${notify.secretFile()})`);
  const r = await notify.send(`🔔 [${PROJECT}] ${has('team') ? '팀' : '개인'} 알림 테스트`, cfg);
  if (!r.ok) throw new Error(r.description);
  console.log('✓ 보냄');
}

function teamChat() {
  const id = positional()[0];
  if (!id) throw new Error('사용: kedovi notify team chat <그룹방 ID|off>');
  const f = path.join(ROOT, 'workspace.json');
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  raw.vars = raw.vars || {};
  raw.vars.notify = raw.vars.notify || {};
  raw.vars.notify.teamChat = id === 'off' ? '' : id;
  fs.writeFileSync(f, JSON.stringify(raw, null, 2) + '\n');
  console.log(`✓ workspace.json vars.notify.teamChat = "${raw.vars.notify.teamChat}" (팀 설정: commit · push 하면 팀 전체에 적용)`);
}

async function announce() {
  const text = positional().join(' ');
  if (!text) throw new Error('사용: announce "<내용>"');
  const cfg = notify.team(ROOT, ws);
  const msg = notify.announceMessage(cfg, { project: PROJECT, author: devId(ROOT), text });
  if (!msg) throw new Error('팀 공지가 꺼져 있거나 팀 방·팀 봇이 없습니다 (status)');
  const r = await notify.send(msg, cfg);
  if (!r.ok) throw new Error(r.description);
  console.log('✓ 팀 방에 공지했습니다');
}

/** pre-push: 보낼 문장을 만들어 두고, push 가 실제로 끝난 뒤 보내는 자식 프로세스를 띄운다 */
function prePush() {
  const cfg = notify.team(ROOT, ws);
  if (!cfg.events.length || !cfg.token) return;
  const remote = positional()[0] || 'origin';
  let stdin = '';
  try { stdin = fs.readFileSync(0, 'utf8'); } catch { /* 없음 */ }
  const changes = notify.collectPush((args) => git(ROOT, args), stdin, remote);
  const messages = notify.teamMessages(cfg, { project: PROJECT, external: require('../lib/plan').externalOf(ws), ...changes });
  if (!messages.length) return;
  const job = path.join(os.tmpdir(), `kedovi-notify-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(job, JSON.stringify({ remote, refs: changes.refs, messages }), { mode: 0o600 });
  spawn(process.execPath, [__filename, 'deliver', job], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/** push 가 원격 추적 브랜치에 반영될 때까지(최대 90초) 기다렸다가 보낸다. push 가 실패하면 보내지 않는다 */
async function deliver() {
  const job = argv[1];
  const { remote, refs, messages } = JSON.parse(fs.readFileSync(job, 'utf8'));
  fs.unlinkSync(job);
  const tracking = refs.filter((r) => /^refs\/heads\//.test(r.remoteRef)).map((r) => ({ ref: `refs/remotes/${remote}/${r.remoteRef.slice(11)}`, sha: r.sha }));
  const done = () => tracking.every((t) => git(ROOT, ['rev-parse', '--verify', '-q', t.ref]) === t.sha);
  const until = Date.now() + 90000;
  if (tracking.length && git(ROOT, ['remote']) && git(ROOT, ['remote']).split('\n').includes(remote)) {
    while (!done()) {
      if (Date.now() > until) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
  } else await new Promise((r) => setTimeout(r, 5000));
  const cfg = notify.team(ROOT, ws);
  for (const m of messages) await notify.send(m, cfg);
}

/** 봇 제거 — 토큰 파일에서 지운다. 개인은 이 워크스페이스에 적어 둔 채팅 ID 도 */
function remove() {
  const isTeam = has('team');
  notify.writeSecrets(isTeam ? { TELEGRAM_TEAM_BOT_TOKEN: '' } : { TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' });
  if (!isTeam) writeLocal((l) => { if (l.notify) delete l.notify.chat; });
  console.log(`✓ ${isTeam ? '팀 봇 토큰' : '개인 봇 토큰 · 채팅 ID'} 제거 (${notify.secretFile()}). 이 PC 의 다른 워크스페이스에도 적용된다`);
  status();
}

// ───────── 자리 비움 결정 질문 · 서식 보고 · 음성 ─────────

/** --file <경로> 또는 stdin */
function readInputText() {
  const f = opt('file');
  if (f) return fs.readFileSync(path.resolve(f), 'utf8');
  if (process.stdin.isTTY) return '';
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}
const lastAskFile = () => path.join(stateDir(ROOT), 'last-ask.json');
function personalOrFail() {
  const cfg = notify.personal(ROOT, ws);
  if (!cfg.token || !cfg.chat) throw new Error('개인 텔레그램 봇이 없습니다. kedovi notify setup');
  return cfg;
}

/** 결정 질문: JSON { title?, decisions: [{ title, context?, options: [{ label, detail? }], recommended? }] } → 머리 · 결정마다 메시지 · 답 버튼 (+ 음성) */
async function askCmd() {
  let spec;
  try { spec = JSON.parse(readInputText()); } catch { throw new Error('사용: node packs/core/bin/notify.js ask --file <결정.json> (또는 stdin). 형식: { "decisions": [{ "title", "context", "options": [{ "label", "detail" }], "recommended": 0 }] }'); }
  const bad = !(spec.decisions || []).length || spec.decisions.some((d) => !d.title || !(d.options || []).length);
  if (bad) throw new Error('decisions 마다 title 과 options(1개 이상)가 필요합니다');
  const cfg = personalOrFail();
  const r = notify.decisionMessages(spec);
  fs.mkdirSync(stateDir(ROOT), { recursive: true });
  fs.writeFileSync(lastAskFile(), JSON.stringify(spec));
  const ok = (x) => x && x.ok !== false;
  let sent = ok(await notify.send(r.head, cfg, 10000, { html: true }));
  for (let i = 0; i < r.messages.length; i++) {
    const last = i === r.messages.length - 1;
    sent = ok(await notify.send(r.messages[i], cfg, 10000, { html: true, ...(last ? { markup: r.keyboard } : {}) })) && sent;
  }
  // 보낸 표시 (자리 비움 Stop 검사가 이번 요청에 ask 를 보냈는지 본다). 전송에 실패하면 남기지 않는다
  if (sent) fs.writeFileSync(path.join(stateDir(ROOT), 'last-ask.sent'), String(Date.now()));
  const voice = await notify.sendSpeech(ROOT, cfg, 'decisions', notify.decisionsSpeech(spec));
  console.log(`${sent ? '✔' : '⚠'} 결정 ${spec.decisions.length}건을 텔레그램으로 보냈습니다 (결정마다 메시지 · 답 버튼${voice && voice.ok ? ' · 음성' : ''})${sent ? '' : ' (일부 전송 실패)'}`);
  if (voice && voice.ok === false && voice.error) console.log(`  ⚠ 음성: ${voice.error}`);
  console.log('  답: 버튼 글자 "1-1 ✅ 보기 이름"(앞의 1-1 이 답) · "1-1" · "2: 내용" · "모두 권장안" · "<번호> ✏️ 직접 입력"(이면 prompt <번호>). 다 받으면 answered "<받은 답 요약>" (잊으면 끝남 알림이 버튼을 걷는다)');
}

/** ✏️ 직접 입력 — 그 결정에 답장하는 입력창을 연다 */
async function promptCmd() {
  const no = Number(positional()[0]);
  let spec = {};
  try { spec = JSON.parse(fs.readFileSync(lastAskFile(), 'utf8')); } catch { /* 없으면 번호만 */ }
  if (!Number.isInteger(no) || no < 1) throw new Error('사용: node packs/core/bin/notify.js prompt <결정 번호>');
  const m = notify.promptMessage(spec, no);
  await notify.send(m.text, personalOrFail(), 10000, { html: true, markup: m.markup });
  console.log(`✔ ${no}번 직접 입력 창을 열었습니다. 다음에 온 텔레그램 메시지가 ${no}번 답이다`);
}

/** 답을 다 받음 — 키보드를 걷는다 */
async function answeredCmd() {
  const m = notify.answeredMessage(positional().join(' '));
  await notify.send(m.text, personalOrFail(), 10000, { html: true, markup: m.markup });
  fs.rmSync(lastAskFile(), { force: true });
  console.log('✔ 답 버튼을 걷었습니다');
}

/** 서식 보고: 마크다운(stdin · --file) → 텔레그램 HTML (제목 굵게 · 목록 · 인용 · 긴 뒷부분은 접기). --done 이면 끝남 보고 음성도 */
async function sayCmd() {
  const md = readInputText();
  if (!md.trim()) throw new Error('사용: node packs/core/bin/notify.js say [--done] [--fold <줄>] < 보고.md');
  const cfg = personalOrFail();
  const html = notify.foldHtml(notify.toTelegramHtml(md), Number(opt('fold')) || 12);
  const r = await notify.send(html, cfg, 10000, { html: true });
  const voice = await notify.sendSpeech(ROOT, cfg, has('done') ? 'done' : 'other', has('done') ? notify.doneSpeech(md) : notify.speakable(md, 300));
  console.log(`${r && r.ok !== false ? '✔' : '⚠'} 텔레그램으로 보냈습니다${voice && voice.ok ? ' (음성 포함)' : ''}`);
  if (voice && voice.ok === false && voice.error) console.log(`  ⚠ 음성: ${voice.error}`);
}

/** 음성 설정 (이 PC): on|off · scope both|decisions|done|all · name <목소리> · test · (없으면 보기) */
async function voiceCmd() {
  const [v, arg] = positional();
  const cur = () => notify.voiceOf(ROOT);
  const show = () => { const x = cur(); console.log(`음성  ${x.on ? '켜짐' : '꺼짐'} · ${notify.VOICE_SCOPE_LABEL[x.scope]} · 목소리 ${x.name}`); };
  const set = (patch) => writeLocal((l) => { l.notify = { ...(l.notify || {}), voice: { ...((l.notify || {}).voice || {}), ...patch } }; });
  if (!v || v === 'status') return show();
  if (v === 'on' || v === 'off') set({ on: v === 'on' });
  else if (v === 'scope') {
    if (!notify.VOICE_SCOPES.includes(arg)) throw new Error(`사용: kedovi notify my voice scope ${notify.VOICE_SCOPES.join('|')} (결정+끝남 · 결정만 · 끝남만 · 모두)`);
    set({ scope: arg });
  } else if (v === 'name') {
    if (!arg) throw new Error('사용: kedovi notify my voice name <목소리> (macOS: say -v \'?\' | grep ko_KR 로 목록)');
    const t = notify.tts('목소리를 바꿨습니다.', { name: arg });
    if (!t.file) throw new Error(t.error);
    fs.rmSync(t.file, { force: true });
    set({ name: arg });
  } else if (v === 'test') {
    const r = await notify.sendSpeech(ROOT, personalOrFail(), 'other', `${PROJECT} 음성 알림 시험입니다. 이렇게 들립니다.`).catch((e) => ({ ok: false, error: e.message }));
    if (!cur().on) return console.log('음성이 꺼져 있습니다. kedovi notify my voice on');
    console.log(r && r.ok ? '✔ 시험 음성을 보냈습니다' : `⚠ 시험 음성 실패: ${(r && (r.error || r.description)) || '알 수 없음'}`);
    return;
  } else throw new Error('사용: kedovi notify my voice on|off · scope both|decisions|done|all · name <목소리> · test');
  console.log('✓ 바로 적용');
  show();
}

const commands = {
  setup, on, status, test, announce, deliver, remove,
  ask: askCmd, prompt: promptCmd, answered: answeredCmd, say: sayCmd, voice: voiceCmd,
  off: () => { writeLocal((l) => { l.notify = { ...(l.notify || {}), level: 'off' }; delete l.notify.events; }); status(); },
  reset: () => { writeLocal((l) => { if (l.notify) for (const k of ['level', 'events', 'minSeconds', 'deskSeconds', 'away', 'remote', 'channelAsk', 'channelProgress', 'voice']) delete l.notify[k]; }); status(); },
  level: () => {
    const v = positional()[0];
    if (!notify.LEVELS.includes(v)) throw new Error(`사용: kedovi notify my level ${notify.LEVELS.join('|')} (전체 · 결과와 결정 · 진행 현황 · 끄기)`);
    writeLocal((l) => { l.notify = { ...(l.notify || {}), level: v }; delete l.notify.events; });
    console.log(`✓ 알림 수준: ${notify.LEVEL_LABEL[v]} (바로 적용)`);
  },
  min: () => {
    const v = Number(positional()[0]);
    if (!Number.isFinite(v) || v < 0) throw new Error('사용: kedovi notify my min <초> (이보다 짧게 끝난 요청은 결과를 보내지 않는다. 0 = 모두)');
    writeLocal((l) => { l.notify = { ...(l.notify || {}), minSeconds: v }; });
    console.log(`✓ 결과 알림 기준: ${v ? `${v}초 넘게 걸린 요청` : '모든 요청'}`);
  },
  desk: () => {
    const a = positional()[0];
    const v = a === 'off' ? 0 : Number(a);
    if (!Number.isFinite(v) || v < 0) throw new Error('사용: kedovi notify my desk <초>|off (이 안에 키보드 · 마우스를 만졌으면 PC 앞으로 보고 끝남 · 위임 끝 · 음성을 보내지 않는다. 기본 120초 · macOS)');
    writeLocal((l) => { l.notify = { ...(l.notify || {}), deskSeconds: v }; });
    console.log(`✓ 자리 판단: ${v ? `${v}초 안에 만졌으면 PC 앞 (끝남 알림 생략)` : '끔 (늘 보냄)'}`);
  },
  remote: () => {
    const v = positional()[0];
    if (!['done', 'quiet', 'send'].includes(v)) throw new Error('사용: kedovi notify my remote done|quiet|send (리모트 컨트롤로 Claude 앱에 이어진 세션: done = 작업 끝만 텔레그램, 기본 · quiet = 텔레그램 쉼 · send = 그대로 보냄)');
    writeLocal((l) => { l.notify = { ...(l.notify || {}) }; if (v === 'done') delete l.notify.remote; else l.notify.remote = v; });
    console.log({ done: '✓ 리모트 컨트롤 연결 중에는 작업 끝만 텔레그램으로 (결정 · 입력 대기는 앱이 알리고 질문 창으로 답한다)', quiet: '✓ 리모트 컨트롤 연결 중에는 텔레그램을 보내지 않는다 (결정은 질문 창으로, 앱에서 답한다)', send: '✓ 리모트 컨트롤 연결 중에도 텔레그램을 모두 보낸다' }[v]);
  },
  away: () => {
    const v = positional()[0];
    if (!['on', 'off'].includes(v)) throw new Error('사용: kedovi notify my away on|off (자리 비움: 결정을 텔레그램 버튼 질문으로 · 결과는 시간과 상관없이)');
    // 자리 비움인데 알림이 꺼져 있으면 끝남 보고가 오지 않는다: 「결과와 결정」 으로 켠다
    const envOff = process.env.KEDOVI_NOTIFY === '0'; // 환경 변수로 끈 것은 파일로 못 켠다
    const wasOff = v === 'on' && !envOff && notify.personal(ROOT, ws).level === 'off';
    writeLocal((l) => { l.notify = { ...(l.notify || {}) }; delete l.notify.channelAsk; if (v === 'on') l.notify.away = true; else delete l.notify.away; if (wasOff) { l.notify.level = 'decisions'; delete l.notify.events; } });
    console.log(v === 'on' ? '✓ 자리 비움: 결정은 텔레그램 버튼 질문으로, 버튼 · 번호 · 글로 답한다 (바로 적용, 진행 중인 세션은 다음 요청부터)' : '✓ 돌아옴: 질문은 터미널 선택지 창으로');
    if (v === 'on' && envOff) console.log('  ⚠ KEDOVI_NOTIFY=0 이라 알림이 꺼져 있습니다. 자리 비움을 쓰려면 이 변수를 지운다');
    if (wasOff) console.log(`  알림이 꺼져 있어 수준을 「${notify.LEVEL_LABEL.decisions}」 으로 켰습니다 (끝남 보고가 텔레그램으로 오게). 바꾸기: kedovi notify my level <all|decisions|progress|off>`);
  },
  'team-chat': teamChat,
  channel,
  'pre-push': prePush,
};

/** 양방향 채널 — 개인 봇으로만 (팀 봇 · 팀 방은 쓰지 않는다). 이 PC 의 .agents/local.json notify.channel */
async function channel() {
  const sub = positional()[0] || 'status';
  const { findCli } = require('../lib/cli');
  if (sub === 'off') {
    writeLocal((l) => { if (l.notify) delete l.notify.channel; });
    console.log('✓ 양방향 채널 끔. 다음 kedovi start 부터 --channels 를 붙이지 않습니다 (플러그인 · 토큰은 그대로)');
    return;
  }
  if (sub === 'status') return channelStatus(findCli);
  if (sub === 'remove') {
    writeLocal((l) => { if (l.notify) { delete l.notify.channel; delete l.notify.channelAsk; delete l.notify.channelProgress; } });
    const dir = notify.channelDir(ROOT);
    if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); console.log(`✓ 상태 폴더 삭제: ${dir}`); }
    if (notify.channelPluginScope(ROOT) === 'local' && findCli('claude')) {
      const r = require('child_process').spawnSync(findCli('claude'), ['plugin', 'uninstall', notify.CHANNEL_PLUGIN, '-s', 'local'], { cwd: ROOT, encoding: 'utf8' });
      console.log(r.status === 0 ? '✓ 이 워크스페이스의 telegram 플러그인 설치(local) 삭제' : `  플러그인 삭제 실패: claude plugin uninstall ${notify.CHANNEL_PLUGIN} -s local`);
    }
    console.log('✓ 양방향 채널 제거. 다시 쓰려면 kedovi notify my channel on (봇 토큰은 숨김 입력)');
    return;
  }
  if (sub === 'progress') {
    const v = positional()[1];
    const mins = v === 'off' ? 0 : Number(v);
    if (v == null || !Number.isFinite(mins) || mins < 0) throw new Error('사용: kedovi notify my channel progress <분|off> (기본 5분: 사용자 입력 없이 그만큼 작업하면 그 간격으로 진행 현황을 보낸다)');
    writeLocal((l) => { l.notify = { ...(l.notify || {}), channelProgress: mins }; });
    console.log(mins ? `✓ 진행 현황: 입력 없이 ${mins}분 넘게 작업하면 ${mins}분마다 텔레그램으로 (바로 적용)` : '✓ 진행 현황 알림 끔');
    return;
  }
  if (sub === 'ask') {
    const mode = positional()[1];
    if (!['dialog', 'text'].includes(mode)) throw new Error('사용: kedovi notify my channel ask dialog|text (dialog = 터미널 선택지 창, 기본 · text = 텔레그램 버튼 질문)');
    writeLocal((l) => { l.notify = { ...(l.notify || {}) }; delete l.notify.channelAsk; if (mode === 'text') l.notify.away = true; else delete l.notify.away; }); // 자리 비움과 같다
    console.log(mode === 'text' ? '✓ 질문 방식: 텔레그램 버튼 질문 (버튼 · 번호 · ✏️ 직접 입력으로 답한다. 자리를 비울 때). 되돌리기: kedovi notify my channel ask dialog' : '✓ 질문 방식: 터미널 선택지 창 (방향키 · 직접 입력). 텔레그램에는 질문과 선택지가 알림으로 간다');
    console.log('  바로 적용된다 (진행 중인 세션은 다음 요청부터). 세션 안에서는 "자리 비울게" · "돌아왔어" 라고 말해도 바꾼다');
    return;
  }
  if (sub !== 'on') throw new Error('사용: kedovi notify my channel on [--new]|off|status|ask dialog|text');

  // 무엇을 확인했고 무엇을 바꿨는지 한 줄씩 보여 준다 (이미 돼 있는 것도 "그대로" 로)
  const pad = (t) => t + ' '.repeat(Math.max(1, 14 - [...t].reduce((w, c) => w + (/[\u1100-\uffdc]/.test(c) ? 2 : 1), 0))); // 한글은 두 칸
  const ok = (label, detail) => console.log(`  ✓ ${pad(label)}${detail}`);
  const stop = (label, detail, how) => { console.log(`  ✖ ${pad(label)}${detail}`); throw new Error(how); };
  console.log('양방향 채널 준비 (이 프로젝트 · 이 PC)');
  // 1. 실행 조건: claude.ai 로그인 또는 Console API 키로 직접 연결 (게이트웨이 · Bedrock 등은 채널이 안 된다)
  let gateway = false;
  try { const kit = require(path.join(ROOT, 'bin', 'kit.js')); gateway = kit.resolveModels(ROOT, kit.loadWorkspace(ROOT)).access.connection === 'gateway'; } catch { /* 옛 워크스페이스 */ }
  if (gateway) stop('연결 방식', 'AI 게이트웨이', '채널은 claude.ai 로그인 · Console API 키로 직접 연결할 때만 됩니다 (kedovi ai show)');
  ok('연결 방식', 'AI 서비스 직접');
  const claudeAt = findCli('claude');
  if (!claudeAt) stop('Claude Code', '없음', 'npm i -g @anthropic-ai/claude-code');
  ok('Claude Code', claudeAt);
  const bunAt = findCli('bun');
  if (!bunAt) {
    const how = process.platform === 'win32' ? 'powershell -c "irm bun.sh/install.ps1 | iex"' : 'curl -fsSL https://bun.sh/install | bash';
    stop('Bun', '없음 (플러그인 서버가 Bun 으로 돈다)', `Bun 설치: ${how} → 터미널을 다시 열고 다시 실행`);
  }
  ok('Bun', bunAt);
  // 2. 이 프로젝트 전용 봇. 봇 하나는 한 곳에서만 메시지를 받으므로 프로젝트마다 다른 봇을 쓴다
  const dir = notify.channelDir(ROOT);
  const given = positional()[1];
  if (!given && !notify.channelToken(ROOT) && process.stdin.isTTY) console.log('  이 프로젝트 전용 봇이 필요합니다. 텔레그램 @BotFather 에서 /newbot 으로 봇을 만들고 그 봇에게 아무 말이나 보낸 뒤 토큰을 붙여 넣으세요.');
  const token = await readToken(given, notify.channelToken(ROOT), '  봇 토큰');
  if (!token) stop('프로젝트 봇', '없음', '이 프로젝트 전용 봇을 만드세요: ① 텔레그램 @BotFather 에서 /newbot → 토큰 받기 ② 만든 봇에게 아무 말이나 보내기 ③ 터미널에서 kedovi notify my channel on (토큰은 숨김 입력)');
  const name = await notify.botName(token);
  if (!name) stop('프로젝트 봇', '토큰을 확인하지 못함', '토큰이 맞는지, 인터넷이 되는지 확인하고 다시 실행');
  const other = notify.channelTokenUsedElsewhere(ROOT, token);
  if (other && !other.shared) stop('프로젝트 봇', `${name} 은 다른 프로젝트(${other.dir})에서 쓰는 봇`, '같은 봇을 두 프로젝트가 받으면 서로 끊긴다. 이 프로젝트용 봇을 새로 만들어 kedovi notify my channel on --new (토큰은 숨김 입력)');
  const globalToken = notify.readSecrets().TELEGRAM_BOT_TOKEN;
  ok('프로젝트 봇', `${name}${token === notify.channelToken(ROOT) && !given ? ' (그대로)' : ''}`);
  if (token === globalToken) console.log('    ⚠ 개인 알림 봇과 같은 봇입니다. 채널을 켜지 않은 다른 워크스페이스의 알림이 이 대화에 섞입니다 (다른 프로젝트에도 쓰면 그쪽은 다른 봇으로)');
  if (other && other.shared) {
    // 플러그인 기본 폴더에 같은 봇 토큰이 있으면 이 PC 의 다른 Claude Code 세션마다 같은 봇을 받으려 해 서로 끊긴다 (409). 끄고 남겨 둔다
    const envFile = path.join(other.dir, '.env');
    fs.renameSync(envFile, `${envFile}.off-by-kedovi`);
    console.log(`    ✓ 플러그인 기본 폴더(${other.dir})의 같은 봇 토큰을 껐습니다 (.env → .env.off-by-kedovi). 다른 Claude Code 세션이 이 봇을 받아 채널이 끊기던 원인`);
  }
  // 3. 내 텔레그램 사용자 ID (= 1:1 채팅 ID). 개인 알림 설정에 있으면 그것, 없으면 이 봇에게 온 메시지에서
  let chat = notify.personal(ROOT, ws).chat;
  let talked = null;
  try { talked = (await notify.recentChats(token)).filter((c) => c.type === 'private'); } catch { /* 채널 세션이 이 봇을 받는 중이면 못 읽는다 */ }
  if (!chat && talked && talked.length) chat = talked[talked.length - 1].id;
  if (!chat) stop('내 채팅', '모름', `텔레그램에서 ${name} 에게 아무 말이나 보낸 뒤 다시 실행`);
  ok('내 채팅', `${chat}${talked && talked.length && !talked.some((c) => String(c.id) === String(chat)) ? ` (⚠ ${name} 에게 아직 말을 건 적이 없다: 봇은 먼저 말을 걸 수 없어 알림이 안 온다. 한 번 보내 두세요)` : ''}`);
  // 4. 플러그인: 이 워크스페이스 전용(local) 으로. user 범위는 이 PC 의 모든 세션이 서버를 띄워 같은 봇을 다투고,
  //    워크스페이스 안 다른 폴더에 project 로 깔린 것은 그 폴더에서 띄운 세션이 따로 받는다. 둘 다 지운다
  const { spawnSync } = require('child_process');
  const plugin = (args, cwd) => spawnSync(claudeAt, ['plugin', ...args], { cwd, encoding: 'utf8' });
  const here = path.resolve(ROOT);
  if (notify.channelPluginScope(ROOT) === 'local' || notify.channelPluginScope(ROOT) === 'project') ok('플러그인', `${notify.CHANNEL_PLUGIN} 이 워크스페이스 전용 (${notify.channelPluginScope(ROOT)} 범위)`);
  else {
    const r = plugin(['install', notify.CHANNEL_PLUGIN, '-s', 'local'], ROOT);
    if (r.status !== 0) stop('플러그인', '설치 실패', `${(r.stderr || r.stdout || '').trim().split('\n').pop()} · 마켓플레이스가 없으면: claude plugin marketplace add anthropics/claude-plugins-official → 다시 실행`);
    ok('플러그인', `${notify.CHANNEL_PLUGIN} 설치함 (local 범위: 이 PC · 이 워크스페이스만, .claude/settings.local.json)`);
  }
  for (const e of notify.channelInstalls()) {
    const stray = e.scope && e.scope !== 'user' && e.projectPath && path.resolve(e.projectPath) !== here && path.resolve(e.projectPath).startsWith(here + path.sep);
    if (e.scope === 'user' || !e.scope) {
      const r = plugin(['uninstall', notify.CHANNEL_PLUGIN, '-s', 'user'], ROOT);
      ok('플러그인 정리', r.status === 0 ? 'user 범위 설치 제거 (이 PC 모든 세션이 같은 봇을 받으려 해 끊기던 원인. 다른 워크스페이스는 거기서 channel on 을 다시)' : `user 범위 제거 실패: claude plugin uninstall ${notify.CHANNEL_PLUGIN} -s user`);
    } else if (stray && fs.existsSync(e.projectPath)) {
      const r = plugin(['uninstall', notify.CHANNEL_PLUGIN, '-s', e.scope], e.projectPath);
      ok('플러그인 정리', r.status === 0 ? `${path.relative(here, e.projectPath)} 의 ${e.scope} 범위 설치 제거 (워크스페이스 안 다른 폴더)` : `제거 실패: cd ${e.projectPath} && claude plugin uninstall ${notify.CHANNEL_PLUGIN} -s ${e.scope}`);
    }
  }
  // 5. 이 프로젝트 상태 폴더: 토큰 · 내 채팅만 허용 (1:1 대화는 채팅 ID = 사용자 ID 라 페어링 없이). 모르는 사람의 메시지는 조용히 버린다
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, '.env'), `TELEGRAM_BOT_TOKEN=${token}\n`, { mode: 0o600 });
  const access = notify.channelAccess(ROOT) || { dmPolicy: 'pairing', allowFrom: [], groups: {}, pending: {} };
  access.allowFrom = [...new Set([...(access.allowFrom || []), String(chat)])];
  access.dmPolicy = 'allowlist';
  fs.writeFileSync(path.join(dir, 'access.json'), JSON.stringify(access, null, 2) + '\n', { mode: 0o600 });
  ok('상태 폴더', `${dir} (토큰 · 허용: 내 채팅${access.allowFrom.length > 1 ? ` 외 ${access.allowFrom.length - 1}명` : '만'})`);
  // 6. 켠다 (이 PC · 이 워크스페이스)
  writeLocal((l) => { l.notify = { ...(l.notify || {}), channel: true, ...(notify.readSecrets().TELEGRAM_CHAT_ID ? {} : { chat: String(chat) }) }; });
  console.log(`\n✓ 양방향 채널 켬 (이 프로젝트 · ${name}). 다음 kedovi start (Claude Code) 부터 --channels 를 붙입니다. 이번만 빼려면 kedovi start --no-channel`);
  console.log(`  이 워크스페이스의 개인 알림(작업 끝 · 입력 대기)도 ${name} 로 옵니다. 다른 프로젝트와 섞이지 않습니다.`);
  console.log('  알아 둘 것: 이 프로젝트 세션을 두 개 띄우면 나중 세션만 메시지를 받는다.');
  console.log('  Team · Enterprise 조직 계정은 관리자가 채널을 켜야 한다 (시작 화면에 경고가 나오면 그 때문).');
}

async function channelStatus(findCli) {
  const on = notify.channelOn(ROOT);
  const chk = notify.channelCheck(ROOT, findCli);
  const access = notify.channelAccess(ROOT);
  const token = notify.channelToken(ROOT);
  console.log(`채널  ${on ? '켜짐 (kedovi start 가 --channels 를 붙임)' : '꺼짐 (켜기: kedovi notify my channel on)'}`);
  console.log(`      프로젝트 봇 ${token ? (await notify.botName(token)) || '(이름 확인 실패)' : '없음'} · Bun ${findCli('bun') ? '있음' : '없음'} · 플러그인 ${notify.channelPluginScope(ROOT) || '없음'} · 허용 ${access ? `${access.dmPolicy} ${(access.allowFrom || []).length}명` : '없음'}`);
  const prog = Number((notify.readLocal(ROOT).notify || {}).channelProgress != null ? notify.readLocal(ROOT).notify.channelProgress : 5);
  console.log(`      상태 폴더 ${notify.channelDir(ROOT)} · 질문 방식 ${notify.channelAskMode(ROOT) === 'text' ? '텔레그램 버튼 질문 (ask text)' : '선택지 창 (ask dialog)'} · 진행 현황 ${prog ? `${prog}분` : '끔'}`);
  if (on && !chk.ready) console.log(`  ⚠ ${chk.problems.join(' · ')} → kedovi notify my channel on 을 다시 실행`);
}

const fn = commands[cmd];
if (!fn) {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 27).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}
Promise.resolve().then(fn).catch((e) => {
  if (cmd === 'pre-push' || cmd === 'deliver') process.exit(0); // push 를 막지 않는다
  console.error(`✖ ${e.message}`);
  process.exit(1);
});
