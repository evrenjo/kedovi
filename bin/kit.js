#!/usr/bin/env node
/**
 * agent-workspace-kit — 한 벌의 정본(packs/ + workspace.json)에서 Claude Code 와 Codex 설정을 함께 만든다.
 *
 *   node bin/kit.js init <대상폴더> --name <id> --title <제목> --type new|modernization|enhancement|consulting [--approach sprint|full]
 *                        [--code <주소,..>] [--docs <주소,..>] [--issues <주소,..>] [--legacy <주소,..>]
 *   node bin/kit.js install         repos/ 에 clone(또는 링크) + git 훅 경로 + sync (clone 직후 1회)
 *   node bin/kit.js detect [--force] 코드 repo 의 스택 감지 → workspace.json repos[].stacks (--force 면 다시)
 *        [--hint <스택> --contains <정규식>]  사내 라이브러리로 간접 의존하는 스택 힌트 추가 → stackHints
 *   node bin/kit.js sync            정본 → 생성물 (AGENTS.md, CLAUDE.md, 스킬, 훅, MCP)
 *   node bin/kit.js check           생성물이 정본과 같은지 + 예산·변수·스킬 검사 (pre-commit 이 부른다)
 *   node bin/kit.js upgrade --from <kit 경로> [--add 팩,팩]   킷의 bin·팩을 새 버전으로 교체·팩 추가
 *   node bin/kit.js packs           사용 가능한 팩 목록
 *
 * 대화형 화면·에이전트 실행은 전역 명령 `kedovi` (init · install · start). 이 파일은 그 엔진이다.
 * 의존성 없음 (Node 18+).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const GEN_NOTE = '생성 파일: `node bin/kit.js sync` 로 다시 만든다. 직접 고치지 말 것 (정본 = packs/ · workspace.json)';
const DEFAULT_AGENTS_MD_BYTES = 32 * 1024; // Codex project_doc_max_bytes 기본값
const ENFORCE_LEVELS = ['off', 'warn', 'block']; // agents.enforce.* 훅 강제 수준 (약한 것부터)
const ENFORCE_DEFAULTS = { teammateName: { level: 'block', max: 'block' }, rosterAnnounce: { level: 'warn', max: 'warn' }, reviewBeforePush: { level: 'off', max: 'block' }, idleTeammates: { level: 'block', max: 'block' }, waitStatus: { level: 'block', max: 'block' }, decisionAsk: { level: 'block', max: 'block' }, longRunning: { level: 'block', max: 'block' }, checkBeforeReview: { level: 'block', max: 'block' }, planFirst: { level: 'warn', max: 'block' } }; // 기본값 · 가장 센 값
const MAX_AGENTS_MD_BYTES = 96 * 1024; // 이 위로는 sync 가 막는다 (context 낭비)
const PERSONAL_HEADROOM = 12 * 1024; // 개인 지침(응답 언어 · 대화 스타일 약 1.7KB · 역할 상한 · 팀 구성(역할 · 모델 메뉴) · 위임 표 · 잠금)이 AGENTS.override.md 에 더해지는 몫. 자동 모드에서 약 8KB
const MANIFEST = '.agents/.generated.json';
const REPOS_DIR = 'repos'; // 코드·기획·레거시 repo 는 전부 워크스페이스 안 repos/<이름> (git 제외)
/** repo 폴더 (워크스페이스 기준) — repos/<이름>, group 이 있으면 repos/<그룹>/<이름>. packs/core/lib/workspace.js · workspace.py 와 한 쌍 */
const repoRel = (r) => [REPOS_DIR, ...(r.group ? [r.group] : []), r.name || ''].join('/');
// repo 이름 · 그룹 = 폴더 한 단계. '.' · '..' 와 '-' 로 시작하는 것은 막는다 (repos/ 밖으로 나가거나 git 옵션으로 읽히지 않게)
const REPO_SEG = /^(?!\.{1,2}$)[A-Za-z0-9._][A-Za-z0-9._-]*$/;
// clone 주소: '-' 로 시작(git 옵션)하거나 '<이름>::' 전송 도우미(ext:: 는 명령을 실행한다)는 받지 않는다
const safeRemote = (v) => typeof v === 'string' && !!v && !v.startsWith('-') && !/^[A-Za-z][A-Za-z0-9+.-]*::/.test(v);
/** workspace.json 의 repo 항목을 디스크에 써도 되는지 (이름 · 그룹 · 주소). 팀원이 고친 workspace.json 도 이걸 거친 뒤에만 clone · 링크한다 */
const repoSafe = (r) => REPO_SEG.test(r.name || '') && (r.group === undefined || (typeof r.group === 'string' && REPO_SEG.test(r.group))) && (!r.remote || safeRemote(r.remote));
const LOCAL_CONFIG = '.agents/local.json'; // 이 PC·이 워크스페이스 전용 설정 (메인 에이전트 등)
// 시작 유형 (SI 분류) — 유형마다 자동으로 들어가는 팩과, 필수·경고 대상 자료 종류
const PROJECT_TYPES = {
  new: '신규 구축',
  modernization: '차세대 (재구축 · AS-IS → TO-BE)',
  enhancement: '운영·고도화 (SM 포함)',
  consulting: '분석·설계 (ISP·ISMP)',
};
const TYPE_RULES = {
  // defaults: 그 유형에 기본으로 켜는 팩 (화면 · 데이터를 새로 설계하는 유형은 화면설계서 · 데이터 설계)
  // approach: 새 워크스페이스의 진행 방식 기본값 (전체 설계가 산출물인 차세대 · ISP 만 전체)
  new: { pack: null, requires: [], warnsOn: ['legacy'], defaults: ['screens', 'datamodel'], approach: 'sprint' },
  modernization: { pack: 'modernization', requires: ['legacy'], warnsOn: [], defaults: ['screens', 'datamodel'], approach: 'full' },
  enhancement: { pack: 'enhancement', requires: ['code'], warnsOn: ['legacy'], approach: 'sprint' },
  consulting: { pack: 'consulting', requires: [], warnsOn: ['code'], approach: 'full' },
};
// 진행 방식 (workspace.json project.approach). 없으면 전체처럼 동작한다 (옛 워크스페이스는 kedovi approach 로 고른다)
const APPROACHES = {
  sprint: 'MVP · 스프린트 (끝까지 동작하는 최소 기능부터, 스프린트마다 데모하며 하나씩 붙인다)',
  full: '워터폴 · 전체 (전체 범위를 설계한 뒤 구축)',
  issue: '이슈형 (운영 · 유지보수: 이슈마다 운영에 반영, 단계 대신 이슈 보드)',
};
// 프로젝트 이름 = 폴더 이름. 영문 소문자와 - 만 (앞뒤·연속 - 금지)
const PROJECT_NAME = /^[a-z]+(-[a-z]+)*$/;
const PROJECT_NAME_RULE = '영문 소문자와 - 만 쓸 수 있습니다 (예: new-stocker). 숫자·대문자·밑줄 불가, -로 시작·끝나거나 연속 불가';
const REPO_KINDS = { code: '프로젝트(코드)', docs: '기획 문서', issues: '이슈 기록', legacy: '레거시(AS-IS) 소스' };
const HOSTS = { github: 'GitHub', gitlab: 'GitLab', none: '없음' };

/** git 주소로 협업 도구 추정 — github.com · 호스트 이름에 gitlab. 모르면 null */
function inferHost(url) {
  if (!url) return null;
  const host = (String(url).match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)/i) || [])[1] || '';
  if (/(^|\.)github\.com$/i.test(host) || /github/i.test(host)) return 'github';
  if (/gitlab/i.test(host)) return 'gitlab';
  return null;
}
/** repo 의 협업 도구 — 적어 둔 host > remote 주소 > (링크 폴더면) 그 폴더의 origin */
function hostOf(root, r) {
  if (r.host) return r.host;
  const fromRemote = inferHost(r.remote);
  if (fromRemote) return fromRemote;
  if (r.path || r.local) {
    const dir = r.path ? path.resolve(root, r.path) : path.join(root, repoRel(r));
    try { return inferHost(execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { return null; }
  }
  return null;
}
const RUNNERS = { '.js': 'node', '.cjs': 'node', '.mjs': 'node', '.sh': 'bash', '.py': 'python3' };

// ───────────────────────── 공통 유틸 ─────────────────────────

const die = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };
const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const posix = (p) => p.split(path.sep).join('/');

function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (exists(path.join(dir, 'workspace.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function listFiles(dir, base = dir) {
  if (!isDir(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === '.DS_Store') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, base));
    else out.push(posix(path.relative(base, full)));
  }
  return out;
}

/** 막 만든 repo — README·LICENSE·.gitignore·.gitattributes·.git 만 있는 폴더. 여기에는 워크스페이스를 바로 만들 수 있다 */
const FRESH_OK = /^(\.git|\.gitignore|\.gitattributes|\.DS_Store|readme(\.[a-z]+)?|license(\.[a-z]+)?|changelog(\.[a-z]+)?)$/i;
function folderState(dir) {
  if (!exists(dir)) return 'missing';
  const items = fs.readdirSync(dir).filter((x) => x !== '.DS_Store');
  if (!items.length) return 'empty';
  if (exists(path.join(dir, 'workspace.json'))) return 'workspace';
  return items.every((x) => FRESH_OK.test(x)) ? 'fresh-repo' : 'occupied';
}

/** 템플릿 복사 — 이미 있는 README 는 두고, .gitignore 는 없는 줄만 덧붙인다.
 *  템플릿에서는 .gitignore 를 점 없는 `gitignore` 로 둔다 (npm 이 패키지를 만들 때 .gitignore 파일을 빼기 때문). 복사하며 이름을 되돌린다 */
function copyTemplate(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const rel of listFiles(src)) {
    const outRel = rel.replace(/(^|\/)gitignore$/, '$1.gitignore');
    const to = path.join(dst, outRel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (exists(to) && /(^|\/)\.gitignore$/.test(outRel)) { mergeGitignore(path.join(src, rel), to); continue; }
    if (exists(to) && /^readme/i.test(path.basename(rel))) continue;
    fs.copyFileSync(path.join(src, rel), to);
    fs.chmodSync(to, fs.statSync(path.join(src, rel)).mode);
  }
}

/** 템플릿 gitignore 의 줄 중 대상 .gitignore 에 없는 것만 더한다 (kit 생성 블록이 있으면 그 앞에). 더한 줄 수를 돌려준다 */
function mergeGitignore(srcFile, dstFile) {
  if (!exists(srcFile)) return 0;
  if (!exists(dstFile)) { fs.copyFileSync(srcFile, dstFile); return read(srcFile).split('\n').filter((l) => l.trim()).length; }
  const lines = read(dstFile).split('\n');
  const have = new Set(lines.map((l) => l.trim()));
  const add = read(srcFile).split('\n').filter((l) => l.trim() && !have.has(l.trim()));
  if (!add.length) return 0;
  const at = lines.findIndex((l) => l.startsWith('# >>> kit'));
  if (at < 0) fs.appendFileSync(dstFile, `${read(dstFile).endsWith('\n') ? '' : '\n'}${add.join('\n')}\n`);
  else { lines.splice(at, 0, ...add, ''); fs.writeFileSync(dstFile, lines.join('\n')); }
  return add.length;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const rel of listFiles(src)) {
    const to = path.join(dst, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(src, rel), to);
    fs.chmodSync(to, fs.statSync(path.join(src, rel)).mode);
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
      else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

/** `---` 로 감싼 단순 key: value 머리말. 값은 한 줄, 따옴표는 벗긴다. */
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text, raw: '' };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: text.slice(m[0].length), raw: m[0] };
}

// ───────────────────────── 설정·팩 로드 ─────────────────────────

function loadWorkspace(root) {
  const file = path.join(root, 'workspace.json');
  let ws;
  try { ws = JSON.parse(read(file)); } catch (e) { die(`workspace.json 을 읽지 못했습니다: ${e.message}`); }
  ws.project = ws.project || {};
  ws.packs = ws.packs || ['core'];
  // 옛 유형 — 유지보수(maintenance)는 운영·고도화(enhancement)로 합쳤다. kedovi upgrade 가 파일도 옮긴다 (migrateTypes)
  if (ws.project.type === 'maintenance') ws.project.type = 'enhancement';
  ws.packs = [...new Set(ws.packs.map((pk) => (pk === 'maintenance' ? 'enhancement' : pk)))];
  ws.repos = ws.repos || [];
  ws.vars = ws.vars || {};
  ws.limits = ws.limits || {};
  ws.repos = ws.repos.map((r) => ({ ...r, kind: r.kind || 'code', dir: repoRel(r) }));
  deriveVars(ws);
  return ws;
}

/** 파생 변수 — 경로를 두 번 적지 않게 repos 에서 채운다 (packs/core/lib/workspace.js 와 같은 규칙). */
function deriveVars(ws) {
  const legacy = ws.repos.find((r) => r.kind === 'legacy');
  if (legacy && ws.vars.asis && !ws.vars.asis.sourceRoot) {
    ws.vars.asis.sourceRoot = posix(path.join(repoRel(legacy), legacy.sourceRoot || '')).replace(/\/$/, '');
  }
}

/** project.type · repos[].kind 규칙. 차세대인데 레거시가 없으면 AS-IS 대조 자체가 불가능하므로 멈춘다. */
function validateProject(ws, errors, warnings) {
  const type = ws.project.type;
  if (!type) warnings.push(`workspace.json project.type 이 없습니다. ${Object.keys(PROJECT_TYPES).join(' | ')} 중 하나로 정하세요`);
  else if (!PROJECT_TYPES[type]) errors.push(`project.type '${type}': ${Object.keys(PROJECT_TYPES).join(' | ')} 중 하나`);
  const ap = ws.project.approach;
  if (ap !== undefined && !APPROACHES[ap]) errors.push(`project.approach '${ap}': ${Object.keys(APPROACHES).join(' | ')} 중 하나 (kedovi approach)`);
  for (const r of ws.repos) {
    if (!REPO_KINDS[r.kind]) errors.push(`repos '${r.name}': kind '${r.kind}': ${Object.keys(REPO_KINDS).join(' | ')} 중 하나`);
    if (!r.name || !REPO_SEG.test(r.name)) errors.push(`repos 항목 name 은 영문·숫자·._- 만 ('-' 로 시작 · '.' · '..' 금지): ${JSON.stringify(r.name)}`);
    if (r.remote && !safeRemote(r.remote)) errors.push(`repos '${r.name}': remote 는 git 주소만 ('-' 로 시작 · '<이름>::' 전송 금지): ${JSON.stringify(r.remote)}`);
    if (!r.remote && !r.path && !r.local) errors.push(`repos '${r.name}': remote(git 주소) · path(이미 있는 폴더) · local(워크스페이스에서 새로 만듦) 중 하나가 필요합니다`);
    if (r.group !== undefined && (typeof r.group !== 'string' || !REPO_SEG.test(r.group))) errors.push(`repos '${r.name}': group 은 영문·숫자·._- 만 (한 단계, '-' 로 시작 · '.' · '..' 금지): ${JSON.stringify(r.group)}`);
  }
  // 이름은 그룹이 달라도 하나만 (명령 · 링크가 이름으로 repo 를 찾는다). 그룹 폴더가 그룹 없는 repo 와 겹치면 안 된다
  const seen = new Set();
  for (const r of ws.repos) { if (seen.has(r.name)) errors.push(`repos '${r.name}': 이름이 두 번 나옵니다 (그룹이 달라도 이름은 하나만)`); seen.add(r.name); }
  for (const g of new Set(ws.repos.map((r) => r.group).filter(Boolean))) {
    if (ws.repos.some((r) => !r.group && r.name === g)) errors.push(`repos 그룹 '${g}': 그룹 없는 repo 이름과 같아 repos/${g}/ 폴더가 겹칩니다. 그룹 이름을 바꾸세요`);
  }
  if (ws.team !== undefined) {
    const t = ws.team || {};
    // 사람 항목: 문자열(옛 형식, username) 또는 { username, nickname, repos } (repos 는 members 만)
    const badPerson = (m, repos) => typeof m === 'string' ? !m.trim()
      : !m || typeof m !== 'object' || typeof m.username !== 'string' || !m.username.trim() || (m.nickname !== undefined && typeof m.nickname !== 'string')
        || (m.repos !== undefined && (!repos || !Array.isArray(m.repos) || m.repos.some((x) => typeof x !== 'string')));
    if (t.members !== undefined && (!Array.isArray(t.members) || t.members.some((m) => badPerson(m, true)))) errors.push('workspace.json team.members 는 username 문자열 또는 { "username", "nickname", "repos": [repo 이름…] } 목록이어야 합니다');
    if (t.admins !== undefined && (!Array.isArray(t.admins) || t.admins.some((m) => badPerson(m, false)))) errors.push('workspace.json team.admins 는 팀장 username 목록이어야 합니다 (새 형식은 team.leads 의 { "username", "nickname" })');
    if (t.leads !== undefined && (!Array.isArray(t.leads) || t.leads.some((m) => badPerson(m, false)))) errors.push('workspace.json team.leads 는 { "username", "nickname" } 목록이어야 합니다 (팀장은 모든 repo 를 고치므로 repos 를 적지 않는다)');
    const names = new Set(ws.repos.map((r) => r.name));
    for (const m of Array.isArray(t.members) ? t.members : []) for (const x of (m && m.repos) || []) if (!names.has(x)) warnings.push(`workspace.json team.members ${m.username} 의 담당 repo '${x}' 가 repos 에 없습니다 (repo 이름으로 적는다)`);
    const leadsN = [...(Array.isArray(t.leads) ? t.leads : []), ...(Array.isArray(t.admins) ? t.admins : [])].length;
    if (t.lock && !leadsN) warnings.push('workspace.json team.lock 이 켜져 있지만 팀장(team.leads)이 없어 잠금이 적용되지 않습니다 (kedovi team lead add <username>)');
    if (!leadsN && (Array.isArray(t.members) ? t.members : []).some((m) => m && (m.repos || []).length)) warnings.push('workspace.json team.members 에 담당 repo 가 있지만 팀장(team.leads)이 없습니다. 담당 밖 repo 를 고칠 사람이 없습니다 (kedovi team lead add <username>)');
    if (t.restrict && !(t.members || []).length) warnings.push('workspace.json team.restrict 가 켜져 있지만 명단이 비어 있습니다. 제한이 적용되지 않습니다 (kedovi team add <id>)');
  }
  const legacy = ws.repos.filter((r) => r.kind === 'legacy');
  const rule = TYPE_RULES[type];
  if (rule) {
    if (rule.pack && !ws.packs.includes(rule.pack)) errors.push(`유형이 ${PROJECT_TYPES[type]} 인데 ${rule.pack} 팩이 없습니다. kedovi upgrade --add ${rule.pack}`);
    for (const k of rule.requires) {
      if (!ws.repos.some((r) => r.kind === k)) (k === 'legacy' ? errors : warnings).push(`유형이 ${PROJECT_TYPES[type]} 인데 ${REPO_KINDS[k]}(kind: "${k}") repo 가 없습니다`);
    }
    for (const k of rule.warnsOn) {
      if (ws.repos.some((r) => r.kind === k)) warnings.push(`유형이 ${PROJECT_TYPES[type]} 인데 ${REPO_KINDS[k]}(kind: "${k}") repo 가 있습니다. 유형이 맞는지 확인하세요`);
    }
  }
  // 기획 repo 가 없는 것이 흔한 유형(운영·고도화)이나 없다고 밝힌 워크스페이스(workspace.json 의 docsRepo: false)는 알리지 않는다
  if (!ws.repos.some((r) => r.kind === 'docs') && type !== 'enhancement' && ws.docsRepo !== false) warnings.push('기획 repo(kind: "docs")가 없습니다. 요구사항 근거를 에이전트가 찾을 곳이 없습니다. 없는 것이 맞으면 workspace.json 에 "docsRepo": false 를 넣어 끕니다');
  if (ws.packs.includes('modernization') && !(ws.vars.asis && ws.vars.asis.sourceRoot)) errors.push('modernization 팩은 레거시 소스 위치가 필요합니다. repos 에 kind: "legacy" 를 넣거나 vars.asis.sourceRoot 를 지정하세요');
}

// ───────────────────────── 스택 (repo 단위) ─────────────────────────

const LAYER_PACKS = { backend: 'backend', frontend: 'frontend', desktop: 'desktop', mobile: 'mobile', watch: 'watch', tv: 'tv', db: 'db', infra: 'infra' };

function loadCatalog(root) {
  const f = path.join(root, 'packs', 'core', 'stacks.json');
  try { return JSON.parse(read(f)).stacks; } catch { return []; }
}

/** 언어 목록 (stacks.json languages): [{ id, label, ext, pack }] */
function loadLanguages(root) {
  try { return JSON.parse(read(path.join(root, 'packs', 'core', 'stacks.json'))).languages || []; } catch { return []; }
}
/** 언어 id → 이름 (Java · Kotlin). languages = stacks.json languages */
function labelLanguages(languages, ids) {
  return (ids || []).map((id) => (languages.find((l) => l.id === id) || {}).label || id).join(' · ');
}

/** 규칙 머리말 repos: 값 → 이름 목록 (repos: a, b · repos: [a, "b"]). 값이 없으면 null */
function parseRepos(value) {
  if (value === undefined) return null;
  return String(value).replace(/^\s*\[|\]\s*$/g, '').split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

/** project 규칙 중 repos: 에 이 repo 이름을 적은 것 (repo 를 빼기 전에 확인). 반환: 규칙 파일 경로 */
function projectRulesPinning(root, name) {
  const dir = path.join(root, 'packs', 'project', 'rules');
  return listFiles(dir).filter((f) => f.endsWith('.md')).filter((f) => {
    const { meta } = parseFrontmatter(read(path.join(dir, f)));
    return (parseRepos(meta.repos) || []).includes(name);
  }).map((f) => posix(path.join('packs', 'project', 'rules', f)));
}
const CLEAN_CODE_PACK = 'clean-code'; // 언어가 하나라도 있는 코드 repo 에 붙는 언어 공통 규칙

/** repo 의 stacks → 붙을 팩 { 팩이름: [repo 이름…] }. 코드 repo 만 (참고 자료는 읽기 전용이라 규칙 대상 아님) */
function repoPacks(root, ws, catalog, warnings, langs = loadLanguages(root)) {
  const out = {};
  const add = (pack, repo) => { (out[pack] = out[pack] || []).includes(repo) || out[pack].push(repo); };
  for (const r of ws.repos.filter((x) => x.kind === 'code' || x.kind === 'issues')) {
    const host = hostOf(root, r);
    if (host && host !== 'none' && isDir(path.join(root, 'packs', host))) add(host, r.name);
    if (r.kind !== 'code') continue;
    const under = (m, x) => x === '.' || m === x || m.startsWith(`${x}/`);
    const pathsOf = (id) => (((r.stackPaths || {})[id] || []).length ? r.stackPaths[id] : null); // null = 모듈 모름 (repo 전체 또는 손으로 고름)
    for (const id of r.stacks || []) {
      const s = catalog.find((c) => c.id === id);
      if (!s) { warnings.push(`repos '${r.name}': 모르는 스택 '${id}'. packs/core/stacks.json 에 없습니다`); continue; }
      // 세부 프레임워크(parent 가 있는 것)는 부모의 layer·팩도 받는다 — spring-webflux 는 backend + stack-spring
      for (const e of [s, catalog.find((c) => c.id === s.parent)].filter(Boolean)) {
        const layer = LAYER_PACKS[e.layer];
        if (layer && isDir(path.join(root, 'packs', layer))) add(layer, r.name);
        // packSkipWith: 다른 스택과 함께면 전용 팩을 붙이지 않는다 (Flutter · React Native 앱 안의 android/ 는 네이티브 Android 앱이 아니다)
        // 이 스택의 모듈이 모두 함께 감지된 스택(Flutter · RN 등)의 모듈 안에 있을 때만 (그 앱의 android/ 다. 하위 폴더의 작은 브리지 · 예제는 그대로)
        // 함께 감지된 스택의 모듈을 모르면 이 스택도 모듈을 모를 때만 (손으로 고른 Flutter 가 별도 네이티브 앱의 규칙까지 빼지 않게)
        // 모듈을 모르면(루트 앱) 그 스택의 플랫폼 폴더(languageIgnore: android/ 등) 안이면 같은 앱으로 본다
        const platformOf = (x) => (catalog.find((c) => c.id === x) || {}).languageIgnore || [];
        const skipPack = (e.packSkipWith || []).some((x) => (r.stacks || []).includes(x)
          && (pathsOf(x) ? (pathsOf(e.id) || ['.']).every((m) => pathsOf(x).some((xm) => under(m, xm)))
            : !pathsOf(e.id) || pathsOf(e.id).every((m) => platformOf(x).some((d) => under(m, d)))));
        if (e.pack && !skipPack && isDir(path.join(root, 'packs', e.pack))) add(e.pack, r.name);
      }
    }
    // 언어 (repos[].languages): 언어가 있는 코드 repo 에 언어 공통 클린 코드 + 언어별 규칙
    if (Array.isArray(r.languages) && r.languages.length && isDir(path.join(root, 'packs', CLEAN_CODE_PACK))) add(CLEAN_CODE_PACK, r.name);
    for (const id of Array.isArray(r.languages) ? r.languages : []) {
      const l = langs.find((x) => x.id === id);
      if (!l) { warnings.push(`repos '${r.name}': 모르는 언어 '${id}'. packs/core/stacks.json languages 에 없습니다`); continue; }
      if (l.pack && isDir(path.join(root, 'packs', l.pack))) add(l.pack, r.name);
    }
  }
  return out;
}

/** 옛 유형을 새 유형으로 옮긴다 (workspace.json). 반환: 옮겼으면 설명 문자열 */
function migrateTypes(root) {
  const file = path.join(root, 'workspace.json');
  let raw;
  try { raw = JSON.parse(read(file)); } catch { return null; }
  const was = raw.project && raw.project.type;
  const hadPack = (raw.packs || []).includes('maintenance');
  if (was !== 'maintenance' && !hadPack) return null;
  if (was === 'maintenance') raw.project.type = 'enhancement';
  raw.packs = [...new Set((raw.packs || []).map((pk) => (pk === 'maintenance' ? 'enhancement' : pk)))];
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  return '유지보수(maintenance) 유형을 운영·고도화(enhancement)로 옮겼습니다. 이슈·티켓 처리(ticket 스킬)는 이제 모든 유형의 공통입니다';
}

/** 스택이 정해지지 않은 코드 repo 를 감지해 workspace.json 에 적는다 (force 면 전부 다시). 반환: [{ name, stacks, evidence }] */
function detectRepos(root, { force = false, write = true, languages: withLanguages = true, only = null } = {}) {
  const detectLib = path.join(root, 'packs', 'core', 'lib', 'detect.js');
  if (!exists(detectLib)) return [];
  const lib = require(detectLib);
  const file = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(file));
  // 옛 detect.js(withHints 없음)를 가진 워크스페이스도 돈다 — 힌트만 빠진다
  const catalog = lib.withHints ? lib.withHints(loadCatalog(root), raw.stackHints) : loadCatalog(root);
  const languages = loadLanguages(root);
  const results = [];
  let hostChanged = false;
  for (const r of raw.repos || []) {
    if (['code', 'issues'].includes(r.kind || 'code') && !r.host && write) {
      const h = hostOf(root, r);
      if (h) { r.host = h; hostChanged = true; }
    }
    if ((r.kind || 'code') !== 'code' || (!force && Array.isArray(r.stacks)) || (only && r.name !== only)) continue;
    const dir = path.join(root, repoRel(r));
    if (!exists(dir)) continue;
    const files = withLanguages && lib.scan ? lib.scan(dir) : null; // 한 번 훑어 스택 · 언어 감지가 같이 쓴다
    const found = lib.detect(dir, catalog, files);
    const langs = withLanguages && lib.detectLanguages ? lib.detectLanguages(dir, languages, files, languageIgnore(catalog, found)).map((x) => x.id) : null;
    // 아무것도 못 잡았는데 빌드 파일이 있으면 사내 라이브러리를 거친 간접 의존일 수 있다 → stackHints 안내
    const builds = !found.length && lib.buildFiles ? lib.buildFiles(dir) : [];
    results.push({ name: r.name, stacks: found.map((f) => f.id), evidence: found, before: r.stacks, builds, ...(langs ? { languages: langs } : {}) });
    if (write) { r.stacks = found.map((f) => f.id); setStackPaths(r, found); if (langs && (force || r.languages !== false)) r.languages = langs; } // 빈 결과도 기록한다 (빈 repo 는 upgrade · detect 때 다시 감지). false = 건너뛴 repo
  }
  if (write && (results.length || hostChanged)) fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  return results;
}

