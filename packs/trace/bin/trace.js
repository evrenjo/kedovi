#!/usr/bin/env node
// 실행 흐름 디버깅: 테스트 · 로컬 서버 요청 한 번을 줄마다 값과 함께 기록해 이 PC 웹 페이지로 본다. 실행: kedovi trace <명령>
/*
 * 명령
 *   run --test <클래스>#<메서드> [--repo <이름> | --dir <경로>]              테스트 한 건을 기록 (API · 함수 · 배치 모두 테스트로)
 *   run --request "<METHOD> <http://localhost:포트/경로>" [--data '<본문>'] [-H 'K: V'] [--repo …] [--attach <디버그 포트>]
 *                                                                        로컬 서버(bootRun)를 띄워 실제 요청 한 번을 기록. --attach 면 이미 디버그 포트로 띄운 서버에 붙는다
 *   공통: [--include 패키지,…] [--sql on|off] [--max-steps 5000] [--max-hits 30] [--title "<제목>"] [--timeout 초]
 *   list [--n 10]                                                        최근 기록
 *   open [파일]                                                          브라우저로 (없으면 가장 최근)
 * 지금은 Java/Kotlin(JVM: Gradle · Maven)만. 기록은 이 PC 에만 (.agents/traces/, gitignore)
 * 값은 필드만 읽는다 (메서드를 부르지 않아 실행이 바뀌지 않는다). 비밀번호 · 토큰 이름의 값은 가린다
 * SQL: Gradle 은 기록할 때만 datasource-proxy 를 붙인다 (빌드 파일은 고치지 않는다). Maven 은 pom 에 있어야 한다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const DIR = path.join('.agents', 'traces');
const RECORDER = path.join(__dirname, '..', 'assets', 'java', 'Recorder.java');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'target', 'out', '.gradle', '.idea', 'bin', 'dist']);

// ───────── 찾기 (테스트에서도 쓴다) ─────────

/** 빌드 도구: gradle | maven | null */
function buildTool(dir) {
  if (['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].some((f) => fs.existsSync(path.join(dir, f)))) return 'gradle';
  if (fs.existsSync(path.join(dir, 'pom.xml'))) return 'maven';
  return null;
}

/** 소스 파일 목록 (.java · .kt), 빌드 결과 폴더 제외 */
function sourceFiles(dir, out = [], depth = 0) {
  if (depth > 20) return out;
  let es = [];
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) sourceFiles(path.join(dir, e.name), out, depth + 1); } else if (/\.(java|kt)$/.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

/** 파일의 package 줄 */
function packageOf(file) {
  try { const m = fs.readFileSync(file, 'utf8').match(/^\s*package\s+([\w.]+)/m); return m ? m[1] : ''; } catch { return ''; }
}

/** 기록할 패키지: src/main 소스의 공통 앞부분 (없으면 모든 패키지의 공통 앞부분) */
function basePackages(dir, files = sourceFiles(dir)) {
  const pk = (list) => [...new Set(list.map(packageOf).filter(Boolean))];
  const main = files.filter((f) => /[\\/]src[\\/]main[\\/]/.test(f));
  const pkgs = pk(main.length ? main : files);
  if (!pkgs.length) return [];
  const parts = pkgs.map((p) => p.split('.'));
  const common = [];
  for (let i = 0; i < parts[0].length; i += 1) { const x = parts[0][i]; if (parts.every((p) => p[i] === x)) common.push(x); else break; }
  if (common.length >= 2) return [common.join('.')];
  // 공통이 너무 짧으면 (com 등) 최상위 둘째 마디까지 묶음마다
  return [...new Set(parts.map((p) => p.slice(0, Math.min(p.length, 3)).join('.')))];
}

/** 테스트 클래스 찾기: 이름(짧거나 전체) → { fqcn, file } */
function findClass(dir, name, files = sourceFiles(dir)) {
  const simple = name.split('.').pop();
  const hits = files.filter((f) => path.basename(f).replace(/\.(java|kt)$/, '') === simple);
  for (const f of hits) {
    const fq = `${packageOf(f)}.${simple}`.replace(/^\./, '');
    if (!name.includes('.') || fq === name) return { fqcn: fq, file: f };
  }
  return null;
}

/** Gradle 프로젝트 경로 (파일이 든 가장 가까운 build.gradle 폴더 → :a:b, 루트면 '') */
function gradleProject(root, file) {
  let d = path.dirname(file);
  while (d.startsWith(root) && d !== root) {
    if (fs.existsSync(path.join(d, 'build.gradle')) || fs.existsSync(path.join(d, 'build.gradle.kts'))) return `:${path.relative(root, d).split(path.sep).join(':')}`;
    d = path.dirname(d);
  }
  return '';
}

/** Maven 모듈 경로 (파일이 든 가장 가까운 pom.xml 폴더, 루트면 '') */
function mavenModule(root, file) {
  let d = path.dirname(file);
  while (d.startsWith(root) && d !== root) {
    if (fs.existsSync(path.join(d, 'pom.xml'))) return path.relative(root, d);
    d = path.dirname(d);
  }
  return '';
}

/** Spring Boot 주 버전 (빌드 파일에서) → 2 · 3 · 4 · 0(모름) */
function bootMajor(dir) {
  const texts = [];
  const take = (f) => { try { texts.push(fs.readFileSync(f, 'utf8')); } catch { /* 없음 */ } };
  for (const f of ['build.gradle', 'build.gradle.kts', 'pom.xml', path.join('gradle', 'libs.versions.toml'), 'gradle.properties']) take(path.join(dir, f));
  const t = texts.join('\n');
  const m = t.match(/org\.springframework\.boot["')]*\s*version\s*["']?(\d+)\./)
    || t.match(/spring-boot-starter-parent<\/artifactId>\s*<version>(\d+)\./)
    || t.match(/spring-?[bB]oot\w*\s*=\s*["'](\d+)\./)
    || t.match(/springBootVersion\s*=\s*["']?(\d+)\./)
    || t.match(/spring-boot-gradle-plugin:(\d+)\./);
  return m ? Number(m[1]) : 0;
}

/** datasource-proxy 스타터 (Spring Boot 주 버전별) */
function sqlStarter(major) {
  const v = major >= 4 ? '2.0.1' : major === 2 ? '1.8.1' : '1.12.1';
  return `com.github.gavlyukovskiy:datasource-proxy-spring-boot-starter:${v}`;
}

/** 기록의 src(패키지 경로) → repo 파일 */
function mapSources(dir, trace, files = sourceFiles(dir)) {
  const want = [...new Set((trace.steps || []).map((s) => s.src).filter(Boolean))];
  const out = {};
  for (const src of want) {
    const norm = src.split(/[\\/]/).join('/');
    const cands = files.filter((f) => f.split(path.sep).join('/').endsWith(`/${norm}`));
    const f = cands.find((x) => /[\\/]src[\\/]main[\\/]/.test(x)) || cands[0];
    if (!f) continue;
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { /* 못 읽음 */ }
    out[src] = { path: path.relative(dir, f).split(path.sep).join('/'), text: text.length > 400000 ? text.slice(0, 400000) : text };
  }
  return out;
}

/** 기록 요약: 호출 · 줄 · SQL · 예외 수 */
function summary(trace) {
  const st = trace.steps || [];
  return { calls: st.filter((s) => s.call).length, lines: st.filter((s) => s.k === 'line').length, sql: st.filter((s) => s.k === 'sql').reduce((n, s) => n + ((s.x && s.x.qs) || []).length, 0), ex: st.filter((s) => s.k === 'ex').length };
}

/** 묶음 파일 쓰기 → 파일 경로 */
function writeBundle(root, bundle, slug) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dir = path.join(root, DIR, day);
  fs.mkdirSync(dir, { recursive: true });
  const stem = `${pad(d.getHours())}${pad(d.getMinutes())}-${String(slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'trace'}`;
  let file = path.join(dir, `${stem}.json`);
  for (let i = 2; fs.existsSync(file); i += 1) file = path.join(dir, `${stem}-${i}.json`);
  fs.writeFileSync(file, JSON.stringify(bundle));
  return file;
}

/** 기록 페이지 주소 */
function urlOf(root, port, file) {
  const rel = path.relative(path.join(root, DIR), file).split(path.sep).join('/').replace(/\.json$/, '.html');
  return `http://127.0.0.1:${port}/traces/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

// ───────── 실행 ─────────

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

function waitPort(host, port, ms) {
  const until = Date.now() + ms;
  return new Promise((resolve) => {
    const tryOnce = () => {
      const s = net.connect(port, host);
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => { s.destroy(); if (Date.now() > until) resolve(false); else setTimeout(tryOnce, 1000); });
    };
    tryOnce();
  });
}

function javaBin() {
  const home = process.env.JAVA_HOME;
  return home && fs.existsSync(path.join(home, 'bin', 'java')) ? path.join(home, 'bin', 'java') : 'java';
}

function initScript(file) {
  fs.writeFileSync(file, `// kedovi trace: 기록할 때만 쓰는 Gradle 초기화 스크립트 (빌드 파일은 고치지 않는다)
def port = System.getenv('KEDOVI_TRACE_PORT')
def sus = System.getenv('KEDOVI_TRACE_SUSPEND') ?: 'y'
def dep = System.getenv('KEDOVI_TRACE_SQL_DEP')
def agent = "-agentlib:jdwp=transport=dt_socket,server=y,suspend=\${sus},address=127.0.0.1:\${port}"
allprojects {
  plugins.withId('java') {
    if (dep) {
      dependencies { testRuntimeOnly dep; runtimeOnly dep }
    }
    tasks.withType(Test).configureEach {
      jvmArgs agent
      outputs.upToDateWhen { false }
      filter.failOnNoMatchingTests = false
      maxParallelForks = 1
    }
  }
  plugins.withId('org.springframework.boot') {
    tasks.matching { it.name == 'bootRun' }.configureEach { jvmArgs agent }
  }
}
`);
}

function killGroup(child) {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* 이미 끝남 */ } }
}

const wait = (child) => new Promise((resolve) => { if (child.exitCode !== null) resolve(child.exitCode); else child.once('exit', (c) => resolve(c)); });

function request(method, url, headers, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ method, hostname: u.hostname, port: u.port || 80, path: `${u.pathname}${u.search}`, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8').slice(0, 20000) }));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.setTimeout(300000, () => req.destroy(new Error('응답 시간 초과')));
    if (body) req.write(body);
    req.end();
  });
}

async function run(opts) {
  const { load } = require(path.join(__dirname, '..', '..', 'core', 'lib', 'workspace.js'));
  let ws = null;
  try { ws = load(); } catch { /* 워크스페이스 밖 (--dir 만) */ }
  const ROOT = ws ? ws.root : process.cwd();
  let dir = opts.dir ? path.resolve(opts.dir) : null;
  if (!dir && ws) {
    const repos = ws.repos || [];
    const r = opts.repo ? repos.find((x) => x.name === opts.repo) : repos.find((x) => buildTool(x.dir || '')) || null;
    if (opts.repo && !r) fail(`workspace.json repos 에 '${opts.repo}' 가 없습니다`);
    if (r) dir = r.dir;
  }
  if (!dir || !fs.existsSync(dir)) fail('기록할 repo 를 찾지 못했습니다. --repo <이름> 이나 --dir <경로> 를 주세요');
  const tool = buildTool(dir);
  if (!tool) fail(`${dir}: Gradle · Maven 프로젝트가 아닙니다 (지금은 JVM 만)`);
  const files = sourceFiles(dir);
  const include = opts.include ? opts.include.split(',').map((x) => x.trim()).filter(Boolean) : basePackages(dir, files);
  if (!include.length) fail('기록할 패키지를 찾지 못했습니다. --include com.example.app 처럼 주세요');
  const mode = opts.request ? 'request' : 'test';
  let entry = null;
  let entryFile = null;
  if (mode === 'test') {
    if (!opts.test || !opts.test.includes('#')) fail('사용법: kedovi trace run --test <클래스>#<메서드>');
    const [cls, method] = opts.test.split('#');
    const found = findClass(dir, cls, files);
    if (!found) fail(`테스트 클래스 ${cls} 를 ${dir} 에서 찾지 못했습니다`);
    entry = `${found.fqcn}#${method}`;
    entryFile = found.file;
    const pkg = found.fqcn.split('.').slice(0, -1).join('.');
    if (pkg && !include.some((p) => pkg === p || pkg.startsWith(`${p}.`))) include.push(pkg);
  }
  let reqMethod = null;
  let reqUrl = null;
  if (mode === 'request') {
    const m = String(opts.request).trim().match(/^([A-Za-z]+)\s+(\S+)$/);
    if (!m) fail('사용법: kedovi trace run --request "POST http://localhost:8080/api/orders" [--data \'{…}\']');
    reqMethod = m[1].toUpperCase();
    reqUrl = m[2];
    let u;
    try { u = new URL(reqUrl); } catch { fail(`주소가 아닙니다: ${reqUrl}`); }
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) fail('로컬 서버(localhost)만 기록합니다. 운영 · 개발 서버에는 붙지 않습니다');
  }

  const tmp = path.join(ROOT, DIR, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const stamp = Date.now();
  const outFile = path.join(tmp, `${stamp}.raw.json`);
  const logFile = path.join(tmp, `${stamp}.build.log`);
  const notes = [];
  const sqlOn = opts.sql !== 'off';
  const port = opts.attach ? Number(opts.attach) : await freePort();

  // 빌드 도구 실행
  let build = null;
  if (!opts.attach) {
    const env = { ...process.env, KEDOVI_TRACE_PORT: String(port), KEDOVI_TRACE_SUSPEND: mode === 'test' ? 'y' : 'n' };
    let cmd;
    let args;
    if (tool === 'gradle') {
      const init = path.join(tmp, 'trace-init.gradle');
      initScript(init);
      if (sqlOn) env.KEDOVI_TRACE_SQL_DEP = sqlStarter(bootMajor(dir));
      cmd = fs.existsSync(path.join(dir, 'gradlew')) ? path.join(dir, 'gradlew') : 'gradle';
      const proj = entryFile ? gradleProject(dir, entryFile) : (opts.module ? `:${opts.module}` : '');
      const task = (name) => (proj ? `${proj}:${name}` : name);
      args = ['-I', init, '--console=plain', ...(mode === 'test' ? [task('test'), '--tests', entry.replace('#', '.')] : [task('bootRun')])];
    } else {
      cmd = fs.existsSync(path.join(dir, 'mvnw')) ? path.join(dir, 'mvnw') : 'mvn';
      const agent = `-agentlib:jdwp=transport=dt_socket,server=y,suspend=${mode === 'test' ? 'y' : 'n'},address=127.0.0.1:${port}`;
      const mod = entryFile ? mavenModule(dir, entryFile) : (opts.module || '');
      args = [...(mod ? ['-pl', mod, '-am'] : []), ...(mode === 'test'
        ? ['test', `-Dtest=${entry.split('#')[0].split('.').pop()}#${entry.split('#')[1]}`, '-Dsurefire.failIfNoSpecifiedTests=false', `-Dmaven.surefire.debug=${agent}`]
        : ['spring-boot:run', `-Dspring-boot.run.jvmArguments=${agent}`])];
      if (sqlOn) notes.push('Maven: SQL 은 pom 에 datasource-proxy-spring-boot-starter(test 범위)가 있을 때만 보입니다');
    }
    const log = fs.openSync(logFile, 'w');
    build = spawn(cmd, args, { cwd: dir, env, detached: true, stdio: ['ignore', log, log] });
    build.on('error', (e) => { fs.appendFileSync(logFile, `\n${e.message}\n`); });
    process.stdout.write(`… ${tool} ${mode === 'test' ? `테스트 ${entry}` : '서버'} 실행 중 (로그 ${path.relative(ROOT, logFile)})\n`);
  }

  // 기록기
  const recArgs = ['--add-modules', 'jdk.jdi', RECORDER, '--port', String(port), '--include', include.join(','), '--out', outFile, '--mode', mode, '--max-steps', String(opts.maxSteps || 5000), '--max-hits', String(opts.maxHits || 30), '--attach-timeout', String(opts.timeout || 900)];
  if (entry) recArgs.push('--entry', entry);
  if (mode === 'request' && !opts.attach) recArgs.push('--exit-app');
  const rec = spawn(javaBin(), recArgs, { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  let recOut = '';
  let recErr = '';
  const seen = (word) => new Promise((resolve) => {
    const check = () => { if (recOut.includes(word)) resolve(true); };
    rec.stdout.on('data', check);
    rec.once('exit', () => resolve(recOut.includes(word)));
    check();
  });
  rec.stdout.on('data', (b) => { recOut += b.toString(); });
  rec.stderr.on('data', (b) => { recErr += b.toString(); });
  if (build) build.once('exit', () => { setTimeout(() => { if (rec.exitCode === null && !recOut.includes('ATTACHED')) rec.kill(); }, 3000); });
  const timer = setTimeout(() => { notes.push(`시간 상한(${opts.timeout || 900}초)에 닿아 멈춤`); rec.kill(); killGroup(build); }, (Number(opts.timeout) || 900) * 1000);

  let response = null;
  if (mode === 'request') {
    const ok = await seen('ATTACHED');
    if (!ok) { clearTimeout(timer); killGroup(build); fail(`서버 디버그 포트에 붙지 못했습니다.\n${tail(logFile)}${recErr}`); }
    const u = new URL(reqUrl);
    process.stdout.write(`… 서버가 ${u.host} 를 열 때까지 기다림\n`);
    const up = await waitPort(u.hostname.replace(/^\[|\]$/g, ''), Number(u.port || 80), (Number(opts.timeout) || 900) * 1000);
    if (!up) { rec.stdin.write('stop\n'); clearTimeout(timer); killGroup(build); fail(`서버가 열리지 않았습니다.\n${tail(logFile)}`); }
    rec.stdin.write('start\n');
    await seen('ARMED');
    const headers = {};
    for (const h of opts.headers || []) { const i = h.indexOf(':'); if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim(); }
    if (opts.data && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = /^\s*[[{]/.test(opts.data) ? 'application/json' : 'text/plain';
    process.stdout.write(`… ${reqMethod} ${reqUrl}\n`);
    response = await request(reqMethod, reqUrl, headers, opts.data);
    await new Promise((r) => setTimeout(r, 500)); // 응답 뒤 남은 처리
    rec.stdin.write('stop\n');
  }
  await wait(rec);
  clearTimeout(timer);
  try { rec.stdin.end(); } catch { /* 이미 닫힘 */ }
  if (build) {
    let t2;
    const done = await Promise.race([wait(build), new Promise((r) => { t2 = setTimeout(() => r('timeout'), mode === 'request' ? 15000 : 600000); })]);
    clearTimeout(t2);
    if (done === 'timeout') killGroup(build);
    else if (done !== 0) notes.push(mode === 'test' ? `테스트가 실패했습니다 (종료 코드 ${done}). 기록은 실패 지점까지` : `서버가 종료 코드 ${done} 로 끝났습니다`);
  }
  if (!fs.existsSync(outFile)) fail(`기록이 없습니다. ${mode === 'test' ? '테스트 이름 · 메서드를 확인하세요' : ''}\n${recErr}${tail(logFile)}`);
  const trace = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  if (!trace.steps.length) notes.push(mode === 'test' ? `시작 메서드 ${entry} 가 실행되지 않았습니다 (테스트가 건너뛰어졌거나 이름이 다름)` : '요청이 프로젝트 코드를 타지 않았습니다 (경로 · 포트 확인)');
  const bundle = {
    meta: {
      title: opts.title || (mode === 'test' ? entry.split('.').pop() : `${reqMethod} ${new URL(reqUrl).pathname}`),
      mode, entry, tool, repo: path.basename(dir), include, at: new Date().toISOString(),
      request: mode === 'request' ? { method: reqMethod, url: reqUrl, body: opts.data || null } : null,
      response, notes: [...notes, ...(trace.notes || [])], log: tail(logFile, 40),
    },
    trace,
    files: mapSources(dir, trace, files),
  };
  const file = writeBundle(ROOT, bundle, mode === 'test' ? entry.split('.').pop().replace('#', '-') : `${reqMethod}-${new URL(reqUrl).pathname}`);
  try { fs.unlinkSync(outFile); } catch { /* 없음 */ }
  const R = require(path.join(__dirname, '..', '..', 'core', 'lib', 'reports.js'));
  const url = urlOf(ROOT, R.ensureServer(ROOT), file);
  const s = summary(trace);
  console.log(`✔ 기록: 호출 ${s.calls} · 줄 ${s.lines} · SQL ${s.sql} · 예외 ${s.ex}${trace.truncated ? ' (상한에서 멈춤)' : ''}`);
  for (const n of bundle.meta.notes) console.log(`  ⚠ ${n}`);
  if (response) console.log(`  응답: ${response.status || response.error}`);
  console.log(`파일: ${path.relative(ROOT, file)}`);
  console.log(`링크: ${url}`);
}

function tail(file, n = 15) {
  try { return fs.readFileSync(file, 'utf8').trim().split('\n').slice(-n).join('\n'); } catch { return ''; }
}

function fail(msg) { console.error(`✖ ${msg}`); process.exit(1); }

function list(root) {
  const base = path.join(root, DIR);
  const out = [];
  (function walk(d) {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && e.name !== 'tmp') walk(p);
      else if (e.name.endsWith('.json')) out.push({ file: p, mtime: fs.statSync(p).mtimeMs });
    }
  })(base);
  return out.sort((a, b) => b.mtime - a.mtime);
}

function main() {
  const argv = process.argv.slice(2);
  const opts = { headers: [] };
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-H' || a === '--header') { opts.headers.push(argv[i + 1]); i += 1; } else if (a.startsWith('--')) {
      const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      opts[k] = argv[i + 1];
      i += 1;
    } else pos.push(a);
  }
  const { load } = require(path.join(__dirname, '..', '..', 'core', 'lib', 'workspace.js'));
  let root = process.cwd();
  try { root = load().root; } catch { /* 밖 */ }
  const cmd = pos[0];
  if (cmd === 'run') return run(opts).catch((e) => fail(e.stack || e.message));
  if (cmd === 'list' || !cmd) {
    const items = list(root).slice(0, Number(opts.n) || 10);
    if (!items.length) { console.log('기록이 없습니다 (kedovi trace run --test <클래스>#<메서드>)'); return undefined; }
    const R = require(path.join(__dirname, '..', '..', 'core', 'lib', 'reports.js'));
    const st = R.readState(root);
    const port = st && st.pid && R.alive(st.pid) ? st.port : null;
    for (const it of items) {
      let title = '';
      try { title = JSON.parse(fs.readFileSync(it.file, 'utf8')).meta.title; } catch { /* 깨짐 */ }
      console.log(`${new Date(it.mtime).toLocaleString()} · ${title} · ${port ? urlOf(root, port, it.file) : path.relative(root, it.file)}`);
    }
    return undefined;
  }
  if (cmd === 'open') {
    const f = pos[1] ? path.resolve(pos[1]) : (list(root)[0] || {}).file;
    if (!f) { console.log('기록이 없습니다'); return undefined; }
    const R = require(path.join(__dirname, '..', '..', 'core', 'lib', 'reports.js'));
    const u = urlOf(root, R.ensureServer(root), f);
    console.log(u);
    const opener = process.platform === 'darwin' ? ['open', [u]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', u]] : ['xdg-open', [u]];
    spawnSync(opener[0], opener[1], { stdio: 'ignore' });
    return undefined;
  }
  return fail('사용법: kedovi trace run --test <클래스>#<메서드> · run --request "<METHOD> <주소>" · list · open [파일]');
}

module.exports = { buildTool, sourceFiles, packageOf, basePackages, findClass, gradleProject, mavenModule, bootMajor, sqlStarter, mapSources, summary, urlOf };
if (require.main === module) main();
