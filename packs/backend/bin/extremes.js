#!/usr/bin/env node
/**
 * 실데이터 극값 (kedovi extremes): 운영 DB 집계(원문 없음)로 칸 길이 · 여유를 검사하고 극값 fixture 를 만든다.
 *
 *   kedovi extremes add postgres [--repo R] [--dir 모듈] [--dry-run] [--json]
 *       집계 SQL 을 repo 에 넣는다 (tools/extremes/profile-postgres.sql). 다른 DB 는 같은 CSV 칸을 내는 쿼리를 쓴다
 *   kedovi extremes check <집계.csv> [--against design] [--warn 0.9] [--json] [--strict]
 *       칸 정의(varchar(n) · numeric(p,s) · 정수) 대비 여유. --against design 은 기획 repo 데이터 설계 정의서의 타입 · NOT NULL 과 비교.
 *       --strict 면 ✖ 가 있을 때 exit 1
 *   kedovi extremes fixture <집계.csv> [--out 파일] [--tables a,b]
 *       표마다 max · min · nulls 행 JSON (글자는 길이 · 바이트만 맞춘 합성, 숫자는 집계 극값)
 *
 * Node 기본 모듈만 쓴다. 팩 폴더는 KEDOVI_EXTREMES_PACKS 로 바꿀 수 있다 (시험용).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const X = require('../lib/extremes');

const PACKS = () => process.env.KEDOVI_EXTREMES_PACKS || path.resolve(__dirname, '..', '..');
const DIALECTS = { postgres: { file: 'profile-postgres.sql', run: 'psql "$DATABASE_URL" -X -v schema=<스키마> -f tools/extremes/profile-postgres.sql --csv -o extremes.csv' } };
const BACKEND_STACKS = ['spring', 'java', 'fastapi', 'django', 'flask', 'python', 'express', 'nestjs', 'node', 'go', 'dotnet'];
const USAGE = [
  '사용법',
  '  kedovi extremes add postgres [--repo R] [--dir 모듈] [--dry-run] [--json]   집계 SQL 을 repo 에 (원문 없이 길이 · null · 최솟값 · 최댓값만)',
  '  kedovi extremes check <집계.csv> [--against design] [--warn 0.9] [--json] [--strict]   칸 길이 · 여유 검사',
  '  kedovi extremes fixture <집계.csv> [--out 파일] [--tables a,b]   극값 fixture JSON',
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
const loadWs = () => require('../../core/lib/workspace').load();

function pickRepo(ws, name) {
  const code = codeRepos(ws);
  if (name) {
    const r = code.find((x) => x.name === name);
    if (!r) throw new Error(`workspace.json repos 에 코드 repo '${name}' 가 없습니다`);
    return r;
  }
  if (code.length === 1) return code[0];
  const stackOf = (r) => (Array.isArray(r.stack) ? r.stack.join(',') : String(r.stack || ''));
  const r = code.find((x) => BACKEND_STACKS.some((s) => new RegExp(`(^|[^a-z])${s}([^a-z]|$)`, 'i').test(stackOf(x))));
  if (!r) throw new Error('백엔드 repo 를 못 찾았습니다. --repo <이름> 으로 지정합니다');
  return r;
}

function cmdAdd(a) {
  const db = a._[1];
  if (!DIALECTS[db]) { console.error(`${db ? `모르는 DB: ${db} (지금은 postgres. 다른 DB 는 같은 CSV 칸을 내는 쿼리를 쓴다: ${X.COLS.join(', ')})\n` : ''}${USAGE}`); return 2; }
  const ws = loadWs();
  let repo;
  try { repo = pickRepo(ws, a.repo); } catch (e) { console.error(`✖ ${e.message}`); return 1; }
  if (!fs.existsSync(repo.dir)) { console.error(`✖ ${repo.name}: 폴더가 없습니다 (${repo.dir}). kedovi install 뒤 다시`); return 1; }
  const to = path.posix.join(a.dir ? String(a.dir).replace(/\/$/, '') : '.', 'tools', 'extremes', DIALECTS[db].file);
  const abs = path.join(repo.dir, to);
  const exists = fs.existsSync(abs);
  if (!exists && !a['dry-run']) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.copyFileSync(path.join(PACKS(), 'backend', 'assets', 'extremes', DIALECTS[db].file), abs);
  }
  if (a.json) { console.log(JSON.stringify({ db, repo: repo.name, dryRun: !!a['dry-run'], files: [{ path: to, exists, written: !exists && !a['dry-run'] }], run: DIALECTS[db].run }, null, 2)); return 0; }
  console.log(`${a['dry-run'] ? '미리보기 (쓰지 않음)' : '극값 집계 SQL'}: ${repo.name} · ${db}`);
  console.log(`  ${exists ? '· 있음 (덮지 않음)' : a['dry-run'] ? '+ 만들 파일' : '✔ 만듦'} ${to}`);
  console.log('다음');
  console.log(`  집계 (읽기 전용 계정 · 복제본 · 한가한 시간): ${DIALECTS[db].run}`);
  console.log('  검사: kedovi extremes check extremes.csv [--against design]');
  console.log('  fixture: kedovi extremes fixture extremes.csv --out <시험 자원 경로>/extremes.json');
  console.log('  집계 CSV 는 원문이 없지만 숫자 칸 최솟값 · 최댓값은 실제 값이다: 공유 · 커밋 전에 식별 번호 같은 칸은 지운다');
  return 0;
}

/** 기획 repo 데이터 설계 정의서 → target(table, column) */
function designTarget(ws) {
  const DM = require('../../core/lib/datamodel');
  const files = {};
  for (const r of (ws.repos || []).filter((x) => x.kind === 'docs')) {
    if (!fs.existsSync(r.dir)) continue;
    (function walk(rel) {
      for (const e of fs.readdirSync(path.join(r.dir, rel), { withFileTypes: true })) {
        if (['.git', 'node_modules', 'docs-site', 'html', 'originals'].includes(e.name)) continue;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(p);
        else if (/\.md$/i.test(e.name)) { const t = fs.readFileSync(path.join(r.dir, p), 'utf8'); if (DM.hasTables(t)) files[`${r.name}/${p}`] = t; }
      }
    })('');
  }
  const m = DM.model(files);
  const lower = (s) => String(s || '').toLowerCase();
  return {
    tables: m.tables.length,
    target(table, column) {
      const [sc, tb] = table.includes('.') ? table.split('.') : [null, table];
      const t = m.tables.find((x) => lower(x.name) === lower(tb) && (!sc || lower(x.schema) === lower(sc)));
      const c = t && t.columns.find((x) => lower(x.name) === lower(column));
      return c ? { type: c.type, nullable: c.nullable, from: '데이터 설계' } : null;
    },
  };
}