/** 멀티모듈 repo — 스택이 쓰이는 하위 모듈을 repos[].stackPaths 에 적는다 ({ spring: ['api'] }). repo 전체면 적지 않는다 */
function setStackPaths(r, found) {
  const paths = {};
  for (const f of found) if (f.modules && f.modules.length && (r.stacks || []).includes(f.id)) paths[f.id] = f.modules;
  if (Object.keys(paths).length) r.stackPaths = paths;
  else delete r.stackPaths;
}

/** 스택은 정해졌는데 stackPaths 가 없는 코드 repo 에 모듈 경로만 채운다 (스택은 건드리지 않는다) — 이 기능 전에 만든 워크스페이스용. 반환: 채운 repo 이름 */
function fillStackPaths(root) {
  const detectLib = path.join(root, 'packs', 'core', 'lib', 'detect.js');
  if (!exists(detectLib)) return [];
  const lib = require(detectLib);
  const file = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(file));
  const catalog = lib.withHints ? lib.withHints(loadCatalog(root), raw.stackHints) : loadCatalog(root);
  const filled = [];
  for (const r of raw.repos || []) {
    if ((r.kind || 'code') !== 'code' || !Array.isArray(r.stacks) || !r.stacks.length || r.stackPaths) continue;
    const dir = path.join(root, repoRel(r));
    if (!exists(dir)) continue;
    setStackPaths(r, lib.detect(dir, catalog));
    if (r.stackPaths) filled.push(r.name);
  }
  if (filled.length) fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  return filled;
}

/** 감지에 쓰는 스택 목록: 킷 목록 + workspace.json stackHints (옛 detect.js 면 힌트 없이) */
function hintedCatalog(root, raw = null) {
  const f = path.join(root, 'packs', 'core', 'lib', 'detect.js');
  const lib = exists(f) ? require(f) : {};
  const ws = raw || JSON.parse(read(path.join(root, 'workspace.json')));
  return lib.withHints ? lib.withHints(loadCatalog(root), ws.stackHints) : loadCatalog(root);
}

/** 워크스페이스의 감지 모듈 (packs/core/lib/detect.js). 없거나 언어 감지를 모르는 옛 킷이면 null */
function detectLibOf(root) {
  const f = path.join(root, 'packs', 'core', 'lib', 'detect.js');
  if (!exists(f)) return null;
  const lib = require(f);
  return lib.detectLanguages ? lib : null;
}

/**
 * 스택이 정한 언어 감지 제외 폴더 (stacks.json languageIgnore: Flutter 앱의 ios/ · windows/ 등 플랫폼 실행 폴더).
 * found = 감지 결과 [{ id, modules?, atRoot? }]: 그 스택이 잡힌 모듈 아래만 (모듈이 없으면 repo 루트, 루트에서도 잡혔으면 루트도)
 */
function languageIgnore(catalog, found) {
  const out = [];
  for (const f of found || []) {
    const dirs = (catalog.find((c) => c.id === f.id) || {}).languageIgnore || [];
    const mods = f.modules ? [...f.modules, ...(f.atRoot ? ['.'] : [])] : ['.'];
    for (const m of mods) for (const d of dirs) out.push(m === '.' ? d : `${m}/${d}`);
  }
  return [...new Set(out)];
}

/** 이 repo 의 언어 (지금 고른 스택 · 모듈로 플랫폼 폴더를 뺀다). 폴더가 없으면 null */
function repoLanguages(root, r, { catalog = null, languages = loadLanguages(root) } = {}) {
  const lib = detectLibOf(root);
  const dir = path.join(root, repoRel(r));
  if (!lib || !exists(dir)) return null;
  // 지금 고른 스택 기준: 감지된 것은 모듈 정보를 쓰고, 손으로 고른(감지 안 된) 스택은 repo 전체로 본다
  if (!catalog) catalog = hintedCatalog(root); // detectRepos 와 같은 힌트로
  const files = lib.scan ? lib.scan(dir) : null; // 한 번 훑어 스택 · 언어 감지가 같이 쓴다
  const found = lib.detect(dir, catalog, files).filter((f) => (r.stacks || []).includes(f.id));
  for (const id of r.stacks || []) if (!found.some((f) => f.id === id)) found.push({ id });
  return lib.detectLanguages(dir, languages, files, languageIgnore(catalog, found)).map((x) => x.id);
}

/** 규칙이 걸리는 repo: repos: 로 정한 규칙은 그 repo, 아니면 그 팩이 붙은 repo (rules.offIn · repos: 대체로 뺀 repo 는 빼지 않은 값) */
function ruleRepos(rule, repoMap) {
  return rule.repos || repoMap[rule.forPack || rule.pack] || [];
}

/** 언어(repos[].languages)가 없는 코드 repo 에 언어만 채운다 (이 기능 전에 만든 워크스페이스용 · install · upgrade). 반환: [{ name, languages }] */
function fillLanguages(root) {
  if (!detectLibOf(root)) return [];
  const file = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(file));
  const opts = { catalog: hintedCatalog(root, raw), languages: loadLanguages(root) };
  const filled = [];
  let changed = false;
  for (const r of raw.repos || []) {
    // 비었으면 (새 repo 에 코드가 생겼을 수 있다) 다시 감지. false = kedovi detect 에서 건너뛴 repo
    if ((r.kind || 'code') !== 'code' || r.languages === false || (Array.isArray(r.languages) && r.languages.length)) continue;
    const langs = repoLanguages(root, r, opts);
    if (!langs) continue;
    if (!Array.isArray(r.languages) || langs.length) { r.languages = langs; changed = true; }
    if (langs.length) filled.push({ name: r.name, languages: langs });
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  return filled;
}

// repo 안에 이미 있는 AI 지침 (repos[].guides · guidesMode). 파일 이름이 같으면 어느 폴더에 있어도 지침이다
const GUIDE_FILES = new Set(['CLAUDE.md', 'AGENTS.md', 'AGENTS.override.md', 'GEMINI.md', '.cursorrules', '.windsurfrules', '.clinerules', 'copilot-instructions.md']);
// 이 폴더 안의 파일은 폴더 하나로 적는다
const GUIDE_DIRS = ['.claude/rules', '.claude/skills', '.claude/commands', '.claude/agents', '.agents/skills', '.cursor/rules', '.github/instructions', '.clinerules'];
// 실행 도구 설정: 워크스페이스 루트에서 실행하면 적용되지 않는다
const GUIDE_SETTINGS = ['.claude/settings.json', '.codex/config.toml', '.codex/hooks.json', '.mcp.json'];
const GUIDE_MODES = { follow: 'repo 지침 우선', kit: '킷 규칙 우선', ignore: '무시' };
const GUIDE_SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'target', 'out', '.gradle', '.venv', 'venv', '__pycache__', 'Pods', '.dart_tool']);

