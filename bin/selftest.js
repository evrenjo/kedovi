#!/usr/bin/env node
/**
 * 킷 자체 점검 — 팩·생성기·템플릿을 고친 뒤 커밋 전에 돌린다 (npm test).
 *
 *   1. 모든 팩의 *.test.js
 *   2. 임시 폴더에 워크스페이스 2종 생성 (신규: 전체 스택 팩 / 차세대: 레거시 포함) → check · 죽은 참조
 *   3. 금지 문자열 — 특정 프로젝트 이름, 스킬 본문의 Claude 전용 도구 이름
 *
 * 실패가 하나라도 있으면 exit 1. 네트워크·에이전트 CLI 는 쓰지 않는다.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const KIT = path.resolve(__dirname, '..');
// git 2.55+ 는 커밋 뒤 maintenance 를 백그라운드로 돌려 느슨한 객체를 pack 으로 묶는다. 커밋 직후 clone 하는 검사와 경합하므로 테스트가 띄우는 git 전부에서 끈다
{
  const n = Number(process.env.GIT_CONFIG_COUNT || 0);
  process.env[`GIT_CONFIG_KEY_${n}`] = 'maintenance.auto';
  process.env[`GIT_CONFIG_VALUE_${n}`] = 'false';
  process.env.GIT_CONFIG_COUNT = String(n + 1);
}
// 알림 격리: 테스트가 띄우는 훅 · 도구가 이 PC 의 실제 텔레그램 봇(~/.config/kedovi/telegram.env)으로 보내지 않게 한다.
// 빈 설정 폴더 · 봇 변수 지우기 · 텔레그램 주소를 닫힌 로컬 포트로 (실수로 보내도 밖으로 나가지 않는다)
// 금지 낱말 목록은 이 PC 의 실제 설정 폴더에서 읽는다 (아래에서 설정 폴더를 임시 폴더로 바꾸기 전에 기억)
const REAL_CONFIG_DIR = process.env.KEDOVI_CONFIG_DIR || path.join(require('os').homedir(), '.config', 'kedovi');
const notifyHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kedovi-selftest-config-'));
process.env.KEDOVI_CONFIG_DIR = notifyHome;
delete process.env.CLAUDE_CODE_BRIDGE_SESSION_ID; delete process.env.KEDOVI_CHANNEL; delete process.env.KEDOVI_DELEGATED; process.env.KEDOVI_REMOTE_CONTROL = '0'; // 리모트 컨트롤 세션에서 돌려도 같게 (세션 파일을 읽지 않는다)
process.env.KEDOVI_TELEGRAM_API = 'http://127.0.0.1:9';
process.env.KEDOVI_IDLE_SECONDS = '100000'; // PC 앞이면 알림을 건너뛰므로, 테스트는 자리에 없는 것으로
for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_TEAM_BOT_TOKEN', 'KEDOVI_CHANNEL']) delete process.env[k];
const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 180000 });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}
const lastLine = (s) => s.split('\n').filter(Boolean).pop() || '';

function walk(dir, pred, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'fixtures'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

// 1. 팩 테스트
for (const t of walk(path.join(KIT, 'packs'), (p) => p.endsWith('.test.js'))) {
  const r = run(process.execPath, [t], path.dirname(t));
  record(`test ${path.relative(KIT, t)}`, r.ok, r.ok ? '' : lastLine(r.out));
}

// 2. 워크스페이스 생성 → check → 죽은 참조
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-selftest-'));
// 이 PC 의 워크스페이스 목록(~/.kedovi)을 건드리지 않게 — 시험이 띄우는 모든 kedovi 이 임시 목록을 쓴다 (따로 KEDOVI_HOME 을 주는 시험은 그 값)
if (!process.env.KEDOVI_HOME) process.env.KEDOVI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-selftest-home-'));
const legacy = path.join(tmp, 'legacy-src');
fs.mkdirSync(path.join(legacy, 'src'), { recursive: true });
fs.writeFileSync(path.join(legacy, 'src', 'PGM01.cbl'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. PGM01.\n');
const packs = fs.readdirSync(path.join(KIT, 'packs')).filter((n) => fs.existsSync(path.join(KIT, 'packs', n, 'pack.json')) && !['core', 'modernization'].includes(n));

// 코드 repo 픽스처 — 스택 감지가 되도록 최소 파일만 (네트워크 없이 로컬 폴더 링크)
const fixture = (name, files) => {
  const dir = path.join(tmp, name);
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), body); }
  return dir;
};
const api = fixture('app-api', { 'build.gradle': "plugins { id 'org.springframework.boot' version '3.5.5' }\n", 'src/main/resources/application.yml': 'spring.datasource.url: jdbc:postgresql://db/app\n' });
// 멀티모듈 — 한 repo 에 api/(Spring)·client/(React). 스택마다 모듈 경로가 규칙 표에 붙어야 한다
const mono = fixture('app-mono', { 'settings.gradle': "include 'api'\n", 'api/build.gradle': "plugins { id 'org.springframework.boot' version '3.5.5' }\n", 'client/package.json': '{"dependencies":{"react":"^19"}}' });
const web = fixture('app-web', { 'package.json': '{"dependencies":{"react":"^19"}}' });
const ng = fixture('app-ng', { 'package.json': '{"dependencies":{"@angular/core":"^18"}}' });
// 협업 도구 판단용 origin — api 는 GitHub, web 은 GitLab (주소만 두고 네트워크는 안 쓴다)
const withOrigin = (dir, url) => { spawnSync('git', ['init', '-q', dir]); spawnSync('git', ['-C', dir, 'remote', 'add', 'origin', url]); };
withOrigin(api, 'https://github.com/acme/app-api.git');
withOrigin(web, 'https://gitlab.example.com/acme/app-web.git');
const issues = fixture('app-issue', { 'README.md': '# 이슈\n' });
withOrigin(issues, 'https://gitlab.example.com/acme/app-issue.git');
// 모바일·워치·TV — layer 공통 팩이 붙는지 (Wear OS 매니페스트는 Android 로도 잡혀 mobile 도 받는다)
const mobile = fixture('app-mobile', { 'android/app/src/main/AndroidManifest.xml': '<manifest package="x"/>' });
const watch = fixture('app-watch', { 'wear/src/main/AndroidManifest.xml': '<manifest><uses-feature android:name="android.hardware.type.watch"/></manifest>' });
const tv = fixture('app-tv', { 'config.xml': '<widget xmlns:tizen="http://tizen.org/ns/widgets"/>' });
// 인프라: Dockerfile · 매니페스트 · 차트 · IaC · 플레이북 (infra 계층 팩 · infra 역할)
const infra = fixture('app-infra', { 'Dockerfile': 'FROM node:22\n', 'compose.yaml': 'services:\n  web:\n    image: x\n', 'deploy/app.yaml': 'apiVersion: apps/v1\nkind: Deployment\n', 'chart/Chart.yaml': 'apiVersion: v2\nname: x\n', 'tf/main.tf': 'terraform {}\n', 'ansible/site.yml': '- hosts: web\n  tasks: []\n' });
const code = [api, web, ng, mobile, watch, tv, infra].join(',');
const cases = [
  { name: 'new', args: ['--type', 'new', '--code', code, '--issues', issues],
    stacks: { 'app-api': ['spring', 'postgres'], 'app-web': ['react'], 'app-ng': ['angular'], 'app-mobile': ['android'], 'app-watch': ['android', 'wearos'], 'app-tv': ['tizen'], 'app-infra': ['docker', 'docker-compose', 'kubernetes', 'helm', 'terraform', 'ansible'] } },
  { name: 'modernization', args: ['--type', 'modernization', '--code', api, '--legacy', legacy, '--packs', 'github'] },
  { name: 'enhancement', args: ['--type', 'enhancement', '--code', `${api},${mono}`, '--packs', 'gitlab'], modules: true },
  { name: 'operation', args: ['--type', 'enhancement', '--code', web] },
  { name: 'consulting', args: ['--type', 'consulting', '--legacy', legacy] },
];
for (const c of cases) {
  const dir = path.join(tmp, c.name);
  const init = run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--title', c.name, ...c.args], tmp);
  record(`init ${c.name}`, init.ok && fs.existsSync(path.join(dir, 'AGENTS.md')), init.ok ? '' : lastLine(init.out));
  if (!fs.existsSync(path.join(dir, 'workspace.json'))) continue;
  const check = run(process.execPath, ['bin/kit.js', 'check'], dir);
  record(`check ${c.name}`, check.ok, lastLine(check.out.split('\n').filter((l) => !l.startsWith('⚠')).join('\n')));
  const refs = run(process.execPath, ['packs/core/bin/check-refs.js', '--fail'], dir);
  record(`dead-refs ${c.name}`, refs.ok, lastLine(refs.out));
  if (c.name === 'new') {
    // 템플릿 .gitignore 는 점 없는 gitignore 로 둔다 (npm pack 이 .gitignore 를 빼서 설치본에서 사라졌던 결함). 복사되며 이름이 돌아오고 기본 줄이 들어가야 한다
    const giLines = fs.existsSync(path.join(dir, '.gitignore')) ? fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').split('\n') : [];
    const giBase = ['node_modules/', 'scripts/'].every((l) => giLines.includes(l));
    const dotted = [...walk(path.join(KIT, 'templates'), (p) => path.basename(p) === '.gitignore'), ...walk(path.join(KIT, 'packs'), (p) => path.basename(p) === '.gitignore')];
    record('템플릿 .gitignore (npm 설치본에서도 복사)', giBase && dotted.length === 0, `기본 줄 ${giBase} · 점 붙은 템플릿 ${dotted.length}개`);
    const cl = fs.existsSync(path.join(dir, '.claude', 'agents')) ? fs.readdirSync(path.join(dir, '.claude', 'agents')).length : 0;
    const cx = fs.existsSync(path.join(dir, '.codex', 'agents')) ? fs.readdirSync(path.join(dir, '.codex', 'agents')).length : 0;
    // 위임 역할은 파일 대신 PC 별 지침의 위임 표에 오른다 — 파일 + 위임 = 역할 전부
    const rows = (f) => { try { return (fs.readFileSync(path.join(dir, f), 'utf8').match(/^\| .+\(`[a-z]+`\) \|/gm) || []).length; } catch { return 0; } };
    const dcl = rows('CLAUDE.local.md');
    const dcx = rows('AGENTS.override.md');
    record(`팀 에이전트 파일 ${c.name}`, cl + dcl >= 6 && cx + dcx >= 6, `claude ${cl}+위임 ${dcl} · codex ${cx}+위임 ${dcx}`);
    // 계층 팩 역할: repo 스택으로 붙은 db · infra 팩이 dba · infra 역할을 더하고, 역할 grade(high)대로 모델을 받는다. project 팩의 같은 이름 역할이 이긴다
    {
      const roleModel = (role) => { try { return (fs.readFileSync(path.join(dir, '.claude', 'agents', `${role}.md`), 'utf8').match(/^model: (.+)$/m) || [])[1]; } catch { return null; } };
      const local = fs.readFileSync(path.join(dir, 'CLAUDE.local.md'), 'utf8');
      const rowsOk = /\| DBA \(`dba`\) \| high \|/.test(local) && /\| 인프라 \(`infra`\) \| high \|/.test(local);
      const gm = (g) => { const v = require(path.join(KIT, 'packs', 'core', 'models.json')).profiles.standard.grades.claude[g]; return typeof v === 'string' ? v : v.model; };
      const gradeOk = roleModel('dba') === gm('high') && roleModel('infra') === gm('high');
      const agentsMd = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
      const ruleOk = /infra--10-infra-safety/.test(agentsMd);
      const over = path.join(dir, 'packs', 'project', 'agents', 'dba.md');
      fs.mkdirSync(path.dirname(over), { recursive: true });
      fs.writeFileSync(over, '---\nname: dba\ntitle: DBA (프로젝트)\ndescription: 프로젝트 DBA.\naccess: read-only\ngrade: low\n---\n\n# 프로젝트 DBA\n');
      run(process.execPath, ['bin/kit.js', 'sync'], dir);
      const overOk = roleModel('dba') === gm('low') && /DBA \(프로젝트\)/.test(fs.readFileSync(path.join(dir, 'CLAUDE.local.md'), 'utf8'));
      fs.unlinkSync(over);
      run(process.execPath, ['bin/kit.js', 'sync'], dir);
      record('계층 팩 역할 (db dba · infra infra)', rowsOk && gradeOk && ruleOk && overOk, `팀 구성 표 ${rowsOk} · grade 모델 ${gradeOk} (${roleModel('dba')}) · infra 룰 ${ruleOk} · project 가 덮음 ${overOk}`);
    }
    const kitLib = require(path.join(KIT, 'bin', 'kit.js'));
    const audit = kitLib.auditModels(dir, { agents: { roles: { tester: { codex: 'gpt-5.5' } } } }, '2026-09-29');
    // 날짜 없는 퇴역(공지에 날짜 없이 이미 지원 중단)은 error 로, 문구에 undefined 가 없어야 한다
    const undated = kitLib.auditModels(dir, { agents: { roles: { tester: { codex: 'gpt-5.3-codex' } } } }, '2026-09-29');
    const undatedOk = undated.length === 1 && undated[0].level === 'error' && !/undefined/.test(undated[0].message);
    record('퇴역 모델 경고', audit.length === 1 && audit[0].replacement === 'gpt-6.1-sol' && undatedOk, [...audit, ...undated].map((x) => x.message).join(' | '));
    const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
    const hidden = JSON.stringify(settings.attribution) === JSON.stringify({ commit: '', pr: '', sessionUrl: false });
    // repos/app-api 는 git 저장소 — commit-msg 훅이 들어가 AI 서명 줄을 지우는지 실제 커밋으로 본다
    const repo = path.join(dir, 'repos', 'app-api');
    const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
    git('commit', '-q', '--allow-empty', '-m', 'feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nCo-authored-by: Codex <noreply@openai.com>');
    const msg = git('log', '-1', '--format=%B').stdout.trim();
    const wsHook = fs.existsSync(path.join(dir, '.githooks', 'commit-msg'));
    record('AI 서명 — Claude 설정 · commit-msg 훅', hidden && msg === 'feat: x' && wsHook, `설정 ${hidden} · 커밋 ${JSON.stringify(msg)} · 워크스페이스 훅 ${wsHook}`);
    // 모델 프로필 — 기본 표준 → 이 PC 절약 → 팀 넉넉 + 역할 직접 지정. 생성된 에이전트 파일·공유 설정으로 본다
    const agentModel = (role) => (fs.readFileSync(path.join(dir, '.claude', 'agents', `${role}.md`), 'utf8').match(/^model: (.+)$/m) || [])[1];
    const codexModel = () => (fs.readFileSync(path.join(dir, '.codex', 'config.toml'), 'utf8').match(/^model = "(.+)"$/m) || [])[1];
    const got = [];
    const std = agentModel('architect') === 'opus' && agentModel('implementer') === 'opus' && agentModel('documenter') === 'haiku'
      && JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')).model === 'opusplan' && codexModel() === 'gpt-6.1-sol';
    got.push(`표준 ${std}`);
    const localFile = path.join(dir, '.agents', 'local.json');
    const localRaw = fs.existsSync(localFile) ? fs.readFileSync(localFile, 'utf8') : null;
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, JSON.stringify({ agents: { profile: 'lean' } }));
    run(process.execPath, ['bin/kit.js', 'sync'], dir);
    const lean = agentModel('architect') === 'sonnet' && JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')).model === 'opusplan';
    got.push(`이 PC 절약(공유 설정은 팀 값 유지) ${lean}`);
    if (localRaw === null) fs.rmSync(localFile); else fs.writeFileSync(localFile, localRaw);
    const wsFile = path.join(dir, 'workspace.json');
    const wsRaw = fs.readFileSync(wsFile, 'utf8');
    fs.writeFileSync(wsFile, JSON.stringify({ ...JSON.parse(wsRaw), agents: { profile: 'rich', roles: { tester: { claude: 'opus' } } } }, null, 2));
    run(process.execPath, ['bin/kit.js', 'sync'], dir);
    const effortOf = (role) => (fs.readFileSync(path.join(dir, '.claude', 'agents', `${role}.md`), 'utf8').match(/^effort: (.+)$/m) || [])[1];
    const codexEffort = (role) => (fs.readFileSync(path.join(dir, '.codex', 'agents', `${role}.toml`), 'utf8').match(/^model_reasoning_effort = "(.+)"$/m) || [])[1];
    const cross = run(process.execPath, ['packs/core/bin/cross-review.js', '--to', 'codex', '--dry-run'], dir).out || '';
    const rich = agentModel('architect') === 'opus' && effortOf('architect') === 'max' && agentModel('implementer') === 'opus' && agentModel('tester') === 'opus'
      && effortOf('implementer') === 'xhigh' && codexEffort('analyst') === 'xhigh' && codexEffort('documenter') === 'high'
      // Codex 세션 리뷰는 Claude 위임 (claude CLI 가 없는 PC 는 대체 모델 파일)
      && (!fs.existsSync(path.join(dir, '.codex', 'agents', 'reviewer.toml')) || /gpt-6\.1-sol/.test(fs.readFileSync(path.join(dir, '.codex', 'agents', 'reviewer.toml'), 'utf8')))
      && /-m gpt-6\.1-sol -c model_reasoning_effort="high"/.test(cross);
    got.push(`팀 최고(설계 Opus max·구현 Opus·교차 검토 6.1 Sol high) + 직접 지정 ${rich}`);
    fs.writeFileSync(wsFile, wsRaw);
    run(process.execPath, ['bin/kit.js', 'sync'], dir);
    // 이 PC 최고(팀 표준보다 높음)는 무시하고 팀 값을 쓴다. 상한도 팀 값(2 · 5)을 넘지 않는다. 팀이 allowHigherProfile 로 허용하면 적용
    fs.writeFileSync(localFile, JSON.stringify({ agents: { profile: 'rich', limits: { parallel: 9, total: 9 } } }));
    run(process.execPath, ['bin/kit.js', 'sync'], dir);
    const res1 = kitLib.resolveModels(dir, kitLib.loadWorkspace(dir));
    const blocked = res1.profile.blocked === 'rich' && !res1.profile.local && effortOf('architect') === 'xhigh' && res1.limits.parallel === 4 && res1.limits.total === 9;
    const hookLine = (run(process.execPath, ['packs/core/hooks/model-profile.js'], dir).out || '').trim();
    const hookBlocked = /^🎚 모델 프로필: 팀 표준 \(이 PC 값 최고 은 팀보다 높아 적용하지 않음\)/.test(hookLine);
    fs.writeFileSync(wsFile, JSON.stringify({ ...JSON.parse(wsRaw), agents: { allowHigherProfile: true } }, null, 2));
    run(process.execPath, ['bin/kit.js', 'sync'], dir);
    const res2 = kitLib.resolveModels(dir, kitLib.loadWorkspace(dir));
    const allowed = res2.profile.local === 'rich' && effortOf('architect') === 'max' && res2.limits.parallel === 4 && res2.limits.total === 9;
    fs.writeFileSync(wsFile, wsRaw);
    fs.writeFileSync(localFile, JSON.stringify({ agents: { profile: 'lean' } }));
    run(process.execPath, ['bin/kit.js', 'sync'], dir);
    const res3 = kitLib.resolveModels(dir, kitLib.loadWorkspace(dir));
    const hookLean = (run(process.execPath, ['packs/core/hooks/model-profile.js'], dir).out || '').trim();
    const leanOk = res3.limits.parallel === 2 && res3.limits.total === 5 && /^🎚 모델 프로필: 이 PC 절약 \(팀 표준 대신\) · 되돌리기 kedovi models profile team · 상한 동시 2 · 모두 5 \(팀 4 · 10\)$/.test(hookLean);
    if (localRaw === null) fs.rmSync(localFile); else fs.writeFileSync(localFile, localRaw);
    run(process.execPath, ['bin/kit.js', 'sync'], dir);
    const hookNone = (run(process.execPath, ['packs/core/hooks/model-profile.js'], dir).out || '').trim();
    got.push(`이 PC 최고 무시(상한 팀 값) ${blocked} · 허용 뒤 적용 ${allowed} · 절약 상한·시작 줄 ${leanOk} · 팀 값이면 조용 ${hookNone === ''}`);
    record('모델 프로필 (표준 · 개인 절약 · 팀 최고 + 역할 지정)', std && lean && rich, got.slice(0, 3).join(' · '));
    record('개인 프로필은 팀보다 낮게만 (상한 팀 값 이내 · 세션 시작 줄)', blocked && hookBlocked && allowed && leanOk && hookNone === '', `${got[3]} · 훅 ${hookBlocked} ${JSON.stringify(hookLine)}`);
  }
  if (c.modules) {
    const md = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    const ruleRow = (name) => md.split('\n').find((l) => l.startsWith(`| **${name}**`) && l.includes('.agents/rules/')) || '';
    const row = ruleRow('app-mono');
    const ok = row.includes('Spring (api/) · React (client/)') && row.includes('stack-spring--10-spring-baseline.md`: `api/`') && row.includes('stack-react--10-react-baseline.md`: `client/`')
      && ruleRow('app-api') !== '' && !ruleRow('app-api').includes('` — `');
    record(`멀티모듈 모듈 경로 ${c.name}`, ok, ok ? '' : row.slice(0, 200));
  }
  if (c.stacks) {
    const repos = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8')).repos;
    const got = Object.fromEntries(repos.map((r) => [r.name, r.stacks]));
    const ok = Object.entries(c.stacks).every(([k, v]) => JSON.stringify(got[k]) === JSON.stringify(v));
    record(`stacks ${c.name}`, ok, ok ? '' : JSON.stringify(got));
    const md = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    record(`repo 규칙 표 ${c.name}`, md.includes('## repo 별 작업 규칙') && md.includes('stack-spring--') && md.includes('Angular(전용 규칙 없음)'), '');
    const layerOk = ['mobile--10-mobile-baseline', 'watch--10-watch-baseline', 'tv--10-tv-baseline'].every((x) => md.includes(x));
    record(`모바일·워치·TV 공통 규칙 ${c.name}`, layerOk, layerOk ? '' : 'AGENTS.md repo 표에 layer 팩 룰이 없음');
    const skills = fs.readdirSync(path.join(dir, '.agents', 'skills'));
    record(`repo 별 협업 도구 ${c.name}`, md.includes('github--10-branch') && md.includes('gitlab--10-branch') && md.includes('## 이슈 기록 repo') && md.includes('이 프로젝트의 이슈가 아니면 여기에 쓰지 않는다') && skills.includes('mr') && skills.includes('pr'), skills.join(','));
  }
}

// kedovi list · remove <이름> — 워크스페이스에서 한 번 쓰면 목록에 오르고, 어디서든 이름으로 지운다 (목록은 임시 KEDOVI_HOME)
{
  const kedovi = (args, cwd) => {
    const r = spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, KEDOVI_HOME: path.join(tmp, 'kedovi-home') }, stdin: 'ignore' });
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
  };
  const ws = path.join(tmp, 'operation');
  kedovi(['check'], ws);
  const listed = kedovi(['list'], tmp);
  const removed = kedovi(['remove', 'operation', '--confirm', 'operation'], os.tmpdir());
  const after = kedovi(['list'], tmp);
  const giGone = !fs.existsSync(path.join(ws, '.gitignore')); // 킷이 만든 줄뿐이던 .gitignore 는 파일째 사라진다
  const ok = listed.out.includes(ws) && removed.ok && !fs.existsSync(path.join(ws, 'workspace.json')) && !after.out.includes(ws) && giGone;
  record('kedovi list · remove <이름>', ok, ok ? '' : `${lastLine(listed.out)} | ${lastLine(removed.out)} | ${lastLine(after.out)} | gitignore 제거 ${giGone}`);
}

// 3. 금지 문자열
// 목록은 repo 에 두지 않는다 (목록 자체가 숨길 이름을 드러낸다): 환경변수 KEDOVI_BANNED(a|b) 또는 이 PC 의 ~/.config/kedovi/banned.txt (한 줄에 하나)
const bannedSrc = process.env.KEDOVI_BANNED || (() => { try { return fs.readFileSync(path.join(REAL_CONFIG_DIR, 'banned.txt'), 'utf8'); } catch { return ''; } })();
// + repo 안의 banned.local.txt (git 제외, 직접 적는 목록). # 으로 시작하는 줄은 주석
const localBanned = (() => { try { return fs.readFileSync(path.join(KIT, 'banned.local.txt'), 'utf8'); } catch { return ''; } })();
const banned = [...new Set(`${bannedSrc}\n${localBanned}`.split(/[|\r\n]+/).map((x) => x.trim().toLowerCase()).filter((x) => x && !x.startsWith('#')))];
const textFiles = walk(KIT, (p) => /\.(md|js|py|json|sh|toml)$/.test(p) && !p.includes(`${path.sep}bin${path.sep}selftest.js`) && !p.endsWith('package-lock.json'));
const hits = [];
for (const f of textFiles) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const low = l.toLowerCase();
    // 영문 낱말은 단어 경계로, 한글 낱말은 조사가 붙으므로 들어 있기만 하면 (\\b 는 한글을 단어 글자로 보지 않는다)
    for (const b of banned) if (/^[\x00-\x7f]+$/.test(b) ? new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(low) : low.includes(b)) hits.push(`${path.relative(KIT, f)}:${i + 1} (${b})`);
  });
}
record('금지 문자열(프로젝트 이름)', hits.length === 0, hits.length ? hits.slice(0, 5).join(', ') : banned.length ? `${banned.length}개 낱말` : '목록 없음 (KEDOVI_BANNED · ~/.config/kedovi/banned.txt)');

// 워크스페이스 커밋 훅의 비밀값 검사 · 공개 여부 주소 변환
{
  const dir = path.join(tmp, 'secret-guard');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new'], tmp);
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  const guard = () => spawnSync(process.execPath, [path.join(dir, 'bin', 'kit.js'), 'guard'], { cwd: dir, encoding: 'utf8' });
  fs.mkdirSync(path.join(dir, 'handoffs', 'me'), { recursive: true });
  const fake = ['ghp', 'A'.repeat(36)].join('_');   // 시험용 가짜 토큰 (파일에 그대로 두지 않게 조립)
  fs.writeFileSync(path.join(dir, 'handoffs', 'me', 'LATEST.md'), `# 기록\n로그: token=${fake}\n`);
  g('add', 'handoffs/me/LATEST.md');
  const blocked = guard();
  fs.writeFileSync(path.join(dir, 'handoffs', 'me', 'LATEST.md'), `# 기록\n로그: token=***\n시험용: ${fake} gitleaks:allow\n`);
  g('add', 'handoffs/me/LATEST.md');
  const passed = guard();
  const { anonUrl } = require(path.join(KIT, 'packs', 'core', 'lib', 'visibility.js'));
  const urls = anonUrl('git@github.com:me/ws.git') === 'https://github.com/me/ws.git' && anonUrl('ssh://git@gitlab.example.com:2222/g/ws.git') === 'https://gitlab.example.com/g/ws.git' && anonUrl('https://u@host/a/b.git') === 'https://host/a/b.git';
  const noValue = !blocked.stderr.includes(fake) && /LATEST\.md:2 \(GitHub 토큰\)/.test(blocked.stderr);
  record('커밋 훅 비밀값 검사 · 공개 여부 주소', blocked.status === 1 && noValue && passed.status === 0 && urls,
    `토큰 막음 ${blocked.status === 1} · 값 안 찍고 파일:줄 ${noValue} · 가린 뒤 · 예외 표시 통과 ${passed.status === 0} · 익명 주소 변환 ${urls}`);
}

// repo 안에 원래 있던 AI 지침: sync 가 찾아 기록 → AGENTS.md 표 → 방식(follow · kit · ignore) → 무시는 claudeMdExcludes → 바뀌면 경고
{
  const dir = path.join(tmp, 'repo-guides');
  const got = {};
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new', '--code', 'new:app'], tmp);
  const app = path.join(dir, 'repos', 'app');
  const put = (rel, text = 'x\n') => { fs.mkdirSync(path.dirname(path.join(app, rel)), { recursive: true }); fs.writeFileSync(path.join(app, rel), text); };
  put('CLAUDE.md'); put('.claude/rules/a.md'); put('.claude/skills/s/SKILL.md'); put('.claude/settings.json', '{}\n'); put('api/AGENTS.md'); put('node_modules/p/CLAUDE.md'); put('src/Main.java', 'class Main {}\n');
  const commitApp = () => { spawnSync('git', ['-C', app, 'add', '-A', '-f', '--', '.', ':!node_modules']); spawnSync('git', ['-C', app, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x', '--no-verify']); };
  commitApp(); put('UNTRACKED/CLAUDE.md'); // 추적 안 한 지침은 기록하지 않는다 (PC 마다 같게)
  const wsFile = path.join(dir, 'workspace.json');
  const reg = () => JSON.parse(fs.readFileSync(wsFile, 'utf8')).repos.find((r) => r.name === 'app');
  // init 때는 빈 repo 라 [] 로 기록됐다. 옛 워크스페이스처럼 기록이 없는 상태로 돌려 sync 가 채우는지 본다
  const w0 = JSON.parse(fs.readFileSync(wsFile, 'utf8')); delete w0.repos.find((r) => r.name === 'app').guides; fs.writeFileSync(wsFile, JSON.stringify(w0, null, 2));
  const s1 = run(process.execPath, ['bin/kit.js', 'sync'], dir);
  const want = ['.claude/rules/', '.claude/settings.json', '.claude/skills/', 'CLAUDE.md', 'api/AGENTS.md'];
  got['sync 가 기록 (node_modules 제외)'] = s1.ok && JSON.stringify(reg().guides) === JSON.stringify(want);
  const agents = () => fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  got['AGENTS.md 표 · 기본 repo 지침 우선'] = /## repo 자체 지침/.test(agents()) && agents().includes('`repos/app/api/AGENTS.md`') && /\| \*\*app\*\* \|.*\| repo 지침 우선 \|/.test(agents()) && /실행 도구 설정/.test(agents()) && !/settings\.json` ·.*\| repo 지침 우선/.test(agents().split('\n').find((l) => l.startsWith('| **app**')) || '');
  const cli = (...a) => run(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'repo', 'guides', ...a], dir);
  const list = cli();
  got['kedovi repo guides 목록'] = list.ok && /app\s+repo 지침 우선\s+\.claude\/rules\//.test(list.out);
  const ig = cli('app', 'ignore');
  const ex = (JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')).claudeMdExcludes || []);
  got['ignore → claudeMdExcludes · 표 무시'] = ig.ok && reg().guidesMode === 'ignore' && ex.includes('**/repos/app/**/CLAUDE.md') && ex.includes('**/repos/app/.claude/rules/**') && /\| 무시 \|/.test(agents());
  const bad = cli('app', 'bogus');
  const proto = cli('app', 'toString');
  got['모르는 방식 거부'] = !bad.ok && /follow/.test(bad.out) && !proto.ok;
  cli('app', 'follow');
  got['follow 로 되돌리면 기록 · 제외 없음'] = reg().guidesMode === undefined && !('claudeMdExcludes' in JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')));
  got['check 통과'] = run(process.execPath, ['bin/kit.js', 'check'], dir).ok;
  fs.rmSync(path.join(app, 'UNTRACKED'), { recursive: true, force: true }); put('GEMINI.md'); commitApp();
  const s2 = run(process.execPath, ['bin/kit.js', 'sync'], dir);
  got['바뀌면 경고'] = /AI 지침이 기록과 다릅니다 \(새로 생김: GEMINI\.md\)/.test(s2.out);
  cli('--rescan', 'app');
  got['다시 훑기'] = reg().guides.includes('GEMINI.md') && !/AI 지침이 기록과/.test(run(process.execPath, ['bin/kit.js', 'sync'], dir).out);
  // 기록이 비어 있어도 무시면 막는다 (나중에 생기는 지침)
  const w1 = JSON.parse(fs.readFileSync(wsFile, 'utf8')); const ra = w1.repos.find((x) => x.name === 'app'); ra.guides = []; ra.guidesMode = 'ignore'; fs.writeFileSync(wsFile, JSON.stringify(w1, null, 2));
  run(process.execPath, ['bin/kit.js', 'sync'], dir);
  got['빈 기록 + 무시도 제외'] = (JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')).claudeMdExcludes || []).includes('**/repos/app/CLAUDE.md');
  // 설정 수정이 잠긴 팀의 팀원 PC: 지침을 찾아도 기록하지 않고 알린다
  const w3 = JSON.parse(fs.readFileSync(wsFile, 'utf8')); const rb = w3.repos.find((x) => x.name === 'app'); delete rb.guides; delete rb.guidesMode; w3.team = { ...(w3.team || {}), admins: ['someone-else'], lock: true }; fs.writeFileSync(wsFile, JSON.stringify(w3, null, 2));
  const s3 = run(process.execPath, ['bin/kit.js', 'sync'], dir);
  got['잠긴 팀 팀원은 기록하지 않음'] = /설정 수정이 잠겨 있어 기록하지 않았습니다: app/.test(s3.out) && reg().guides === undefined;
  record('repo 자체 지침 (기록 · 방식 · 무시 · 변경 경고)', Object.values(got).every(Boolean), Object.entries(got).map(([k, v]) => `${k} ${v}`).join(' · '));
}

