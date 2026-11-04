#!/usr/bin/env node
/**
 * 쓰기 보고서 (kedovi writes): 시험이 DB 에 쓴 것을 보고 기대값으로 고정한다. 형식 정본 packs/core/assets/write-report/FORMAT.md
 *
 *   kedovi writes add jooq|jdbc|sqlalchemy|node-pg [--repo R] [--dir 모듈] [--dry-run] [--json]
 *       기록기 파일을 repo 에 넣는다 (스택 팩의 assets/write-report/<스택>/manifest.json 대로). 있는 파일은 덮지 않고,
 *       merge: properties 는 없는 키만 더한다. 값은 workspace.json vars (spring.basePackage · fastapi.package)
 *   kedovi writes check [--repo R] [--report <index.json>] [--json] [--strict]
 *       쓰기 보고서 ↔ 기획 repo 기능 문서의 「저장」 표 대조 (기능 ID 별): 표에 없는 쓰기 · 안 쓴 컬럼 · 타입 범위 위험. --strict 면 위반 시 exit 1
 *   kedovi writes open [--repo R] [--no-open]
 *       최신 보고서 화면(index.html) 경로를 찍고 연다
 *
 * Node 기본 모듈만 쓴다. 팩 폴더는 KEDOVI_WRITES_PACKS 로 바꿀 수 있다 (시험용).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const W = require('../lib/writes');
const AR = require('./archrules');

const PACKS = () => process.env.KEDOVI_WRITES_PACKS || path.resolve(__dirname, '..', '..');

/** 스택 → 팩 · repo 고르기 (stack 이름 목록, 앞에 있는 것 먼저) */
const STACKS = {
  jooq: { pack: 'stack-spring', repoStacks: ['spring'], values: 'spring' },
  jdbc: { pack: 'stack-spring', repoStacks: ['spring'], values: 'spring' },
  sqlalchemy: { pack: 'backend', repoStacks: ['fastapi', 'django', 'flask', 'python'], values: 'fastapi' },
  'node-pg': { pack: 'backend', repoStacks: ['express', 'nestjs', 'nextjs', 'node'], values: 'node' },
};
const ADD_USAGE = 'kedovi writes add jooq|jdbc|sqlalchemy|node-pg [--repo R] [--dir 모듈] [--dry-run] [--json]';

function parse(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith('--')) {
      const k = x.slice(2);
      if (['dry-run', 'json', 'help', 'strict', 'no-open'].includes(k)) a[k] = true;
      else a[k] = argv[++i];
    } else a._.push(x);
  }
  return a;
}

const codeRepos = (ws) => (ws.repos || []).filter((r) => (r.kind || 'code') === 'code');
const stackOf = (r) => (Array.isArray(r.stack) ? r.stack.join(',') : String(r.stack || ''));

/** 스택에 맞는 repo: --repo · vars.<스택>.repo · stack 이름 목록 순 */
function pickRepo(ws, stack, name) {
  const s = STACKS[stack];
  if (name) return AR.pickRepo(ws, s.repoStacks[0], name);
  for (const st of s.repoStacks) {
    try { return AR.pickRepo(ws, st, null); } catch { /* 다음 스택 */ }
  }
  throw new Error(`stack 에 ${s.repoStacks.join(' · ')} 중 하나가 든 repo 가 없습니다. --repo <이름> 으로 지정합니다`);
}

/** 토큰 값: __BASE_PACKAGE__ · __BASE_PATH__ (Java) · __PACKAGE__ (Python) */
function values(ws, stack, a) {
  const s = STACKS[stack];
  const dir = a.dir ? String(a.dir).replace(/\/$/, '') : '.';
  if (s.values === 'spring') {
    const v = AR.values(ws, 'spring', a);
    return { dir, basePackage: v.basePackage, tokens: { __BASE_PACKAGE__: v.basePackage, __BASE_PATH__: v.basePackage.split('.').join('/') } };
  }
  if (s.values === 'fastapi') {
    const v = AR.values(ws, 'fastapi', a);
    return { dir, package: v.package, tokens: { __PACKAGE__: v.package } };
  }
  return { dir, tokens: {} };
}

