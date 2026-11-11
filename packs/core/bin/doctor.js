#!/usr/bin/env node
// 워크스페이스 셋업 진단 (읽기 전용 — 아무것도 고치지 않는다). 실행: node packs/core/bin/doctor.js  (문제가 있으면 exit 1)
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { load, devId, git, repoRel } = require('../lib/workspace');

const checks = [];
const add = (level, name, detail = '', fix = '') => checks.push({ level, name, detail, fix });
const OK = 'ok';
const WARN = 'warn';
const FAIL = 'fail';

const { findCli: which } = require('../lib/cli');
function version(cmd) {
  try { return execFileSync(cmd, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]; } catch { return null; }
}

let ws;
try { ws = load(); } catch (e) {
  console.error(`✗ workspace.json 을 읽지 못했습니다. ${e.message}`);
  process.exit(1);
}
const ROOT = ws.root;

// 1. Node
const [major, minor] = process.versions.node.split('.').map(Number);
const nodeOk = major > 20 || (major === 20 && minor >= 19); // kedovi(package.json engines) 기준. 워크스페이스 도구는 18 에서도 돈다
add(nodeOk ? OK : major >= 18 ? WARN : FAIL, 'Node.js', `v${process.versions.node}`, 'Node 20.19 이상 설치 (https://nodejs.org)');

// 2. git
const gitVer = version('git');
add(gitVer ? OK : FAIL, 'git', gitVer || '설치 안 됨', 'git 설치');

