#!/usr/bin/env node
// 문서 사이트: 기획 repo 의 md 를 같은 경로 구조의 HTML(docs-site/)로 만든다. 실행: kedovi docs <명령> 또는 node packs/core/bin/docs-site.js <명령>
/*
 * 명령
 *   build [repo|폴더] [--out docs-site] [--force] [--write-config]   만들기. --out 은 폴더 기준 상대 경로 또는 절대 경로. docs-site.json(원본 주소)은 이미 있거나 기획 repo · 워크스페이스 루트일 때만 만든다 (그 밖은 --write-config). repo 를 안 주면 workspace.json 의 기획 repo(kind: docs) 전부. 옛 출력 폴더 html/ 은 docs-site/ 로 한 번 옮긴다 (git mv)
 *   check [repo|폴더]                          md 와 docs-site/ 가 어긋났는지 (어긋나면 exit 1). 정의 없는 ID 는 ⚠ 만
 *   serve [repo|폴더] [--port 8000] [--open]     docs-site/ 를 이 PC 에서 웹 주소로 보기 (Ctrl+C 로 끝). file:// 로도 열리지만 쪽 이동이 새로고침이 되고 전체 인쇄가 안 된다
 *   pages [on|off] [repo|폴더]                 Pages 로 올리기 켜고 끄기 · 상태. on = 원격(GitLab · GitHub)에 맞는 CI 파일을 두고 docs-site/ 를 커밋 대상으로, off = .gitignore 에 /docs-site/
 *   refs-quote <md 파일…> [--dry]              본문 괄호 속 근거(파일:줄)를 그 문단 · 목록 · 표 아래 「> 근거:」 인용구로 옮긴다
 *   hook <repo 폴더>                           기획 repo 의 pre-commit 이 부른다 (kedovi docs build 로 만든 적이 없으면 아무것도 안 한다)
 *   show <ID> [--in <파일 조각>] [--all]         그 ID 의 정의 부분만 출력 (문서를 통째로 읽지 않는다). --all = 정의가 여럿이면 모두
 *   refs <ID> [--docs]                         그 ID 가 나오는 곳 (기획 · 코드 · 이슈 repo, 파일:줄). --docs = 기획 repo 만
 *   trace [--ids FN,API] [--all] [--strict] [--md] [--new]   기획 ID 와 코드의 구현 표시(@spec 주석의 ID) 대조 (머리말: --ids → vars.docs.traceIds → vars.screens.functionIds → FN,SCR,API,AC). 코드에 없는 ID(⚠) · 기획에 정의 없는 ID(✖, 오타 · 지운 기능) · 테스트에 없는 수용 기준(AC-).
 *                                              --md = 추적표(ID · 정의 · 코드 · 테스트) · --new = 새로 만들거나 고친 진입 파일 중 기획 ID 가 없는 것
 *                                              --strict = ✖(또는 --new 의 ⚠)이 있으면 exit 1
 * build · check 는 문서 점검 경고도 낸다: 큰 문서(vars.docs.maxKB) · 문장형 제목 · 긴 코드 블록(vars.docs.codeMax) · 파일:줄 참조 · 머리말에 쌓인 변경 이력 · 여러 문서에 같은 문장 ·
 *   긴 표 칸(vars.docs.cellMax) · 문단형 표(vars.docs.cellAvg) · 표 칸 안 경위 · 그림 없는 큰 문서(vars.docs.figureKB) · ASCII 그림 · 메뉴 「기타」 문서 ·
 *   오래된 환경 사실(「확인일」 칸이 vars.docs.factDays 일 넘음) · 확인일 없는 환경 사실 (「상태: 동결」 문서는 뺀다)
 * 기획 repo 의 docs-site.json (선택): { title, logo, version, source, ink: false(펜 필기 끔), printAll: { autoPrint: false }(전체 인쇄 쪽이 인쇄 창을 열지 않음), groups: [{ group, icon, files: [glob], split: true|[glob], collapsed, tree }], labels: { 'md 경로': '메뉴 이름' }, include: [glob], exclude: [glob], repos: { … } }. 메뉴 묶음 · 상단 바 · 원본 버튼 · 포함 범위.
 *   groups[].files 는 나열한 순서대로 메뉴에 나온다 (glob 하나에 맞는 여러 문서는 파일 이름 순). 어느 묶음에도 안 맞는 문서는 「기타」 로 가고 경고한다.
 *   collapsed: 처음엔 접힌 묶음 · tree: 묶음 안을 폴더 트리로. 메뉴는 쪽마다 넣지 않고 assets/nav.js 하나 (site.js 가 그린다).
 *   repo 맨 위에 docs-site.extra.css · docs-site.extra.js 를 두면 assets/site.css · site.js 끝에 붙인다 (이 repo 만의 모양 · 동작).
 *   출력 경로가 대소문자만 다르면(README.md · INDEX.md 가 한 폴더) 쓰지 않고 ✖. 문서 점검 경고는 사이트에 넣는 문서만 본다.
 *   source 가 없으면 build 가 origin 으로 한 번 채워 둔다 (--no-source 로 끔).
 *   워크스페이스 루트를 만들면 repos/<이름>/ (그룹이면 repos/<그룹>/<이름>/) 는 repo 마다 copy(사본) · link(그 repo 사이트로 가는 쪽 하나만) · off(뺌).
 *   기본 = 종류별(legacy off · 그 밖 copy), docs-site.json repos 에 종류(legacy · docs · code) 또는 이름으로 바꾼다: "repos": { "docs": "link", "news-picker": { "mode": "off" }, "trader-jo-plans": { "mode": "link", "url": "https://…" } }.
 *   원본 버튼은 그 repo 의 원격(workspace.json repos[].url, 없으면 그 repo 의 origin) + 기본 브랜치 + repo 안 경로. 원격이 없으면 버튼을 숨긴다.
 * docs-site/assets/site.json 이 이 도구로 만든 표시다. 그 표시가 없는데 docs-site/ 에 파일이 있으면 다른 생성기의 것이라 덮지 않는다 (--force 로 덮는다).
 * 화면설계서 장(class="sheet" 가 있는 .html)은 그대로 옮기고 뷰어(storyboard.css · js)를 docs-site/assets/storyboard/ 로 복사한다.
 * 기능 문서에 「### 저장」 표가 있으면 「저장 데이터」 묶음(write-data/)을 만든다: 기능마다 저장 표 + 쓰기 보고서 예시 행 + 보고서 화면 사본(write-report/<repo>/) 링크. 보고서는 build 때만 코드 repo 에서 새로 읽는다 (docs-site.json "writeReport": false 로 끈다).
 * 데이터 설계 정의서(「### 스키마.테이블」 + 컬럼 표)가 든 폴더마다 ERD 뷰어 <폴더>/erd.html 을 만들고 뷰어(datamodel 팩)를 docs-site/assets/erd/ 로 복사한다 (datamodel 팩이 있을 때).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { build, globRe, wanted } = require('../lib/mdsite');
const DR = require('../lib/docsref');
const MC = require('../lib/mermaid-check');
const WRL = require('../lib/writes');

const PACKS = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const has = (k) => argv.includes(`--${k}`);
const MANIFEST = 'assets/site.json';
const OUT = 'docs-site';   // 출력 폴더 (0.59.0 전에는 html/)
const OLD_OUT = 'html';
/** 이 repo 의 출력 폴더: 아직 옛 html/ 만 있으면 그것 (check · hook 은 옮기지 않고 그대로 본다) */
const outOf = (dir) => outArg(dir) || (!fs.existsSync(path.join(dir, OUT, MANIFEST)) && fs.existsSync(path.join(dir, OLD_OUT, MANIFEST)) ? OLD_OUT : OUT);
const SKIP = new Set(['.git', 'node_modules']);
/**
 * --out 값 → 대상 폴더 기준 상대 경로 (안이면) 또는 절대 경로 (밖이면). 절대 경로는 그대로 쓴다 (대상 폴더 안으로 이어 붙이지 않는다).
 * 표시(outLabel)는 안이면 「repo/폴더/」, 밖이면 절대 경로
 */
function outArg(dir) {
  const o = opt('out');
  if (!o) return null;
  const abs = path.resolve(dir, o);
  const rel = path.relative(dir, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : abs;
}
const outLabel = (t, out) => (path.isAbsolute(out) ? out : `${t.name}/${out}`);

function loadWs() {
  // 이 도구가 놓인 워크스페이스 (기획 repo 의 pre-commit 처럼 다른 폴더에서 불려도 같은 변수를 쓴다)
  try { return require('../lib/workspace').load(path.resolve(PACKS, '..')); } catch { return null; }
}

/** 대상 repo 폴더들. 인자가 폴더면 그 폴더, 이름이면 그 repo, 없으면 기획 repo 전부 */
function targets(ws, arg) {
  const repos = ws ? ws.repos : [];
  if (arg && fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
    // 워크스페이스의 repo 폴더면 그 이름으로 (안내 명령에 쓴다)
    const real = (x) => { try { return fs.realpathSync(x); } catch { return path.resolve(x); } };
    const r = repos.find((x) => real(x.dir) === real(arg));
    return [{ name: r ? r.name : path.basename(path.resolve(arg)), dir: path.resolve(arg), kind: r ? r.kind : undefined }];
  }
  if (arg) {
    const r = repos.find((x) => x.name === arg);
    if (!r) throw new Error(`repo '${arg}' 가 없습니다 (workspace.json repos 이름 또는 폴더 경로)`);
    return [r];
  }
  const docs = repos.filter((r) => r.kind === 'docs');
  if (!docs.length) throw new Error('기획 repo(kind: docs)가 없습니다. kedovi docs build <repo 이름|폴더>');
  return docs;
}

/** SVG 를 사이트에 넣으면 안 되는가: 문자 참조(&#106; · &lt;)를 풀고 주소 안 탭 · 줄바꿈을 지운 뒤 스크립트 · on… 속성 · javascript: · iframe(srcdoc) · 끼워 넣기 · 사용자 엔티티 · XSLT 를 찾는다 */
function svgUnsafe(text) {
  const t = String(text).replace(/&#x([0-9a-f]+);?|&#(\d+);?/gi, (m, h, d) => { try { return String.fromCodePoint(h ? parseInt(h, 16) : Number(d)); } catch { return ''; } })
    .replace(/&(lt|gt|quot|apos|amp);/gi, (m, n) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[n.toLowerCase()])).replace(/[\t\n\r]/g, ' ');
  return /<(?:[\w-]+:)?script|\son[a-z]+\s*=|j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:|<(?:[\w-]+:)?(?:iframe|embed|object|foreignObject|handler)\b|srcdoc|<!ENTITY|xml-stylesheet/i.test(t);
}

function readTree(dir, out, keep = () => true) {
  const files = {};
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && r !== out && keep(r, true)) walk(r); continue; }
      if (!keep(r, false)) continue;
      if (/\.md$/i.test(e.name)) files[r] = fs.readFileSync(path.join(dir, r), 'utf8');
      else if (/\.html?$/i.test(e.name)) files[r] = fs.readFileSync(path.join(dir, r), 'utf8');
      else if (/\.svg$/i.test(e.name)) {   /* SVG 는 주소로 직접 열면 안의 스크립트가 사이트에서 돈다: 스크립트 · on… 속성 · javascript: 가 있으면 넣지 않는다 */
        const buf = fs.readFileSync(path.join(dir, r));
        if (svgUnsafe(buf.toString('utf8'))) console.warn(`⚠ ${r}: SVG 안에 스크립트 · on… 속성 · 끼워 넣은 문서가 있어 사이트에 넣지 않았습니다`);
        else files[r] = buf;
      } else if (/\.(png|jpe?g|gif|webp)$/i.test(e.name)) files[r] = fs.readFileSync(path.join(dir, r));
    }
  })('');
  return files;
}

