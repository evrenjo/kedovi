#!/usr/bin/env node
// 데이터 설계 검사: 테이블 정의서(md)의 참조 · 기본키 · 중복 · 표 형식 · 프로젝트 컨벤션 · 기능 ID 대조. 실행: kedovi datamodel check [repo|폴더]
/*
 * ✖ (exit 1): 참조 대상 테이블 · 컬럼 없음 · 기본키 없음 · 같은 이름 테이블 · 컬럼 중복 · 표 형식 깨짐(머리 · 칸 수 · 타입 빈칸)
 * ⚠ (exit 0): 테이블 · 컬럼 논리명 없음 · 컨벤션 위반(vars.datamodel: naming · tablePrefix · pkType · auditColumns · timeType · jsonReason · dialect sqlite 의 타입)
 *             · 논리 참조(참조 칸 「논리: …」) 대상 없음 · 고정 스키마(설명 줄 「고정 스키마: <근거>」)의 기본키 없음 (이름 · 공통 컬럼 · 타입 규칙은 건너뜀)
 *             · 기능 ID 없는 테이블 · 색인에 없는 기능 ID · 어느 테이블에도 없는 기능(vars.datamodel.functionIds, 비면 vars.screens.functionIds)
 * 「없음」 으로 적은 것은 세지 않는다: 테이블 설명 줄의 「기능: 없음」 · 「공통 컬럼: 없음」, 데이터 설계 폴더 md 에서 기능 ID 와 「없음」 이 같은 줄(엔티티 목록의 「테이블 없음」), 「다음 스프린트」 이 같은 줄(스프린트 방식에서 미룬 기능)
 * 정의서 읽기는 kedovi docs build 와 같다 (packs/core/lib/datamodel.js). docs-site/ 를 만들지 않아도 된다.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PACKS = path.resolve(__dirname, '..', '..');
const { generate, ignoredLines } = require(path.join(PACKS, 'core', 'bin', 'docs-site.js'));
const DM = require(path.join(PACKS, 'core', 'lib', 'datamodel.js'));

const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

/** 데이터 설계 폴더의 md 에서 「없음」 · 「다음 스프린트」 과 같은 줄에 적은 기능 ID (테이블이 없는 기능 · 스프린트 방식에서 미룬 기능) */
function noTableIds(files) {
  const out = new Set();
  for (const text of Object.values(files)) {
    for (const line of String(text).split('\n')) if (/없음|다음\s*(반복|스프린트)/.test(line) && !/^\s*#/.test(line)) for (const id of DM.idsIn(line)) out.add(id);
  }
  return out;
}

/** 한 폴더 검사 → { errors, warns, stats } */
function checkModel(m, files, index, conv, fnPrefixes) {
  const { errors, warns } = DM.check(m, conv);
  const ids = new Set(Object.keys(index.ids || {}));
  const isFn = (x) => fnPrefixes.some((p) => x.startsWith(`${p}-`));
  if (fnPrefixes.length) {
    for (const t of m.tables) for (const f of t.fns) if (isFn(f) && !ids.has(f)) warns.push(`${t.file}:${t.line} ${t.id}: 기능 ID ${f} 가 색인에 없습니다 (정의된 곳이 없거나 오타)`);
    const used = new Set(m.tables.flatMap((t) => t.fns));
    const none = noTableIds(files);
    const fns = [...ids].filter(isFn).sort();
    const miss = fns.filter((x) => !used.has(x) && !none.has(x));
    if (miss.length) warns.push(`기능 ${miss.length}/${fns.length}개가 어느 테이블에도 없습니다: ${miss.slice(0, 12).join(' · ')}${miss.length > 12 ? ' …' : ''} (저장하지 않는 기능이면 엔티티 목록에 「테이블 없음」, 스프린트 방식에서 미룬 기능이면 「다음 스프린트」 로 적는다)`);
  }
  return { errors, warns };
}

function main() {
  const argv = process.argv.slice(2).filter((a) => a !== 'check');
  let ws = null;
  try { ws = require(path.join(PACKS, 'core', 'lib', 'workspace.js')).load(path.resolve(PACKS, '..')); } catch { /* 워크스페이스 밖 */ }
  const arg = argv[0];
  let targets;
  if (arg && fs.existsSync(arg)) targets = [{ name: path.basename(path.resolve(arg)), dir: path.resolve(arg) }];
  else if (arg) targets = ((ws && ws.repos) || []).filter((r) => r.name === arg);
  else targets = ((ws && ws.repos) || []).filter((r) => r.kind === 'docs');
  if (!targets.length) { console.error(`✖ 대상 repo 가 없습니다${arg ? ` (${arg})` : ' (기획 repo kind: docs)'}`); process.exitCode = 1; return; }
  const vars = (ws && ws.vars) || {};
  const conv = vars.datamodel || {};
  const fnPrefixes = list(conv.functionIds || (vars.screens || {}).functionIds);
  let bad = 0;
  for (const t of targets) {
    const res = generate(t, ws, 'docs-site');
    if (!(res.erds || []).length) { console.log(`- ${t.name}: 테이블 정의서(「### 스키마.테이블」 + 컬럼 표)가 없습니다`); continue; }
    for (const e of res.erds) {
      const files = {};
      for (const f of fs.readdirSync(path.join(t.dir, e.dir))) if (/\.md$/i.test(f)) files[f] = fs.readFileSync(path.join(t.dir, e.dir, f), 'utf8');
      const { errors, warns } = checkModel(e.model, files, res.index, conv, fnPrefixes);
      const m = e.model;
      console.log(`${errors.length ? '✖' : '✔'} ${t.name}/${e.dir}: 스키마 ${m.schemas.length} · 테이블 ${m.tables.length} · 관계 ${m.rels.length}${(m.lrels || []).length ? ` · 논리 참조 ${m.lrels.length}` : ''}${errors.length ? ` · 오류 ${errors.length}` : ''}${warns.length ? ` · 주의 ${warns.length}` : ''}`);
      for (const x of errors) console.log(`  ✖ ${x}`);
      for (const x of warns.slice(0, 40)) console.log(`  ⚠ ${x}`);
      if (warns.length > 40) console.log(`  ⚠ … 외 ${warns.length - 40}건`);
      if (errors.length) bad++;
    }
    for (const l of ignoredLines(t, res.erds.map((e) => e.dir))) console.log(`  ${l}`);
    if (!fnPrefixes.length) console.log('  ⚠ 기능 대조를 건너뜀: vars.datamodel.functionIds (예: FN) 가 비었습니다');
    if (!Object.keys(conv).some((k) => ['naming', 'tablePrefix', 'pkType', 'auditColumns', 'timeType', 'jsonReason'].includes(k) && conv[k]) && !/^sqlite3?$/i.test(String(conv.dialect || '').trim())) console.log('  ⚠ 컨벤션 검사를 건너뜀: vars.datamodel 에 정한 값이 없습니다 (datamodel 스킬 2단계)');
  }
  if (bad) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { checkModel, noTableIds };
