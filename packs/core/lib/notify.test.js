// notify.js 점검 — 설정 합치기(팀 ← 이 PC) · 보낼 문장 · push 변경 모으기. 실행: node notify.test.js
'use strict';
{
  const { looksLikeDecision } = require('./notify');
  const assert0 = require('assert');
  assert0.ok(looksLikeDecision('어느 쪽?\n\n1. **A (권장)**: x\n2. **B**: y'), '번호 보기 + 묻는 말');
  assert0.ok(looksLikeDecision('| 선택지 | 제목 |\n|---|---|\n| 1. (권장) | A |\n| 2. | B |\n번호로 답해 주세요'), '표로 쓴 보기');
  assert0.ok(!looksLikeDecision('끝났습니다.\n\n1. 파일 고침\n2. 테스트 통과'), '보고 목록은 결정이 아니다');
  assert0.ok(!looksLikeDecision('어느 쪽?\n1. A'), '보기 하나');
  for (const x of ['끝났습니다.\n1. 파일 고침\n2. 테스트 통과\n결정 D-12 를 반영했습니다.', '1. https://x?y=1\n2. b', '권장 설정으로 바꿨습니다.\n1. a\n2. b', '```\n1. a\n2. b\n```\n결정?', '수정 사항\n  1) a\n  2) b\n결정 로그 갱신',
    '핸드오프를 남겼습니다.\n\n1. 작업별 기록\n2. 스냅샷\n\n로드맵을 볼까요?', '작업을 끝냈습니다.\n1. 파일 고침\n2. 테스트 통과\n\n다음 단계로 진행할까요?',
    '완료했습니다. 무엇을 바꿨나요?\n\n1. a 수정\n2. b 추가', '1. a\n2. b\n\n배포는 언제 할지 정해 주세요.']) assert0.ok(!looksLikeDecision(x), `결정이 아니다: ${JSON.stringify(x)}`);
  assert0.ok(looksLikeDecision('README 제목\n\n1. A (권장)\n2. B\n\n번호로 답해 주세요.'), '목록 뒤 요청');
  for (const x of ['방법을 고르세요.\n1. A\n2. B', '1. A\n2. B\n\n어느 쪽이 좋을지 알려 주세요.', 'README 첫 줄 제목을 어느 쪽으로 할까요?\n\n1. **차세대 시스템**: 짧다\n2. **차세대 전환 워크스페이스**: 성격이 드러난다']) assert0.ok(looksLikeDecision(x), `결정이다: ${JSON.stringify(x)}`);
}
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-notify-'));
process.env.KEDOVI_CONFIG_DIR = path.join(tmp, 'config');
for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_TEAM_BOT_TOKEN', 'KEDOVI_NOTIFY', 'CLAUDE_CODE_BRIDGE_SESSION_ID', 'KEDOVI_REMOTE_CONTROL', 'KEDOVI_CHANNEL']) delete process.env[k]; // 채널 세션(kedovi start) · 리모트 세션 안에서 돌려도 같게
const n = require('./notify');

// 이벤트 파싱
assert.deepStrictEqual(n.parseEvents('1'), ['stop', 'notification']);
assert.deepStrictEqual(n.parseEvents('stop'), ['stop']);
assert.deepStrictEqual(n.parseEvents('off'), []);
assert.deepStrictEqual(n.parseEvents(''), []);
assert.deepStrictEqual(n.parseEvents('handoff,announce', n.TEAM_EVENTS), ['handoff', 'announce']);

// 비밀값 파일은 600
const file = n.writeSecrets({ TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '42' });
assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
assert.deepStrictEqual(n.readSecrets(), { TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '42' });

// 개인: 팀 기본 ← 이 PC
const root = path.join(tmp, 'ws');
fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
const ws = { vars: { notify: { events: 'stop', minSeconds: '60', teamChat: '', team: 'handoff,settings,announce' } } };
let p = n.personal(root, ws);
assert.deepStrictEqual([p.level, p.source, p.minSeconds, p.chat, p.token], ['decisions', 'team', 60, '42', 'T']); // 옛 events 값: 켜짐 = 결과와 결정
fs.writeFileSync(path.join(root, '.agents', 'local.json'), JSON.stringify({ notify: { events: 'off' } }));
assert.strictEqual(n.personal(root, ws).source, 'off'); // 팀이 켜도 이 PC 가 끈다
fs.writeFileSync(path.join(root, '.agents', 'local.json'), JSON.stringify({ notify: { events: '1', chat: '-7', minSeconds: 0 } }));
p = n.personal(root, { vars: {} });
assert.deepStrictEqual([p.events.length, p.source, p.chat, p.minSeconds], [2, 'local', '-7', 0]);
process.env.KEDOVI_NOTIFY = '0';
assert.deepStrictEqual(n.personal(root, ws).events, []);
delete process.env.KEDOVI_NOTIFY;