/** 화면 틀 파일: site.css · site.js(앱: assets/docs-site/src/*.js 를 이름 순으로 이음) · vendor.js(외부 라이브러리: vendor/index.json 순서) · 라이선스.
 *  프로젝트별 덧붙임: 기획 repo 맨 위의 docs-site.extra.css · docs-site.extra.js 가 있으면 assets/site.css · site.js 끝에 붙인다 (check · pre-commit 도 붙인 결과로 비교) */
const EXTRA = { 'assets/site.css': 'docs-site.extra.css', 'assets/site.js': 'docs-site.extra.js' };
const SITE_DIR = path.join(PACKS, 'core', 'assets', 'docs-site');
const SHARED_DIR = path.join(SITE_DIR, 'shared');   // 문서 사이트 · ERD 가 같이 쓰는 화면 부품 (사이드바 머리 줄)
/** 원본 폴더의 *.js 를 이름 순으로 이은 파일 하나 (문서 사이트 앱 · ERD · 화면설계서 뷰어) */
function concatSrc(src, where, shared) {
  const part = (dir) => fs.readdirSync(dir).filter((f) => /\.js$/.test(f)).sort().map((f) => `/* ── ${f} ── */\n${fs.readFileSync(path.join(dir, f), 'utf8').replace(/\s*$/, '')}`);
  return Buffer.from([`/* 생성물: kedovi docs build. 원본은 킷의 ${where}${shared ? ' (+ 공통 부품 packs/core/assets/docs-site/shared/)' : ''} (손으로 고치지 않는다) */`,
    ...(shared ? part(SHARED_DIR) : []), ...part(src)].join('\n') + '\n');
}
function siteAssets(dir) {
  const a = {};
  a['assets/site.css'] = fs.readFileSync(path.join(SITE_DIR, 'site.css'));
  a['assets/site.js'] = concatSrc(path.join(SITE_DIR, 'src'), 'packs/core/assets/docs-site/src/', true);
  const vd = path.join(SITE_DIR, 'vendor');
  const ix = JSON.parse(fs.readFileSync(path.join(vd, 'index.json'), 'utf8'));
  a['assets/vendor.js'] = Buffer.from(`/* 생성물: kedovi docs build. 외부 라이브러리 (라이선스: vendor-LICENSES.txt) ${ix.packages.map((p) => `${p.name}@${p.version}`).join(' · ')} */\n${ix.files.map((f) => fs.readFileSync(path.join(vd, f), 'utf8')).join('')}`);
  a['assets/vendor-LICENSES.txt'] = Buffer.from(ix.packages.map((p) => `== ${p.name} ${p.version} (${p.license}) ${p.home}\n\n${fs.readFileSync(path.join(vd, `${p.name}-LICENSE.txt`), 'utf8').trim()}\n`).join('\n'));
  for (const [to, name] of Object.entries(EXTRA)) {
    const f = dir && path.join(dir, name);
    if (!f || !a[to] || !fs.existsSync(f)) continue;
    a[to] = Buffer.concat([a[to], Buffer.from(`\n/* ${name} (이 repo 덧붙임) */\n`), fs.readFileSync(f)]);
  }
  return a;
}
/** 뷰어(ERD · 화면설계서)가 같이 쓰는 화면 라이브러리: assets/vendor.js · 라이선스 */
function siteVendor() {
  const a = siteAssets(null);
  return { 'assets/vendor.js': a['assets/vendor.js'], 'assets/vendor-LICENSES.txt': a['assets/vendor-LICENSES.txt'] };
}
/** 화면 틀 + 화면설계서 뷰어 */
function assets(dir) {
  const a = siteAssets(dir);
  const add = (from, to) => { if (fs.existsSync(from)) a[to] = fs.readFileSync(from); };
  const sb = path.join(PACKS, 'screens', 'assets', 'storyboard');
  add(path.join(sb, 'storyboard.css'), 'assets/storyboard/storyboard.css');
  // storyboard.js = src/*.js 를 이름 순으로 이은 뷰어 (화면 라이브러리는 assets/vendor.js, 장 쪽에 생성기가 함께 넣는다)
  if (fs.existsSync(path.join(sb, 'src'))) a['assets/storyboard/storyboard.js'] = concatSrc(path.join(sb, 'src'), 'packs/screens/assets/storyboard/src/');
  return a;
}

/** mermaid 그림: 킷에 넣은 파일(버전 고정 · 오프라인). 그림이 있는 사이트에만 docs-site/assets/mermaid/ 로 간다 */
function mermaidAssets() {
  const dir = path.join(PACKS, 'core', 'assets', 'mermaid');
  const a = {};
  for (const f of ['mermaid.min.js', 'mermaid-LICENSE.txt']) if (fs.existsSync(path.join(dir, f))) a[`assets/mermaid/${f}`] = fs.readFileSync(path.join(dir, f));
  return a;
}

/** 사이트 제목: repo README 의 첫 제목 > 워크스페이스 제목 > repo 이름 */
/** ERD 뷰어: datamodel 팩이 있으면 틀 · 파일 · 프로젝트 컨벤션(DB 종류 · 외래키를 DB 에 거는지) */
const ERD_FILES = ['erd.css', 'erd.js', 'ddl.js', 'elk.bundled.js', 'elkjs-LICENSE.txt'];
/** 화면설계서 색 프리셋 (vars.screens.theme, storyboard.css 의 [data-theme]). 기본 indigo 는 속성을 달지 않는다 */
const SHEET_THEMES = ['indigo', 'blue', 'teal', 'orange', 'rose'];
function sheetTheme(ws) {
  const t = String((ws && ws.vars && ws.vars.screens && ws.vars.screens.theme) || '').trim().toLowerCase();
  if (!t || t === 'indigo') return null;
  if (!SHEET_THEMES.includes(t)) { console.error(`⚠ vars.screens.theme "${t}" 는 없는 색입니다 (${SHEET_THEMES.join(' · ')}). 기본 indigo 로 만듭니다`); return null; }
  return t;
}

function erdOpts(ws) {
  const dir = path.join(PACKS, 'datamodel', 'assets', 'erd');
  if (!fs.existsSync(path.join(dir, 'viewer.html'))) return null;
  const v = (ws && ws.vars && ws.vars.datamodel) || {};
  const conv = { dialect: String(v.dialect || '').trim() };
  if (/^(n|no|false|아니오|없음)$/i.test(String(v.fkInDb || '').trim())) conv.fkInDb = false;
  // ERD 에서 선을 숨길 표: 목록(쉼표 · 배열) · 들어오는 관계가 이 수 이상이면 허브로 본다 (기본 10)
  const list = (x) => (Array.isArray(x) ? x : String(x || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  conv.hideEdgesTo = list(v.erdHideEdgesTo);
  const hub = Number(v.erdHubMin);
  if (Number.isInteger(hub) && hub > 0) conv.hubMin = hub;
  // erd.js = src/*.js 를 이름 순으로 이은 앱 (화면 라이브러리는 문서 사이트와 같은 assets/vendor.js)
  const app = concatSrc(path.join(dir, 'src'), 'packs/datamodel/assets/erd/src/', true);
  return { shell: fs.readFileSync(path.join(dir, 'viewer.html'), 'utf8'), conv, assets: { ...Object.fromEntries(ERD_FILES.filter((f) => f !== 'erd.js').map((f) => [`assets/erd/${f}`, fs.readFileSync(path.join(dir, f))])), 'assets/erd/erd.js': app, ...siteVendor() } };
}

function titleOf(dir, ws, name) {
  try {
    const m = /^#\s+(.+)$/m.exec(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'));
    if (m && !/[<>]/.test(m[1])) return m[1].trim();
  } catch { /* README 없음 */ }
  return (ws && ws.project && ws.project.title) || name;
}

function prefixesOf(ws) {
  const v = ws && ws.vars && ws.vars.docs && ws.vars.docs.ids;
  return String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
}

const CONFIG = 'docs-site.json';
/** docs-site.json 을 알아서 만들어도 되는 곳: 파일이 이미 있거나, 기획 repo(kind: docs)거나, 워크스페이스 루트 */
function configHome(t) {
  if (fs.existsSync(path.join(t.dir, CONFIG)) || t.kind === 'docs') return true;
  const real = (x) => { try { return fs.realpathSync(x); } catch { return path.resolve(x); } };
  return real(t.dir) === real(path.resolve(PACKS, '..')) && fs.existsSync(path.join(t.dir, 'workspace.json'));
}

/** git 이 무시하는 폴더면 한 줄 (만든 파일 · 정의서가 조용히 커밋에서 빠진다). git repo 가 아니면 조용히 */
function ignoredLines(t, dirs) {
  const out = [];
  for (const d of new Set(dirs)) {
    const abs = path.resolve(t.dir, d);
    const rel = path.relative(t.dir, abs).split(path.sep).join('/');
    if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(abs)) continue;
    const r = require('child_process').spawnSync('git', ['-C', t.dir, 'check-ignore', '-q', '--', `${abs}/`], { stdio: 'ignore' });
    if (r.status === 0) out.push(`⚠ ${rel ? `${t.name}/${rel}` : t.name}/ 는 git 이 무시하는 폴더라 정의서가 커밋되지 않습니다 (어느 줄인지: git -C ${t.dir} check-ignore -v ${abs}/)`);
  }
  return out;
}
function readConfig(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, CONFIG), 'utf8')); } catch (e) {
    if (fs.existsSync(path.join(dir, CONFIG))) throw new Error(`${CONFIG} 를 읽지 못했습니다: ${e.message}`);
    return {};
  }
}

