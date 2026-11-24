// 워크스페이스 문서 사이트의 자리: 원본(docs-site/) · 생성물(.agents/site/) · 이 PC 주소 · Pages 주소 · Pages CI 틀.
// docs-site.js(kedovi docs) · kedovi start(사이트 띄우기) · kedovi remote add(CI 붙이기)가 같이 쓴다. Node 기본 모듈만.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

const SRC_DIR = 'docs-site';               // 사람 문서 원본 (워크스페이스 루트)
const OUT_DIR = path.join('.agents', 'site'); // 생성 HTML (커밋하지 않는다)
const AI_DIR = 'ai-docs';                  // AI 참고 자료 (사이트에 넣지 않는다)
const ISSUES_DIR = 'issues';
const MANIFEST = 'assets/site.json';       // 생성기가 만든 폴더 표시 (docs-site.js 와 같다)
const SERVE_STATE = path.join('.agents', 'site.serve.json');
const DOCS_TOOL = path.join(__dirname, '..', 'bin', 'docs-site.js');

/** 폴더가 사람 문서 원본인가: 있고, 생성기 표시(assets/site.json)가 없다 (옛 루트 사이트 출력 docs-site/ 와 구별) */
function isSource(dir) {
  try { return fs.statSync(dir).isDirectory() && !fs.existsSync(path.join(dir, MANIFEST)); } catch { return false; }
}

function loadWs(root) {
  try { return require('./workspace').load(root); } catch { return null; }
}

/**
 * 워크스페이스 문서 사이트 정보.
 * layout: 'workspace' = 루트 docs-site/ 가 원본, 생성물은 .agents/site/ (연결한 기획 repo 도 같은 사이트의 repos/<이름>/ 에)
 *         'repos'     = 옛 구조: 기획 repo(kind: docs)마다 <repo>/docs-site/
 *         'none'      = 문서 사이트 원본이 없다
 * 반환 { root, layout, src, out, built, index, docsRepos: [이름], serve: { url, port, pid } | null, pagesUrl }
 */
function siteInfo(root, ws = null) {
  const w = ws || loadWs(root);
  const r = path.resolve(root || (w && w.root) || process.cwd());
  const docs = ((w && w.repos) || []).filter((x) => x.kind === 'docs');
  const src = path.join(r, SRC_DIR);
  const layout = isSource(src) ? 'workspace' : docs.length ? 'repos' : 'none';
  const out = layout === 'workspace' ? path.join(r, OUT_DIR) : layout === 'repos' ? path.join(docs[0].dir, 'docs-site') : null;
  const built = !!out && fs.existsSync(path.join(out, MANIFEST));
  return {
    root: r, layout, src: layout === 'workspace' ? src : null, out, built, index: built ? path.join(out, 'index.html') : null,
    docsRepos: docs.map((x) => x.name), serve: serving(r), pagesUrl: layout === 'workspace' ? pagesUrl(r) : null,
  };
}

/** 기획 문서 원본들 [{ name, dir, kind: 'docs', site? }]: 워크스페이스 docs-site/ (있으면 먼저) + 기획 repo. ID 찾기 · 화면 · 데이터 검사가 쓴다 */
function docSources(ws) {
  const out = [];
  if (ws && ws.root && isSource(path.join(ws.root, SRC_DIR))) out.push({ name: SRC_DIR, dir: path.join(ws.root, SRC_DIR), kind: 'docs', site: true });
  for (const r of (ws && ws.repos) || []) if (r.kind === 'docs') out.push(r);
  return out;
}

// ───────── 이 PC 에서 보기 (kedovi docs serve 를 뒤에서) ─────────

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
function readServe(root) { try { return JSON.parse(fs.readFileSync(path.join(root, SERVE_STATE), 'utf8')); } catch { return null; } }
/** 지금 떠 있는 사이트 서버 { url, port, pid } | null */
function serving(root) {
  const s = readServe(root);
  return s && s.pid && s.port && alive(s.pid) ? { url: `http://localhost:${s.port}/`, port: s.port, pid: s.pid } : null;
}
/** 워크스페이스마다 같은 포트 (9100 ~ 9299, 보고 페이지 8700 대와 겹치지 않게) */
function basePort(root) {
  let h = 0;
  for (const c of String(root)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 9100 + (h % 200);
}

/**
 * 사이트 서버를 뒤에서 띄운다 (이미 떠 있으면 그것). 만든 적이 없으면 build 를 먼저 한 번.
 * 반환 { url, port, pid, started, built } | null (원본이 없을 때). wait=false 면 기다리지 않고 기본 포트 주소를 준다 (훅: 시간 제한이 짧다)
 */
function ensureServer(root, { wait = true, build = true } = {}) {
  const info = siteInfo(root);
  if (info.layout !== 'workspace') return null;
  const cur = serving(info.root);
  if (cur) return { ...cur, started: false, built: info.built };
  let built = info.built;
  if (!built && build) {
    spawnSync(process.execPath, [DOCS_TOOL, 'build'], { cwd: info.root, stdio: 'ignore', timeout: 120000 });
    built = fs.existsSync(path.join(info.out, MANIFEST));
  }
  if (!built) return null;
  const child = spawn(process.execPath, [DOCS_TOOL, 'serve', '--background'], { cwd: info.root, detached: true, stdio: 'ignore' });
  child.unref();
  if (!wait) { const port = basePort(info.root); return { url: `http://localhost:${port}/`, port, pid: child.pid, started: true, built }; }
  for (let i = 0; i < 40; i += 1) { // 최대 4초
    const s = readServe(info.root);
    if (s && s.pid === child.pid && s.port) return { url: `http://localhost:${s.port}/`, port: s.port, pid: s.pid, started: true, built };
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},100)']);
  }
  return null;
}