function manifestOf(stack) {
  const s = STACKS[stack];
  const base = path.join(PACKS(), s.pack, 'assets', 'write-report');
  const file = path.join(base, stack, 'manifest.json');
  if (!fs.existsSync(path.join(PACKS(), s.pack))) throw new Error(`이 워크스페이스에는 ${s.pack} 팩이 없습니다. 켜기: kedovi upgrade --add ${s.pack}`);
  if (!fs.existsSync(file)) throw new Error(`${stack} 기록기가 없습니다 (${path.relative(PACKS(), file)}). kedovi upgrade 후 다시`);
  let m;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${path.relative(PACKS(), file)} 를 읽지 못했습니다: ${e.message}`); }
  return { m, base };
}

const render = (text, tokens) => Object.entries(tokens).reduce((t, [k, val]) => t.split(k).join(val), text);

/**
 * properties 합치기: 지금 파일에 없는 키의 줄만 끝에 더한다. 반환 { text, added: [키] }.
 * list = true (spring.factories): 키가 이미 있으면 쉼표 목록에 없는 값만 덧붙인다 (그 키 줄은 한 줄로 다시 쓴다)
 */
function mergeProperties(cur, add, list = false) {
  // 논리 줄: 끝이 \ 인 줄은 다음 줄과 잇는다
  const logical = (text) => {
    const out = [];
    let buf = null;
    for (const l of text.split('\n')) {
      if (buf !== null) { buf.raw.push(l); buf.text += l.trim().replace(/\\$/, ''); if (!/\\$/.test(l)) { out.push(buf); buf = null; } continue; }
      const it = { raw: [l], text: l.replace(/\\$/, '') };
      if (/\\$/.test(l) && !/^\s*[#!]/.test(l)) buf = it; else out.push(it);
    }
    if (buf) out.push(buf);
    return out;
  };
  const kv = (t) => { const m = /^\s*([^#!\s][^=:\s]*)\s*(?:[=:]\s*|\s+|$)(.*)$/.exec(t); return m ? { key: m[1], value: m[2].trim() } : null; };
  const lines = logical(cur);
  const have = new Map();
  lines.forEach((l, i) => { const x = kv(l.text); if (x && !have.has(x.key)) have.set(x.key, i); });
  const added = [];
  const extra = [];
  for (const l of logical(add)) {
    const x = kv(l.text);
    if (!x) continue;
    if (!have.has(x.key)) { have.set(x.key, -1); added.push(x.key); extra.push(...l.raw); continue; }
    if (!list || have.get(x.key) < 0) continue;
    const at = lines[have.get(x.key)];
    const old = kv(at.text);
    const vals = old.value.split(',').map((v) => v.trim()).filter(Boolean);
    const more = x.value.split(',').map((v) => v.trim()).filter((v) => v && !vals.includes(v));
    if (!more.length) continue;
    at.raw = [`${old.key}=${[...vals, ...more].join(',')}`];
    at.text = at.raw[0];
    added.push(`${x.key} (+${more.length})`);
  }
  if (!added.length) return { text: cur, added };
  const body = lines.map((l) => l.raw.join('\n')).join('\n');
  return { text: extra.length ? `${body}${body && !body.endsWith('\n') ? '\n' : ''}# kedovi writes add 가 더함\n${extra.join('\n')}\n` : body, added };
}

/** 쓸 파일: [{ to, path, content, exists, merge, added }] */
function plan(stack, repoDir, v) {
  const { m, base } = manifestOf(stack);
  return (m.files || []).map((f) => {
    const src = String(f.from).startsWith('core:') ? path.join(PACKS(), 'core', 'assets', 'write-report', f.from.slice(5)) : path.join(base, f.from);
    if (!fs.existsSync(src)) throw new Error(`manifest 의 파일이 없습니다: ${path.relative(PACKS(), src)}`);
    const content = render(fs.readFileSync(src, 'utf8'), v.tokens);
    const to = path.posix.join(v.dir, render(f.to, v.tokens));
    const abs = path.join(repoDir, to);
    const exists = fs.existsSync(abs);
    const it = { to, path: abs, content, exists, merge: f.merge || null };
    if (exists && f.merge === 'properties') {
      const r = mergeProperties(fs.readFileSync(abs, 'utf8'), content, /\.factories$/.test(abs));
      it.content = r.text; it.added = r.added;
    }
    return it;
  });
}