// 정리 후보 (kedovi tidy): 이번 작업 새 파일 · 안 쓰는 자료 · 링크 없는 문서 · 백업 이름 · 오탐 방지 (플랫폼 아이콘 · 번호만 있는 이름 · 참조되는 파일)
{
  const dir = path.join(tmp, 'tidy');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new', '--code', 'new:app'], tmp);
  const app = path.join(dir, 'repos', 'app');
  const g = (...a) => spawnSync('git', ['-C', app, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  const put = (rel, text = 'x\n') => { fs.mkdirSync(path.dirname(path.join(app, rel)), { recursive: true }); fs.writeFileSync(path.join(app, rel), text); };
  put('img/hero-banner.png'); put('img/used-logo.png'); put('res/drawable/ic_star.png'); put('src/main.js', 'import "../img/used-logo.png"\n');
  put('docs/old-notes.md', '# a\n'); put('docs/guide-api.md', '# b\n'); put('README.md', 'see guide-api · architecture\n');
  put('src/main_old.js'); put('src/report.txt'); put('src/report (1).txt'); put('src/copy-button.tsx'); put('src/deep-copy.ts'); put('src/api.ts'); put('src/api_v2.ts'); put('src/lone_old.js');
  put('docs/architecture.md', '![](./architecture.png)\n'); put('docs/architecture.png'); put('.github/ISSUE_TEMPLATE/bug.md'); put('.claude/commands/run.md');
  g('add', '-A'); g('commit', '-qm', 'base');
  put('src/new-thing.js');
  const tool = (...a) => run(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'tidy.js'), ...a], dir);
  const j = JSON.parse(tool('--repo', 'app', '--json').out || '{}');
  const r = (j.repos || [])[0] || {};
  const got = {
    '안 쓰는 자료 (참조 · 플랫폼 아이콘 제외)': JSON.stringify(r.assets) === JSON.stringify(['img/hero-banner.png']),
    '링크 없는 문서 (같은 이름 문서 속 그림은 씀 · 도구 폴더 md 제외)': JSON.stringify(r.docs) === JSON.stringify(['docs/old-notes.md']) && !(r.assets || []).includes('docs/architecture.png'),
    '백업 이름 (원본이 있을 때만 · 코드의 판 번호 · copy 낱말은 아님)': JSON.stringify((r.backups || []).sort()) === JSON.stringify(['src/main_old.js', 'src/report (1).txt']),
    '이번 작업 새 파일': JSON.stringify(r.newFiles) === JSON.stringify(['src/new-thing.js']),
  };
  const cnt = tool('--count');
  got['한 줄 요약'] = cnt.ok && /정리 후보 4개 \(app 4\)/.test(cnt.out);
  const nw = JSON.parse(tool('--repo', 'app', '--new', '--json').out || '{}');
  got['--new 는 새 파일 안에서만'] = nw.total === 0 && nw.newFiles === 1;
  got['명령 · 스킬 · 핸드오프'] = fs.existsSync(path.join(dir, '.claude', 'skills', 'tidy', 'SKILL.md')) && /tidy\.js --count/.test(fs.readFileSync(path.join(dir, '.claude', 'skills', 'handoff', 'SKILL.md'), 'utf8')) && /방향이 바뀌면 남은 파일을 정리한다/.test(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'));
  record('정리 후보 (kedovi tidy)', Object.values(got).every(Boolean), Object.entries(got).map(([k, v]) => `${k} ${v}`).join(' · '));
}

// 이 PC 의 워크스페이스 한꺼번에 올리기 (kedovi upgrade --all): 찾기 · 건너뛸 것(커밋 안 한 변경) · 올리기 · 새 설치 알림
{
  const home = path.join(tmp, 'upall-home');
  const base = path.join(tmp, 'upall');
  fs.mkdirSync(base, { recursive: true });
  const env = { ...process.env, KEDOVI_HOME: home };
  const ver = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8')).version;
  const mk = (n) => {
    const d = path.join(base, n);
    run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', d, '--type', 'new'], base);
    const f = path.join(d, 'workspace.json'); const j = JSON.parse(fs.readFileSync(f, 'utf8')); j.kit.version = '0.1.0'; fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    spawnSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A']); spawnSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'v', '--no-verify']);
    return d;
  };
  const a = mk('wsa'); const b = mk('wsb');
  fs.appendFileSync(path.join(b, 'workspace.json'), '\n'); // 커밋 안 한 변경
  const ai = (args, cwd = base) => { const r = spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), ...args], { cwd, env, encoding: 'utf8', input: '', timeout: 300000 }); return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` }; };
  const got = {};
  const dry = ai(['upgrade', '--all', '--scan', base]);
  got['찾기 · 화면 없으면 --yes 요구'] = !dry.ok && /워크스페이스 2개를 찾아/.test(dry.out) && /건너뜀 wsb: 커밋 안 한 변경/.test(dry.out) && /--yes/.test(dry.out);
  const go = ai(['upgrade', '--all', '--yes']);
  const vOf = (d) => JSON.parse(fs.readFileSync(path.join(d, 'workspace.json'), 'utf8')).kit.version;
  got['올림 · 건너뜀'] = go.ok && vOf(a) === ver && vOf(b) === '0.1.0' && /✔ wsa/.test(go.out) && /- wsb\s+건너뜀/.test(go.out) && /git -C ".*wsa" add -A/.test(go.out);
  fs.writeFileSync(path.join(home, 'last-version'), '0.0.1\n');
  const note = ai(['list']);
  got['새 설치 첫 명령에서 한 번 알림'] = /옛 버전 워크스페이스 1개 \(wsb\)/.test(note.out) && !/옛 버전 워크스페이스/.test(ai(['list']).out);
  record('워크스페이스 한꺼번에 올리기 (upgrade --all)', Object.values(got).every(Boolean), Object.entries(got).map(([k, v]) => `${k} ${v}`).join(' · '));
}

// 원격 없이 새로 만드는 repo — init --code new:<이름> → git init·훅·local 등록 → 팀원 install 은 대기 → origin 을 달면 sync 가 remote 로 옮김
{
  const dir = path.join(tmp, 'local-repo');
  const g = (cwd, ...a) => spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
  const got = [];
  const init = run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new', '--code', 'new:app'], tmp);
  const app = path.join(dir, 'repos', 'app');
  const reg = () => (JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8')).repos || []).find((r) => r.name === 'app') || {};
  const created = init.ok && fs.existsSync(path.join(app, '.git')) && reg().local === true && fs.existsSync(path.join(app, '.git', 'hooks', 'commit-msg'));
  got.push(`만듦·등록·서명 훅 ${created}`);
  g(dir, 'add', '-A'); g(dir, 'commit', '-qm', 'init');
  const mate = path.join(tmp, 'local-repo-mate');
  spawnSync('git', ['clone', '-q', dir, mate]);
  const wait = run(process.execPath, ['bin/kit.js', 'install'], mate);
  const waiting = wait.ok && /아직 원격 없음/.test(wait.out) && !fs.existsSync(path.join(mate, 'repos', 'app'));
  got.push(`팀원 대기 ${waiting}`);
  const bare = path.join(tmp, 'local-app.git');
  fs.writeFileSync(path.join(app, 'README.md'), 'x\n'); g(app, 'add', '-A'); g(app, 'commit', '-qm', 'first');
  spawnSync('git', ['init', '-q', '--bare', bare]); g(app, 'remote', 'add', 'origin', bare); g(app, 'push', '-q', '-u', 'origin', 'HEAD');
  run(process.execPath, ['bin/kit.js', 'sync'], dir);
  const filled = reg().remote === bare && reg().local === undefined;
  got.push(`sync 가 remote 기록 ${filled}`);
  g(dir, 'commit', '-qam', 'remote'); g(mate, 'pull', '-q');
  run(process.execPath, ['bin/kit.js', 'install'], mate);
  const cloned = fs.existsSync(path.join(mate, 'repos', 'app', 'README.md'));
  got.push(`팀원 clone ${cloned}`);
  record('새로 만드는 repo (new:<이름> → 원격 연결)', created && waiting && filled && cloned, got.join(' · '));

  // 리뷰 확인 — commit · push 전에 리뷰 기록과 비교해 리뷰 안 된 줄 수를 알린다 (기본 꺼짐 · warn · block · mark · skip · reviewer 에이전트가 기록)
  {
    let n = 0;
    const gate = (command, cwd = dir) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'review-gate.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 'selftest-review', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout;
    const tool = (...a) => run(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'review.js'), ...a], dir);
    const add = (lines, file = 'src.txt') => { fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true }); fs.appendFileSync(path.join(app, file), `${Array.from({ length: lines }, () => `line ${n += 1}`).join('\n')}\n`); };
    const wsFile = path.join(dir, 'workspace.json');
    const wsRaw = fs.readFileSync(wsFile, 'utf8');
    const set = (enforce) => { const w = JSON.parse(wsRaw); w.agents = { ...(w.agents || {}), enforce }; fs.writeFileSync(wsFile, JSON.stringify(w, null, 2)); };
    const warned = (o, k) => /"additionalContext":"⚠ 리뷰 확인/.test(o) && o.includes(`${k}줄`) && !/"deny"/.test(o);
    const r = {};
    add(3);
    r['기본 꺼짐'] = !gate('git -C repos/app commit -am x');
    set({ reviewBeforePush: 'warn' });
    r['commit 경고 (줄 수)'] = warned(gate('git -C repos/app commit -am x'), 3);
    r['같은 상태는 한 번만'] = !gate('cd repos/app && git commit -am x');
    r['push 는 HEAD 기준'] = !gate('cd repos/app && git push');
    g(app, 'add', '-A'); g(app, 'commit', '-qm', 'work');
    r['commit 뒤 push 는 조용'] = !gate(`git -C "${app}" push origin HEAD`);
    add(2);
    r['안 push 한 것까지 셈'] = warned(gate('git commit -am y', app), 5);
    r['mark 뒤 통과'] = tool('mark', '--by', 'selftest').ok && !gate('git commit -am y', app);
    add(1);
    const after = gate('git commit -am y', app);
    r['리뷰 뒤 고친 만큼'] = warned(after, 1) && after.includes('마지막 리뷰') && after.includes('selftest');
    set({ reviewBeforePush: 'warn', reviewMinLines: 1 });
    r['기준 줄 수 이하 통과'] = !gate('git commit -am y', app);
    set({ reviewBeforePush: 'block' });
    add(4);
    r['block 은 막음 · 리뷰한 것의 일부 push 는 통과'] = !gate('git push', app) && /"permissionDecision":"deny"/.test(gate('git commit -am z', app));
    r['skip 한 번'] = tool('skip', '--reason', '사용자 승인').ok && !gate('git commit -am z', app) && /"deny"/.test(gate('git commit -am z', app)) && !tool('skip').ok;
    // reviewer 가 이 도구의 역할 에이전트일 때 (다른 회사 모델에 맡긴 구성이면 역할 파일이 없고 위임 쪽이 기록한다)
    const roleFile = path.join(dir, '.claude', 'agents', 'reviewer.md');
    const hadRole = fs.existsSync(roleFile);
    if (!hadRole) { fs.mkdirSync(path.dirname(roleFile), { recursive: true }); fs.writeFileSync(roleFile, '---\nname: reviewer\n---\n'); }
    const spawnReviewer = (prompt) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'agent-budget.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 'selftest-review-agent', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'reviewer', name: 'reviewer', prompt } }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout;
    r['검사 줄 없으면 리뷰 에이전트 막음'] = /"permissionDecision":"deny"/.test(spawnReviewer('리뷰해 주세요'));
    spawnReviewer('리뷰해 주세요\n검사: npm test 통과');
    r['reviewer 에이전트가 기록'] = !gate('git commit -am z', app);
    if (!hadRole) fs.rmSync(roleFile);
    add(6, 'handoffs/me/LATEST.md');
    r['핸드오프 · 다른 repo · dry-run 제외'] = !gate('git commit -am h', app) && !gate('git commit -am ws') && (add(2), !gate('git push --dry-run', app)) && /"deny"/.test(gate('git commit -am z', app));
    set({ reviewBeforePush: 'block', reviewRepos: ['none'] });
    r['대상 밖 repo'] = !gate('git commit -am z', app);
    fs.writeFileSync(wsFile, wsRaw);
    const st = tool('status').out;
    const cli = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'team-mode', 'enforce', 'review', ...a], { cwd: dir, encoding: 'utf8' });
    const on = cli('warn', '--repos', 'app', '--min-lines', '10', '--team');
    const saved = (JSON.parse(fs.readFileSync(wsFile, 'utf8')).agents || {}).enforce || {};
    r['상태 · 명령'] = /리뷰 확인  꺼짐/.test(st) && on.status === 0 && saved.reviewBeforePush === 'warn' && saved.reviewMinLines === 10 && saved.reviewRepos[0] === 'app' && cli('warn', '--repos', 'nope', '--team').status !== 0 && cli('warn', '--min-lines', '3').status !== 0;
    fs.writeFileSync(wsFile, wsRaw); run(process.execPath, ['bin/kit.js', 'sync'], dir);
    g(app, 'checkout', '-q', '--', '.'); g(app, 'clean', '-qfd');
    record('리뷰 확인 (commit · push 전 · 기록 · 생략 · 수준)', Object.values(r).every(Boolean), Object.entries(r).map(([k, v]) => `${k} ${v}`).join(' · '));
  }
}

// 보완 3건: 결정 질문을 글로 끝내면 한 번 막기 · 기존 폴더 훑기(kedovi import) · 기획 repo 없음 경고 끄기
{
  const dw = path.join(tmp, 'extras-ws');
  spawnSync(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dw, '--type', 'new'], { cwd: tmp, encoding: 'utf8' });
  const e = {};
  const env = { PATH: process.env.PATH, HOME: path.join(tmp, 'extras-home'), TMPDIR: require('os').tmpdir(), CLAUDE_PROJECT_DIR: dw };
  const hook = (ev, extra = {}, more = {}) => spawnSync(process.execPath, [path.join(dw, 'packs', 'core', 'hooks', 'decision-ask.js'), '--agent=claude'], { cwd: dw, encoding: 'utf8', input: JSON.stringify({ hook_event_name: ev, session_id: 'extras-1', ...extra }), env: { ...env, ...more } }).stdout.trim();
  const asked = '두 가지 방법이 있습니다.\n\n1. 훅으로 막기 (권장)\n2. 룰만 두기\n\n어느 쪽으로 할까요?';
  hook('UserPromptSubmit');
  const out = hook('Stop', { last_assistant_message: asked });
  e['글로 끝낸 결정 질문 막음'] = /"decision":"block"/.test(out) && /AskUserQuestion/.test(out);
  e['결정 아님 · 이미 막힌 멈춤 통과'] = !hook('Stop', { last_assistant_message: '끝났습니다.\n\n1. 파일을 고쳤습니다\n2. 테스트를 돌렸습니다' }) && !hook('Stop', { last_assistant_message: asked, stop_hook_active: true });
  hook('PreToolUse', { tool_name: 'AskUserQuestion' });
  e['질문 창을 쓴 요청은 통과'] = !hook('Stop', { last_assistant_message: asked });
  hook('UserPromptSubmit');
  e['다음 요청은 다시 봄'] = /"decision":"block"/.test(hook('Stop', { last_assistant_message: asked }));
  const wsFile = path.join(dw, 'workspace.json');
  const wsRaw = fs.readFileSync(wsFile, 'utf8');
  const cli = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), ...a], { cwd: dw, encoding: 'utf8', env: { ...process.env, HOME: env.HOME } });
  e['끄기 · 명령'] = cli('team-mode', 'enforce', 'ask', 'warn').status !== 0 && cli('team-mode', 'enforce', 'ask', 'off', '--team').status === 0 && !hook('Stop', { last_assistant_message: asked }) && /결정 질문을 글로 끝낼 때  끔/.test(cli('team-mode').stdout);
  fs.writeFileSync(wsFile, wsRaw);
  const hooks = JSON.parse(fs.readFileSync(path.join(dw, '.claude', 'settings.json'), 'utf8')).hooks || {};
  e['훅 등록'] = ['Stop', 'UserPromptSubmit', 'PreToolUse'].every((k) => JSON.stringify(hooks[k] || []).includes('decision-ask'));
  // 기존 폴더 훑기
  const old = path.join(tmp, 'old-ai');
  for (const d of ['.claude/rules', '.serena/memories', 'handoffs', 'out', 'tools']) fs.mkdirSync(path.join(old, d), { recursive: true });
  fs.writeFileSync(path.join(old, 'CLAUDE.md'), '# 지침\n소스는 /Users/someone/work/app 에 있다\n테스트 계정 password: Zx9!secretvalue\n비밀번호: <관리자에게 문의>\n');
  fs.writeFileSync(path.join(old, '.claude', 'rules', 'batch.md'), '---\npaths: batch/**\n---\n배치는 밤에만\n');
  fs.writeFileSync(path.join(old, '.serena', 'memories', 'm.md'), '메모');
  fs.writeFileSync(path.join(old, 'handoffs', 'LATEST.md'), '남은 일');
  fs.writeFileSync(path.join(old, 'tools', 'build.py'), 'print(1)');
  for (let n = 0; n < 205; n += 1) fs.writeFileSync(path.join(old, 'out', `h${n}.md`), 'x');
  const scanOut = cli('import', old, '--json');
  let sc = null; try { sc = JSON.parse(scanOut.stdout); } catch { /* 아래에서 실패 */ }
  const text = cli('import', old).stdout;
  e['분류'] = !!sc && sc.groups.rules.length === 2 && sc.groups.rules.some((f) => /필요할 때/.test(f.hint || '')) && sc.groups.memory.length === 1 && sc.groups.handoff.length === 1 && sc.groups.scripts.length === 1 && !sc.groups.docs;
  e['큰 폴더 · 절대경로'] = !!sc && sc.big.length === 1 && sc.big[0].dir === 'out' && sc.big[0].files === 205 && sc.absPaths.length === 1 && sc.absPaths[0].path === '/Users/someone';
  e['비밀값 의심 줄 (값은 안 찍음)'] = !!sc && sc.secrets.length === 1 && sc.secrets[0].line === 3 && !/Zx9!secretvalue/.test(scanOut.stdout + text) && /비밀값 의심 줄 1곳/.test(text);
  // 기획 repo 없음 경고: 신규는 알리고, docsRepo: false 나 운영·고도화 유형이면 조용
  const syncOut = () => { const r = spawnSync(process.execPath, ['bin/kit.js', 'sync'], { cwd: dw, encoding: 'utf8' }); return r.stdout + r.stderr; };
  const warned = /기획 repo\(kind: "docs"\)가 없습니다/.test(syncOut());
  const setWs = (f) => { const w = JSON.parse(wsRaw); f(w); fs.writeFileSync(wsFile, JSON.stringify(w, null, 2)); };
  setWs((w) => { w.docsRepo = false; });
  const off = !/기획 repo\(kind: "docs"\)가 없습니다/.test(syncOut());
  const kitLib = require('./kit.js');
  const typed = (type) => { const w = JSON.parse(wsRaw); w.project = { ...(w.project || {}), type }; fs.writeFileSync(wsFile, JSON.stringify(w, null, 2)); const o = syncOut(); return /기획 repo\(kind: "docs"\)가 없습니다/.test(o); };
  e['기획 repo 경고 (알림 · 끄기 · 운영·고도화)'] = warned && off && !!kitLib && !typed('enhancement');
  fs.writeFileSync(wsFile, wsRaw);
  record('보완 (결정 질문 막기 · 기존 폴더 훑기 · 기획 repo 경고)', Object.values(e).every(Boolean), Object.entries(e).map(([k, v]) => `${k} ${v}`).join(' · '));
}

// 착수 전 확인: 요청마다 코드 repo 첫 수정 전에 답변에 「착수 전 확인:」 이 없으면 알림(기본, 한 번) · 막기 · 문서 두 줄 이하 · repo 밖 제외
{
  const dw = path.join(tmp, 'planfirst-ws');
  spawnSync(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dw, '--type', 'new'], { cwd: tmp, encoding: 'utf8' });
  const wsFile = path.join(dw, 'workspace.json');
  const wj = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
  wj.repos = [...(wj.repos || []), { name: 'app', kind: 'code' }];
  fs.writeFileSync(wsFile, JSON.stringify(wj, null, 2));
  fs.mkdirSync(path.join(dw, 'repos', 'app', 'src'), { recursive: true });
  const env = { PATH: process.env.PATH, HOME: path.join(tmp, 'planfirst-home'), TMPDIR: require('os').tmpdir(), CLAUDE_PROJECT_DIR: dw };
  const tr = path.join(tmp, 'planfirst-transcript.jsonl');
  const say = (...turns) => fs.writeFileSync(tr, turns.map(([who, text]) => JSON.stringify(who === 'u'
    ? { type: 'user', message: { role: 'user', content: text } }
    : { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })).join('\n') + '\n');
  const hook = (ev, extra = {}) => spawnSync(process.execPath, [path.join(dw, 'packs', 'core', 'hooks', 'plan-first.js'), '--agent=claude'], { cwd: dw, encoding: 'utf8', input: JSON.stringify({ hook_event_name: ev, session_id: 'plan-1', transcript_path: tr, cwd: dw, ...extra }), env }).stdout.trim();
  const edit = (file, n = 5) => hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: Array(n).fill('b').join('\n') } });
  const code = path.join(dw, 'repos', 'app', 'src', 'order.js');
  const p = {};
  say(['u', '주문 탭 추가해줘'], ['a', '바로 고치겠습니다.']);
  hook('UserPromptSubmit');
  const first = edit(code);
  p['머리말 없으면 알림'] = /additionalContext/.test(first) && /착수 전 확인:/.test(first) && !/deny/.test(first);
  p['같은 요청은 한 번'] = !edit(code);
  hook('UserPromptSubmit');
  p['다음 요청은 다시'] = /additionalContext/.test(edit(code));
  hook('UserPromptSubmit');
  say(['u', '주문 탭 추가해줘'], ['a', '착수 전 확인:\n| 영향 범위 | order.js |'], ['u', '진행해'], ['a', '시작합니다.']);
  p['앞 요청 답변의 머리말 통과'] = !edit(code);
  say(['u', '주문 탭'], ['a', '착수 전 확인: 계획'], ['u', '다른 것'], ['a', '네'], ['u', '이것도']);
  p['두 요청 전 머리말은 안 셈'] = /additionalContext/.test(edit(code));
  hook('UserPromptSubmit');
  say(['u', '오타 고쳐줘']);
  p['문서 두 줄 이하 · repo 밖 제외'] = !edit(path.join(dw, 'repos', 'app', 'README.md'), 2) && !edit(path.join(dw, 'handoffs', 'note.js'));
  p['문서도 세 줄 이상이면 알림'] = /additionalContext/.test(edit(path.join(dw, 'repos', 'app', 'README.md'), 3));
  const cli = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'team-mode', 'enforce', 'plan', ...a], { cwd: dw, encoding: 'utf8', env: { ...process.env, HOME: env.HOME } });
  cli('block', '--team');
  hook('UserPromptSubmit');
  const blocked = [edit(code), edit(code)];
  say(['u', '오타 고쳐줘'], ['a', '착수 전 확인: 단순 수정 (오타 한 줄)']);
  p['막기: 보일 때까지 막고 보이면 통과'] = blocked.every((x) => /"deny"/.test(x)) && !edit(code);
  say(['u', '오타 고쳐줘']);
  cli('off', '--team');
  p['끄기'] = !edit(code);
  const hooks = JSON.parse(fs.readFileSync(path.join(dw, '.claude', 'settings.json'), 'utf8')).hooks || {};
  p['훅 등록'] = ['UserPromptSubmit', 'PreToolUse'].every((k) => JSON.stringify(hooks[k] || []).includes('plan-first'));
  record('착수 전 확인 (알림 · 한 번 · 앞 요청 머리말 · 문서 · repo 밖 · 막기 · 끄기)', Object.values(p).every(Boolean), Object.entries(p).map(([k, v]) => `${k} ${v}`).join(' · '));
}

// 킷 문서 사이트 — docs-site/ 가 md(README · docs/*.md) 와 같아야 한다 (md 를 고치면 node bin/docs.js). 메뉴 「기타」 로 빠진 문서가 없어야 한다
{
  const docs = require('./docs.js');
  const res = docs.site();
  const diff = docs.changed(res.pages);
  const catalog = !docs.writePackCatalog({ dryRun: true });
  const listed = !(res.unlisted || []).length;
  record('킷 문서 사이트 docs-site/ (bin/docs.js)', !diff.length && catalog && listed, `${diff.length ? `md 와 다름 ${diff.slice(0, 3).join(' · ')} (node bin/docs.js)` : 'md 와 같음'} · 팩 목록 ${catalog} · 메뉴 「기타」 ${listed ? '없음' : res.unlisted.join(',')}`);
}

// 인수인계 — 팀원 핸드오프 push → 리더가 팀 현황(원격 기준) → 인수 → 원래 항목 "인수됨" · 중복 인수 막기
{
  const hub = path.join(tmp, 'team-hub.git');
  const lead = path.join(tmp, 'team-lead');
  const mate = path.join(tmp, 'team-mate');
  const g = (cwd, who, ...a) => spawnSync('git', ['-C', cwd, '-c', `user.name=${who}`, '-c', `user.email=${who}@t`, ...a], { encoding: 'utf8' });
  const got = [];
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', lead, '--type', 'new'], tmp);
  spawnSync('git', ['init', '-q', '--bare', hub]);
  g(lead, 'lead', 'remote', 'add', 'origin', hub); g(lead, 'lead', 'add', '-A'); g(lead, 'lead', 'commit', '-qm', 'init'); g(lead, 'lead', 'push', '-q', '-u', 'origin', 'HEAD');
  g(lead, 'lead', 'config', 'user.name', 'lead');
  spawnSync('git', ['clone', '-q', hub, mate]);
  g(mate, 'mate', 'config', 'user.name', 'mate');
  const hd = path.join(mate, 'handoffs', 'mate');
  fs.mkdirSync(hd, { recursive: true });
  fs.writeFileSync(path.join(hd, 'LATEST.md'), '# 마지막 핸드오프 (2026-01-05)\n\n## 오늘 핵심\n- 결제 연동 끝\n## 진행 중 / 미커밋\n- 환불 절반\n## 작업 브랜치\n- repos/api: wip/refund (push 됨) — 환불\n');
  fs.writeFileSync(path.join(hd, 'TODO.md'), '# 남은 작업 (mate)\n\n- **환불 마무리** — RefundService\n- **취소 테스트** — tests/payment\n');
  g(mate, 'mate', 'add', '-A'); g(mate, 'mate', 'commit', '-qm', 'handoff'); g(mate, 'mate', 'push', '-q');
  const tool = path.join(lead, 'packs', 'core', 'bin', 'team-status.js');
  const js = (...a) => { const r = spawnSync(process.execPath, [tool, ...a, '--json'], { cwd: lead, encoding: 'utf8' }); try { return JSON.parse(r.stdout); } catch { return null; } };
  const ov = js();
  const m = ov && ov.people.find((x) => x.id === 'mate');
  const seen = !!m && m.todo.length === 2 && m.branches.some((b) => b.includes('wip/refund')) && m.days > 3;
  got.push(`원격 기준 현황 ${seen}`);
  const tk = js('--take', 'mate', '--items', '1');
  const mine = fs.existsSync(path.join(lead, 'handoffs', 'lead', 'TODO.md')) ? fs.readFileSync(path.join(lead, 'handoffs', 'lead', 'TODO.md'), 'utf8') : '';
  const took = !!tk && tk.added.length === 1 && /환불 마무리.*← mate 에게서 인수/.test(mine) && !fs.readFileSync(path.join(mate, 'handoffs', 'mate', 'TODO.md'), 'utf8').includes('인수');
  got.push(`인수(원래 폴더 그대로) ${took}`);
  const again = js('--take', 'mate', '--items', '1');
  const after = js('--id', 'mate', '--no-fetch');
  const marked = !!again && again.added.length === 0 && !!after && Object.values(after.taken).includes('lead');
  got.push(`인수됨 표시 · 중복 막기 ${marked}`);
  const brief = spawnSync(process.execPath, [path.join(lead, 'packs', 'core', 'hooks', 'handoff-brief.js')], { cwd: lead, encoding: 'utf8', input: '{}' }).stdout.trim();
  const briefOk = brief.split('\n').length === 1 && /lead 마지막 핸드오프 .* 미완 작업 0건 · 내 TODO 1건/.test(brief);
  got.push(`세션 시작 한 줄 ${briefOk}`);
  // 팀 명단 — 명단 추가 · 제한 켜기 → 명단 밖 id 는 kedovi start 가 멈춤, 팀 현황에 미합류 · 명단에 없음
  const kedovi = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), ...a], { cwd: lead, encoding: 'utf8', env: { ...process.env, KEDOVI_HOME: path.join(tmp, 'team-home') } });
  kedovi('team', 'add', 'lead', 'ghost'); kedovi('team', 'restrict', 'on');
  fs.writeFileSync(path.join(lead, '.agents', 'local.json'), JSON.stringify({ agent: 'claude', args: [] }));
  g(lead, 'lead', 'config', 'user.name', 'outsider');
  const blocked = kedovi('start', '--claude');
  g(lead, 'lead', 'config', 'user.name', 'lead');
  const roster = js('--no-fetch');
  const st = (id) => (roster.people.find((x) => x.id === id) || {});
  const rosterOk = blocked.status !== 0 && /팀 명단에 없습니다/.test(blocked.stderr) && roster.restrict === true
    && st('ghost').joined === false && st('ghost').inRoster === true && st('mate').inRoster === false && st('mate').joined === true;
  got.push(`명단 · 제한 · 미합류 표시 ${rosterOk}`);
  // 화면 없는 실행(에이전트)의 whoami --refresh: 죽지 않고, 계정을 못 읽은 이유를 한 줄 알린다 (원격이 로컬 경로라 계정을 못 읽음)
  const who = kedovi('team', 'whoami', '--refresh');
  const whoOk = who.status === 0 && /이 PC 사용자: lead/.test(who.stdout) && /저장소 계정을 읽지 못했습니다: 원격 주소를 읽지 못함/.test(`${who.stdout}${who.stderr}`);
  got.push(`화면 없는 whoami 이유 안내 ${whoOk}`);
  record('인수인계 (팀 현황 · 인수 · 세션 시작 알림 · 명단)', seen && took && marked && briefOk && rosterOk && whoOk, got.join(' · '));
}

// 역할 위임 — 표준 프로필: Claude 세션의 리뷰 → Codex, Codex 세션의 구현 → Claude. 상대 CLI 가 있으면 전달자 에이전트, 없으면 fallback 모델
{
  const kitLib = require('./kit.js');
  const cat = JSON.parse(fs.readFileSync(path.join(KIT, 'packs', 'core', 'models.json'), 'utf8'));
  const models = kitLib.profileModels(cat, 'standard');
  const roles = ['reviewer', 'implementer'].map((name) => ({ name, title: name, description: `${name} 역할`, access: name === 'reviewer' ? 'read-only' : 'workspace-write', effort: 'medium', body: 'BODY', src: `packs/core/agents/${name}.md` }));
  const withCli = kitLib.buildAgentFiles(roles, models, { cliFor: () => true });
  const warn = [];
  const noCli = kitLib.buildAgentFiles(roles, models, { cliFor: () => false, warnings: warn });
  // 위임 역할은 그 도구의 서브에이전트 파일이 없고, 위임 표(PC 별 지침)에 오른다
  const dc = withCli.delegations;
  // 리뷰는 두 도구 모두 상대 회사 모델 (Claude 세션 → Codex, Codex 세션 → Claude)
  const delegated = !withCli.files.has('.claude/agents/reviewer.md') && !withCli.files.has('.codex/agents/reviewer.toml')
    && !withCli.files.has('.codex/agents/implementer.toml') && withCli.files.has('.claude/agents/implementer.md')
    && dc.codex.some((d) => d.role === 'reviewer' && d.tool === 'claude' && d.model === 'opus' && d.mode === 'read')
    && dc.claude.some((d) => d.role === 'reviewer' && d.tool === 'codex' && d.model === 'gpt-6.1-sol' && d.mode === 'read')
    && dc.codex.some((d) => d.role === 'implementer' && d.tool === 'claude' && d.model === 'opus' && d.mode === 'write');
  const fellBack = /model: opus/.test(noCli.files.get('.claude/agents/reviewer.md')) && /model = "gpt-6\.1-sol"/.test(noCli.files.get('.codex/agents/implementer.toml')) && /model = "gpt-6\.1-sol"/.test(noCli.files.get('.codex/agents/reviewer.toml') || '') && warn.length === 3;
  // 실제 워크스페이스 sync — PC 별 지침에 위임 표
  const localMd = fs.existsSync(path.join(tmp, 'team-lead', 'CLAUDE.local.md')) ? fs.readFileSync(path.join(tmp, 'team-lead', 'CLAUDE.local.md'), 'utf8') : '';
  const section = !kitLib.splitModel || /역할 위임/.test(localMd) || !require('../packs/core/lib/cli.js').findCli('codex');
  const dry = spawnSync(process.execPath, [path.join(KIT, 'packs', 'core', 'bin', 'delegate.js'), 'start', '--to', 'codex', '--role', 'implementer', '--model', 'gpt-6.1-sol', '--mode', 'write', '--dry-run'], { cwd: path.join(tmp, 'team-lead'), input: '작업', encoding: 'utf8' });
  const dryOk = /"workspace-write"/.test(dry.stdout) && /"-C"/.test(dry.stdout);
  record('역할 위임 (상대 도구 모델)', delegated && fellBack && dryOk && section, `위임 역할은 서브에이전트 대신 위임 표 ${delegated} · CLI 없으면 대체 모델 ${fellBack} · delegate 명령 ${dryOk} · PC 별 지침 ${section}`);
}

// 리뷰 위임: 블로커 기준 · 같은 범위 차수 · 앞 차수 블로커 · [반복] 표시 · 실패 원인 · 실행 중 변경 감지 (가짜 codex)
{
  const dir = path.join(tmp, 'team-lead');
  const fakeBin = path.join(tmp, 'fake-codex-bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'codex'), `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv; const out = a[a.indexOf('-o') + 1]; const prompt = fs.readFileSync(0, 'utf8');