const gitOut = (dir, args) => { try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

/** git 원격 주소 → 웹 주소 (https://호스트/경로). 인증 정보는 버린다. 모르는 꼴이면 null */
function webOf(url) {
  if (!url) return null;
  let m = /^(?:ssh:\/\/)?[^@\s]+@([^:/\s]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(url);
  let web = m ? `https://${m[1]}/${m[2]}` : null;
  if (!web && /^https?:\/\//.test(url)) web = url.replace(/\/\/[^@/]+@/, '//').replace(/\.git\/?$/, '').replace(/\/$/, '');
  return web || null;
}

/** origin(또는 주어진 원격) 주소 → 원본 보기 주소 (https://호스트/경로/-/blob/<기본 브랜치>). 모르는 꼴이면 null */
function sourceOf(dir, remote) {
  const web = webOf(remote || gitOut(dir, ['remote', 'get-url', 'origin']));
  if (!web) return null;
  const branch = (gitOut(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '')) || gitOut(dir, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  return `${web}${/github\.com/i.test(web) ? '' : '/-'}/blob/${branch}`;
}

/** Pages: 원격 종류 · CI 파일 · 켜짐 여부. 켜짐 = 원격에 맞는 CI 파일이 있고 docs-site/ 를 .gitignore 로 빼지 않음 */
const CI = { gitlab: '.gitlab-ci.yml', github: path.join('.github', 'workflows', 'pages.yml') };
const CI_SRC = { gitlab: 'gitlab-ci.yml', github: 'github-pages.yml' };
const CI_MARK = 'kedovi docs pages';
function hostOfRemote(dir) {
  const url = gitOut(dir, ['remote', 'get-url', 'origin']);
  if (!url) return null;
  return /github/i.test(url) ? 'github' : 'gitlab';
}
const ciHasPages = (dir, h) => { try { const t = fs.readFileSync(path.join(dir, CI[h]), 'utf8'); return h === 'github' || /^pages:/m.test(t); } catch { return false; } };
const ignored = (dir) => spawnOk(dir, ['check-ignore', '-q', '--no-index', `${OUT}/${MANIFEST}`]);
function spawnOk(dir, args) { try { execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' }); return true; } catch { return false; } }
function pagesState(dir) {
  const host = hostOfRemote(dir);
  const hosts = host ? [host] : ['gitlab', 'github'];
  const ci = hosts.filter((h) => ciHasPages(dir, h));
  const on = ci.length > 0 && !ignored(dir);
  return { host, ci, on };
}
const HOST_NAME = { gitlab: 'GitLab', github: 'GitHub' };
/** build 끝의 Pages 한 줄 */
function pagesHint(dir, out) {
  const st = pagesState(dir);
  if (!st.host) return `Pages: 원격이 없습니다. 이 PC 에서 보기: kedovi docs serve`;
  if (st.on) return `Pages 켜짐 (${HOST_NAME[st.host]}): ${out}/ 를 커밋 · push 하면 ${CI[st.host]} 가 올린다. 끄기: kedovi docs pages off`;
  return `Pages 꺼짐 (${HOST_NAME[st.host]}): ${out}/ 는 이 PC 에서만 본다. 올리려면: kedovi docs pages on`;
}

/** 기본 브랜치 (origin HEAD, 없으면 지금 브랜치, 그것도 없으면 main) */
const defaultBranch = (dir) => gitOut(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '') || gitOut(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).replace(/^HEAD$/, '') || 'main';

/** .gitignore 에 /docs-site/ 줄을 넣거나 뺀다. 바꿨으면 true */
function setIgnore(dir, on) {
  const f = path.join(dir, '.gitignore');
  const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const re = new RegExp(`^/?${OUT}/?\\s*$`, 'm');
  if (on === re.test(text)) return false;
  if (on) fs.writeFileSync(f, `${text}${text && !text.endsWith('\n') ? '\n' : ''}# kedovi docs pages off: 문서 사이트는 이 PC 에서만 본다 (올리려면 kedovi docs pages on)\n/${OUT}/\n`);
  else fs.writeFileSync(f, text.replace(/^# kedovi docs pages off:.*\n/m, '').replace(new RegExp(`^/?${OUT}/?\\s*\\n?`, 'm'), ''));
  return true;
}

/** CI 파일 하나를 둔다. 이미 있으면: 우리 것이면 새 내용으로, 남의 .gitlab-ci.yml 이면 pages 작업이 있는지만 본다 */
function putCi(dir, h) {
  const f = path.join(dir, CI[h]);
  let body = fs.readFileSync(path.join(PACKS, 'core', 'assets', 'pages', CI_SRC[h]), 'utf8');
  if (h === 'github') body = body.replace('branches: [main]', `branches: [${defaultBranch(dir)}]`);
  if (fs.existsSync(f)) {
    const cur = fs.readFileSync(f, 'utf8');
    if (cur === body) return '그대로';
    if (!cur.includes(CI_MARK) && !/kedovi docs build/.test(cur)) {
      if (ciHasPages(dir, h)) return '그대로 (이미 pages 작업이 있음)';
      return `직접 넣기: 이 repo 의 ${CI[h]} 에 packs/core/assets/pages/${CI_SRC[h]} 의 pages 작업을 붙인다`;
    }
  }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return '만듦';
}

/** kedovi docs pages [on|off] [repo|폴더] */
function cmdPages(ws) {
  const mode = ['on', 'off'].includes(argv[1]) ? argv[1] : null;
  const arg = mode ? argv[2] : argv[1];
  for (const t of targets(ws, arg && !arg.startsWith('--') ? arg : null)) {
    migrate(t);
    if (!mode) {
      const st = pagesState(t.dir);
      console.log(`${st.on ? '●' : '○'} ${t.name}: Pages ${st.on ? '켜짐' : '꺼짐'} · 원격 ${st.host ? HOST_NAME[st.host] : '없음'}${st.ci.length ? ` · CI ${st.ci.map((h) => CI[h]).join(' · ')}` : ''}. ${st.on ? '끄기: kedovi docs pages off' : '켜기: kedovi docs pages on'} ${t.name}`);
      continue;
    }
    if (mode === 'off') {
      const changed = setIgnore(t.dir, true);
      const tracked = gitOut(t.dir, ['ls-files', `${OUT}/${MANIFEST}`]);
      console.log(`○ ${t.name}: Pages 끔.${changed ? ' .gitignore 에 /docs-site/ 를 넣었습니다.' : ''} CI 파일은 두어도 돌지 않습니다`);
      if (tracked) console.log(`  이미 커밋된 docs-site/ 는 남아 있습니다. 빼려면: git -C ${t.dir} rm -r --cached -q ${OUT} 뒤 커밋`);
      continue;
    }
    const host = hostOfRemote(t.dir);
    const hosts = host ? [host] : ['gitlab', 'github'];
    const done = hosts.map((h) => `${CI[h]} ${putCi(t.dir, h)}`);
    // 원격이 정해졌으면 안 쓰는 쪽 CI 는 우리 것일 때만 지운다
    if (host) {
      const other = host === 'gitlab' ? 'github' : 'gitlab';
      const f = path.join(t.dir, CI[other]);
      if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes(CI_MARK)) { fs.rmSync(f); done.push(`${CI[other]} 지움 (원격이 ${HOST_NAME[host]})`); }
    }
    const unignored = setIgnore(t.dir, false);
    console.log(`● ${t.name}: Pages 켬 (${host ? HOST_NAME[host] : '원격 없음: GitLab · GitHub 둘 다 둠'}). ${done.join(' · ')}${unignored ? ' · .gitignore 에서 /docs-site/ 뺌' : ''}`);
    console.log(`  다음: kedovi docs build ${t.name} → ${OUT}/ 와 CI 파일을 커밋 · push`);
    if (host === 'github') console.log('  한 번만: GitHub 의 Settings > Pages > Source 를 「GitHub Actions」 로 (비공개 repo 는 유료 요금제)');
    else console.log('  GitLab 서버에 Pages 기능과 러너가 있어야 한다 (Pages 는 서버 관리자가 켠다)');
  }
}

/** 옛 출력 폴더 html/ → docs-site/ (한 번). git 이 아는 파일이면 git mv. 우리 CI 파일 · .gitignore 의 경로도 바꾼다 */
function migrate(t) {
  if (opt('out')) return;
  const from = path.join(t.dir, OLD_OUT), to = path.join(t.dir, OUT);
  if (!fs.existsSync(path.join(from, MANIFEST)) || fs.existsSync(to)) return;
  const tracked = gitOut(t.dir, ['ls-files', `${OLD_OUT}/${MANIFEST}`]);
  if (!(tracked && spawnOk(t.dir, ['mv', OLD_OUT, OUT]))) fs.renameSync(from, to);
  const fixed = [], left = [];
  for (const h of ['gitlab', 'github']) {
    const f = path.join(t.dir, CI[h]);
    if (!fs.existsSync(f)) continue;
    const cur = fs.readFileSync(f, 'utf8');
    if (/kedovi docs build|site\.json/.test(cur)) {
      const next = cur.split('\n').map(ciLine).join('\n');
      const n = next.split('\n').filter((l, i) => l !== cur.split('\n')[i]).length;
      if (n) { fs.writeFileSync(f, next); fixed.push(`${CI[h]} ${n}줄`); }
    }
    const rest = oldRefs(fs.readFileSync(f, 'utf8'));
    if (rest.length) left.push(`${CI[h]} ${rest.join(' · ')}행`);
  }
  const gi = path.join(t.dir, '.gitignore');
  if (fs.existsSync(gi)) { const g = fs.readFileSync(gi, 'utf8'); const n = g.replace(/^\/?html\/?\s*$/m, `/${OUT}/`); if (n !== g) { fs.writeFileSync(gi, n); fixed.push('.gitignore'); } }
  console.log(`  출력 폴더를 ${OLD_OUT}/ → ${OUT}/ 로 옮겼습니다${tracked ? ' (git mv)' : ''}${fixed.length ? ` · 경로 고침: ${fixed.join(' · ')}` : ''}. 같이 커밋한다`);
  for (const l of left) console.log(`  ⚠ ${l} 에 ${OLD_OUT}/ 경로가 남음. 손으로 ${OUT}/ 로 고친다`);
}

// CI 줄 안의 옛 출력 경로 (html · html/ · ./html/ · html/. · html/**): text/html · index.html 은 아니다
const OLD_REF = /(^|[\s'"(=:,[])(\.\/)?html(?=\/|[\s'"\]),;]|$)/g;
const ciLine = (l) => l.replace(/\bhtml\/ 이 없습니다/g, `${OUT}/ 가 없습니다`).replace(/\bhtml\/ 은 kedovi docs build/g, `${OUT}/ 는 kedovi docs build`)
  .replace(OLD_REF, (m, a, dot) => `${a}${dot || ''}${OUT}`).replace(/문서 사이트\(html\/\)/g, `문서 사이트(${OUT}/)`);
const oldRefs = (text) => text.split('\n').map((l, i) => (new RegExp(OLD_REF.source).test(l) || /문서 사이트\(html\/\)/.test(l) ? i + 1 : 0)).filter(Boolean);

// 포함 범위: 「폴더/**」 는 그 폴더 전체, 그 밖에는 문서 메뉴와 같은 glob
const globHit = (g, rel) => { const s = String(g).replace(/^\.?\//, ''); return s.endsWith('/**') ? rel === s.slice(0, -3) || rel.startsWith(s.slice(0, -2)) : globRe(s).test(rel); };
const REPO_MODE = { legacy: 'off' }; // 종류별 기본 (없으면 copy)

/**
 * 포함 범위 → { keep(rel, isDir), srcOf(md) | null, extra: { 경로: 내용 }, plan: [{ name, kind, mode, why }] }
 * 워크스페이스 루트면 repos/<이름>/ 를 repo 마다 copy · link · off 로, 원본 버튼은 그 repo 의 원격으로
 */
function scope(t, ws, config) {
  const inc = [].concat(config.include || []);
  const exc = [].concat(config.exclude || []);
  const real = (x) => { try { return fs.realpathSync(x); } catch { return path.resolve(x); } };
  const isRoot = !!(ws && ws.root && real(ws.root) === real(t.dir));
  const plan = [];
  const extra = {};
  const repoOf = new Map();
  if (isRoot) {
    const rc = config.repos || {};
    for (const r of ws.repos || []) {
      const rel = ['repos', ...(r.group ? [r.group] : []), r.name].join('/'); // lib/workspace.js repoRel
      if (!fs.existsSync(path.join(t.dir, rel))) continue;
      const o = rc[r.name] != null ? rc[r.name] : rc[r.kind];
      const mode = String((o && typeof o === 'object' ? o.mode : o) || REPO_MODE[r.kind] || 'copy');
      const why = rc[r.name] != null ? '이름' : rc[r.kind] != null ? `종류 ${r.kind}` : `기본(${r.kind})`;
      const blob = sourceOf(r.dir, r.url);
      plan.push({ name: r.name, kind: r.kind, mode, why });
      repoOf.set(rel, { mode, blob });
      if (mode === 'link') {
        const url = (o && typeof o === 'object' && o.url) || (blob ? blob.replace(/\/(-\/)?blob\/[^/]+$/, '') : '');
        extra[`${rel}/README.md`] = `# ${r.name}\n\n이 repo(${r.kind})의 문서는 따로 본다. 이 사이트에는 사본을 넣지 않는다.\n\n${url ? `- 문서 · 원본: [${url}](${url})\n` : '- 원격 주소가 없습니다 (workspace.json repos[].url 또는 docs-site.json repos 의 url)\n'}`;
      }
    }
  }
  // 경로가 든 repo (repos/<이름>/… · repos/<그룹>/<이름>/…) → [repo 폴더, 그 안 경로]
  const repoAt = (rel) => { for (const k of repoOf.keys()) if (rel === k || rel.startsWith(`${k}/`)) return [k, rel.slice(k.length + 1)]; return null; };
  const keep = (rel, isDir) => {
    const m = repoAt(rel);
    if (m && repoOf.get(m[0]).mode !== 'copy') return false;
    if (exc.some((g) => globHit(g, rel))) return false;
    if (isDir || !inc.length) return true;
    return inc.some((g) => globHit(g, rel));
  };
  const rootSrc = config.source ? String(config.source).replace(/\/+$/, '') : null;
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  const srcOf = isRoot ? (md) => {
    const m = repoAt(md);
    if (m && m[1]) { const r = repoOf.get(m[0]); return r.mode === 'copy' && r.blob ? `${r.blob}/${enc(m[1])}` : null; }
    return rootSrc ? `${rootSrc}/${enc(md)}` : null;
  } : null;
  return { keep, srcOf, extra, plan };
}

/**
 * 저장 데이터 쪽 (기능 문서의 「### 저장」 표 + 쓰기 보고서): write-data/README.md · write-data/<기능 ID>.md (생성 md) 와 보고서 사본 write-report/<repo>/index.html · index.json.
 * 보고서는 build(live) 때 워크스페이스 코드 repo 의 출력 폴더(lib/writes.js REPORT_DIRS)에서 읽고, check · hook 은 사이트에 이미 넣은 사본만 본다
 * (시험을 다시 돌려도 기획 repo 의 pre-commit 이 어긋남으로 막지 않게). 코드 repo 가 없는 PC 에서 build 해도 남은 사본은 지키고, 워크스페이스에서 빠진 repo 의 사본만 뺀다.
 * docs-site.json 의 "writeReport": false 면 만들지 않는다. 반환 { md, raw, linkable, group } | null
 */
const WD = 'write-data';
const WR = 'write-report';
function writePages(t, ws, files, outDir, config, live) {
  if (config.writeReport === false) return null;
  const feats = WRL.features(Object.fromEntries(Object.entries(files).filter(([k, v]) => /\.md$/i.test(k) && typeof v === 'string' && !k.startsWith(`${WD}/`))));
  const saved = feats.filter((f) => f.save && (f.save.rows.length || f.save.none));
  if (!saved.some((f) => f.save.rows.length)) return null;
  const reports = new Map(); // 사이트 안 이름 → { name, json, html }
  const known = new Set(((ws && ws.repos) || []).map((r) => r.name));
  const snap = path.join(outDir, WR);
  if (fs.existsSync(snap)) {
    for (const k of fs.readdirSync(snap).sort()) {
      const j = path.join(snap, k, 'index.json');
      if (!fs.existsSync(j) || (ws && !known.has(k.split('--')[0]))) continue;
      try { reports.set(k, { name: k, json: JSON.parse(fs.readFileSync(j, 'utf8')), raw: fs.readFileSync(j), html: fs.existsSync(path.join(snap, k, 'index.html')) ? fs.readFileSync(path.join(snap, k, 'index.html')) : null }); } catch { /* 깨진 사본은 뺀다 */ }
    }
  }
  if (live) {
    for (const r of ((ws && ws.repos) || []).filter((x) => (x.kind || 'code') === 'code')) {
      for (const x of WRL.findReports(r.dir)) {
        const k = x.module === '.' ? r.name : `${r.name}--${x.module}`;
        if (reports.has(k) && reports.get(k).live) continue; // 같은 이름이면 최근 것 (findReports 가 최근 것 먼저)
        try { const raw = fs.readFileSync(x.index); reports.set(k, { name: k, json: WRL.loadReport(x.index), raw, html: x.html ? fs.readFileSync(x.html) : null, live: true }); } catch (e) { console.log(`  ⚠ 쓰기 보고서를 읽지 못했습니다: ${e.message}`); }
      }
    }
  }
  const md = {}, raw = {}, linkable = new Set();
  for (const [k, r] of reports) {
    raw[`${WR}/${k}/index.json`] = r.raw;
    if (r.html) { raw[`${WR}/${k}/index.html`] = r.html; linkable.add(`${WR}/${k}/index.html`); }
  }
  const esc = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const cut = (v, n = 160) => { const x = esc(v); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };
  const repLink = (k, r, from) => (r.html ? `[${k} 화면](${path.posix.relative(from, `${WR}/${k}/index.html`)})` : `${k} (화면 없음)`);
  const repList = [...reports];
  const none = '보고서 없음: 코드 repo 에 `kedovi writes add jooq|jdbc|sqlalchemy|node-pg` 로 기록기를 넣고 시험을 돌린 뒤 `kedovi docs build`';
  const overview = ['# 저장 데이터', '', '> 생성물: kedovi docs build 가 기능 문서의 「저장」 표와 쓰기 보고서로 만든다. 고칠 곳은 기능 문서다.', '',
    '기능마다 그 기능이 쓰는 컬럼 · 값 출처 · 조건과, 시험이 실제로 쓴 예시 행을 모았다. 대조는 개발 워크스페이스의 `kedovi writes check`.', '',
    '| 기능 | ID | 저장 | 시험 예시 |', '|---|---|---|---|'];
  for (const f of saved) {
    const ex = repList.flatMap(([, r]) => WRL.examples(r.json, [...f.ids], 1000));
    overview.push(`| [${esc(f.title || f.id)}](${f.id}.md) | ${f.id} | ${f.save.none && !f.save.rows.length ? '없음' : `컬럼 ${f.save.rows.length}`} | ${ex.length ? `쓰기 ${ex.length}` : '없음'} |`);
    const page = [`# 저장 데이터 · ${f.title || f.id}`, '', `기능 ${f.id} 가 쓰는 것. 정본: [기능 문서](${path.posix.relative(WD, f.doc)})`, '', '## 저장 표', ''];
    if (f.save.rows.length) {
      page.push('| 스키마.테이블.컬럼 | 값 출처 | 조건 | 기본값 |', '|---|---|---|---|');
      for (const r of f.save.rows) page.push(`| ${esc(r.target)} | ${esc(r.source)} | ${esc(r.cond)} | ${esc(r.def)} |`);
    } else page.push('없음');
    page.push('', '## 시험이 쓴 예시', '');
    if (!repList.length) page.push(none);
    else {
      const rows = repList.flatMap(([k, r]) => WRL.examples(r.json, [...f.ids], 8).map((e) => ({ ...e, k })));
      if (!rows.length) page.push(`이 기능 ID(${f.id} · 수용 기준 ID)가 붙은 시험이 보고서에 없다. 시험 이름 · 태그 · @spec 에 ID 를 붙인다.`);
      else {
        page.push('| 시험 | 동작 | 테이블 | 값 | 결과 |', '|---|---|---|---|---|');
        for (const e of rows.slice(0, 8)) {
          const vals = e.row ? Object.entries(e.row).map(([c, v]) => `${c}=${WRL.showValue(v)}`).join(' · ') : '';
          const res = e.result ? (e.result.error ? `오류 ${e.result.error}` : `${e.result.rows} 행`) : '';
          page.push(`| ${cut(e.name, 60)} | ${esc(e.op || '')} | ${esc(e.table || '')} | ${cut(vals)}${e.more ? ` (외 ${e.more}행)` : ''} | ${esc(res)}${e.rolledBack ? ' · 롤백' : ''} |`);
        }
      }
      page.push('', `> 보고서: ${repList.map(([k, r]) => `${repLink(k, r, WD)}${r.json.generatedAt ? ` (${r.json.generatedAt})` : ''}`).join(' · ')}`);
    }
    md[`${WD}/${f.id}.md`] = `${page.join('\n')}\n`;
  }
  overview.push('', '## 쓰기 보고서', '');
  if (repList.length) {
    overview.push('| repo | 만든 때 | 시험 | 화면 |', '|---|---|---|---|');
    for (const [k, r] of repList) overview.push(`| ${esc(k.replace('--', '/'))} | ${esc(r.json.generatedAt || '')} | ${(r.json.tests || []).length} | ${repLink(k, r, WD)} |`);
  } else overview.push(none);
  md[`${WD}/README.md`] = `${overview.join('\n')}\n`;
  return { md, raw, linkable, group: { group: '저장 데이터', icon: '▤', files: [`${WD}/README.md`, `${WD}/*.md`], collapsed: true } };
}

function generate(t, ws, out, live = false) {
  const config = readConfig(t.dir);
  const sc = scope(t, ws, config);
  const real = { ...readTree(t.dir, out, sc.keep), ...sc.extra };
  const wp = writePages(t, ws, real, path.resolve(t.dir, out), config, live);
  const files = wp ? { ...real, ...wp.md } : real;
  const cfg = wp && Array.isArray(config.groups) && config.groups.length && !config.groups.some((g) => (g.files || []).some((x) => String(x).startsWith(`${WD}/`))) ? { ...config, groups: [...config.groups, wp.group] } : config;
  const cellFold = Number(((ws && ws.vars && ws.vars.docs) || {}).cellFold) || undefined;
  const res = build(files, { cellFold, title: titleOf(t.dir, ws, t.name), prefixes: prefixesOf(ws), assets: assets(t.dir), mermaid: mermaidAssets(), config: cfg, erd: erdOpts(ws), sheetTheme: sheetTheme(ws), ...(sc.srcOf ? { srcOf: sc.srcOf } : {}), ...(wp ? { linkable: wp.linkable } : {}) });
  if (wp) Object.assign(res.pages, wp.raw);
  res.writes = wp ? { pages: Object.keys(wp.md).length - 1, reports: Object.keys(wp.raw).filter((p) => p.endsWith('index.json')).length } : null;
  res.plan = sc.plan;
  const moved = movedPages(path.resolve(t.dir, out), res.pages);
  res.moved = moved;
  const list = Object.keys(res.pages).sort();
  res.files = real; // 문서 점검 · mermaid 검사는 원본 md 만 (생성한 저장 데이터 쪽은 빼고)
  res.pages[MANIFEST] = `${JSON.stringify({ generator: 'kedovi docs', note: '이 폴더는 kedovi docs build 가 만든다. 손으로 고치지 않는다 (다시 만들면 사라진다)', files: list, ...(Object.keys(moved).length ? { moved } : {}) }, null, 1)}\n`;
  return res;
}

/**
 * 옮겨진 문서: 지난번에 만든 쪽이 이번에 없고, 파일 이름이 같은 새 쪽이 하나뿐이면 옛 주소에 「옮겨졌습니다」 쪽을 둔다 (새 주소로 바로 넘긴다).
 * 공유한 링크 · 즐겨찾기가 404 가 되지 않게. 짝은 사이트 표시(assets/site.json)의 moved 에 남겨 다음 build · check 도 같은 쪽을 만든다.
 * 그 주소에 다시 문서가 생기거나 새 쪽이 없어지면 뺀다. index.html 처럼 흔한 이름은 짝을 짓지 않는다
 */
function movedPages(outDir, pages) {
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(path.join(outDir, MANIFEST), 'utf8')); } catch { /* 처음 */ }
  const moved = { ...(prev.moved || {}) };
  const html = Object.keys(pages).filter((p) => /\.html$/.test(p));
  for (const p of prev.files || []) {
    if (!/\.html$/.test(p) || p in pages || moved[p] || /(^|\/)(index|print-all|erd|erd-view)\.html$/.test(p)) continue;
    const hits = html.filter((x) => path.posix.basename(x) === path.posix.basename(p));
    if (hits.length === 1) moved[p] = hits[0];
  }
  const out = {};
  for (const [o, n] of Object.entries(moved).sort()) {
    if (o in pages || !(n in pages)) continue;
    const rel = path.posix.relative(path.posix.dirname(o), n);
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    pages[o] = `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="robots" content="noindex">\n<meta http-equiv="refresh" content="0; url=${esc(rel)}">\n<title>옮겨진 문서</title>\n<script>location.replace(${JSON.stringify(rel).replace(/</g, '\\u003c')} + location.hash)</script>\n</head>\n<body><p>이 문서는 옮겨졌습니다: <a href="${esc(rel)}">${esc(n)}</a></p></body>\n</html>\n`;
    out[o] = n;
  }
  return out;
}

const same = (a, b) => (Buffer.isBuffer(a) || Buffer.isBuffer(b) ? Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0 : a === b);

/** 디스크와 비교: 바뀐 · 없는 · 남은 파일 */
function diff(outDir, pages) {
  const changed = [];
  for (const [p, c] of Object.entries(pages)) {
    const f = path.join(outDir, p);
    if (!fs.existsSync(f)) { changed.push(`+ ${p}`); continue; }
    if (!same(fs.readFileSync(f, Buffer.isBuffer(c) ? null : 'utf8'), c)) changed.push(`~ ${p}`);
  }
  for (const p of oldFiles(outDir)) if (!(p in pages)) changed.push(`- ${p}`);
  return changed;
}
function oldFiles(outDir) {
  try { return JSON.parse(fs.readFileSync(path.join(outDir, MANIFEST), 'utf8')).files || []; } catch { return []; }
}
const ours = (outDir) => fs.existsSync(path.join(outDir, MANIFEST));

function warnLines(res) {
  if (!res.warnings.length) return [];
  const head = res.warnings.slice(0, 10).map((w) => `⚠ ${w}`);
  return res.warnings.length > 10 ? [...head, `⚠ … 외 ${res.warnings.length - 10}건 (정의 없는 ID: vars.docs.ids 머리말 기준)`] : head;
}

/** mermaid 문법 오류 줄 (✖). 그림이 없으면 mermaid 를 읽지 않는다 */
async function mermaidLines(res) {
  const bad = await MC.check(MC.blocks(res.files || {}));
  return bad.map((b) => `✖ mermaid 문법 오류: ${b.file}:${b.line}  ${b.error}`);
}
/** ASCII 그림 경고 (⚠, 막지 않는다): 전체 개수와 문서별 개수, 첫 자리 */
function artLines(res) {
  const art = MC.asciiArt(res.files || {});
  if (!art.length) return [];
  const per = new Map();
  for (const a of art) per.set(a.file, [...(per.get(a.file) || []), a.line]);
  const list = [...per].sort((a, b) => b[1].length - a[1].length);
  const top = list.slice(0, 10).map(([f, ls]) => `${f}:${ls[0]}${ls.length > 1 ? ` 외 ${ls.length - 1}` : ''}`).join(' · ');
  return [`⚠ ASCII 그림 ${art.length}개 (문서 ${per.size}개): ${top}${list.length > 10 ? ` · 외 문서 ${list.length - 10}개` : ''}. \`\`\`mermaid 블록으로 바꾸면 사이트에 그림으로 나온다 (구성도는 architecture 스킬)`];
}
/** 메뉴 「기타」 경고: docs-site.json groups 를 쓰는데 어느 묶음에도 맞지 않은 문서 */
function unlistedLines(res) {
  const u = res.unlisted || [];
  if (!u.length) return [];
  return [`⚠ 메뉴 「기타」 문서 ${u.length}개 (docs-site.json groups 어느 묶음에도 안 맞음): ${u.slice(0, 8).join(' · ')}${u.length > 8 ? ` 외 ${u.length - 8}개` : ''}. groups[].files 에 넣는다 (나열한 순서대로 메뉴에 나온다)`];
}

/** 문서 점검 경고 줄 (경고만). 기준값 = vars.docs.maxKB · cellMax · cellAvg · figureKB · codeMax. 대상 = 사이트에 넣는 md (include · exclude · repos 범위 안) */
function healthLines(t, ws, res) {
  const v = (ws && ws.vars && ws.vars.docs) || {};
  const docs = res && res.files ? Object.entries(res.files).filter(([k, c]) => /\.md$/i.test(k) && typeof c === 'string' && wanted(k)).map(([rel, text]) => ({ rel, text, sheet: false })) : undefined;
  // 규모 문서 점검은 기획 repo 만 (워크스페이스 밖 폴더면 기획 repo 뼈대의 결정 폴더로 알아본다)
  const scale = t.kind ? t.kind === 'docs' : fs.existsSync(path.join(t.dir, '90-decisions'));
  try { return DR.health(t.dir, { maxKB: v.maxKB, cellMax: v.cellMax, cellAvg: v.cellAvg, figureKB: v.figureKB, codeMax: v.codeMax, factDays: require('../lib/freshness').daysOf(ws), docs, scale }).map((w) => `⚠ 문서 점검: ${w}`); } catch { return []; }
}

/** show: ID 의 정의 부분만 */
function cmdShow(ws, id) {
  if (!id) throw new Error('사용법: kedovi docs show <ID> [--in <파일 조각>] [--all]');
  const defs = DR.show(targets(ws, null), id, opt('in'));
  if (!defs.length) {
    console.log(`정의를 못 찾았습니다: ${id} (제목 · 표 첫 칸 · **${id}** 문단 · 화면설계서 장). 쓰는 곳: kedovi docs refs ${id}`);
    process.exitCode = 1;
    return;
  }
  const many = defs.length > 1 && !has('all');
  for (const d of many ? defs.slice(0, 1) : defs) {
    const body = d.lines.length > 150 ? [...d.lines.slice(0, 150), `… ${d.lines.length - 150}줄 더 (${d.rel}:${d.line + 150} 부터)`] : d.lines;
    console.log(`== ${d.repo}/${d.rel}:${d.line} (${d.kind})${d.frozen ? ' [동결]' : ''}`);
    console.log(body.join('\n').replace(/\s+$/, ''));
    console.log('');
  }
  if (many) console.log(`다른 정의 ${defs.length - 1}곳: ${defs.slice(1, 9).map((d) => `${d.rel}:${d.line}(${d.kind})`).join(' · ')}${defs.length > 9 ? ' …' : ''}. 모두 보기: --all, 문서 고르기: --in <파일 조각>`);
}

/** refs: ID 가 나오는 곳 */
/** 본문 괄호 속 근거(파일:줄)를 그 문단 · 목록 · 표 아래 「> 근거:」 인용구로 옮긴다. --dry 면 개수만 */
function cmdRefsQuote(files) {
  const list = files.filter((f) => !f.startsWith('--'));
  if (!list.length) throw new Error('사용법: kedovi docs refs-quote <md 파일…> [--dry]');
  let total = 0;
  for (const f of list) {
    if (!fs.existsSync(f)) { console.log(`✖ ${f}: 파일이 없습니다`); process.exitCode = 1; continue; }
    const cur = fs.readFileSync(f, 'utf8');
    const r = DR.refsToQuote(cur);
    total += r.moved;
    if (!r.moved) { console.log(`- ${f}: 옮길 근거 없음`); continue; }
    if (!has('dry')) fs.writeFileSync(f, r.text);
    console.log(`${has('dry') ? '·' : '✔'} ${f}: 근거 ${r.moved}곳${has('dry') ? ' (옮길 곳, --dry)' : '을 인용구로 옮김'}`);
  }
  if (list.length > 1) console.log(`  모두 ${total}곳`);
}

function cmdRefs(ws, id) {
  if (!id) throw new Error('사용법: kedovi docs refs <ID> [--docs]');
  const repos = ((ws && ws.repos) || []).filter((r) => (has('docs') ? r.kind === 'docs' : r.kind !== 'legacy'));
  const hits = DR.refs(repos.length ? repos : targets(ws, null).map((t) => ({ ...t, kind: 'docs' })), id);
  if (!hits.length) { console.log(`${id}: 나오는 곳 없음 (${repos.map((r) => r.name).join(', ') || '기획 repo'})`); return; }
  const files = new Map();
  for (const h of hits) { const k = `${h.repo}/${h.rel}`; if (!files.has(k)) files.set(k, []); files.get(k).push(h); }
  console.log(`${id}: ${files.size}개 파일 · ${hits.length}곳 (★ 정의 · [동결] 은 고치지 않는 문서)`);
  let shown = 0;
  for (const [f, list] of files) {
    console.log(`${f}${list[0].frozen ? ' [동결]' : ''}  ${list.length}곳`);
    for (const h of list.slice(0, 4)) { if (shown++ < 80) console.log(`  ${h.def ? '★' : ' '} ${h.line}: ${DR.cut(h.text, 110)}`); }
    if (list.length > 4) console.log(`    … 그 밖에 ${list.slice(4).map((h) => h.line).join(', ')}`);
  }
}

function traceIds(ws) {
  const v = (ws && ws.vars) || {};
  // --ids → vars.docs.traceIds → vars.screens.functionIds (옛 설정 그대로) → 기획 repo 뼈대의 FN,SCR,API. 수용 기준은 cmdTrace 가 기본값일 때만 더한다
  const pick = opt('ids') || (v.docs && v.docs.traceIds) || (v.screens && v.screens.functionIds) || 'FN,SCR,API';
  return [...new Set(String(pick).split(',').map((x) => x.trim()).filter(Boolean))];
}

/** trace: 기획 ID ↔ 코드의 구현 표시 */
// 테스트 파일 (언어마다 흔한 꼴). 수용 기준(AC-) 은 테스트에, 나머지는 코드에 구현 표시가 있어야 한다
const TEST_FILE = /(^|\/)(tests?|__tests__|androidTest|testing|e2e|cypress|playwright)\/|\.cy\.[jt]sx?$|[._-](test|spec)\.[a-z]+$|[a-z0-9](Test|Tests|IT)\.(java|kt|swift|cs|scala|php)$|[a-z0-9]Spec\.(kt|scala)$|_test\.(go|py|dart)$|(^|\/)test_[^/]*\.py$/; // 대문자 Test 만 (Latest · Contest 는 테스트가 아니다)
// 진입 파일 (화면 · API · 배치 · 소비자). 새로 만들거나 고친 것에 기획 ID(@spec)가 없으면 --new 가 알린다
const ENTRY_FILE = /[A-Za-z0-9](Controller|Resource|Handler|Endpoint|Router|Job|Batch|Scheduler|Consumer)\.(java|kt|swift|dart|ts|js|py|cs|go)$|_(handler|controller|router)\.(go|py)$|(Screen|Page|Activity)\.(tsx|jsx|vue|svelte|swift|dart|kt|java|cs)$|\.(controller|resolver|gateway|processor)\.ts$|(^|\/)(page|route|actions)\.[jt]sx?$|(^|\/)(views|routers?|api)\.py$|(^|\/)(routes?|controllers?|handlers?|endpoints?)\/[^/]+\.(ts|js|py|go|kt|java)$/; // api/ 폴더는 화면 쪽 API 클라이언트일 때가 많아 넣지 않는다

/** --new: 코드 repo 에서 새로 만들거나 고친 진입 파일(커밋 안 한 것 + 아직 push 안 한 커밋) 중 기획 ID 가 없는 것. 반환 { missing, unread } */
function untracedEntries(code, re) {
  const missing = [];
  const unread = [];
  const noRemote = [];
  for (const r of code) {
    if (!fs.existsSync(r.dir)) continue;
    const git = (...a) => { try { return execFileSync('git', ['-C', r.dir, '-c', 'core.quotePath=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); } catch { return null; } };
    const top = (git('rev-parse', '--show-toplevel') || '').trim();
    if (!top) { unread.push(`${r.name}: git 으로 읽지 못함 (저장소가 아니거나 권한 · safe.directory 문제)`); continue; }
    const files = new Set();
    // 커밋 안 한 것 (-z: 따옴표 · 이스케이프 없는 경로, -- . : 이 repo 폴더 안만). 지운 것은 뺀다
    const stOut = git('status', '--porcelain', '-z', '-uall', '--', '.');
    if (stOut === null) unread.push(`${r.name}: 커밋하지 않은 파일을 읽지 못함 (git status 실패)`);
    const st = (stOut || '').split('\0');
    for (let i = 0; i < st.length; i++) {
      const e = st[i];
      if (!e) continue;
      const xy = e.slice(0, 2);
      if (/[RC]/.test(xy)) i++; // 이름 바꾸기 · 복사는 다음 칸이 옛 이름
      if (!/D/.test(xy)) files.add(e.slice(3));
    }
    // 아직 push 안 한 커밋 = 어느 원격 브랜치에도 없는 커밋 (남이 올린 변경 · 이미 올린 커밋은 세지 않는다).
    // 원격이 없으면 커밋하지 않은 것만 본다 (전체 기록을 다 보면 옛 진입 파일이 모두 나온다. 전체는 kedovi docs trace)
    // 원격 브랜치(받아 온 것)가 하나도 없으면 원격이 없는 것으로 본다 (원격만 추가하고 push 전이면 전체 기록이 잡힌다)
    const remote = (git('for-each-ref', '--count=1', '--format=%(refname)', 'refs/remotes') || '').trim();
    const hasHead = git('rev-parse', '--verify', '-q', 'HEAD') !== null;
    const out = remote && hasHead ? git('log', '--name-only', '--diff-filter=AMR', '--format=', '-z', 'HEAD', '--not', '--remotes', '--', '.') : '';
    if (out === null) unread.push(`${r.name}: push 안 한 커밋을 읽지 못함 (git log 실패)`);
    if (!remote) noRemote.push(r.name);
    for (const f of (out || '').split('\0')) if (f.trim()) files.add(f.trim());
    for (const f of files) {
      if (!ENTRY_FILE.test(f) || TEST_FILE.test(f)) continue;
      let text = null;
      if (!fs.existsSync(path.join(top, f))) continue; // 그 뒤에 지운 파일
      try { text = fs.readFileSync(path.join(top, f), 'utf8'); } catch { unread.push(`${r.name}/${f}`); continue; }
      re.lastIndex = 0;
      const realDir = (() => { try { return fs.realpathSync(r.dir); } catch { return r.dir; } })(); // git 은 실제 경로를 준다 (/var → /private/var 같은 링크)
      if (!re.test(text)) missing.push(`${r.name}/${path.relative(realDir, path.join(top, f)).split(path.sep).join('/')}`); // repo 폴더 기준 (trace 와 같게)
    }
  }
  return { missing, unread, noRemote };
}

function cmdTrace(ws) {
  // 수용 기준 머리말 (코드가 아니라 테스트에 있어야 하는 ID): vars.docs.acceptanceIds, 기본 AC
  // 대조 머리말을 정하지 않았을 때만 수용 기준 머리말을 더한다 (정한 워크스페이스에 새 머리말이 끼어 오탐 · --strict 실패가 생기지 않게). acceptanceIds: "" 면 끈다
  const dv = ((ws && ws.vars && ws.vars.docs) || {});
  const acPre = String(dv.acceptanceIds === undefined ? 'AC' : dv.acceptanceIds).split(',').map((x) => x.trim()).filter(Boolean);
  const isAc = (id) => acPre.some((p) => id.startsWith(`${p}-`));
  const configured = !!(opt('ids') || dv.traceIds || (ws && ws.vars && ws.vars.screens && ws.vars.screens.functionIds)); // 옛 워크스페이스는 정한 머리말만 본다
  const ids = [...new Set([...traceIds(ws), ...(configured ? [] : acPre)])];
  if (!ids.length) throw new Error('대조할 ID 머리말이 없습니다. kedovi docs trace --ids FN 또는 workspace.json 의 vars.docs.traceIds (예: "FN")');
  const code = ((ws && ws.repos) || []).filter((r) => (r.kind || 'code') === 'code');
  const hasDocs = ((ws && ws.repos) || []).some((r) => r.kind === 'docs');
  if (has('new') && (!code.length || !hasDocs)) return console.log(`✔ ${!code.length ? '코드 repo' : '기획 repo'}가 없어 기획 ID 를 대조하지 않습니다`); // 커밋 전 확인이 기획 없는 워크스페이스를 막지 않게
  if (!code.length) throw new Error('코드 repo(kind: code)가 없습니다');
  if (has('new')) { // 새 진입 파일에 기획 ID 가 있나 (커밋 전 확인)
    const { missing: list, unread, noRemote } = untracedEntries(code, DR.prefixRe(ids));
    if (noRemote.length) console.log(`  원격 브랜치를 받아 온 적이 없는 repo(${noRemote.join(', ')})는 커밋하지 않은 파일만 봤습니다 (기획에 정의가 있는지는 kedovi docs trace)`);
    if (unread.length) console.log(`⚠ 읽지 못해 보지 못한 진입 파일 ${unread.length}개: ${unread.slice(0, 10).join(', ')}`);
    if (unread.length && has('strict')) process.exitCode = 1; // 보지 못한 것이 있으면 통과로 치지 않는다
    if (!list.length) return console.log(`${unread.length ? '…' : '✔'} 새로 만들거나 고친 진입 파일에 기획 ID(${ids.join(', ')})가 ${unread.length ? '읽은 것은 ' : ''}모두 있습니다`);
    console.log(`⚠ 기획 ID 가 없는 새 진입 파일 ${list.length}개 (머리 주석에 // @spec <ID> 를 단다. 기획에 없는 기능이면 사용자에게 확인):`);
    for (const f of list) console.log(`  ${f}`);
    if (has('strict')) process.exitCode = 1;
    return;
  }
  const docs = targets(ws, null); // --new 는 기획 repo 를 읽지 않는다 (기획 repo 가 없어도 된다)
  const res = DR.trace(docs, code, ids);
  const all = has('all');
  // 코드 · 테스트 나눠 세기: 수용 기준(AC-)은 테스트에 있어야 한다
  const parts = new Map([...res.found].map(([id, at]) => [id, { code: at.filter((x) => !TEST_FILE.test(x.rel)), test: at.filter((x) => TEST_FILE.test(x.rel)) }]));
  const split = (id) => parts.get(id) || { code: [], test: [] };
  if (has('md')) { // 추적표 (기획 repo 에 두려면 > 파일로 저장)
    const rows = [...res.defined].map(([id, d]) => { const s2 = split(id); const fmt = (l) => { const u = [...new Set(l.map((x) => `${x.repo}/${x.rel}`))]; return u.length ? u.slice(0, 3).map((x) => `\`${x}\``).join('<br>') + (u.length > 3 ? ` 외 ${u.length - 3}` : '') : '없음'; }; return `| ${id} | ${d.rel} | ${fmt(s2.code)} | ${fmt(s2.test)} |`; });
    console.log(['# 추적표', '', `> 생성: kedovi docs trace --md (머리말 ${ids.join(', ')}). 손으로 고치지 않는다`, '', '| ID | 정의 | 코드 | 테스트 |', '|---|---|---|---|', ...rows, ''].join('\n'));
    return;
  }
  // 수용 기준(AC-)은 테스트에 있어야 한다: 어디에도 없거나 코드에만 있으면 「테스트에 없는 수용 기준」 으로 묶는다
  // 동결 · 「다음 스프린트」 는 세지 않는다. 수용 기준은 테스트에, 나머지(기능 · 화면 · API)는 테스트가 아닌 코드에 표시가 있어야 한다 (--md 의 칸과 같게)
  const active = [...res.defined].filter(([, d]) => !d.frozen && !d.later).map(([id]) => id);
  const acActive = active.filter(isAc);
  const noTest = acActive.filter((id) => !split(id).test.length);
  const codeActive = active.filter((id) => !isAc(id));
  res.missing = codeActive.filter((id) => !split(id).code.length);
  const many = (list, n) => (all || list.length <= n ? list : [...list.slice(0, n), `… 외 ${list.length - n}개 (모두: --all)`]);
  const total = codeActive.length; // 수용 기준은 아래 「테스트」 로 따로 센다
  const nonAc = [...res.defined].filter(([id]) => !isAc(id)).map(([, d]) => d); // 아래 비율은 기능 · 화면 · API ID 만
  const later = nonAc.filter((d) => d.later).length;
  const frozen = nonAc.filter((d) => d.frozen && !d.later).length;
  const skip = [later && `「다음 스프린트」 ${later}`, frozen && `동결 문서 ${frozen}`].filter(Boolean).join(' · ');
  if (!configured) console.log(`  머리말을 정하지 않아 기획 repo 뼈대의 기본값 ${ids.join(',')} 로 봅니다 (바꾸기: workspace.json vars.docs.traceIds)`);
  console.log(`기획 ID 대조 (머리말 ${ids.join(', ')} · 기획 ${docs.map((t) => t.name).join(', ')} · 코드 ${code.map((r) => r.name).join(', ')})`);
  if (!res.defined.size) console.log(`정의된 ID 가 없습니다 (머리말 ${ids.join(', ')}: 제목 · 표 첫 칸 · **ID** 문단 · 화면설계서 장). 머리말이 맞는지 확인: --ids 또는 vars.docs.traceIds`);
  if (total) console.log(`${res.missing.length ? '⚠' : '✔'} 코드에 구현 표시가 있는 ID ${total - res.missing.length}/${total}${skip ? ` (뺀 것: ${skip})` : ''}`);
  if (res.missing.length) {
    console.log(`⚠ 코드에 표시 없음 ${res.missing.length}개 (아직 안 만들었거나, 만들었는데 주석에 ID 를 안 적음):`);
    for (const id of many(res.missing, 30)) { const d = res.defined.get(id); console.log(d ? `  ${id}  ${d.repo}/${d.rel}:${d.line}` : `  ${id}`); }
  }
  if (res.unknown.length) {
    console.log(`✖ 기획에 정의 없는 ID ${res.unknown.length}곳 (오타 · 지운 기능 · 아직 안 쓴 문서. 정의 확인: kedovi docs show <ID>):`);
    for (const u of many(res.unknown, 30)) console.log(typeof u === 'string' ? `  ${u}` : `  ${u.id}  ${u.repo}/${u.rel}:${u.line}`);
    if (has('strict')) process.exitCode = 1;
  }
  if (acActive.length) console.log(`${noTest.length ? '⚠' : '✔'} 테스트에 표시가 있는 수용 기준 ${acActive.length - noTest.length}/${acActive.length}`);
  if (noTest.length) {
    console.log(`⚠ 테스트에 없는 수용 기준 ${noTest.length}개 (테스트 이름 · 태그 · 주석에 @spec <ID> 를 단다):`);
    for (const id of many(noTest, 30)) console.log(`  ${id}`);
  }
  if (!res.found.size && total) console.log('  구현한 코드의 진입점 머리 주석에 기획 ID 를 한 번 적으면 대조된다 (예: // @spec FN-ORD-003 SCR-ORD-01)');
  console.log('  추적표: kedovi docs trace --md · 새 진입 파일 확인: kedovi docs trace --new');
}

/** 크기 한 줄: docs-site/ 전체 · 묶음(repos/<이름> · 첫 폴더)별, 워크스페이스 루트면 repo 마다 넣은 방식 */
const SIZE_WARN_MB = 20;
function sizeLines(res, out) {
  const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
  const by = new Map();
  let total = 0;
  for (const [p, c] of Object.entries(res.pages)) {
    const n = Buffer.byteLength(c);
    total += n;
    const parts = p.split('/');
    const k = parts[0] === 'repos' && parts.length > 2 ? `repos/${parts[1]}` : parts.length > 1 ? parts[0] : '(맨 위)';
    const v = by.get(k) || { n: 0, size: 0 };
    v.n++; v.size += n; by.set(k, v);
  }
  const top = [...by.entries()].sort((a, b) => b[1].size - a[1].size);
  const lines = [`${out}/ ${Object.keys(res.pages).length}개 · ${mb(total)}: ${top.slice(0, 6).map(([k, v]) => `${k} ${v.n}개 ${mb(v.size)}`).join(' · ')}${top.length > 6 ? ` 외 ${top.length - 6}묶음` : ''}`];
  if ((res.plan || []).length) lines.push(`repos: ${res.plan.map((p) => `${p.name} ${{ copy: '사본', link: '링크만', off: '뺌' }[p.mode] || p.mode}(${p.why})`).join(' · ')}. 바꾸기: docs-site.json "repos": { "<종류|이름>": "copy|link|off" }`);
  if (total > SIZE_WARN_MB * 1048576) lines.push(`⚠ ${out}/ 이 ${mb(total)} 입니다. 커밋 전에 docs-site.json 의 exclude(예: "repos/<이름>/docs/<외부 문서>/**") · repos 로 줄일 수 있다`);
  return lines;
}

async function cmdBuild(ws) {
  for (const t of targets(ws, argv[1] && !argv[1].startsWith('--') ? argv[1] : null)) {
    migrate(t);
    const out = outArg(t.dir) || OUT;
    const outDir = path.resolve(t.dir, out);
    if (fs.existsSync(outDir) && fs.readdirSync(outDir).length && !ours(outDir) && !has('force')) {
      throw new Error(`${outLabel(t, out)}/ 에 다른 생성기가 만든 파일이 있습니다. 덮지 않습니다 (다른 폴더: --out <폴더>, 덮기: --force)`);
    }
    // 원본 보기 주소: docs-site.json 에 없으면 origin 으로 한 번 채워 둔다 (그 뒤로는 파일 값만 쓰므로 PC 마다 결과가 같다).
    // 파일이 이미 있거나 기획 repo · 워크스페이스 루트일 때만 쓴다. 일반 제품 repo 의 docs/ 등에는 --write-config 로 요청할 때만
    const config = readConfig(t.dir);
    if (!config.source && !has('no-source')) {
      const src = sourceOf(t.dir);
      if (src && (configHome(t) || has('write-config'))) {
        fs.writeFileSync(path.join(t.dir, CONFIG), `${JSON.stringify({ ...config, source: src }, null, 2)}\n`);
        console.log(`  ${CONFIG} 에 원본 주소를 적었습니다: ${src} (같이 커밋한다)`);
      } else if (src) console.log(`  원본 보기 주소를 사이트에 넣으려면: --write-config (${t.name}/${CONFIG} 를 만든다)`);
    }
    const res = generate(t, ws, out, true);
    if ((res.collisions || []).length) {
      // 대소문자만 다른 출력 경로는 나중에 쓴 쪽이 이겨 쪽이 사라진다: 쓰지 않고 멈춘다
      for (const c of res.collisions) console.log(`✖ ${t.name}: 대소문자를 구분하지 않는 PC 에서 같은 파일이 되는 경로: ${c}. 한쪽 이름을 바꾼다`);
      process.exitCode = 1;
      continue;
    }
    const stale = oldFiles(outDir).filter((p) => !(p in res.pages));
    for (const p of stale) {
      fs.rmSync(path.join(outDir, p), { force: true });
      // 비게 된 폴더도 치운다 (정의서를 지우면 assets/erd/ 등)
      for (let d = path.dirname(path.join(outDir, p)); d.startsWith(outDir + path.sep); d = path.dirname(d)) { try { fs.rmdirSync(d); } catch { break; } }
    }
    let wrote = 0;
    for (const [p, c] of Object.entries(res.pages)) {
      const f = path.join(outDir, p);
      if (fs.existsSync(f) && same(fs.readFileSync(f, Buffer.isBuffer(c) ? null : 'utf8'), c)) continue;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, c);
      wrote++;
    }
    const sheets = res.docs.filter((d) => d.kind === 'sheets').length;
    const erd = (res.erds || []).map((e) => `ERD ${e.page} (테이블 ${e.model.tables.length})`).join(' · ');
    const mv = Object.keys(res.moved || {}).length;
    console.log(`✔ ${outLabel(t, out)}/ 문서 ${res.docs.length - sheets}${sheets ? ` · 화면설계서 ${sheets}` : ''}${erd ? ` · ${erd}` : ''} · ID ${Object.keys(res.index.ids).length} · 바뀐 파일 ${wrote}${stale.length ? ` · 지운 파일 ${stale.length}` : ''}${mv ? ` · 옮겨진 문서 안내 ${mv}` : ''}${res.writes ? ` · 저장 데이터 ${res.writes.pages}기능 (쓰기 보고서 ${res.writes.reports || '없음: kedovi writes add'})` : ''}`);
    for (const l of ignoredLines(t, ['.', ...(res.erds || []).map((e) => e.dir)])) console.log(`  ${l}`);
    for (const l of await mermaidLines(res)) console.log(`  ${l}`);
    for (const l of artLines(res)) console.log(`  ${l}`);
    for (const l of unlistedLines(res)) console.log(`  ${l}`);
    for (const l of warnLines(res)) console.log(`  ${l}`);
    for (const l of healthLines(t, ws, res)) console.log(`  ${l}`);
    for (const l of sizeLines(res, out)) console.log(`  ${l}`);
    console.log(`  ${pagesHint(t.dir, out)}`);
  }
}

async function cmdCheck(ws, dirArg, quietIfNone) {
  let bad = 0;
  for (const t of targets(ws, dirArg)) {
    const out = outOf(t.dir);
    const outDir = path.resolve(t.dir, out);
    if (!ours(outDir)) { if (!quietIfNone) console.log(`- ${t.name}: 문서 사이트를 만든 적 없음 (kedovi docs build)`); continue; }
    const res = generate(t, ws, out);
    const changed = diff(outDir, res.pages);
    if (changed.length) {
      bad++;
      console.log(`✖ ${t.name}: md 와 ${out}/ 가 어긋났습니다 (${changed.length}개). 다시 만든다: kedovi docs build ${t.name}`);
      for (const c of changed.slice(0, 8)) console.log(`  ${c}`);
    } else if (!quietIfNone) console.log(`✔ ${t.name}: ${out}/ 가 md 와 같음`);
    const mm = await mermaidLines(res);
    if (mm.length) { bad++; console.log(`✖ ${t.name}: mermaid 그림 ${mm.length}개가 문법 오류입니다 (사이트에는 원문과 오류 문구로 보입니다)`); }
    for (const l of mm) console.log(`  ${l}`);
    if (!quietIfNone) for (const l of [...artLines(res), ...unlistedLines(res)]) console.log(`  ${l}`);
    for (const l of warnLines(res)) console.log(`  ${l}`);
    if (!quietIfNone) for (const l of healthLines(t, ws, res)) console.log(`  ${l}`);
  }
  if (bad) process.exitCode = 1;
}

/** serve: docs-site/ 를 http://127.0.0.1:<port>/ 로 (이 PC 에서만). 포트가 쓰이고 있으면 다음 번호 */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };
function cmdServe(ws) {
  const arg = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
  const [t] = targets(ws, arg);
  const dir = path.join(t.dir, outOf(t.dir));
  if (!ours(dir)) throw new Error(`${t.name}: 문서 사이트를 만든 적 없음 (kedovi docs build ${t.name})`);
  const http = require('http');
  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
    // 이 PC 의 주소로 온 요청만 (다른 사이트가 DNS 를 127.0.0.1 로 돌려 읽는 것을 막는다). NUL 이 든 경로는 파일 읽기가 예외로 죽는다
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(req.headers.host || '') || rel.includes('\0')) { res.writeHead(400); res.end(); return; }
    let f = path.join(dir, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (f !== dir && !f.startsWith(dir + path.sep)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    fs.readFile(f, (e, data) => {
      if (e) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end(`없음: ${rel}`); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      res.end(data);
    });
  });
  let port = Number(opt('port')) || 8000;
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && !opt('port') && port < 8100) { port++; server.listen(port, '127.0.0.1'); return; }
    console.error(`✖ ${e.message}`);
    process.exitCode = 1;
  });
  server.on('listening', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`● ${t.name}: ${url} (${path.relative(process.cwd(), dir).startsWith('..') ? dir : path.relative(process.cwd(), dir) || dir}, 이 PC 에서만. 끝내기: Ctrl+C). 고친 뒤에는 kedovi docs build 하고 새로고침`);
    if (has('open')) {
      const opener = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
      require('child_process').spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
    }
  });
  server.listen(port, '127.0.0.1');
}

async function main() {
  const cmd = argv[0];
  const ws = loadWs();
  try {
    if (cmd === 'build') return await cmdBuild(ws);
    if (cmd === 'check') return await cmdCheck(ws, argv[1] && !argv[1].startsWith('--') ? argv[1] : null, false);
    if (cmd === 'hook') return await cmdCheck(ws, argv[1], true);
    if (cmd === 'show') return cmdShow(ws, argv[1]);
    if (cmd === 'refs') return cmdRefs(ws, argv[1]);
    if (cmd === 'refs-quote') return cmdRefsQuote(argv.slice(1));
    if (cmd === 'trace') return cmdTrace(ws);
    if (cmd === 'pages') return cmdPages(ws);
    if (cmd === 'serve') return cmdServe(ws);
    console.log('사용법: kedovi docs build [repo|폴더] [--out docs-site] [--force] [--write-config] · pages [on|off] [repo|폴더] · check [repo|폴더] · serve [repo|폴더] [--port 8000] [--open] · show <ID> [--in <파일 조각>] [--all] · refs <ID> [--docs] · refs-quote <md 파일…> [--dry] · trace [--ids FN] [--all] [--strict] [--md] [--new]');
    process.exitCode = cmd ? 1 : 0;
  } catch (e) {
    console.error(`✖ ${e.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { generate, ignoredLines, configHome, diff, assets, siteAssets, mermaidAssets, EXTRA, MANIFEST, OUT, OLD_OUT, pagesState, ciLine, oldRefs };