/** repo 폴더의 지침 파일 · 폴더 목록 (repo 기준 상대 경로, 폴더는 / 로 끝남). git repo 면 추적 파일만 (PC 마다 같은 기록). 폴더가 없으면 null */
function scanGuides(dir) {
  if (!isDir(dir)) return null;
  let files = null;
  if (exists(path.join(dir, '.git'))) {
    try {
      files = execFileSync('git', ['-c', 'core.quotePath=false', '-C', dir, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
    } catch { files = null; }
  }
  if (!files) {
    files = [];
    const walk = (rel, depth) => {
      let list = [];
      try { list = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
      for (const e of list) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (depth < 4 && !GUIDE_SKIP_DIRS.has(e.name)) walk(p, depth + 1); } else files.push(p);
      }
    };
    walk('', 0);
  }
  const found = new Set();
  for (const f of files) {
    if (f.split('/').some((seg) => GUIDE_SKIP_DIRS.has(seg))) continue;
    const marker = GUIDE_DIRS.find((d) => f.startsWith(`${d}/`) || f.includes(`/${d}/`));
    if (marker) { const at = f.startsWith(`${marker}/`) ? 0 : f.indexOf(`/${marker}/`) + 1; found.add(`${f.slice(0, at)}${marker}/`); continue; }
    const base = f.split('/').pop();
    if (GUIDE_FILES.has(base) && (base !== 'copilot-instructions.md' || f.endsWith('.github/copilot-instructions.md'))) { found.add(f); continue; }
    if (GUIDE_SETTINGS.some((s) => f === s || f.endsWith(`/${s}`))) found.add(f);
  }
  return [...found].sort();
}
const isGuideSetting = (g) => GUIDE_SETTINGS.some((s) => g === s || g.endsWith(`/${s}`));

/** 지침을 아직 훑지 않은 코드 · 이슈 repo 를 훑어 repos[].guides 에 적는다. 반환: [{ name, guides }] (찾은 것만) */
function fillGuides(root) {
  const file = path.join(root, 'workspace.json');
  let raw;
  try { raw = JSON.parse(read(file)); } catch { return []; }
  const filled = [];
  let changed = false;
  // 설정 수정이 잠긴 팀의 팀원 PC 에서는 적지 않는다 (workspace.json · AGENTS.md 를 커밋할 수 없다). 팀장이 sync 하면 적힌다
  const locked = !lockState(root, raw).admin;
  for (const r of raw.repos || []) {
    if (!['code', 'issues'].includes(r.kind || 'code') || Array.isArray(r.guides)) continue;
    const g = scanGuides(path.join(root, repoRel(r)));
    if (!g) continue; // 아직 받지 않은 repo
    if (locked) { if (g.length) filled.push({ name: r.name, guides: g, locked: true }); continue; }
    r.guides = g;
    changed = true;
    if (g.length) filled.push({ name: r.name, guides: g });
  }
  if (changed) fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  return filled;
}

/** 기록한 지침 목록과 지금 폴더가 다른 repo: [{ name, added, removed }] */
function guideChanges(root, ws) {
  const out = [];
  for (const r of ws.repos || []) {
    if (!Array.isArray(r.guides)) continue;
    const now = scanGuides(path.join(root, repoRel(r)));
    if (!now) continue;
    const added = now.filter((g) => !r.guides.includes(g));
    const removed = r.guides.filter((g) => !now.includes(g));
    if (added.length || removed.length) out.push({ name: r.name, added, removed });
  }
  return out;
}

/** 감지 결과 한 줄 — 없으면 빌드 파일 유무로 간접 의존 가능성을 알린다 */
function detectLine(catalog, d, languages = []) {
  const lang = d.languages && d.languages.length ? ` · 언어 ${labelLanguages(languages, d.languages)}` : '';
  return detectLineStacks(catalog, d) + lang;
}
function detectLineStacks(catalog, d) {
  if (d.stacks.length) return `${stacksLabel(catalog, d.stacks)}   (${[...new Set(d.evidence.map((e) => e.evidence))].join(', ')})`;
  if (!d.builds || !d.builds.length) return (d.languages || []).length ? '없음' : '없음 (공통 규칙만)';
  return `없음: 빌드 파일(${d.builds.slice(0, 2).join(', ')})은 있습니다. 사내 라이브러리를 거쳐 프레임워크를 쓰면 ${HINT_HELP}`;
}
const HINT_HELP = 'kedovi detect --hint <스택 id> --contains <라이브러리 좌표 정규식> 으로 힌트를 적으세요';

/** workspace.json stackHints 에 힌트 하나를 더한다 (같은 stack·contains 는 다시 넣지 않는다) */
function addStackHint(root, { stack, contains, files }) {
  const file = path.join(root, 'workspace.json');
  const raw = JSON.parse(read(file));
  const hint = { stack, contains, ...(files ? { files: String(files).split(',').map((x) => x.trim()).filter(Boolean) } : {}) };
  const detectLib = path.join(root, 'packs', 'core', 'lib', 'detect.js');
  const errs = exists(detectLib) && require(detectLib).checkHints ? require(detectLib).checkHints(loadCatalog(root), [hint]) : ['이 워크스페이스의 packs/core 가 힌트를 모릅니다. kedovi upgrade'];
  if (errs.length) die(errs.join('\n').replace(/stackHints\[0\]: /g, ''));
  raw.stackHints = raw.stackHints || [];
  if (!raw.stackHints.some((h) => h.stack === stack && h.contains === contains)) raw.stackHints.push(hint);
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
}

function stackLabel(catalog, id) {
  const s = catalog.find((c) => c.id === id);
  if (!s) return id;
  const parent = s.parent && catalog.find((c) => c.id === s.parent);
  return parent ? `${parent.label}(${s.label})` : s.label;
}
/** 스택 목록 표시 — 세부는 부모 괄호 안으로 (Spring(MVC·Batch)), 전용 규칙 없는 것은 표시, 모듈 경로를 알면 뒤에 (api/) */
function stacksLabel(catalog, ids, noRules = () => false, stackPaths = null) {
  const out = [];
  for (const id of ids) {
    const s = catalog.find((c) => c.id === id);
    if (!s) { out.push(id); continue; }
    if (s.parent && ids.includes(s.parent)) continue; // 부모 쪽에서 함께 표시
    const kids = catalog.filter((c) => c.parent === s.id && ids.includes(c.id)).map((c) => c.label);
    let t = s.parent ? stackLabel(catalog, id) : kids.length ? `${s.label}(${kids.join('·')})` : s.label;
    const root = s.parent ? catalog.find((c) => c.id === s.parent) || s : s;
    if (noRules(root)) t += '(전용 규칙 없음)';
    const mods = modulesOf(stackPaths, [id, ...catalog.filter((c) => c.parent === s.id && ids.includes(c.id)).map((c) => c.id)]);
    if (mods) t += ` (${mods.map((m) => `${m}/`).join(', ')})`;
    out.push(t);
  }
  return out.join(' · ');
}
/** 스택들이 쓰이는 모듈 합집합 — 하나라도 repo 전체면 null */
function modulesOf(stackPaths, ids) {
  if (!stackPaths || !ids.length || ids.some((id) => !Array.isArray(stackPaths[id]) || !stackPaths[id].length)) return null;
  return [...new Set(ids.flatMap((id) => stackPaths[id]))].sort();
}
function loadLayers(root) {
  try { return JSON.parse(read(path.join(root, 'packs', 'core', 'stacks.json'))).layers || {}; } catch { return {}; }
}

function loadPacks(root, ws, errors, extra = []) {
  const packs = [];
  const seen = new Set();
  const visit = (name, from) => {
    if (seen.has(name)) return;
    const dir = path.join(root, 'packs', name);
    if (!isDir(dir)) { errors.push(`팩 '${name}' 이 packs/ 에 없습니다${from ? ` (${from} 이 요구)` : ''}`); return; }
    const metaFile = path.join(dir, 'pack.json');
    const meta = exists(metaFile) ? JSON.parse(read(metaFile)) : { name };
    for (const req of meta.requires || []) {
      if (!ws.packs.includes(req) && !extra.includes(req)) errors.push(`팩 '${name}' 은 '${req}' 팩이 필요합니다. workspace.json packs 에 추가하세요`);
    }
    seen.add(name);
    packs.push({ name, dir, meta });
  };
  for (const p of ws.packs) visit(p);
  for (const p of extra) visit(p, 'repo 스택');
  return packs;
}

// ───────────────────────── 변수 치환 ─────────────────────────

function lookup(ws, key) {
  let cur = ws;
  for (const part of key.split('.')) {
    if (cur == null || typeof cur !== 'object' || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** `{{ws:project.title}}` 를 workspace.json 값으로. 못 찾으면 그대로 두고 오류로 모은다. */
function render(text, ws, where, errors) {
  return text.replace(/\{\{ws:([A-Za-z0-9_.-]+)\}\}/g, (all, key) => {
    const v = lookup(ws, key);
    if (v === undefined || typeof v === 'object') { errors.push(`${where}: 변수 {{ws:${key}}} 값이 workspace.json 에 없습니다`); return all; }
    return String(v);
  });
}

// ───────────────────────── 생성 ─────────────────────────

function collect(root, ws, packs, errors, warnings, repoMap = {}) {
  const rules = [];
  const skills = new Map();
  const hooks = [];

  for (const pack of packs) {
    for (const rel of listFiles(path.join(pack.dir, 'rules')).filter((f) => f.endsWith('.md'))) {
      const src = posix(path.join('packs', pack.name, 'rules', rel));
      const { meta, body } = parseFrontmatter(read(path.join(root, src)));
      const load = meta.load || 'on-demand';
      if (!['always', 'on-demand'].includes(load)) errors.push(`${src}: load 는 always | on-demand`);
      if (load === 'on-demand' && !meta.when) errors.push(`${src}: on-demand 룰에는 when(언제 읽는지)이 필요합니다`);
      const agents = meta.agents || 'all';
      if (!['all', 'claude'].includes(agents)) errors.push(`${src}: agents 는 all | claude`);
      const out = `.agents/rules/${pack.name}--${rel.replace(/\//g, '--')}`;
      // repo 스택으로 붙은 layer·stack 팩만 repo 단위. packs 에 직접 적은 옛 방식은 워크스페이스 전체에 적용
      // repos: a,b (project 팩 규칙) = 그 repo 에만 거는 규칙
      // repos: a, b 또는 repos: [a, b] (한 줄). 여러 줄 YAML 목록은 머리말이 한 줄 값만 읽어 빈 값이 된다 → 오류
      const listed = parseRepos(meta.repos);
      if (listed && !listed.length) errors.push(`${src}: repos: 는 한 줄로 쓴다 (예: repos: api, batch)`);
      const onlyRepos = pack.name === 'project' && listed && listed.length ? listed : null;
      if (meta.repos && pack.name !== 'project') errors.push(`${src}: repos: 는 project 팩 규칙에만 쓴다`);
      if (meta.repos && (meta.agents || 'all') !== 'all') errors.push(`${src}: repos: 는 agents: all 규칙에만 쓴다 (Claude 전용 규칙은 repo 별로 나눌 수 없다)`);
      for (const n of onlyRepos || []) if (!ws.repos.some((r) => r.name === n && ['code', 'issues'].includes(r.kind))) errors.push(`${src}: repos: '${n}' 는 이 워크스페이스의 코드 · 이슈 repo 가 아닙니다`);
      const scope = onlyRepos || (['layer', 'stack', 'workflow', 'lang'].includes(pack.meta.category) && repoMap[pack.name]) ? 'repo' : 'workspace';
      const id = `${pack.name}--${rel.replace(/\//g, '--').replace(/\.md$/, '')}`; // 규칙 ID — workspace.json rules.off · replaces 가 가리킨다
      rules.push({ id, pack: pack.name, scope, ...(onlyRepos ? { repos: onlyRepos } : {}), src, out, meta, load, agents, required: meta.required === true || meta.required === 'true', title: meta.title || path.basename(rel, '.md'), body: render(body, ws, src, errors) });
    }

    const skillsDir = path.join(pack.dir, 'skills');
    if (isDir(skillsDir)) {
      for (const name of fs.readdirSync(skillsDir).sort()) {
        const dir = path.join(skillsDir, name);
        if (!isDir(dir)) continue;
        const skillMd = path.join(dir, 'SKILL.md');
        const src = posix(path.relative(root, dir));
        if (!exists(skillMd)) { errors.push(`${src}: SKILL.md 가 없습니다`); continue; }
        const { meta } = parseFrontmatter(read(skillMd));
        if (!meta.name) errors.push(`${src}/SKILL.md: name 이 없습니다 (Codex 필수)`);
        else if (meta.name !== name) errors.push(`${src}/SKILL.md: name '${meta.name}' 과 폴더명 '${name}' 이 다릅니다`);
        if (!meta.description) errors.push(`${src}/SKILL.md: description 이 없습니다 (두 도구 모두 필수)`);
        if (skills.has(name)) {
          if (pack.name === 'project') warnings.push(`스킬 '${name}': project 팩이 ${skills.get(name).pack} 팩 것을 덮어씁니다 (킷 기본 스킬과 같은 내용이면 packs/project/skills/${name}/ 을 지운다)`);
          else errors.push(`스킬 '${name}' 이 ${skills.get(name).pack} · ${pack.name} 두 팩에 있습니다`);
        }
        skills.set(name, { name, pack: pack.name, dir, src, meta, description: render(meta.description || '', ws, `${src}/SKILL.md`, errors) });
      }
    }

    const hooksFile = path.join(pack.dir, 'hooks.json');
    if (exists(hooksFile)) {
      const def = JSON.parse(read(hooksFile));
      for (const [event, list] of Object.entries(def)) {
        for (const h of list) {
          const script = posix(path.join('packs', pack.name, h.script));
          if (!exists(path.join(root, script))) errors.push(`${pack.name}/hooks.json: ${h.script} 가 없습니다`);
          const runner = RUNNERS[path.extname(script)];
          if (!runner) errors.push(`${pack.name}/hooks.json: ${h.script}: 실행기를 모르는 확장자`);
          if (h.agents && !['all', 'claude', 'codex'].includes(h.agents)) errors.push(`${pack.name}/hooks.json: ${h.script}: agents 는 all | claude | codex`);
          hooks.push({ event, pack: pack.name, script, runner, matcher: h.matcher, timeout: h.timeout || 30, statusMessage: h.statusMessage, agents: h.agents || 'all' });
        }
      }
    }
  }
  return { rules, skills: [...skills.values()], hooks };
}

/**
 * 규칙 끄기·바꾸기 — workspace.json rules.off 의 규칙은 빼고, project 팩 규칙의 replaces: <ID> 는 그 규칙 대신 들어간다 (범위도 이어받는다).
 * required 규칙(킷의 전제: 근거·안전·보안)은 끄거나 바꿀 수 없다. 반환 { rules, state: { off, replaced: { id: 대체 규칙 id } } }
 */
function applyRuleChoices(ws, all, errors, warnings, repoMap = {}) {
  const byId = new Map(all.map((r) => [r.id, r]));
  const off = new Set();
  const replaced = {};
  const partial = {}; // 일부 repo 에서만 바꾼 규칙 { 규칙 ID: { by, repos } }. 나머지 repo 에는 원래 규칙이 그대로 걸린다
  const appliesTo = (r) => ruleRepos(r, repoMap);
  for (const id of ((ws.rules || {}).off || [])) {
    const r = byId.get(id);
    if (!r) { warnings.push(`workspace.json rules.off: '${id}' 는 이 워크스페이스에 없는 규칙입니다 (kedovi rules 로 목록 확인)`); continue; }
    if (r.required) { errors.push(`workspace.json rules.off: '${id}'(${r.title}) 는 필수 규칙이라 끌 수 없습니다`); continue; }
    off.add(id);
  }
  for (const r of all.filter((x) => x.meta.replaces)) {
    for (const t of String(r.meta.replaces).split(',').map((x) => x.trim()).filter(Boolean)) {
      const target = byId.get(t);
      if (!target) { warnings.push(`${r.src}: replaces '${t}' 는 이 워크스페이스에 없는 규칙입니다`); continue; }
      if (target.required) { errors.push(`${r.src}: '${t}'(${target.title}) 는 필수 규칙이라 바꿀 수 없습니다`); continue; }
      r.forPack = target.pack;
      if (r.repos) { // 정한 repo 에서만 바꾼다. 나머지 repo 는 원래 규칙 그대로
        if (target.scope !== 'repo') { errors.push(`${r.src}: '${t}' 는 워크스페이스 전체 규칙이라 repos: 로 일부 repo 만 바꿀 수 없습니다 (repos: 를 빼면 전체를 바꾼다)`); continue; }
        const stray = r.repos.filter((n) => !appliesTo(target).includes(n));
        if (stray.length) { errors.push(`${r.src}: '${t}' 는 ${stray.join(', ')} 에 걸리지 않는 규칙이라 바꿀 수 없습니다 (걸리는 repo: ${appliesTo(target).join(', ') || '없음'}). 새 규칙을 더하려면 replaces 를 뺀다`); continue; }
        const twice = r.repos.filter((n) => (target.skipRepos || []).includes(n));
        if (twice.length) { errors.push(`${r.src}: '${t}' 를 ${twice.join(', ')} 에서 바꾸는 규칙이 이미 있습니다 (${(partial[t] || []).map((x) => x.by).join(', ')}). 하나로 합친다`); continue; }
        target.skipRepos = [...new Set([...(target.skipRepos || []), ...r.repos])];
        (partial[t] = partial[t] || []).push({ by: r.id, repos: [...r.repos] });
        continue;
      }
      off.add(t);
      replaced[t] = r.id;
      r.scope = target.scope; // repo 단위 규칙을 바꾸면 같은 repo 에만
    }
  }
  for (const t of Object.keys(partial)) if (off.has(t) && replaced[t]) errors.push(`'${t}' 를 전체로 바꾸는 규칙(${replaced[t]})과 일부 repo 만 바꾸는 규칙(${partial[t].map((x) => x.by).join(', ')})이 함께 있습니다. 하나로 정한다`);
  // repo 별 끄기 (rules.offIn: { 규칙 ID: [repo…] }). repo 단위 규칙만
  for (const [id, raw] of Object.entries((ws.rules || {}).offIn || {})) {
    const names = [].concat(raw); // 손으로 쓴 "api" 꼴도 목록으로
    const r = byId.get(id);
    if (!r) { warnings.push(`workspace.json rules.offIn: '${id}' 는 이 워크스페이스에 없는 규칙입니다 (지우기: kedovi rules on ${id} --repo ${names.join(',')})`); continue; }
    for (const p of partial[id] || []) { // 일부 repo 를 대체한 규칙: 겹치는 repo 는 대체 규칙에서도 뺀다
      const by = byId.get(p.by);
      const both = names.filter((n) => p.repos.includes(n));
      if (by && both.length) by.skipRepos = [...new Set([...(by.skipRepos || []), ...both])];
    }
    if (replaced[id] && off.has(id)) { // 전체 대체된 규칙: 대체한 규칙에서 같은 repo 를 뺀다 (repo 별 끄기가 풀리지 않게)
      const by = byId.get(replaced[id]);
      if (by) by.skipRepos = [...new Set([...(by.skipRepos || []), ...names])];
      continue;
    }
    if (r.required) { errors.push(`workspace.json rules.offIn: '${id}'(${r.title}) 는 필수 규칙이라 끌 수 없습니다`); continue; }
    if (r.scope !== 'repo' || r.agents !== 'all') { warnings.push(`workspace.json rules.offIn: '${id}' 는 ${r.agents !== 'all' ? 'Claude 전용' : '워크스페이스 전체'} 규칙이라 repo 별로 끌 수 없습니다 (kedovi rules off 로 전체를 끈다)`); continue; }
    const stray = names.filter((n) => !appliesTo(r).includes(n));
    if (stray.length) warnings.push(`workspace.json rules.offIn: '${id}' 는 ${stray.join(', ')} 에 걸리지 않는 규칙입니다 (걸리는 repo: ${appliesTo(r).join(', ') || '없음'}). 지우기: kedovi rules on ${id} --repo ${stray.join(',')}`);
    r.skipRepos = [...new Set([...(r.skipRepos || []), ...names])];
  }
  // 상시 규칙을 필요할 때만 읽게 (AGENTS.md 를 줄인다). REPO_TASKS 는 「repo 별 작업 규칙」의 작업별 표
  const lazy = [];
  for (const id of ((ws.rules || {}).onDemand || [])) {
    if (id === REPO_TASKS) { lazy.push(id); continue; }
    const r = byId.get(id);
    if (!r) { warnings.push(`workspace.json rules.onDemand: '${id}' 는 이 워크스페이스에 없는 규칙입니다 (kedovi rules 로 목록 확인)`); continue; }
    if (r.required) { warnings.push(`workspace.json rules.onDemand: '${id}'(${r.title}) 는 필수 규칙이라 상시로 둡니다`); continue; }
    if (r.load !== 'always') continue;
    r.load = 'on-demand';
    r.meta = { ...r.meta, when: r.meta.when || `${r.title} 에 해당하는 작업을 시작할 때` };
    lazy.push(id);
  }
  return { rules: all.filter((r) => !off.has(r.id)), state: { off: [...off], replaced, partial, onDemand: lazy } };
}

/** rules.onDemand 에 이 이름을 넣으면 「repo 별 작업 규칙」의 작업별 표를 따로 파일로 뺀다 */
const REPO_TASKS = 'repo-tasks';
const REPO_TASKS_FILE = '.agents/rules/repo-tasks.md';

const repoSource = (r) => (r.remote ? `\`${r.remote}\`` : r.path ? `\`${r.path}\` (링크)` : '워크스페이스에서 새로 만듦 (원격 없음. origin 을 달고 push 하면 sync 가 remote 를 채운다)');

function repoTable(ws) {
  if (!ws.repos.length) return '';
  const out = [];
  // 그룹(repos/<그룹>/<이름>)이 있으면 표를 그룹 순서(처음 나온 순)로 묶는다. 없으면 적은 순서 그대로
  const groups = [...new Set(ws.repos.map((r) => r.group || ''))];
  const grouped = groups.some(Boolean);
  const byGroup = (list) => (grouped ? groups.flatMap((g) => list.filter((r) => (r.group || '') === g)) : list);
  const code = byGroup(ws.repos.filter((r) => r.kind === 'code'));
  const refs = byGroup(ws.repos.filter((r) => r.kind === 'docs' || r.kind === 'legacy'));
  const issues = byGroup(ws.repos.filter((r) => r.kind === 'issues'));
  if (code.length) {
    out.push('## 프로젝트 repo', '', grouped
      ? `repo 는 \`${REPOS_DIR}/<이름>/\` 또는 그룹 폴더 \`${REPOS_DIR}/<그룹>/<이름>/\` 에 있다 (워크스페이스 git 에서 제외). 경로는 표의 위치를 쓴다. 없으면 \`kedovi install\` (또는 \`node bin/kit.js install\`).`
      : `모든 repo 는 \`${REPOS_DIR}/<이름>/\` 에 있다 (워크스페이스 git 에서 제외). 없으면 \`kedovi install\` (또는 \`node bin/kit.js install\`).`, '',
      ...(grouped
        ? ['| repo | 그룹 | 위치 | 스택 | 역할 | 원본 |', '|---|---|---|---|---|---|', ...code.map((r) => `| **${r.name}** | ${r.group || ''} | \`${r.dir}/\` | ${r.stack || ''} | ${r.role || ''} | ${repoSource(r)} |`)]
        : ['| repo | 위치 | 스택 | 역할 | 원본 |', '|---|---|---|---|---|', ...code.map((r) => `| **${r.name}** | \`${r.dir}/\` | ${r.stack || ''} | ${r.role || ''} | ${repoSource(r)} |`)]), '');
  }
  if (refs.length) {
    out.push('## 참고 자료', '',
      '| 이름 | 종류 | 에이전트가 읽을 곳 | 내용 | 원본 |', '|---|---|---|---|---|',
      ...refs.map((r) => `| **${r.name}** | ${REPO_KINDS[r.kind] || r.kind} | \`${posix(path.join(r.dir, r.mdPath || r.sourceRoot || ''))}/\`${r.mdPath ? ' (md 사본)' : ''} | ${r.role || ''} | ${repoSource(r)} |`), '',
      '- **표의 경로는 읽을 위치다. 비어 있을 수 있다** (clone 직후, 템플릿 README 만). 인용 전에 목록을 보고, 없으면 "문서 없음" 이라고 답한다. 세션 시작 줄에 비어 있는 자료가 ⚠ 로 뜬다.',
      '- **참고 자료는 읽기 전용이다.** 요청이 없으면 고치거나 그 안에서 커밋하지 않는다.',
      '- **요구사항·화면 동작의 근거는 기획 문서에서 찾고, 답할 때 문서 경로와 ID 를 적는다.** 문서가 코드와 다르면 코드가 현재 사실이다. 다른 점은 답변에 밝히고 문서 갱신 대상으로 보고한다.',
      '- Word·Excel·PPT 원본은 직접 읽지 못할 수 있다. md 사본이 있으면 그것을 읽고, 없으면 "원본을 읽지 못함" 이라고 밝힌다. 추측으로 채우지 않는다.');
    if (refs.some((r) => r.kind === 'legacy')) {
      out.push(ws.project.type === 'consulting'
        ? '- **현행 시스템 소스는 분석 대상이다.** 고치지 않고, 현행 분석 문장마다 `파일:라인` 근거를 단다.'
        : '- **레거시 소스는 AS-IS 동작의 근거다.** 우선순위는 고객 요구사항(티켓) > AS-IS 동작 > 현재 코드.' + (ws.packs.includes('modernization') ? ' 비교·검색 규칙은 modernization 팩 룰을 따른다.' : ''));
    }
    out.push('');
  }
  if (issues.length) {
    out.push('## 이슈 기록 repo', '',
      '| repo | 위치 | 원본 |', '|---|---|---|',
      ...issues.map((r) => `| **${r.name}** | \`${r.dir}/\` | ${repoSource(r)} |`), '',
      '- **이 프로젝트의 이슈·확인 요청·테스트 결과 문서**를 두는 곳이다. 프로젝트 repo 나 워크스페이스에 흩어 두지 않는다.',
      '- **이 프로젝트의 이슈가 아니면 여기에 쓰지 않는다.** 다른 프로젝트·킷에 전달할 글, 출력 위치를 말하지 않은 "내용 만들어줘" 류 요청은 대화로 답한다. 파일은 사용자가 위치를 정했을 때만 만든다.',
      '- 문서를 쓰기 전에 그 repo 의 README·폴더 구조를 보고 기존 분류와 이름 규칙을 따른다. 커밋·push 는 요청할 때만.', '');
  }
  return out.join('\n');
}

function repoRulesSection(ws, rules, repoMap, catalog, extra = new Map(), languages = []) {
  const code = ws.repos.filter((r) => r.kind === 'code' || r.kind === 'issues');
  const scoped = rules.filter((r) => r.scope === 'repo' && r.agents === 'all');
  if (!code.length || (!scoped.length && !code.some((r) => r.kind === 'code' && (!Array.isArray(r.stacks) || !r.stacks.length)))) return '';
  const packsOf = (repo) => Object.keys(repoMap).filter((pk) => repoMap[pk].includes(repo));
  // 규칙이 그 repo 에 걸리나: repos: 로 정한 규칙은 그 repo 만, 나머지는 팩이 붙은 repo. rules.offIn · repos: 대체로 뺀 repo 는 제외
  const applies = (x, name) => ruleRepos(x, repoMap).includes(name) && !(x.skipRepos || []).includes(name);
  const repoNames = (x) => code.filter((r) => applies(x, r.name)).map((r) => r.name);
  const langLabel = (r) => ((r.languages || []).length ? ` · ${labelLanguages(languages, r.languages)}` : '');
  // 멀티모듈 repo — 팩이 붙게 한 스택들의 모듈. 협업 도구 팩이나 모듈을 모르는 스택이 섞이면 repo 전체(null)
  const packModules = (r, pack) => {
    if (!r.stackPaths) return null;
    const ids = (r.stacks || []).filter((id) => {
      const s = catalog.find((c) => c.id === id);
      return s && [s, catalog.find((c) => c.id === s.parent)].filter(Boolean).some((e) => LAYER_PACKS[e.layer] === pack || e.pack === pack);
    });
    return modulesOf(r.stackPaths, ids);
  };
  const where = (r, pack) => { const m = packModules(r, pack); return m ? `: ${m.map((x) => `\`${x}/\``).join(', ')}` : ''; };
  const anyModules = code.some((r) => r.stackPaths && Object.keys(r.stackPaths).length);
  const out = ['## repo 별 작업 규칙. 그 repo 를 고치기 전에 읽는다', '',
    '스택(기술)과 협업 도구(GitHub·GitLab)마다 규칙이 다르다. **아래 표의 문서를 읽기 전에는 그 repo 를 고치지 않는다.** 스택이 틀렸으면 `kedovi detect`.' +
      (anyModules ? ' 규칙 뒤에 모듈 경로(`api/` 등)가 붙어 있으면 그 모듈을 고칠 때만 읽는다.' : ''), '',
    '| repo | 스택 · 협업 | 먼저 읽을 규칙 |', '|---|---|---|'];
  for (const r of code) {
    const stacks = r.stacks || [];
    const host = HOSTS[r.host] || '협업 도구 미확인';
    const label = r.kind === 'issues' ? `이슈 기록 · ${host}` : (!Array.isArray(r.stacks) ? '스택 미확인: `kedovi detect`' : !stacks.length ? ((r.languages || []).length ? '스택 없음' : '스택 없음: 공통 규칙만') :
      stacksLabel(catalog, stacks, (s) => !(s.pack && packsOf(r.name).includes(s.pack)), r.stackPaths)) + (r.kind === 'code' ? `${langLabel(r)} · ${host}` : '');
    const docs = scoped.filter((x) => x.load === 'always' && applies(x, r.name)).map((x) => `\`${x.out}\`${x.repos && !x.forPack ? '' : where(r, x.forPack || x.pack)}`);
    out.push(`| **${r.name}** | ${label} | ${docs.length ? docs.join('<br>') : '—'} |`);
  }
  const od = scoped.filter((x) => x.load === 'on-demand' && repoNames(x).length); // 끄거나 바꿔 걸리는 repo 가 없는 규칙은 뺀다
  if (od.length) {
    const table = ['| 언제 | 문서 | repo |', '|---|---|---|',
      ...od.map((x) => `| ${x.meta.when} | \`${x.out}\` | ${repoNames(x).map((n) => `${n}${x.repos && !x.forPack ? '' : where(code.find((r) => r.name === n) || {}, x.forPack || x.pack)}`).join(', ')} |`)];
    if (((ws.rules || {}).onDemand || []).includes(REPO_TASKS)) {
      out.push('', `그 repo 에서 작업을 시작하기 전에 \`${REPO_TASKS_FILE}\` 의 표(작업별로 먼저 읽을 문서 ${od.length}개)를 읽고, 해당하는 문서를 읽는다.`);
      extra.set(REPO_TASKS_FILE, [`<!-- ${GEN_NOTE} -->`, '', '# repo 별 작업별 규칙', '', '그 repo 에서 아래 작업을 할 때는 이것도 먼저 읽는다.', '', ...table, ''].join('\n'));
    } else out.push('', '그 repo 에서 아래 작업을 할 때는 이것도 먼저 읽는다.', '', ...table);
  }
  out.push('');
  return out.join('\n');
}

/** repo 안에 이미 있던 AI 지침 (repos[].guides) 과 따르는 방식 (guidesMode, 기본 follow) */
const isGuideMode = (m) => typeof m === 'string' && Object.prototype.hasOwnProperty.call(GUIDE_MODES, m);
function guideMode(r) { return isGuideMode(r.guidesMode) ? r.guidesMode : 'follow'; }
function repoGuidesSection(ws) {
  const list = ws.repos.filter((r) => Array.isArray(r.guides) && r.guides.length);
  if (!list.length) return '';
  const MAX = 6;
  const show = (r, gs) => gs.slice(0, MAX).map((g) => `\`${posix(r.dir)}/${g}\``).join(' · ') + (gs.length > MAX ? ` 외 ${gs.length - MAX}개` : '');
  const out = ['## repo 자체 지침', '',
    'repo 안에 원래 있던 AI 지침 파일이다. 따르는 방식은 repo 마다 정한다 (`kedovi repo guides <이름> follow|kit|ignore`).', '',
    '| repo | 지침 | 방식 |', '|---|---|---|'];
  for (const r of list) {
    const docs = r.guides.filter((g) => !isGuideSetting(g));
    out.push(`| **${r.name}** | ${docs.length ? show(r, docs) : '—'} | ${GUIDE_MODES[guideMode(r)]} |`);
  }
  const modes = new Set(list.filter((r) => r.guides.some((g) => !isGuideSetting(g))).map(guideMode));
  out.push('');
  if (modes.has('follow')) out.push('- **repo 지침 우선**: 그 repo 를 고치기 전에 표의 지침을 읽는다 (Codex 는 스스로 읽지 않는다). 코드 규칙 · 빌드 · 테스트 명령 · 구조가 킷 규칙과 다르면 repo 지침을 따르고, 킷 규칙은 지침에 없는 부분만 채운다. repo 안의 스킬(`.claude/skills/` · `.agents/skills/`)은 스킬 목록에 오지 않으므로, 설명에 맞는 작업이면 그 SKILL.md 를 읽고 따른다. 커밋 · push · 배포 승인, 비밀값, 운영 접근 같은 워크스페이스 안전 규칙은 킷 규칙을 따른다.');
  if (modes.has('kit')) out.push('- **킷 규칙 우선**: 지침은 빌드 · 테스트 명령과 구조를 알 때만 참고한다. 규칙이 다르면 킷 규칙을 따르고, 다른 점을 보고에 한 줄 적는다.');
  if (modes.has('ignore')) out.push('- **무시**: 읽지 않는다. 도구가 그 폴더의 지침을 스스로 불러와도 따르지 않는다.');
  if (list.some((r) => r.guides.some(isGuideSetting))) out.push('- repo 안의 실행 도구 설정(`.claude/settings.json` · `.codex/` · `.mcp.json`)은 워크스페이스에서 실행하면 적용되지 않는다. 필요한 훅 · 권한 · MCP 는 사용자에게 알리고 워크스페이스 설정으로 옮긴다 (import 스킬).');
  out.push('');
  return out.join('\n');
}

/** 무시하는 repo 의 CLAUDE.md · .claude/rules 를 Claude Code 가 불러오지 않게 (claudeMdExcludes: 절대 경로 glob) */
function guideExcludes(ws) {
  const out = [];
  // 무시는 기록이 비어 있어도 막는다 (나중에 생기는 지침도)
  for (const r of ws.repos.filter((x) => ['code', 'issues'].includes(x.kind) && guideMode(x) === 'ignore')) {
    // 링크 repo: 절대 경로는 그대로, 상대 · 홈 경로는 PC 마다 달라 끝부분만 (생성물이 PC 마다 같게)
    const linked = r.path ? posix(r.path).replace(/\/+$/, '') : '';
    const bases = [`**/${posix(r.dir)}`, ...(linked ? [path.isAbsolute(r.path) ? linked : `**/${linked.replace(/^(~\/|(\.\.?\/)+)/, '')}`] : [])];
    for (const b of [...new Set(bases)]) out.push(`${b}/CLAUDE.md`, `${b}/**/CLAUDE.md`, `${b}/.claude/CLAUDE.md`, `${b}/**/.claude/CLAUDE.md`, `${b}/CLAUDE.local.md`, `${b}/**/CLAUDE.local.md`, `${b}/.claude/rules/**`, `${b}/**/.claude/rules/**`);
  }
  return out;
}

function buildAgentsMd(ws, rules, skills, repoMap = {}, catalog = [], extra = new Map(), languages = []) {
  const p = ws.project;
  const parts = [`<!-- ${GEN_NOTE} -->`, '', `# ${p.title || p.name || '워크스페이스'}`, ''];
  if (p.type) parts.push(`**프로젝트 유형: ${PROJECT_TYPES[p.type] || p.type}**`, '');
  if (p.approach === 'sprint') {
    parts.push(`**진행 방식: ${APPROACHES.sprint}**`, '',
      '- 스프린트 = 기능 단위 (기간 아님). 첫 스프린트는 끝까지 동작하는 최소 기능 하나(많아야 몇 개)만 잡는다. 최소는 기능 수다: 그 기능의 완성도(오류 처리 · 사이드이펙트 · 테스트)는 줄이지 않는다. 나머지는 `handoffs/PLAN.md` 의 「백로그」 에 한 줄씩 적고 지금 만들지 않는다.',
      '- 분석 · 설계 · 화면설계 · 데이터 설계도 이번 스프린트 기능만 한다. 전체를 미리 설계하지 않고, 나중에 붙일 자리만 남긴다.',
      '- 스프린트 끝은 데모(실행 방법과 함께 돌아가는 결과를 보여 주고 확인받기) → 회고(잘 된 것 · 바꿀 것 한 줄) → 백로그에서 다음 스프린트 후보 추천. 범위를 넓히거나 백로그를 당겨 올 때는 묻는다.', '');
  } else if (p.approach === 'issue') {
    parts.push(`**진행 방식: ${APPROACHES.issue}**`, '',
      '- 로드맵(`handoffs/PLAN.md`)은 단계가 아니라 `## 이슈` 표다. 이슈를 시작하면 한 줄(첫 상태 · 시작 날짜), 상태가 바뀌면 상태와 갱신 날짜, 운영에 반영하면 운영 반영 날짜를 고친다. 상태 목록은 그 절의 `상태:` 줄이다.',
      '- 작업을 끝낼 때(핸드오프) 오늘 다룬 이슈의 상태를 표에 반영할지 사용자에게 묻고 고친다. 착수 전 개선 아이디어는 `## 개선 후보` 에 한 줄씩 둔다.',
      '- 주간 보고는 `node packs/core/bin/plan.js --report [시작 [끝]]` 출력을 쓴다 (숫자는 표에서 센 것만).', '');
  } else if (p.approach === 'full') parts.push(`**진행 방식: ${APPROACHES.full}**`, '');
  if (p.description) parts.push(p.description, '');
  parts.push('> 이 문서는 **Claude Code 와 Codex 가 같은 내용을 읽는다** (Claude 는 `CLAUDE.md` 가 이 파일을 가져온다).',
    '> 룰·스킬을 고치려면 `packs/` 를 고치고 `node bin/kit.js sync` 를 돌린다.', '');
  const repos = repoTable(ws);
  if (repos) parts.push(repos);
  const perRepo = repoRulesSection(ws, rules, repoMap, catalog, extra, languages);
  if (perRepo) parts.push(perRepo);
  const guides = repoGuidesSection(ws);
  if (guides) parts.push(guides);

  const always = rules.filter((r) => r.load === 'always' && r.agents === 'all' && r.scope !== 'repo');
  for (const r of always) {
    parts.push(`<!-- 출처: ${r.src} -->`, r.body.trim(), '');
  }

  const onDemand = rules.filter((r) => r.load === 'on-demand' && r.agents === 'all' && r.scope !== 'repo');
  if (onDemand.length) {
    parts.push('## 작업별 필수 참고: 해당 작업을 시작하기 전에 반드시 읽는다', '',
      '상시 로드되지 않는 룰이다. **아래 "언제" 에 해당하면 그 문서를 먼저 읽고 시작한다.** 안 읽고 진행하지 않는다.', '',
      '| 언제 | 문서 |', '|---|---|',
      ...onDemand.map((r) => `| ${r.meta.when} | \`${r.out}\` (${r.title}) |`), '');
  }

  if (skills.length) {
    parts.push('## 스킬', '', '호출: Claude Code `/이름` · Codex `$이름` (또는 `/skills`). 설명에 맞는 요청이면 명시 호출 없이도 쓴다.', '',
      '| 이름 | 설명 |', '|---|---|',
      ...skills.map((s) => `| \`${s.name}\` | ${briefSkill(s.description).replace(/\|/g, '\\|')} |`), '');
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** 스킬 설명은 첫 문장만 AGENTS.md 에 싣는다 (전체는 스킬 파일에). 예산을 아낀다 */
function briefSkill(d) {
  const t = String(d || '').trim();
  const m = t.match(/^(.*?(?:다\.|\.))(?:\s|$)/);
  return m ? m[1] : t;
}

function buildClaudeMd(rules) {
  const parts = [`<!-- ${GEN_NOTE} -->`, '', '@AGENTS.md', ''];
  const claudeOnly = rules.filter((r) => r.agents === 'claude' && r.load === 'always');
  if (claudeOnly.length) {
    parts.push('## Claude Code 전용', '');
    for (const r of claudeOnly) parts.push(`<!-- 출처: ${r.src} -->`, r.body.trim(), '');
  }
  const claudeOnDemand = rules.filter((r) => r.agents === 'claude' && r.load === 'on-demand');
  if (claudeOnDemand.length) {
    parts.push('| 언제 | 문서 |', '|---|---|', ...claudeOnDemand.map((r) => `| ${r.meta.when} | \`${r.out}\` |`), '');
  }
  return parts.join('\n');
}

function hookGroups(hooks, agent) {
  const out = {};
  for (const h of hooks) {
    if (h.agents && h.agents !== 'all' && h.agents !== agent) continue; // 그 도구에만 있는 이벤트·도구 (예: Claude 의 Agent 도구)
    const base = agent === 'claude' ? '$CLAUDE_PROJECT_DIR' : '$(git rev-parse --show-toplevel)';
    const handler = { type: 'command', command: `${h.runner} "${base}/${h.script}" --agent=${agent}`, timeout: h.timeout };
    if (h.statusMessage) handler.statusMessage = h.statusMessage;
    out[h.event] = out[h.event] || [];
    // Codex 는 Stop·UserPromptSubmit 의 matcher 를 무시한다 — 넣지 않는다
    const group = { hooks: [handler] };
    if (h.matcher && !(agent === 'codex' && ['Stop', 'UserPromptSubmit', 'Interrupt'].includes(h.event))) group.matcher = h.matcher;
    out[h.event].push(group);
  }
  return out;
}

/** 승인 없이 쓰는 읽기 전용 명령 (Claude Code 권한 규칙). 파이프 · && 로 이어도 명령마다 따로 본다 */
const READONLY_ALLOW = [
  'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(git blame:*)', 'Bash(git grep:*)', 'Bash(git ls-files:*)', 'Bash(git rev-parse:*)',
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(grep:*)', 'Bash(rg:*)', 'Bash(tree:*)', 'Bash(pwd)',
  'Bash(kedovi docs show:*)', 'Bash(kedovi docs refs:*)', 'Bash(kedovi docs trace:*)',
  'Bash(node packs/core/bin/docs-site.js show:*)', 'Bash(node packs/core/bin/docs-site.js refs:*)', 'Bash(node packs/core/bin/docs-site.js trace:*)',
  'Bash(node packs/core/bin/handoff.js find:*)',
];

function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = k in a ? deepMerge(a[k], v) : v;
    return out;
  }
  return b === undefined ? a : b;
}

function tomlValue(v) {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.map(tomlValue).join(', ')}]`;
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)} = ${tomlValue(x)}`).join(', ')} }`;
  throw new Error(`TOML 로 못 쓰는 값: ${v}`);
}

function buildCodexConfig(ws, agentsBytes, team = {}, limitBytes = null) {
  const lines = [`# ${GEN_NOTE}`, '# 프로젝트 설정은 Codex 에서 이 프로젝트를 trusted 로 지정해야 적용된다.', ''];
  if (team.main && team.main.codex) lines.push(`model = ${tomlValue(team.main.codex)}`, '');
  const limit = limitBytes || ws.limits.agentsMdBytes || DEFAULT_AGENTS_MD_BYTES;
  if (limit !== DEFAULT_AGENTS_MD_BYTES || agentsBytes > DEFAULT_AGENTS_MD_BYTES) lines.push(`project_doc_max_bytes = ${limit}`, '');
  for (const [k, v] of Object.entries((ws.codex && ws.codex.config) || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) continue;
    lines.push(`${k} = ${tomlValue(v)}`);
  }
  // 역할 에이전트 동시 실행 상한 (팀 기본 프로필 기준) — Codex 가 직접 막는다
  if (team.limits) lines.push('', '[agents]', `max_concurrent_threads_per_session = ${team.limits.parallel}`);
  for (const [name, srv] of Object.entries(ws.mcp || {})) {
    lines.push('', `[mcp_servers.${name}]`, `command = ${tomlValue(srv.command)}`);
    if (srv.args) lines.push(`args = ${tomlValue(srv.args)}`);
    if (srv.env && Object.keys(srv.env).length) lines.push(`env = ${tomlValue(srv.env)}`);
  }
  return lines.join('\n') + '\n';
}