function write(items) {
  for (const it of items) {
    if (it.exists && !(it.merge && it.added && it.added.length)) continue;
    fs.mkdirSync(path.dirname(it.path), { recursive: true });
    fs.writeFileSync(it.path, it.content);
  }
}

function cmdAdd(ws, a) {
  const stack = a._[1];
  if (!stack || !STACKS[stack]) { console.error(`${stack ? `모르는 스택: ${stack}\n` : ''}사용법: ${ADD_USAGE}`); return 2; }
  let repo, v, items, m;
  try {
    repo = pickRepo(ws, stack, a.repo);
    v = values(ws, stack, a);
    if (!fs.existsSync(repo.dir)) throw new Error(`${repo.name}: 폴더가 없습니다 (${repo.dir}). kedovi install 뒤 다시`);
    m = manifestOf(stack).m;
    items = plan(stack, repo.dir, v);
  } catch (e) { console.error(`✖ ${e.message}`); return 1; }
  if (!a['dry-run']) write(items);
  const list = (x) => [].concat(x || []).map((s) => render(String(s), v.tokens));
  const next = { deps: list(m.deps), after: list(m.after), run: m.run ? render(m.run, v.tokens) : '', approve: m.approve ? render(m.approve, v.tokens) : '' };
  const state = (it) => (it.exists ? (it.added && it.added.length ? (a['dry-run'] ? `+ 키 더할 것 ${it.added.join(', ')}` : `✔ 키 더함 ${it.added.join(', ')}`) : '· 있음 (덮지 않음)') : a['dry-run'] ? '+ 만들 파일' : '✔ 만듦');
  if (a.json) {
    console.log(JSON.stringify({ stack, repo: repo.name, dryRun: !!a['dry-run'], title: m.title || stack, tokens: v.tokens, files: items.map((x) => ({ path: x.to, exists: x.exists, written: !a['dry-run'] && (!x.exists || !!(x.added && x.added.length)), added: x.added || [] })), next }, null, 2));
    return 0;
  }
  const opt = v.basePackage ? ` · 기준 패키지 ${v.basePackage}` : v.package ? ` · 패키지 ${v.package}` : '';
  console.log(`${a['dry-run'] ? '미리보기 (쓰지 않음)' : '쓰기 보고서 기록기'}: ${repo.name} · ${m.title || stack}${opt}`);
  for (const it of items) console.log(`  ${state(it)} ${it.to}`);
  console.log('다음');
  for (const d of next.deps) console.log(`  의존성: ${d}`);
  for (const d of next.after) console.log(`  ${d}`);
  if (next.run) console.log(`  실행: ${next.run}  → 보고서 ${W.REPORT_DIRS.join(' · ')} 중 하나 (kedovi writes open)`);
  if (next.approve) console.log(`  기대값 고정: ${next.approve}  (핵심 테이블만 고르고, 바꾸기 전에 사용자에게 차이를 보인다)`);
  console.log('  저장 표 대조: kedovi writes check');
  return 0;
}

// ───────── check ─────────

/** 기획 repo(kind: docs) 의 md 전부 { 'repo/경로': 내용 } */
function docsFiles(ws) {
  const out = {};
  for (const r of (ws.repos || []).filter((x) => x.kind === 'docs')) {
    if (!fs.existsSync(r.dir)) continue;
    (function walk(rel) {
      for (const e of fs.readdirSync(path.join(r.dir, rel), { withFileTypes: true })) {
        if (['.git', 'node_modules', 'docs-site', 'html', 'originals'].includes(e.name)) continue;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(p);
        else if (/\.md$/i.test(e.name)) out[`${r.name}/${p}`] = fs.readFileSync(path.join(r.dir, p), 'utf8');
      }
    })('');
  }
  return out;
}

/** 데이터 설계 정의서 모델 (타입을 보고서 catalog 에서 못 찾을 때) */
function dataModel(files) {
  try {
    const DM = require('../lib/datamodel');
    return DM.model(Object.fromEntries(Object.entries(files).filter(([, t]) => DM.hasTables(t))));
  } catch { return null; }
}

const HOW_TO = (repo) => `보고서 없음${repo ? ` (${repo})` : ''}. 만들기: kedovi writes add jooq|jdbc|sqlalchemy|node-pg 로 기록기를 넣고 시험을 돌린다 (출력 ${W.REPORT_DIRS.join(' · ')})`;