fs.writeFileSync(${JSON.stringify(path.join(tmp, 'fake-codex-prompt.md'))}, prompt);
const mode = process.env.FAKE_CODEX;
if (mode === '429') { process.stderr.write('ERROR: unexpected status 429 Too Many Requests: usage limit reached'); process.exit(1); }
if (mode === 'touch') fs.writeFileSync(${JSON.stringify(path.join(dir, 'stale-target.txt'))}, String(Date.now()));
if (mode === 'quote') { fs.writeFileSync(out, '결론: 발견 없음\\n- 확인: \`[반복]\` 처리가 문구와 일치합니다'); process.exit(0); }
fs.writeFileSync(out, mode === 'repeat' ? '결론: 블로커 1\\n1. [블로커][반복] order.js:3 — 같은 상태 흐름' : '결론: 블로커 1\\n1. [블로커][확인됨] order.js:3 — 주문 상태가 어긋남');
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  const del = (mode, ...a) => {
    const s = spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'delegate.js'), 'start', '--to', 'codex', '--role', 'reviewer', '--mode', 'read', ...a], { cwd: dir, input: mode === 'nocheck' ? '주문 탭 리뷰' : '주문 탭 리뷰\n검사: npm test 통과', encoding: 'utf8', env: { ...env, FAKE_CODEX: mode } });
    if (mode === 'nocheck') return { start: s.stdout, status: s.status };
    const id = (s.stdout.match(/작업 id: (\S+)/) || [])[1];
    const w = id ? spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'delegate.js'), 'wait', id, '--timeout', '30'], { cwd: dir, encoding: 'utf8', env }) : { stdout: '' };
    return { start: s.stdout, result: w.stdout, prompt: fs.existsSync(path.join(tmp, 'fake-codex-prompt.md')) ? fs.readFileSync(path.join(tmp, 'fake-codex-prompt.md'), 'utf8') : '' };
  };
  const r1 = del('ok', '--scope', '주문탭');
  const bar = /블로커 기준/.test(r1.prompt) && !/앞 차수 리뷰/.test(r1.prompt) && /주문탭」 1차/.test(r1.result);
  const r2 = del('repeat', '--scope', '주문탭');
  const prior = /앞 차수 리뷰 \(같은 범위 「주문탭」 2차\)/.test(r2.prompt) && /주문 상태가 어긋남/.test(r2.prompt) && !/⚠ 같은 범위/.test(r2.start) && /\[반복\]\)/.test(r2.result);
  const r3 = del('ok', '--scope', '주문탭');
  const third = /⚠ 같은 범위 「주문탭」 3차 리뷰/.test(r3.start);
  const other = !/# 앞 차수 리뷰/.test(del('ok', '--scope', '다른범위').prompt);
  const r429 = del('429');
  const retryCmd = (r429.result.match(/상대 도구로 다시: (node packs\/core\/bin\/delegate\.js start --to claude --role reviewer --mode read --task-file (\S+))/) || []);
  const failed = /⚠ 실패 원인: 사용량 한도\(429\) · 대안:/.test(r429.result) && !!retryCmd[2] && fs.readFileSync(retryCmd[2].replace(/^'|'$/g, ''), 'utf8').includes('주문 탭 리뷰');
  // 읽기 전용 claude 리뷰어: 읽기용 셸만 (git diff · show · grep), plan 모드
  const rd = spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'delegate.js'), 'start', '--to', 'claude', '--role', 'reviewer', '--mode', 'read', '--dry-run'], { cwd: dir, input: '리뷰\n검사: npm test 통과', encoding: 'utf8', env });
  const rdArgs = (() => { try { return JSON.parse(rd.stdout).args; } catch { return []; } })();
  const allowed = rdArgs[rdArgs.indexOf('--allowedTools') + 1] || '';
  const readShell = rdArgs.includes('plan') && /Bash\(git diff:\*\)/.test(allowed) && /Bash\(git show:\*\)/.test(allowed) && !/(^|,)Bash(,|$)/.test(allowed) && /셸은 읽기 명령/.test(rd.stdout);
  const touched = del('touch');
  const stale = /⚠ 실행 중 대상이 바뀌어 결과가 낡았을 수 있음: \(워크스페이스\) stale-target\.txt/.test(touched.result) && !/낡았을/.test(r3.result);
  fs.rmSync(path.join(dir, 'stale-target.txt'), { force: true });
  const quoted = [del('quote', '--scope', '인용'), del('quote', '--scope', '인용')].every((q) => /발견 없음/.test(q.result) && !/⚠ 앞 차수와 같은 영역/.test(q.result));
  const nc = del('nocheck');
  const checkGate = nc.status === 6 && /검사: <명령> 통과/.test(nc.start) && /회귀는 머리로 판정하지 않는다/.test(r1.prompt);
  record('리뷰 위임 (블로커 기준 · 차수 · 반복 · 실패 원인 · 실행 중 변경 · 검사 줄)', bar && prior && third && other && failed && readShell && stale && checkGate && quoted, `블로커 기준 · 1차 ${bar} · 2차에 앞 블로커 · [반복] ${prior} · 인용한 [반복] 은 안 셈 ${quoted} · 3차 경고 ${third} · 다른 범위는 따로 ${other} · 429 원인과 상대 도구로 다시 ${failed} · claude 읽기 리뷰어 셸 ${readShell} · 실행 중 변경 ${stale} · 검사 줄 없으면 막음 ${checkGate}`);
}