function buildMcpJson(ws) {
  const servers = {};
  for (const [name, srv] of Object.entries(ws.mcp || {})) servers[name] = { type: 'stdio', command: srv.command, args: srv.args || [], env: srv.env || {} };
  return JSON.stringify({ mcpServers: servers }, null, 2) + '\n';
}

const GITIGNORE_BEGIN = '# >>> kit: 생성 블록 (node bin/kit.js sync) >>>';
const GITIGNORE_END = '# <<< kit <<<';

function buildGitignore(current, ws) {
  const block = [GITIGNORE_BEGIN, '# 개인 지침: 공유하지 않는다',
    '.agents/local.md', LOCAL_CONFIG, 'CLAUDE.local.md', 'AGENTS.override.md', '.claude/settings.local.json', '.handoff-snooze', '.agents/bin/', '.agents/board/',
    '# 팀 에이전트: 모델이 사람마다 다를 수 있어 각자 sync 가 만든다', '.claude/agents/', '.codex/agents/', LOCAL_MANIFEST,
    '# repo: 각자 kedovi install 로 clone 한다', `/${REPOS_DIR}/`, GITIGNORE_END].join('\n');
  const re = new RegExp(`${GITIGNORE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${GITIGNORE_END}`);
  return re.test(current) ? current.replace(re, block) : `${current.replace(/\s*$/, '')}${current.trim() ? '\n\n' : ''}${block}\n`;
}

/** 정본에서 생성물 전부를 { 경로: 내용 } 으로 만든다. 디스크는 건드리지 않는다. */
function generate(root) {
  const errors = [];
  const warnings = [];
  const ws = loadWorkspace(root);
  const catalog = loadCatalog(root);
  for (const r of ws.repos) if (!r.host) { const h = hostOf(root, r); if (h) r.host = h; } // 메모리에서만
  const languages = loadLanguages(root);
  const repoMap = repoPacks(root, ws, catalog, warnings, languages);
  const packs = loadPacks(root, ws, errors, Object.keys(repoMap).filter((pk) => !ws.packs.includes(pk)));
  applyPackVarDefaults(ws, packs.map((pk) => pk.dir)); // 메모리에서만 — 새로 붙은 스택 팩 변수가 비어 sync 가 멈추지 않게
  validateProject(ws, errors, warnings);
  const detectLib = path.join(root, 'packs', 'core', 'lib', 'detect.js');
  if (ws.stackHints !== undefined && exists(detectLib)) {
    const { checkHints } = require(detectLib);
    if (checkHints) errors.push(...checkHints(catalog, ws.stackHints));
  }
  const { rules: allRules, skills, hooks } = collect(root, ws, packs, errors, warnings, repoMap);
  const { rules, state: ruleState } = applyRuleChoices(ws, allRules, errors, warnings, repoMap);
  for (const pk of packs) {
    if (['layer', 'stack', 'lang'].includes(pk.meta.category) && ws.packs.includes(pk.name) && !repoMap[pk.name]) {
      warnings.push(`팩 '${pk.name}' 이 packs 에 직접 적혀 있어 워크스페이스 전체에 적용됩니다. repo 별로 붙이려면 packs 에서 빼고 kedovi detect`);
    }
  }
  const files = new Map();

  const agentsMd = buildAgentsMd(ws, rules, skills, repoMap, catalog, files, languages);
  files.set('AGENTS.md', agentsMd);
  files.set('CLAUDE.md', buildClaudeMd(rules));
  for (const r of rules) {
    files.set(r.out, `<!-- ${GEN_NOTE} · 출처: ${r.src} -->\n\n${r.body.trim()}\n`);
  }

  for (const s of skills) {
    for (const rel of listFiles(s.dir)) {
      const abs = path.join(s.dir, rel);
      let content = fs.readFileSync(abs);
      if (/\.(md|txt)$/.test(rel)) {
        let text = render(content.toString('utf8'), ws, `${s.src}/${rel}`, errors);
        if (rel === 'SKILL.md') {
          const fm = parseFrontmatter(text);
          text = `${fm.raw}\n<!-- ${GEN_NOTE} · 출처: ${s.src}/SKILL.md -->\n${fm.body}`;
        }
        content = text;
      }
      files.set(`.agents/skills/${s.name}/${rel}`, content);
      files.set(`.claude/skills/${s.name}/${rel}`, content);
    }
  }

  // repo 는 워크스페이스 밖 폴더를 심볼릭으로 건 것이라 Claude Code 는 허용 경로에 넣어야 읽는다
  const base = { hooks: hookGroups(hooks, 'claude') };
  const linked = ws.repos.filter((r) => !r.remote && r.path);
  // 읽기 · 조회만 하는 명령은 미리 허용한다: 팀원(분석 · 설계 등) 창에 승인 질문이 떠 리더 모르게 멈추지 않게. 쓰기 · 지우기를 할 수 있는 명령(find -delete · sed -i · git branch 등)은 넣지 않는다.
  // 더 넣을 것은 workspace.json claude.settings.permissions.allow (팀) · .claude/settings.local.json (개인)
  base.permissions = { allow: READONLY_ALLOW, ...(linked.length ? { additionalDirectories: linked.map((r) => r.path) } : {}) };
  const { team, teamLimits } = resolveModels(root, ws);
  team.limits = teamLimits;
  if (team.main && team.main.claude) base.model = team.main.claude; // 팀 기본 메인 모델 — 개인은 kedovi agent (start 때 --model)
  // 커밋·PR 에 도구 서명(Co-Authored-By · Generated with)을 넣지 않는다. false 한 값은 v2.1.281 미만이 파일째 무시하므로 빈 문자열로
  base.attribution = { commit: '', pr: '', sessionUrl: false };
  const excludes = guideExcludes(ws);
  if (excludes.length) base.claudeMdExcludes = excludes;
  const claudeSettings = deepMerge(base, (ws.claude && ws.claude.settings) || {});
  files.set('.claude/settings.json', JSON.stringify(claudeSettings, null, 2) + '\n');
  files.set('.codex/hooks.json', JSON.stringify({ description: GEN_NOTE, hooks: hookGroups(hooks, 'codex') }, null, 2) + '\n');
  // 대화 스타일 (학습 · 전문가) Claude 출력 스타일. 고르는 것은 각자 (.claude/settings.local.json outputStyle, kedovi prefs)
  const chat = chatPrefsLib(root);
  if (chat) for (const [rel, content] of chat.outputStyleFiles()) files.set(rel, content);
  if (ws.mcp && Object.keys(ws.mcp).length) files.set('.mcp.json', buildMcpJson(ws));
  // Codex 는 계정 설정으로 서명을 넣게 해 규칙으로 못 막는다 — 커밋 단계에서 지운다 (repos/* 는 installCommitMsgHooks)
  files.set('.githooks/pre-commit', PRE_COMMIT_HOOK);
  files.set('.githooks/commit-msg', COMMIT_MSG_HOOK('"$(git rev-parse --show-toplevel)/packs/core/bin/strip-ai-trailers.js"'));
  files.set('.githooks/pre-push', PRE_PUSH_HOOK);

  // 예산 — Codex 는 AGENTS.md 를 project_doc_max_bytes 에서 자른다. 잘리면 뒤쪽 룰이 조용히 사라진다.
  // 넘으면 막지 않고 Codex 한도(project_doc_max_bytes)를 올려 적는다. 96KB 까지. 큰 절을 알려 줄이게 한다
  const limit = ws.limits.agentsMdBytes || DEFAULT_AGENTS_MD_BYTES;
  const bytes = Buffer.byteLength(agentsMd);
  const kb = (n) => `${(n / 1024).toFixed(n % 1024 ? 1 : 0)}KB`;
  // Codex 는 개인 지침을 합친 AGENTS.override.md 를 읽으므로 그 몫(PERSONAL_HEADROOM)까지 더해 본다
  const withPersonal = bytes + PERSONAL_HEADROOM;
  let effective = limit;
  if (bytes > MAX_AGENTS_MD_BYTES) errors.push(`AGENTS.md ${kb(bytes)} 가 ${kb(MAX_AGENTS_MD_BYTES)} 를 넘습니다. always 룰을 on-demand 로 내리거나 repo 를 나누세요`);
  else if (withPersonal > limit) {
    effective = Math.ceil((withPersonal * 1.1) / 8192) * 8192;
    // AGENTS.md 자체는 한도 안이고 개인 지침 몫 때문에만 넘으면 조용히 올린다 (.codex/config.toml 변경으로 보인다)
    if (bytes > limit) {
    const big = agentsMd.split(/^(?=## )/m).map((s) => [Buffer.byteLength(s), (s.match(/^## ([^.\n—]*)/) || ['', ''])[1].trim()]).filter((x) => x[1]).sort((a, b) => b[0] - a[0]).slice(0, 2);
    warnings.push([`AGENTS.md ${kb(bytes)} + 개인 지침 몫 ${kb(PERSONAL_HEADROOM)} = 약 ${kb(withPersonal)}: Codex 기본 한도 ${kb(limit)} 를 넘어 한도를 ${kb(effective)} 로 올렸습니다 (Claude 는 상관없음)`,
      `큰 절: ${big.map(([b, h]) => `${h} ${kb(b)}`).join(' · ')}`,
      `줄이기: kedovi rules ondemand ${REPO_TASKS} 또는 kedovi rules ondemand <규칙 ID> (필요할 때만 읽게. 목록은 kedovi rules list)`].join('\n'));
    }
  } else if (withPersonal > limit * 0.9) warnings.push(`AGENTS.md ${kb(bytes)}: 개인 지침을 더하면 한도 ${kb(limit)} 에 가깝습니다`);
  files.set('.codex/config.toml', buildCodexConfig(ws, bytes, team, effective));

  const roles = collectRoles(packs, ws, errors);
  for (const a of auditModels(root, ws)) warnings.push(a.message); // 퇴역 모델은 경고로 — 생성은 막지 않는다 (개인 설정 때문에 팀 커밋이 막히지 않게)
  return { ws, files, roles, packs, errors, warnings, allRules, ruleState, repoMap, stats: { rules: rules.length, always: rules.filter((r) => r.load === 'always').length, skills: skills.length, hooks: hooks.length, bytes, limit: effective } };
}

/** 개인 지침(.agents/local.md) → CLAUDE.local.md · AGENTS.override.md. 둘 다 gitignore 대상이라 check 대상이 아니다. */
// ───────────────────────── 팀 에이전트 (역할별 모델) ─────────────────────────

const LOCAL_MANIFEST = '.agents/.local-generated.json';

/** 모델 설정 — 킷 기본값 ← workspace.json agents(팀) ← .agents/local.json agents(개인). 빈 값 = 도구 기본(메인과 같게) */
const OTHER_TOOL = { claude: 'codex', codex: 'claude' };

/**
 * 프로필 하나를 { main, roles, crossReview } 로. 없는 프로필이면 null.
 * 프로필은 실행 도구별 표다: profiles.<이름>.<도구>.<역할> = 모델 또는 { model, effort }.
 * crossReview 는 그 도구 세션이 상대 도구에게 맡길 때의 상대 도구 모델이라 상대 도구 칸으로 옮긴다.
 * 결과의 역할 항목 = { claude, codex, effort: { claude, codex } } (effort 는 그 모델을 돌리는 도구 기준)
 * grades = { 역할 이름: 'high' | 'standard' | 'low' } (역할 정의 머리말의 grade. roleGrades 가 만든다)
 */
function profileModels(cat, name, grades = {}) {
  const pf = (cat.profiles || {})[name];
  if (!pf) return null;
  const out = { main: {}, crossReview: {}, roles: {} };
  for (const tool of ['claude', 'codex']) {
    // 프로필에 없는 역할은 역할 정의의 grade(high · standard · low)로 프로필의 등급 표(grades)에서 고른다. 팩·프로젝트가 더한 역할도 모델이 정해진다
    const table = { ...pf[tool] };
    for (const [role, g] of Object.entries(grades)) if (!table[role] && ((pf.grades || {})[tool] || {})[g]) table[role] = pf.grades[tool][g];
    for (const [role, v] of Object.entries(table)) {
      const { model, effort, tool: via, fallback, gateway } = typeof v === 'string' ? { model: v } : v || {};
      const runs = role === 'crossReview' ? OTHER_TOOL[tool] : tool;
      const node = role === 'main' || role === 'crossReview' ? out[role] : (out.roles[role] = out.roles[role] || {});
      // 역할을 상대 도구로 위임하면 "<도구>:<모델>" 로 적는다 (그 세션 도구 칸에). fallback = 상대 도구가 없는 PC 에서 대신 쓸 같은 도구 모델
      if (model) node[runs] = via && via !== runs && role !== 'main' && role !== 'crossReview' ? `${via}:${model}` : model;
      if (effort) node.effort = { ...(node.effort || {}), [runs]: effort };
      if (fallback) node.fallback = { ...(node.fallback || {}), [runs]: fallback };
      // 게이트웨이에서 별칭이 옛 버전(below 미만)으로 이어질 때 대신 쓸 모델 (예: Bedrock 의 haiku = Haiku 4.5)
      if (gateway && gateway.model) node.gatewayAlt = { ...(node.gatewayAlt || {}), [runs]: { ...gateway, of: model } }; // of: 직접 고른 모델에는 적용하지 않는다
    }
  }
  return out;
}

/** 모델 값 풀기 — "codex:gpt-6.1-sol" 이면 { tool: 'codex', model }, 아니면 그 칸의 도구 */
function splitModel(value, tool) {
  const m = String(value || '').match(/^(claude|codex):(.+)$/);
  return m ? { tool: m[1], model: m[2], delegated: m[1] !== tool } : { tool, model: value || '', delegated: false };
}

/** 역할 항목의 추론 강도 — effort 가 문자열이면 두 도구 공통, 객체면 도구별 */
const effortOf = (entry, tool) => {
  const e = (entry || {}).effort;
  return typeof e === 'string' ? e : (e || {})[tool] || null;
};

/** 프로필 등급. models.json 의 profiles 는 높은 순(최고 → 절약)으로 적는다. 작을수록 높다, 없으면 null */
function profileRank(cat, name) {
  const i = Object.keys((cat || {}).profiles || {}).indexOf(name);
  return i < 0 ? null : i;
}

/** 역할을 읽는 팩 순서: workspace.json 팩 → repo 스택으로 붙은 팩(db · infra 등) → project (같은 이름이면 project 가 이긴다) */
function rolePackOrder(root, ws) {
  const packs = ws.packs || [];
  let extra = [];
  try { extra = Object.keys(repoPacks(root, ws, loadCatalog(root), [])).filter((pk) => !packs.includes(pk)); } catch { /* repo 정보 없음 */ }
  return [...packs.filter((p) => p !== 'project'), ...extra, ...(packs.includes('project') ? ['project'] : [])];
}

/** 쓰는 팩의 역할 정의에서 { 이름: grade } — 같은 이름이면 뒤 팩(project)이 이긴다 */
function roleGrades(root, ws) {
  const out = {};
  for (const pk of rolePackOrder(root, ws)) {
    const dir = path.join(root, 'packs', pk, 'agents');
    for (const rel of listFiles(dir).filter((f) => f.endsWith('.md'))) {
      const { meta } = parseFrontmatter(read(path.join(dir, rel)));
      if (meta.name && ['high', 'standard', 'low'].includes(meta.grade)) out[meta.name] = meta.grade;
    }
  }
  return out;
}

/**
 * 모델 = 프로필 → 팀 직접 지정(workspace.json agents) → 이 PC 직접 지정(.agents/local.json agents).
 * 프로필은 팀 값(workspace.json agents.profile, 없으면 models.json defaultProfile)이 기본이다.
 * 이 PC 값(agents.profile)은 팀보다 낮은 프로필(요금제 제약)일 때만 적용한다. 높은 프로필은 팀이 agents.allowHigherProfile 로 허용했을 때만.
 * 역할 에이전트 상한(limits)도 팀 값을 넘지 않는다.
 * team = 팀 프로필 기준(공유 설정 파일에 쓰는 값), effective = 이 PC 기준(에이전트 파일·kedovi start).
 * profile = { team, local(적용된 이 PC 프로필), blocked(팀보다 높아 무시한 이 PC 값), allowHigher }
 */
function resolveModels(root, ws) {
  let cat = {};
  try { cat = JSON.parse(read(path.join(root, 'packs', 'core', 'models.json'))); } catch { /* 없음 */ }
  let local = {};
  try { local = JSON.parse(read(path.join(root, LOCAL_CONFIG))).agents || {}; } catch { /* 없음 */ }
  const merge = (a, b) => {
    if (!b || typeof b !== 'object') return a;
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] || {}, v) : v;
    return out;
  };
  const picks = (o) => { const { profile, access, limits, mode, plans, prefer, allowHigherProfile, enforce, ...rest } = o || {}; return rest; };
  const teamAgents = ws.agents || {};
  const teamProfile = (cat.profiles || {})[teamAgents.profile] ? teamAgents.profile : cat.defaultProfile || null;
  const allowHigher = teamAgents.allowHigherProfile === true;
  const wanted = (cat.profiles || {})[local.profile] ? local.profile : null;
  const higher = wanted && teamProfile && profileRank(cat, wanted) < profileRank(cat, teamProfile);
  const blocked = higher && !allowHigher ? wanted : null;
  const localProfile = blocked ? null : wanted;
  const grades = roleGrades(root, ws);
  const localBase = merge(profileModels(cat, localProfile || teamProfile, grades) || {}, picks(teamAgents));
  const team = merge(profileModels(cat, teamProfile, grades) || {}, picks(teamAgents));
  const effective = merge(localBase, picks(local));
  // base = 그 범위에서 직접 고르기 전 값 (역할별로 고르는 화면의 "프로필대로")
  const base = { team: profileModels(cat, teamProfile, grades) || {}, local: localBase };
  // run = 이 PC 의 연결 방식(쓰는 AI · 구성 · 게이트웨이)에 맞춘 실제 실행 값 — 에이전트 파일 · kedovi start 가 쓴다
  const access = normalizeAccess({ ...(teamAgents.access || {}), ...(local.access || {}) });
  const runWarnings = [];
  const run = applyAccess(effective, access, runWarnings);
  if (blocked) runWarnings.push(`이 PC 프로필 ${profileLabel(cat, blocked)} 은(는) 팀 프로필 ${profileLabel(cat, teamProfile)} 보다 높아 적용하지 않습니다 (팀 값 사용). 지우기: kedovi models profile team · 팀이 허용하려면 kedovi models allow-higher on`);
  // 역할 에이전트 상한 — 팀 값(프로필 ← workspace.json agents.limits)이 기준이고, 이 PC 값(개인 프로필 · agents.limits)은 낮추기만 한다
  const num = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => ['parallel', 'total'].includes(k) && Number.isInteger(v) && v > 0));
  const teamLimits = { parallel: 4, total: 10, ...num(((cat.profiles || {})[teamProfile] || {}).limits), ...num(teamAgents.limits) };
  const mine = { ...(localProfile ? num(((cat.profiles || {})[localProfile] || {}).limits) : {}), ...num(local.limits) };
  const limits = { parallel: Math.min(teamLimits.parallel, mine.parallel || teamLimits.parallel), total: Math.min(teamLimits.total, mine.total || teamLimits.total) };
  // 규칙 강제 수준 (훅) — 팀 값이 기준이고 이 PC 값은 더 세게만 한다 (상한과 같은 방침). teammateName = 팀 모드에서 이름 없는 역할 에이전트
  const lvl = (v) => ENFORCE_LEVELS.indexOf(v);
  //   rosterAnnounce = 한 요청의 첫 역할 에이전트 때 실행 방식 · 구성표를 알렸는지 한 줄 (off | warn)
  const enforce = {};
  const teamEnforce = {};
  for (const [key, def] of Object.entries(ENFORCE_DEFAULTS)) {
    const ok = (v) => lvl(v) >= 0 && lvl(v) <= lvl(def.max);
    const t = ok((teamAgents.enforce || {})[key]) ? teamAgents.enforce[key] : def.level;
    const m = (local.enforce || {})[key];
    teamEnforce[key] = t;
    enforce[key] = ok(m) && lvl(m) > lvl(t) ? m : t;
  }
  //   reviewBeforePush = commit · push 전 리뷰 확인 (기본 꺼짐). 대상 · 기준은 팀 값만: reviewRepos(['*'] = 코드 · 기획 repo 전부) · reviewMinLines · reviewPaths
  const te = teamAgents.enforce || {};
  const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
  const review = { repos: strs(te.reviewRepos).length ? strs(te.reviewRepos) : ['*'], minLines: Number.isInteger(te.reviewMinLines) && te.reviewMinLines >= 0 ? te.reviewMinLines : 0, paths: strs(te.reviewPaths) };
  //   decisionAsk = 결정 질문을 질문 창 없이 글로 끝내면 한 번 막는다 (off | block)
  //   waitStatus = 남은 것(대기 팀원 · 백그라운드 작업)이 있는 채 멈출 때 답변에 상태 줄이 없으면 한 번 막는다 (off | block. warn 은 막지 않는다)
  //   idleTeammates = 대기로 오래 남은 팀원 알림 (기본 block: 멈출 때 한 번 막는다). 시간(분)은 팀 값만: idleMinutes(대기 상한) · idleRemindMinutes(같은 팀원을 다시 알리는 간격)
  const mins = (v, d) => (Number.isInteger(v) && v > 0 ? v : d);
  const idle = { after: mins(te.idleMinutes, 10), remind: mins(te.idleRemindMinutes, 30) };
  //   longRunning = 일하는 팀원 · 위임 작업이 상한(runMinutes, 팀 값만, 기본 60분)을 넘으면 계속할지 묻게 한다 (기본 block: 멈출 때 한 번 막는다)
  //   planFirst = 요청마다 코드 repo 첫 수정 전에 답변에 「착수 전 확인:」 이 없으면 알린다 (warn 기본: 요청마다 한 번 · block: 보일 때까지 수정을 막는다)
  //   checkBeforeReview = 리뷰를 맡기는 지시서에 「검사: <명령> 통과」 줄이 없으면 막는다 (리뷰 위임 · 리뷰 역할 에이전트)
  const longRun = { after: mins(te.runMinutes, 60) };
  return { team, effective, base, run, access, runWarnings, limits, teamLimits, enforce, teamEnforce, review, idle, longRun, profile: { team: teamProfile, local: localProfile, blocked, allowHigher } };
}