/** 대상 보고서들: [{ repo, module, index, html }] */
function reportsFor(ws, a) {
  if (a.report) {
    const f = path.resolve(String(a.report));
    if (!fs.existsSync(f)) throw new Error(`보고서가 없습니다: ${f}`);
    return [{ repo: a.repo || path.basename(path.dirname(f)), module: '.', index: f, html: fs.existsSync(path.join(path.dirname(f), 'index.html')) ? path.join(path.dirname(f), 'index.html') : null }];
  }
  const repos = a.repo ? codeRepos(ws).filter((r) => r.name === a.repo) : codeRepos(ws);
  if (a.repo && !repos.length) throw new Error(`workspace.json repos 에 코드 repo '${a.repo}' 가 없습니다`);
  return repos.flatMap((r) => W.findReports(r.dir).map((x) => ({ repo: r.name, ...x })));
}

const pad = (s, n) => { const t = String(s); const w = [...t].reduce((k, c) => k + (/[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(c) ? 2 : 1), 0); return t + ' '.repeat(Math.max(1, n - w)); };

function cmdCheck(ws, a) {
  let reports;
  try { reports = reportsFor(ws, a); } catch (e) { console.error(`✖ ${e.message}`); return 1; }
  if (!reports.length) {
    if (a.json) console.log(JSON.stringify({ reports: [], message: HOW_TO(a.repo) }, null, 2));
    else console.log(HOW_TO(a.repo));
    return a.strict ? 1 : 0;
  }
  const files = docsFiles(ws);
  const feats = W.features(files);
  const withSave = feats.filter((f) => f.save);
  const dm = dataModel(files);
  const results = [];
  for (const r of reports) {
    let rep;
    try { rep = W.loadReport(r.index); } catch (e) { console.error(`✖ ${e.message}`); return 1; }
    results.push({ ...r, generatedAt: rep.generatedAt || '', stack: rep.stack || '', tests: (rep.tests || []).length, ...W.check(rep, feats, { datamodel: dm }) });
  }
  const violations = results.reduce((n, x) => n + x.violations, 0);
  if (a.json) {
    console.log(JSON.stringify({ features: feats.length, withSave: withSave.length, violations, reports: results.map((x) => ({ repo: x.repo, module: x.module, index: x.index, generatedAt: x.generatedAt, tests: x.tests, violations: x.violations, groups: x.groups, noTests: x.noTests })) }, null, 2));
    return a.strict && violations ? 1 : 0;
  }
  if (!withSave.length) console.log(`⚠ 기능 문서에 「### 저장」 표가 없습니다 (기능 절 ${feats.length}개). 표에 없는 쓰기만 셉니다. 표 모양: 기획 repo 20-features/_template.md`);
  for (const x of results) {
    console.log(`\n■ 보고서: ${x.repo}${x.module !== '.' ? `/${x.module}` : ''} · ${x.stack || '스택 모름'} · 시험 ${x.tests}개${x.generatedAt ? ` · ${x.generatedAt}` : ''}`);
    console.log(`  ${path.relative(process.cwd(), x.index) || x.index}`);
    for (const g of x.groups) {
      const bad = g.unlisted.length + g.risks.filter((r) => r.level === '✖').length;
      const mark = bad ? '✖' : g.unused.length || g.risks.length || g.noSave ? '⚠' : '✔';
      console.log(`\n${mark} ${g.id || '(기능 ID 없음)'} ${g.title}${g.doc ? `  ${g.doc}:${g.line}` : ''}  시험 ${g.tests.length}개`);
      if (g.noSave && g.unlisted.length) console.log('  이 기능 절에 「### 저장」 표가 없습니다 (저장이 없으면 「없음」)');
      if (g.saveNone && g.unlisted.length) console.log('  저장 표가 「없음」 인데 시험이 썼습니다');
      if (g.unlisted.length) {
        console.log(`  ■ 표에 없는 쓰기 ${g.unlisted.length}`);
        for (const u of g.unlisted) console.log(`    ${pad(`${u.table}.${u.column}`, 40)}${pad(u.ops.join(','), 10)}${u.tests.slice(0, 2).join(' · ')}${u.tests.length > 2 ? ` 외 ${u.tests.length - 2}` : ''}`);
      }
      if (g.unused.length) {
        console.log(`  ■ 안 쓴 컬럼 ${g.unused.length} (저장 표에 있는데 시험이 쓰지 않음: 시험하지 않은 분기일 수 있다)`);
        for (const u of g.unused) console.log(`    ${pad(u.target, 40)}${u.cond ? `조건: ${u.cond}` : ''}`);
      }
      if (g.risks.length) {
        console.log(`  ■ 타입 범위 위험 ${g.risks.length}`);
        for (const r of g.risks) console.log(`    ${r.level} ${pad(`${r.table}${r.column ? `.${r.column}` : ''}`, 38)}${pad(r.type, 16)}${r.why}${r.value != null ? `  (값 ${W.showValue(r.value)})` : ''}`);
      }
      if (g.unknown) console.log(`  · 컬럼을 모르는 문장 ${g.unknown}개 (INSERT SELECT · plain SQL 등): 보고서 화면에서 직접 본다`);
    }
    if (x.noTests.length) console.log(`\n⚠ 저장 표는 있는데 이 보고서에 시험이 없는 기능 ${x.noTests.length}: ${x.noTests.slice(0, 8).map((f) => f.id).join(' · ')}${x.noTests.length > 8 ? ' …' : ''} (시험에 기능 ID 를 붙인다: @spec · 태그 · 시험 이름)`);
  }
  console.log(`\n${violations ? `✖ 위반 ${violations}건 (표에 없는 쓰기 · ✖ 타입 범위)` : '✔ 위반 없음'}. 저장 표가 맞으면 코드를, 코드가 맞으면 기능 문서의 저장 표를 고친다 (판단이 안 되면 사용자에게 묻는다)`);
  return a.strict && violations ? 1 : 0;
}

// ───────── open ─────────

function cmdOpen(ws, a) {
  let reports;
  try { reports = reportsFor(ws, a); } catch (e) { console.error(`✖ ${e.message}`); return 1; }
  const r = reports.find((x) => x.html);
  if (!r) { console.log(reports.length ? `화면(index.html)이 없습니다: ${reports[0].dir}. 시험을 끝까지 돌리면 함께 만든다` : HOW_TO(a.repo)); return 1; }
  console.log(`${r.repo}${r.module !== '.' ? `/${r.module}` : ''}: ${r.html}`);
  if (reports.filter((x) => x.html).length > 1) console.log(`  다른 보고서: ${reports.filter((x) => x.html && x !== r).map((x) => `${x.repo}${x.module !== '.' ? `/${x.module}` : ''}`).join(' · ')} (--repo 로 고른다)`);
  if (!a['no-open'] && !process.env.KEDOVI_NO_OPEN) {
    const opener = process.platform === 'darwin' ? ['open', [r.html]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', r.html]] : ['xdg-open', [r.html]];
    try { require('child_process').spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch { /* 경로는 위에 찍었다 */ }
  }
  return 0;
}

function usage() {
  return `사용법\n  ${ADD_USAGE}\n      기록기를 repo 에 넣는다 (있는 파일은 덮지 않는다, 설정 파일은 없는 키만 더한다)\n`
    + '  kedovi writes check [--repo R] [--report <index.json>] [--json] [--strict]\n      쓰기 보고서 ↔ 기능 문서 「저장」 표: 표에 없는 쓰기 · 안 쓴 컬럼 · 타입 범위 위험 (기능 ID 별)\n'
    + '  kedovi writes open [--repo R] [--no-open]\n      최신 보고서 화면 열기';
}

function main(argv) {
  const a = parse(argv);
  const cmd = a._[0];
  if (a.help || !cmd) { console.log(usage()); return cmd || a.help ? 0 : 2; }
  if (!['add', 'check', 'open'].includes(cmd)) { console.error(`모르는 명령: ${cmd}\n${usage()}`); return 2; }
  const ws = require('../lib/workspace').load();
  if (cmd === 'add') return cmdAdd(ws, a);
  if (cmd === 'check') return cmdCheck(ws, a);
  return cmdOpen(ws, a);
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { STACKS, parse, pickRepo, values, plan, write, mergeProperties, main };