function readStats(file) {
  if (!file) throw new Error('집계 파일을 줍니다 (예: extremes.csv)');
  return X.parseStats(fs.readFileSync(path.resolve(file), 'utf8'));
}

function cmdCheck(a) {
  let stats, design = null;
  try {
    stats = readStats(a._[1]);
    if (a.against && a.against !== 'design') throw new Error('--against 는 design (기획 repo 데이터 설계) 만 됩니다');
    if (a.against === 'design') design = designTarget(loadWs());
  } catch (e) { console.error(`✖ ${e.message}`); return 1; }
  let warnRatio = Number(a.warn || 0);
  if (!warnRatio) { try { warnRatio = Number(get(loadWs().vars, 'extremes.warnRatio')) || 0.9; } catch { warnRatio = 0.9; } }
  const r = X.check(stats, { warnRatio, target: design ? design.target : null });
  const bad = r.items.filter((x) => x.level === '✖').length;
  if (a.json) { console.log(JSON.stringify({ columns: stats.length, checked: r.checked, skipped: r.skipped, warnRatio, against: a.against || 'db', items: r.items, ok: !bad }, null, 2)); return a.strict && bad ? 1 : 0; }
  const tables = new Set(stats.map((s) => s.table)).size;
  console.log(`칸 ${stats.length} (표 ${tables}) · 검사 ${r.checked} · 타입 모름 ${r.skipped} · 비교 대상 ${design ? `데이터 설계 (표 ${design.tables})` : 'DB 지금 타입'} · 경고 기준 ${pct(warnRatio)}`);
  console.log(`실패 ${bad} · 경고 ${r.items.length - bad}`);
  for (const it of r.items.sort((x, y) => (x.level === y.level ? 0 : x.level === '✖' ? -1 : 1))) console.log(`  ${it.level} ${it.table}.${it.column} ${it.type}${it.from !== 'DB' ? ` (${it.from})` : ''}: ${it.why}`);
  return a.strict && bad ? 1 : 0;
}
const pct = (x) => `${Math.round(x * 100)}%`;

function cmdFixture(a) {
  let stats;
  try { stats = readStats(a._[1]); } catch (e) { console.error(`✖ ${e.message}`); return 1; }
  const out = X.fixture(stats, { tables: a.tables ? String(a.tables).split(',').map((s) => s.trim()).filter(Boolean) : null });
  const text = `${JSON.stringify(out, null, 2)}\n`;
  if (!a.out) { process.stdout.write(text); return 0; }
  fs.mkdirSync(path.dirname(path.resolve(a.out)), { recursive: true });
  fs.writeFileSync(path.resolve(a.out), text);
  console.log(`✔ ${a.out} · 표 ${Object.keys(out.tables).length}`);
  return 0;
}

function main(argv) {
  const a = parse(argv);
  const sub = a._[0];
  if (a.help || !sub) { console.log(USAGE); return sub || a.help ? 0 : 2; }
  if (sub === 'add') return cmdAdd(a);
  if (sub === 'check') return cmdCheck(a);
  if (sub === 'fixture') return cmdFixture(a);
  console.error(`모르는 명령: ${sub}\n${USAGE}`);
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { parse, pickRepo, designTarget, main };