const profileLabel = (cat, name) => (((cat || {}).profiles || {})[name] || {}).label || name;

/** 이 PC 에서 직접 고른 모델 수 (main · roles · crossReview 의 도구 칸) */
function countPicks(agents) {
  const node = (o) => Object.keys(o || {}).filter((k) => ['claude', 'codex'].includes(k)).length;
  const a = agents || {};
  return node(a.main) + node(a.crossReview) + Object.values(a.roles || {}).reduce((n, r) => n + node(r), 0);
}

/**
 * 팀과 다른 개인 모델 설정이 적용 중이면 한 줄로 알린다 (세션 시작 훅 · kedovi start · kedovi models). 모두 팀 값이면 ''.
 * 예: 모델 프로필: 이 PC 절약 (팀 표준 대신) · 되돌리기 kedovi models profile team · 상한 동시 2 · 모두 5 (팀 4 · 10)
 */
function profileNotice(root, ws) {
  let cat = {};
  try { cat = JSON.parse(read(path.join(root, 'packs', 'core', 'models.json'))); } catch { /* 없음 */ }
  let local = {};
  try { local = JSON.parse(read(path.join(root, LOCAL_CONFIG))).agents || {}; } catch { /* 없음 */ }
  const r = resolveModels(root, ws);
  const parts = [];
  if (r.profile.local) parts.push(`이 PC ${profileLabel(cat, r.profile.local)} (팀 ${profileLabel(cat, r.profile.team)} 대신) · 되돌리기 kedovi models profile team`);
  else if (r.profile.blocked) parts.push(`팀 ${profileLabel(cat, r.profile.team)} (이 PC 값 ${profileLabel(cat, r.profile.blocked)} 은 팀보다 높아 적용하지 않음) · 지우기 kedovi models profile team · 팀이 허용하려면 kedovi models allow-higher on`);
  const picks = countPicks(local);
  if (picks) parts.push(`이 PC 직접 지정 ${picks}개 (kedovi models)`);
  if (r.limits.parallel !== r.teamLimits.parallel || r.limits.total !== r.teamLimits.total) parts.push(`상한 동시 ${r.limits.parallel} · 모두 ${r.limits.total} (팀 ${r.teamLimits.parallel} · ${r.teamLimits.total})`);
  return parts.length ? `모델 프로필: ${parts.join(' · ')}` : '';
}

// ───────────────────────── 연결 방식 (agents.access) ─────────────────────────
//   connection  direct = 각 회사 서비스에 직접(구독·API 키) · gateway = 여러 회사 모델을 한 주소로 주는 AI 게이트웨이
//   vendors     쓸 수 있는 AI (claude = Claude, codex = GPT). gateway 는 조회한 모델 목록에서 정한다
//   compose     mix = 역할마다 두 회사 모델 섞기 · vendor = 메인과 같은 회사 모델만 · single = 모든 역할이 메인 모델
//   gateway     { url, source, models: [게이트웨이 모델 ID], aliases: Claude 별칭이 게이트웨이 모델로 이어져 있나, checked }
// 확인(2026-09-30, Claude Code 2.1.284 · Codex 0.158): Claude Code 는 게이트웨이로 GPT 를 메인·하위 에이전트로 정상 실행한다.
// Codex 안에서 Claude 모델은 도구 호출이 끊기거나 400 이 나서, Codex 의 Claude 역할은 계속 delegate.js(claude -p)로 넘긴다.

const COMPOSES = ['mix', 'vendor', 'single'];
const CLAUDE_FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'];

/** 게이트웨이 모델 목록 → 쓸 수 있는 AI. 목록이 비면(조회 전) 둘 다로 본다 */
function gatewayVendors(models) {
  const list = (models || []).map((m) => String(m).split('/').pop().toLowerCase());
  const out = [];
  if ((models || []).some((m) => claudeKey(m))) out.push('claude');
  if (list.some((m) => /^(openai\.)?(gpt|o\d|codex)/.test(m))) out.push('codex');
  return out.length ? out : ['claude', 'codex'];
}

function normalizeAccess(a = {}) {
  const connection = a.connection === 'gateway' ? 'gateway' : 'direct';
  const gateway = connection === 'gateway' ? { models: [], ...(a.gateway || {}) } : null;
  let vendors = gateway ? gatewayVendors(gateway.models) : (Array.isArray(a.vendors) ? a.vendors : ['claude', 'codex']).filter((v) => v === 'claude' || v === 'codex');
  if (!vendors.length) vendors = ['claude', 'codex'];
  const compose = COMPOSES.includes(a.compose) ? a.compose : 'mix';
  // main = 메인 모델 회사. GPT 메인은 게이트웨이 + Claude Code 에서만 (Claude Code 가 게이트웨이로 GPT 를 돌린다)
  const main = a.main === 'codex' && gateway && vendors.includes('codex') ? 'codex' : 'claude';
  return { connection, vendors, compose, main, gateway, set: Object.keys(a).length > 0 };
}

/** 이 PC 의 시작 도구 — 게이트웨이면 Claude Code(두 회사 모델을 안정적으로 섞는다), 직접이면 Claude 가 있으면 Claude Code, GPT 만이면 Codex */
const startToolOf = (access) => (access.connection === 'gateway' || access.vendors.includes('claude') ? 'claude' : 'codex');

/**
 * 게이트웨이 · 클라우드마다 다른 Claude 모델 이름 → 표준 ID (claude-opus-5-5). Claude 모델이 아니면 null
 * 예: claude/claude-opus-5-5 · anthropic/Claude-Opus-5.5 · us.anthropic.claude-opus-5-5-v1:0 · claude-opus-5-5@20260922 · claude-opus-5-5-20260922 · opus-5-5 · claude-3-5-sonnet
 */
function claudeKey(name) {
  let s = String(name || '').toLowerCase().replace(/\[1m\]$/, '').split('/').pop();
  s = s.replace(/^([a-z]{2,6}\.)?anthropic\./, '').replace(/[@:].*$/, '').replace(/-v\d+$/, '').replace(/[._ ]/g, '-').replace(/-\d{8}$/, '');
  if (/^(opus|sonnet|haiku|fable)-\d/.test(s)) s = `claude-${s}`;
  const old = /^claude-(\d+(?:-\d+)?)-(opus|sonnet|haiku|fable)$/.exec(s); // 옛 이름 순서 claude-3-5-sonnet
  if (old) s = `claude-${old[2]}-${old[1]}`;
  return /^claude-(opus|sonnet|haiku|fable)-\d+(-\d+)?$/.test(s) ? s : null;
}

/** 1M 창 모델 ID (models.json tools.claude[].window1m). Claude Code 는 모르는 ID(게이트웨이 이름)를 200k 로 보므로 [1m] 을 붙여 알린다 */
let ONE_M = null;
function window1m(name) {
  if (!ONE_M) {
    try { ONE_M = (JSON.parse(read(path.join(__dirname, '..', 'packs', 'core', 'models.json'))).tools.claude || []).flatMap((m) => m.window1m || []); } catch { ONE_M = []; }
  }
  const key = claudeKey(name);
  return !!key && ONE_M.includes(key);
}

/** Claude Code 에 넘길 게이트웨이 이름: 1M 모델이면 [1m] (Claude Code 가 보낼 때 뗀다) */
const claudeWindow = (name) => (name && !/\[1m\]$/i.test(name) && window1m(name) ? `${name}[1m]` : name);

/** 킷 모델 ID → 게이트웨이 모델 ID. 목록에 없으면 null (호출한 쪽이 알린다) */
function gatewayId(gw, tool, id) {
  if (!gw || !id || ['inherit', 'default', 'best'].includes(id)) return id;
  const fix = (name) => (tool === 'claude' ? claudeWindow(name) : name);
  const bare = String(id).replace(/\[1m\]$/i, '');
  const models = gw.models || [];
  if (!models.length || models.includes(bare)) return fix(id);
  const tail = models.find((m) => m.split('/').pop() === bare);
  if (tail) return fix(tail);
  const fam = tool === 'claude' && (bare === 'opusplan' ? 'opus' : CLAUDE_FAMILIES.find((f) => f === bare));
  if (fam) {
    if (gw.aliases) return id; // Claude Code 가 ANTHROPIC_DEFAULT_*_MODEL 로 별칭을 게이트웨이 모델로 잇는다 (opusplan 도). [1m] 은 그 값에 (doctor 가 본다)
    const ver = (m) => (claudeKey(m).match(/\d+/g) || []).map((n) => n.padStart(8, '0')).join('.');
    const hit = models.filter((m) => (claudeKey(m) || '').startsWith(`claude-${fam}-`)).sort((x, y) => (ver(y) > ver(x) ? 1 : -1))[0];
    return hit ? fix(hit) : null;
  }
  return null;
}

/**
 * 연결 방식에 맞춰 모델 값 고치기 (도구 칸마다: 그 도구로 실행한 세션 기준).
 * - 못 쓰는 회사 모델 · 섞지 않는 구성이면 위임 역할을 fallback(같은 회사 모델)로
 * - single 이면 역할 모델을 비운다 (메인과 같게)
 * - 게이트웨이: Claude Code 세션의 GPT 역할은 위임하지 않고 게이트웨이 모델 ID 로 하위 에이전트에 바로 (메인도 GPT 가능)
 *   모든 ID 를 게이트웨이 이름으로 바꾼다. Codex 세션의 Claude 역할은 그대로 위임(claude CLI 가 자기 게이트웨이 설정으로 돈다)
 */
function applyAccess(models, access, warnings = []) {
  const out = JSON.parse(JSON.stringify(models || {}));
  out.main = out.main || {}; out.roles = out.roles || {}; out.crossReview = out.crossReview || {};
  const gw = access.connection === 'gateway' ? access.gateway : null;
  const has = (t) => access.vendors.includes(t);
  const map = (tool, id, where) => {
    if (!gw || !id) return id;
    const g = gatewayId(gw, tool, id);
    if (g === null) { warnings.push(`${where}: ${id} 가 게이트웨이 모델 목록에 없습니다. kedovi ai refresh 로 목록을 다시 받거나 kedovi models 로 바꾸세요`); return id; }
    return g;
  };
  // 게이트웨이 + Claude Code 에서 GPT 메인: 프로필의 GPT 메인 모델을 Claude Code 로 돌린다
  if (gw && access.main === 'codex' && !splitModel(out.main.claude, 'claude').delegated) {
    out.main.claude = out.main.codex ? `codex:${out.main.codex}` : '';
    const e = effortOf(out.main, 'codex');
    if (e) out.main.effort = { ...(typeof out.main.effort === 'object' ? out.main.effort : {}), claude: e };
  }
  for (const T of ['claude', 'codex']) {
    const main = splitModel(out.main[T], T);
    let mainVendor = T;
    if (main.delegated) {
      if (gw && T === 'claude' && has(main.tool)) { mainVendor = main.tool; out.main[T] = map(main.tool, main.model, `메인(${T})`); }
      else { warnings.push(`메인(${T}) = ${out.main[T]}: 메인은 실행 도구 회사의 모델만 쓴다 (게이트웨이 + Claude Code 만 예외). 도구 기본으로 둡니다`); out.main[T] = ''; }
    } else out.main[T] = map(T, main.model, `메인(${T})`);
    for (const [name, m] of Object.entries(out.roles)) {
      const fb = (m.fallback || {})[T] || '';
      if (access.compose === 'single') { m[T] = ''; continue; }
      let v = m[T];
      // Claude Code 안에서 GPT 메인 + 한 회사만 → 역할도 GPT (프로필의 Codex 칸)
      if (mainVendor !== T && access.compose === 'vendor') {
        const c = splitModel(m.codex, 'codex');
        const gpt = c.delegated ? (m.fallback || {}).codex || '' : c.model;
        v = gpt ? `codex:${gpt}` : '';
        const e = effortOf(m, 'codex');
        if (e) m.effort = { ...(typeof m.effort === 'object' ? m.effort : {}), [T]: e };
      }
      // 게이트웨이가 별칭을 옛 버전으로 잇으면 대체 모델로 (그 회사를 못 쓰면 별칭 그대로, 옛 모델이 모르는 effort 는 뺀다)
      const alt = gw && (m.gatewayAlt || {})[T];
      if (alt && !splitModel(v, T).delegated && splitModel(v, T).model === alt.of) {
        const hit = gatewayId(gw, T, splitModel(v, T).model);
        const ver = hit && !gw.aliases ? (claudeKey(hit) || '').match(/-(\d+)(?:-(\d+))?$/) : null;
        const older = ver && `${ver[1]}.${ver[2] || 0}`.localeCompare(String(alt.below || ''), undefined, { numeric: true }) < 0;
        if (older && alt.tool && has(alt.tool) && access.compose === 'mix') {
          v = `${alt.tool}:${alt.model}`;
          m.effort = { ...(typeof m.effort === 'object' ? m.effort : {}), [T]: alt.effort };
          if (!alt.effort) delete m.effort[T];
        } else if (older) {
          warnings.push(`${name}(${T}): 게이트웨이의 ${hit} 는 ${alt.below} 보다 옛 버전입니다. 추론 강도 없이 씁니다 (바꾸려면 kedovi models)`);
          if (m.effort && typeof m.effort === 'object') { m.effort = { ...m.effort }; delete m.effort[T]; }
        }
      }
      const sp = splitModel(v, T);
      if (sp.delegated) {
        const ok = has(sp.tool) && (access.compose === 'mix' || sp.tool === mainVendor);
        if (!ok) {
          // 같은 회사 대체 모델로 — 추론 강도는 상대 모델에 맞춘 값이라 버리고 역할 기본값을 쓴다
          m[T] = map(T, fb, `${name}(${T})`);
          if (m.effort && typeof m.effort === 'object') { m.effort = { ...m.effort }; delete m.effort[T]; }
          continue;
        }
        // 게이트웨이 + Claude Code: 위임하지 않고 하위 에이전트 모델로 바로
        m[T] = gw && T === 'claude' ? map(sp.tool, sp.model, `${name}(${T})`) : `${sp.tool}:${map(sp.tool, sp.model, `${name}(${T})`)}`;
      } else if (mainVendor !== T && !v) m[T] = '';
      else m[T] = map(T, sp.model, `${name}(${T})`);
    }
    // 교차 검토는 상대 도구에게 — 상대 회사를 못 쓰거나 섞지 않으면 끈다
    const other = OTHER_TOOL[T];
    if (!has(other) || access.compose !== 'mix') out.crossReview[other] = '';
    else out.crossReview[other] = map(other, out.crossReview[other], `교차 검토(${other})`);
  }
  return out;
}

/** 설정된 모델 점검 — 퇴역(또는 곧 퇴역)·목록에 없는 ID. 반환 [{ where, tool, id, level, message, replacement }] */
function auditModels(root, ws, today = new Date().toISOString().slice(0, 10)) {
  const { cat } = loadCatalogFor(root, ws); // 워크스페이스 임시 목록의 모델도 아는 ID 로 본다
  if (!cat.tools) return [];
  let local = {};
  try { local = JSON.parse(read(path.join(root, LOCAL_CONFIG))).agents || {}; } catch { /* 없음 */ }
  const found = [];
  const walk = (node, where, trail) => {
    for (let [k, v] of Object.entries(node || {})) {
      if (['effort', 'profile', 'access', 'limits', 'plans', 'mode', 'enforce'].includes(k)) continue; // 모델 ID 가 아니다 (plans = 요금제 id)
      if (v && typeof v === 'object') { walk(v, where, [...trail, k]); continue; }
      if (!v || !['claude', 'codex'].includes(k)) continue;
      const sp = splitModel(v, k); // "codex:gpt-…" 는 위임 — 그 도구 목록으로 본다
      const tool = sp.tool;
      v = sp.model;
      const ret = (cat.retired || []).find((r) => r.tool === tool && new RegExp(r.match).test(v));
      const place = `${where} agents.${[...trail, k].join('.')}`;
      if (ret) {
        const past = !ret.retiresAt || ret.retiresAt <= today; // 날짜 없음 = 공지에 날짜 없이 이미 퇴역
        found.push({ where, path: [...trail, k], tool, id: v, level: past ? 'error' : 'warn', replacement: ret.replacement,
          message: `${place} = ${v}: ${ret.label} ${past ? `퇴역${ret.retiresAt ? `(${ret.retiresAt})` : ''}` : `${ret.retiresAt} 퇴역 예정`} → ${ret.replacement} 로 바꾸세요 (kedovi models --migrate)` });
        continue;
      }
      const known = (cat.tools[tool] || []).some((m) => m.id === v) || ((cat.aliases || {})[tool] || []).includes(v);
      if (!known) found.push({ where, path: [...trail, k], tool, id: v, level: 'info', message: `${place} = ${v}: 킷 모델 목록(${cat.catalogVersion || '?'})에 없는 ID 입니다. 직접 넣은 값이 맞는지 확인하세요` });
    }
  };
  walk(ws.agents, 'workspace.json', []);
  walk(local, '.agents/local.json', []);
  return found;
}

/** 역할 정의 — 쓰는 팩들의 agents/*.md (project 팩이 같은 이름으로 덮어쓸 수 있다) */
function collectRoles(packs, ws, errors) {
  const roles = new Map();
  // project 팩을 맨 뒤에: repo 스택으로 붙은 팩(loadPacks 의 뒤쪽)이 project 의 같은 이름 역할을 덮지 않게
  for (const pack of [...packs.filter((p) => p.name !== 'project'), ...packs.filter((p) => p.name === 'project')]) {
    for (const rel of listFiles(path.join(pack.dir, 'agents')).filter((f) => f.endsWith('.md'))) {
      const src = posix(path.join('packs', pack.name, 'agents', rel));
      const { meta, body } = parseFrontmatter(read(path.join(pack.dir, 'agents', rel)));
      if (!meta.name || !meta.description) { errors.push(`${src}: name·description 이 필요합니다`); continue; }
      roles.set(meta.name, { ...meta, access: meta.access || 'read-only', effort: meta.effort || 'medium', body: render(body, ws, src, errors).trim(), src });
    }
  }
  return [...roles.values()];
}

const yamlStr = (v) => JSON.stringify(String(v));
const tomlMultiline = (text) => `"""\n${String(text).replace(/\\/g, '\\\\').replace(/"""/g, '""\\"')}\n"""`;

/** 이 PC 의 역할 에이전트 상한 — 규칙(core 29-agents)이 가리킨다 */
const limitSection = (l, t = l) => [
  '## 역할 에이전트 상한: 이 PC (kedovi ai show)',
  '',
  `한 요청(사용자 메시지 하나)에 **동시 ${l.parallel}개 · 모두 ${l.total}개**까지${l.parallel !== t.parallel || l.total !== t.total ? ` (팀 ${t.parallel} · ${t.total} 보다 낮춘 이 PC 값)` : ''}. 위임 작업(delegate.js)도 동시 상한에 든다. Claude Code 는 넘으면 도구가 막는다.`,
  '',
].join('\n');

/**
 * Codex 역할 모델 표 — Codex(0.158 확인)는 .codex/agents/*.toml 역할을 하위 에이전트에 적용하지 않는다.
 * 그래서 리더가 spawn_agent 의 model · reasoning_effort 를 직접 넣고 역할 정의 파일을 지시에 붙이게 한다.
 */
/**
 * 카탈로그 = 킷 models.json + 워크스페이스 임시 목록(workspace.json catalog.tools · catalog.plans). 킷 새 버전 전에 생긴 모델 · 요금제를 팀이 먼저 쓴다.
 * 반환 { cat, warnings } — 킷에 이미 있는 항목은 "지워도 됨", 출처가 없으면 경고
 */
function loadCatalogFor(root, ws) {
  let cat = {};
  try { cat = JSON.parse(read(path.join(root, 'packs', 'core', 'models.json'))); } catch { return { cat, warnings: [] }; }
  const warnings = [];
  const extra = (ws && ws.catalog) || {};
  for (const kind of ['tools', 'plans']) {
    for (const tool of ['claude', 'codex']) {
      for (const item of ((extra[kind] || {})[tool]) || []) {
        if (!item || !item.id) continue;
        const list = (cat[kind] = cat[kind] || {})[tool] = (cat[kind][tool] || []);
        if (list.some((x) => x.id === item.id)) { warnings.push(`workspace.json catalog.${kind}.${tool} ${item.id}: 이제 킷 카탈로그에 있습니다. workspace.json 에서 지워도 됩니다`); continue; }
        if (!(item.sources || []).length) warnings.push(`workspace.json catalog.${kind}.${tool} ${item.id}: sources(공식 출처)를 적어 주세요`);
        list.push({ ...item, local: true });
      }
    }
  }
  return { cat, warnings };
}

/** 로그인 정보의 요금제 값 (공식 기능이 아닌 CLI 내부 저장값이라 못 읽으면 null). 비밀 값(토큰)은 쓰지 않고 요금제 칸만 본다 */
function loginPlanValues(home = os.homedir()) {
  const out = { claude: null, codex: null };
  try {
    const a = JSON.parse(read(path.join(home, '.claude.json'))).oauthAccount || {};
    const v = [a.organizationType, a.organizationRateLimitTier || a.userRateLimitTier, a.seatTier].filter(Boolean).join('|');
    if (v) out.claude = v;
  } catch { /* 없음 */ }
  try {
    const a = JSON.parse(read(path.join(home, '.codex', 'auth.json')));
    if (a.auth_mode && a.auth_mode !== 'chatgpt') out.codex = 'apikey';
    else {
      const part = String(((a.tokens || {}).id_token) || '').split('.')[1] || '';
      const claims = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      const plan = ((claims || {})['https://api.openai.com/auth'] || {}).chatgpt_plan_type;
      if (plan) out.codex = String(plan);
    }
  } catch { /* 없음 */ }
  return out;
}

/** 로그인 값 → 카탈로그 요금제 id. { claude: { raw, id }, codex: { raw, id } } (raw 가 있는데 id 가 null = 처음 보는 값) */
function detectPlans(cat, values = loginPlanValues()) {
  const out = {};
  for (const tool of ['claude', 'codex']) {
    const raw = values[tool];
    let id = null;
    if (raw === 'apikey') id = ((((cat.plans || {})[tool]) || []).find((p) => p.id === 'api') || {}).id || null;
    else if (raw) id = ((((cat.plans || {})[tool]) || []).find((p) => { try { return p.detect && new RegExp(p.detect).test(raw); } catch { return false; } }) || {}).id || null;
    out[tool] = { raw, id };
  }
  return out;
}

/**
 * 회사별 여유도 — 게이트웨이면 종량, 아니면 고른 요금제의 room. 요금제를 안 골랐으면 null(모름)
 * 반환 { claude: { plan, label, room }, codex: … }
 */
function vendorRooms(cat, access, plans) {
  const out = {};
  for (const tool of ['claude', 'codex']) {
    if (access.connection === 'gateway') { out[tool] = { plan: 'gateway', label: '게이트웨이', room: 'metered' }; continue; }
    const p = ((((cat.plans || {})[tool]) || []).find((x) => x.id === (plans || {})[tool])) || null;
    out[tool] = p ? { plan: p.id, label: p.label, room: p.room } : { plan: null, label: '', room: null };
  }
  return out;
}

/** 팀 구성 설정 — 모드(auto · fixed) · 요금제 · 역할별 선호 모델. 팀(workspace.json agents) ← 이 PC(.agents/local.json agents), 요금제는 회사마다. mode 가 없으면 fixed (옛 워크스페이스) */
function teamOptions(ws, local = {}) {
  const t = ws.agents || {};
  const l = local || {};
  const mode = ['auto', 'fixed'].includes(l.mode) ? l.mode : ['auto', 'fixed'].includes(t.mode) ? t.mode : 'fixed';
  const plans = { ...(t.plans || {}), ...(l.plans || {}) };
  const prefer = { ...(t.prefer || {}), ...(l.prefer || {}) };
  for (const [k, v] of Object.entries(prefer)) if (!/^(claude|codex):\S+$/.test(String(v))) delete prefer[k];
  return { mode, plans, prefer };
}

const VENDOR = { claude: 'Claude', codex: 'GPT' };
const ACCESS_LABEL = { 'read-only': '읽기', 'workspace-write': '쓰기' };
const GRADE_LABEL = { high: 'high', standard: 'standard', low: 'low' };
const ROOM_LABEL = { tight: '빠듯', ample: '넉넉', metered: '종량' };

/**
 * 팀 구성 지침 — PC 별 지침에 들어간다 (도구마다). 역할 목록(쓰는 팩의 역할 전부 · 등급 · 기본 모델)과,
 * 자동 모드면 이 PC 에서 쓸 수 있는 모델 메뉴(등급 표 · LiveBench 분야 점수 · 호출 방법)를 적는다. 리더는 team 스킬 「팀 구성」 절차로 고른다
 */
