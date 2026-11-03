// docs-site.js 포함 범위 점검: 워크스페이스 루트 사이트의 repo 별 copy · link · off, 하위 repo 원본 주소, include · exclude, 크기 줄. 실행: node docs-site.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-docsite-'));
const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); };
put('workspace.json', JSON.stringify({ project: { title: '시험' }, repos: [
  { name: 'web', kind: 'code', url: 'git@gitlab.example.com:grp/web.git' },
  { name: 'old', kind: 'legacy' },
  { name: 'plans', kind: 'docs', url: 'https://gitlab.example.com/grp/plans.git' },
  { name: 'noremote', kind: 'code' },
] }));
put('README.md', '# 시험 워크스페이스\n');
put('docs-site.json', JSON.stringify({ source: 'https://gitlab.example.com/grp/ws/-/blob/main', exclude: ['repos/web/vendor/**'], repos: { docs: 'link' } }));
put('repos/web/README.md', '# web\n');
put('repos/web/docs/guide.md', '# 안내\n');
put('repos/web/vendor/api/x.md', '# 외부 문서\n');
put('repos/old/docs/a.md', '# 옛 문서\n');
put('repos/plans/README.md', '# 기획\n');
put('repos/plans/md/req.md', '# 요구사항\n');
put('repos/noremote/README.md', '# 원격 없음\n');

const ws = require('../lib/workspace').load(dir);
process.argv = ['node', 'docs-site.js'];
const { generate } = require('./docs-site');
const res = generate({ name: 'ws', dir: ws.root }, ws, 'docs-site');
const pages = Object.keys(res.pages);
const src = (p) => { const m = /<a class="src" href="([^"]*)"/.exec(res.pages[p] || ''); return m ? m[1] : null; };

assert.ok(pages.includes('repos/web/docs/guide.html'), 'code repo 는 사본');
assert.ok(!pages.some((p) => p.startsWith('repos/web/vendor/')), 'exclude 「폴더/**」 는 그 폴더 전체를 뺀다');
assert.ok(!pages.some((p) => p.startsWith('repos/old/')), 'legacy repo 는 기본으로 뺀다');
assert.ok(!pages.includes('repos/plans/md/req.html') && pages.includes('repos/plans/index.html'), 'link 면 사본 없이 쪽 하나');
assert.match(res.pages['repos/plans/index.html'], /https:\/\/gitlab\.example\.com\/grp\/plans/, 'link 쪽은 그 repo 주소');
assert.strictEqual(src('repos/web/docs/guide.html'), 'https://gitlab.example.com/grp/web/-/blob/main/docs/guide.md', '하위 repo 원본 = 그 repo 원격 + 기본 브랜치 + repo 안 경로');
assert.strictEqual(src('repos/noremote/index.html'), null, '원격이 없으면 원본 버튼을 숨긴다');
assert.strictEqual(src('repos/plans/index.html'), null, 'link 쪽에는 원본 버튼이 없다');
assert.strictEqual(src('index.html'), 'https://gitlab.example.com/grp/ws/-/blob/main/README.md', '워크스페이스 파일은 docs-site.json source');
assert.deepStrictEqual(res.plan.map((p) => `${p.name}:${p.mode}`), ['web:copy', 'old:off', 'plans:link', 'noremote:copy']);

// 이름이 종류보다 먼저, include 를 주면 맞는 파일만
put('docs-site.json', JSON.stringify({ include: ['README.md', 'repos/old/**'], repos: { legacy: 'off', old: { mode: 'copy' } } }));
const r2 = generate({ name: 'ws', dir: ws.root }, ws, 'docs-site');
assert.ok(Object.keys(r2.pages).includes('repos/old/docs/a.html') && !Object.keys(r2.pages).some((p) => p.startsWith('repos/web/')), 'include · 이름 설정');