// 토론 모드: 가짜 codex · claude 로 1차 따로 → 2차 판정(근거 없는 동의는 보류 · 놓친 것) → 3차 갈린 것만 · 동시 상한보다 큰 패널 · 실패한 모델은 빠짐으로 · 없는 도구면 시작 안 함
{
  const dir = path.join(tmp, 'team-lead');
  const fakeBin = path.join(tmp, 'fake-debate-bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const brain = path.join(fakeBin, 'brain.js');
  fs.writeFileSync(brain, `module.exports = (who, p) => {
  const ids = (sec) => [...p.split(sec)[1].matchAll(/^- ([A-DN]\\d+) \\[[^\\]]+\\] (.+)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
  if (/# 토론 1차/.test(p)) return who === 'codex' ? '## 주장\\n- [블로커] 주문 상태 덮어씀 — order.js:3\\n- [권장] 함수 이름 바꾸기 — a.js:1' : '## 주장\\n- [블로커] 저장 전 상태 바뀜 — order.js:3\\n- [참고] 로그 많음 — log.js:2';
  if (/# 토론 2차/.test(p)) return '## 판정\\n' + ids('# 주장 목록').map((c) => (who === 'codex' && /로그/.test(c.text) ? '- ' + c.id + ': 반대 — 디버그 전용이라 운영에서 꺼짐' : who !== 'codex' && /이름/.test(c.text) ? '- ' + c.id + ': 반대 — 요청 범위 밖의 이름 변경' : who !== 'codex' && /덮어씀/.test(c.text) ? '- ' + c.id + ': 동의' : '- ' + c.id + ': 동의 — order.js:3 직접 확인')).join('\\n') + '\\n## 놓친 것\\n' + (who === 'codex' ? '없음' : '- [권장] 재시도 없음 — order.js:9');
  if (/# 토론 3차/.test(p)) return '## 판정\\n' + ids('# 갈린 주장').map((c) => (who !== 'codex' && /이름/.test(c.text) ? '- ' + c.id + ': 반대 — 여전히 범위 밖 a.js:1' : '- ' + c.id + ': 동의 — 다시 확인함 해당 줄')).join('\\n');
  return '';
};`);
  fs.writeFileSync(path.join(fakeBin, 'codex'), `#!/usr/bin/env node
const fs = require('fs'); const a = process.argv; const p = fs.readFileSync(0, 'utf8');
if (process.env.FAKE_DEBATE_FAIL === 'codex') { process.stderr.write('429 Too Many Requests usage limit'); process.exit(1); }
fs.writeFileSync(a[a.indexOf('-o') + 1], require(${JSON.stringify(brain)})('codex', p));
`, { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'claude'), `#!/usr/bin/env node
const p = require('fs').readFileSync(0, 'utf8'); const a = process.argv;
console.log(JSON.stringify({ type: 'result', result: require(${JSON.stringify(brain)})('claude-' + a[a.indexOf('--model') + 1], p) }));
`, { mode: 0o755 });
  const env = { ...process.env, CODEX_SANDBOX_NETWORK_DISABLED: '', PATH: `${fakeBin}${path.delimiter}${process.env.PATH}` };
  const tool = path.join(dir, 'packs', 'core', 'bin', 'debate.js');
  const debate = (panel, extra = {}) => {
    const s = spawnSync(process.execPath, [tool, 'start', '--panel', panel, '--topic', '주문'], { cwd: dir, input: '주문 탭 리뷰\n검사: npm test 통과', encoding: 'utf8', env: { ...env, ...extra } });
    const id = (s.stdout.match(/토론 id: (\S+)/) || [])[1];
    const w = id ? spawnSync(process.execPath, [tool, 'wait', id, '--timeout', '120'], { cwd: dir, encoding: 'utf8', env: { ...env, ...extra } }) : { stdout: '' };
    return { start: s.stdout, status: s.status, out: w.stdout, id };
  };
  const two = debate('codex:gpt-6.1-sol:high,claude:opus:high:보안');
  const counts = /주장 5개: 합의 4 · 갈림 1 · 기각 0 · 한 모델만 0/.test(two.out);
  const lazy = /근거 없는 동의 · 반대는 보류로 셈: \w 1건/.test(two.out) && /함수 이름 바꾸기[^\n]*(?:\n {2}- [^\n]*)*\n {2}- \w 반대: 여전히 범위 밖/.test(two.out) && /N1 \[권장\] 재시도 없음/.test(two.out);
  const raw = (two.out.match(/원문: (\S+) /) || [])[1] || '';
  const rounds = /· 3회 ·/.test(two.out) && !!raw && fs.existsSync(path.join(raw, 'round-3-A.md')) && fs.existsSync(path.join(raw, 'round-1-B.task.md'));
  // 진행 보기: watch 는 끝난 토론이면 전체 진행을 다시 보여 주고 닫힌다. wait --round 는 본 데까지 기억해 두 번째는 결과만
  const watchOut = spawnSync(process.execPath, [tool, 'watch', two.id], { cwd: dir, encoding: 'utf8', env, timeout: 30000 }).stdout;
  const watched = ['▶ 토론 시작', '── 1차 시작', '1차 끝', '── 2차 시작', '2차 정리', '── 3차 시작', '■ 토론 끝'].every((k) => watchOut.includes(k)) && /갈림 \w+ \[권장\] 함수 이름 바꾸기/.test(watchOut);
  const onceRun = spawnSync(process.execPath, [tool, 'watch', two.id, '--once'], { cwd: dir, encoding: 'utf8', env, timeout: 15000 });
  const once = onceRun.status === 0 && onceRun.stdout.includes('■ 토론 끝') && !onceRun.stdout.includes('Ctrl+C');
  const relay1 = spawnSync(process.execPath, [tool, 'wait', two.id, '--round'], { cwd: dir, encoding: 'utf8', env }).stdout;
  const relay2 = spawnSync(process.execPath, [tool, 'wait', two.id, '--round'], { cwd: dir, encoding: 'utf8', env }).stdout;
  const relayed = relay1.includes('── 1차 시작') && relay1.includes('# 토론 결과') && !relay2.includes('── 1차 시작') && relay2.includes('# 토론 결과') && /kedovi debate watch/.test(two.start);
  const three = debate('codex:gpt-6.1-sol,claude:opus,claude:sonnet');
  const big = /패널 A=[^\n]*C=/.test(three.out) && !/빠진 모델/.test(three.out);
  const failed = debate('codex:gpt-6.1-sol,claude:opus', { FAKE_DEBATE_FAIL: 'codex' });
  const dropped = /⚠ 빠진 모델 \(다른 모델로 대신하지 않았다\): \w=codex:gpt-6\.1-sol 1차: 사용량 한도\(429\)/.test(failed.out) && /2개가 안 돼 토론이 중간에 멈췄습니다/.test(failed.out);
  const same = /모두 같은 회사 모델/.test(spawnSync(process.execPath, [tool, 'start', '--panel', 'claude:opus,claude:sonnet', '--dry-run'], { cwd: dir, input: '리뷰\n검사: npm test 통과', encoding: 'utf8', env }).stdout);
  const noCli = spawnSync(process.execPath, [tool, 'start', '--panel', 'codex:x,claude:y'], { cwd: dir, input: '리뷰\n검사: npm test 통과', encoding: 'utf8', env: { ...process.env, PATH: path.dirname(process.execPath), HOME: path.join(tmp, 'no-home') } });
  const blockedStart = noCli.status === 3 && /토론을 시작하지 않습니다/.test(noCli.stdout);
  const boxed = spawnSync(process.execPath, [tool, 'start', '--panel', 'codex:gpt-6.1-sol,claude:opus'], { cwd: dir, input: '리뷰\n검사: npm test 통과', encoding: 'utf8', env: { ...env, CODEX_SANDBOX_NETWORK_DISABLED: '1' } });
  const sandboxed = boxed.status === 4 && /샌드박스 밖에서 실행하도록/.test(boxed.stdout) && !/토론 id/.test(boxed.stdout);
  const models = spawnSync(process.execPath, [tool, 'models', '--task', 'docs'], { cwd: dir, encoding: 'utf8', env }).stdout;
  const listed = /✔ codex:gpt-6\.1-sol/.test(models) && /패널 예시 \(다른 회사 먼저\): --panel /.test(models) && /언어 \d/.test(models);
  record('토론 모드 (1차 따로 · 2차 판정 · 3차 갈린 것만 · 근거 없는 동의 · 큰 패널 · 빠진 모델 · Codex 샌드박스 · 진행 보기 · 모델 목록)', counts && lazy && rounds && big && dropped && same && blockedStart && sandboxed && watched && once && relayed && listed, `합의 · 갈림 수 ${counts} · 근거 없는 동의 보류 · 양쪽 근거 · 놓친 것 ${lazy} · 3회 · 회차 원문 ${rounds} · 동시 상한보다 큰 패널 ${big} · 실패는 빠짐으로 ${dropped} · 같은 회사 경고 ${same} · 없는 도구면 시작 안 함 ${blockedStart} · 샌드박스면 시작 전 멈춤 ${sandboxed} · 실시간 보기 ${watched} · 채팅용 한 번 보기 ${once} · 회차 중계 ${relayed} · 쓸 수 있는 모델 ${listed}`);
}

// 화면 문구에 장식용 대시(—)를 쓰지 않는다 — 킷 코드의 문자열 안 " — " (주석·테스트 제외)
{
  const files = [...['kedovi.js', 'kit.js', 'models.js', 'docs.js'].map((f) => path.join(KIT, 'bin', f)),
    ...walk(path.join(KIT, 'packs'), (p) => /\/(bin|hooks|lib)\/[^/]+\.js$/.test(p) && !p.endsWith('.test.js'))];
  const hits = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      for (const m of l.matchAll(/(['"`])((?:\\.|(?!\1).)*?)\1/g)) if (m[2].includes(' — ')) { hits.push(`${path.relative(KIT, f)}:${i + 1}`); break; }
    });
  }
  record('화면 문구에 대시 없음', hits.length === 0, hits.length ? hits.slice(0, 5).join(' · ') : `파일 ${files.length}개`);
}

// 규칙 끄기·바꾸기 — rules.off 로 빠짐, 필수 규칙은 막힘, project 규칙의 replaces 가 대신 들어감
{
  const dir = path.join(tmp, 'rules-ws');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new', '--code', 'new:api'], tmp);
  const wsFile = path.join(dir, 'workspace.json');
  const ws = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
  ws.repos[0].stacks = ['spring'];
  ws.rules = { off: ['backend--80-testing'] };
  fs.writeFileSync(wsFile, JSON.stringify(ws, null, 2));
  fs.mkdirSync(path.join(dir, 'packs', 'project', 'rules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'packs', 'project', 'rules', 'team-logging.md'), '---\ntitle: 우리 팀 로깅\nload: on-demand\nwhen: 로그를 남길 때\nreplaces: stack-spring--50-logging\n---\n\n- 사내 로거\n');
  const ok1 = run(process.execPath, ['bin/kit.js', 'sync'], dir).ok;
  const md = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  const offOk = !md.includes('backend--80-testing') && !md.includes('stack-spring--50-logging') && /project--team-logging\.md` \| api/.test(md);
  ws.rules.off.push('core--26-safety');
  fs.writeFileSync(wsFile, JSON.stringify(ws, null, 2));
  const bad = run(process.execPath, ['bin/kit.js', 'sync'], dir);
  const reqOk = !bad.ok && /필수 규칙이라 끌 수 없습니다/.test(bad.out);
  record('규칙 끄기·바꾸기 (rules.off · replaces · 필수)', ok1 && offOk && reqOk, `끄기·대체 ${ok1 && offOk} · 필수 막기 ${reqOk}`);
}

// 팀원 설정 수정 불가 — 관리자 아닌 사람은 자기 handoffs/ 밖 커밋 거부, Claude 편집 금지, 허용으로 바꾸면 모두 걷힘
{
  const dir = path.join(tmp, 'lock-ws');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new'], tmp);
  const g = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  g('config', 'user.name', 'lead'); g('config', 'user.email', 'l@t'); g('config', 'core.hooksPath', '.githooks');
  const wsFile = path.join(dir, 'workspace.json');
  const setTeam = (t) => { const w = JSON.parse(fs.readFileSync(wsFile, 'utf8')); w.team = t; fs.writeFileSync(wsFile, JSON.stringify(w, null, 2)); run(process.execPath, ['bin/kit.js', 'sync'], dir); };
  setTeam({ admins: ['lead'], lock: true });
  g('add', '-A'); const leadCommit = g('commit', '-qm', 'init').status === 0;
  g('config', 'user.name', 'mate'); run(process.execPath, ['bin/kit.js', 'sync'], dir);
  fs.writeFileSync(path.join(dir, 'workspace.json'), fs.readFileSync(wsFile, 'utf8').replace('"lead"', '"lead" '));
  g('add', 'workspace.json'); const blocked = g('commit', '-qm', 'x').status !== 0; g('reset', '-q', 'HEAD', 'workspace.json'); g('checkout', '-q', 'workspace.json');
  fs.mkdirSync(path.join(dir, 'handoffs', 'mate'), { recursive: true }); fs.writeFileSync(path.join(dir, 'handoffs', 'mate', 'TODO.md'), '# x\n');
  g('add', 'handoffs/mate'); const own = g('commit', '-qm', 'handoff').status === 0;
  fs.appendFileSync(path.join(dir, 'handoffs', 'PLAN.md'), '\n');
  g('add', 'handoffs/PLAN.md'); const plan = g('commit', '-qm', 'plan').status === 0;
  fs.writeFileSync(path.join(dir, 'handoffs', 'MODELS.md'), '# 모델 조사\n');
  g('add', 'handoffs/MODELS.md'); const models = g('commit', '-qm', 'models').status === 0;
  const deny = () => { try { return (JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8')).permissions.deny || []).length; } catch { return 0; } };
  const guarded = deny() === 11;
  g('config', 'user.name', 'lead'); setTeam({ admins: ['lead'], lock: false }); g('config', 'user.name', 'mate'); run(process.execPath, ['bin/kit.js', 'sync'], dir);
  const cleared = deny() === 0;
  record('팀원 설정 수정 불가 (커밋 훅 · Claude 편집 금지)', leadCommit && blocked && own && plan && models && guarded && cleared, `관리자 커밋 ${leadCommit} · 팀원 설정 커밋 거부 ${blocked} · 팀원 핸드오프 커밋 ${own} · 팀원 로드맵·모델 조사 커밋 ${plan && models} · 편집 금지 ${guarded} · 허용 시 해제 ${cleared}`);
}

// 옛 유형 옮기기 — 유지보수(maintenance) 워크스페이스는 옮기기 전에도 sync 되고, upgrade 의 migrateTypes 가 운영·고도화로 바꾼다. ticket 스킬은 모든 유형에
{
  const dir = path.join(tmp, 'old-sm');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'enhancement', '--code', path.join(tmp, 'fixtures-web-placeholder')], tmp);
  const wsFile = path.join(dir, 'workspace.json');
  const got = [];
  if (fs.existsSync(wsFile)) {
    const w = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
    w.project.type = 'maintenance'; w.packs = w.packs.map((pk) => (pk === 'enhancement' ? 'maintenance' : pk));
    fs.writeFileSync(wsFile, JSON.stringify(w, null, 2));
  }
  const before = run(process.execPath, ['bin/kit.js', 'sync'], dir).ok;
  const msg = require('./kit.js').migrateTypes(dir);
  const after = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
  const moved = !!msg && after.project.type === 'enhancement' && after.packs.includes('enhancement') && !after.packs.includes('maintenance');
  const ticketEverywhere = fs.existsSync(path.join(tmp, 'new', '.agents', 'skills', 'ticket', 'SKILL.md')) || fs.existsSync(path.join(tmp, 'new', '.claude', 'skills', 'ticket', 'SKILL.md'));
  got.push(`옮기기 전 sync ${before}`, `옮김 ${moved}`, `신규 유형에도 ticket 스킬 ${ticketEverywhere}`);
  record('옛 유형 옮기기 (유지보수 → 운영·고도화)', before && moved && ticketEverywhere, got.join(' · '));
}

// upgrade 가 템플릿 .gitignore 의 없는 줄을 보강한다 — npm 설치본 결함(0.24 이전)으로 기본 줄이 빠진 워크스페이스를 upgrade 한 번으로 고친다
{
  const dir = path.join(tmp, 'old-gi');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new'], tmp);
  const gi = path.join(dir, '.gitignore');
  const got = [];
  if (fs.existsSync(gi)) fs.writeFileSync(gi, fs.readFileSync(gi, 'utf8').split('\n').filter((l) => !['node_modules/', 'scripts/'].includes(l.trim())).join('\n'));
  const up = run(process.execPath, ['bin/kit.js', 'upgrade', '--from', KIT], dir);
  const lines = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8').split('\n').map((l) => l.trim()) : [];
  const restored = ['node_modules/', 'scripts/'].every((l) => lines.includes(l));
  const once = lines.filter((l) => l === 'node_modules/').length === 1;
  const kitBlock = lines.includes('/repos/') && lines.indexOf('node_modules/') < lines.findIndex((l) => l.startsWith('# >>> kit'));
  got.push(`upgrade ${up.ok}`, `기본 줄 복구 ${restored}`, `중복 없음 ${once}`, `kit 블록 앞에·유지 ${kitBlock}`);
  record('upgrade 가 .gitignore 기본 줄 보강', up.ok && restored && once && kitBlock, got.join(' · '));
}

// 화면 없이 설정 바꾸기 (AI 가 대신 실행) — models profile · set(위임 포함) · agent --codex
{
  const dir = path.join(tmp, 'noui-ws');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new'], tmp);
  const kedovi = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), ...a], { cwd: dir, encoding: 'utf8', input: '', env: { ...process.env, KEDOVI_HOME: path.join(tmp, 'noui-home') } });
  const p1 = kedovi('models', 'profile', 'lean').status === 0;
  const p2 = kedovi('models', 'set', 'reviewer', 'claude', 'codex:gpt-6.1-sol', '--effort', 'high').status === 0;
  const local = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'local.json'), 'utf8'));
  const saved = local.agents.profile === 'lean' && local.agents.roles.reviewer.claude === 'codex:gpt-6.1-sol';
  const higher = kedovi('models', 'profile', 'rich');
  const p3 = higher.status !== 0 && /팀 프로필\(표준\)과 같거나 낮은 것만/.test(higher.stderr + higher.stdout); // 팀(표준)보다 높은 프로필은 거부
  const p4 = kedovi('models', 'allow-higher', 'on').status === 0 && kedovi('models', 'profile', 'rich').status === 0; // 팀이 허용하면 된다
  const p5 = kedovi('agent', '--codex').status === 0 && kedovi('agent', '--codex', '--profile', 'lean').status !== 0; // 프로필은 kedovi models profile 로만
  const after = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'local.json'), 'utf8'));
  const agentOk = after.agent === 'codex' && after.agents.profile === 'rich';
  // 되돌리기: team · - · 팀(호환) 모두 이 PC 값을 지운다
  const localProfile = () => JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'local.json'), 'utf8')).agents.profile;
  const cleared = kedovi('models', 'profile', 'team').status === 0 && localProfile() === undefined
    && kedovi('models', 'profile', 'lean').status === 0 && localProfile() === 'lean' && kedovi('models', 'profile', '-').status === 0 && localProfile() === undefined
    && kedovi('models', 'profile', 'lean').status === 0 && kedovi('models', 'profile', '팀').status === 0 && localProfile() === undefined
    && kedovi('models', 'profile').status !== 0; // 비대화형에서 인자 없음 = 사용법
  const bad = kedovi('models', 'set', 'main', 'claude', 'codex:gpt-6.1-sol').status !== 0;
  const skill = fs.existsSync(path.join(dir, '.agents', 'skills', 'kedovi', 'SKILL.md')) || fs.existsSync(path.join(dir, '.claude', 'skills', 'kedovi', 'SKILL.md'));
  record('화면 없이 설정 바꾸기 (models · agent · kedovi 스킬)', p1 && p2 && saved && p3 && p4 && p5 && agentOk && cleared && bad && skill, `프로필·역할 ${p1 && p2 && saved} · 높은 프로필 거부 ${p3} · 허용 ${p4} · 메인 에이전트 ${p5 && agentOk} · 되돌리기 team · - · 팀 ${cleared} · 메인 위임 거부 ${bad} · 스킬 ${skill}`);
}

// AI 연결 방식 — 쓰는 AI · 구성 · 게이트웨이에 따라 역할 모델이 바뀐다. kedovi ai 는 키 값을 저장하지 않는다
{
  const kitLib = require('./kit.js');
  const cat = JSON.parse(fs.readFileSync(path.join(KIT, 'packs', 'core', 'models.json'), 'utf8'));
  const base = kitLib.profileModels(cat, 'standard');
  const apply = (a) => kitLib.applyAccess(base, kitLib.normalizeAccess(a));
  const got = [];
  const cOnly = apply({ connection: 'direct', vendors: ['claude'] });
  // 리뷰는 Codex 위임 → 같은 회사 대체(opus). 테스트는 처음부터 Claude 모델(haiku)이라 그대로
  const claudeOnly = cOnly.roles.reviewer.claude === 'opus' && cOnly.roles.tester.claude === 'haiku' && !cOnly.crossReview.codex;
  const xOnly = apply({ connection: 'direct', vendors: ['codex'] });
  const gptOnly = xOnly.roles.implementer.codex === 'gpt-6.1-sol' && kitLib.startToolOf(kitLib.normalizeAccess({ connection: 'direct', vendors: ['codex'] })) === 'codex';
  const single = Object.values(apply({ compose: 'single' }).roles).every((m) => !m.claude && !m.codex);
  const gw = { models: ['claude/claude-opus-5-5', 'claude/claude-sonnet-5-5', 'claude/claude-haiku-4-5', 'codex/gpt-6.1-sol', 'codex/gpt-6-luna'], aliases: false };
  const g = apply({ connection: 'gateway', gateway: gw });
  const native = g.roles.reviewer.claude === 'codex/gpt-6.1-sol' && g.roles.analyst.claude === 'claude/claude-opus-5-5[1m]' && g.roles.implementer.codex === 'claude:claude/claude-opus-5-5[1m]' && g.main.codex === 'codex/gpt-6.1-sol';
  // 1M 모델의 게이트웨이 이름에는 [1m] (Claude Code 가 모르는 이름을 200k 로 본다). 옛 200k 모델 · GPT · 별칭 연결은 그대로
  const win = kitLib.gatewayId(gw, 'claude', 'haiku') === 'claude/claude-haiku-4-5' && kitLib.gatewayId(gw, 'claude', 'claude/claude-opus-5-5[1m]') === 'claude/claude-opus-5-5[1m]'
    && kitLib.gatewayId(gw, 'codex', 'gpt-6.1-sol') === 'codex/gpt-6.1-sol' && kitLib.gatewayId({ ...gw, aliases: true }, 'claude', 'opus') === 'opus'
    // 게이트웨이마다 다른 이름 모양 (클라우드 접두사 · 버전 표기 · 날짜 · 대소문자)
    && ['anthropic/Claude-Opus-5.5', 'us.anthropic.claude-opus-5-5-v1:0', 'claude-opus-5-5@20260922', 'opus-5-5'].every((n) => kitLib.gatewayId({ models: [n, 'x/claude-opus-4-1'] }, 'claude', 'opus') === `${n}[1m]`)
    && kitLib.gatewayVendors(['us.anthropic.claude-sonnet-5-5-v1:0', 'openai.gpt-6-luna']).join() === 'claude,codex';
  const gv = apply({ connection: 'gateway', gateway: gw, main: 'codex', compose: 'vendor' });
  const gptMain = gv.main.claude === 'codex/gpt-6.1-sol' && Object.values(gv.roles).every((m) => /^codex\/gpt/.test(m.claude));
  // 게이트웨이의 haiku 가 5.5 보다 옛 버전이면 테스트는 대체 모델(GPT-6 Luna max). 5.5 가 있으면 haiku xhigh, GPT 를 못 쓰면 haiku 를 추론 강도 없이 + 경고
  const effortOf = (m, t) => (typeof (m || {}).effort === 'string' ? m.effort : ((m || {}).effort || {})[t]);
  const gwNew = apply({ connection: 'gateway', gateway: { ...gw, models: [...gw.models, 'claude/claude-haiku-5-5'] } });
  const gwWarn = [];
  const gwClaude = kitLib.applyAccess(base, kitLib.normalizeAccess({ connection: 'gateway', gateway: { models: ['claude/claude-opus-5-5', 'claude/claude-sonnet-5-5', 'claude/claude-haiku-4-5'], aliases: false } }), gwWarn);
  const oldHaiku = g.roles.tester.claude === 'codex/gpt-6-luna' && effortOf(g.roles.tester, 'claude') === 'max'
    && /claude-haiku-5-5/.test(gwNew.roles.tester.claude) && effortOf(gwNew.roles.tester, 'claude') === 'xhigh'
    && gwClaude.roles.tester.claude === 'claude/claude-haiku-4-5' && !effortOf(gwClaude.roles.tester, 'claude') && gwWarn.some((w) => /tester\(claude\).*옛 버전/.test(w))
    && cOnly.roles.tester.claude === 'haiku' && effortOf(cOnly.roles.tester, 'claude') === 'xhigh'
    // 직접 고른 테스트 모델(sonnet)에는 대체를 적용하지 않는다
    && (() => { const picked = JSON.parse(JSON.stringify(base)); picked.roles.tester.claude = 'sonnet'; const w = []; const r = kitLib.applyAccess(picked, kitLib.normalizeAccess({ connection: 'gateway', gateway: { ...gw, models: ['claude/claude-opus-4-8', 'claude/claude-sonnet-4-6', 'claude/claude-haiku-4-5', 'codex/gpt-6-luna'] } }), w); return r.roles.tester.claude === 'claude/claude-sonnet-4-6' && !w.some((x) => /tester\(claude\).*옛 버전/.test(x)); })();
  got.push(`Claude 만 ${claudeOnly}`, `GPT 만 ${gptOnly}`, `단일 모델 ${single}`, `게이트웨이 하위 에이전트 ${native}`, `1M 창 [1m] ${win}`, `게이트웨이 GPT 메인 ${gptMain}`, `게이트웨이 옛 Haiku 대체 ${oldHaiku}`);
  // kedovi ai — 화면 없이. 조회가 실패해도 저장하고, 키 값은 어디에도 없다
  const dir = path.join(tmp, 'ai-ws');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new'], tmp);
  const secret = 'kedovi-selftest-secret-7f3a'; // gitleaks:allow (시험용 가짜 값)
  const kedovi = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), ...a], { cwd: dir, encoding: 'utf8', input: '', env: { ...process.env, KEDOVI_HOME: path.join(tmp, 'ai-home'), SELFTEST_GW_KEY: secret } });
  const d1 = kedovi('ai', 'direct', 'claude').status === 0;
  const local1 = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'local.json'), 'utf8'));
  const reviewer1 = fs.readFileSync(path.join(dir, '.claude', 'agents', 'reviewer.md'), 'utf8');
  const direct = d1 && local1.agent === 'claude' && local1.agents.access.vendors.join() === 'claude' && /model: opus/.test(reviewer1);
  const d2 = kedovi('ai', 'gateway', '--url', 'http://127.0.0.1:9/v1', '--key-env', 'SELFTEST_GW_KEY').status === 0;
  const local2 = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'local.json'), 'utf8'));
  const gwSaved = d2 && local2.agents.access.connection === 'gateway' && local2.agents.access.gateway.url === 'http://127.0.0.1:9' && local2.agents.access.gateway.keyEnv === 'SELFTEST_GW_KEY';
  const leaked = walk(dir, (f) => !f.includes(`${path.sep}.git${path.sep}`) && !f.includes(`${path.sep}repos${path.sep}`)).filter((f) => { try { return fs.readFileSync(f, 'utf8').includes(secret); } catch { return false; } });
  const d3 = kedovi('ai', 'compose', 'single').status === 0;
  const shown = kedovi('ai', 'show');
  let show = {};
  try { show = JSON.parse(shown.stdout); } catch { /* 실패 */ }
  const cmds = d3 && show.compose === 'single' && Object.values(show.roles || {}).every((v) => v === '메인과 같게') && kedovi('ai', 'main', 'gpt').status === 0 && kedovi('ai', 'nope').status !== 0;
  got.push(`kedovi ai direct ${direct}`, `gateway 저장 ${gwSaved}`, `키 값 저장 안 함 ${leaked.length === 0}`, `compose · show · main ${cmds}`);
  record('AI 연결 방식 (쓰는 AI · 구성 · 게이트웨이 · kedovi ai)', claudeOnly && gptOnly && single && native && win && gptMain && oldHaiku && direct && gwSaved && leaked.length === 0 && cmds, got.join(' · '));
}

// 역할 에이전트 상한 — Claude 훅이 한 요청의 개수를 세고 넘으면 막는다. Codex 훅에는 넣지 않고 config.toml 동시 상한으로
{
  const dir = path.join(tmp, 'ai-ws');
  const local = JSON.parse(fs.readFileSync(path.join(dir, '.agents', 'local.json'), 'utf8'));
  local.agents.limits = { parallel: 5, total: 2 };
  fs.writeFileSync(path.join(dir, '.agents', 'local.json'), JSON.stringify(local, null, 2));
  const hook = (ev) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'agent-budget.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 'selftest-budget', hook_event_name: ev, tool_name: 'Agent' }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout;
  hook('UserPromptSubmit');
  const outs = [hook('PreToolUse'), hook('PreToolUse'), hook('PreToolUse')];
  const denied = !outs[0] && !outs[1] && /"permissionDecision":"deny"/.test(outs[2]);
  hook('UserPromptSubmit');
  const reset = !hook('PreToolUse');
  const claudeHooks = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  const codexHooks = fs.readFileSync(path.join(dir, '.codex', 'hooks.json'), 'utf8');
  const wired = /agent-budget/.test(claudeHooks) && !/agent-budget/.test(codexHooks) && /max_concurrent_threads_per_session = \d/.test(fs.readFileSync(path.join(dir, '.codex', 'config.toml'), 'utf8'));
  // 이 PC 값은 팀 값(표준 4 · 10)보다 낮게만: 동시 5 는 4 로 눌리고 모두 2 는 그대로
  const capped = /동시 4개 · 모두 2개\*\*까지 \(팀 4 · 10 보다 낮춘 이 PC 값\)/;
  const limitsText = capped.test(fs.readFileSync(path.join(dir, 'CLAUDE.local.md'), 'utf8')) || spawnSync(process.execPath, [path.join(dir, 'bin', 'kit.js'), 'sync', '--quiet'], { cwd: dir }).status === 0 && capped.test(fs.readFileSync(path.join(dir, 'CLAUDE.local.md'), 'utf8'));
  record('역할 에이전트 상한 (훅 · Codex 동시 상한 · 개인 지침)', denied && reset && wired && limitsText, `넘으면 막음 ${denied} · 새 요청이면 다시 셈 ${reset} · Claude 훅만·Codex 설정 ${wired} · 개인 지침 ${limitsText}`);
}

// 역할 에이전트 실행 방식 — SessionStart 훅이 환경(팀 기능 · teammateMode · tmux)으로 팀 모드/서브에이전트를 판정한다 (Claude 만)
{
  const dir = path.join(tmp, 'new');
  const home = path.join(tmp, 'home-teams'); fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const withTmux = path.join(tmp, 'bin-tmux'); fs.mkdirSync(withTmux, { recursive: true }); fs.writeFileSync(path.join(withTmux, 'tmux'), '#!/bin/sh\n'); fs.chmodSync(path.join(withTmux, 'tmux'), 0o755);
  const noTmux = path.join(tmp, 'bin-none'); fs.mkdirSync(noTmux, { recursive: true });
  const hook = (mode, env) => { fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ teammateMode: mode })); return spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'team-mode.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: '{}', env: { PATH: withTmux, HOME: home, CLAUDE_PROJECT_DIR: dir, ...env } }).stdout; };
  const got = [];
  const off = /서브에이전트 · 사유: 팀 기능 꺼짐/.test(hook('tmux', {}));
  const outside = /팀 모드 \(tmux 창\. 세션 밖이라 Claude Code 가 tmux 세션을 만든다/.test(hook('tmux', { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }));
  const inside = /팀 모드 \(tmux 창\)/.test(hook('tmux', { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', TMUX: '/tmp/tmux-1/default,1,0' }));
  const missing = /서브에이전트 · 사유: tmux 미설치/.test(hook('tmux', { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', PATH: noTmux }));
  const inproc = /팀 모드 \(같은 터미널 안/.test(hook('in-process', { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }));
  const wired = /team-mode/.test(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')) && !/team-mode/.test(fs.readFileSync(path.join(dir, '.codex', 'hooks.json'), 'utf8'));
  got.push(`꺼짐 ${off}`, `tmux 밖(세션 생성) ${outside}`, `tmux 안 ${inside}`, `미설치 ${missing}`, `in-process ${inproc}`, `Claude 훅만 ${wired}`);
  record('역할 에이전트 실행 방식 (팀 모드 · 서브에이전트 판정)', off && outside && inside && missing && inproc && wired, got.join(' · '));
}

// 팀 모드에서 이름 없는 역할 에이전트 — 상한 훅이 막는다 (요약 뒤에도 실행 방식 줄을 다시 넣는다). 수준은 agents.enforce.teammateName, 이 PC 값은 팀보다 세게만
{
  const dir = path.join(tmp, 'new');
  const home = path.join(tmp, 'home-teams');
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ teammateMode: 'in-process' }));
  let n = 0;
  const hook = (toolInput, env = { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'agent-budget.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: `selftest-name-${n += 1}`, hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: toolInput }), env: { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: dir, ...env } }).stdout;
  const denied = (o) => /"permissionDecision":"deny"/.test(o);
  const role = fs.existsSync(path.join(dir, '.claude', 'agents', 'implementer.md'));
  const blocked = denied(hook({ subagent_type: 'implementer', prompt: 'x' })) && /name\(역할 이름/.test(hook({ subagent_type: 'implementer' }));
  const rosterLine = /이번 요청의 첫 역할 에이전트입니다/;
  const namedOut = hook({ subagent_type: 'implementer', name: 'implementer-api' });
  const named = !denied(namedOut) && rosterLine.test(namedOut); // 통과 + 첫 에이전트라 구성표 알림 한 줄
  n -= 1; const second = !hook({ subagent_type: 'implementer', name: 'implementer-web' }); // 같은 요청의 두 번째는 조용
  const other = !hook({ subagent_type: 'Explore' }) && !denied(hook({ subagent_type: 'implementer', isolation: 'worktree' })) && !hook({});
  const subagentMode = !denied(hook({ subagent_type: 'implementer' }, {}));
  const wsFile = path.join(dir, 'workspace.json');
  const localFile = path.join(dir, '.agents', 'local.json');
  const wsRaw = fs.readFileSync(wsFile, 'utf8');
  const localRaw = fs.existsSync(localFile) ? fs.readFileSync(localFile, 'utf8') : null;
  const setTeam = (v) => { const w = JSON.parse(wsRaw); w.agents = { ...(w.agents || {}), enforce: { teammateName: v } }; fs.writeFileSync(wsFile, JSON.stringify(w, null, 2)); };
  const setLocal = (v) => { const l = localRaw ? JSON.parse(localRaw) : {}; l.agents = { ...(l.agents || {}), enforce: { teammateName: v } }; fs.mkdirSync(path.dirname(localFile), { recursive: true }); fs.writeFileSync(localFile, JSON.stringify(l, null, 2)); };
  setTeam('warn');
  const warnOut = hook({ subagent_type: 'implementer' });
  const warned = !denied(warnOut) && /"additionalContext":"⚠ 팀 모드입니다/.test(warnOut) && rosterLine.test(warnOut);
  setLocal('block');
  const stricter = denied(hook({ subagent_type: 'implementer' }));
  setTeam('block'); setLocal('off');
  const notWeaker = denied(hook({ subagent_type: 'implementer' })); // 이 PC 에서 끄지 못한다
  { const w = JSON.parse(wsRaw); w.agents = { ...(w.agents || {}), enforce: { teammateName: 'off', rosterAnnounce: 'off' } }; fs.writeFileSync(wsFile, JSON.stringify(w, null, 2)); } if (localRaw) fs.writeFileSync(localFile, localRaw); else fs.rmSync(localFile, { force: true });
  const offOk = !hook({ subagent_type: 'implementer' });
  fs.writeFileSync(wsFile, wsRaw);
  const cli = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'team-mode', ...a], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: home } });
  const refused = cli('enforce', 'name', 'warn').status !== 0 && /세게만/.test(cli('enforce', 'name', 'warn').stderr + cli('enforce', 'name', 'warn').stdout);
  const shown = /이름 없는 역할 에이전트 \(팀 모드\)  막기/.test(cli().stdout) && /첫 역할 에이전트 때 구성표 알림  알림/.test(cli().stdout) && cli('enforce', 'roster', 'block').status !== 0;
  const settings = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  const reinject = ((JSON.parse(settings).hooks || {}).SessionStart || []).some((g) => g.matcher === 'startup|resume|clear|compact' && JSON.stringify(g).includes('team-mode'));
  const startLine = /이름 없이 띄우면 훅이 막는다/.test(spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'team-mode.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: '{}', env: { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } }).stdout);
  const all = { '역할 파일': role, '이름 없으면 막음': blocked, '이름 있으면 통과 + 구성표 알림': named, '두 번째는 조용': second, '킷 역할 아님 · isolation 통과': other, '서브에이전트 모드 통과': subagentMode, '경고 수준': warned, '이 PC 는 세게만': stricter && notWeaker, '끄기': offOk, '명령 거부 · 표시': refused && shown, '요약 뒤 재주입 연결': reinject, '시작 줄': startLine };
  // 대기 팀원 점검: 팀 설정 파일(가짜 Claude 설정 폴더)의 팀원 상태 + TeammateIdle 기록 → 멈출 때 한 번 막기 · 다시 알림 간격 · 수준 · 종료된 팀원 정리
  {
    const cfgDir = path.join(tmp, 'claude-cfg');
    const sid = 'abcdef12-0000-4000-8000-000000000000';
    const teamDir = path.join(cfgDir, 'teams', 'session-abcdef12');
    fs.mkdirSync(teamDir, { recursive: true });
    const lead = { agentId: 'team-lead@session-abcdef12', name: 'team-lead', agentType: 'team-lead' };
    const mate = (name, isActive) => ({ agentId: `${name}@session-abcdef12`, name, agentType: 'implementer', isActive });
    const setMembers = (...m) => fs.writeFileSync(path.join(teamDir, 'config.json'), JSON.stringify({ name: 'session-abcdef12', leadAgentId: lead.agentId, members: [lead, ...m] }));
    const idleHook = (ev, extra = {}) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'team-idle.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ hook_event_name: ev, session_id: sid, ...(ev === 'Stop' ? { last_assistant_message: okLine } : {}), ...extra }), env: { PATH: process.env.PATH, HOME: home, TMPDIR: require("os").tmpdir(), CLAUDE_PROJECT_DIR: dir, CLAUDE_CONFIG_DIR: cfgDir } }).stdout.trim();
    const okLine = '검사를 돌려 두었습니다.\n\n지금 도는 것: 없음 · 예상 종료: 모름 · 사용자가 할 일: 없음';
    const stFile = path.join(require(path.join(dir, 'packs', 'core', 'lib', 'workspace.js')).stateDir(fs.realpathSync(dir)), 'session-abcdef12.idle.json');
    const ago = (o) => { const st = { idle: {}, warned: {}, ...JSON.parse(fs.readFileSync(stFile, 'utf8')) }; for (const [k, name, min] of o) st[k][name] = Date.now() - min * 60000; fs.writeFileSync(stFile, JSON.stringify(st)); };
    const i = {};
    setMembers(mate('w1', false), mate('w2', true));
    idleHook('TeammateIdle', { teammate_name: 'w1', team_name: 'session-abcdef12', session_id: 'ffffffff-1111' });
    i['방금 대기는 조용'] = fs.existsSync(stFile) && !idleHook('Stop');
    ago([['idle', 'w1', 11]]);
    const blockedOut = idleHook('Stop');
    i['상한 넘으면 한 번 막음'] = /"decision":"block"/.test(blockedOut) && /w1\(대기 11분\)/.test(blockedOut) && !/w2/.test(blockedOut) && /TaskStop/.test(blockedOut);
    i['다시 알림 간격 안은 조용'] = !idleHook('Stop') && !idleHook('UserPromptSubmit');
    ago([['warned', 'w1', 31]]);
    const line = idleHook('UserPromptSubmit');
    i['간격 뒤 요청 시작 때 한 줄'] = /^⚠ 일을 마치고 대기 중인 팀원이 있습니다: w1\(대기 11분\)/.test(line) && line.split('\n').length === 1;
    ago([['warned', 'w1', 31]]);
    i['이미 막힌 멈춤은 통과'] = !idleHook('Stop', { stop_hook_active: true });
    const setLevel = (v, more = {}) => { const w = JSON.parse(wsRaw); w.agents = { ...(w.agents || {}), enforce: { idleTeammates: v, ...more } }; fs.writeFileSync(wsFile, JSON.stringify(w, null, 2)); };
    setLevel('warn');
    i['알림 수준은 막지 않음'] = !idleHook('Stop') && /^⚠/.test(idleHook('UserPromptSubmit'));
    ago([['warned', 'w1', 31]]); setLevel('off');
    i['끄기'] = !idleHook('Stop') && !idleHook('UserPromptSubmit');
    setLevel('block', { idleMinutes: 20 });
    i['대기 상한 바꾸기'] = !idleHook('Stop');
    fs.writeFileSync(wsFile, wsRaw);
    setMembers(mate('w1', true));
    idleHook('Stop');
    i['다시 일하면 기록 지움'] = !JSON.parse(fs.readFileSync(stFile, 'utf8')).idle.w1;
    setMembers(mate('w3', false)); idleHook('Stop'); ago([['idle', 'w3', 15]]); setMembers();
    i['종료된 팀원 정리'] = !idleHook('Stop') && !JSON.parse(fs.readFileSync(stFile, 'utf8')).idle.w3;
    // 상태 줄: 팀원이나 리더의 백그라운드 작업이 남은 채 멈추는데 답변에 「지금 도는 것:」 줄이 없으면 한 번 막는다
    setMembers(mate('w4', false), mate('w5', true));
    const noLine = idleHook('Stop', { last_assistant_message: '받음' });
    i['상태 줄 없으면 막음 (팀원)'] = /"decision":"block"/.test(noLine) && /일하는 중인 팀원 w5 · 대기 중인 팀원 w4/.test(noLine) && /지금 도는 것: /.test(noLine);
    i['상태 줄 있으면 통과'] = !idleHook('Stop') && !idleHook('Stop', { last_assistant_message: '끝.\n- **지금 도는 것**: 검사 1개' }) && !idleHook('Stop', { last_assistant_message: '받음', stop_hook_active: true });
    setLevel('block', { waitStatus: 'off' });
    i['상태 줄 끄기'] = !idleHook('Stop', { last_assistant_message: '받음' });
    fs.writeFileSync(wsFile, wsRaw);
    fs.rmSync(teamDir, { recursive: true, force: true });
    const bgTasks = [{ id: 'b1', type: 'shell', status: 'running', description: '전체 검사', command: 'npm test' }, { id: 't1', type: 'teammate', status: 'running', description: 'x' }];
    const bgOut = idleHook('Stop', { last_assistant_message: '받음', background_tasks: bgTasks });
    i['상태 줄 없으면 막음 (백그라운드 작업)'] = /"decision":"block"/.test(bgOut) && /백그라운드 작업 1개\(전체 검사\)/.test(bgOut) && !idleHook('Stop', { background_tasks: bgTasks })
      && !idleHook('Stop', { last_assistant_message: '받음', background_tasks: [{ id: 'b2', type: 'shell', status: 'completed' }] });
    const TI = require(path.join(dir, 'packs', 'core', 'lib', 'teamidle.js'));
    i['끝남 알림 한 줄'] = TI.summary({ bg: ['a'], working: [], idle: ['w1', 'w2'], any: true }) === '⏳ 일하는 팀원 0 · 대기 팀원 2 · 리더 백그라운드 작업 1개 대기 중' && TI.summary({ bg: [], working: [], idle: [], any: false }) === '';
    i['팀 없는 세션은 조용'] = !idleHook('Stop') && !idleHook('UserPromptSubmit');
    // 이어서 시작(-c)해 세션 ID 가 바뀐 리더: 팀 이름은 처음 ID 그대로라 대화 기록의 team_name · 설정의 leadSessionId 로 찾는다 (끝남 알림이 일하는 팀원을 놓치지 않게)
    {
      fs.mkdirSync(teamDir, { recursive: true });
      setMembers(mate('w9', true));
      const tr = path.join(tmp, 'resumed.jsonl');
      fs.writeFileSync(tr, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { name: 'w9', team_name: 'session-abcdef12' } }] } })}\n`);
      const prev = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = cfgDir;
      try {
        const viaTranscript = TI.waiting({ session_id: '99999999-0000-4000-8000-000000000000', transcript_path: tr }).working.join() === 'w9';
        const without = TI.waiting({ session_id: '88888888-0000-4000-8000-000000000000' }).working.length === 0;
        fs.writeFileSync(path.join(teamDir, 'config.json'), JSON.stringify({ name: 'session-abcdef12', leadSessionId: '77777777-0000-4000-8000-000000000000', leadAgentId: lead.agentId, members: [lead, mate('w9', true)] }));
        const viaLead = TI.waiting({ session_id: '77777777-0000-4000-8000-000000000000' }).working.join() === 'w9';
        i['이어서 시작한 리더도 팀 찾기'] = viaTranscript && without && viaLead;
      } finally { if (prev == null) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; }
      fs.rmSync(teamDir, { recursive: true, force: true });
    }
    const hooks = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')).hooks || {};
    i['훅 등록'] = ['Stop', 'UserPromptSubmit', 'TeammateIdle'].every((e) => JSON.stringify(hooks[e] || []).includes('team-idle'));
    i['명령'] = cli('enforce', 'status', 'warn').status !== 0 && /기다리며 멈출 때 상태 줄  막기/.test(cli().stdout) && cli('enforce', 'idle', 'warn', '--after', '5').status !== 0 && cli('enforce', 'idle', 'warn', '--after', '5', '--remind', '15', '--team').status === 0
      && JSON.parse(fs.readFileSync(wsFile, 'utf8')).agents.enforce.idleMinutes === 5 && /대기로 오래 남은 팀원 \(팀 모드\)  알림 · 대기 5분 넘으면 · 같은 팀원은 15분 뒤 다시/.test(cli().stdout);
    fs.writeFileSync(wsFile, wsRaw); run(process.execPath, ['bin/kit.js', 'sync'], dir);
    record('대기 팀원 점검 (멈출 때 막기 · 다시 알림 · 수준 · 정리 · 상태 줄)', Object.values(i).every(Boolean), Object.entries(i).map(([k, v]) => `${k} ${v}`).join(' · '));
  }
  record('팀 모드 이름 없는 역할 에이전트 (막기 · 경고 · 끄기 · 재주입)', Object.values(all).every(Boolean), Object.entries(all).map(([k, v]) => `${k} ${v}`).join(' · '));
}

// AGENTS.md 가 Codex 기본 한도를 넘어도 sync 는 멈추지 않고 .codex/config.toml 의 project_doc_max_bytes 를 올린다 (repo 가 많은 워크스페이스)
{
  const dir = path.join(tmp, 'new');
  const wsFile = path.join(dir, 'workspace.json');
  const raw = fs.readFileSync(wsFile, 'utf8');
  const w = JSON.parse(raw);
  w.limits = { ...(w.limits || {}), agentsMdBytes: 8192 }; // 일부러 작게
  fs.writeFileSync(wsFile, JSON.stringify(w, null, 2) + '\n');
  const r = run(process.execPath, ['bin/kit.js', 'sync', '--quiet'], dir);
  const toml = fs.readFileSync(path.join(dir, '.codex', 'config.toml'), 'utf8');
  const raised = Number((toml.match(/project_doc_max_bytes = (\d+)/) || [])[1] || 0);
  const bytes = fs.statSync(path.join(dir, 'AGENTS.md')).size;
  const ok = r.ok && raised > bytes && /한도를 .*로 올렸습니다/.test(r.out);
  record('AGENTS.md 한도 초과 시 Codex 한도 자동 상향', ok, `sync ${r.ok} · 올린 값 ${raised} > ${bytes} · 경고 ${/올렸습니다/.test(r.out)}`);
  fs.writeFileSync(wsFile, raw);
  run(process.execPath, ['bin/kit.js', 'sync', '--quiet'], dir);
}

// 완료 조건 — Stop 훅이 미완 항목이 있으면 끝내기 전에 처리하게 하고(세션당 한 번), 요청마다 진행 중 작업을 다시 넣는다. 기억이 아니라 파일 상태로 판단한다
{
  const dir = path.join(tmp, 'task-ws');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new'], tmp);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'kim']);
  const got = [];
  const id = (() => { try { return require(path.join(dir, 'packs', 'core', 'lib', 'workspace.js')).devId(dir); } catch { return ''; } })();
  const tdir = path.join(dir, 'handoffs', id || 'kim', 'topics');
  fs.mkdirSync(tdir, { recursive: true });
  const topic = path.join(tdir, '주문-목록.md');
  const body = (done) => `# 주문-목록\n관련: REQ-ORD-012\n상태: 진행 중\n마지막: 2026-09-30\n한 줄: 서버 끝, 화면 남음\n\n## 완료 조건\n- [x] 서버 테스트\n- [${done ? 'x' : ' '}] 화면 연결\n- [${done ? 'x' : ' '}] 핸드오프 갱신\n\n## 지킬 것\n- 응답 봉투는 기존 관례대로\n`;
  fs.writeFileSync(topic, body(false));
  const hook = (name, session, extra = {}) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', name), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: session, hook_event_name: name.startsWith('task-check') ? 'Stop' : 'UserPromptSubmit', ...extra }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout;
  // 세션 시작 표식 (SessionStart 훅이 남긴다). 이번 세션에 손댄 작업만 점검한다
  const sdir = (() => { try { return require(path.join(dir, 'packs', 'core', 'lib', 'workspace.js')).stateDir(dir); } catch { return path.join(tmp, 'state'); } })();
  const started = (session, ms) => { fs.mkdirSync(sdir, { recursive: true }); fs.writeFileSync(path.join(sdir, `${session}.start`), String(ms)); };
  for (const sid of ['selftest-task-1', 'selftest-task-2', 'selftest-task-4', 'selftest-task-6', 'selftest-task-7', 'selftest-task-8', 'selftest-task-9']) started(sid, Date.now() - 60000);
  started('selftest-task-5', Date.now() + 60000); // 이 세션은 작업 기록에 손대지 않았다
  const untouchedQuiet = !hook('task-check.js', 'selftest-task-5');
  const first = hook('task-check.js', 'selftest-task-1');
  const blocked = /"decision":"block"/.test(first) && /주문-목록/.test(first) && /화면 연결/.test(first) && !/서버 테스트/.test(first);
  const once = !hook('task-check.js', 'selftest-task-1');
  const loopSafe = !hook('task-check.js', 'selftest-task-2', { stop_hook_active: true });
  const focus = hook('task-focus.js', 'selftest-task-3');
  const focused = /주문-목록/.test(focus) && /미완 2/.test(focus) && /응답 봉투/.test(focus) && focus.trim().split('\n').length <= 2;
  const again = hook('task-focus.js', 'selftest-task-3');
  const compact = /주문-목록/.test(again) && /앞과 같음/.test(again) && !/응답 봉투/.test(again);
  fs.writeFileSync(topic, body(false).replace(/- \[ \] /g, '- [~] '));
  const waitingQuiet = !hook('task-check.js', 'selftest-task-6');
  // 날짜 예약 [>] YYYY-MM-DD: 그날 전에는 조용 · 그날은 「오늘 예정」 으로 막고 세션 시작 줄에 · 지나면 「지난 예약」 (check ⚠) · 날짜 없으면 check ✖
  const today = require(path.join(dir, 'packs', 'core', 'lib', 'workspace.js')).localDate();
  const sched = (d) => fs.writeFileSync(topic, body(false).replace('- [ ] 화면 연결', `- [>] ${d} 장중 측정`).replace('- [ ] 핸드오프 갱신', '- [~] 핸드오프 갱신'));
  sched('2099-01-02');
  const futureQuiet = !hook('task-check.js', 'selftest-task-7') && /예약 1: 2099-01-02 장중 측정/.test(hook('task-focus.js', 'selftest-task-10'));
  sched(today);
  const todayOut = hook('task-check.js', 'selftest-task-8');
  fs.writeFileSync(path.join(dir, 'handoffs', id || 'kim', 'LATEST.md'), `# 마지막 핸드오프 (${today})\n`);
  const startLine = spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'handoff-brief.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: '{}', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout;
  fs.rmSync(path.join(dir, 'handoffs', id || 'kim', 'LATEST.md'), { force: true }); // 뒤 세션 브리핑 시험은 첫 세션부터 본다
  const dueToday = /"decision":"block"/.test(todayOut) && /\[오늘 예정\] 장중 측정/.test(todayOut) && /📅 오늘 예정 1건/.test(startLine);
  sched('2020-01-02');
  const pastOut = hook('task-check.js', 'selftest-task-9');
  const pastChk = run(process.execPath, ['packs/core/bin/handoff.js', 'check'], dir).out;
  const overdue = /지난 예약 01-02/.test(pastOut) && /⚠ topics\/주문-목록\.md: 지난 예약 1개/.test(pastChk) && !/✖ topics/.test(pastChk);
  sched('언젠가');
  const badDate = /✖ topics\/주문-목록\.md: 날짜 예약 \[>\] 에 날짜/.test(run(process.execPath, ['packs/core/bin/handoff.js', 'check'], dir).out);
  got.push(`날짜 예약: 전 조용 ${futureQuiet} · 그날 막음 · 시작 줄 ${dueToday} · 지난 예약 ${overdue} · 날짜 없음 막음 ${badDate}`);
  fs.writeFileSync(topic, body(true));
  const doneQuiet = !hook('task-check.js', 'selftest-task-4');
  const chk = run(process.execPath, ['packs/core/bin/handoff.js', 'check'], dir);
  fs.writeFileSync(topic, body(true).replace(/## 완료 조건[\s\S]*?## 지킬 것/, '## 지킬 것'));
  const warned = /완료 조건" 이 없다/.test(run(process.execPath, ['packs/core/bin/handoff.js', 'check'], dir).out) && !/완료 조건" 이 없다/.test(chk.out);
  const claudeHooks = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
  const codexHooks = fs.readFileSync(path.join(dir, '.codex', 'hooks.json'), 'utf8');
  const wired = /task-check/.test(claudeHooks) && /task-focus/.test(claudeHooks) && /task-check/.test(codexHooks) && !/task-focus/.test(codexHooks);
  got.push(`id ${!!id}`, `미완이면 막음 ${blocked}`, `세션당 한 번 ${once}`, `루프 방지 ${loopSafe}`, `요청마다 주입 ${focused}`, `같으면 한 줄 ${compact}`, `손대지 않은 세션 조용 ${untouchedQuiet}`, `[~] 제외 ${waitingQuiet}`, `다 끝나면 조용 ${doneQuiet}`, `check 경고 ${warned}`, `훅 연결(Claude 둘 · Codex Stop 만) ${wired}`);
  record('작업 완료 조건 (Stop 훅 · 요청마다 주입 · check · 날짜 예약)', !!id && blocked && once && loopSafe && focused && compact && untouchedQuiet && waitingQuiet && futureQuiet && dueToday && overdue && badDate && doneQuiet && warned && wired, got.join(' · '));
  // 답변 첫 줄 시각 (UserPromptSubmit): 기본 켜짐 · 팀 값 · 이 PC 값이 먼저 · kedovi timestamp · Claude 에만
  {
    const ts = () => hook('prompt-time.js', 'selftest-time-1');
    const cli = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'timestamp', ...a], { cwd: dir, encoding: 'utf8' });
    const wsFile = path.join(dir, 'workspace.json');
    const wsBefore = fs.readFileSync(wsFile, 'utf8');
    const on = /^⏱ 요청 받은 시각 \d{4}-\d\d-\d\d \d\d:\d\d:\d\d\. /.test(ts());
    const off = cli('off').status === 0 && !ts() && /꺼짐 {2}\(이 PC 꺼짐/.test(cli().stdout);
    fs.writeFileSync(wsFile, JSON.stringify({ ...JSON.parse(wsBefore), chat: { timestamp: false } }));
    const mineFirst = cli('on').status === 0 && !!ts();
    const teamFollow = cli('team').status === 0 && !ts();
    fs.writeFileSync(wsFile, wsBefore);
    const bad = cli('maybe').status !== 0;
    const wiredTs = /prompt-time/.test(claudeHooks) && !/prompt-time/.test(codexHooks);
    record('답변 첫 줄 시각 (요청마다 주입 · kedovi timestamp)', on && off && mineFirst && teamFollow && bad && wiredTs, `기본 켜짐 ${on} · 끄기 ${off} · 이 PC 값 먼저 ${mineFirst} · team 이면 팀 값 ${teamFollow} · 잘못된 값 ${bad} · 훅 연결(Claude 만) ${wiredTs}`);
  }
  // 응답 언어 · 대화 스타일 (kedovi prefs): 기본(팀 문서 언어 · 일반) · 이 PC 값 먼저 · 팀 값 · 개인 지침 머리 · settings.local.json · 출력 스타일 · 요청마다 한 줄(Claude 만)
  {
    const cli = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'prefs', ...a], { cwd: dir, encoding: 'utf8' });
    const line = () => hook('chat-prefs.js', 'selftest-prefs-1');
    const local = () => JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf8'));
    const head = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
    const wsFile = path.join(dir, 'workspace.json');
    const wsBefore = fs.readFileSync(wsFile, 'utf8');
    const def = /^응답: 한국어만/.test(line()) && /스타일 일반/.test(line()) && local().language === 'korean' && !local().outputStyle && /## 응답 언어 · 대화 스타일 \(한국어 · 일반/.test(head('CLAUDE.local.md'));
    const styles = fs.existsSync(path.join(dir, '.claude', 'output-styles', 'kedovi-expert.md')) && /keep-coding-instructions: true/.test(head('.claude/output-styles/kedovi-learn.md'));
    const expert = cli('style', 'expert').status === 0 && local().outputStyle === 'kedovi-expert' && /스타일 전문가/.test(line()) && /현업에서 쓰는 이름/.test(head('CLAUDE.local.md'));
    const en = cli('language', 'en').status === 0 && local().language === 'english' && /^Reply in English/.test(line()) && /응답 언어: English/.test(head('AGENTS.override.md').split('\n').slice(0, 6).join('\n'));
    fs.writeFileSync(wsFile, JSON.stringify({ ...JSON.parse(wsBefore), chat: { language: 'ko', style: 'learn' } }));
    const mineFirst = cli('language', 'en').status === 0 && /^Reply in English/.test(line());
    const teamFollow = cli('language', 'team').status === 0 && cli('style', 'team').status === 0 && /^응답: 한국어만/.test(line()) && /스타일 학습/.test(line());
    fs.writeFileSync(wsFile, wsBefore);
    spawnSync(process.execPath, ['bin/kit.js', 'sync', '--quiet'], { cwd: dir });
    const cleared = !local().outputStyle && local().language === 'korean';
    const bad = cli('style', 'chatty').status !== 0 && cli('language', 'jp').status !== 0;
    const wiredP = /chat-prefs/.test(claudeHooks) && /chat-prefs/.test(codexHooks) && (JSON.parse(codexHooks).hooks.PostToolUse || []).some((g) => JSON.stringify(g).includes('chat-prefs'));
    // 긴 작업 중 다시 알림 (PostToolUse): 요청 시작 뒤 도구 14번은 조용, 15번째에 한 줄, 다시 세기
    hook('chat-prefs.js', 'selftest-prefs-long');
    const tool = () => hook('chat-prefs.js', 'selftest-prefs-long', { hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    const quiet = Array.from({ length: 14 }, tool).every((o) => !o.trim());
    const again = tool();
    const longRun = quiet && /"hookEventName":"PostToolUse"/.test(again) && /한국어만/.test(again) && !tool().trim() && /chat-prefs[^\n]*/.test(claudeHooks) && (JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')).hooks.PostToolUse || []).some((g) => JSON.stringify(g).includes('chat-prefs'));
    record('응답 언어 · 대화 스타일 (kedovi prefs · 개인 지침 머리 · 출력 스타일 · 요청마다 한 줄 · 긴 작업 중 다시)', def && styles && expert && en && mineFirst && teamFollow && cleared && bad && wiredP && longRun,
      `기본 ${def} · 출력 스타일 파일 ${styles} · 전문가 ${expert} · 영어 ${en} · 이 PC 값 먼저 ${mineFirst} · team 이면 팀 값 ${teamFollow} · 되돌리면 킷 스타일 지움 ${cleared} · 잘못된 값 ${bad} · 훅 연결(Claude · Codex) ${wiredP} · 긴 작업 중 다시 알림 ${longRun}`);
  }
  // 언어 감지 · 클린 코드 팩 (repos[].languages · clean-code · lang-*) · repo 별 바꾸기(repos:) · repo 별 끄기(rules.offIn · --repo) · 옛 워크스페이스 채우기
  {
    const src = path.join(tmp, 'lang-src');
    const mkRepo = (name, files) => {
      const d = path.join(src, name);
      for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
      spawnSync('git', ['init', '-q', d]); spawnSync('git', ['-C', d, 'add', '-A']); spawnSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'i']);
      return d;
    };
    const java = {}; for (let i = 0; i < 6; i++) java[`api/src/main/java/kr/co/company/project/user/controller/A${i}.java`] = `class A${i} {}`; // 깊은 패키지
    const api = mkRepo('api', { 'build.gradle': 'plugins { id "org.springframework.boot" }', ...java, 'tools/x.py': 'x = 1' }); // 파이썬 1개는 언어로 안 봄
    const py = {}; for (let i = 0; i < 3; i++) py[`pkg/m${i}.py`] = `x = ${i}`;
    const pods = {}; for (let i = 0; i < 8; i++) pods[`ios/Pods/Lib/S${i}.swift`] = '';
    const ml = mkRepo('ml', { 'requirements.txt': 'fastapi', ...py, ...pods }); // 내려받은 의존성(Pods)은 언어로 안 봄
    const ts = {}; for (let i = 0; i < 6; i++) ts[`src/c${i}.tsx`] = '';
    const web = mkRepo('web', { 'package.json': '{"dependencies":{"react":"18","next":"14"}}', ...ts });
    // flutter create 구조: android 가 모듈 android/app 으로 잡힌다
    const dart = {}; for (let i = 0; i < 6; i++) dart[`lib/w${i}.dart`] = '';
    const app = mkRepo('app', { 'pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n', 'android/app/src/main/AndroidManifest.xml': '<manifest/>', 'android/app/build.gradle': 'apply plugin: "com.android.application"', 'android/build.gradle': '', 'android/app/src/main/kotlin/a/MainActivity.kt': '', 'android/app/src/main/kotlin/a/P.kt': '', ...dart, ...Object.fromEntries([0, 1, 2, 3, 4, 5].flatMap((i) => [[`ios/Runner/S${i}.swift`, ''], [`windows/runner/c${i}.cpp`, '']])) });
    const one = mkRepo('one', { 'main.py': 'print(1)' });
    const empty = mkRepo('empty', { 'README.md': '# 아직 코드 없음' });
    const lw = path.join(tmp, 'lang-ws');
    run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', lw, '--type', 'new', '--code', `${api},${ml},${web},${app},${one},${empty}`], tmp);
    const wsOf = () => JSON.parse(fs.readFileSync(path.join(lw, 'workspace.json'), 'utf8'));
    const repoOf = (n) => wsOf().repos.find((r) => r.name === n) || {};
    const table = () => (fs.readFileSync(path.join(lw, 'AGENTS.md'), 'utf8').match(/\| repo \| 스택[\s\S]*?\n\n/) || [''])[0];
    const rowOf = (n) => table().split('\n').find((l) => l.startsWith(`| **${n}**`)) || '';
    const detected = JSON.stringify(repoOf('api').languages) === '["java"]' && JSON.stringify(repoOf('ml').languages) === '["python"]';
    const attached = /Spring · Java/.test(rowOf('api')) && /clean-code--10-clean-code/.test(rowOf('api')) && /clean-code--20-layer-responsibility/.test(rowOf('api')) && /lang-java--10-java/.test(rowOf('api')) && /stack-spring--60-clean-code/.test(rowOf('api'))
      && /lang-python--10-python/.test(rowOf('ml')) && /stack-fastapi--10-fastapi/.test(rowOf('ml')) && !/lang-python/.test(rowOf('api'));
    const tsRepo = JSON.stringify(repoOf('web').languages) === '["typescript"]' && /clean-code--20-layer-responsibility/.test(rowOf('web')) && /stack-nextjs--10-nextjs/.test(rowOf('web')) && /stack-react--40-logic-placement/.test(rowOf('web'));
    const flutterOk = JSON.stringify(repoOf('app').languages) === '["dart"]' && /stack-flutter--10-flutter/.test(rowOf('app')) && !/stack-android/.test(rowOf('app')) && /lang-dart--10-dart/.test(rowOf('app'));
    const oneFile = JSON.stringify(repoOf('one').languages) === '["python"]' && JSON.stringify(repoOf('empty').languages) === '[]';
    const notInBody = !/## Java 클린 코드/.test(fs.readFileSync(path.join(lw, 'AGENTS.md'), 'utf8'));
    fs.mkdirSync(path.join(lw, 'packs', 'project', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(lw, 'packs', 'project', 'rules', 'my-py.md'), '---\ntitle: 우리 Python\nload: always\nreplaces: lang-python--10-python\nrepos: ml\n---\n\n## 우리 Python\n');
    const sync = () => run(process.execPath, ['bin/kit.js', 'sync', '--quiet'], lw);
    const replacedOne = sync().ok && /project--my-py/.test(rowOf('ml')) && !/lang-python--10-python/.test(rowOf('ml')) && !/project--my-py/.test(rowOf('api'));
    fs.writeFileSync(path.join(lw, 'packs', 'project', 'rules', 'my-py.md'), '---\ntitle: 우리 Python\nload: always\nreplaces: lang-python--10-python\nrepos: nope\n---\n\n## x\n');
    const badRepo = !sync().ok;
    fs.writeFileSync(path.join(lw, 'packs', 'project', 'rules', 'my-py.md'), '---\ntitle: 우리 Python\nload: always\nreplaces: lang-python--10-python\nrepos: api\n---\n\n## x\n');
    const strayRefused = !sync().ok; // api 에는 원래 Python 규칙이 걸리지 않는다
    fs.writeFileSync(path.join(lw, 'packs', 'project', 'rules', 'my-py.md'), '---\ntitle: 우리 Python\nload: always\nagents: claude\nrepos: ml\n---\n\n## x\n');
    const claudeRefused = !sync().ok;
    fs.writeFileSync(path.join(lw, 'packs', 'project', 'rules', 'my-py2.md'), '---\ntitle: 또 Python\nload: always\nreplaces: lang-python--10-python\nrepos: ml\n---\n\n## y\n');
    fs.writeFileSync(path.join(lw, 'packs', 'project', 'rules', 'my-py.md'), '---\ntitle: 우리 Python\nload: always\nreplaces: lang-python--10-python\nrepos: ml\n---\n\n## x\n');
    const overlapRefused = !sync().ok;
    fs.writeFileSync(path.join(lw, 'packs', 'project', 'rules', 'my-py2.md'), '---\ntitle: 전체 Python\nload: always\nreplaces: lang-python--10-python\n---\n\n## z\n');
    const fullPartialRefused = !sync().ok;
    fs.writeFileSync(path.join(lw, 'packs', 'project', 'rules', 'my-py2.md'), '---\ntitle: 목록\nload: always\nrepos:\n  - ml\n---\n\n## z\n');
    const yamlListRefused = !sync().ok;
    fs.writeFileSync(path.join(lw, 'packs', 'project', 'rules', 'my-py2.md'), '---\ntitle: 괄호\nload: always\nrepos: [ml]\n---\n\n## z\n');
    const bracketOk = sync().ok && /project--my-py2/.test(rowOf('ml')) && !/project--my-py2/.test(rowOf('api'));
    fs.rmSync(path.join(lw, 'packs', 'project', 'rules', 'my-py2.md'));
    fs.writeFileSync(path.join(lw, 'packs', 'project', 'rules', 'my-py.md'), '---\ntitle: 우리 Python\nload: always\nreplaces: lang-python--10-python\nrepos: ml\n---\n\n## x\n');
    sync();
    const listed = spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'rules', 'list'], { cwd: lw, encoding: 'utf8' }).stdout;
    const partialShown = /켜짐\s+lang-python--10-python .*ml 에서만 project--my-py 가 대신/.test(listed);
    const removePinned = spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'repo', 'remove', 'ml'], { cwd: lw, encoding: 'utf8' }).status !== 0 && repoOf('ml').name === 'ml';
    fs.rmSync(path.join(lw, 'packs', 'project', 'rules', 'my-py.md'));
    spawnSync('git', ['-C', lw, 'config', 'user.name', 't']);
    const cli = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'rules', ...a], { cwd: lw, encoding: 'utf8' });
    const onTypo = cli('on', 'lang-java--10-java', '--repo', 'apii').status !== 0;
    const offOne = cli('off', 'lang-java--10-java', '--repo=api').status === 0 && JSON.stringify((wsOf().rules || {}).offIn) === '{"lang-java--10-java":["api"]}' && !/lang-java--10-java/.test(rowOf('api'));
    const onAgain = cli('on', 'lang-java--10-java', '--repo', 'api').status === 0 && !(wsOf().rules || {}).offIn && /lang-java--10-java/.test(rowOf('api'))
      && cli('off', 'lang-java--10-java', '--repo', 'api').status === 0 && cli('on', 'lang-java--10-java').status === 0 && !(wsOf().rules || {}).offIn && /lang-java--10-java/.test(rowOf('api')) && onTypo;
    const raw0 = wsOf(); raw0.rules = { offIn: { 'gone--rule': ['api'] } }; fs.writeFileSync(path.join(lw, 'workspace.json'), JSON.stringify(raw0, null, 2));
    const staleCleared = cli('on', 'gone--rule', '--repo', 'api').status === 0 && !(wsOf().rules || {}).offIn && cli('ondemand', 'lang-java--10-java', '--repo', 'api').status !== 0;
    const wholeRefused = cli('off', 'core--10-communication', '--repo', 'api').status !== 0 && cli('off', 'lang-java--10-java', '--repo', 'nope').status !== 0 && cli('off', 'lang-java--10-java', '--repo', 'ml').status !== 0;
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(lw, 'repos', 'empty', `m${i}.py`), 'x = 1'); // 비어 있던 repo([])에 코드가 생김
    spawnSync('git', ['-C', path.join(lw, 'repos', 'empty'), 'add', '-A']);
    const raw = wsOf(); for (const r of raw.repos) if (r.name !== 'empty') delete r.languages; raw.repos.find((r) => r.name === 'one').languages = false; fs.writeFileSync(path.join(lw, 'workspace.json'), JSON.stringify(raw, null, 2));
    const filled = spawnSync(process.execPath, ['-e', `const k=require(${JSON.stringify(path.join(KIT, 'bin', 'kit.js'))});console.log(JSON.stringify(k.fillLanguages(${JSON.stringify(lw)})))`], { encoding: 'utf8' }).stdout.trim();
    const upgraded = /"api","languages":\["java"\]/.test(filled) && JSON.stringify(repoOf('ml').languages) === '["python"]' && JSON.stringify(repoOf('empty').languages) === '["python"]' && repoOf('one').languages === false;
    const checked = sync().ok && run(process.execPath, ['bin/kit.js', 'check'], lw).ok && !/lang-python|clean-code/.test(rowOf('one')); // false = 건너뛴 repo: 언어 규칙 없음
    cli('off', 'lang-python--10-python', '--repo', 'ml');
    const removeCleans = spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'repo', 'remove', 'ml'], { cwd: lw, encoding: 'utf8' }).status === 0 && !(wsOf().rules || {}).offIn;
    record('언어 감지 · 클린 코드 팩 (repo 별 규칙 · repos: 바꾸기 · --repo 끄기 · 옛 워크스페이스)', detected && attached && tsRepo && flutterOk && oneFile && fullPartialRefused && yamlListRefused && bracketOk && overlapRefused && staleCleared && notInBody && replacedOne && badRepo && strayRefused && claudeRefused && partialShown && removePinned && offOne && onAgain && wholeRefused && upgraded && checked && removeCleans,
      `TS repo 에 clean-code · Next.js ${tsRepo} · Flutter 에 Android 팩 안 붙음 · 플랫폼 폴더(ios · windows) 제외 ${flutterOk} · 파일 하나 repo · 빈 repo 는 [] ${oneFile} · 전체 + 일부 대체 거부 ${fullPartialRefused} · 여러 줄 repos: 거부 ${yamlListRefused} · repos: [a] ${bracketOk} · 같은 repo 두 번 바꾸기 거부 ${overlapRefused} · 없어진 규칙 기록 지우기 · 다른 하위 명령 --repo 거부 ${staleCleared} · 감지(Pods 제외 · 깊은 패키지) ${detected} · 안 걸리는 repo 바꾸기 거부 ${strayRefused} · Claude 전용 repos: 거부 ${claudeRefused} · 일부 대체 표시 ${partialShown} · repos: 가 가리키면 repo 빼기 거부 ${removePinned} · repo 빼면 offIn 정리 ${removeCleans} · 감지 ${detected} · repo 표 ${attached} · 본문 아님 ${notInBody} · repos: 한 repo 만 바꿈 ${replacedOne} · 없는 repo 거부 ${badRepo} · --repo 끄기 ${offOne} · 다시 켜기 ${onAgain} · 전체 규칙 · 없는 repo 거부 ${wholeRefused} · 옛 워크스페이스 채우기 ${upgraded} · check ${checked}`);
  }
  // 시간 예산 (budget.js · budget-check 훅): 선언 · 요청마다 한 줄 · 1.5배 넘으면 요청 때 알림 + 멈출 때 한 번 막기 · 늘리기 · 끝내기
  {
    const tool = (...a) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'budget.js'), ...a], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    const bh = (ev, extra = {}) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'budget-check.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 'selftest-budget', hook_event_name: ev, ...extra }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout;
    const bfile = path.join(require(path.join(dir, 'packs', 'core', 'lib', 'workspace.js')).stateDir(dir), 'budget.json');
    const started = tool('start', '주문 탭', '30m').status === 0 && /⏱ 시간 예산: 주문 탭 예산 30분 · 경과 0분/.test(bh('UserPromptSubmit')) && !bh('Stop');
    fs.writeFileSync(bfile, JSON.stringify(JSON.parse(fs.readFileSync(bfile, 'utf8')).map((b) => ({ ...b, start: Date.now() - 50 * 60000 }))));
    const late = /⏰ 시간 예산 넘음: 주문 탭 예산 30분 · 경과 50분/.test(bh('UserPromptSubmit'));
    const stopOnce = /"decision":"block"/.test(bh('Stop')) && !bh('Stop') && !bh('Stop', { stop_hook_active: true });
    const extended = tool('extend', '주문 탭', '1h').status === 0 && /⏱ 시간 예산: 주문 탭 예산 90분/.test(bh('UserPromptSubmit'));
    const done = /끝: 주문 탭 예산 90분 · 경과 50분/.test(tool('done', '주문 탭').stdout) && !bh('UserPromptSubmit') && tool('start', 'x', 'abc').status !== 0;
    const bwired = /budget-check/.test(claudeHooks) && /budget-check/.test(codexHooks);
    record('시간 예산 (budget.js · 요청 때 한 줄 · 넘으면 한 번 막기)', started && late && stopOnce && extended && done && bwired, `선언 · 한 줄 ${started} · 넘으면 알림 ${late} · 멈출 때 한 번 ${stopOnce} · 늘리기 ${extended} · 끝내기 · 잘못된 값 ${done} · 훅 연결 ${bwired}`);
  }
  // 위임이 도는 채 멈출 때: 상태 줄이 없으면 한 번 막고, 있으면 통과 (백그라운드 wait 와 같이 쓴다)
  {
    const jobDir = path.join(require(path.join(dir, 'packs', 'core', 'lib', 'workspace.js')).stateDir(dir), 'delegate', 'selftest-running');
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'meta.json'), JSON.stringify({ startedAt: Date.now() }));
    const ac = (msg) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'agent-cleanup.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 'selftest-ac', hook_event_name: 'Stop', last_assistant_message: msg }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout;
    const blocks = /"decision":"block"/.test(ac('리뷰를 맡겼습니다.')) && /백그라운드/.test(ac('리뷰를 맡겼습니다.'));
    const passes = !ac('리뷰를 맡겼습니다.\n\n지금 도는 것: 위임 reviewer · 예상 종료: 5분 뒤 · 사용자가 할 일: 없음');
    fs.rmSync(jobDir, { recursive: true, force: true });
    record('위임이 도는 채 멈추기 (상태 줄이면 통과)', blocks && passes, `상태 줄 없으면 막음 ${blocks} · 있으면 통과 ${passes}`);
  }
  // 오래 일하는 위임 (team-idle 훅): 상한 넘으면 멈출 때 한 번 막고 요청 때 한 줄 · 상한 안은 조용 · 끄기 · 명령
  // 리뷰 에이전트(agent-budget 훅): 지시문에 검사 줄이 없으면 막음
  {
    const sd = require(path.join(dir, 'packs', 'core', 'lib', 'workspace.js')).stateDir(dir);
    const jobDir = path.join(sd, 'delegate', 'selftest-long');
    fs.mkdirSync(jobDir, { recursive: true });
    const setStart = (min) => fs.writeFileSync(path.join(jobDir, 'meta.json'), JSON.stringify({ startedAt: Date.now() - min * 60000, role: 'implementer', to: 'codex' }));
    fs.rmSync(path.join(sd, 'longrun.json'), { force: true });
    const ti = (ev, extra = {}) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'team-idle.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 'selftest-long-1', hook_event_name: ev, last_assistant_message: '지금 도는 것: 위임 · 예상 종료: 모름 · 사용자가 할 일: 없음', ...extra }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout;
    setStart(10);
    const quiet = !ti('Stop') && !ti('UserPromptSubmit');
    setStart(75);
    const line = /오래 일하는 중입니다: 위임 implementer → codex\(75분\)/.test(ti('UserPromptSubmit'));
    const first = ti('Stop');
    const stop = /"decision":"block"/.test(first) && /계속할지/.test(first) && !ti('Stop');
    const cli = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'team-mode', 'enforce', ...a], { cwd: dir, encoding: 'utf8' });
    const wsBefore = fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8');
    fs.rmSync(path.join(sd, 'longrun.json'), { force: true });
    const cmd = cli('run', 'off', '--team').status === 0 && !ti('Stop') && cli('run', 'block', '--after', '90').status !== 0 && cli('run', 'block', '--after', '90', '--team').status === 0 && !ti('Stop') && /90분 넘으면/.test(spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'team-mode'], { cwd: dir, encoding: 'utf8' }).stdout);
    fs.rmSync(jobDir, { recursive: true, force: true });
    // 리뷰 에이전트 지시문
    const ab = (prompt) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'agent-budget.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 'selftest-check-1', hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { subagent_type: 'reviewer', name: 'reviewer', prompt } }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout;
    const hasRole = fs.existsSync(path.join(dir, '.claude', 'agents', 'reviewer.md'));
    const denied = !hasRole || (/"permissionDecision":"deny"/.test(ab('주문 탭 리뷰')) && !/"deny"/.test(ab('주문 탭 리뷰\n검사: npm test 통과')));
    const checkOff = cli('check', 'off', '--team').status === 0 && (!hasRole || !/"deny"/.test(ab('주문 탭 리뷰')));
    fs.writeFileSync(path.join(dir, 'workspace.json'), wsBefore);
    spawnSync(process.execPath, [path.join(dir, 'bin', 'kit.js'), 'sync', '--quiet'], { cwd: dir });
    record('오래 일하는 위임 · 리뷰 전 검사 (team-idle · agent-budget)', quiet && line && stop && cmd && denied && checkOff, `상한 안은 조용 ${quiet} · 요청 때 한 줄 ${line} · 멈출 때 한 번 막기 ${stop} · 끄기 · 상한(팀 값) ${cmd} · 리뷰 에이전트 검사 줄 ${denied}${hasRole ? '' : ' (역할 파일 없음)'} · 검사 끄기 ${checkOff}`);
  }
  // repo 빼기: workspace.json 에서 지움 · 변경이 있으면 폴더를 지우지 않음 · --delete 로 폴더 지움 · 없는 이름 거부
  {
    const am = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'repo', ...a], { cwd: dir, encoding: 'utf8' });
    const wsFile = path.join(dir, 'workspace.json');
    const wsBefore = fs.readFileSync(wsFile, 'utf8');
    const added = am('add', 'rm-probe', '--kind', 'code').status === 0 && fs.existsSync(path.join(dir, 'repos', 'rm-probe'));
    fs.writeFileSync(path.join(dir, 'repos', 'rm-probe', 'a.txt'), 'x');
    const refused = am('remove', 'rm-probe', '--delete').status !== 0 && /rm-probe/.test(fs.readFileSync(wsFile, 'utf8'));
    fs.rmSync(path.join(dir, 'repos', 'rm-probe', 'a.txt'));
    const r = am('remove', 'rm-probe', '--delete');
    const removed = r.status === 0 && /repo 뺌: rm-probe · 폴더 지움/.test(r.stdout) && !JSON.parse(fs.readFileSync(wsFile, 'utf8')).repos.some((x) => x.name === 'rm-probe') && !fs.existsSync(path.join(dir, 'repos', 'rm-probe'));
    const unknown = am('remove', 'no-such').status !== 0;
    fs.writeFileSync(wsFile, wsBefore);
    spawnSync(process.execPath, [path.join(dir, 'bin', 'kit.js'), 'sync', '--quiet'], { cwd: dir });
    record('repo 빼기 (kedovi repo remove)', added && refused && removed && unknown, `더하기 ${added} · 변경 있으면 거부 ${refused} · 목록 · 폴더 지움 ${removed} · 없는 이름 거부 ${unknown}`);
  }
  // 하위 명령 --help 는 사용법만 (upgrade 가 실제로 돌지 않게) · 상태를 바꾸는 명령의 모르는 옵션은 실행하지 않음 · 기획 repo 도 이름만 주면 새로 만듦
  {
    const ak = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), ...a], { cwd: dir, encoding: 'utf8' });
    const wsFile = path.join(dir, 'workspace.json');
    const before = fs.readFileSync(wsFile, 'utf8');
    const h = ak('upgrade', '--help');
    const help = h.status === 0 && /^\s*kedovi upgrade \[--add 팩\]/.test(h.stdout) && !/kedovi init /.test(h.stdout) && fs.readFileSync(wsFile, 'utf8') === before && /kedovi repo move/.test(ak('repo', '-h').stdout);
    const bad = ak('upgrade', '--hlp');
    const unknown = bad.status !== 0 && /모르는 옵션 --hlp/.test(bad.stdout + bad.stderr) && fs.readFileSync(wsFile, 'utf8') === before;
    const nd = ak('repo', 'add', 'new-plans', '--kind', 'docs');
    const newDocs = nd.status === 0 && fs.existsSync(path.join(dir, 'repos', 'new-plans', '.git')) && /kedovi init-docs repos\/new-plans/.test(nd.stdout) && ak('repo', 'add', 'new-legacy', '--kind', 'legacy').status !== 0;
    ak('repo', 'remove', 'new-plans', '--delete');
    fs.writeFileSync(wsFile, before);
    spawnSync(process.execPath, [path.join(dir, 'bin', 'kit.js'), 'sync', '--quiet'], { cwd: dir });
    record('하위 명령 도움말 · 모르는 옵션 · 기획 repo 새로 만들기', help && unknown && newDocs, `--help 는 사용법만 (실행 안 함) ${help} · 모르는 옵션 거부 ${unknown} · 이름만 주면 기획 repo 도 새로 만듦 (레거시는 거부) ${newDocs}`);
  }
  // repo 그룹 폴더: repos/<그룹>/<이름> (add --group · AGENTS.md 표 · doctor · check-refs · docs build · move · 검증), 그룹 없으면 생성물 그대로
  {
    const am = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'repo', ...a], { cwd: dir, encoding: 'utf8' });
    const kitSync = () => spawnSync(process.execPath, [path.join(dir, 'bin', 'kit.js'), 'sync', '--quiet'], { cwd: dir, encoding: 'utf8' });
    const wsFile = path.join(dir, 'workspace.json');
    const wsBefore = fs.readFileSync(wsFile, 'utf8');
    const agentsBefore = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    const added = am('add', 'grp-api', '--kind', 'code', '--group', 'server').status === 0 && fs.existsSync(path.join(dir, 'repos', 'server', 'grp-api', '.git'))
      && JSON.parse(fs.readFileSync(wsFile, 'utf8')).repos.find((x) => x.name === 'grp-api').group === 'server';
    const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    const table = /\| repo \| 그룹 \| 위치 \|/.test(agents) && /\| \*\*grp-api\*\* \| server \| `repos\/server\/grp-api\/`/.test(agents) && /repos\/<그룹>\/<이름>/.test(agents);
    const doc = (spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'doctor.js')], { cwd: dir, encoding: 'utf8' }).stdout || '');
    const doctorOk = /repos\/server\/grp-api \(code\)/.test(doc);
    // 같은 이름 · 그룹 이름이 repo 이름과 겹침 · 2단계 그룹은 막는다
    const rd = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
    fs.writeFileSync(wsFile, JSON.stringify({ ...rd, repos: [...rd.repos, { name: 'grp-api', kind: 'code', group: 'client', local: true }] }, null, 2) + '\n');
    const dupRun = spawnSync(process.execPath, [path.join(dir, 'bin', 'kit.js'), 'check'], { cwd: dir, encoding: 'utf8' });
    const dup = dupRun.status !== 0 && /이름이 두 번/.test(dupRun.stdout + dupRun.stderr);
    fs.writeFileSync(wsFile, JSON.stringify(rd, null, 2) + '\n');
    const badGroup = am('add', 'grp-x', '--kind', 'code', '--group', 'a/b').status !== 0;
    // 아직 clone 안 한 그룹 repo 안의 경로는 죽은 참조가 아니다
    const raw = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
    raw.repos.push({ name: 'grp-web', kind: 'code', group: 'client', remote: 'https://example.invalid/grp-web.git' });
    fs.writeFileSync(wsFile, JSON.stringify(raw, null, 2) + '\n');
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'grp-ref.md'), '# 참조\n\n- `repos/client/grp-web/src/App.tsx`\n');
    const dead = require(path.join(dir, 'packs', 'core', 'bin', 'check-refs.js')).findDeadRefs(dir).map((d) => d.ref);
    const refs = !dead.includes('repos/client/grp-web/src/App.tsx');
    // 문서 사이트(루트): 그룹 repo 도 repo 로 본다 (사본 · 원본 단추)
    fs.writeFileSync(path.join(dir, 'repos', 'server', 'grp-api', 'README.md'), '# grp api\n');
    const site = spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'docs-site.js'), 'build', dir], { cwd: dir, encoding: 'utf8' });
    const siteOk = /grp-api 사본/.test(site.stdout) && fs.existsSync(path.join(dir, 'docs-site', 'repos', 'server', 'grp-api', 'index.html'));
    fs.rmSync(path.join(dir, 'docs-site'), { recursive: true, force: true });
    // 옮기기: 폴더 · workspace.json · 문서 경로, 옛 위치가 남으면 doctor 가 알림
    fs.writeFileSync(path.join(dir, 'docs', 'grp-ref.md'), '# 참조\n\n- `repos/server/grp-api/README.md`\n- repos/server/grp-api2 그대로\n');
    spawnSync('git', ['-C', dir, 'add', 'docs/grp-ref.md'], { encoding: 'utf8' });
    const mv = am('move', 'grp-api', '--group', 'client');
    const moved = mv.status === 0 && fs.existsSync(path.join(dir, 'repos', 'client', 'grp-api', '.git')) && !fs.existsSync(path.join(dir, 'repos', 'server'))
      && /`repos\/client\/grp-api\/README\.md`/.test(fs.readFileSync(path.join(dir, 'docs', 'grp-ref.md'), 'utf8')) && /repos\/server\/grp-api2 그대로/.test(fs.readFileSync(path.join(dir, 'docs', 'grp-ref.md'), 'utf8'));
    const back = am('move', 'grp-api', '--no-group');
    const ungroup = back.status === 0 && fs.existsSync(path.join(dir, 'repos', 'grp-api', '.git')) && !('group' in JSON.parse(fs.readFileSync(wsFile, 'utf8')).repos.find((x) => x.name === 'grp-api'));
    const r2 = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
    r2.repos.find((x) => x.name === 'grp-api').group = 'server';
    fs.writeFileSync(wsFile, JSON.stringify(r2, null, 2) + '\n');
    const misplaced = /그룹 폴더와 실제 위치가 다름: repos\/grp-api 에 있음 \(workspace\.json 은 repos\/server\/grp-api\)/.test(spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'doctor.js')], { cwd: dir, encoding: 'utf8' }).stdout || '');
    // 되돌린 뒤 생성물이 처음과 같다 (그룹 없으면 지금 그대로)
    fs.rmSync(path.join(dir, 'repos', 'grp-api'), { recursive: true, force: true });
    fs.rmSync(path.join(dir, 'docs', 'grp-ref.md'), { force: true });
    spawnSync('git', ['-C', dir, 'rm', '-q', '--cached', '--ignore-unmatch', 'docs/grp-ref.md'], { encoding: 'utf8' });
    fs.writeFileSync(wsFile, wsBefore);
    kitSync();
    const same = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8') === agentsBefore;
    record('repo 그룹 폴더 (repos/<그룹>/<이름>)', added && table && doctorOk && dup && badGroup && refs && siteOk && moved && ungroup && misplaced && same,
      `add --group ${added} · AGENTS.md 표 ${table} · doctor ${doctorOk} · 같은 이름 거부 ${dup} · 2단계 거부 ${badGroup} · clone 전 참조 ${refs} · 문서 사이트 ${siteOk} · move ${moved} · 그룹 빼기 ${ungroup} · 옛 위치 진단 ${misplaced} · 그룹 없으면 그대로 ${same}`);
  }
  // 위임받아 도는 세션(KEDOVI_DELEGATED=1)에서는 워크스페이스 훅이 아무것도 하지 않는다 (자기 위임 작업 정리 알림 · 핸드오프 점검이 끼어들지 않게)
  {
    fs.writeFileSync(topic, body(false));
    started('selftest-task-7', Date.now() - 60000);
    const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, KEDOVI_DELEGATED: '1' };
    const quiet = !spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'task-check.js'), '--agent=codex'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ session_id: 'selftest-task-7', hook_event_name: 'Stop' }), env }).stdout;
    const normal = /"decision":"block"/.test(hook('task-check.js', 'selftest-task-7'));
    record('위임 세션에서는 훅이 조용', quiet && normal, `위임 세션 조용 ${quiet} · 보통 세션 막음 ${normal}`);
    fs.writeFileSync(topic, body(true));
  }
  // 텔레그램 채널 세션(KEDOVI_CHANNEL=1): 시작 때 양쪽에 같은 내용을 남기라고 알리고, 선택지 창은 막는다 (텔레그램에서는 창에 답할 수 없다). 아니면 조용
  {
    const env = (on) => ({ ...process.env, CLAUDE_PROJECT_DIR: dir, ...(on ? { KEDOVI_CHANNEL: '1' } : {}) });
    const runHook = (name, input, on, extra) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', name), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify(input), env: { ...env(on), ...extra } }).stdout;
    const brief = runHook('channel-mode.js', { hook_event_name: 'SessionStart' }, true);
    const quiet = !runHook('channel-mode.js', { hook_event_name: 'SessionStart' }, false);
    const ask = { session_id: 'selftest-ch', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'A?' }] } };
    const dialog = !runHook('notify.js', ask, true); // 기본: 채널 세션도 선택지 창 (방향키)
    const localFile = path.join(dir, '.agents', 'local.json');
    const localRaw = fs.existsSync(localFile) ? fs.readFileSync(localFile, 'utf8') : null;
    fs.writeFileSync(localFile, JSON.stringify({ ...(localRaw ? JSON.parse(localRaw) : {}), notify: { channelAsk: 'text' } }));
    const denied = /"permissionDecision":"deny"/.test(runHook('notify.js', ask, true)); // ask text: 번호 목록으로
    const allowed = !runHook('notify.js', ask, false);
    const remoteDialog = !runHook('notify.js', ask, true, { CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_x' }); // 리모트 컨트롤(Claude 앱)이면 자리 비움이어도 질문 창
    // 자리 비움: 끝 응답이 결정 질문인데 이번 요청에 ask 를 안 보냈으면 Stop 을 한 번 막는다 (보냈거나 이미 한 번 막았으면 통과)
    const decision = '어느 쪽으로 할까요?\n\n1. **A (권장)**: 이유\n2. **B**: 이유';
    const stop = (extra) => runHook('notify.js', { session_id: 'selftest-ch', hook_event_name: 'Stop', last_assistant_message: decision, ...extra }, true);
    runHook('notify.js', { session_id: 'selftest-ch', hook_event_name: 'UserPromptSubmit', prompt: '제목 정해줘' }, true);
    const lastAsk = path.join(require(path.join(dir, 'packs', 'core', 'lib', 'workspace.js')).stateDir(dir), 'last-ask.sent');
    try { fs.unlinkSync(lastAsk); } catch { /* 없음 */ }
    const stopBlocked = /"decision":"block"/.test(stop({})) && /notify\.js ask/.test(stop({}));
    const stopOnce = !/"decision":"block"/.test(stop({ stop_hook_active: true }));
    const stopRemote = !/"decision":"block"/.test(runHook('notify.js', { session_id: 'selftest-ch', hook_event_name: 'Stop', last_assistant_message: decision }, true, { CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_x' }));
    fs.writeFileSync(lastAsk, String(Date.now() + 1000));
    const stopAsked = !/"decision":"block"/.test(stop({}));
    const stopPlain = !/"decision":"block"/.test(runHook('notify.js', { session_id: 'selftest-ch', hook_event_name: 'Stop', last_assistant_message: '끝났습니다.' }, true));
    fs.unlinkSync(lastAsk);
    if (localRaw === null) fs.unlinkSync(localFile); else fs.writeFileSync(localFile, localRaw);
    const wired = /channel-mode/.test(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8')) && !/channel-mode/.test(fs.readFileSync(path.join(dir, '.codex', 'hooks.json'), 'utf8'));
    record('텔레그램 채널 세션 (양쪽 같은 내용 · 질문 방식)', /터미널 응답에도 그대로/.test(brief) && quiet && dialog && denied && allowed && wired && stopBlocked && stopOnce && stopAsked && stopPlain && remoteDialog && stopRemote, `시작 안내 ${/그대로/.test(brief)} · 채널 아니면 조용 ${quiet} · 기본 선택지 창 ${dialog} · ask text 면 막음 ${denied} · 보통 세션 허용 ${allowed} · Claude 만 ${wired} · 결정 글이면 Stop 막음 ${stopBlocked} · 한 번만 ${stopOnce} · ask 보냈으면 통과 ${stopAsked} · 결정 아니면 통과 ${stopPlain} · 리모트 컨트롤이면 질문 창 ${remoteDialog} · Stop 안 막음 ${stopRemote}`);
  }
  // 팀원 세션(agent teams) · 서브에이전트 안에서는 리더 몫 훅이 조용하다. 리더 쪽 관찰 이벤트(SubagentStop 등)는 agent_id 가 붙어도 돈다
  {
    const tr = path.join(tmp, 'teammate.jsonl');
    fs.writeFileSync(tr, JSON.stringify({ type: 'user', teamName: 'session-x', agentName: 'documenter-b5', message: {} }) + '\n');
    const hookLib = require(path.join(dir, 'packs', 'core', 'lib', 'hook.js'));
    const teammate = hookLib.isTeammate({ hook_event_name: 'Stop', transcript_path: tr });
    const sub = hookLib.isTeammate({ hook_event_name: 'PreToolUse', agent_id: 'a1' });
    const leadSide = !hookLib.isTeammate({ hook_event_name: 'SubagentStop', agent_id: 'a1' }) && !hookLib.isTeammate({ hook_event_name: 'TeammateIdle', teammate_name: 'b5' });
    const lead = !hookLib.isTeammate({ hook_event_name: 'Stop', transcript_path: path.join(tmp, 'none.jsonl') });
    fs.writeFileSync(topic, body(false));
    started('selftest-tm', Date.now() - 60000);
    const quiet = !hook('task-check.js', 'selftest-tm', { transcript_path: tr });
    fs.writeFileSync(topic, body(true));
    record('팀원 세션에서는 리더 몫 훅이 조용', teammate && sub && leadSide && lead && quiet, `팀원 기록 ${teammate} · 서브에이전트 도구 ${sub} · 리더 쪽 관찰 이벤트 ${leadSide} · 리더 ${lead} · 완료 조건 훅 조용 ${quiet}`);
  }
  // 팀원 창 · 프로세스 강제 종료 막기 (team-guard): tmux kill-pane 등은 막고, 읽기(list-panes)는 둔다
  {
    const g = (command) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'team-guard.js'), '--agent=claude'], { cwd: dir, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout;
    const killed = /"deny"/.test(g('tmux -L claude-swarm-65942 kill-pane -t %1 2>&1')) && /"deny"/.test(g('pkill -f "claude --agent"'));
    const read = !g('tmux -L claude-swarm-65942 list-panes -a') && !g('git status');
    record('팀원 강제 종료 막기 (team-guard)', killed && read, `kill-pane · pkill 막음 ${killed} · 읽기 허용 ${read}`);
  }
  // 생성물 비교 — JSON 키 순서만 다르면 같은 것으로 본다 (킷 버전마다 순서가 달라도 커밋이 막히지 않게). 내용이 다르면 "내용 차이"
  {
    const sf = path.join(dir, '.claude', 'settings.json');
    const orig = fs.readFileSync(sf, 'utf8');
    const reversed = (v) => (Array.isArray(v) ? v.map(reversed) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reversed(v[k])])) : v);
    fs.writeFileSync(sf, JSON.stringify(reversed(JSON.parse(orig)), null, 2) + '\n');
    const order = run(process.execPath, ['bin/kit.js', 'check'], dir);
    fs.writeFileSync(sf, orig.replace('"hooks"', '"hooks2"'));
    const diff = run(process.execPath, ['bin/kit.js', 'check'], dir);
    fs.writeFileSync(sf, orig);
    const orderOk = order.ok && /순서만/.test(order.out);
    const diffOk = !diff.ok && /settings\.json \(내용 차이\)/.test(diff.out);
    record('생성물 비교 (JSON 키 순서 무관)', orderOk && diffOk, `순서만 다름 통과 ${orderOk} · 내용 차이 거부 ${diffOk}`);
  }
  // rules.onDemand — 상시 규칙을 필요할 때만 읽게 해 AGENTS.md 를 줄인다 (kedovi rules ondemand)
  {
    const kitLib = require(path.join(dir, 'bin', 'kit.js'));
    const target = (kitLib.generate(dir).allRules || []).find((r) => r.load === 'always' && !r.required && r.scope !== 'repo' && r.agents === 'all');
    const wsFile = path.join(dir, 'workspace.json');
    const raw = fs.readFileSync(wsFile, 'utf8');
    const before = fs.statSync(path.join(dir, 'AGENTS.md')).size;
    const j = JSON.parse(raw);
    j.rules = { ...(j.rules || {}), onDemand: [target.id] };
    fs.writeFileSync(wsFile, JSON.stringify(j, null, 2) + '\n');
    const synced = run(process.execPath, ['bin/kit.js', 'sync', '--quiet'], dir).ok;
    const md = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    const lazyOk = synced && Buffer.byteLength(md) < before && md.includes(`\`${target.out}\` (${target.title})`) && !md.includes(target.body.trim().split('\n').find((l) => l.length > 20));
    fs.writeFileSync(wsFile, raw);
    run(process.execPath, ['bin/kit.js', 'sync', '--quiet'], dir);
    record('rules.onDemand (상시 규칙을 필요할 때만)', !!target && lazyOk, `${target && target.id} · ${before} → ${Buffer.byteLength(md)}B`);
  }
  // 세션 브리핑 — 첫 세션 안내 / 핸드오프가 있으면 마지막 핸드오프 · 진행 중 작업 · 남은 작업 · 공지
  const briefTool = path.join(dir, 'packs', 'core', 'bin', 'brief.js');
  const briefFirst = run(process.execPath, [briefTool], dir).out;
  fs.writeFileSync(path.join(dir, 'handoffs', id || 'kim', 'LATEST.md'), '# 마지막 핸드오프 (2026-09-30)\n\n## 오늘 핵심\n- 서버 끝\n## 진행 중 / 미커밋\n- 화면 연결\n');
  fs.writeFileSync(path.join(dir, 'handoffs', id || 'kim', 'TODO.md'), '# 남은 작업\n\n- 화면 연결\n- 핸드오프 갱신\n');
  fs.writeFileSync(path.join(dir, 'NOTICE.md'), '# 공지\n- 10/15 배포 동결\n');
  fs.writeFileSync(topic, body(false));
  const briefLater = run(process.execPath, [briefTool], dir).out;
  const briefOk = /첫 세션/.test(briefFirst) && /마지막 핸드오프: 2026-09-30/.test(briefLater) && /주문-목록/.test(briefLater) && /미완 2/.test(briefLater) && /내 TODO 2건/.test(briefLater) && /배포 동결/.test(briefLater);
  // 세션 시작 훅이 본문을 컨텍스트로 넘긴다 (첫 메시지는 "세션 브리핑" 한 줄). brief:false 면 조용
  const briefHook = () => (run(process.execPath, [path.join(dir, 'packs', 'core', 'hooks', 'session-brief.js')], dir).out || '').trim();
  const hooked = briefHook();
  const hookOk = /^📋 세션 브리핑\. 사용자의 첫 요청이 "세션 브리핑" 이면/.test(hooked) && /마지막 핸드오프: 2026-09-30/.test(hooked) && /배포 동결/.test(hooked) && /session-brief/.test(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const localF = path.join(dir, '.agents', 'local.json');
  const localWas = fs.existsSync(localF) ? fs.readFileSync(localF, 'utf8') : null;
  fs.mkdirSync(path.dirname(localF), { recursive: true });
  fs.writeFileSync(localF, JSON.stringify({ ...(localWas ? JSON.parse(localWas) : {}), brief: false }));
  const quiet = briefHook() === '';
  if (localWas === null) fs.rmSync(localF); else fs.writeFileSync(localF, localWas);
  record('세션 브리핑 (brief.js · 시작 훅)', briefOk && hookOk && quiet, `첫 세션 ${/첫 세션/.test(briefFirst)} · 핸드오프·작업·TODO·공지 ${/마지막 핸드오프: 2026-09-30/.test(briefLater) && /주문-목록/.test(briefLater) && /미완 작업 1건/.test(briefLater) && /내 TODO 2건/.test(briefLater) && /배포 동결/.test(briefLater)} · 훅이 본문 전달 ${hookOk} · brief:false 면 조용 ${quiet}`);
}

// 팀 구성 — 새 워크스페이스는 자동 모드, 역할 등급(grade)으로 프로필에 없는 역할도 모델이 정해지고, 모델 메뉴가 개인 지침에 들어간다. mode 가 없는 옛 워크스페이스는 고정
{
  const dir = path.join(tmp, 'team-auto');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new'], tmp);
  const got = [];
  const wsFile = path.join(dir, 'workspace.json');
  const local = () => fs.readFileSync(path.join(dir, 'CLAUDE.local.md'), 'utf8');
  const auto = JSON.parse(fs.readFileSync(wsFile, 'utf8')).agents.mode === 'auto' && /모드: \*\*자동\*\*/.test(local()) && /### 쓸 수 있는 모델/.test(local()) && /LiveBench/.test(local());
  const specRow = (local().match(/\| 설계 문서 \(`spec-writer`\) \| high \| 쓰기 \| ([^|]+)\|/) || [])[1] || '';
  const graded = /sonnet · high/.test(specRow) && /^model: sonnet$/m.test(fs.readFileSync(path.join(dir, '.claude', 'agents', 'spec-writer.md'), 'utf8'));
  fs.mkdirSync(path.join(dir, 'packs', 'project', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'packs', 'project', 'agents', 'data-migrator.md'), '---\nname: data-migrator\ntitle: 데이터 이관\ndescription: 이관 스크립트를 쓸 때 맡긴다.\naccess: workspace-write\ngrade: low\n---\n\n# 데이터 이관\n');
  run(process.execPath, ['bin/kit.js', 'sync', '--quiet'], dir);
  const projectRole = /\| 데이터 이관 \(`data-migrator`\) \| low \|/.test(local()) && /^model: haiku$/m.test(fs.readFileSync(path.join(dir, '.claude', 'agents', 'data-migrator.md'), 'utf8'));
  // 요금제 — 로그인 정보(가짜 홈)에서 감지 · 회사마다 고르기 · 여유도가 지침에 · 처음 보는 값 · 바뀐 값 경고 · 워크스페이스 임시 목록
  const home = path.join(tmp, 'fake-home');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x' } }));
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: jwt({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } }) } }));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const am = (...a) => { const r = spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), ...a], { cwd: dir, encoding: 'utf8', env }); return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` }; };
  const kitLib2 = require(path.join(KIT, 'bin', 'kit.js'));
  const cat2 = kitLib2.loadCatalogFor(dir, JSON.parse(fs.readFileSync(wsFile, 'utf8'))).cat;
  const det = kitLib2.detectPlans(cat2, kitLib2.loginPlanValues(home));
  const detected = det.claude.id === 'max20x' && det.codex.id === 'plus';
  am('ai', 'plan', 'claude', 'max5x');
  const changed = /Claude 요금제가 바뀐 것 같습니다 \(로그인: max20x · 저장: max5x\)/.test(am('ai', 'plan', 'gpt', 'plus').out);
  am('team-mode', 'prefer', 'reviewer', 'codex:gpt-6.1-sol');
  const opts = /요금제: Claude Max 5x \(넉넉\) · GPT Plus \(빠듯\) · 선호: reviewer = codex:gpt-6.1-sol/.test(local()) && /\| GPT \(빠듯\) \|/.test(local()) && !am('ai', 'plan', 'gpt', 'nope').ok;
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { organizationType: 'claude_ultra' } }));
  const unknown = /Claude 로그인 요금제 값 'claude_ultra' 가 카탈로그에 없습니다/.test(spawnSync(process.execPath, ['bin/kit.js', 'sync'], { cwd: dir, encoding: 'utf8', env }).stderr);
  const w0 = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
  w0.catalog = { plans: { claude: [{ id: 'max50x', label: 'Max 50x', room: 'ample', sources: ['https://claude.com/pricing'] }, { id: 'pro', label: 'Pro', room: 'tight' }] } };
  fs.writeFileSync(wsFile, JSON.stringify(w0, null, 2));
  const extra = am('ai', 'plan', 'claude', 'max50x');
  const overlay = extra.ok && /Max 50x \(넉넉\)/.test(local()) && /catalog\.plans\.claude pro: 이제 킷 카탈로그에 있습니다/.test(extra.out);
  delete w0.catalog; fs.writeFileSync(wsFile, JSON.stringify(w0, null, 2));
  am('team-mode', 'fixed');
  const fixed = /모드: \*\*고정\*\*/.test(local()) && !/### 쓸 수 있는 모델/.test(local());
  const table = /팀 구성: 고정 .*요금제 .*GPT Plus\(빠듯\)/.test(am('models').out) && /설계 문서\s+high/.test(am('models').out);
  // 옛 워크스페이스: agents.mode 가 없으면 고정 (이 PC 값도 지운다)
  fs.rmSync(path.join(dir, '.agents', 'local.json'), { force: true });
  const w = JSON.parse(fs.readFileSync(wsFile, 'utf8')); delete w.agents.mode; fs.writeFileSync(wsFile, JSON.stringify(w, null, 2));
  run(process.execPath, ['bin/kit.js', 'sync', '--quiet'], dir);
  const legacy = /모드: \*\*고정\*\*/.test(local());
  got.push(`새 워크스페이스 자동 · 모델 메뉴 ${auto}`, `등급으로 spec-writer 모델 ${graded}`, `프로젝트 역할 등급 ${projectRole}`, `로그인 요금제 감지 ${detected}`, `바뀐 요금제 경고 ${changed}`, `요금제 여유도 · 선호 ${opts}`, `처음 보는 요금제 ${unknown}`, `워크스페이스 임시 목록 ${overlay}`, `고정 모드 ${fixed}`, `models 표 ${table}`, `옛 워크스페이스는 고정 ${legacy}`);
  record('팀 구성 (자동 · 고정 · 역할 등급 · 요금제 · 모델 메뉴)', auto && graded && projectRole && detected && changed && opts && unknown && overlay && fixed && table && legacy, got.join(' · '));
}

// 로드맵 — init 이 종류별 기본 단계로 PLAN.md 를 만들고, upgrade 는 없을 때만 만든다. 브리핑 한 줄 · 완료 보고 블록 · JSON · 갱신 누락 경고
{
  const dir = path.join(tmp, 'plan-ws');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'consulting'], tmp);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'kim']);
  const file = path.join(dir, 'handoffs', 'PLAN.md');
  const P = require(path.join(KIT, 'packs', 'core', 'lib', 'plan.js'));
  const got = [];
  const made = fs.existsSync(file) && JSON.stringify(P.parse(fs.readFileSync(file, 'utf8')).stages.map((x) => x.name)) === JSON.stringify(P.PRESETS.consulting.stages);
  const tool = (...a) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'plan.js'), ...a], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  const brief = run(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'brief.js')], dir).out;
  const briefOk = /로드맵 완료 0\/5 · 지금 1\.착수/.test(brief) && /```\n1\.착수 → /.test(brief) && /▲ 지금/.test(brief);
  const block = tool().stdout;
  const blockOk = /완료 0 \/ 전체 5/.test(block) && block.includes('```') && /▲ 지금/.test(block) && /\*\*다음\*\* → /.test(block);
  let json = null;
  try { json = JSON.parse(tool('--json').stdout); } catch { /* 실패 */ }
  const warned = /로드맵: .*기본 단계 그대로/.test(spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'handoff.js'), 'check'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout);
  fs.rmSync(file);
  const up1 = run(process.execPath, ['bin/kit.js', 'upgrade', '--from', KIT], dir);
  const remade = up1.ok && fs.existsSync(file);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<!-- kedovi:preset[^\n]*\n/, '').replace('| 착수 |', '| 킥오프 |'));
  run(process.execPath, ['bin/kit.js', 'upgrade', '--from', KIT], dir);
  const kept = fs.readFileSync(file, 'utf8').includes('| 킥오프 |');
  got.push(`init 이 분석·설계 기본 단계 ${made}`, `브리핑 한 줄 · 흐름도 ${briefOk}`, `완료 보고 블록 ${blockOk}`, `JSON ${!!json && json.total === 5}`, `handoff check 경고 ${warned}`, `upgrade 가 없으면 만듦 ${remade}`, `있으면 그대로 ${kept}`);
  record('로드맵 (PLAN.md · kedovi plan · 브리핑 · upgrade)', made && briefOk && blockOk && !!json && json.total === 5 && warned && remade && kept, got.join(' · '));
}