function teamSection(tool, { roles, run, access, opts, cat, profile, dele = [], rooms = {} }) {
  const pf = ((cat || {}).profiles || {})[profile] || {};
  const fmt = (m, t) => { const sp = splitModel(m, t); return sp.model ? `${sp.delegated ? `${VENDOR[sp.tool]} ` : ''}${sp.model}` : '메인과 같게'; };
  const roleRows = roles.map((r) => {
    const m = (run.roles || {})[r.name] || {};
    const d = dele.find((x) => x.role === r.name);
    const model = d ? `${VENDOR[d.tool]} ${d.model}${d.effort ? ` · ${d.effort}` : ''} (위임)` : `${fmt(m[tool], tool)}${effortOf(m, tool) || r.effort ? ` · ${effortOf(m, tool) || r.effort}` : ''}`;
    const when = String(r.description || '').split(/(?<=[.다])\s/)[0].slice(0, 70);
    return `| ${r.title || r.name} (\`${r.name}\`) | ${r.grade || '-'} | ${ACCESS_LABEL[r.access] || r.access} | ${model} | ${when} |`;
  });
  const prefer = Object.entries(opts.prefer).map(([k, v]) => `${k} = ${v}`).join(', ');
  const used = access.compose === 'single' || access.compose === 'vendor' ? [access.main === 'codex' && access.gateway ? 'codex' : tool] : access.vendors;
  const roomText = used.filter((v) => (rooms[v] || {}).room).map((v) => `${VENDOR[v]} ${rooms[v].label} (${ROOM_LABEL[rooms[v].room]})`).join(' · ');
  const head = [
    '## 팀 구성: 이 PC (kedovi team-mode)',
    '',
    `모드: **${opts.mode === 'auto' ? '자동' : '고정'}** · 성향: ${(pf.label || profile || '기본')} · 요금제: ${roomText || '모름 (kedovi ai 에서 고른다)'}${prefer ? ` · 선호: ${prefer}` : ''}`,
    '',
    opts.mode === 'auto'
      ? ['자동: 리더가 **작업마다** 역할과 모델을 고른다 (자세한 절차는 team 스킬 「팀 구성」). 아래 기본 모델은 출발점일 뿐이다. 고르는 규칙:',
        '',
        '1. 등급: high = 계약 · 스키마 · 보안 · 되돌리기 어려운 변경, 원인 분석, 단계 끝 감사 / standard = 범위가 정해진 구현 · 테스트 · 일상 리뷰 / low = 반복 실행 · 정리 · README.',
        '2. 모델은 아래 「쓸 수 있는 모델」 안에서. 그 등급의 모델(등급 칸)에서 출발해, 작업 유형 점수가 뚜렷이 높은 모델이 같은 값대면 바꾼다.',
        `3. 요금제 여유도대로 나눈다. **빠듯**한 회사 모델은 선호로 지정된 역할과, high 이면서 다른 회사로 대신할 수 없을 때만 쓰고 그 회사 최상위 모델(가장 비싼 것)은 기본으로 쓰지 않는다. 기본 모델이 빠듯한 회사여도 여유 있는 회사 모델로 바꾼다. **넉넉**한 회사에 high 작업을 먼저 준다. **종량**은 같은 품질이면 싼 모델. 요금제를 모르면 등급대로. ${prefer ? `**선호**(${prefer})는 그 역할에 우선한다. ` : ''}리뷰는 두 회사를 다 쓸 수 있으면 구현과 다른 회사 모델로.`,
        '4. 목록에 없는 역할이 필요하면 지시서에 임시 역할(목적 · 소유 파일 · 금지)을 적어 가장 가까운 역할로 띄운다.',
        '5. 시작 전에 구성표를 알린다: `| 역할 | 모델 · 강도 | 이유 |` + 근거 한 줄(카탈로그 확인일 · 점수 출처, 검색했으면 그 출처). 웹 검색으로 고른 모델이 있거나 high 가 4개 이상이면 승인 뒤 시작, 아니면 바로 시작.',
      ].join('\n')
      : '고정: 역할마다 아래 모델을 쓴다. 바꾸지 않는다 (바꾸려면 사용자가 kedovi models).',
    ...(tool === 'codex' ? ['', 'Codex 는 역할 파일을 하위 에이전트에 스스로 적용하지 않는다. `spawn_agent` 에 모델 · 추론 강도를 넣고(메인과 같게면 모델을 비운다), 지시 첫 줄에 "packs/<팩>/agents/<역할>.md 를 읽고 그 역할로만 일한다" 를 적는다.'] : []),
    '',
    '| 역할 | 등급 | 권한 | 기본 모델 | 맡기는 때 |',
    '|---|---|---|---|---|',
    ...roleRows,
  ];
  if (opts.mode !== 'auto') return [...head, '', ''].join('\n');
  // 모델 메뉴 — 연결 방식이 허용하는 회사만. 단일 모델이면 메인만
  const vendors = access.compose === 'single' ? [] : access.compose === 'vendor' ? [access.main === 'codex' && access.gateway ? 'codex' : tool] : access.vendors;
  const gw = access.connection === 'gateway' ? access.gateway : null;
  const src = (cat || {}).strengthsSource;
  const grades = (v) => Object.entries((pf.grades || {})[v] || {}).map(([g, e]) => [g, typeof e === 'string' ? { model: e } : e]);
  const menu = [];
  for (const v of vendors) {
    for (const m of ((cat || {}).tools || {})[v] || []) {
      if (!m.strengths && !m.bench) continue; // 합성 별칭(opusplan 등)은 메뉴에 넣지 않는다
      const id = gw ? gatewayId(gw, v, m.id) : m.id;
      if (!id) continue;
      const s = (m.strengths || [])[m.strengths && m.strengths.length > 1 ? 1 : 0] || null;
      const score = s ? ['코딩', '에이전트 코딩', '추론', '데이터 분석', '지시 따르기'].map((k) => (s[k] === undefined ? '-' : s[k])).join(' · ') : '-';
      const g = grades(v).filter(([, e]) => e.model === m.id).map(([k, e]) => `${GRADE_LABEL[k]}${e.effort ? `(${e.effort})` : ''}`).join(' ');
      const call = v === tool || (gw && tool === 'claude')
        ? (tool === 'claude' ? `하위 에이전트 \`model: ${id}\`` : `\`spawn_agent\` model ${id}`)
        : `\`delegate.js start --to ${v} --model ${id} --effort <강도>\``;
      menu.push(`| ${m.label || m.id} (\`${id}\`) | ${VENDOR[v]}${(rooms[v] || {}).room ? ` (${ROOM_LABEL[rooms[v].room]})` : ''} | ${g || '-'} | ${score} | ${m.hint || ''} | ${call} |`);
    }
  }
  return [...head, '',
    `### 쓸 수 있는 모델 (연결: ${gw ? '게이트웨이' : '직접'} · ${{ mix: '두 회사 섞기', vendor: '한 회사만', single: '단일 모델' }[access.compose] || access.compose})`,
    '',
    ...(menu.length ? [
      `점수: ${src ? `${src.name} ${src.release} 분야별 (코딩 · 에이전트 코딩 · 추론 · 데이터 분석 · 지시 따르기, 높을수록 좋음). 출처 ${src.source}` : '없음'}. 카탈로그 확인일 ${(cat || {}).catalogVersion || '-'}. 등급 칸 = 지금 성향에서 그 등급이 쓰는 모델.`,
      '',
      '| 모델 | 회사 | 등급 | 점수 | 특징 | 부르는 법 |',
      '|---|---|---|---|---|---|',
      ...menu,
    ] : ['단일 모델 구성: 역할은 나누되 모델은 모두 메인과 같게 둔다.']),
    '',
    '- Claude Code 하위 에이전트는 모델만 호출마다 바꿀 수 있다(추론 강도는 역할 파일 값). 강도까지 바꿔야 하면 `delegate.js start --to claude --model <m> --effort <강도>`.',
    '- 위 메뉴에 없는 모델(게이트웨이 전용 · 새 모델)은 `handoffs/MODELS.md` 를 먼저 보고, 없거나 오래됐으면 웹 검색해 그 파일에 적은 뒤 쓴다 (team 스킬).',
    '', '',
  ].join('\n');
}

/** 역할 → 도구별 에이전트 파일 (Claude Code · Codex). 모델이 사람마다 다를 수 있어 git 에 넣지 않고 각자 sync 가 만든다 */
/**
 * 이 PC 의 역할 위임 — 세션 도구마다 상대 도구 모델이 맡는 역할. 상대 CLI 가 없으면 위임하지 않고(fallback 모델) 알린다.
 * 반환 { claude: [{ role, tool, model, effort, mode }], codex: [...] }
 */
function delegations(roles, models, { cliFor = () => true, warnings = [] } = {}) {
  const out = { claude: [], codex: [] };
  for (const r of roles) {
    const m = (models.roles && models.roles[r.name]) || {};
    for (const tool of ['claude', 'codex']) {
      const sp = splitModel(m[tool], tool);
      if (!sp.delegated) continue;
      if (!cliFor(sp.tool)) {
        warnings.push(`${r.name}: ${tool} 세션에서 ${sp.tool} 로 위임하도록 정했지만 이 PC 에 ${sp.tool} 가 없어 ${(m.fallback || {})[tool] || '메인과 같은 모델'} 로 대신합니다 (설치하면 다음 sync 부터 위임)`);
        continue;
      }
      out[tool].push({ role: r.name, title: r.title || r.name, tool: sp.tool, model: sp.model, effort: effortOf(m, tool), mode: r.access === 'read-only' ? 'read' : 'write' });
    }
  }
  return out;
}

/** 역할 위임 지침 — PC 별 지침(CLAUDE.local.md · AGENTS.override.md)에 들어간다. 리더가 서브에이전트 대신 delegate.js 를 직접 부른다 */
function delegationSection(tool, rows, mode = 'fixed') {
  if (!rows.length) return '';
  const name = (t) => (t === 'codex' ? 'OpenAI Codex' : 'Claude Code');
  const waitSec = tool === 'claude' ? 100 : 50;
  return [
    '## 역할 위임: 이 PC 의 모델 설정 (kedovi models)',
    '',
    mode === 'auto'
      ? '아래 역할의 **기본값**은 상대 회사 모델이다. 그 모델을 쓸 때는 서브에이전트를 띄우지 말고 **리더가 직접** 위임 도구를 부른다. 자동 모드라 작업에 따라 위 「팀 구성」 메뉴의 다른 모델로 바꿀 수 있다 (바꾸면 구성표에 이유를 적는다).'
      : '아래 역할은 **상대 회사 모델**이 맡는다. 이 역할에게 일을 맡길 때(team 스킬 포함)는 서브에이전트를 띄우지 말고 **리더가 직접** 위임 도구를 부른다. 이 역할을 직접 하거나 같은 도구 모델로 대신하지 않는다.',
    '',
    '| 역할 | 맡는 모델 | 권한 | 시작 명령 (작업 지시서는 heredoc) |',
    '|---|---|---|---|',
    ...rows.map((d) => `| ${d.title} (\`${d.role}\`) | ${name(d.tool)} ${d.model}${d.effort ? ` · ${d.effort}` : ''} | ${d.mode === 'read' ? '읽기 전용' : '쓰기'} | \`node packs/core/bin/delegate.js start --to ${d.tool} --role ${d.role} --model ${d.model}${d.effort ? ` --effort ${d.effort}` : ''} --mode ${d.mode} <<'TASK' … TASK\` |`),
    '',
    '- **지시서는 완결되게**. 위임받은 쪽은 이 대화를 모른다. 목적 · 앞 단계 결론과 근거(`파일:라인`) · 소유 파일 · 계약 · 검증 명령 · 멈출 조건.',
    `- start 는 바로 끝나고 작업 id 를 준다. 결과는 \`node packs/core/bin/delegate.js wait <id> --timeout ${waitSec}\`. "아직 실행 중" 이면 경과 시간과 마지막 로그 한 줄이 나온다. 다시 부른다. 소유 파일이 겹치지 않으면 여러 역할을 동시에 start 할 수 있다.`,
    ...(tool === 'claude' ? ['- 오래 걸리는 위임(리뷰 5분 이상 등)은 `wait <id> --timeout 1800` 을 **백그라운드 명령**으로 실행한다. 끝나면 알림이 오므로 같은 wait 를 되풀이해 부르지 않는다. 그동안 다른 일을 하거나 사용자에게 진행 상황을 알린다.'] : []),
    '- 결과의 "이번에 바뀐 파일" 이 소유 밖이면 되돌리게 한다. 위임받은 쪽은 커밋·push 하지 않는다.',
    ...(tool === 'codex' ? ['- Codex 샌드박스는 네트워크를 막는다. delegate.js 가 막혔다고 알리면(종료 코드 4) 그 명령을 **샌드박스 밖에서 실행하도록 사용자 승인**을 요청해 다시 실행한다.'] : []),
    '- 위임이 실패하면(상대 CLI 없음 · 로그인 만료 등) 사용자에게 알리고 어떻게 할지 묻는다.',
    '',
  ].join('\n');
}

/** 역할 → 도구별 에이전트 파일 (Claude Code · Codex). 모델이 사람마다 다를 수 있어 git 에 넣지 않고 각자 sync 가 만든다. 위임 역할은 그 도구 파일을 만들지 않는다 */
function buildAgentFiles(roles, models, { cliFor = () => true, warnings = [] } = {}) {
  const files = new Map();
  const note = (r) => `${GEN_NOTE} · 출처: ${r.src} · 모델은 프로필 → workspace.json agents(팀) → .agents/local.json agents(개인, 팀보다 낮추기만). kedovi models`;
  const dele = delegations(roles, models, { cliFor, warnings });
  const delegated = (tool, name) => dele[tool].some((d) => d.role === name);
  for (const r of roles) {
    const m = (models.roles && models.roles[r.name]) || {};
    // 위임을 못 하는 PC(상대 CLI 없음)에서는 fallback 모델로
    const own = (tool) => { const sp = splitModel(m[tool], tool); return sp.delegated ? ((m.fallback || {})[tool] || '') : sp.model; };
    // Claude Code — .claude/agents/<name>.md (model: 별칭·전체 ID·inherit · effort · disallowedTools)
    if (!delegated('claude', r.name)) {
      const cl = ['---', `name: ${r.name}`, `description: ${yamlStr(r.description)}`, `model: ${own('claude') || 'inherit'}`, `effort: ${effortOf(m, 'claude') || r.effort}`];
      if (r.access === 'read-only') cl.push('disallowedTools: Write, Edit, NotebookEdit');
      cl.push('---', '', `<!-- ${note(r)} -->`, '', r.body, '');
      files.set(`.claude/agents/${r.name}.md`, cl.join('\n'));
    }
    // Codex — .codex/agents/<name>.toml (name · description · developer_instructions · model · model_reasoning_effort · sandbox_mode)
    if (!delegated('codex', r.name)) {
      const cx = [`# ${note(r)}`, `name = ${tomlValue(r.name)}`, `description = ${tomlValue(r.description)}`];
      if (own('codex')) cx.push(`model = ${tomlValue(own('codex'))}`);
      cx.push(`model_reasoning_effort = ${tomlValue(effortOf(m, 'codex') || r.effort)}`, `sandbox_mode = ${tomlValue(r.access === 'read-only' ? 'read-only' : 'workspace-write')}`);
      cx.push(`developer_instructions = ${tomlMultiline(r.body)}`, '');
      files.set(`.codex/agents/${r.name}.toml`, cx.join('\n'));
    }
  }
  return { files, delegations: dele };
}