// 킷 버전 — 전역 kedovi 과 워크스페이스(bin/kit.js · 팩)가 다르면 생성물 모양이 달라 검사가 어긋날 수 있다
const wsKit = (() => { try { return (JSON.parse(fs.readFileSync(path.join(ROOT, 'workspace.json'), 'utf8')).kit || {}).version || null; } catch { return null; } })();
const cliKit = process.env.KEDOVI_VERSION || (() => {
  const r = spawnSync('kedovi', ['--version'], { encoding: 'utf8', timeout: 10000, shell: process.platform === 'win32' });
  return r.status === 0 ? (String(r.stdout).trim().match(/\d+\.\d+\.\d+/) || [])[0] || null : null;
})();
const semver = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
const cmpVer = (a, b) => { const x = semver(a); const y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
if (!cliKit) add(WARN, '킷 버전', `워크스페이스 ${wsKit || '?'} · 전역 kedovi 없음`, 'npm i -g kedovi (README 설치 절)');
else if (!wsKit || cmpVer(cliKit, wsKit) === 0) add(OK, '킷 버전', `${cliKit}${wsKit ? '' : ' (워크스페이스 기록 없음)'}`);
else if (cmpVer(cliKit, wsKit) > 0) add(WARN, '킷 버전', `전역 kedovi ${cliKit} · 워크스페이스 ${wsKit} (워크스페이스가 낮음)`, `팀장이 kedovi upgrade → commit · push (팀원은 git pull)`);
else add(WARN, '킷 버전', `전역 kedovi ${cliKit} · 워크스페이스 ${wsKit} (전역이 낮음)`, 'npm i -g kedovi 로 전역 kedovi 을 올린다');

// 3. 워크스페이스 repo
const isRepo = git(ROOT, ['rev-parse', '--is-inside-work-tree']) === 'true';
add(isRepo ? OK : FAIL, 'git: 워크스페이스', isRepo ? 'OK' : 'git 저장소 아님', '워크스페이스 루트에서 git init (또는 clone)');
const id = devId(ROOT);
add(id ? OK : WARN, '개발자 ID (git user.name)', id || '미설정', '워크스페이스 루트에서 git config user.name <id>');
const team = ws.team || {};
const TL = require('../lib/team');
const roster = TL.roster(ws);
const who = TL.whoAmI(ROOT, ws);
if (roster.leads.length || roster.members.length) {
  add(who.source === 'git user.name' ? WARN : OK, '이 PC 사용자 (저장소 계정)', `${who.nickname ? `${who.nickname} · ` : ''}${who.username || '모름'} (${who.source})`, '저장소 계정 확인: kedovi team whoami --refresh');
}
if (team.lock && roster.leads.length) {
  add(OK, '팀원 설정 수정', `불가 (팀장 ${roster.leads.map(TL.callName).join(', ')}) · 나: ${who.lead ? '팀장' : '팀원 (자기 handoffs/ 와 로드맵만 커밋)'}`, '');
}
if (roster.members.length) {
  const inRoster = who.lead || !!who.person;
  add(inRoster ? OK : team.restrict ? FAIL : WARN, '팀 명단', inRoster ? `${TL.callName(who.person) || who.username} (${who.lead ? '팀장' : `팀원 · 담당 ${(who.repos || []).join(', ') || '없음'}`} · 명단 ${roster.members.length}명${team.restrict ? ' · 제한 켜짐' : ''})` : `${who.username || '(id 없음)'} 이(가) 명단에 없음${team.restrict ? '. kedovi start 가 멈춘다' : ''}`, `팀장에게 명단 추가(kedovi team add ${who.username || '<username>'} --nick 이름) 요청`);
  const blocked = TL.blockedRepos(ROOT, ws);
  if (blocked.length) add(OK, '담당 아닌 repo', `${blocked.join(', ')} (읽기만, 수정 · 커밋은 막힘)`, '');
}

// AI 연결 방식 (kedovi ai) — 쓰는 AI 의 CLI · 게이트웨이 모델 목록 · 역할 모델 경고
try {
  const kitLib = require(path.join(ROOT, 'bin', 'kit.js'));
  if (kitLib.normalizeAccess) {
    const m = kitLib.resolveModels(ROOT, ws);
    const a = m.access;
    const name = { claude: 'Claude', codex: 'GPT' };
    const desc = a.connection === 'gateway'
      ? `AI 게이트웨이 ${(a.gateway && a.gateway.url) || '(주소 없음)'} · 모델 ${((a.gateway && a.gateway.models) || []).length}개${a.gateway && a.gateway.checked ? ` (${a.gateway.checked} 조회)` : ''}`
      : `AI 서비스 직접 (${a.vendors.map((v) => name[v]).join(' · ')})`;
    // 정하지 않았는데 Claude Code 가 게이트웨이로 이어져 있으면 (셸 환경변수 · ~/.claude/settings.json) 그 주소로 맞추라고 알린다
    let seen = '';
    if (!a.set) {
      let env = {};
      try { env = JSON.parse(fs.readFileSync(path.join(require('os').homedir(), '.claude', 'settings.json'), 'utf8')).env || {}; } catch { /* 없음 */ }
      seen = [process.env.ANTHROPIC_BASE_URL, env.ANTHROPIC_BASE_URL].find((u) => u && !/(^|\.)anthropic\.com(:\d+)?(\/|$)/.test(String(u).replace(/^https?:\/\//, ''))) || '';
    }
    add(a.set ? OK : WARN, 'AI 연결 방식', `${desc}${seen ? ` (정하지 않음: 이 PC 의 Claude Code 는 게이트웨이 ${seen} 로 연결)` : ''} · 역할 상한 동시 ${m.limits.parallel} · 모두 ${m.limits.total}`,
      seen ? 'kedovi ai gateway 로 이 주소를 저장한다' : 'kedovi ai 로 정한다 (정하지 않으면 두 회사 직접 연결로 본다)');
    const tool = kitLib.startToolOf(a);
    const cli = { claude: 'claude', codex: 'codex' }[tool];
    let found = false;
    try { found = !!require('../lib/cli.js').findCli(cli); } catch { /* 옛 워크스페이스 */ }
    add(found ? OK : FAIL, `시작 도구 (${cli})`, found ? '설치됨' : '설치 안 됨', cli === 'claude' ? 'npm i -g @anthropic-ai/claude-code' : 'npm i -g @openai/codex');
    if (a.connection === 'gateway' && !((a.gateway && a.gateway.models) || []).length) add(WARN, '게이트웨이 모델 목록', '비어 있음 (조회 실패)', 'kedovi ai refresh');
    // 게이트웨이 별칭(ANTHROPIC_DEFAULT_*_MODEL)이 1M 모델인데 [1m] 이 없으면 Claude Code 가 200k 로 보고 일찍 압축한다
    if (a.connection === 'gateway' && kitLib.window1m) {
      let env = {};
      try { env = JSON.parse(fs.readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude'), 'settings.json'), 'utf8')).env || {}; } catch { /* 없음 */ }
      // 게이트웨이 목록에 없는 모델을 가리키는 값 (옛 모델 ID 등): 그 모델을 쓰는 도구 · 하위 에이전트가 「모델이 없다」로 실패한다
      const missing = kitLib.gatewayAliasCheck ? kitLib.gatewayAliasCheck(a).problems : [];
      const missKeys = new Set(missing.map((x) => x.key));
      if (missing.length) add(FAIL, '게이트웨이 모델 이름', `${missing.map((x) => `${x.key}=${x.value} (${x.source})`).join(' · ')} 가 게이트웨이 목록에 없습니다. 그 모델을 쓰는 도구(웹 문서 읽기 · 하위 에이전트)가 「모델이 없다」로 실패합니다`,
        `${kitLib.gatewayAliasHint(missing)} 로 바꾼다. 셸 설정 또는 Claude Code settings.json 의 env (자동으로 고치지 않는다)`);
      const short = ['OPUS', 'SONNET', 'HAIKU', 'FABLE'].map((f) => `ANTHROPIC_DEFAULT_${f}_MODEL`)
        .filter((k) => !missKeys.has(k))
        .filter((k) => { const v = process.env[k] || env[k]; return v && !/\[1m\]$/i.test(v) && kitLib.window1m(v); });
      add(short.length ? WARN : OK, '컨텍스트 창 (게이트웨이)', short.length ? `${short.join(' · ')} 에 [1m] 이 없어 Claude Code 가 200k 로 봅니다` : '1M 모델에 [1m] 을 붙여 넘김',
        short.length ? `그 값 끝에 [1m] 을 붙인다 (예: ${short[0]}='<게이트웨이 모델>[1m]'). 셸 설정 또는 ~/.claude/settings.json 의 env` : undefined);
      // 반대로 1M 이 아닌 모델(옛 Haiku 등)에 [1m] 이 붙으면 그 모델을 쓰는 도구(웹 문서 읽기 · 요약)가 「모델이 없거나 권한 없음」으로 실패한다
      const over = ['OPUS', 'SONNET', 'HAIKU', 'FABLE'].map((f) => `ANTHROPIC_DEFAULT_${f}_MODEL`)
        .filter((k) => !missKeys.has(k)) // 목록에 없는 값이면 위 FAIL 하나로 (고칠 값에 [1m] 판단이 들어 있다)
        .filter((k) => { const v = process.env[k] || env[k]; return v && /\[1m\]$/i.test(v) && kitLib.claudeKey && kitLib.claudeKey(v.replace(/\[1m\]$/i, '')) && !kitLib.window1m(v.replace(/\[1m\]$/i, '')); });
      if (over.length) add(WARN, '컨텍스트 창 (게이트웨이)', `${over.join(' · ')} 는 1M 모델이 아닌데 [1m] 이 붙어 있습니다. 그 모델을 쓰는 도구(웹 문서 읽기 등)가 「모델이 없거나 권한 없음」으로 실패합니다`,
        `그 값 끝의 [1m] 을 뗀다. 셸 설정 또는 ~/.claude/settings.json 의 env`);
    }
    for (const w of m.runWarnings) add(WARN, '역할 모델', w, 'kedovi ai refresh 또는 kedovi models');
  }
} catch (e) { add(WARN, 'AI 연결 방식', `확인 실패: ${e.message}`); }

// 4. 훅 경로
const hooksPath = git(ROOT, ['config', 'core.hooksPath']);
const hasHooks = fs.existsSync(path.join(ROOT, '.githooks'));
if (hasHooks) add(hooksPath === '.githooks' ? OK : FAIL, 'git core.hooksPath', hooksPath || '미설정', 'kedovi install (또는 git config core.hooksPath .githooks)');

/** 원격 기본 브랜치와 원격 브랜치 목록. 원격에 물어보고(10초), 안 되면 이 PC 의 origin/HEAD 기록 */
function remoteBranches(dir) {
  const r = spawnSync('git', ['-C', dir, 'ls-remote', '--symref', 'origin', 'HEAD', 'refs/heads/*'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes' } });
  if (r.status === 0) {
    const head = (/^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(r.stdout) || [])[1] || '';
    const heads = new Set([...r.stdout.matchAll(/\trefs\/heads\/(\S+)$/gm)].map((m) => m[1]));
    return { head, heads, live: true, why: head ? '' : '원격이 HEAD 를 알려 주지 않음' };
  }
  const local = (git(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']) || '').replace(/^origin\//, '');
  const heads = new Set((git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']) || '').split('\n').map((x) => x.replace(/^origin\//, '')).filter((x) => x && x !== 'HEAD' && x !== 'origin'));
  return { head: local, heads, live: false, why: `원격에 닿지 못함${local ? '' : ' · 이 PC 에 origin/HEAD 기록도 없음'}` };
}

/** 기본 브랜치 바꾸기 · 낡은 브랜치 지우기 안내 (GitLab · GitHub · 그 밖) */
function branchFix(r, origin, dev) {
  const gl = r.gitlab && r.gitlab.host;
  const gh = /github\.com[:/]/.test(origin);
  const setDefault = gl
    ? `GitLab ${r.name}: Settings > Repository > Branch defaults 에서 Default branch 를 ${dev} 로 (API: PUT /projects/${r.gitlab.projectId}?default_branch=${dev}). 이 PC 기록도 맞추기: git -C ${repoRel(r)} remote set-head origin -a`
    : gh ? `GitHub ${r.name}: gh repo edit <owner/repo> --default-branch ${dev} (또는 Settings > General > Default branch). 이 PC 기록도 맞추기: git -C ${repoRel(r)} remote set-head origin -a`
      : `${r.name}: 저장소 설정에서 기본 브랜치를 ${dev} 로 바꾼 뒤 git -C ${repoRel(r)} remote set-head origin -a`;
  const removeOld = (b) => `${r.name} 의 ${b}: 필요 없으면 ${gl ? '보호 해제(Settings > Repository > Protected branches) 뒤 ' : gh ? '브랜치 보호 규칙을 확인한 뒤 ' : ''}git -C ${repoRel(r)} push origin --delete ${b} (기본 브랜치를 먼저 ${dev} 로 바꾼다. 상시로 둘 브랜치면 vars.${gh ? 'github' : 'gitlab'}.persistentBranches 에 적는다)`;
  return { setDefault, removeOld };
}

/** 이 repo 가 workspace.json 과 다른 그룹 위치(repos/<이름> · repos/<다른 그룹>/<이름>)에 있으면 그 경로 */
function otherPlace(r) {
  const cands = [`repos/${r.name}`];
  try { for (const e of fs.readdirSync(path.join(ROOT, 'repos'), { withFileTypes: true })) if (e.isDirectory() && !ws.repos.some((x) => !x.group && x.name === e.name)) cands.push(`repos/${e.name}/${r.name}`); } catch { /* repos/ 없음 */ }
  return cands.find((c) => c !== repoRel(r) && fs.existsSync(path.join(ROOT, c)) && !(c === `repos/${r.name}` && ws.repos.some((x) => x.group === r.name))) || null;
}

// 5. repo — 워크스페이스 안 repos/<이름> · repos/<그룹>/<이름> (remote 는 clone, path 는 링크)
for (const r of ws.repos) {
  const rel = repoRel(r);
  const dir = path.join(ROOT, rel);
  // 그룹을 바꿨는데 폴더는 옛 위치에 있으면: 옮기라고 알린다 (kedovi repo move 를 안 거친 팀원 PC)
  const other = !fs.existsSync(dir) ? otherPlace(r) : null;
  if (other) { add(FAIL, `repo: ${r.name}`, `그룹 폴더와 실제 위치가 다름: ${other} 에 있음 (workspace.json 은 ${rel})`, `mkdir -p ${path.posix.dirname(rel)} && mv ${other} ${rel} (또는 옛 폴더를 지우고 kedovi install)`); continue; }
  if (!fs.existsSync(dir) && r.local && !r.remote && !r.path) { add(WARN, `repo: ${r.name}`, '아직 원격 없음 (다른 팀원이 새로 만든 repo)', '만든 사람이 origin 을 달고 push 한 뒤 workspace.json 을 push 하면 git pull → kedovi install'); continue; }
  if (!fs.existsSync(dir)) { add(FAIL, `repo: ${r.name}`, `${rel} 에 없음`, `kedovi install${r.remote ? ` (git clone ${r.remote} ${rel})` : ''}`); continue; }
  if (r.kind === 'docs' && r.mdPath && !fs.existsSync(path.join(dir, r.mdPath))) add(WARN, `repo: ${r.name}`, `md 사본 폴더 ${r.mdPath} 없음`, '기획 repo 에 md 사본을 두거나 workspace.json mdPath 를 고친다');
  const inRepo = git(dir, ['rev-parse', '--is-inside-work-tree']) === 'true';
  add(inRepo || r.kind !== 'code' ? OK : FAIL, `repo: ${r.name}`, inRepo ? `${rel} (${r.kind || 'code'})` : `${rel}: git 저장소 아님`, 'git clone 으로 받았는지 확인');
  if (inRepo && r.local && !r.remote && !git(dir, ['remote', 'get-url', 'origin'])) add(WARN, `repo: ${r.name}`, '원격 없음: 팀원이 받을 수 없다', `원격 저장소를 만들고 git -C ${rel} remote add origin <주소> && git -C ${rel} push -u origin HEAD → kedovi sync 가 workspace.json 에 기록`);
}

// 5-1. 원격 기본 브랜치 · 낡은 main/master (브랜치 규칙이 있는 워크스페이스: vars.branch). 안내만 하고 바꾸거나 지우지 않는다
const branchVars = (ws.vars && ws.vars.branch) || null;
if (branchVars && branchVars.develop) {
  const dev = branchVars.develop;
  const permanent = new Set([dev, branchVars.release, ...(((ws.vars.gitlab || {}).persistentBranches) || []), ...(((ws.vars.github || {}).persistentBranches) || [])].filter(Boolean));
  for (const r of ws.repos.filter((x) => (x.kind || 'code') === 'code')) {
    const dir = path.join(ROOT, repoRel(r));
    if (!fs.existsSync(dir) || git(dir, ['rev-parse', '--is-inside-work-tree']) !== 'true') continue;
    const origin = git(dir, ['remote', 'get-url', 'origin']);
    if (!origin) continue;
    const st = remoteBranches(dir);
    if (!st.head) { add(WARN, `기본 브랜치: ${r.name}`, `원격 기본 브랜치를 읽지 못함 (${st.why})`, ''); continue; }
    const how = branchFix(r, origin, dev);
    const src = st.live ? '' : ' (네트워크가 안 돼 이 PC 의 기록으로 봄)';
    if (st.head !== dev) add(WARN, `기본 브랜치: ${r.name}`, `원격 기본 브랜치: ${st.head}${src}. 통합 브랜치(${dev})가 아니라서 repo 첫 화면 · clone · MR 대상 기본값이 이 브랜치를 본다`, how.setDefault);
    else add(OK, `기본 브랜치: ${r.name}`, `${dev}${src}`);
    // 영구 브랜치가 아닌 main · master 가 원격에 남아 통합 브랜치보다 뒤처졌으면 (고유 커밋 수와 함께)
    for (const b of ['main', 'master'].filter((x) => !permanent.has(x) && st.heads.has(x) && st.heads.has(dev))) {
      const cnt = (range) => { const n = parseInt(git(dir, ['rev-list', '--count', range]), 10); return Number.isFinite(n) ? n : null; };
      const behind = cnt(`origin/${b}..origin/${dev}`);
      const only = cnt(`origin/${dev}..origin/${b}`);
      if (behind == null || only == null) { add(WARN, `낡은 브랜치: ${r.name} ${b}`, `원격에 영구 브랜치가 아닌 ${b} 있음 (커밋 비교는 git -C ${repoRel(r)} fetch 뒤)`, how.removeOld(b)); continue; }
      if (!behind) continue;
      const last = git(dir, ['log', '-1', '--format=%cs', `origin/${b}`]);
      add(WARN, `낡은 브랜치: ${r.name} ${b}`, `영구 브랜치가 아닌 ${b}: ${dev} 보다 ${behind}커밋 뒤처짐 · ${b} 에만 있는 커밋 ${only}개 · 마지막 커밋 ${last || '?'}${only ? ` (지우기 전에 git -C ${repoRel(r)} log origin/${dev}..origin/${b} 로 고유 커밋을 확인)` : ''}`, how.removeOld(b));
    }
  }
}

// 워크스페이스 repo 공개 여부: 작업 기록(handoffs/) · workspace.json 이 올라가므로 비공개여야 한다 (로그인 없이 받아지면 공개)
try {
  const origin = git(ROOT, ['remote', 'get-url', 'origin']);
  const pub = origin ? require('../lib/visibility').isPublic(origin) : null;
  if (pub === true) add(WARN, '워크스페이스 repo 공개 여부', `공개 repo (${origin}): handoffs/ 작업 기록 · workspace.json 이 누구에게나 보인다`, 'GitLab · GitHub 저장소 설정에서 비공개(Private)로 바꾼다');
  else if (pub === false) add(OK, '워크스페이스 repo 공개 여부', '비공개');
} catch { /* 옛 워크스페이스 (visibility.js 없음) */ }

// 6. kit check (생성물 = 정본)
const kit = path.join(ROOT, 'bin', 'kit.js');
if (fs.existsSync(kit)) {
  const r = spawnSync('node', [kit, 'check'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  const msg = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').filter(Boolean);
  const result = msg.find((l) => /^✔ check/.test(l)) || msg.find((l) => /^✖/.test(l)); // 경고가 여러 줄이라 결과 줄을 골라 낸다
  add(r.status === 0 ? OK : FAIL, 'kit check', (result || (r.status === 0 ? 'OK' : msg[0] || '실패')).replace(/^[✔✖]\s*(check:\s*)?/, ''), 'node bin/kit.js sync 후 다시 확인 (생성 파일을 손으로 고쳤다면 정본 packs/ 를 고친다)');
}

// 7. 죽은 참조
try {
  const { findDeadRefs } = require('./check-refs');
  const dead = findDeadRefs(ROOT);
  add(dead.length ? WARN : OK, '죽은 참조', dead.length ? `${dead.length}건` : '0건', 'node packs/core/bin/check-refs.js 로 목록 확인');
} catch (e) { add(WARN, '죽은 참조', `검사 실패: ${e.message}`); }

// 7-1. 메모리 (Claude Code 세션 나무 · 주인 없이 남은 브라우저 · MCP · Docker VM)
try {
  const P = require('../lib/procmem');
  const snap = P.snapshot();
  if (snap) {
    const limit = Number((((ws.vars || {}).session) || {}).memoryWarnGB || 8);
    const ls = P.lines(snap);
    const over = limit > 0 && snap.total > limit * P.GB;
    add(over || snap.orphans.length ? WARN : OK, '메모리', `${ls[0]}${ls.length > 1 ? `\n${ls.slice(1).map((l) => `      ${l.trim()}`).join('\n')}` : ''}`,
      over || snap.orphans.length ? `안 쓰는 Claude 세션 · 대기 팀원을 닫는다${snap.orphans.length ? ` · 남은 브라우저 · MCP 는 kill <pid>` : ''} (기준 vars.session.memoryWarnGB = ${limit}GB)` : '');
  }
} catch (e) { add(WARN, '메모리', `확인 실패: ${e.message}`); }

// 8. 에이전트 CLI
const clis = [['claude', 'Claude Code'], ['codex', 'Codex']].map(([cmd, label]) => ({ cmd, label, at: which(cmd) }));
for (const c of clis) add(c.at ? OK : WARN, `CLI: ${c.label}`, c.at ? (version(c.at) || c.at) : '설치 안 됨 (선택)', `${c.label} 를 쓸 거면 설치`);
if (!clis.some((c) => c.at)) add(FAIL, '에이전트 CLI', 'claude·codex 둘 다 없음', 'Claude Code 또는 Codex 중 하나 이상 설치');

// 8-1. Claude Code 플러그인 — MCP 서버를 띄우는 실행 파일(bun · uvx 등)이 없으면 플러그인이 조용히 연결에 실패한다
const RUNTIME_HINT = {
  bun: process.platform === 'win32' ? 'powershell -c "irm bun.sh/install.ps1 | iex"' : 'curl -fsSL https://bun.sh/install | bash',
  uvx: 'uv 설치 (https://docs.astral.sh/uv/)', uv: 'uv 설치 (https://docs.astral.sh/uv/)',
  npx: 'Node.js 설치', node: 'Node.js 설치', deno: 'Deno 설치 (https://deno.com)', docker: 'Docker 설치',
};
try {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude');
  const installed = JSON.parse(fs.readFileSync(path.join(home, 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {};
  const inside = (p) => { const rel = path.relative(ROOT, p || ''); return !rel.startsWith('..') && !path.isAbsolute(rel); };
  for (const [name, entries] of Object.entries(installed)) {
    let shown = false; // user · project 두 곳에 설치돼 있어도 한 줄
    for (const e of [].concat(entries || [])) {
      if (shown) break;
      if (e.scope && e.scope !== 'user' && !inside(e.projectPath)) continue; // 다른 프로젝트에만 설치된 것
      let servers = {};
      try { servers = JSON.parse(fs.readFileSync(path.join(e.installPath, '.mcp.json'), 'utf8')).mcpServers || {}; } catch { continue; }
      const missing = [...new Set(Object.values(servers).map((v) => v && v.command).filter((c) => c && !/[\\/$]/.test(c)))].filter((c) => !which(c));
      const short = name.split('@')[0];
      if (missing.length) add(WARN, `플러그인: ${short}`, `실행에 필요한 ${missing.join(', ')} 이(가) PATH 에 없음 (MCP 서버가 뜨지 않는다)`, `${missing.map((c) => RUNTIME_HINT[c] || `${c} 설치`).join(' · ')} → 에이전트 다시 시작`);
      else if (Object.keys(servers).length) add(OK, `플러그인: ${short}`, `실행 파일 있음 (${Object.values(servers).map((v) => v.command).join(', ')})`);
      shown = true;
    }
  }
} catch { /* 플러그인 없음 */ }

// 8-2. 양방향 텔레그램 채널 (켠 PC 만)
try {
  const nl = require('../lib/notify');
  if (nl.channelOn && nl.channelOn(ROOT)) {
    const chk = nl.channelCheck(ROOT, which);
    const access = nl.channelAccess(ROOT);
    if (!chk.ready) add(WARN, '텔레그램 채널', `켜져 있지만 ${chk.problems.join(' · ')}. kedovi start 가 채널 없이 시작한다`, 'kedovi notify my channel on 을 다시 실행');
    else if (nl.channelPluginScope(ROOT) === 'user') add(WARN, '텔레그램 채널', '플러그인이 user 범위라 이 PC 의 모든 Claude Code 세션이 텔레그램 서버를 띄운다', 'kedovi notify my channel on 을 다시 실행 (이 워크스페이스 전용 local 로 바꾼다)');
    else if (nl.channelTokenUsedElsewhere && nl.channelTokenUsedElsewhere(ROOT, nl.channelToken(ROOT))) add(WARN, '텔레그램 채널', `같은 봇을 다른 곳에서도 받는다 (${nl.channelTokenUsedElsewhere(ROOT, nl.channelToken(ROOT)).dir}). 세션끼리 서로 끊는다`, 'kedovi notify my channel on 을 다시 실행 (플러그인 기본 폴더의 같은 토큰은 끈다)');
    else add(OK, '텔레그램 채널', `켜짐 (${nl.channelDir(ROOT)}) · 허용 ${access ? `${access.dmPolicy} ${(access.allowFrom || []).length}명` : '페어링'}`);
  }
} catch { /* 옛 워크스페이스 */ }

// 비밀값: 팩이 선언한 것(pack.json secrets)이 있는지 · 옛 파일에서 읽는지 · 실제 확인(권한 부족 · 만료 임박). 값은 출력하지 않는다
try {
  const S = require('../lib/secrets');
  for (const d of S.declared(ROOT, ws.packs || [])) {
    const g = S.get(d.name, { root: ROOT });
    const setCmd = `터미널에서 kedovi secret set ${d.name}${d.scope === 'global' ? ' --global' : ''} (숨김 입력)`;
    if (!g) { if (!d.optional) add(WARN, `비밀값 ${d.name}`, `없음 (${d.purpose || d.pack})`, setCmd); continue; }
    if (!d.test) { add(OK, `비밀값 ${d.name}`, g.label); continue; }
    const r = spawnSync(process.execPath, [path.join(__dirname, 'secret.js'), 'test', d.name], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
    const lines = String(r.stdout || '').trim().split('\n').filter(Boolean);
    const detail = (lines[0] || '확인 못 함').replace(/^[✔⚠✖-]\s*/, '').replace(`${d.name} ← `, '');
    const extra = lines.slice(1).map((l) => l.replace(/^\s*⚠\s*/, '')).join(' · ');
    add(r.status === 0 ? (g.source === 'legacy' ? WARN : OK) : WARN, `비밀값 ${d.name}`, extra ? `${detail} · ${extra}` : detail,
      r.status === 0 ? (g.source === 'legacy' ? 'kedovi secret import (옛 파일 → OS 저장소)' : '')
        : /주소를 모릅니다/.test(detail) ? `workspace.json repos 에 "gitlab": { "host" } 를 두거나 GITLAB_URL 환경변수 후 kedovi secret test ${d.name}`
          : /401|만료|취소|권한 부족/.test(`${detail} ${extra}`) ? `${setCmd} (새 토큰${d.needs && d.needs.length ? `, 권한 ${d.needs.join(', ')}` : ''}) 후 kedovi secret test ${d.name}`
            : `kedovi secret test ${d.name} 로 다시 확인 (네트워크 · 주소)`);
  }
} catch { /* 옛 워크스페이스 */ }

// 8-3. 권장 플러그인 · MCP (README 「플러그인 · MCP · 도구」 와 같은 목록). 없으면 알리기만 한다
try {
  const os = require('os');
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  let plugins = {};
  try { plugins = JSON.parse(fs.readFileSync(path.join(home, 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {}; } catch { /* 없음 */ }
  const hasPlugin = (re) => Object.keys(plugins).some((k) => re.test(k));
  if (which('claude')) add(hasPlugin(/claude-mermaid/) ? OK : WARN, '권장: claude-mermaid', hasPlugin(/claude-mermaid/) ? '설치됨' : '없음 (대화 중 그림을 텍스트로 그린다)', 'kedovi prefs mermaid install');
  // Playwright MCP: 사용자 · 프로젝트 MCP 설정, 플러그인 어디든
  const mcpNames = [];
  for (const f of [path.join(os.homedir(), '.claude.json'), path.join(ROOT, '.mcp.json')]) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      mcpNames.push(...Object.keys(j.mcpServers || {}));
      for (const pr of Object.values(j.projects || {})) mcpNames.push(...Object.keys((pr && pr.mcpServers) || {}));
    } catch { /* 없음 */ }
  }
  const front = (ws.repos || []).some((r) => /react|next|vue|svelte|angular|frontend/i.test(JSON.stringify(r.stacks || r.stack || r.layer || '')));
  const pw = mcpNames.some((n) => /playwright/i.test(n)) || hasPlugin(/playwright/);
  if (front || pw) add(pw ? OK : WARN, '권장: Playwright MCP', pw ? '있음' : '없음 (화면 확인 · 접근성 실행 검사를 못 한다)', 'claude mcp add playwright -- npx @playwright/mcp@latest');
} catch { /* 정보 항목 */ }

// 9. 개인 지침·핸드오프 (정보)
add(OK, '개인 지침 .agents/local.md', fs.existsSync(path.join(ROOT, '.agents', 'local.md')) ? '있음' : '없음 (선택)');
if (id) {
  const hdir = path.join(ROOT, 'handoffs', id);
  add(OK, `handoffs/${id}/`, fs.existsSync(path.join(hdir, 'LATEST.md')) ? 'LATEST.md 있음' : '없음 (첫 사용이면 정상)');
}

// 출력
const mark = { ok: '✓', warn: '△', fail: '✗' };
console.log(`\n=== 워크스페이스 doctor. ${ws.project && (ws.project.title || ws.project.name) || path.basename(ROOT)} ===`);
console.log(`루트: ${ROOT}\n플랫폼: ${process.platform}\n`);
for (const c of checks) console.log(`  ${mark[c.level]} ${c.name}${c.detail ? '. ' + c.detail : ''}`);
const fails = checks.filter((c) => c.level === FAIL);
const warns = checks.filter((c) => c.level === WARN);
console.log(`\n총 ${checks.length}건: 정상 ${checks.length - fails.length - warns.length} · 주의 ${warns.length} · 문제 ${fails.length}`);
const fixes = [...new Set([...fails, ...warns].filter((c) => c.fix).map((c) => `${mark[c.level]} ${c.fix}`))];
if (fixes.length) { console.log('\n조치 안내:'); fixes.forEach((f) => console.log(`  ${f}`)); }
process.exit(fails.length ? 1 : 0);