// 채팅에서도 모든 기능을: kedovi 도움말의 명령(kedovi <명령> [<하위 명령>])이 kedovi 스킬 표에 모두 있어야 한다 (화면 전용 · 실행하지 않는 것도 「실행하지 않는 것」 에 적혀 있어야 한다)
{
  const help = fs.readFileSync(path.join(KIT, 'bin', 'kedovi.js'), 'utf8').split('\n').filter((l) => /^ \*   kedovi /.test(l));
  const skill = fs.readFileSync(path.join(KIT, 'packs', 'core', 'skills', 'kedovi', 'SKILL.md'), 'utf8');
  const cmds = [...new Set(help.flatMap((l) => [...l.matchAll(/kedovi ([a-z][a-z-]*)(?: ([a-z][a-z-]+))?/g)].map((m) => (m[2] && !['init', 'check'].includes(m[1]) ? `kedovi ${m[1]} ${m[2]}` : `kedovi ${m[1]}`))))];
  const missing = cmds.filter((c) => !skill.includes(`\`${c}`) && !skill.includes(`${c}\``) && !skill.includes(`${c} `));
  record('채팅에서도 모든 기능 (kedovi 도움말 ↔ kedovi 스킬)', missing.length === 0, missing.length ? `스킬에 없음: ${missing.join(' · ')}` : `명령 ${cmds.length}개`);
  // kedovi --help 는 분류 요약만, kedovi help <번호> 가 그 분류의 명령: 도움말 머리의 명령은 모두 분류에 들어가야 한다
  const cli = (...a) => spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), ...a], { encoding: 'utf8', input: '' });
  const all = cli('help', '--all').stdout;
  const head = fs.readFileSync(path.join(KIT, 'bin', 'kedovi.js'), 'utf8').split('\n');
  const loose = head.slice(0, head.indexOf(' */')).filter((l) => /^ \*   kedovi /.test(l)).map((l) => l.replace(/^ \*   /, '').split(/\s{3,}/)[0].trim()).filter((u) => !all.includes(u.slice(0, 40)));
  const short = cli('--help');
  const unknown = cli('no-such-command');
  const ok = !loose.length && short.status === 0 && /분류별 명령/.test(short.stdout) && short.stdout.split('\n').length < 30 && /kedovi docs show/.test(cli('help', '7').stdout) && /kedovi start -c/.test(cli('start', '--help').stdout) && unknown.status === 1 && /모르는 명령/.test(unknown.stderr);
  record('도움말 분류 (kedovi --help · help <번호> · <명령> --help)', ok, loose.length ? `분류에 없음: ${loose.join(' · ')}` : `요약 ${short.stdout.split('\n').length}줄 · 모르는 명령 exit ${unknown.status}`);
}