/** 각자 PC 에서만 만드는 생성물 (에이전트 파일) — check 대상이 아니다 */
function writeLocalGenerated(root, files) {
  let prev = [];
  try { prev = JSON.parse(read(path.join(root, LOCAL_MANIFEST))).files || []; } catch { /* 처음 */ }
  for (const [rel, content] of files) {
    const abs = path.join(root, rel);
    if (sameContent(abs, content)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  for (const rel of prev) if (!files.has(rel) && exists(path.join(root, rel))) fs.unlinkSync(path.join(root, rel));
  fs.mkdirSync(path.join(root, '.agents'), { recursive: true });
  fs.writeFileSync(path.join(root, LOCAL_MANIFEST), JSON.stringify({ note: '각자 PC 에서 만드는 생성물 (git 제외)', files: [...files.keys()].sort() }, null, 2) + '\n');
  return files.size;
}

function writePersonal(root, agentsMd, extra = { claude: '', codex: '' }) {
  const head = extra.head || ''; // 응답 언어 · 대화 스타일: 다른 지침보다 앞에 둔다
  const local = path.join(root, '.agents/local.md');
  const claudeLocal = path.join(root, 'CLAUDE.local.md');
  const override = path.join(root, 'AGENTS.override.md');
  const body = exists(local) ? read(local).trim() : '';
  const generated = (f) => exists(f) && read(f).includes(GEN_NOTE);
  // Claude — CLAUDE.local.md: 개인 지침(@.agents/local.md) + 이 PC 의 역할 위임
  if (body || extra.claude || head) fs.writeFileSync(claudeLocal, `<!-- ${GEN_NOTE} -->\n${head ? `\n${head}` : ''}${body ? '\n@.agents/local.md\n' : ''}${extra.claude ? `\n${extra.claude}` : ''}`);
  else if (generated(claudeLocal)) fs.unlinkSync(claudeLocal);
  // Codex 는 같은 폴더에 AGENTS.override.md 가 있으면 AGENTS.md 대신 그것만 읽는다 — 그래서 합쳐 쓴다
  if (!body && !extra.codex && !head) { if (generated(override)) fs.unlinkSync(override); return null; }
  fs.writeFileSync(override, `<!-- ${GEN_NOTE} -->\n\n${head ? `${head}\n` : ''}${agentsMd.trim()}\n${body ? `\n## 개인 지침 (.agents/local.md — 이 PC 전용, 겹치면 이쪽이 우선)\n\n${body}\n` : ''}${extra.codex ? `\n${extra.codex}` : ''}`);
  return Buffer.byteLength(read(override));
}

/** JSON 을 키 순서와 무관하게 비교하려고 키를 정렬해 다시 쓴다 (배열 순서는 뜻이 있어 그대로). JSON 이 아니면 null */
function canonicalJson(text) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  try { return JSON.stringify(sort(JSON.parse(text))); } catch { return null; }
}

/**
 * 생성물 비교. 'same' · 'order'(JSON 키 순서만 다름: 같은 것으로 본다) · 'diff'.
 * 킷 버전마다 JSON 키 순서가 달라도 커밋이 막히지 않게 한다
 */
function compareContent(abs, content) {
  if (!exists(abs)) return 'diff';
  const cur = fs.readFileSync(abs);
  if (Buffer.isBuffer(content)) return cur.equals(content) ? 'same' : 'diff';
  const text = cur.toString('utf8');
  if (text === content) return 'same';
  if (abs.endsWith('.json')) { const a = canonicalJson(text); if (a !== null && a === canonicalJson(content)) return 'order'; }
  return 'diff';
}
function sameContent(abs, content) { return compareContent(abs, content) === 'same'; }

// ───────────────────────── 명령 ─────────────────────────

/**
 * 원격 없이 만든 repo(local)에 origin 이 생겼으면 workspace.json 의 remote 로 옮긴다 — 커밋·push 하면 팀원이 kedovi install 로 받는다.
 * 반환: 옮긴 repo 이름 목록
 */
function fillLocalRemotes(root) {
  const file = path.join(root, 'workspace.json');
  let raw;
  try { raw = JSON.parse(read(file)); } catch { return []; }
  const moved = [];
  for (const r of raw.repos || []) {
    if (!r.local || r.remote || r.path) continue;
    let url = null;
    try { url = execFileSync('git', ['-C', path.join(root, repoRel(r)), 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* 아직 없음 */ }
    if (!url) continue;
    r.remote = url;
    delete r.local;
    if (!r.host && inferHost(url)) r.host = inferHost(url);
    moved.push(r.name);
  }
  if (moved.length) fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  return moved;
}

function cmdSync(root, { quiet, soft } = {}) {
  const moved = fillLocalRemotes(root);
  if (moved.length) console.log(`✔ 원격이 생긴 repo 를 workspace.json 에 기록했습니다: ${moved.join(', ')}. workspace.json 을 commit · push 하면 팀원이 kedovi install 로 받습니다`);
  // repo 안에 원래 있던 AI 지침: 처음 받은 repo 는 기록하고, 기록과 달라졌으면 알린다
  const guidesFilled = fillGuides(root);
  const guidesNew = guidesFilled.filter((x) => !x.locked);
  const guidesHeld = guidesFilled.filter((x) => x.locked);
  if (guidesNew.length) console.log(`✔ repo 안의 AI 지침을 찾아 workspace.json 에 적었습니다: ${guidesNew.map((x) => `${x.name} ${x.guides.length}개`).join(' · ')}. 기본은 repo 지침 우선이고, 바꾸려면 kedovi repo guides <이름> kit|ignore`);
  if (guidesHeld.length && !quiet) console.log(`… repo 안의 AI 지침이 있지만 설정 수정이 잠겨 있어 기록하지 않았습니다: ${guidesHeld.map((x) => x.name).join(', ')}. 팀장이 sync 하면 기록됩니다`);
  const generated = generate(root);
  const { ws, files, errors, warnings, stats } = generated;
  for (const c of guideChanges(root, ws)) warnings.push(`repo '${c.name}' 의 AI 지침이 기록과 다릅니다${c.added.length ? ` (새로 생김: ${c.added.join(', ')})` : ''}${c.removed.length ? ` (없어짐: ${c.removed.join(', ')})` : ''}. 맞으면 kedovi repo guides --rescan ${c.name}`);
  if (errors.length) {
    errors.forEach((e) => console.error(`✖ ${e}`));
    if (soft) { console.error(`  → workspace.json 을 고친 뒤 node bin/kit.js sync`); return false; }
    die(`오류 ${errors.length}건: 생성하지 않았습니다`);
  }

  const prev = exists(path.join(root, MANIFEST)) ? JSON.parse(read(path.join(root, MANIFEST))).files : [];
  let written = 0;
  for (const [rel, content] of files) {
    const abs = path.join(root, rel);
    if (sameContent(abs, content)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    if (rel.startsWith('.githooks/')) fs.chmodSync(abs, 0o755);
    written++;
  }
  let removed = 0;
  for (const rel of prev) {
    if (files.has(rel)) continue;
    const abs = path.join(root, rel);
    if (exists(abs)) { fs.unlinkSync(abs); removed++; }
    let dir = path.dirname(abs);
    while (dir.startsWith(root) && dir !== root && isDir(dir) && fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); }
  }
  const manifest = [...files.keys()].sort();
  fs.writeFileSync(path.join(root, MANIFEST), JSON.stringify({ note: GEN_NOTE, files: manifest }, null, 2) + '\n');

  const gi = path.join(root, '.gitignore');
  const giNew = buildGitignore(exists(gi) ? read(gi) : '', ws);
  if (!exists(gi) || read(gi) !== giNew) fs.writeFileSync(gi, giNew);

  const hookSkipped = installCommitMsgHooks(root, ws);
  if (hookSkipped.length) warnings.push(`AI 서명 제거 훅을 넣지 못한 repo: ${hookSkipped.join(', ')}. 그 훅에서 node packs/core/bin/strip-ai-trailers.js "$1" 을 부르게 하세요`);
  const repoHookSkipped = installRepoHooks(root, ws);
  if (repoHookSkipped.length) warnings.push(`담당 검사 커밋 훅을 넣지 못한 repo: ${repoHookSkipped.join(', ')}. 그 repo 의 pre-commit 에서 node packs/core/bin/repo-check.js <repo 폴더> 를 부르게 하세요 (에이전트 편집은 훅이 막는다)`);
  const docsAll = installDocsHooks(root, ws);
  const docsLinked = docsAll.filter((x) => x.startsWith('링크:')).map((x) => x.slice(3));
  const docsSkipped = docsAll.filter((x) => !x.startsWith('링크:'));
  if (docsLinked.length) warnings.push(`다른 워크스페이스에서 링크로 빌려 온 기획 repo: ${docsLinked.join(', ')}. 커밋 훅은 그 워크스페이스 것을 두고, 문서 사이트(kedovi docs build)도 그 워크스페이스에서 만든다 (킷 버전이 다르면 결과가 달라 커밋이 막힌다)`);
  if (docsSkipped.length) warnings.push(`문서 사이트 검사 훅을 넣지 못한 기획 repo: ${docsSkipped.join(', ')}. 그 repo 의 pre-commit 에서 node packs/core/bin/docs-site.js hook <repo 폴더> 를 부르게 하세요`);
  // 위임 역할은 상대 CLI 가 이 PC 에 있을 때만 — 없으면 fallback 모델로 대신하고 알린다
  let cliFor = () => true;
  try { const { findCli } = require(path.join(root, 'packs', 'core', 'lib', 'cli.js')); cliFor = (t) => !!findCli(t); } catch { /* 옛 워크스페이스 */ }
  const agentWarnings = [];
  const resolved = resolveModels(root, ws);
  const built = buildAgentFiles(generated.roles, resolved.run, { cliFor, warnings: agentWarnings });
  writeLocalGenerated(root, built.files);
  warnings.push(...resolved.runWarnings, ...agentWarnings);
  const lockText = lockSection(root, ws);
  applyEditGuard(root, ws);
  const chatHead = applyChatPrefs(root, ws);
  const limitText = limitSection(resolved.limits, resolved.teamLimits);
  let localAgents = {};
  try { localAgents = JSON.parse(read(path.join(root, LOCAL_CONFIG))).agents || {}; } catch { /* 없음 */ }
  const { cat, warnings: catWarnings } = loadCatalogFor(root, ws);
  warnings.push(...catWarnings);
  const opts = teamOptions(ws, localAgents);
  const rooms = vendorRooms(cat, resolved.access, opts.plans);
  // 요금제 — 로그인 값이 처음 보는 값이거나 저장한 요금제와 다르면 알린다 (고르는 것은 사람: kedovi ai)
  if (resolved.access.connection !== 'gateway') {
    const found = detectPlans(cat);
    for (const t of resolved.access.vendors) {
      const f = found[t];
      const name = t === 'codex' ? 'ChatGPT' : 'Claude';
      if (f.raw && !f.id) warnings.push(`${name} 로그인 요금제 값 '${f.raw}' 가 카탈로그에 없습니다. kedovi ai 에서 가장 가까운 요금제를 고르세요 (고르기 전에는 빠듯으로 봅니다)`);
      else if (f.id && opts.plans[t] && f.id !== opts.plans[t]) warnings.push(`${name} 요금제가 바뀐 것 같습니다 (로그인: ${f.id} · 저장: ${opts.plans[t]}). 맞으면 kedovi ai plan ${t} ${f.id}`);
      if (f.raw && !f.id && !opts.plans[t]) rooms[t] = { plan: null, label: '처음 보는 요금제', room: 'tight' };
    }
  }
  const team = (tool) => teamSection(tool, { roles: generated.roles, run: resolved.run, access: resolved.access, opts, cat, profile: resolved.profile.local || resolved.profile.team, dele: built.delegations[tool], rooms });
  const personalBytes = writePersonal(root, files.get('AGENTS.md'), {
    head: chatHead,
    claude: limitText + team('claude') + delegationSection('claude', built.delegations.claude, opts.mode) + lockText,
    codex: limitText + team('codex') + delegationSection('codex', built.delegations.codex, opts.mode) + lockText,
  });
  warnings.forEach((w) => console.warn(`⚠ ${String(w).replace(/\n/g, '\n   ')}`));
  if (personalBytes && personalBytes > stats.limit) console.warn(`⚠ AGENTS.override.md(개인 지침 포함) ${(personalBytes / 1024).toFixed(1)}KB 가 한도를 넘어 Codex 에서 뒤가 잘립니다`);
  if (!quiet) {
    console.log(`✔ sync: 룰 ${stats.rules}(상시 ${stats.always}) · 스킬 ${stats.skills} · 훅 ${stats.hooks} · 팀 에이전트 ${generated.roles.length} · AGENTS.md ${(stats.bytes / 1024).toFixed(1)}/${(stats.limit / 1024).toFixed(0)}KB`);
    console.log(`  변경 ${written}개 · 삭제 ${removed}개${personalBytes ? ' · 개인 지침 반영' : ''}`);
  }
  return true;
}

function cmdCheck(root) {
  const { files, errors, warnings, stats } = generate(root);
  const drift = [];
  let orderOnly = 0;
  for (const [rel, content] of files) {
    const c = compareContent(path.join(root, rel), content);
    if (c === 'order') orderOnly++;
    else if (c === 'diff') drift.push(`${rel} (내용 차이)`);
  }
  const prev = exists(path.join(root, MANIFEST)) ? JSON.parse(read(path.join(root, MANIFEST))).files : [];
  for (const rel of prev) if (!files.has(rel) && exists(path.join(root, rel))) drift.push(`${rel} (정본에서 사라짐)`);

  warnings.forEach((w) => console.warn(`⚠ ${String(w).replace(/\n/g, '\n   ')}`));
  errors.forEach((e) => console.error(`✖ ${e}`));
  if (drift.length) {
    console.error(`✖ 생성물이 정본과 다릅니다 (${drift.length}개). 생성 파일을 직접 고쳤거나 sync 를 안 돌렸습니다:`);
    drift.slice(0, 20).forEach((d) => console.error(`   - ${d}`));
    if (drift.length > 20) console.error(`   … 외 ${drift.length - 20}개`);
    console.error('  → 정본(packs/ · workspace.json)을 고친 뒤 `node bin/kit.js sync`');
  }
  if (errors.length || drift.length) process.exit(1);
  if (orderOnly) console.log(`  JSON 키 순서만 다른 생성물 ${orderOnly}개는 같은 것으로 봤습니다 (다른 킷 버전이 쓴 것. sync 하면 맞춰진다)`);
  console.log(`✔ check: 생성물 ${files.size}개 일치 · AGENTS.md ${(stats.bytes / 1024).toFixed(1)}/${(stats.limit / 1024).toFixed(0)}KB`);
}

const COMMIT_MSG_MARK = '# kedovi commit-msg';
// 커밋 전 검사 — 생성물 어긋남 · 죽은 참조 · 워크스페이스 잠금(팀장이 아니면 자기 handoffs/ 밖 변경 거부)
const PRE_COMMIT_HOOK = `#!/usr/bin/env sh
# ${'생성 파일'}: node bin/kit.js sync 가 만든다. 직접 고치지 말 것
ROOT=$(git rev-parse --show-toplevel)
command -v node >/dev/null 2>&1 || exit 0

node "$ROOT/bin/kit.js" guard || exit 1

node "$ROOT/bin/kit.js" check || {
  echo ""
  echo "  [COMMIT REJECTED] 생성물이 정본과 다릅니다. 정본을 고치고 node bin/kit.js sync 후 다시 커밋하세요."
  exit 1
}

# 죽은 참조 검사 (core 팩 도구, 없으면 건너뜀)
if [ -f "$ROOT/packs/core/bin/check-refs.js" ]; then
  node "$ROOT/packs/core/bin/check-refs.js" --fail || {
    echo ""
    echo "  [COMMIT REJECTED] 죽은 참조가 있습니다. 파일을 옮겼다면: node packs/core/bin/rename-ref.js <old> <new> --apply"
    exit 1
  }
fi
`;

/** 워크스페이스 잠금 — team.lock 이 켜져 있으면 팀장(team.admins)만 설정을 바꾼다. 반환 { locked, me, admin } */
function lockState(root, ws) {
  const t = ws.team || {};
  const T = teamLib();
  const who = T.whoAmI(root, ws);
  const leads = T.roster(ws).leads;
  const locked = !!t.lock && leads.length > 0;
  // me = 핸드오프 폴더 이름 (git user.name, 예전과 같게). 팀장 판정은 저장소 계정 username 과 git user.name 을 모두 본다
  return { locked, me: who.gitName || who.username, username: who.username, nickname: who.nickname, lead: who.lead, leads, admin: !locked || who.lead };
}

/** 팀 판정 모듈 (packs/core/lib/team.js, 이 킷과 워크스페이스에 같은 것이 있다) */
function teamLib() { return require(path.join(__dirname, '..', 'packs', 'core', 'lib', 'team.js')); }

/** 잠금이어도 팀원이 커밋할 수 있는 팀 공용 기록: 로드맵 · 모델 조사 */
const TEAM_SHARED = ['handoffs/PLAN.md', 'handoffs/MODELS.md'];

/** 잠금일 때 보호하는 경로 (팀원은 자기 handoffs/<이름>/ 만 바꾼다) */
const LOCKED_PATHS = ['workspace.json', 'packs/**', 'bin/**', 'AGENTS.md', 'CLAUDE.md', '.claude/settings.json', '.claude/skills/**', '.codex/**', '.githooks/**', '.agents/rules/**', '.agents/skills/**'];

/** 비밀값 모양 (클라우드 · 깃 호스트 · AI · 메신저 키, 토큰, 개인키). 줄에 gitleaks:allow 가 있으면 넘긴다 (시험용 가짜 값 등) */
const SECRET_PATTERNS = [
  ['AWS 키', /AKIA[0-9A-Z]{16}/], ['GitHub 토큰', /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/], ['GitLab 토큰', /glpat-[A-Za-z0-9_-]{20}/],
  ['npm 토큰', /npm_[A-Za-z0-9]{30,}/], ['Anthropic 키', /sk-ant-[A-Za-z0-9_-]{16,}/], ['OpenAI 키', /sk-(proj-)?[A-Za-z0-9]{20,}/],
  ['텔레그램 봇 토큰', /[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}/], ['Slack 토큰', /xox[baprs]-[A-Za-z0-9-]{10,}/], ['개인키', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
/** 글 → [{ line, kind }] */
function secretHits(text) {
  const out = [];
  String(text).split('\n').forEach((l, i) => {
    if (l.includes('gitleaks:allow')) return;
    for (const [kind, re] of SECRET_PATTERNS) if (re.test(l)) { out.push({ line: i + 1, kind }); break; }
  });
  return out;
}

/** pre-commit: (1) 올리려는 파일에 비밀값 모양이 있으면 막는다 (handoffs 작업 기록 · workspace.json 포함, 팀장도). (2) 잠금이 켜져 있고 팀장이 아니면, 자기 handoffs/ 밖 변경은 커밋하지 못한다 */
function cmdGuard(root) {
  const ws = loadWorkspace(root);
  let staged = [];
  try { staged = execFileSync('git', ['-C', root, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean); } catch { return true; }
  const leaks = [];
  for (const f of staged) {
    let body = '';
    try { body = execFileSync('git', ['-C', root, 'show', `:${f}`], { encoding: 'utf8', maxBuffer: 4 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { continue; }   // 큰 파일 · 읽기 실패는 넘긴다
    if (body.includes('\0')) continue;   // 바이너리
    for (const h of secretHits(body)) leaks.push(`${f}:${h.line} (${h.kind})`);
  }
  if (leaks.length) {
    console.error('✖ 비밀값으로 보이는 글이 있어 커밋을 막았습니다 (값은 찍지 않음)');
    for (const l of leaks.slice(0, 10)) console.error(`  - ${l}`);
    console.error('  그 줄의 값을 *** 로 가리고 다시 git add 하세요. 시험용 가짜 값이면 그 줄 끝에 gitleaks:allow 주석을 단다');
    return false;
  }
  const st = lockState(root, ws);
  if (st.admin) return true;
  const bad = staged.filter((f) => !f.startsWith(`handoffs/${st.me}/`) && !TEAM_SHARED.includes(f)); // 팀 공용 기록: 단계를 끝낸 사람 · 모델을 조사한 사람이 고친다
  if (!bad.length) return true;
  console.error(`✖ 워크스페이스 잠금: ${st.me || '(git user.name 없음)'} 은(는) 팀장이 아니라 자기 handoffs/ 밖의 파일을 커밋할 수 없습니다`);
  for (const f of bad.slice(0, 10)) console.error(`  - ${f}`);
  console.error(`  팀장: ${st.leads.map((x) => teamLib().callName(x)).join(', ')}. 설정 변경은 팀장에게 요청하세요. 이 파일을 커밋에서 빼려면: git restore --staged <파일>`);
  return false;
}

/** 이 PC 의 Claude 편집 금지 — 잠금이고 팀장이 아니면 .claude/settings.local.json 에 보호 경로 Edit·Write 금지를 넣는다 (킷이 넣은 줄만 관리) */
function applyEditGuard(root, ws) {
  const st = lockState(root, ws);
  const file = path.join(root, '.claude', 'settings.local.json');
  const abs = `//${root.replace(/^\//, '')}`;
  // 담당 아닌 repo (팀원) — 훅(repo-guard)이 이름과 함께 막고, 이 줄은 훅이 꺼진 경우의 뒷받침
  const repoPaths = teamLib().blockedRepos(root, ws).map((n) => `${(ws.repos.find((r) => r.name === n) || {}).dir || `repos/${n}`}/**`);
  const want = [...(st.admin ? [] : LOCKED_PATHS), ...repoPaths].map((p) => `Edit(${abs}/${p})`); // Edit 경로 규칙이 쓰기 포함 모든 파일 편집 도구를 막는다
  // 킷이 넣는 줄은 형식이 정해져 있다 (예전 Write(...) 줄 포함) — 그 줄들만 지우고 새로 넣는다. 사용자가 넣은 줄은 그대로
  // repo 줄은 모양으로 지운다 (이름이 바뀌거나 빠진 repo · 옮긴 워크스페이스의 옛 줄도)
  const ours = new Set(LOCKED_PATHS.flatMap((p) => [`Edit(${abs}/${p})`, `Write(${abs}/${p})`]));
  // repo 줄은 킷이 넣은 줄을 이 PC 기록(.agents/local.json editGuard)에 두고 그 줄만 지운다 (사용자가 넣은 줄은 그대로)
  const localFile = path.join(root, LOCAL_CONFIG);
  let local = {};
  try { local = JSON.parse(read(localFile)); } catch { /* 없음 */ }
  const prevRepo = new Set(Array.isArray(local.editGuard) ? local.editGuard : []);
  const wantRepo = repoPaths.map((p) => `Edit(${abs}/${p})`);
  if (JSON.stringify([...prevRepo]) !== JSON.stringify(wantRepo) && (prevRepo.size || wantRepo.length)) {
    local.editGuard = wantRepo;
    if (!wantRepo.length) delete local.editGuard;
    fs.mkdirSync(path.dirname(localFile), { recursive: true });
    fs.writeFileSync(localFile, JSON.stringify(local, null, 2) + '\n');
  }
  let conf = {};
  try { conf = JSON.parse(read(file)); } catch { if (!want.length) return; }
  // 기록이 지워졌어도: 지금 repo 의 킷 형식 줄(Edit(//<루트>/<repo 폴더>/**))은 킷 것으로 본다
  for (const r of ws.repos) prevRepo.add(`Edit(${abs}/${r.dir}/**)`);
  const deny = ((conf.permissions || {}).deny || []).filter((x) => !ours.has(x) && !prevRepo.has(x) && !want.includes(x)); // 같은 줄이 겹치지 않게
  conf.permissions = { ...(conf.permissions || {}), deny: [...deny, ...want] };
  if (!conf.permissions.deny.length) delete conf.permissions.deny;
  if (!Object.keys(conf.permissions).length) delete conf.permissions;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (Object.keys(conf).length) fs.writeFileSync(file, JSON.stringify(conf, null, 2) + '\n'); else if (exists(file)) fs.unlinkSync(file);
}

/** 응답 언어 · 대화 스타일 모듈 (워크스페이스의 packs/core/lib/chatprefs.js). 옛 킷 워크스페이스면 null */
function chatPrefsLib(root) {
  const f = path.join(root, 'packs', 'core', 'lib', 'chatprefs.js');
  if (!exists(f)) return null;
  try { return require(f); } catch { return null; }
}

/**
 * 응답 언어 · 대화 스타일을 이 PC 에 적용한다: .claude/settings.local.json 의 language · outputStyle (킷이 넣은 kedovi-* 스타일만 관리, 사용자가 고른 다른 스타일은 그대로).
 * 반환: 개인 지침 머리 글 (없으면 '')
 */
function applyChatPrefs(root, ws) {
  const lib = chatPrefsLib(root);
  if (!lib) return '';
  const p = lib.resolve(root, ws);
  const want = lib.claudeSettings(p);
  const file = path.join(root, '.claude', 'settings.local.json');
  let conf = {};
  try { conf = JSON.parse(read(file)); } catch { /* 없음 */ }
  const next = { ...conf, language: want.language };
  if (want.outputStyle) next.outputStyle = want.outputStyle;
  else if (String(conf.outputStyle || '').startsWith(lib.OUTPUT_STYLE_PREFIX)) delete next.outputStyle;
  if (JSON.stringify(next) !== JSON.stringify(conf)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  }
  return lib.headSection(p, { codeLanguage: ((ws.vars || {}).language || {}).code });
}

/** 잠금 지침 — 팀장이 아닌 PC 의 개인 지침에 넣는다 (Codex 는 경로별 편집 금지가 없어 이 지침과 pre-commit 이 막는다) */
function lockSection(root, ws) {
  return [teamSection2(root, ws), lockOnly(root, ws)].filter(Boolean).join('\n');
}

/** 팀 · 담당 안내 — 이 PC 사용자를 nickname 으로 부르고, 담당 아닌 repo 는 고치지 않게 (team 이 있을 때만) */
function teamSection2(root, ws) {
  const T = teamLib();
  const { leads, members } = T.roster(ws);
  if (!leads.length && !members.length) return '';
  const who = T.whoAmI(root, ws);
  const name = who.nickname || who.username;
  const role = who.lead ? '팀장' : who.person ? '팀원' : '명단 밖';
  const owners = ws.repos.map((r) => [r.name, T.ownersOf(ws, r.name)]).filter(([, o]) => o.length);
  const blocked = T.blockedRepos(root, ws);
  const lines = ['## 팀과 담당', '',
    `- 이 PC 사용자: **${name}** (${who.username || 'username 모름'}, ${role}). 부를 때는 "${name}님".${who.source === 'git user.name' ? ' (저장소 계정을 아직 확인하지 못해 git user.name 으로 판정했다. kedovi team whoami)' : ''}`,
    `- 팀장: ${leads.map((p) => `${T.callName(p)}(${p.username})`).join(', ') || '없음'}. 다른 사람도 nickname 으로 부른다.`];
  if (owners.length) {
    lines.push('', '| repo | 담당 |', '|---|---|', ...owners.map(([n, o]) => `| ${n} | ${o.map((p) => T.callName(p)).join(' · ')} |`));
    lines.push('', '담당이 없는 repo 는 누구나 고친다. 팀장은 모든 repo 를 고친다.');
  }
  if (blocked.length) lines.push('', `**${blocked.join(' · ')}** 는 ${name}님 담당이 아니다. 읽기만 하고 고치거나 커밋하지 않는다 (훅이 막는다). 고칠 일이 생기면 사용자에게 담당자나 팀장에게 요청하도록 안내한다.`);
  return lines.join('\n') + '\n';
}

/** 설정 잠금 지침 — 팀장이 아닌 PC */
function lockOnly(root, ws) {
  const st = lockState(root, ws);
  if (st.admin) return '';
  return ['## 워크스페이스 잠금 (팀장이 아닌 팀원)', '',
    `이 워크스페이스는 설정이 잠겨 있다 (팀장: ${st.leads.map((x) => teamLib().callName(x)).join(', ')}). **아래 파일은 고치지 않는다.** 바꿔야 하면 사용자에게 알리고 팀장에게 요청하게 한다.`, '',
    ...LOCKED_PATHS.map((p) => `- \`${p}\``), '',
    `- 커밋할 수 있는 것은 자기 핸드오프(\`handoffs/${st.me}/\`)와 팀 공용 기록(\`handoffs/PLAN.md\` 로드맵 · \`handoffs/MODELS.md\` 모델 조사)뿐이다. 개발 repo(\`repos/*\`)의 작업은 그 repo 에서 평소대로 한다.`, ''].join('\n');
}

const COMMIT_MSG_HOOK = (script) => `#!/bin/sh
${COMMIT_MSG_MARK} — 커밋 메시지에서 AI 도구 서명 줄을 지운다. ${GEN_NOTE}
S=${script}
[ -f "$S" ] && command -v node >/dev/null 2>&1 && node "$S" "$1"
exit 0
`;

// push 를 막지 않는다 — 팀 방 알림(핸드오프·설정 변경)은 push 가 끝난 뒤 따로 보낸다
const PRE_PUSH_HOOK = `#!/bin/sh
# ${GEN_NOTE}
S="$(git rev-parse --show-toplevel)/packs/core/bin/notify.js"
[ -f "$S" ] && command -v node >/dev/null 2>&1 && node "$S" pre-push "$1"
exit 0
`;

/** repos/* 의 git 에 commit-msg 훅을 둔다 (자기 훅을 쓰는 repo 는 건드리지 않는다). 반환: 못 넣은 repo 와 이유 */
function installCommitMsgHooks(root, ws) {
  const skipped = [];
  const script = path.join(root, 'packs', 'core', 'bin', 'strip-ai-trailers.js');
  if (!exists(script)) return skipped;
  for (const r of ws.repos) {
    const dir = path.join(root, r.dir);
    if (!isDir(dir)) continue;
    const git = (...a) => { try { return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
    if (git('rev-parse', '--show-toplevel') === null) continue;
    if (git('config', 'core.hooksPath')) { skipped.push(`${r.name}(core.hooksPath 사용)`); continue; }
    const hooks = git('rev-parse', '--git-path', 'hooks');
    if (!hooks) continue;
    const file = path.resolve(dir, hooks, 'commit-msg');
    const body = COMMIT_MSG_HOOK(JSON.stringify(script));
    if (exists(file) && !read(file).includes(COMMIT_MSG_MARK)) { skipped.push(`${r.name}(commit-msg 훅이 이미 있음)`); continue; }
    if (exists(file) && read(file) === body) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }
  return skipped;
}

const DOCS_HOOK_MARK = '# kedovi docs pre-commit';
const DOCS_HOOK = (script) => `#!/bin/sh
${DOCS_HOOK_MARK}: md 와 문서 사이트(docs-site/)가 어긋나면 커밋을 막는다 (kedovi docs build 로 만든 적이 없으면 통과). ${GEN_NOTE}
S=${script}
[ -f "$S" ] && command -v node >/dev/null 2>&1 || exit 0
node "$S" hook "$(git rev-parse --show-toplevel)" || exit 1
G="$(dirname "$S")/repo-check.js"
[ ! -f "$G" ] || node "$G" "$(git rev-parse --show-toplevel)"
`;

const REPO_HOOK_MARK = '# kedovi repo pre-commit';
// 개발 repo 의 pre-commit: 담당이 아닌 사람의 커밋을 막는다 (팀 담당이 없으면 그냥 통과)
const REPO_HOOK = (script) => `#!/bin/sh
${REPO_HOOK_MARK}: 이 repo 담당이 아니면 커밋을 막는다 (workspace.json team.members[].repos). ${GEN_NOTE}
S=${script}
[ -f "$S" ] && command -v node >/dev/null 2>&1 || exit 0
node "$S" "$(git rev-parse --show-toplevel)"
`;

/** 개발 repo(기획 repo 제외)에 담당 검사 pre-commit 을 둔다. 자기 훅을 쓰는 repo 는 건드리지 않고, 담당이 정해진 repo 만 알린다 */
function installRepoHooks(root, ws) {
  const skipped = [];
  const script = path.join(root, 'packs', 'core', 'bin', 'repo-check.js');
  if (!exists(script)) return skipped;
  const T = teamLib();
  for (const r of ws.repos.filter((x) => x.kind !== 'docs')) {
    const dir = path.join(root, r.dir);
    if (!isDir(dir)) continue;
    // 로컬 폴더를 링크한 repo 도 넣는다 (검사 스크립트는 이 워크스페이스의 담당표를 본다). 다른 워크스페이스 안의 repo 를 빌려 온 것이면 그쪽 훅을 둔다
    let foreign = false;
    try {
      const real = fs.realpathSync(dir);
      if (!real.startsWith(fs.realpathSync(root) + path.sep)) for (let d = path.dirname(real); d !== path.dirname(d); d = path.dirname(d)) if (exists(path.join(d, 'workspace.json'))) { foreign = true; break; }
    } catch { /* 그대로 */ }
    if (foreign) continue;
    const owned = T.ownersOf(ws, r.name).length > 0;
    const git = (...a) => { try { return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
    if (git('rev-parse', '--show-toplevel') === null) continue;
    if (git('config', 'core.hooksPath')) { if (owned) skipped.push(`${r.name}(core.hooksPath 사용)`); continue; }
    const hooks = git('rev-parse', '--git-path', 'hooks');
    if (!hooks) continue;
    const file = path.resolve(dir, hooks, 'pre-commit');
    const body = REPO_HOOK(JSON.stringify(script));
    if (exists(file) && !read(file).includes(REPO_HOOK_MARK)) { if (owned) skipped.push(`${r.name}(pre-commit 훅이 이미 있음)`); continue; }
    if (exists(file) && read(file) === body) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }
  return skipped;
}

/** 기획 repo(kind: docs)의 git 에 pre-commit 훅을 둔다. 자기 훅을 쓰는 repo 는 건드리지 않고, 문서 사이트를 쓰는 repo 만 알린다 */
function installDocsHooks(root, ws) {
  const skipped = [];
  const script = path.join(root, 'packs', 'core', 'bin', 'docs-site.js');
  if (!exists(script)) return skipped;
  for (const r of ws.repos.filter((x) => x.kind === 'docs')) {
    const dir = path.join(root, r.dir);
    if (!isDir(dir)) continue;
    // 다른 워크스페이스의 repo 를 링크로 빌려 쓰면(이어 만들기 등) 훅은 그 주인 워크스페이스 것을 둔다. 덮으면 마지막에 sync 한 쪽 킷으로 바뀌어 주인 쪽 커밋이 막힌다
    let linked = false;
    try { linked = fs.lstatSync(dir).isSymbolicLink() || !fs.realpathSync(dir).startsWith(fs.realpathSync(root) + path.sep); } catch { /* 그대로 */ }
    if (linked) { if (['docs-site', 'html'].some((o) => exists(path.join(dir, o, 'assets', 'site.json')))) skipped.push(`링크:${r.name}`); continue; }
    const git = (...a) => { try { return execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
    if (git('rev-parse', '--show-toplevel') === null) continue;
    const uses = ['docs-site', 'html'].some((o) => exists(path.join(dir, o, 'assets', 'site.json')));
    if (git('config', 'core.hooksPath')) { if (uses) skipped.push(`${r.name}(core.hooksPath 사용)`); continue; }
    const hooks = git('rev-parse', '--git-path', 'hooks');
    if (!hooks) continue;
    const file = path.resolve(dir, hooks, 'pre-commit');
    const body = DOCS_HOOK(JSON.stringify(script));
    if (exists(file) && !read(file).includes(DOCS_HOOK_MARK)) { if (uses) skipped.push(`${r.name}(pre-commit 훅이 이미 있음)`); continue; }
    if (exists(file) && read(file) === body) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, { mode: 0o755 });
    fs.chmodSync(file, 0o755);
  }
  return skipped;
}

/**
 * repos/<이름> (그룹이 있으면 repos/<그룹>/<이름>) 을 채운다 — remote 면 git clone, path 면 링크. 이미 있으면 그대로 둔다.
 * local(원격 없이 새로 만든 repo)은 createLocal 일 때(init · repo add)만 git init 한다. 팀원 PC 에서는 기다린다 (따로 만들면 이력이 갈라진다)
 */
// clone 진행 한 줄 — 자식 node 가 git clone --progress 를 읽어 터미널(stderr)에 덮어쓰며 보여 준다. 부모는 동기로 기다린다
// argv: [라벨, ...git 인자]. 끝나면 줄을 지우고 git 오류 끝부분을 stdout 으로, 종료 코드는 git 것
const CLONE_CHILD = `
const { spawn } = require('child_process');
const [label, ...args] = process.argv.slice(1);
const t0 = Date.now(); let tail = '', last = '', size = '', drawn = 0;
const KO = { 'Receiving objects': '받는 중', 'Resolving deltas': '정리 중', 'Updating files': '파일 풀기', 'Checking out files': '파일 풀기' };
const draw = () => {
  drawn = Date.now();
  const sec = Math.round((Date.now() - t0) / 1000);
  const slow = !last && sec >= 30 ? ' (응답이 없으면 Ctrl+C 뒤 네트워크 · VPN · 주소 확인)' : '';
  process.stderr.write('\\r\\x1b[K' + label + ' ' + (last || '연결 중') + ' · ' + sec + '초' + slow);
};
const timer = setInterval(draw, 1000); draw();
const g = spawn('git', [...args.filter((a) => a !== '-q'), '--progress'], { stdio: ['ignore', 'ignore', 'pipe'] });
g.stderr.on('data', (b) => {
  const t = String(b); tail = (tail + t).slice(-4000);
  for (const l of t.split(/[\\r\\n]/)) {
    const m = l.match(/^(?:remote: )?([A-Z][a-z]+ [a-z]+):\\s+(\\d+)%[^,]*(?:,\\s*([\\d.]+ [KMG]?i?B))?(?:\\s*\\|\\s*([\\d.]+ [KMG]?i?B\\/s))?/);
    if (!m) continue;
    if (m[3]) size = m[3];
    last = (KO[m[1]] || '준비 중') + ' ' + m[2] + '%' + (m[3] ? ' · ' + m[3] : '') + (m[4] ? ' · ' + m[4] : '');
  }
  if (Date.now() - drawn > 200) draw();
});
g.on('error', (e) => { tail += e.message; });
g.on('close', (code) => {
  clearInterval(timer); process.stderr.write('\\r\\x1b[K');
  process.stdout.write(JSON.stringify({ code, tail, size, sec: Math.round((Date.now() - t0) / 1000) }));
  process.exit(code === null ? 1 : code);
});`;

/** git clone 을 한다. 터미널이면 진행(받은 양 · 속도 · 걸린 시간)을 한 줄로 보여 준다. 반환 { ok, err, size, sec } */
function gitClone(args, env, label) {
  if (!process.stderr.isTTY) {
    const t0 = Date.now();
    try { execFileSync('git', args, { stdio: ['ignore', 'ignore', 'pipe'], env }); return { ok: true, sec: Math.round((Date.now() - t0) / 1000) }; }
    catch (e) { return { ok: false, err: String(e.stderr || e.message) }; }
  }
  const r = spawnSync(process.execPath, ['-e', CLONE_CHILD, label, ...args], { stdio: ['ignore', 'pipe', 'inherit'], env, encoding: 'utf8' });
  let out = {};
  try { out = JSON.parse(r.stdout); } catch { out = { code: r.status, tail: r.stdout || String(r.error || '') }; }
  return { ok: out.code === 0, err: out.tail || '', size: out.size, sec: out.sec };
}

function installRepos(root, ws, { createLocal = false, onResult } = {}) {
  const isWin = process.platform === 'win32';
  const results = [];
  const push0 = results.push.bind(results);
  results.push = (x) => { push0(x); if (onResult) onResult(x, results.length, ws.repos.length); return results.length; };
  fs.mkdirSync(path.join(root, REPOS_DIR), { recursive: true });
  for (const r of ws.repos) {
    if (!repoSafe(r)) { results.push({ name: String(r.name), state: 'fail', note: '이름 · 그룹 · 주소가 규칙에 맞지 않아 건너뜀 (node bin/kit.js check)' }); continue; }
    const dir = path.join(root, r.dir);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (exists(dir)) { results.push({ name: r.name, state: 'ok', note: '있음' }); continue; }
    if (r.local && !r.remote && !r.path) {
      if (!createLocal) { results.push({ name: r.name, state: 'pending', note: '아직 원격 없음: 만든 사람이 origin 을 달고 push 한 뒤 workspace.json 을 push 하면 kedovi install 로 받는다' }); continue; }
      fs.mkdirSync(dir, { recursive: true });
      try { execFileSync('git', ['init', '-q', dir]); results.push({ name: r.name, state: 'created', note: '새로 만듦 (git init, 원격 없음)' }); }
      catch { results.push({ name: r.name, state: 'fail', note: 'git init 실패' }); }
      continue;
    }
    if (r.remote) {
      const cloneArgs = ['clone', '-q', ...(r.branch ? ['-b', r.branch] : []), '--', r.remote, dir];
      // 인증을 물어야 하면 기다리지 않고 바로 실패시킨다 (진행 표시 뒤에서 멈추지 않게) — 인증은 git 이 저장한 것을 쓴다
      // 받는 속도가 60초 동안 1KB/s 아래면 git 이 끊는다 (멈춘 채 기다리지 않게)
      const env = { GIT_HTTP_LOW_SPEED_LIMIT: '1000', GIT_HTTP_LOW_SPEED_TIME: '60', ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
      const c = gitClone(cloneArgs, env, `  ⬇ (${results.length + 1}/${ws.repos.length}) ${r.name}`);
      if (c.ok) results.push({ name: r.name, state: 'cloned', note: `${r.remote} (${[c.size, `${c.sec}초`].filter(Boolean).join(' · ')})` });
      else {
        const msg = c.err;
        const auth = /Authentication failed|could not read Username|terminal prompts disabled|Permission denied|403|401/i.test(msg);
        results.push({ name: r.name, state: 'fail', note: auth
          ? `인증 필요. 이 호스트의 git 인증(키체인·토큰·SSH 키)을 먼저 설정하고 kedovi install (한 번 git clone ${r.remote} 을 직접 해 보면 인증이 저장된다)`
          : `clone 실패: ${msg.trim().split('\n').pop()}` });
      }
      continue;
    }
    const target = path.resolve(root, r.path);
    if (!isDir(target)) { results.push({ name: r.name, state: 'fail', note: `${target} 가 없습니다` }); continue; }
    fs.symlinkSync(isWin ? target : path.relative(path.dirname(dir), target), dir, isWin ? 'junction' : 'dir');
    results.push({ name: r.name, state: 'linked', note: r.path });
  }
  return results;
}

function cmdInstall(root, opts = {}) {
  const ws = loadWorkspace(root);
  const icon = { ok: '✓', cloned: '⬇', linked: '↪', created: '✚', pending: '…', fail: '✖' };
  // 한 repo 씩 끝나는 대로 찍는다 (clone 이 길어도 어디까지 왔는지 보이게). opts.out 이 있으면 그쪽으로 (kedovi init 은 다른 출력을 모아 두므로)
  const out = opts.out || ((l) => console.log(l));
  const got = installRepos(root, ws, { createLocal: opts.createLocal, onResult: (x, i, n) => out(`  ${icon[x.state]} ${n > 1 ? `(${i}/${n}) ` : ''}${x.name.padEnd(14)} ${x.note}`) });
  if (opts.results) opts.results.push(...got); // kedovi init 이 끝 화면에 repo 별 상태를 다시 보인다
  if (opts.detect !== false) {
    const catalog = loadCatalog(root);
    for (const d of detectRepos(root)) console.log(`  ◎ ${d.name.padEnd(14)} 스택 감지: ${detectLine(catalog, d, loadLanguages(root))}`);
  }
  // 로드맵: 스택을 안 뒤에 만든다 (DB · 화면 스택이면 데이터 설계 · 화면설계 단계). 기본 단계 그대로면 새 스택 단계를 더한다
  const planMade = ensurePlan(root);
  if (planMade) console.log(`  ${planMade}`);
  const ok = cmdSync(root, opts); // 훅 파일(.githooks/)은 sync 가 만든다. 그 뒤에 훅 경로를 등록한다
  if (isDir(path.join(root, '.githooks'))) {
    try { execFileSync('git', ['-C', root, 'config', 'core.hooksPath', '.githooks']); console.log('  ✓ git core.hooksPath = .githooks'); }
    catch { console.warn('⚠ git 저장소가 아니라 훅 경로를 등록하지 못했습니다'); }
  }
  return ok;
}

/** pack.json "vars": { "점.경로": { "default": 값, "desc": "설명" } } 의 기본값을 workspace.json vars 에 채운다 (있는 값은 유지). */
function applyPackVarDefaults(ws, packDirs) {
  const added = [];
  ws.vars = ws.vars || {};
  for (const dir of packDirs) {
    const f = path.join(dir, 'pack.json');
    if (!exists(f)) continue;
    for (const [key, def] of Object.entries(JSON.parse(read(f)).vars || {})) {
      const value = def && typeof def === 'object' && 'default' in def ? def.default : def;
      const parts = key.split('.');
      let cur = ws.vars;
      for (const p of parts.slice(0, -1)) { if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}; cur = cur[p]; }
      const last = parts[parts.length - 1];
      if (!(last in cur)) { cur[last] = value; added.push(key); }
    }
  }
  return added;
}

function kitRoot() { return path.resolve(__dirname, '..'); }

function cmdPacks(root) {
  const base = root || kitRoot();
  const dir = path.join(base, 'packs');
  for (const name of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, name, 'pack.json');
    if (!exists(f)) continue;
    const m = JSON.parse(read(f));
    console.log(`${name.padEnd(16)} ${m.description || ''}${m.requires && m.requires.length ? `  (필요: ${m.requires.join(', ')})` : ''}`);
  }
}

const isGitUrl = (v) => /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(v) || /\.git$/.test(v);

/** --docs/--legacy 값(쉼표 목록)을 repos 항목으로. git 주소면 remote, 아니면 path(워크스페이스 기준 상대경로) */
function refsFromArg(list, kind, dst) {
  const items = String(list || '').split(',').map((x) => x.trim()).filter(Boolean);
  return items.map((v) => {
    const base = kind === 'code' || kind === 'issues' || items.length > 1 ? path.basename(v).replace(/\.git$/, '') : kind === 'docs' ? 'plan' : 'legacy';
    const entry = { name: base, kind };
    if (kind === 'docs' || kind === 'legacy') entry.role = kind === 'docs' ? '기획·요구사항 문서' : 'AS-IS 소스 (읽기 전용)';
    if (NEW_REPO.test(v)) { entry.name = v.replace(NEW_REPO, ''); entry.local = true; delete entry.role; return entry; }
    if (isGitUrl(v)) entry.remote = v; else entry.path = posix(path.relative(dst, path.resolve(v)));
    return entry;
  });
}
/** 원격 없이 새로 만들 repo — 인자 값 new:<이름> */
const NEW_REPO = /^new:/;

/** 워크스페이스를 만든다. opts = { dir, name, title, description, type, packs[], repos[] } — 화면(kedovi)과 플래그 둘 다 여기로 온다 */
/** 로드맵(handoffs/PLAN.md)이 없으면 종류 · 스택별 기본 단계로 만든다: 팩 도구를 그 워크스페이스 기준으로 돌린다. 기본 단계 그대로면 스택 단계를 더하고, 사람이 고친 것은 그대로. 결과 한 줄 (도구가 없으면 '') */
/** 그 유형의 기본 팩인데 workspace.json 에 없는 팩 (나중 버전에서 기본이 된 팩 · 일부러 뺀 팩). upgrade 가 알린다 (켜지는 않는다) */
function missingTypePacks(ws, kitDir = kitRoot()) {
  const rule = TYPE_RULES[(ws.project || {}).type];
  if (!rule) return [];
  return [rule.pack, ...(rule.defaults || [])].filter((p) => p && !(ws.packs || []).includes(p) && exists(path.join(kitDir, 'packs', p, 'pack.json')));
}

/** 로드맵을 종류 · 진행 방식에 맞춘다. sw = 진행 방식 · 유형을 바꾼 직후 (고친 로드맵에도 이슈 보드를 끼우고, 옛 기본 단계도 새 뼈대로) */
function ensurePlan(root, { sw = false } = {}) {
  const tool = path.join(root, 'packs', 'core', 'bin', 'plan.js');
  const plan = path.join(root, 'handoffs', 'PLAN.md');
  // 이미 있으면 기본 단계 그대로(kedovi:preset)일 때만 init 이 스택 단계를 더한다
  if (!exists(tool) || (!sw && exists(plan) && !read(plan).includes('<!-- kedovi:preset'))) return '';
  try { const out = execFileSync(process.execPath, [tool, 'init', ...(sw ? ['--switch'] : [])], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } }).trim(); return /이미 있음/.test(out) ? '' : out; } catch { return ''; }
}

function initWorkspace(opts) {
  const dst = path.resolve(opts.dir);
  const state = folderState(dst);
  if (state === 'workspace') die(`${dst} 는 이미 워크스페이스입니다. 킷 갱신은 upgrade 를 쓰세요`);
  if (state === 'occupied') die(`${dst} 에 다른 파일이 있습니다. 빈 폴더나, README 만 있는 막 만든 repo 에서 만드세요`);
  const kit = kitRoot();
  const available = fs.readdirSync(path.join(kit, 'packs')).filter((n) => exists(path.join(kit, 'packs', n, 'pack.json')));
  const packs = [];
  const add = (n) => {
    if (packs.includes(n)) return;
    if (!available.includes(n)) die(`팩 '${n}' 이 없습니다. 사용 가능: ${available.join(', ')}`);
    for (const r of JSON.parse(read(path.join(kit, 'packs', n, 'pack.json'))).requires || []) add(r);
    packs.push(n);
  };
  const projectName = opts.name || path.basename(dst);
  if (!PROJECT_NAME.test(projectName)) die(`프로젝트 이름 '${projectName}': ${PROJECT_NAME_RULE}`);
  const type = opts.type || 'new';
  if (!PROJECT_TYPES[type]) die(`유형은 ${Object.keys(PROJECT_TYPES).join(' | ')} 중 하나`);
  add('core');
  (opts.packs || []).forEach(add);
  if (TYPE_RULES[type].pack) add(TYPE_RULES[type].pack);
  for (const pk of TYPE_RULES[type].defaults || []) if (exists(path.join(kit, 'packs', pk, 'pack.json')) && !(opts.without || []).includes(pk)) add(pk);

  fs.mkdirSync(dst, { recursive: true });
  copyTemplate(path.join(kit, 'templates', 'workspace'), dst);
  fs.mkdirSync(path.join(dst, 'bin'), { recursive: true });
  fs.copyFileSync(path.join(kit, 'bin', 'kit.js'), path.join(dst, 'bin', 'kit.js'));
  // 팩은 전부 복사한다 — repo 스택이 나중에 바뀌어도(kedovi detect) 킷 없이 sync 가 된다. 쓰는 팩은 workspace.json 이 정한다
  for (const p of available) copyDir(path.join(kit, 'packs', p), path.join(dst, 'packs', p));

  const wsFile = path.join(dst, 'workspace.json');
  const ws = JSON.parse(read(wsFile));
  ws.project.name = projectName;
  ws.project.title = opts.title || ws.project.name;
  ws.project.type = type;
  if (opts.approach && !APPROACHES[opts.approach]) die(`진행 방식은 ${Object.keys(APPROACHES).join(' | ')} 중 하나`);
  ws.project.approach = opts.approach || TYPE_RULES[type].approach;
  if (opts.description) ws.project.description = opts.description;
  ws.repos = opts.repos || [];
  ws.packs = [...packs, 'project'];
  applyPackVarDefaults(ws, packs.map((p) => path.join(kit, 'packs', p)));
  ws.kit = { version: JSON.parse(read(path.join(kit, 'package.json'))).version, initializedAt: new Date().toISOString().slice(0, 10) };
  ws.agents = { ...(ws.agents || {}), mode: 'auto' }; // 새 워크스페이스는 자동 팀 구성 (옛 워크스페이스는 mode 가 없어 고정)
  fs.writeFileSync(wsFile, JSON.stringify(ws, null, 2) + '\n');

  if (!isDir(path.join(dst, '.git'))) {
    try { execFileSync('git', ['init', '-q', dst]); } catch { console.warn('⚠ git init 실패: 직접 해주세요'); }
  }
  const repoResults = [];
  const ok = cmdInstall(dst, { soft: true, createLocal: true, out: opts.out, results: repoResults });
  return { dir: dst, ok, type, approach: ws.project.approach, packs: ws.packs, repos: repoResults };
}

function cmdInit(args) {
  const target = args._[1];
  if (!target) die(`사용법: node bin/kit.js init <대상폴더> --type ${Object.keys(PROJECT_TYPES).join('|')} [--approach ${Object.keys(APPROACHES).join('|')}] [--packs ..] [--code ..(주소·폴더·new:<이름>)] [--docs ..] [--legacy ..]  (대화형은 kedovi init)`);
  const dst = path.resolve(target);
  const res = initWorkspace({
    dir: dst, name: args.name, title: args.title, type: args.type, approach: args.approach,
    packs: String(args.packs || '').split(',').map((x) => x.trim()).filter(Boolean),
    repos: [...refsFromArg(args.code, 'code', dst), ...refsFromArg(args.docs, 'docs', dst), ...refsFromArg(args.issues, 'issues', dst), ...refsFromArg(args.legacy, 'legacy', dst)],
  });
  console.log(`\n${res.ok ? '✔' : '⚠'} 워크스페이스 생성: ${res.dir}\n  유형: ${PROJECT_TYPES[res.type]} · 진행 방식: ${APPROACHES[res.approach]} · 팩: ${res.packs.join(', ')}`);
  console.log(res.ok ? '  다음: workspace.json 의 repos 에 코드 repo 를 추가하고 node bin/kit.js install'
    : '  위 오류를 workspace.json 에서 고친 뒤 node bin/kit.js install');
}

function cmdUpgrade(root, args) {
  if (!args.from) die('사용법: node bin/kit.js upgrade --from <킷 경로>');
  const kit = path.resolve(args.from);
  if (!exists(path.join(kit, 'bin', 'kit.js')) || !isDir(path.join(kit, 'packs'))) die(`${kit} 는 킷이 아닙니다`);
  loadWorkspace(root); // 형식 확인만 — 저장은 원본 JSON 으로 (파생 값이 workspace.json 에 새지 않게)
  const ws = JSON.parse(read(path.join(root, 'workspace.json')));
  ws.packs = ws.packs || ['core'];
  const add = args.add ? String(args.add).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const addPack = (n) => {
    if (ws.packs.includes(n)) return;
    const meta = path.join(kit, 'packs', n, 'pack.json');
    if (!exists(meta)) die(`킷에 '${n}' 팩이 없습니다`);
    for (const r of JSON.parse(read(meta)).requires || []) addPack(r);
    const at = ws.packs.indexOf('project');
    ws.packs.splice(at < 0 ? ws.packs.length : at, 0, n);
  };
  add.forEach(addPack);
  fs.copyFileSync(path.join(kit, 'bin', 'kit.js'), path.join(root, 'bin', 'kit.js'));
  const replaced = [];
  const kitPacks = fs.readdirSync(path.join(kit, 'packs')).filter((n) => exists(path.join(kit, 'packs', n, 'pack.json')));
  for (const p of kitPacks) {
    if (p === 'project') continue;
    fs.rmSync(path.join(root, 'packs', p), { recursive: true, force: true });
    copyDir(path.join(kit, 'packs', p), path.join(root, 'packs', p));
    replaced.push(p);
  }
  // 템플릿 .gitignore 의 기본 줄이 빠진 워크스페이스(npm 설치본으로 만든 0.24 이전)도 upgrade 한 번으로 맞춘다
  const giAdded = mergeGitignore(path.join(kit, 'templates', 'workspace', 'gitignore'), path.join(root, '.gitignore'));
  if (giAdded) console.log(`  .gitignore 에 템플릿 기본 줄 ${giAdded}개 추가`);
  const addedVars = applyPackVarDefaults(ws, ws.packs.filter((p) => p !== 'project').map((p) => path.join(root, 'packs', p)));
  if (addedVars.length) console.log(`  vars 기본값 추가: ${addedVars.join(', ')}`);
  const from = (ws.kit || {}).version;
  ws.kit = { ...(ws.kit || {}), version: JSON.parse(read(path.join(kit, 'package.json'))).version, upgradedAt: new Date().toISOString().slice(0, 10) };
  fs.writeFileSync(path.join(root, 'workspace.json'), JSON.stringify(ws, null, 2) + '\n');
  console.log(`✔ upgrade ${from && from !== ws.kit.version ? `${from} → ` : ''}${ws.kit.version}`);
  console.log(`  bin/kit.js · 팩 ${replaced.length}개 갱신 (project 팩은 그대로)`);
  const planMade = ensurePlan(root);
  if (planMade) console.log(`  로드맵 ${planMade.replace(/^✔ /, '')}`);
  // 방금 교체한 새 kit.js 로 sync 해야 새 생성 규칙이 적용된다 (지금 도는 건 옛 버전)
  execFileSync(process.execPath, [path.join(root, 'bin', 'kit.js'), 'sync'], { cwd: root, stdio: 'inherit' });
}

function main() {
  if (require.main !== module) return;
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'init') return cmdInit(args);
  if (cmd === 'packs') return cmdPacks(findRoot());
  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(read(__filename).split('\n').slice(2, 14).map((l) => l.replace(/^ \* ?/, '')).join('\n')); return; }
  const root = findRoot();
  if (!root) die('workspace.json 을 찾지 못했습니다. 워크스페이스 안에서 실행하거나 init 으로 만드세요');
  if (cmd === 'sync') return cmdSync(root, { quiet: args.quiet === true });
  if (cmd === 'check') return cmdCheck(root);
  if (cmd === 'guard') process.exit(cmdGuard(root) ? 0 : 1);
  if (cmd === 'install' || cmd === 'setup') return cmdInstall(root);
  if (cmd === 'detect') {
    const catalog = loadCatalog(root);
    if (args.hint !== undefined) {
      if (args.hint === true || !args.contains || args.contains === true) die(`사용법: ${HINT_HELP.replace(/ 으로.*/, '')} [--files 파일,파일]`);
      addStackHint(root, { stack: args.hint, contains: args.contains, files: args.files });
      console.log(`✓ stackHints 에 추가: ${args.hint} ← /${args.contains}/`);
    }
    const res = detectRepos(root, { force: !!args.force || args.hint !== undefined });
    if (!res.length) console.log('감지할 코드 repo 가 없습니다 (이미 스택이 정해졌으면 --force)');
    for (const d of res) console.log(`  ${d.name.padEnd(14)} ${detectLine(catalog, d, loadLanguages(root))}`);
    return cmdSync(root);
  }
  if (cmd === 'upgrade') return cmdUpgrade(root, args);
  console.log(read(__filename).split('\n').slice(2, 14).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  process.exit(cmd ? 1 : 0);
}

main();

module.exports = { scanGuides, fillGuides, guideChanges, GUIDE_MODES, isGuideMode, hintedCatalog, parseRepos, repoLanguages, labelLanguages, ruleRepos, projectRulesPinning, fillLanguages, loadLanguages, claudeKey, window1m, claudeWindow, SECRET_PATTERNS, secretHits, repoRel, repoSafe, ENFORCE_LEVELS, ENFORCE_DEFAULTS, APPROACHES, missingTypePacks, ensurePlan, roleGrades, teamOptions, teamSection, loadCatalogFor, loginPlanValues, detectPlans, vendorRooms, profileRank, profileLabel, profileNotice, countPicks, applyAccess, normalizeAccess, gatewayVendors, gatewayId, startToolOf, migrateTypes, lockState, generate, buildAgentFiles, splitModel, fillLocalRemotes, installRepos, effortOf, profileModels, fillStackPaths, setStackPaths, detectLine, addStackHint, HINT_HELP, auditModels, resolveModels, stacksLabel, stackLabel, loadLayers, LAYER_PACKS, folderState, HOSTS, inferHost, hostOf, detectRepos, loadCatalog, repoPacks, PROJECT_NAME, PROJECT_NAME_RULE, PROJECT_TYPES, TYPE_RULES, REPO_KINDS, REPOS_DIR, LOCAL_CONFIG, initWorkspace, cmdInstall, cmdSync, cmdCheck, loadWorkspace, findRoot, kitRoot, isGitUrl };