/** 뒤에서 도는 사이트 서버를 끈다. 껐으면 true */
function stopServer(root) {
  const s = serving(root);
  if (!s) return false;
  try { process.kill(s.pid); } catch { return false; }
  try { fs.rmSync(path.join(root, SERVE_STATE), { force: true }); } catch { /* 없음 */ }
  return true;
}

// ───────── Pages ─────────

const gitOut = (dir, args) => { try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
/** 원격 종류: 'gitlab' | 'github' | null (origin 주소로) */
function hostOf(root) {
  const url = gitOut(root, ['remote', 'get-url', 'origin']);
  if (!url) return null;
  return /github/i.test(url) ? 'github' : 'gitlab';
}
/** Pages 주소: docs-site/docs-site.json 의 pagesUrl > workspace.json project.pagesUrl (kedovi remote add 가 적는다) > GitHub 원격이면 https://<계정>.github.io/<repo>/ > 모름(null). GitLab 은 서버마다 주소 꼴이 달라 적어 둔 값만 쓴다 */
function pagesUrl(root) {
  try { const c = JSON.parse(fs.readFileSync(path.join(root, SRC_DIR, 'docs-site.json'), 'utf8')); if (c.pagesUrl) return String(c.pagesUrl); } catch { /* 없음 */ }
  try { const w = JSON.parse(fs.readFileSync(path.join(root, 'workspace.json'), 'utf8')); if (w.project && w.project.pagesUrl) return String(w.project.pagesUrl); } catch { /* 없음 */ }
  const url = gitOut(root, ['remote', 'get-url', 'origin']);
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
  if (!m) return null;
  const [owner, repo] = [m[1], m[2]];
  return repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? `https://${repo}/` : `https://${owner}.github.io/${repo}/`;
}

/** 워크스페이스용 Pages CI 틀: CI 가 워크스페이스의 킷으로 docs-site/ 를 빌드해 올린다 (생성물은 커밋하지 않는다) */
const CI_FILES = { gitlab: '.gitlab-ci.yml', github: path.join('.github', 'workflows', 'pages.yml') };
const CI_TEMPLATES = { gitlab: path.join(__dirname, '..', 'assets', 'ci', 'gitlab-pages.yml'), github: path.join(__dirname, '..', 'assets', 'ci', 'github-pages.yml') };
const CI_MARK = 'kedovi docs pages';

/**
 * Pages CI 파일을 워크스페이스에 둔다. host 를 안 주면 origin 으로 정하고, 원격이 없으면 둘 다.
 * 이미 있는 파일: 우리 표시가 있으면 새 내용으로, 남의 .gitlab-ci.yml 이면 pages 작업이 있는지만 보고 붙이는 법을 알린다 (덮지 않는다).
 * 반환 [{ host, file, status: '만듦' | '그대로' | '직접 넣기', hint? }]
 */
function installCi(root, { host = null } = {}) {
  const hosts = host ? [host] : (hostOf(root) ? [hostOf(root)] : ['gitlab', 'github']);
  const out = [];
  for (const h of hosts) {
    const f = path.join(root, CI_FILES[h]);
    let body = fs.readFileSync(CI_TEMPLATES[h], 'utf8');
    if (h === 'github') {
      const branch = gitOut(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '') || gitOut(root, ['rev-parse', '--abbrev-ref', 'HEAD']).replace(/^HEAD$/, '') || 'main';
      body = body.replace('branches: [main]', `branches: [${branch}]`);
    }
    if (fs.existsSync(f)) {
      const cur = fs.readFileSync(f, 'utf8');
      if (cur === body) { out.push({ host: h, file: CI_FILES[h], status: '그대로' }); continue; }
      if (!cur.includes(CI_MARK)) {
        const has = h === 'github' || /^pages:/m.test(cur);
        out.push({ host: h, file: CI_FILES[h], status: has ? '그대로' : '직접 넣기', hint: has ? '이미 pages 작업이 있음' : `${CI_FILES[h]} 에 packs/core/assets/ci/${path.basename(CI_TEMPLATES[h])} 의 pages 작업을 붙인다` });
        continue;
      }
    }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
    out.push({ host: h, file: CI_FILES[h], status: '만듦' });
  }
  return out;
}

/** Pages CI 상태 { host, ci: [호스트], on } (on = 원격에 맞는 우리 CI 파일이 있다) */
function ciState(root) {
  const host = hostOf(root);
  const has = (h) => { try { const t = fs.readFileSync(path.join(root, CI_FILES[h]), 'utf8'); return t.includes(CI_MARK) || (h === 'gitlab' && /^pages:/m.test(t)); } catch { return false; } };
  const ci = (host ? [host] : ['gitlab', 'github']).filter(has);
  return { host, ci, on: ci.length > 0 };
}

// ───────── AI 자료 (ai-docs/) 점검 ─────────

const DATE_RE = /\b20\d\d-\d\d-\d\d\b/;
/**
 * ai-docs/ 규칙 어긋남 (경고만): 맨 위에 둔 파일(성격별 폴더에 넣는다) · README 목록에 없는 폴더 · 머리에 한 줄 요약 · 날짜가 없는 파일.
 * 반환 [문장]
 */
function aiDocsIssues(root) {
  const dir = path.join(root, AI_DIR);
  if (!fs.existsSync(dir)) return [];
  let readme = '';
  try { readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8'); } catch { return [`${AI_DIR}/README.md 가 없습니다 (폴더마다 한 줄 목록을 둔다)`]; }
  const out = [];
  const loose = [], unlisted = [], noHead = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'README.md') continue;
    if (!e.isDirectory()) { loose.push(e.name); continue; }
    if (!new RegExp(`(^|[\\s\`(\\[|/])${e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'm').test(readme)) unlisted.push(e.name);
    (function walk(rel) {
      for (const f of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        const r = `${rel}/${f.name}`;
        if (f.name.startsWith('.')) continue;
        if (f.isDirectory()) { walk(r); continue; }
        if (!/\.md$/i.test(f.name) || /^readme\.md$/i.test(f.name)) continue;
        let head = '';
        try { head = fs.readFileSync(path.join(dir, r), 'utf8').split('\n').slice(0, 6).join('\n'); } catch { continue; }
        if (!DATE_RE.test(head)) noHead.push(r);
      }
    })(e.name);
  }
  if (loose.length) out.push(`${AI_DIR}/ 맨 위 파일 ${loose.length}개 (성격별 폴더에 넣는다): ${loose.slice(0, 5).join(' · ')}`);
  if (unlisted.length) out.push(`${AI_DIR}/README.md 목록에 없는 폴더 ${unlisted.length}개 (폴더마다 한 줄): ${unlisted.slice(0, 5).map((x) => `${x}/`).join(' · ')}`);
  if (noHead.length) out.push(`머리에 한 줄 요약 · 날짜(YYYY-MM-DD) · 관련 ID 가 없는 ${AI_DIR} 파일 ${noHead.length}개: ${noHead.slice(0, 5).join(' · ')}${noHead.length > 5 ? ' …' : ''}`);
  return out;
}

// ───────── 기능 문서 머리 줄 ─────────

const STAGES = ['명세', '설계', '구현', '검증', '배포'];
const FEATURE_DIR = '기능';
/**
 * 기능 문서 머리 줄 → { no, name, milestone, stage } | null.
 * 꼴: 제목 아래 「> 번호: 001 · 이름: 회원 관리 · 마일스톤: M1 · 단계: 명세」, 또는 맨 위 머리말(--- 안 「번호: 001」 줄)
 */
function featureMeta(text) {
  const lines = String(text).split('\n');
  const meta = {};
  const put = (k, v) => { k = k.trim(); if (k && !(k in meta)) meta[k] = String(v).trim(); };
  if (/^---\s*$/.test(lines[0] || '')) {
    for (let i = 1; i < Math.min(lines.length, 40) && !/^---\s*$/.test(lines[i]); i++) { const m = /^([^:：#]+?)\s*[:：]\s*(.*)$/.exec(lines[i]); if (m) put(m[1], m[2].replace(/^["']|["']$/g, '')); }
  }
  for (const l of lines.slice(0, 15)) {
    const m = /^\s*>\s*(.*번호\s*[:：].*)$/.exec(l);
    if (!m) continue;
    for (const part of m[1].split(/\s+·\s+/)) { const kv = /^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/.exec(part); if (kv) put(kv[1], kv[2]); }
    break;
  }
  if (!meta['번호'] && !meta['단계']) return null;
  return { no: meta['번호'] || '', name: meta['이름'] || '', milestone: meta['마일스톤'] || '', stage: meta['단계'] || '' };
}

/** 빌드 DB (assets/site-db.json): 판 2 는 lib/sitedb.js build (화면이 읽는 색인. 옛 이름으로도 부를 수 있게 남긴다) */
function siteDb(opts) { return require('./sitedb').build(opts); }

module.exports = { STAGES, FEATURE_DIR, featureMeta, siteDb, SRC_DIR, OUT_DIR, AI_DIR, ISSUES_DIR, SERVE_STATE, MANIFEST, isSource, siteInfo, docSources, serving, basePort, ensureServer, stopServer, hostOf, pagesUrl, installCi, ciState, CI_FILES, CI_TEMPLATES, CI_MARK, aiDocsIssues };