// 진행 방식 — 신규는 스프린트(반복 단계 · AGENTS.md 안내), 분석·설계는 전체. 바꾸면 기본 단계 그대로인 로드맵만 새 뼈대로, 없으면(옛 워크스페이스) 안내 없이 전체처럼
{
  const dir = path.join(tmp, 'approach-ws');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new'], tmp);
  const P = require(path.join(KIT, 'packs', 'core', 'lib', 'plan.js'));
  const kitLib = require(path.join(KIT, 'bin', 'kit.js'));
  const file = path.join(dir, 'handoffs', 'PLAN.md');
  const wsFile = path.join(dir, 'workspace.json');
  const stages = () => P.parse(fs.readFileSync(file, 'utf8')).stages.map((x) => x.name).join('|');
  const agents = () => fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  const setAp = (v) => { const w = JSON.parse(fs.readFileSync(wsFile, 'utf8')); if (v) w.project.approach = v; else delete w.project.approach; fs.writeFileSync(wsFile, JSON.stringify(w, null, 2)); return run(process.execPath, ['bin/kit.js', 'sync'], dir); };
  const inc = JSON.parse(fs.readFileSync(wsFile, 'utf8')).project.approach === 'sprint' && /\*\*진행 방식: MVP · 스프린트/.test(agents()) && /「백로그」/.test(agents()) && stages() === [P.IDEA_STAGE, ...P.PRESETS.sprint.stages].join('|'); // 신규는 아이디어 · 전체 그림부터
  const full = /\*\*진행 방식: 워터폴 · 전체/.test(fs.readFileSync(path.join(tmp, 'plan-ws', 'AGENTS.md'), 'utf8'));
  // 스프린트 끝 날짜가 지났는데 데모 전이면 kedovi plan check 가 ⚠
  const keep = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, keep.replace(/끝: <[^>]*>/, '끝: 2020-01-01'));
  const overdue = /이번 스프린트 끝 날짜\(2020-01-01\)가 지났는데 데모 전/.test(spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'plan.js'), 'check'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }).stdout);
  fs.writeFileSync(file, keep);
  setAp('full'); kitLib.ensurePlan(dir);
  const switched = stages() === [P.IDEA_STAGE, ...P.PRESETS.new.stages].join('|') && /\*\*진행 방식: 워터폴 · 전체/.test(agents());
  // 아이디어 단계만 끝냈어도 진행 방식을 바꿀 때 로드맵을 새로 쓰지 않는다 (그 단계에서 적은 백로그가 사라지지 않게)
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(`| 1 | ${P.IDEA_STAGE} | ▶ |`, `| 1 | ${P.IDEA_STAGE} | ✔ 건너뜀 |`).replace('## 분모 변경', '## 백로그\n\n- 알림\n\n## 분모 변경'));
  setAp('sprint'); kitLib.ensurePlan(dir);
  const after = fs.readFileSync(file, 'utf8');
  const ideaKept = /✔ 건너뜀/.test(after) && /- 알림/.test(after);
  const kept = ideaKept && stages() === [P.IDEA_STAGE, ...P.PRESETS.new.stages].join('|');
  setAp(null);
  const old = !/\*\*진행 방식:/.test(agents());
  const bad = !setAp('fast').ok;
  // 옛 워크스페이스: 그 사이 유형 기본값이 된 팩은 upgrade 가 알린다 (신규 유형인데 screens · datamodel 이 없으면)
  const offPacks = kitLib.missingTypePacks({ project: { type: 'new' }, packs: ['core', 'project'] }, KIT).join(',');
  const noneOff = kitLib.missingTypePacks(JSON.parse(fs.readFileSync(wsFile, 'utf8')), KIT).length === 0;
  record('진행 방식 (스프린트 · 전체 · 로드맵 · 옛 워크스페이스)', inc && overdue && full && switched && kept && old && bad && offPacks === 'screens,datamodel' && noneOff, `신규 = 스프린트 · 안내 · 반복 단계 ${inc} · 끝 날짜 지남 ⚠ ${overdue} · 분석·설계 = 전체 ${full} · 바꾸면 로드맵 새 뼈대 ${switched} · 끝낸 단계 있으면 그대로 ${kept} · 없으면 안내 없음 ${old} · 잘못된 값 막음 ${bad} · 꺼진 기본 팩 알림 ${offPacks} · 새 워크스페이스는 없음 ${noneOff}`);
}

