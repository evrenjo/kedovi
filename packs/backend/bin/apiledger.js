#!/usr/bin/env node
/**
 * 외부 API 동작 장부 (kedovi apiledger). 형식 정본 packs/backend/assets/api-ledger/FORMAT.md
 *
 *   kedovi apiledger add node|python|java [--repo R] [--dir 모듈] [--dry-run] [--json]
 *       장부 예시 · 시뮬레이터(스텁) · 장부 대조 시험 · 실패 주입 세트 · CI 작업 예시를 repo 에 넣는다 (있는 파일은 덮지 않는다)
 *   kedovi apiledger check [--repo R | --file 장부] [--stale-days N] [--covered covered.json] [--strict] [--json]
 *       형식 · 미확인(unverified) 목록 · 확인일이 오래된 것 · timeout 근거 · 시험이 장부 항목을 다 다루는지(.api-ledger/covered.json).
 *       형식 오류면 exit 1, --strict 면 오래된 확인일 · 시험이 안 다룬 항목도 exit 1
 *
 * Node 기본 모듈만 쓴다. 팩 폴더는 KEDOVI_APILEDGER_PACKS 로 바꿀 수 있다 (시험용).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('../lib/apiledger');

const PACKS = () => process.env.KEDOVI_APILEDGER_PACKS || path.resolve(__dirname, '..', '..');
const ASSETS = () => path.join(PACKS(), 'backend', 'assets', 'api-ledger');

/** 스택 → repo 고르기 (repo stack 이름, 앞에 있는 것 먼저) */
const STACKS = {
  node: { repoStacks: ['express', 'nestjs', 'nextjs', 'node'] },
  python: { repoStacks: ['fastapi', 'django', 'flask', 'python'] },
  java: { repoStacks: ['spring', 'java'] },
};
const USAGE = [
  '사용법',
  '  kedovi apiledger add node|python|java [--repo R] [--dir 모듈] [--dry-run] [--json]   장부 · 시뮬레이터 · 대조 시험 · 실패 주입 · CI 작업을 repo 에',
  '  kedovi apiledger check [--repo R | --file 장부] [--stale-days N] [--covered 파일] [--strict] [--json]   형식 · 미확인 · 오래된 확인일 · timeout 근거 · 시험 대조',
].join('\n');

function parse(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith('--')) {
      const k = x.slice(2);
      if (['dry-run', 'json', 'help', 'strict'].includes(k)) a[k] = true;
      else a[k] = argv[++i];
    } else a._.push(x);
  }
  return a;
}

const get = (obj, key) => key.split('.').reduce((c, k) => (c && typeof c === 'object' ? c[k] : undefined), obj);
const codeRepos = (ws) => (ws.repos || []).filter((r) => (r.kind || 'code') === 'code');
const stackOf = (r) => (Array.isArray(r.stack) ? r.stack.join(',') : String(r.stack || ''));
const render = (text, tokens) => Object.entries(tokens).reduce((t, [k, v]) => t.split(k).join(v), text);

function pickRepo(ws, stack, name) {
  const code = codeRepos(ws);
  if (name) {
    const r = code.find((x) => x.name === name);
    if (!r) throw new Error(`workspace.json repos 에 코드 repo '${name}' 가 없습니다`);
    return r;
  }
  for (const st of STACKS[stack].repoStacks) {
    const r = code.find((x) => new RegExp(`(^|[^a-z])${st}([^a-z]|$)`, 'i').test(stackOf(x)));
    if (r) return r;
  }
  throw new Error(`stack 에 ${STACKS[stack].repoStacks.join(' · ')} 중 하나가 든 repo 가 없습니다. --repo <이름> 으로 지정합니다`);
}

function tokensFor(ws, stack, a) {
  if (stack !== 'java') return {};
  const pkg = a.package || get(ws.vars, 'spring.basePackage') || 'com.example.app';
  if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/.test(pkg)) throw new Error(`spring.basePackage 가 Java 패키지 이름이 아닙니다: ${pkg}`);
  return { __BASE_PACKAGE__: pkg, __BASE_PATH__: pkg.split('.').join('/') };
}