// 화면설계서 색 프리셋: vars.screens.theme 를 장 body 에 단다. 장에 data-theme 가 있으면 그대로, 기본 indigo 는 달지 않는다
const sheetHtml = (attr) => `<!doctype html><html><head><link rel="stylesheet" href="storyboard.css"></head><body${attr}><section class="sheet" id="SCR-001"></section><script src="storyboard.js"></script></body></html>`;
put('repos/web/docs/a.html', sheetHtml(''));
put('repos/web/docs/b.html', sheetHtml(' data-theme="rose"'));
put('docs-site.json', JSON.stringify({}));
const themed = (t) => { ws.vars = { screens: { theme: t } }; const p = generate({ name: 'ws', dir: ws.root }, ws, 'docs-site').pages; return [/data-theme="([^"]*)"/.exec(p['repos/web/docs/a.html']), /data-theme="([^"]*)"/.exec(p['repos/web/docs/b.html'])].map((m) => m && m[1]); };
assert.deepStrictEqual(themed('teal'), ['teal', 'rose'], 'vars.screens.theme 를 달고, 장의 data-theme 가 먼저');
assert.deepStrictEqual(themed(''), [null, 'rose'], '비우면 기본(indigo)이라 달지 않는다');
fs.rmSync(path.join(dir, 'repos/web/docs/a.html')); fs.rmSync(path.join(dir, 'repos/web/docs/b.html'));