// K-4 이슈형 · 유형 바꾸기 — 운영·고도화 + 이슈형 = 이슈 보드 로드맵 · AGENTS.md 안내, 고친 단계형 로드맵을 이슈형으로 바꾸면 앞에 보드(전 로드맵은 아래),
// kedovi type 은 유형 팩 교체 · 현행 repo 를 개발 repo 로 · 로드맵 새 뼈대(지난 로드맵은 아래), 옛 운영·고도화 기본 단계는 upgrade 가 그대로 둔다
{
  const P = require(path.join(KIT, 'packs', 'core', 'lib', 'plan.js'));
  const kitLib = require(path.join(KIT, 'bin', 'kit.js'));
  const src = path.join(tmp, 'k4-src');
  fs.mkdirSync(src, { recursive: true });
  run('git', ['init', '-q', src], tmp);
  const sm = path.join(tmp, 'k4-sm');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', sm, '--name', 'ksm', '--type', 'enhancement', '--approach', 'issue', '--code', src], tmp);
  const smPlan = P.parse(fs.readFileSync(path.join(sm, 'handoffs', 'PLAN.md'), 'utf8'));
  const board = !!smPlan && smPlan.mode === 'issue' && /\*\*진행 방식: 이슈형/.test(fs.readFileSync(path.join(sm, 'AGENTS.md'), 'utf8'));
  const kedoviBin = path.join(KIT, 'bin', 'kedovi.js');
  const env = { ...process.env, CLAUDE_PROJECT_DIR: undefined };
  const runKedovi = (dir, args) => spawnSync(process.execPath, [kedoviBin, ...args], { cwd: dir, encoding: 'utf8', input: '', env });
  // 고친 스프린트 로드맵 → 이슈형
  const enh = path.join(tmp, 'k4-enh');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', enh, '--name', 'kenh', '--type', 'enhancement', '--code', src], tmp);
  const ef = path.join(enh, 'handoffs', 'PLAN.md');
  fs.writeFileSync(ef, fs.readFileSync(ef, 'utf8').replace(/<!-- kedovi:preset.*\n/, '').replace('| 1 | 스프린트 계획 | ▶ | | |', '| 1 | 스프린트 계획 | ✔ | 2026-10-01 | 2026-10-02 |'));
  const sw = runKedovi(enh, ['approach', 'issue']);
  const et = fs.readFileSync(ef, 'utf8');
  const switched = sw.status === 0 && P.parse(et).mode === 'issue' && /## 이슈형으로 바꾸기 전 로드맵/.test(et) && /\| 1 \| 스프린트 계획 \| ✔ \| 2026-10-01/.test(et);
  // 옛 운영·고도화 기본 단계(반복형) 그대로면 upgrade(ensurePlan)는 바꾸지 않는다
  fs.writeFileSync(ef, P.template('enhancement').replace(/\| 1 \| 요구사항[\s\S]*?\n\n/, `${P.OLD_ENHANCEMENT.map((n, i) => `| ${i + 1} | ${n} | ${i ? '○' : '▶'} | | |`).join('\n')}\n\n`));
  const w = JSON.parse(fs.readFileSync(path.join(enh, 'workspace.json'), 'utf8')); w.project.approach = 'sprint'; fs.writeFileSync(path.join(enh, 'workspace.json'), JSON.stringify(w, null, 2));
  kitLib.ensurePlan(enh);
  const oldKept = P.parse(fs.readFileSync(ef, 'utf8')).stages.map((x) => x.name).join('|') === P.OLD_ENHANCEMENT.join('|');
  // 분석·설계 → 운영·고도화 (현행 repo 를 개발 repo 로)
  const isp = path.join(tmp, 'k4-isp');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', isp, '--name', 'kisp', '--type', 'consulting', '--legacy', src], tmp);
  const legacyName = JSON.parse(fs.readFileSync(path.join(isp, 'workspace.json'), 'utf8')).repos[0].name;
  const ty = runKedovi(isp, ['type', 'enhancement', '--code', legacyName, '--approach', 'full']);
  const iw = JSON.parse(fs.readFileSync(path.join(isp, 'workspace.json'), 'utf8'));
  const it = fs.readFileSync(path.join(isp, 'handoffs', 'PLAN.md'), 'utf8');
  const typed = ty.status === 0 && iw.project.type === 'enhancement' && iw.project.approach === 'full' && iw.repos[0].kind === 'code' && iw.packs.includes('enhancement') && !iw.packs.includes('consulting')
    && P.parse(it).stages.map((x) => x.name).join('|') === P.PRESETS.enhancement.stages.join('|') && /## 지난 로드맵 \(분석·설계/.test(it) && run(process.execPath, ['bin/kit.js', 'check'], isp).ok;
  record('이슈형 · 유형 바꾸기 (K-4)', board && switched && oldKept && typed, `이슈형 보드 · 안내 ${board} · 고친 로드맵 → 이슈형(전 로드맵 남김) ${switched} · 옛 운영·고도화 단계 그대로 ${oldKept} · 분석·설계 → 고도화(팩 · 개발 repo · 새 로드맵 · check) ${typed}${ty.status ? ` · ${ty.stderr.trim()}` : ''}${sw.status ? ` · ${sw.stderr.trim()}` : ''}`);
}

// Node 버전과 상관없는 kedovi 명령 — 고정 위치 실행 파일(~/.local/bin/kedovi)이 설치한 kedovi 이 없어지면 nvm 의 다른 버전에서 찾고,
// zsh 설정에 PATH 한 줄을 한 번만 넣는다. 킷 repo 에서 직접 실행하면 하지 않는다. Windows .cmd 본문도 만든다
{
  const G = require(path.join(KIT, 'bin', 'global-shim.js'));
  const home = path.join(tmp, 'shim-home');
  const nvmKit = path.join(home, '.nvm', 'versions', 'node', 'v24.1.0', 'lib', 'node_modules', 'kedovi', 'bin');
  fs.mkdirSync(nvmKit, { recursive: true });
  fs.writeFileSync(path.join(nvmKit, 'kedovi.js'), "console.log('nvm-kit', process.argv.slice(2).join(' '))\n");
  fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', 'v24.1.0', 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, '.nvm', 'versions', 'node', 'v24.1.0', 'bin', 'node'));
  const env = { SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' };
  const gone = path.join(home, 'old', 'node_modules', 'kedovi', 'bin', 'kedovi.js'); // 지운 Node 버전의 kedovi
  const r1 = G.ensure({ kit: gone, node: '/nope/node', home, env, platform: process.platform === 'linux' ? 'linux' : 'darwin' });
  const r2 = G.ensure({ kit: gone, node: '/nope/node', home, env, platform: process.platform === 'linux' ? 'linux' : 'darwin' });
  const rc = fs.readFileSync(path.join(home, '.zshrc'), 'utf8');
  const once = r1.pathAdded.length === 1 && r2.pathAdded.length === 0 && rc.split(G.MARK).length === 2 && /export PATH="\$HOME\/\.local\/bin:\$PATH"/.test(rc);
  const run = process.platform === 'win32' ? { stdout: 'nvm-kit a b' } : spawnSync(r1.file, ['a', 'b'], { encoding: 'utf8', env: { HOME: home, PATH: '/usr/bin:/bin' } });
  const found = /nvm-kit a b/.test(run.stdout || '');
  const dev = G.ensure({ kit: path.join(KIT, 'bin', 'kedovi.js'), home: path.join(tmp, 'shim-dev'), env }) === null && !fs.existsSync(path.join(tmp, 'shim-dev'));
  const cmd = G.cmdBody({ kit: 'C:\\n\\node_modules\\kedovi\\bin\\kedovi.js', node: 'C:\\n\\node.exe', pkg: 'kedovi' });
  const winOk = /%NVM_HOME%\\v\*/.test(cmd) && /npm root -g/.test(cmd) && /"%N%" "%K%" %\*/.test(cmd) && !/[가-힣]/.test(cmd);
  record('Node 버전과 상관없는 kedovi 명령', once && found && dev && winOk, `PATH 한 줄 한 번 ${once} · 지운 버전 대신 nvm 의 다른 버전 kedovi 실행 ${found} · 킷 repo 실행은 안 함 ${dev} · Windows .cmd ${winOk}${found ? '' : ` · ${(run.stderr || '').trim()}`}`);
}

// 워크스페이스 현황판 — kedovi board 가 .agents/board/ 에 현황 · 기록 쪽을 만들고(gitignore), 문서 사이트와 같은 틀이다
{
  const dir = path.join(tmp, 'plan-ws');
  fs.mkdirSync(path.join(dir, 'handoffs', 'kim', 'topics'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'handoffs', 'kim', 'LATEST.md'), '# 마지막 핸드오프 (2026-10-01)\n\n## 오늘 핵심\n\n- 현황판 시험\n');
  fs.writeFileSync(path.join(dir, 'NOTICE.md'), '# 공지\n\n금요일 배포\n');
  const r = spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'board.js'), '--no-open', '--no-fetch'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  const b = (f) => { try { return fs.readFileSync(path.join(dir, '.agents', 'board', f), 'utf8'); } catch { return ''; } };
  const index = b('index.html');
  const made = r.status === 0 && /현황판<\/h1>/.test(index) && /로드맵 완료 0\/5/.test(index) && /금요일 배포/.test(index) && /<a href="handoffs\/kim\/LATEST.html">kim<\/a>/.test(index);
  const chrome = /<nav class="side"[^>]*>.*kim \(나\)/s.test(index) && /<aside class="toc">/.test(index) && b('handoffs/kim/LATEST.html').includes('현황판 시험') && /설정 요약/.test(b('설정.html'));
  const ignored = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').includes('.agents/board/');
  record('워크스페이스 현황판 (kedovi board)', made && chrome && ignored, `현황 · 로드맵 · 공지 · 팀 ${made} · 메뉴 · 목차 · 기록 · 설정 ${chrome} · gitignore ${ignored}${r.status ? ` · ${r.stderr.slice(-200)}` : ''}`);
}