function manifestOf(stack) {
  const file = path.join(ASSETS(), stack, 'manifest.json');
  if (!fs.existsSync(file)) throw new Error(`${stack} 템플릿이 없습니다 (${path.relative(PACKS(), file)}). kedovi upgrade 후 다시`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 쓸 파일: [{ to, path, content, exists }] */
function plan(stack, repoDir, dir, tokens) {
  const m = manifestOf(stack);
  const all = { ...tokens, __FAULTS_CMD__: m.faults || '' };
  return (m.files || []).map((f) => {
    const src = f.from.startsWith('lib:') ? path.join(PACKS(), 'backend', 'lib', f.from.slice(4)) : path.join(ASSETS(), f.from);
    if (!fs.existsSync(src)) throw new Error(`manifest 의 파일이 없습니다: ${path.relative(PACKS(), src)}`);
    let content = render(fs.readFileSync(src, 'utf8'), all);
    for (const [k, v] of Object.entries(f.replace || {})) content = content.split(k).join(v);
    const to = path.posix.join(dir, render(f.to, all));
    const abs = path.join(repoDir, to);
    return { to, path: abs, content, exists: fs.existsSync(abs) };
  });
}

function cmdAdd(ws, a) {
  const stack = a._[1];
  if (!stack || !STACKS[stack]) { console.error(`${stack ? `모르는 스택: ${stack}\n` : ''}${USAGE}`); return 2; }
  let repo, items, m;
  try {
    repo = pickRepo(ws, stack, a.repo);
    if (!fs.existsSync(repo.dir)) throw new Error(`${repo.name}: 폴더가 없습니다 (${repo.dir}). kedovi install 뒤 다시`);
    m = manifestOf(stack);
    items = plan(stack, repo.dir, a.dir ? String(a.dir).replace(/\/$/, '') : '.', tokensFor(ws, stack, a));
  } catch (e) { console.error(`✖ ${e.message}`); return 1; }
  if (!a['dry-run']) for (const it of items.filter((x) => !x.exists)) { fs.mkdirSync(path.dirname(it.path), { recursive: true }); fs.writeFileSync(it.path, it.content); }
  if (a.json) {
    console.log(JSON.stringify({ stack, repo: repo.name, dryRun: !!a['dry-run'], title: m.title, files: items.map((x) => ({ path: x.to, exists: x.exists, written: !x.exists && !a['dry-run'] })), deps: m.deps || [], after: m.after || [], run: m.run || '', faults: m.faults || '' }, null, 2));
    return 0;
  }
  console.log(`${a['dry-run'] ? '미리보기 (쓰지 않음)' : '외부 API 장부'}: ${repo.name} · ${m.title}`);
  for (const it of items) console.log(`  ${it.exists ? '· 있음 (덮지 않음)' : a['dry-run'] ? '+ 만들 파일' : '✔ 만듦'} ${it.to}`);
  console.log('다음');
  for (const d of m.deps || []) console.log(`  의존성: ${d}`);
  for (const d of m.after || []) console.log(`  ${d}`);
  if (m.run) console.log(`  대조 시험: ${m.run}  (일반 test 안에서 돈다)`);
  if (m.faults) console.log(`  실패 주입: ${m.faults}  (CI 전용 작업 api-faults, test 와 병렬)`);
  console.log('  장부 검사: kedovi apiledger check');
  return 0;
}

// ───────── check ─────────

/** 검사 대상 장부: [{ repo, file }] */
function targets(ws, a) {
  if (a.file) return [{ repo: '', file: path.resolve(a.file) }];
  const rel = get(ws.vars, 'apiLedger.path') || 'api-ledger.yaml';
  const repos = a.repo ? codeRepos(ws).filter((r) => r.name === a.repo) : codeRepos(ws);
  if (a.repo && !repos.length) throw new Error(`workspace.json repos 에 코드 repo '${a.repo}' 가 없습니다`);
  const out = [];
  for (const r of repos) {
    if (!fs.existsSync(r.dir)) continue;
    const top = path.join(r.dir, rel);
    if (fs.existsSync(top)) { out.push({ repo: r.name, file: top }); continue; }
    // 멀티 모듈: 한 단계 아래 모듈의 장부
    for (const e of fs.readdirSync(r.dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const f = path.join(r.dir, e.name, rel);
      if (fs.existsSync(f)) out.push({ repo: `${r.name}/${e.name}`, file: f });
    }
  }
  return out;
}

function checkOne(t, ws, a) {
  const res = { repo: t.repo, file: t.file };
  let ledger;
  try { ledger = L.load(fs.readFileSync(t.file, 'utf8')); } catch (e) { return { ...res, errors: [{ key: '', msg: `읽지 못함: ${e.message}` }], warnings: [], unverified: [], stale: [], coverage: null, counts: {} }; }
  const staleDays = Number(a['stale-days'] || (ledger && ledger.staleDays) || get(ws.vars, 'apiLedger.staleDays') || 30);
  const r = L.check(ledger, { staleDays, today: a.today ? new Date(`${a.today}T00:00:00Z`) : new Date() });
  const covFile = a.covered ? path.resolve(a.covered) : path.join(path.dirname(t.file), '.api-ledger', 'covered.json');
  let coverage = null;
  if (fs.existsSync(covFile)) {
    try {
      const cov = JSON.parse(fs.readFileSync(covFile, 'utf8'));
      coverage = { file: covFile, ...L.coverage(ledger, cov), older: fs.statSync(covFile).mtimeMs < fs.statSync(t.file).mtimeMs, hasFaults: Array.isArray(cov.faults) };
    } catch (e) { coverage = { file: covFile, error: e.message }; }
  }
  return { ...res, ...r, coverage };
}

function cmdCheck(ws, a) {
  let list;
  try { list = targets(ws, a); } catch (e) { console.error(`✖ ${e.message}`); return 1; }
  if (!list.length) {
    const msg = '외부 API 장부가 없습니다. 만들기: kedovi apiledger add node|python|java';
    if (a.json) console.log(JSON.stringify({ ledgers: [], message: msg }, null, 2)); else console.log(msg);
    return 0;
  }
  const results = list.map((t) => checkOne(t, ws, a));
  let fail = false;
  for (const r of results) {
    if (r.errors.length) fail = true;
    if (a.strict && (r.stale.length || (r.coverage && !r.coverage.error && (r.coverage.missing.length || r.coverage.missingFaults.length)))) fail = true;
  }
  if (a.json) { console.log(JSON.stringify({ ledgers: results, ok: !fail }, null, 2)); return fail ? 1 : 0; }
  for (const r of results) {
    const c = r.counts || {};
    console.log(`${r.errors.length ? '✖' : '✔'} ${r.repo ? `${r.repo}: ` : ''}${path.basename(r.file)} · API ${c.apis || 0} · 엔드포인트 ${c.endpoints || 0} · 동작 ${c.behaviors || 0} (실측 ${c.measured || 0} · 미확인 ${c.unverified || 0}) · 확인일 기준 ${r.staleDays || '-'}일`);
    for (const e of r.errors) console.log(`  ✖ ${e.key ? `${e.key}: ` : ''}${e.msg}`);
    for (const w of r.warnings) console.log(`  ⚠ ${w.key}: ${w.msg}`);
    if (r.stale.length) {
      console.log(`  재확인 (확인일 ${r.staleDays}일 지남)`);
      for (const s of r.stale) console.log(`    ${s.key} · ${s.checked} (${s.days}일 전)`);
    }
    if (r.unverified.length) {
      console.log('  미확인 (코드가 기대하면 안 됨 · 시뮬레이터는 최악으로 응답)');
      for (const u of r.unverified) console.log(`    ${u.key}${u.kind ? ` [${u.kind}]` : ''} ${u.what}`);
    }
    if (!r.coverage) console.log('  시험 대조: .api-ledger/covered.json 없음 (대조 시험 · 실패 주입을 돌리면 생긴다)');
    else if (r.coverage.error) console.log(`  시험 대조: covered.json 을 읽지 못함 (${r.coverage.error})`);
    else {
      const cv = r.coverage;
      if (!cv.missing.length && !cv.missingFaults.length && !cv.unknown.length) console.log(`  ✔ 시험 대조: 장부 항목을 모두 다룸${cv.hasFaults ? ' (실패 주입 포함)' : ' (실패 주입 기록 없음)'}`);
      for (const k of cv.missing) console.log(`  ⚠ 시험이 안 다룬 동작: ${k}`);
      for (const k of cv.missingFaults) console.log(`  ⚠ 실패 주입이 안 돈 항목: ${k}`);
      for (const k of cv.unknown) console.log(`  ⚠ 장부에 없는 항목을 시험이 기록: ${k} (장부에서 지웠으면 시험을 다시)`);
      if (cv.older) console.log('  ⚠ 장부가 마지막 시험 뒤에 바뀌었다: 대조 시험을 다시 돌린다');
    }
  }
  return fail ? 1 : 0;
}

function main(argv) {
  const a = parse(argv);
  const sub = a._[0];
  if (a.help || !sub) { console.log(USAGE); return sub || a.help ? 0 : 2; }
  if (sub === 'check' && a.file) return cmdCheck({ vars: {}, repos: [] }, a);
  const ws = require('../../core/lib/workspace').load();
  if (sub === 'add') return cmdAdd(ws, a);
  if (sub === 'check') return cmdCheck(ws, a);
  console.error(`모르는 명령: ${sub}\n${USAGE}`);
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { STACKS, parse, pickRepo, plan, targets, checkOne, main };