// 개인 문장: 짧은 작업은 보내지 않는다
const cfg = { events: ['stop', 'notification'], minSeconds: 60, token: 'T', chat: '42' };
const ctx = { project: 'shop', agent: 'claude' };
assert.strictEqual(n.personalMessage(cfg, { hook_event_name: 'Stop' }, { ...ctx, elapsed: 10 }), null);
assert.strictEqual(n.personalMessage(cfg, { hook_event_name: 'Stop', last_assistant_message: '끝냈다' }, { ...ctx, elapsed: 125 }), '✅ [shop] Claude 모든 작업 끝 (2분 5초)'); // 자리에 있으면 한 줄
assert.match(n.personalMessage({ ...cfg, away: true }, { hook_event_name: 'Stop', last_assistant_message: '끝냈다' }, { ...ctx, elapsed: 125 }), /^✅ \[shop\] Claude 작업 끝 \(2분 5초\)\n\n끝냈다$/); // 자리 비움이면 답까지
assert.strictEqual(n.personalMessage(cfg, { hook_event_name: 'Stop', last_assistant_message: '끝냈다' }, { ...ctx, elapsed: 125, pending: true }), null); // 일하는 팀원 · 백그라운드 작업이 남았으면 쉰다
assert.strictEqual(n.personalMessage(cfg, { hook_event_name: 'Stop', last_assistant_message: '어느 쪽?\n\n1. A (권장)\n2. B' }, { ...ctx, elapsed: 125 }), '❓ [shop] Claude: 선택할 것이 있습니다. 터미널에서 골라 주세요');
assert.strictEqual(n.personalMessage(cfg, { hook_event_name: 'Stop', stop_hook_active: true }, { ...ctx, elapsed: 999 }), null);
assert.strictEqual(n.personalMessage(cfg, { hook_event_name: 'Notification', message: '권한 필요' }, { ...ctx, agent: 'codex' }), '⏳ [shop] Codex: 확인 대기'); // 자리에 있으면 한 줄
assert.match(n.personalMessage({ ...cfg, away: true }, { hook_event_name: 'Notification', message: '권한 필요' }, { ...ctx, agent: 'codex' }), /^⏳ \[shop\] Codex: 확인 대기\n권한 필요$/);
// 질문 창 · 권한 확인 · 입력 대기를 문구로 나눈다 (Claude Code 는 질문 창도 "needs your permission" 으로 알릴 때가 있다)
const perm = { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' };
assert.strictEqual(n.personalMessage(cfg, { ...perm, message: 'x' }, { ...ctx, question: '어느 쪽?\n1. A\n2. B' }), '❓ [shop] Claude: 선택할 것이 있습니다. 터미널에서 골라 주세요'); // 자리에 있으면 설명 · 보기 없이
cfg.away = true; // 아래는 자리 비움 (설명 · 보기까지)
assert.match(n.personalMessage(cfg, perm, ctx), /^🔐 \[shop\] Claude: 권한 확인 대기\nClaude needs your permission to use Bash$/);
assert.match(n.personalMessage(cfg, { ...perm, message: 'Claude needs your permission' }, { ...ctx, question: '어느 쪽으로 할까요?' }), /^❓ \[shop\] Claude: 질문 대기\n어느 쪽으로 할까요\?$/);
assert.strictEqual(n.personalMessage(cfg, { hook_event_name: 'Notification', message: 'Claude is waiting for your input', notification_type: 'idle_prompt' }, ctx), null); // 응답 뒤 입력 대기는 결과 알림과 겹친다
assert.strictEqual(n.waitKind({ message: 'Claude needs your permission' }), 'permission');
// 채널로 띄운 세션(kedovi start 가 KEDOVI_CHANNEL=1)은 플러그인이 권한 요청을 버튼으로 보내므로 kedovi 은 보내지 않는다
process.env.KEDOVI_CHANNEL = '1';
assert.strictEqual(n.personalMessage(cfg, perm, ctx), null);
assert.strictEqual(n.personalMessage(cfg, { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }, ctx), null);
assert.match(n.personalMessage(cfg, { ...perm, message: 'x' }, { ...ctx, question: '질문?' }), /질문 대기/);
delete process.env.KEDOVI_CHANNEL;
delete cfg.away;
// 알림 수준: 전체 · 결과와 결정 · 진행 현황 · 끄기 (st 는 자리 비움 x.away 를 넘겨야 답 앞부분)
{
  const long = '가'.repeat(900);
  const st = (level, extra = {}, x = {}) => n.personalMessage({ ...cfg, level, ...x }, { hook_event_name: 'Stop', last_assistant_message: extra.answer || '끝냈다' }, { ...ctx, elapsed: extra.elapsed != null ? extra.elapsed : 125, prompt: extra.prompt, replied: extra.replied });
  assert.match(st('all', { prompt: '브랜치?', elapsed: 3 }), /^🖥 \[shop\] 터미널\n브랜치\?\n\n🤖\n끝냈다$/); // 전체: 짧아도 질문 · 답 전문
  assert.match(st('decisions', { answer: long }, { away: true }), /^✅ \[shop\] Claude 작업 끝 \(2분 5초\)\n\n가{800}\n… \(전문은 터미널\)$/); // 결과와 결정: 답 앞부분
  assert.strictEqual(st('decisions', { elapsed: 3 }), null); // 짧은 요청은 보내지 않는다
  assert.match(st('decisions', { answer: `반영했습니다. ${long}` }, { away: true }), /반영했습니다\. 가{700,}\n… \(전문은 터미널\)$/); // 공백 없이 긴 글도 앞부분이 남는다
  assert.match(st('decisions', { elapsed: 3 }, { away: true }), /작업 끝/); // 자리 비움이면 모두
  assert.strictEqual(st('progress'), '✅ [shop] Claude 모든 작업 끝 (2분 5초)'); // 자리에 있으면 한 줄
  // PC 앞이면 결과를 보내지 않는다 (전체 수준은 그대로)
  const sd = (level, desk) => n.personalMessage({ ...cfg, level }, { hook_event_name: 'Stop', last_assistant_message: '끝냈다' }, { ...ctx, elapsed: 125, desk });
  assert.ok(sd('decisions', true) === null && sd('progress', true) === null && /모든 작업 끝/.test(sd('decisions', false)));
  const idle = (s, x = {}) => { process.env.KEDOVI_IDLE_SECONDS = String(s); try { return n.atDesk({ deskSeconds: 120, ...x }); } finally { delete process.env.KEDOVI_IDLE_SECONDS; } };
  assert.ok(idle(30) && !idle(300) && !idle(30, { away: true }) && !idle(30, { deskSeconds: 0 }) && !idle('x'));
  assert.strictEqual(st('off'), null);
  assert.strictEqual(st('all', { prompt: 'x', replied: true }), null); // 텔레그램 요청은 Claude 가 reply 로 이미 답했다
  const q = { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'x' };
  assert.strictEqual(n.personalMessage({ ...cfg, level: 'progress', away: true }, q, { ...ctx, question: '어느 쪽?\n1. A\n2. B' }), '❓ [shop] Claude: 질문 대기\n어느 쪽?\n1. A\n2. B'); // 자리 비움이면 보기까지
  assert.match(n.personalMessage({ ...cfg, level: 'all' }, q, { ...ctx, question: '어느 쪽?\n1. A' }), /1\. A$/); // 전체 수준은 늘 보기까지
  assert.strictEqual(n.personalMessage({ ...cfg, level: 'off' }, q, { ...ctx, question: '어느 쪽?' }), null);
  assert.ok(n.wantsProgress({ level: 'all' }) && n.wantsProgress({ level: 'progress', away: true }) && !n.wantsProgress({ level: 'progress' }) && !n.wantsProgress({ level: 'decisions', away: true }));
  process.env.KEDOVI_REMOTE_CONTROL = '1'; assert.ok(n.remoteControl('x')); process.env.KEDOVI_REMOTE_CONTROL = '0'; assert.ok(!n.remoteControl('x')); delete process.env.KEDOVI_REMOTE_CONTROL;
  { const prev = process.env.CLAUDE_CODE_BRIDGE_SESSION_ID; process.env.CLAUDE_CODE_BRIDGE_SESSION_ID = 'session_x'; assert.ok(n.remoteControl()); if (prev == null) delete process.env.CLAUDE_CODE_BRIDGE_SESSION_ID; else process.env.CLAUDE_CODE_BRIDGE_SESSION_ID = prev; }
  // 이 PC 수준 · 자리 비움 (옛 channelAsk text = 자리 비움)
  fs.writeFileSync(path.join(root, '.agents', 'local.json'), JSON.stringify({ notify: { level: 'progress', channelAsk: 'text' } }));
  const lp = n.personal(root, ws);
  assert.deepStrictEqual([lp.level, lp.away, lp.source, lp.deskSeconds], ['progress', true, 'local', 120]);
  assert.strictEqual(n.voiceOf(root).scope, 'decisions'); // 음성 기본 범위 = 결정 질문만
}
assert.strictEqual(n.personalMessage({ ...cfg, token: '' }, { hook_event_name: 'Stop' }, { ...ctx, elapsed: 999 }), null);

// 팀: teamChat 이 없으면 꺼짐
assert.deepStrictEqual(n.team(root, ws).events, []);
const teamCfg = n.team(root, { vars: { notify: { teamChat: '-100', team: '' } } });
assert.deepStrictEqual(teamCfg.events, n.TEAM_EVENTS);

// 핸드오프 요약
assert.strictEqual(n.handoffLine('# 마지막 상태\n\n한 줄: 결제 서버 끝, 화면 남음\n'), '결제 서버 끝, 화면 남음');
assert.strictEqual(n.handoffLine('# 마지막\n- 환불 API 완료\n'), '환불 API 완료');
assert.strictEqual(n.todoCount('# TODO\n- a\n- [ ] b\n- [x] c\n'), 2);

// push 변경 모으기 (실제 git)
const repo = path.join(tmp, 'repo');
const remote = path.join(tmp, 'remote.git');
const g = (...a) => execFileSync('git', ['-C', repo, '-c', 'maintenance.auto=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const put = (f, body) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), body); };
execFileSync('git', ['init', '-q', '--bare', remote]);
fs.mkdirSync(repo);
g('init', '-q', '-b', 'main');
g('config', 'user.name', 'kim'); g('config', 'user.email', 'k@x');
g('remote', 'add', 'origin', remote);
put('README.md', 'x'); g('add', '.'); g('commit', '-qm', 'init');
g('push', '-q', 'origin', 'main');
const base = g('rev-parse', 'HEAD');
put('handoffs/kim/LATEST.md', '# 마지막\n한 줄: 주문 목록 끝\n'); put('handoffs/kim/TODO.md', '- 화면\n- 테스트\n'); put('handoffs/kim/topics/주문-목록.md', '# x');
g('add', '.'); g('commit', '-qm', 'docs: 핸드오프');
put('workspace.json', '{}'); g('add', '.'); g('commit', '-qm', 'chore: 규칙 끄기');
const head = g('rev-parse', 'HEAD');
const git = (a) => { try { return g(...a); } catch { return null; } };
const ch = n.collectPush(git, `refs/heads/main ${head} refs/heads/main ${base}\n`, 'origin');
assert.deepStrictEqual(ch.handoffs.map((h) => [h.id, h.topics, n.handoffLine(h.latest), n.todoCount(h.todo)]), [['kim', ['주문-목록'], '주문 목록 끝', 2]]);
assert.deepStrictEqual(ch.settings, [{ author: 'kim', subject: 'chore: 규칙 끄기' }]);
const newBranch = n.collectPush(git, `refs/heads/f ${head} refs/heads/f ${'0'.repeat(40)}\n`, 'origin');
assert.strictEqual(newBranch.handoffs.length, 1); // 새 브랜치: 원격에 없는 커밋만
assert.deepStrictEqual(n.collectPush(git, `(delete) ${'0'.repeat(40)} refs/heads/f ${head}\n`, 'origin').refs, []);

const msgs = n.teamMessages({ ...teamCfg, token: 'T' }, { project: 'shop', ...ch });
assert.strictEqual(msgs.length, 2);
assert.match(msgs[0], /^📝 \[shop\] kim 핸드오프: 주문 목록 끝\n작업: 주문-목록\nTODO 2건$/);
assert.match(msgs[1], /^⚙️ \[shop\] 설정 변경 \(kim\)\n- chore: 규칙 끄기$/);
assert.deepStrictEqual(n.teamMessages({ ...teamCfg, token: 'T', events: ['announce'] }, { project: 'shop', ...ch }), []);
assert.match(n.announceMessage({ ...teamCfg, token: 'T' }, { project: 'shop', author: 'kim', text: '내일 배포 동결' }), /^📢 \[shop\] kim: 내일 배포 동결$/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('notify.test.js ok');

// 양방향 채널은 프로젝트마다 상태 폴더 · 봇이 따로다. 다른 프로젝트가 쓰는 봇은 알아본다. 채널을 켠 워크스페이스는 알림도 그 봇으로
{
  const os2 = require('os');
  const fs2 = require('fs');
  const path2 = require('path');
  const home = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'kedovi-ch-'));
  const ws1 = path2.join(home, 'shop'); const ws2 = path2.join(home, 'blog');
  for (const w of [ws1, ws2]) { fs2.mkdirSync(path2.join(w, '.agents'), { recursive: true }); fs2.writeFileSync(path2.join(w, 'workspace.json'), JSON.stringify({ project: { name: path2.basename(w) } })); }
  process.env.CLAUDE_CONFIG_DIR = home;
  assert.strictEqual(n.channelDir(ws1), path2.join(home, 'channels', 'telegram-shop'));
  fs2.mkdirSync(n.channelDir(ws1), { recursive: true });
  fs2.writeFileSync(path2.join(n.channelDir(ws1), '.env'), 'TELEGRAM_BOT_TOKEN=AAA\n');
  assert.strictEqual(n.channelToken(ws1), 'AAA');
  assert.strictEqual(n.channelTokenUsedElsewhere(ws2, 'AAA').dir, n.channelDir(ws1));
  assert.strictEqual(n.channelTokenUsedElsewhere(ws1, 'AAA'), null);
  fs2.writeFileSync(path2.join(ws1, '.agents', 'local.json'), JSON.stringify({ notify: { channel: true, events: 'stop' } }));
  assert.strictEqual(n.personal(ws1, {}).token, 'AAA');
  assert.notStrictEqual(n.personal(ws2, {}).token, 'AAA');
  // 수신 감시: bot.pid 가 없거나 꺼진 프로세스면 끊김
  assert.match(n.channelHealth(ws1).reason, /수신 프로세스가 없다/);
  fs2.writeFileSync(path2.join(n.channelDir(ws1), 'bot.pid'), '999999');
  assert.match(n.channelHealth(ws1).reason, /꺼졌다/);
  // 플러그인 기본 폴더에 같은 토큰이 있으면 shared 로 알린다 (channel on 이 끈다)
  fs2.mkdirSync(path2.join(home, 'channels', 'telegram'), { recursive: true });
  fs2.writeFileSync(path2.join(home, 'channels', 'telegram', '.env'), 'TELEGRAM_BOT_TOKEN=AAA\n');
  assert.strictEqual(n.channelTokenUsedElsewhere(ws1, 'AAA').shared, true);
  delete process.env.CLAUDE_CONFIG_DIR;
  fs2.rmSync(home, { recursive: true, force: true });
}
// 채널 세션만 수신 (bun 대리 실행): 부모(Claude Code) 인자에 --channels 가 있고 팀원(--agent-name) · 위임이 아니면 진짜 bun, 아니면 막고 기록
if (process.platform !== 'win32') {
  const { spawnSync } = require('child_process');
  const wsS = path.join(tmp, 'shim-ws');
  fs.mkdirSync(wsS, { recursive: true });
  fs.writeFileSync(path.join(wsS, 'workspace.json'), JSON.stringify({ project: { name: 'shimtest' } }));
  const prevCfg = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-home');
  try {
    const dir = n.channelShim(wsS, '/bin/echo');
    const shim = path.join(dir, 'bun');
    const plugin = ['run', '--cwd', '/x/plugins/telegram/0.0.7', '--shell=bun', '--silent', 'start'];
    // 부모 프로세스 = 이 인자로 띄운 node (Claude Code 자리)
    const viaParent = (parentArgs, args, env = {}) => spawnSync(process.execPath, ['-e', `const r=require('child_process').spawnSync(${JSON.stringify(shim)}, ${JSON.stringify(args)}, { encoding: 'utf8' }); process.stdout.write(r.stdout || '')`, '--', ...parentArgs], { encoding: 'utf8', env: { ...process.env, ...env } }).stdout;
    const lead = viaParent(['--channels', 'plugin:telegram@claude-plugins-official'], plugin);
    const mate = viaParent(['--agent-id', 'w1@t', '--agent-name', 'w1', '--team-name', 't'], plugin);
    const plain = viaParent(['--model', 'opus'], plugin);
    const deleg = viaParent(['--channels', 'x'], plugin, { KEDOVI_DELEGATED: '1' });
    const other = viaParent(['--model', 'opus'], ['install', 'x']);
    assert.match(lead, /--cwd \/x\/plugins\/telegram/, '채널 세션은 진짜 bun');
    assert.ok(mate === '' && plain === '' && deleg === '', '팀원 · 채널 아닌 세션 · 위임은 막는다');
    assert.strictEqual(other.trim(), 'install x', '텔레그램 서버가 아닌 bun 은 그대로');
    const log = fs.readFileSync(path.join(n.channelDir(wsS), 'kedovi-channel.log'), 'utf8');
    assert.match(log, /띄움: 채널 세션/);
    assert.match(log, /막음: 팀원 w1/);
    assert.match(n.channelLogLast(wsS), /막음: 채널 아닌 세션/);
    n.channelShim(wsS, shim); // 채널 세션 안에서 다시 시작: PATH 의 다른 bun 을 쓰거나 만들지 않는다
    assert.ok(!fs.readFileSync(shim, 'utf8').includes(`exec '${shim}'`), '자기 자신을 진짜 bun 으로 삼지 않는다');
    assert.strictEqual(n.holderOf(['bun server.ts', 'bun run', 'claude --agent-id w2@t --agent-name w2']), '팀원 w2');
    assert.strictEqual(n.channelShim(wsS, null), null);
  } finally { if (prevCfg == null) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prevCfg; }
}
console.log('notify.test.js 채널 ok');

// 채널 세션 미러: 터미널 요청의 질문 · 답을 텔레그램으로 (4096자 넘으면 나눈다)
assert.strictEqual(n.mirrorMessage(null, '답', 'shop'), null);
assert.strictEqual(n.mirrorMessage('질문', '  ', 'shop'), null);
assert.match(n.mirrorMessage('지금 브랜치?', 'main 입니다.', 'shop'), /^🖥 \[shop\] 터미널\n지금 브랜치\?\n\n🤖\nmain 입니다\.$/);
const long = Array.from({ length: 300 }, (_, i) => `줄 ${i} ${'가'.repeat(30)}`).join('\n');
const parts = n.chunks(long);
assert.ok(parts.length > 1 && parts.every((p) => p.length <= 4000) && parts.join('\n') === long);
console.log('notify.test.js 미러 ok');

// 텔레그램 표시: 표 → 목록, 굵게 · 코드 · 링크, HTML 이스케이프
{
  const h = n.toTelegramHtml('| 항목 | 결과 |\n|---|---|\n| 반영 | `03-news` <b> & |\n\n- **사후** 판정\n## 제목\n[링크](https://x.y/?a=1&b=2)');
  assert.match(h, /^• <b>반영<\/b>: <code>03-news<\/code> &lt;b&gt; &amp;$/m);
  assert.match(h, /^• <b>사후<\/b> 판정$/m);
  assert.match(h, /^<b>제목<\/b>$/m);
  assert.match(h, /<a href="https:\/\/x\.y\/\?a=1&amp;b=2">링크<\/a>/);
  assert.ok(!/\|/.test(h));
  const three = n.toTelegramHtml('| 파일 | 전 | 후 |\n|---|---|---|\n| a.md | 1 | 2 |');
  assert.strictEqual(three, '• <b>a.md</b>: 전 1 · 후 2');
  assert.strictEqual(n.toTelegramHtml('```\nnpm test\n```'), '<pre>npm test</pre>');
}
console.log('notify.test.js 텔레그램 표시 ok');

// 자리 비움 결정 질문 — 결정마다 메시지 · 권장안 ✅ · 답 버튼(보기 · ✏️ · 모두 권장안) · 직접 입력 창 · 버튼 걷기 · 접기 · 음성 문장
{
  const spec = { title: '뉴스', decisions: [
    { title: '관리 사이트 <IP> 예외', context: '화면·운영 D1-3', options: [{ label: '그대로: TOTP 만', detail: '비밀번호만으로 뚫리지 않게' }, { label: 'NS-5 원래대로' }] },
    { title: '권한 없음 응답', context: '줄\n줄\n줄\n줄', options: [{ label: '403' }, { label: '404' }], recommended: 1 }] };
  const r = n.decisionMessages(spec);
  assert.match(r.head, /^🟡 <b>결정 2건<\/b> · 뉴스/);
  assert.match(r.head, /2: 원하는 내용/);
  assert.strictEqual(r.messages.length, 2);
  assert.match(r.messages[0], /<b>1\/2  관리 사이트 &lt;IP&gt; 예외<\/b>/, 'HTML 이스케이프');
  assert.match(r.messages[0], /✅ <b>1-1<\/b> 그대로: TOTP 만 <i>\(권장\)<\/i>\n      <i>비밀번호만으로/);
  assert.match(r.messages[1], /<blockquote expandable>/, '긴 배경은 접는다');
  assert.match(r.messages[1], /▫️ <b>2-1<\/b> 403\n✅ <b>2-2<\/b> 404/);
  assert.deepStrictEqual(r.keyboard.keyboard.map((row) => row.map((b) => b.text)), [['1-1 ✅ 그대로: TOTP 만'], ['1-2 NS-5 원래대로'], ['1 ✏️ 직접 입력'], ['2-1 403'], ['2-2 ✅ 404'], ['2 ✏️ 직접 입력'], ['모두 권장안']], '보기마다 한 줄 · 보기 이름');
  assert.ok(r.keyboard.input_field_placeholder.length <= 64);
  assert.ok(r.keyboard.one_time_keyboard && !r.keyboard.is_persistent, '한 번 누르면 접힌다 · 늘 보이지 않는다');
  assert.strictEqual(n.decisionMessages({ decisions: [{ title: 'A', options: [{ label: '아주 긴 보기 이름이라서 버튼에는 다 들어가지 않는다' }] }] }).keyboard.keyboard[0][0].text, '1-1 ✅ 아주 긴 보기 이름이라서 버튼에는 다 …', '긴 이름은 22자로 줄인다');
  const pm = n.promptMessage(spec, 2);
  assert.match(pm.text, /✏️ <b>2\/2  권한 없음 응답<\/b>/);
  assert.strictEqual(pm.markup.force_reply, true);
  assert.deepStrictEqual(n.answeredMessage('1-1, 2: 화면은 404').markup, { remove_keyboard: true });
  // 에이전트가 answered 를 잊어도 끝남 알림이 걷는다: 질문을 이번 요청 전에 보냈고 이번 끝 응답이 새 결정 질문이 아닐 때만
  const ck = (o) => n.shouldClearKeyboard({ pending: true, askedAt: 100, turn: 200, last: '반영했습니다.', ...o });
  assert.ok(ck({}), '답을 받아 일을 끝냈으면 걷는다');
  assert.ok(!ck({ askedAt: 300 }), '질문을 보낸 그 요청에서는 걷지 않는다');
  assert.ok(!ck({ last: '어느 쪽으로 할까요?\n\n1. **A (권장)**: 이유\n2. **B**: 이유' }), '새 결정 질문이면 걷지 않는다');
  assert.ok(!ck({ pending: false }), '걷을 질문이 없으면 그대로');
  assert.match(n.toTelegramHtml('# 결과\n> 인용\n> 둘째'), /^<b>결과<\/b>\n<blockquote>인용\n둘째<\/blockquote>$/);
  assert.match(n.toTelegramHtml('앞\n## 제목'), /앞\n\n<b>제목<\/b>/, '제목 앞은 한 줄 띄운다');
  const long = Array.from({ length: 20 }, (_, i) => `줄 ${i}`).join('\n');
  assert.match(n.foldHtml(long, 5), /^줄 0\n.*줄 4\n<blockquote expandable>줄 5\n/s);
  assert.strictEqual(n.foldHtml('짧음', 5), '짧음');
  assert.strictEqual(n.foldHtml(`${long}\n<pre>x</pre>`, 5), `${long}\n<pre>x</pre>`, '뒤에 코드 블록이 있으면 접지 않는다');
  // 음성 문장 — 제목과 권장안만, 코드 · 경로 · 괄호는 읽지 않는다
  const sp = n.decisionsSpeech(spec);
  assert.match(sp, /^결정 2건이 있습니다\. 첫째, 관리 사이트 IP 예외\. 권장은 그대로\. 둘째, 권한 없음 응답\. 권장은 404\./);
  assert.ok(!/`|\//.test(n.speakable('`npm test` 실행 · packs/core/x.js 수정 (자세히)')));
  // 보고하듯 문장만: 기호 · 해시 · ID · 파일 이름 · 단축키 · 표 · 제목은 읽지 않는다
  assert.strictEqual(n.speakable('▶ 발표 → 끝 · 4b22265 커밋, REQ-ADM-014 · 015 반영, docs-site.js 수정, 2026-10-07 완료 2 / 전체 10, 50%'),
    '발표, 끝, 커밋, 반영, 수정, 10월 7일 완료 10 중 2, 50 퍼센트');
  assert.strictEqual(n.speakable('⌘ + Shift + R 로 새로 고침'), '단축키 로 새로 고침');
  assert.strictEqual(n.doneSpeech('## 만든 것\n\n바꿨습니다\n\n| 칸 | 값 |\n|---|---|\n| a | 4b22265 |\n\n- **확인**: 통과 ✔\n\n```\nnpm test\n```'), '바꿨습니다. 확인, 통과.');
  assert.strictEqual(n.speakable('09:30 에 시작'), '9시 30분 에 시작');
  assert.ok(n.voiceWants({ on: true, scope: 'both' }, 'decisions') && n.voiceWants({ on: true, scope: 'both' }, 'done'));
  assert.ok(!n.voiceWants({ on: true, scope: 'both' }, 'other') && !n.voiceWants({ on: false, scope: 'all' }, 'done'));
  assert.ok(n.voiceWants({ on: true, scope: 'all' }, 'other') && !n.voiceWants({ on: true, scope: 'decisions' }, 'done'));
}
console.log('notify.test.js 결정 질문 · 음성 문장 ok');

// 보낸 요청 확인 — 가짜 텔레그램 API 로 답 버튼은 마지막 결정 메시지에, 음성은 sendVoice 로 올라가는지
(async () => {
  const http = require('http');
  const got = [];
  const server = http.createServer((req, res) => {
    const body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => { got.push({ url: req.url, type: req.headers['content-type'] || '', body: Buffer.concat(body).toString('utf8') }); res.setHeader('content-type', 'application/json'); res.end(/\/botBAD\//.test(req.url) ? '{"ok":false,"description":"Bad Request: chat not found"}' : '{"ok":true,"result":{}}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.KEDOVI_TELEGRAM_API = `http://127.0.0.1:${server.address().port}`;
  const cfg = { token: 'T', chat: '42' };
  const r = n.decisionMessages({ decisions: [{ title: 'A', options: [{ label: 'x' }] }, { title: 'B', options: [{ label: 'y' }] }] });
  await n.send(r.head, cfg, 3000, { html: true });
  await n.send(r.messages[0], cfg, 3000, { html: true });
  await n.send(r.messages[1], cfg, 3000, { html: true, markup: r.keyboard });
  const bodies = got.map((g) => JSON.parse(g.body));
  assert.ok(bodies.every((b) => b.parse_mode === 'HTML' && b.chat_id === '42'));
  assert.ok(!bodies[0].reply_markup && !bodies[1].reply_markup && bodies[2].reply_markup.keyboard.length === 5, '답 버튼은 마지막 메시지에만');
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-voice-')), 'v.m4a');
  fs.writeFileSync(f, 'fake');
  await n.sendVoice(f, cfg);
  const v = got[got.length - 1];
  assert.match(v.url, /\/botT\/sendVoice$/);
  assert.match(v.type, /multipart\/form-data/);
  assert.match(v.body, /name="voice"; filename="v\.m4a"/);
  // 리모트 컨트롤(Claude 앱) 연결 중 훅: 결정 · 입력 대기는 앱 몫이라 보내지 않고, 작업 끝 한 줄만 (remote quiet 면 그것도 쉼)
  const wsr = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-remote-'));
  fs.mkdirSync(path.join(wsr, '.agents'));
  fs.writeFileSync(path.join(wsr, 'workspace.json'), '{}');
  const hook = (input, remote) => new Promise((resolve) => {
    const c = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'hooks', 'notify.js'), '--agent=claude'], { env: { ...process.env, CLAUDE_PROJECT_DIR: wsr, TELEGRAM_BOT_TOKEN: 'R', KEDOVI_IDLE_SECONDS: '100000', CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_x' } });
    c.on('close', resolve);
    c.stdin.end(JSON.stringify({ session_id: 'remote-t', ...input }));
  });
  const sentR = () => got.filter((g) => /\/botR\//.test(g.url)).map((g) => JSON.parse(g.body).text);
  const runRemote = async (remote) => {
    fs.writeFileSync(path.join(wsr, '.agents', 'local.json'), JSON.stringify({ notify: { level: 'decisions', chat: '42', minSeconds: 0, ...(remote ? { remote } : {}) } }));
    const before = sentR().length;
    await hook({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'x' });
    await hook({ hook_event_name: 'Stop', last_assistant_message: '어느 쪽?\n\n1. A (권장)\n2. B' });
    await hook({ hook_event_name: 'Stop', last_assistant_message: '끝냈다' });
    return sentR().slice(before);
  };
  const doneOnly = await runRemote();
  assert.deepStrictEqual(doneOnly.map((t) => t.split(' ')[0]), ['✅'], `리모트 연결 중 기본은 작업 끝만: ${JSON.stringify(doneOnly)}`);
  assert.deepStrictEqual(await runRemote('quiet'), [], 'remote quiet 면 아무것도');
  assert.strictEqual((await runRemote('send')).length, 3, 'remote send 면 모두');
  // 명령의 종료 코드: 보냄 0 · 전송 실패 1 · 설정 없음 2 · 사용법 3 (스크립트가 실패를 알 수 있게)
  const cli = (args, token, input) => {
    const conf = path.join(wsr, `config-${token || 'none'}`);
    fs.mkdirSync(conf, { recursive: true });
    if (token) fs.writeFileSync(path.join(conf, 'telegram.env'), `TELEGRAM_BOT_TOKEN=${token}\n`);
    // 같은 프로세스의 가짜 서버가 답해야 하므로 spawnSync 가 아니라 비동기로
    return new Promise((resolve) => {
      const c = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'notify.js'), ...args], { cwd: wsr, env: { ...process.env, CLAUDE_PROJECT_DIR: wsr, KEDOVI_CONFIG_DIR: conf } });
      let stdout = ''; let stderr = '';
      c.stdout.on('data', (d) => { stdout += d; });
      c.stderr.on('data', (d) => { stderr += d; });
      c.on('close', (status) => resolve({ status, stdout, stderr }));
      c.stdin.end(input || '');
    });
  };
  fs.writeFileSync(path.join(wsr, '.agents', 'local.json'), JSON.stringify({ notify: { level: 'decisions', chat: '42' } }));
  assert.strictEqual((await cli(['say'], 'R', '# 끝\n- a')).status, 0, 'say 보냄 = 0');
  const bad = await cli(['say'], 'BAD', '# 끝');
  assert.strictEqual(bad.status, 1, `say 전송 실패 = 1: ${bad.stdout}${bad.stderr}`);
  assert.match(bad.stderr, /전송 실패: Bad Request/);
  assert.strictEqual((await cli(['say'], '', '# 끝')).status, 2, 'say 설정 없음 = 2');
  assert.strictEqual((await cli(['say'], 'R', '')).status, 3, 'say 빈 입력 = 3');
  assert.strictEqual((await cli(['answered', 'x'], 'BAD')).status, 1, 'answered 전송 실패 = 1');
  assert.strictEqual((await cli(['prompt', '1'], 'BAD')).status, 1, 'prompt 전송 실패 = 1');
  assert.strictEqual((await cli(['test'], 'BAD')).status, 1, 'test 전송 실패 = 1');
  assert.strictEqual((await cli(['test'], '')).status, 2, 'test 설정 없음 = 2');
  const askFile = path.join(wsr, 'ask.json');
  fs.writeFileSync(askFile, JSON.stringify({ decisions: [{ title: 'A', options: [{ label: 'x' }] }] }));
  assert.strictEqual((await cli(['ask', '--file', askFile], 'BAD')).status, 1, 'ask 전송 실패 = 1');
  assert.strictEqual((await cli(['ask', '--file', askFile], 'R')).status, 0, 'ask 보냄 = 0');
  assert.strictEqual((await cli(['announce', 'x'], 'R')).status, 2, 'announce 팀 방 없음 = 2');
  fs.rmSync(wsr, { recursive: true, force: true });
  server.close();
  delete process.env.KEDOVI_TELEGRAM_API;
  console.log('notify.test.js 보낸 요청 (답 버튼 · 음성 업로드) ok');
})().catch((e) => { console.error(e); process.exit(1); });