// 핸드오프 기록 — 크기 검사 · 작업 색인 · 찾기(다른 사람 기록 포함) · 보관
{
  const dir = path.join(tmp, 'handoff-ws');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', dir, '--type', 'new'], tmp);
  spawnSync('git', ['-C', dir, 'config', 'user.name', 'kim']);
  const h = (...a) => spawnSync(process.execPath, [path.join(dir, 'packs', 'core', 'bin', 'handoff.js'), ...a], { cwd: dir, encoding: 'utf8' });
  const me = path.join(dir, 'handoffs', 'kim');
  fs.mkdirSync(path.join(me, 'topics'), { recursive: true });
  fs.writeFileSync(path.join(me, 'LATEST.md'), `# 마지막 핸드오프 (2026-01-01)\n\n${'긴 내용 '.repeat(800)}`);
  const bigFails = h('check').status !== 0;
  fs.writeFileSync(path.join(me, 'LATEST.md'), '# 마지막 핸드오프 (2026-01-01)\n\n## 오늘 핵심\n- [주문-목록](topics/주문-목록.md)\n');
  // 미완 업무의 정본은 작업 기록: 진행 중인데 완료 조건이 없거나 비었거나, 상태 줄이 없으면 막는다. TODO.md 는 건드리지 않는다
  const topicF = path.join(me, 'topics', '주문-목록.md');
  const head = '# 주문-목록\n관련: REQ-ORD-012 · IM-401\n상태: 진행 중\n마지막: 2026-01-01\n한 줄: 페이지네이션 서버 완료\n\n## 요약\n- 커서 방식으로 정함\n';
  fs.writeFileSync(topicF, head);
  const noCriteria = h('check');
  fs.writeFileSync(topicF, `${head}\n## 완료 조건\n`);
  const emptyCriteria = h('check');
  fs.writeFileSync(topicF, head.replace('상태: 진행 중\n', ''));
  const noStatus = h('check');
  const openBlocked = noCriteria.status !== 0 && /완료 조건" 이 없다/.test(noCriteria.stdout) && emptyCriteria.status !== 0 && /완료 조건이 비어/.test(emptyCriteria.stdout) && noStatus.status !== 0 && /"상태:" 줄이 없다/.test(noStatus.stdout) && !fs.existsSync(path.join(me, 'TODO.md'));
  fs.writeFileSync(topicF, `${head}\n## 완료 조건\n- [x] 서버\n- [ ] 화면 연결\n`);
  const smallOk = h('check').status === 0;
  h('index');
  const idx = fs.existsSync(path.join(me, 'INDEX.md')) && fs.readFileSync(path.join(me, 'INDEX.md'), 'utf8').includes('| [주문-목록](topics/');
  fs.mkdirSync(path.join(dir, 'handoffs', 'lee'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'handoffs', 'lee', '2025-W10.md'), '# 주차\n\n## 2025-03-03\n- IM-401 원인은 정렬 키 누락\n');
  const found = h('find', 'IM-401').stdout;
  const findOk = /topics\/주문-목록\.md/.test(found) && /handoffs\/lee\/2025-W10\.md:4/.test(found);
  fs.writeFileSync(path.join(me, '2025-W01.md'), '# 오래된 주\n');
  h('archive');
  const archived = fs.existsSync(path.join(me, 'archive', '2025-W01.md')) && !fs.existsSync(path.join(me, '2025-W01.md'));
  record('핸드오프 기록 (검사 · 색인 · 찾기 · 보관)', bigFails && openBlocked && smallOk && idx && findOk && archived, `큰 LATEST 막기 ${bigFails} · 완료 조건·상태 없는 진행 중 기록 막기(TODO 는 그대로) ${openBlocked} · 정상 통과 ${smallOk} · 색인 ${idx} · 찾기 ${findOk} · 보관 ${archived}`);
}

// 모델 카탈로그 — 오류(없는 ID·퇴역 모델 추천·근거 빠짐)와 문서의 추천 표가 models.json 과 같은지. 조사 시기·퇴역 임박은 경고로만
{
  const models = require('./models.js');
  const { errors, warnings } = models.check();
  const stale = models.writeDocs(undefined, { dryRun: true }).filter((r) => r.changed || r.missing.length).map((r) => r.file);
  record('모델 카탈로그 · 추천 표 (bin/models.js)', !errors.length && !stale.length,
    [...errors.slice(0, 4), ...(stale.length ? [`표가 다름: ${stale.join(', ')} — node bin/models.js doc`] : []), ...warnings.map((w) => `⚠ ${w}`)].join(' | ') || '오류 없음');
}

// 변경 기록 — 지금 버전 항목이 CHANGELOG.md 에 있어야 한다 (kedovi upgrade 가 버전 사이 항목을 보여 준다). 패키지에 들어가야 다른 PC 에도 보인다
{
  const ver = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8')).version;
  const pkgFiles = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8')).files || [];
  let log = '';
  try { log = fs.readFileSync(path.join(KIT, 'CHANGELOG.md'), 'utf8'); } catch { /* 없음 */ }
  const sec = (log.split(/^## /m).find((x) => x.startsWith(`${ver}\n`)) || '');
  const ok = /\|[^\n]+\|[^\n]+\|/.test(sec.split('\n').slice(3).join('\n')) && pkgFiles.includes('CHANGELOG.md');
  record('변경 기록 CHANGELOG.md', ok, ok ? ver : `## ${ver} 항목(| 구분 | 내용 | 표)이 없거나 package.json files 에 빠짐`);
}

// 기획 repo 뼈대 (읽는 순서 메뉴 · 정본 하나 · 시스템 구성 양식) · 문서 사이트 메뉴 · @spec 추적(--md · --new) · 문서와 다름 설정
{
  const ws = path.join(tmp, 'plan-flow');
  run(process.execPath, [path.join(KIT, 'bin', 'kit.js'), 'init', ws, '--type', 'new', '--code', 'new:app'], tmp);
  const docs = path.join(ws, 'repos', 'plans');
  const nd = spawnSync(process.execPath, [path.join(KIT, 'bin', 'kedovi.js'), 'init-docs', docs], { cwd: ws, encoding: 'utf8' });
  const has = (f) => fs.existsSync(path.join(docs, f));
  const skeleton = nd.status === 0 && ['README.md', 'docs-site.json', '00-overview/overview.md', '00-overview/idea.md', '10-system/architecture.md', '20-features/requirements.md', '20-features/_template.md', '30-screens/README.md', '30-screens/_template.html', '30-screens/prototype/README.md', '40-data/_template.md', '45-api/README.md', '90-decisions/_template.md', '90-decisions/open-questions.md'].every(has)
    && !['01-requirements', '02-screens', '05-decisions', '06-data'].some(has);
  const built = spawnSync(process.execPath, [path.join(ws, 'packs', 'core', 'bin', 'docs-site.js'), 'build', docs], { cwd: ws, encoding: 'utf8' });
  let menu = [];
  try { menu = JSON.parse(fs.readFileSync(path.join(docs, 'docs-site', 'assets', 'nav.js'), 'utf8').replace(/^window\.DS_NAV = /, '').replace(/;\s*$/, '')).groups.map((g) => g.group || g.name); } catch { /* 없음 */ }
  const order = ['개요', '시스템 구성', '기능', '화면', '데이터 · API', '결정 · 미결'];
  const menuOk = built.status === 0 && order.every((g, i) => menu[i] === g) && !menu.includes('기타');
  // @spec 추적: 코드 · 테스트 나눠 세기, --md 추적표, --new 새 진입 파일
  const wsFile = path.join(ws, 'workspace.json');
  const w = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
  w.repos.push({ name: 'plans', kind: 'docs', local: true });
  w.vars = { ...(w.vars || {}), docs: { ...((w.vars || {}).docs || {}), traceIds: 'FN,SCR,AC' } };
  fs.writeFileSync(wsFile, JSON.stringify(w, null, 2));
  fs.writeFileSync(path.join(docs, '20-features', 'order.md'), '# 주문 기능\n\n> 상태: 확정\n\n## FN-ORD-001 주문\n\n| ID | 조건 | 결과 |\n|---|---|---|\n| AC-ORD-001-1 | a | b |\n| AC-ORD-001-2 | c | d |\n');
  const app = path.join(ws, 'repos', 'app');
  fs.mkdirSync(path.join(app, 'src'), { recursive: true }); fs.mkdirSync(path.join(app, 'test'), { recursive: true });
  fs.writeFileSync(path.join(app, 'src', 'OrderController.java'), '// @spec FN-ORD-001 AC-ORD-001-2\nclass OrderController {}\n');
  fs.writeFileSync(path.join(app, 'test', 'OrderTest.java'), '// @spec AC-ORD-001-1\n');
  fs.writeFileSync(path.join(app, 'src', 'PayController.java'), 'class PayController {}\n');
  spawnSync('git', ['-C', app, 'add', '-A']);
  const tr = (...a) => spawnSync(process.execPath, [path.join(ws, 'packs', 'core', 'bin', 'docs-site.js'), 'trace', ...a], { cwd: ws, encoding: 'utf8' });
  const base = tr().stdout;
  const traced = /테스트에 없는 수용 기준 1개[\s\S]*AC-ORD-001-2/.test(base) && !/AC-ORD-001-1\n/.test(base.split('테스트에 없는')[1] || '');
  const md = tr('--md').stdout;
  const mdOk = /\| FN-ORD-001 \| 20-features\/order\.md \| `app\/src\/OrderController\.java` \| 없음 \|/.test(md) && /\| AC-ORD-001-1 \| .* \| 없음 \| `app\/test\/OrderTest\.java` \|/.test(md);
  const nw = tr('--new').stdout;
  const newOk = /기획 ID 가 없는 새 진입 파일 1개[\s\S]*app\/src\/PayController\.java/.test(nw) && !/OrderController/.test(nw);
  // 커밋 전 훅 (spec-commit.js): 코드 repo 의 git commit 에 알림 · 막지 않음 · 다른 명령 · 끄기는 조용
  const sc = (command, cwd = ws) => spawnSync(process.execPath, [path.join(ws, 'packs', 'core', 'hooks', 'spec-commit.js'), '--agent=claude'], { cwd: ws, encoding: 'utf8', input: JSON.stringify({ session_id: 'spec-1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }), env: { ...process.env, CLAUDE_PROJECT_DIR: ws } }).stdout;
  const warnOut = sc('git -C repos/app commit -m x');
  const specHook = /"additionalContext":"⚠ 기획 ID\(@spec\) 가 없는 새 진입 파일 1개: app\/src\/PayController\.java/.test(warnOut) && !/"deny"/.test(warnOut)
    && /PayController/.test(sc('cd repos/app && git commit -m x')) && !sc('git -C repos/app status').trim() && !sc('git commit -m x').trim();
  const w2 = JSON.parse(fs.readFileSync(wsFile, 'utf8')); w2.vars.docs.traceOnCommit = 'off'; fs.writeFileSync(wsFile, JSON.stringify(w2, null, 2));
  const specOff = !sc('git -C repos/app commit -m x').trim();
  w2.vars.docs.traceOnCommit = 'warn'; fs.writeFileSync(wsFile, JSON.stringify(w2, null, 2));
  // 문서와 다름 설정: 기본 approve 가 규칙에 들어간다
  const agentsMd = fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8');
  const sync = /`vars\.docs\.syncMode` \(지금 `approve`\)/.test(agentsMd) && /@spec SCR-ORD-01 FN-ORD-003/.test(agentsMd) && /`approve` 면 사용자 승인 뒤/.test(fs.readFileSync(path.join(ws, '.agents', 'rules', 'core--45-docs-writing.md'), 'utf8'));
  // 0.74 전 신규 스프린트 로드맵(아이디어 단계 없음 · 기본 단계 표시 · 끝낸 단계 없음 · 백로그 있음)을 upgrade 가 새로 쓰지 않는다
  const P2 = require(path.join(KIT, 'packs', 'core', 'lib', 'plan.js'));
  const planFile = path.join(ws, 'handoffs', 'PLAN.md');
  const oldPlan = P2.template('new', {}, 'sprint').split('\n').filter((l) => !l.includes(`| ${P2.IDEA_STAGE} |`)).join('\n')
    .replace('| 2 | 스프린트 계획 | ○ | | |', '| 1 | 스프린트 계획 | ▶ | 2026-10-25 | |').replace('## 백로그\n', '## 백로그\n\n- 알림\n');
  fs.writeFileSync(planFile, oldPlan);
  require(path.join(KIT, 'bin', 'kit.js')).ensurePlan(ws);
  const kept = fs.readFileSync(planFile, 'utf8');
  const planKept = /- 알림/.test(kept) && /\| 1 \| 스프린트 계획 \| ▶ \| 2026-10-25/.test(kept) && !kept.includes(`| ${P2.IDEA_STAGE} |`);
  const arch = fs.readFileSync(path.join(docs, '10-system', 'architecture.md'), 'utf8');
  const archOk = /^# 시스템 구성도/m.test(arch) && /견본이다/.test(arch) && !/## 변경 이력/.test(arch);
  // 규모 문서: 뼈대에 들어가고, 결정 기록에 「전제한 규모」 칸, 규칙이 수치로 판단하게 한다 (「과하다」 를 짐작으로 말하지 않게)
  const scaleDoc = path.join(docs, '00-overview', 'scale.md');
  const rulesTxt = fs.readFileSync(path.join(ws, '.agents', 'rules', 'core--25-work-principles.md'), 'utf8');
  const scaleOk = fs.existsSync(scaleDoc) && /^# 규모 · 비기능/m.test(fs.readFileSync(scaleDoc, 'utf8'))
    && /## 전제한 규모/.test(fs.readFileSync(path.join(docs, '90-decisions', '_template.md'), 'utf8'))
    && /규모 판단은 수치로 한다/.test(rulesTxt) && /\| 7 \| 규모:/.test(fs.readFileSync(path.join(KIT, 'packs', 'core', 'skills', 'idea', 'SKILL.md'), 'utf8'));
  record('기획 repo 뼈대 · 메뉴 순서 · @spec 추적 · 커밋 전 알림 · 문서와 다름 설정', skeleton && menuOk && traced && mdOk && newOk && specHook && specOff && sync && planKept && archOk && scaleOk,
    `옛 신규 로드맵 그대로(백로그 · 날짜) ${planKept} · 구성도 견본 표시 · 이력 표 없음 ${archOk} · 규모 문서 · 전제한 규모 · 규칙 ${scaleOk} · `
    + `뼈대 ${skeleton} · 메뉴 ${menuOk} (${menu.join(' > ')}) · 코드 · 테스트 나눠 세기 ${traced} · --md 추적표 ${mdOk} · --new ${newOk} · 커밋 전 알림 ${specHook} · 끄기 ${specOff} · syncMode · @spec 규칙 ${sync}`);
}


// 언어 ↔ 언어 팩: stacks.json languages[].pack 과 팩의 pack.json languages 가 서로 맞아야 한다 (한쪽만 고치면 문서와 실제 붙는 곳이 갈린다)
{
  const st = JSON.parse(fs.readFileSync(path.join(KIT, 'packs', 'core', 'stacks.json'), 'utf8'));
  const bad = [];
  for (const l of st.languages || []) {
    if (!l.pack) continue;
    const f = path.join(KIT, 'packs', l.pack, 'pack.json');
    if (!fs.existsSync(f)) { bad.push(`${l.id}: 팩 ${l.pack} 없음`); continue; }
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (m.category !== 'lang' || !(m.languages || []).includes(l.id)) bad.push(`${l.pack}: category lang · languages 에 ${l.id} 필요`);
  }
  for (const n of fs.readdirSync(path.join(KIT, 'packs'))) {
    const f = path.join(KIT, 'packs', n, 'pack.json');
    if (!fs.existsSync(f)) continue;
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const id of m.languages || []) if (!(st.languages || []).some((l) => l.id === id && l.pack === n)) bad.push(`${n}: stacks.json languages 의 ${id} 에 "pack": "${n}" 필요`);
  }
  record('언어 ↔ 언어 팩 (stacks.json languages · pack.json languages)', !bad.length, bad.join(' | '));
}

// 프로토타입대로 구현: 화면 비교 도구가 프로토타입(화면 목록 칸 · 파일 이름)과 구현 주소(@spec 줄의 @route)를 찾고, 리뷰 지시서에 비교표가 없으면 알린다 · doctor 원격 기본 브랜치
{
  const ws = path.join(tmp, 'plan-flow');
  const docs = path.join(ws, 'repos', 'plans');
  const app = path.join(ws, 'repos', 'app');
  fs.mkdirSync(path.join(docs, '30-screens', 'prototype'), { recursive: true });
  fs.writeFileSync(path.join(docs, '30-screens', 'prototype', 'orders.html'), '<!doctype html><title>주문</title><div data-screen="SCR-ORD-01">주문</div>');
  fs.writeFileSync(path.join(docs, '30-screens', 'prototype', 'SCR-ORD-02.html'), '<!doctype html><title>상세</title>');
  const readme = path.join(docs, '30-screens', 'README.md');
  fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(/^\| SCR-<영역>-01 .*$/m, '| SCR-ORD-01 | 주문 목록 | 주문 | FN-ORD-001 | prototype/orders.html | - |\n| SCR-ORD-03 | 통계 | 주문 | FN-ORD-001 | - | - |'));
  fs.writeFileSync(path.join(app, 'src', 'OrdersPage.tsx'), '// @spec SCR-ORD-01 FN-ORD-001 @route /orders\nexport default function OrdersPage() {}\n');
  fs.writeFileSync(path.join(app, 'src', 'OrderDetail.tsx'), '/**\n * @spec SCR-ORD-02 FN-ORD-001\n * @route /orders/:id\n */\n');
  spawnSync('git', ['-C', app, 'add', '-A']);
  const cmp = (...a) => spawnSync(process.execPath, [path.join(ws, 'packs', 'screens', 'bin', 'compare-screens.js'), ...a, '--find'], { cwd: ws, encoding: 'utf8' });
  const json = (r) => { try { return JSON.parse(r.stdout); } catch { return { prototype: {}, implementation: {}, widths: [] }; } };
  const r1 = cmp('SCR-ORD-01');
  const f1 = json(r1);
  const listed = r1.status === 0 && /prototype\/orders\.html$/.test(f1.prototype.url) && /화면 목록/.test(f1.prototype.how) && f1.implementation.url === 'http://localhost:5173/orders' && f1.widths.join() === '1280,390';
  const r2 = cmp('SCR-ORD-02');
  const byName = r2.status === 1 && /@route \/orders\/:id 에 자리 값이 있습니다\. 실제 값으로 --impl \/orders\/<id>/.test(r2.stderr);
  const r3 = cmp('SCR-ORD-02', '--impl', '/orders/7', '--base', 'http://127.0.0.1:9');
  const f3 = json(r3);
  const impl = r3.status === 0 && /SCR-ORD-02\.html$/.test(f3.prototype.url) && f3.implementation.url === 'http://127.0.0.1:9/orders/7';
  const r4 = cmp('SCR-ORD-09');
  const missing = r4.status === 1 && /SCR-ORD-09 의 프로토타입을 찾지 못했습니다/.test(r4.stderr);
  const R = require(path.join(ws, 'packs', 'core', 'lib', 'review.js'));
  const gap = /SCR-ORD-01/.test(R.prototypeGap(ws, '검사: npm test 통과\n주문 목록 화면(SCR-ORD-01) 리뷰')) && !R.prototypeGap(ws, 'SCR-ORD-01 리뷰\n| 프로토타입 요소 | 구현 | 다른 이유 |') && !R.prototypeGap(ws, 'SCR-ORD-03 리뷰') && !R.prototypeGap(ws, 'API 리뷰');
  const agentsMd = fs.readFileSync(path.join(ws, 'AGENTS.md'), 'utf8');
  const rule = /프로토타입이 있는 화면 구현/.test(agentsMd) && /kedovi screens compare/.test(fs.readFileSync(path.join(ws, '.agents', 'rules', 'core--21-verification.md'), 'utf8'));
  // doctor: 원격 기본 브랜치가 통합 브랜치가 아니면 · 영구 브랜치가 아닌 main 이 뒤처졌으면 알린다 (안내만)
  const remote = path.join(tmp, 'branch-remote.git');
  const seed = path.join(tmp, 'branch-seed');
  const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: tmp, encoding: 'utf8' });
  g('init', '-q', '-b', 'main', seed);
  g('-C', seed, 'commit', '-q', '--allow-empty', '-m', 'a');
  g('-C', seed, 'switch', '-q', '-c', 'develop');
  g('-C', seed, 'commit', '-q', '--allow-empty', '-m', 'b');
  g('-C', seed, 'commit', '-q', '--allow-empty', '-m', 'c');
  g('clone', '-q', '--bare', seed, remote);
  g('-C', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  g('clone', '-q', remote, path.join(ws, 'repos', 'svc'));
  const wsFile = path.join(ws, 'workspace.json');
  const w = JSON.parse(fs.readFileSync(wsFile, 'utf8'));
  w.repos.push({ name: 'svc', kind: 'code', remote });
  w.vars.branch = { develop: 'develop', release: 'release' };
  fs.writeFileSync(wsFile, JSON.stringify(w, null, 2));
  const doc = () => spawnSync(process.execPath, [path.join(ws, 'packs', 'core', 'bin', 'doctor.js')], { cwd: ws, encoding: 'utf8', env: { ...process.env, KEDOVI_VERSION: '0.0.0' } }).stdout;
  const d1 = doc();
  const warnMain = /△ 기본 브랜치: svc\. 원격 기본 브랜치: main\. 통합 브랜치\(develop\)/.test(d1) && /△ 낡은 브랜치: svc main\. 영구 브랜치가 아닌 main: develop 보다 2커밋 뒤처짐 · main 에만 있는 커밋 0개/.test(d1) && /push origin --delete main/.test(d1);
  g('-C', remote, 'symbolic-ref', 'HEAD', 'refs/heads/develop');
  const d2 = doc();
  const okDev = /✓ 기본 브랜치: svc\. develop/.test(d2) && /낡은 브랜치: svc main/.test(d2);
  g('-C', remote, 'branch', '-D', 'main');
  const d3 = doc();
  const cleaned = /✓ 기본 브랜치: svc\. develop/.test(d3) && !/낡은 브랜치/.test(d3);
  record('프로토타입대로 구현 (화면 비교 · 지시서 비교표 · 규칙) · doctor 원격 기본 브랜치', listed && byName && impl && missing && gap && rule && warnMain && okDev && cleaned,
    `목록 칸 · @route ${listed} · 자리 값 경로 막음 ${byName} · 파일 이름 · --impl ${impl} · 없음 ${missing} · 지시서 비교표 알림 ${gap} · 상시 규칙 · 검증 규칙 ${rule} · 기본 브랜치 main 알림 ${warnMain} · develop 정상 ${okDev} · main 지우면 조용 ${cleaned}`);
}

// 업무 흐름 문서 — 선택 화면의 질문 문구와 kedovi 명령이 docs/workflow.md 에 모두 있어야 한다 (화면을 고치면 문서도 같이)
{
  const src = fs.readFileSync(path.join(KIT, 'bin', 'kedovi.js'), 'utf8');
  const doc = fs.readFileSync(path.join(KIT, 'docs', 'workflow.md'), 'utf8').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const asked = new Set();
  // message: 바로 뒤의 문구만 — '…' · `…${x}…` · 조건 ? '…' : '…'
  for (const m of src.matchAll(/message:\s*(?:'([^']*)'|`([^`]*)`|[^,'`]*\?\s*'([^']*)'\s*:\s*'([^']*)')/g)) {
    for (const q of [m[1], m[3], m[4]]) if (q && /[가-힣]/.test(q)) asked.add(q);
    if (m[2]) m[2].split(/\$\{[^}]*\}/).map((x) => x.trim()).filter((x) => /[가-힣]/.test(x)).forEach((x) => asked.add(x));
  }
  const cmds = [...src.matchAll(/^ \*   kedovi ([a-z-]+)/gm)].map((x) => `kedovi ${x[1]}`);
  const extra = (src.match(/^ \*   kedovi sync \| check \| doctor \| packs/m) ? ['kedovi sync', 'kedovi check', 'kedovi doctor', 'kedovi packs'] : []);
  const missing = [...[...asked].filter((q) => !doc.includes(q)), ...[...cmds, ...extra].filter((c) => !doc.includes(c))];
  record('업무 흐름 문서(docs/workflow.md)가 화면·명령과 맞음', missing.length === 0, missing.length ? `없음: ${missing.slice(0, 6).join(' | ')}` : `질문 ${asked.size} · 명령 ${cmds.length + extra.length}`);
}

const skillFiles = walk(path.join(KIT, 'packs'), (p) => p.includes(`${path.sep}skills${path.sep}`) && p.endsWith('.md'));
const toolHits = [];
for (const f of skillFiles) {
  if (/AskUserQuestion|subagent_type|CLAUDE_PROJECT_DIR|TodoWrite/.test(fs.readFileSync(f, 'utf8'))) toolHits.push(path.relative(KIT, f));
}
record('스킬에 Claude 전용 도구 이름 없음', toolHits.length === 0, toolHits.join(', '));

fs.rmSync(tmp, { recursive: true, force: true });

// 알림 격리 확인: 테스트 중 띄운 도구가 이 PC 의 실제 봇 설정을 읽지 않는다
{
  const probe = spawnSync(process.execPath, ['-e', `const n = require(${JSON.stringify(path.join(KIT, 'packs', 'core', 'lib', 'notify.js'))}); process.stdout.write(JSON.stringify({ keys: Object.keys(n.readSecrets()), api: process.env.KEDOVI_TELEGRAM_API }))`], { encoding: 'utf8' });
  let r = {};
  try { r = JSON.parse(probe.stdout); } catch { /* 실패로 남는다 */ }
  record('테스트 알림 격리 (실제 텔레그램으로 안 보냄)', Array.isArray(r.keys) && !r.keys.length && /127\.0\.0\.1/.test(r.api || ''), `설정 키 ${(r.keys || ['?']).length}개 · 주소 ${r.api}`);
  fs.rmSync(notifyHome, { recursive: true, force: true });
}

const w = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.name.padEnd(w)}  ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? `✖ 실패 ${failed}건` : '✔ 전부 통과'} (${results.length}개 항목)`);
process.exit(failed ? 1 : 0);