// build 출력: 크기 · repo 별 내역 한 줄
put('docs-site.json', JSON.stringify({ source: 'https://gitlab.example.com/grp/ws/-/blob/main' }));
const out = spawnSync(process.execPath, [path.join(__dirname, 'docs-site.js'), 'build', dir], { encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
assert.strictEqual(out.status, 0, out.stderr);
assert.match(out.stdout, /docs-site\/ \d+개 · \d+(\.\d)?(KB|MB): /, out.stdout);
assert.match(out.stdout, /repos: web 사본\(기본\(code\)\) · old 뺌\(기본\(legacy\)\)/, out.stdout);
fs.rmSync(dir, { recursive: true, force: true });

// 옛 출력 폴더 html/ → docs-site/ 옮기기 (git mv · 우리 CI 경로 · .gitignore) 와 Pages 켜고 끄기
const g = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-pages-'));
const git = (...a) => spawnSync('git', ['-C', g, ...a], { encoding: 'utf8' });
const tool = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'docs-site.js'), ...a, g], { encoding: 'utf8' });
const gput = (f, c) => { fs.mkdirSync(path.dirname(path.join(g, f)), { recursive: true }); fs.writeFileSync(path.join(g, f), c); };
git('init', '-q', '-b', 'main'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'maintenance.auto', 'false');
git('remote', 'add', 'origin', 'git@gitlab.example.com:grp/plans.git');
gput('README.md', '# 기획\n');
gput('html/assets/site.json', JSON.stringify({ files: [] }));
gput('.gitlab-ci.yml', '# 문서 사이트(html/)를 GitLab Pages 로 올린다. html/ 은 kedovi docs build 로 만들어 커밋한 것을 그대로 쓴다\npages:\n  script:\n    - rm -rf public && cp -r html public\n    - cp -r html/. public/\n  artifacts:\n    paths: [public]\n  rules:\n    - exists:\n        - html/assets/site.json\n');
gput('.github/workflows/pages.yml', fs.readFileSync(path.join(__dirname, '..', 'assets', 'pages', 'github-pages.yml'), 'utf8'));
git('add', '-A'); git('commit', '-qm', 'init');
let o2 = tool('build');
assert.strictEqual(o2.status, 0, o2.stderr);
assert.ok(fs.existsSync(path.join(g, 'docs-site', 'assets', 'site.json')) && !fs.existsSync(path.join(g, 'html')), '옛 html/ 을 docs-site/ 로 옮긴다');
assert.match(git('status', '--porcelain').stdout, /^R. html\/assets\/site\.json -> docs-site\/assets\/site\.json/m, 'git mv 로 옮긴다');
const ci = fs.readFileSync(path.join(g, '.gitlab-ci.yml'), 'utf8');
assert.ok(/cp -r docs-site public/.test(ci) && /docs-site\/assets\/site\.json/.test(ci) && !/\bhtml\//.test(ci) && /cp -r docs-site\/\. public\//.test(ci), '우리 CI 의 경로도 바꾼다');
assert.match(o2.stdout, /경로 고침: \.gitlab-ci\.yml 4줄/, o2.stdout);
assert.doesNotMatch(o2.stdout, /⚠ .*html\/ 경로가 남음/, o2.stdout);
// 줄 단위 바꾸기 · 남은 줄 찾기: text/html · index.html 은 그대로
const { ciLine, oldRefs } = require('./docs-site');
assert.strictEqual(ciLine('    - cp -r ./html/. public/  # index.html text/html'), '    - cp -r ./docs-site/. public/  # index.html text/html');
assert.deepStrictEqual(oldRefs('a: 1\n  - cp -r html/. public/\n# index.html\npaths: [html]'), [2, 4]);
assert.match(o2.stdout, /Pages 켜짐 \(GitLab\)/, o2.stdout);
o2 = tool('pages', 'off');
assert.match(fs.readFileSync(path.join(g, '.gitignore'), 'utf8'), /^\/docs-site\/$/m, 'off 는 .gitignore 에 /docs-site/');
assert.match(tool('pages').stdout, /○ .*Pages 꺼짐 · 원격 GitLab/);
o2 = tool('pages', 'on');
assert.doesNotMatch(fs.readFileSync(path.join(g, '.gitignore'), 'utf8'), /docs-site/, 'on 은 .gitignore 에서 뺀다');
assert.ok(!fs.existsSync(path.join(g, '.github', 'workflows', 'pages.yml')), '원격이 GitLab 이면 우리 GitHub CI 는 지운다');
assert.strictEqual(fs.readFileSync(path.join(g, '.gitlab-ci.yml'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'assets', 'pages', 'gitlab-ci.yml'), 'utf8'), '우리 CI 는 새 견본으로');
assert.match(tool('pages').stdout, /● .*Pages 켜짐/);
// 남이 만든 .gitlab-ci.yml (pages 작업 없음) 은 덮지 않고 붙일 곳을 알린다
gput('.gitlab-ci.yml', 'test:\n  script: [echo hi]\n');
o2 = tool('pages', 'on');
assert.match(o2.stdout, /직접 넣기/);
assert.strictEqual(fs.readFileSync(path.join(g, '.gitlab-ci.yml'), 'utf8'), 'test:\n  script: [echo hi]\n');
// 경고: 메뉴 「기타」 문서 · ASCII 그림 요약(전체 개수 · 문서별)
const art = '```\n┌──┐\n│a │\n└──┘\n```\n';
gput('docs-site.json', JSON.stringify({ source: 'x', groups: [{ group: '시작', files: ['README.md'] }] }));
gput('a.md', `# 가\n\n${art}\n${art}`);
gput('b.md', `# 나\n\n${art}`);
o2 = tool('build');
assert.match(o2.stdout, /⚠ 메뉴 「기타」 문서 2개 \(docs-site\.json groups 어느 묶음에도 안 맞음\): a\.md · b\.md/, o2.stdout);
assert.match(o2.stdout, /⚠ ASCII 그림 3개 \(문서 2개\): a\.md:3 외 1 · b\.md:3\./, o2.stdout);
// 문서 점검은 사이트에 넣는 문서만 (include 밖의 큰 문서는 경고하지 않는다)
gput('docs-site.json', JSON.stringify({ include: ['a.md', 'b.md', 'README.md'] }));
gput('vendor/CHANGES.md', `# 바뀐 것\n\n${'긴 본문 '.repeat(20000)}\n`);
o2 = tool('build');
assert.doesNotMatch(o2.stdout, /vendor\/CHANGES\.md/, o2.stdout);
fs.rmSync(path.join(g, 'docs-site.json'));
o2 = tool('build');
assert.match(o2.stdout, /큰 문서.*vendor\/CHANGES\.md/, '범위를 안 주면 그 문서도 본다');
fs.rmSync(path.join(g, 'vendor'), { recursive: true, force: true });
// 대소문자만 다른 출력 경로 (README.md 와 INDEX.md 가 한 폴더): 쓰지 않고 ✖
gput('notes/README.md', '# 노트\n');
gput('notes/INDEX.md', '# 색인\n');
o2 = tool('build');
assert.ok(o2.status !== 0 && /✖ .*같은 파일이 되는 경로: notes\/index\.html ← notes\/INDEX\.md · notes\/README\.md/.test(o2.stdout), o2.stdout);
fs.rmSync(path.join(g, 'notes', 'README.md'));
o2 = tool('build');
assert.ok(o2.status === 0 && /<h1>색인<\/h1>/.test(fs.readFileSync(path.join(g, 'docs-site', 'notes', 'index.html'), 'utf8')) && !fs.readdirSync(path.join(g, 'docs-site', 'notes')).includes('INDEX.html'), 'INDEX.md 만 있으면 그 폴더 쪽');
// 이 repo 덧붙임: docs-site.extra.css · .js 를 site.css · site.js 끝에 붙이고, check 도 붙인 결과로 비교
gput('docs-site.extra.css', '.page h1{color:red}\n');
gput('docs-site.extra.js', 'window.EXTRA = 1;\n');
o2 = tool('build');
assert.strictEqual(o2.status, 0, o2.stderr);
const css = fs.readFileSync(path.join(g, 'docs-site', 'assets', 'site.css'), 'utf8');
assert.ok(css.startsWith(fs.readFileSync(path.join(__dirname, '..', 'assets', 'docs-site', 'site.css'), 'utf8')) && /\/\* docs-site\.extra\.css \(이 repo 덧붙임\) \*\/\n\.page h1\{color:red\}\n$/.test(css), '킷 site.css 뒤에 붙인다');
assert.match(fs.readFileSync(path.join(g, 'docs-site', 'assets', 'site.js'), 'utf8'), /window\.EXTRA = 1;\n$/);
assert.strictEqual(tool('check').status, 0, '붙인 결과와 같으면 check 통과');
gput('docs-site.extra.css', '.page h1{color:blue}\n');
assert.notStrictEqual(tool('check').status, 0, '덧붙임을 고치면 어긋남');
// 근거 분리 명령: 본문 괄호 속 파일:줄 → 인용구 (--dry 는 고치지 않는다)
gput('refs.md', '# 근거\n\n바로 저장한다 (a.js:3).\n');
const rq = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'docs-site.js'), 'refs-quote', ...a], { cwd: g, encoding: 'utf8' });
assert.match(rq('refs.md', '--dry').stdout, /· refs\.md: 근거 1곳 \(옮길 곳, --dry\)/);
assert.match(fs.readFileSync(path.join(g, 'refs.md'), 'utf8'), /\(a\.js:3\)/);
assert.match(rq('refs.md').stdout, /✔ refs\.md: 근거 1곳을 인용구로 옮김/);
assert.strictEqual(fs.readFileSync(path.join(g, 'refs.md'), 'utf8'), '# 근거\n\n바로 저장한다.\n\n> 근거: a.js:3\n');
fs.rmSync(g, { recursive: true, force: true });
// 옮겨진 문서: 옛 주소에 새 주소로 넘기는 쪽, 다음 build · check 도 같다
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-moved-'));
  fs.mkdirSync(path.join(d, 'AS-IS'), { recursive: true });
  fs.writeFileSync(path.join(d, 'README.md'), '# 기획\n');
  fs.writeFileSync(path.join(d, 'AS-IS', '30-sidecar.md'), '# 사이드카\n');
  const run = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'docs-site.js'), ...a], { encoding: 'utf8' });
  assert.strictEqual(run('build', d, '--no-source').status, 0);
  fs.mkdirSync(path.join(d, '2-구조'));
  fs.renameSync(path.join(d, 'AS-IS', '30-sidecar.md'), path.join(d, '2-구조', '30-sidecar.md'));
  fs.rmdirSync(path.join(d, 'AS-IS'));
  const r = run('build', d, '--no-source');
  assert.match(r.stdout, /옮겨진 문서 안내 1/);
  const stub = fs.readFileSync(path.join(d, 'docs-site', 'AS-IS', '30-sidecar.html'), 'utf8');
  assert.match(stub, /location\.replace\("\.\.\/2-구조\/30-sidecar\.html" \+ location\.hash\)/, '옛 주소 → 새 주소');
  assert.strictEqual(run('check', d).status, 0, '다음 check 도 같은 안내 쪽');
  assert.strictEqual(run('build', d, '--no-source').status, 0);
  assert.ok(fs.existsSync(path.join(d, 'docs-site', 'AS-IS', '30-sidecar.html')), '다음 build 에도 남는다');
}
// --out 절대 경로는 그대로 (대상 폴더 안으로 이어 붙이지 않는다) · docs-site.json 은 기획 repo · 이미 있을 때만 · 무시 폴더 경고
{
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-out-'));
  const g2 = (...a) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' });
  g2('init', '-q');
  g2('remote', 'add', 'origin', 'https://gitlab.example.com/grp/product.git');
  fs.writeFileSync(path.join(d, '.gitignore'), 'data/\n');
  fs.mkdirSync(path.join(d, 'docs', 'data'), { recursive: true });
  fs.writeFileSync(path.join(d, 'docs', 'README.md'), '# 제품 문서\n');
  fs.writeFileSync(path.join(d, 'docs', 'data', 'main.md'), '# 데이터\n\n### main.note 메모\n\n| 컬럼 | 논리명 | 타입 | 널 | 키 | 참조 | 설명 |\n|---|---|---|---|---|---|---|\n| id | ID | INTEGER | N | PK | | |\n');
  const outAbs = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-out-site-'));
  fs.rmSync(outAbs, { recursive: true });
  const run = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'docs-site.js'), ...a], { encoding: 'utf8' });
  const r = run('build', path.join(d, 'docs'), '--out', outAbs);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(outAbs, 'index.html')), '절대 경로에 만든다');
  assert.ok(!fs.existsSync(path.join(d, 'docs', outAbs.replace(/^\//, ''))), '대상 폴더 안으로 이어 붙이지 않는다');
  assert.ok(r.stdout.includes(`✔ ${outAbs}/`), '표시도 절대 경로');
  assert.ok(!r.stdout.includes('//'), '「data//tmp」 같은 표시 없음');
  // 일반 제품 repo 의 docs/: docs-site.json 을 만들지 않고 안내만
  assert.ok(!fs.existsSync(path.join(d, 'docs', 'docs-site.json')), '알리지 않고 만들지 않는다');
  assert.match(r.stdout, /원본 보기 주소를 사이트에 넣으려면: --write-config/);
  // 정의서 폴더가 git 무시 대상이면 경고
  assert.match(r.stdout, /docs\/data\/ 는 git 이 무시하는 폴더라 정의서가 커밋되지 않습니다|data\/ 는 git 이 무시하는 폴더라 정의서가 커밋되지 않습니다/);
  // --write-config 로 요청하면 쓴다
  const w = run('build', path.join(d, 'docs'), '--out', outAbs, '--write-config');
  assert.match(w.stdout, /docs-site\.json 에 원본 주소를 적었습니다/);
  assert.ok(fs.existsSync(path.join(d, 'docs', 'docs-site.json')));
  // 상대 경로는 지금처럼 대상 폴더 기준
  assert.strictEqual(run('build', path.join(d, 'docs'), '--out', 'site2', '--no-source').status, 0);
  assert.ok(fs.existsSync(path.join(d, 'docs', 'site2', 'index.html')));
  fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(outAbs, { recursive: true, force: true });
}
console.log('docs-site.test.js ✔');
