#!/usr/bin/env node
// 화면설계서 검사: 장의 Related ID · 근거 ID 가 색인에 있는지, 화면 ID 중복, 기능 ID 누락, 화면 목록과 장의 대조. 실행: kedovi screens check [repo|폴더]
/*
 * ✖ (exit 1): 화면 ID(장 id) 중복 · 화면 장의 Related ID 나 근거 줄의 ID 가 색인(md 정의 · 장 id)에 없음 · 이어지는 장(data-continues)의 원래 화면 장이 없음
 * ⚠ (exit 0): 화면 장 Description 줄이 결론 한 줄이 아님(DESC_MAX 자 넘음 · 날짜 · 결정 경위. 근거 ID 목록은 세지 않는다) · 기능 ID(vars.screens.functionIds 머리말)가 어느 화면의 Related ID 에도 없음(화면 목록 표에 「화면 없음」 · 「다음 스프린트」 로 적은 행의 기능은 뺀다) · 화면 목록(md 표)에 있는데 장이 없음 · 장은 있는데 목록에 없음
 * 색인은 kedovi docs build 와 같은 규칙으로 메모리에서 만든다 (docs-site/ 를 만들지 않아도 된다).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const PACKS = path.resolve(__dirname, '..', '..');
const { generate } = require(path.join(PACKS, 'core', 'bin', 'docs-site.js'));
const { ID_SRC } = require(path.join(PACKS, 'core', 'lib', 'mdsite.js'));
const ID_G = new RegExp(`(?<![\\w-])(${ID_SRC})(?![\\w-])`, 'g');

const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');

/** 「VS-ADM-04 · 05 · 07」 처럼 줄여 쓴 번호까지 ID 로 편다 */
function idsIn(text) {
  const out = [];
  const re = new RegExp(`(?<![\\w-])(${ID_SRC})((?:\\s*[·,]\\s*\\d+(?![\\w-]))*)`, 'g');
  let m;
  while ((m = re.exec(text))) {
    out.push(m[1]);
    const head = m[1].replace(/\d+$/, '');
    const width = m[1].match(/\d+$/)[0].length;
    for (const n of (m[2].match(/\d+/g) || [])) if (n.length === width) out.push(head + n);
  }
  return out;
}

/** Description 줄: 결론만 한 줄. 동작 · 조건의 자세한 내용은 근거 ID(기능 · 정책)를 눌러 본다 */
const DESC_MAX = 60;
function descIssues(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  const out = [];
  if ([...t].length > DESC_MAX) out.push(`${DESC_MAX}자 넘음`);
  if (/\b(19|20)\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/.test(t)) out.push('날짜');
  if (/결정\s*(번호\s*)?\d+|결정으로|(사용자|회의)\s*결정|으로\s*(바꿈|바뀜|변경)|에서\s*(바꿈|바뀜|변경)|(추가|삭제)됨|이전에는|당초/.test(t)) out.push('결정 경위');
  return out;
}
/** 장의 Description 줄 본문 (안의 근거 ID 목록 ul 은 뺀다) */
function descLines(sideHtml) {
  const ol = /<ol\b[^>]*class="[^"]*\bdesc\b[^"]*"[^>]*>([\s\S]*?)<\/ol>/.exec(sideHtml || '');
  if (!ol) return [];
  return ol[1].replace(/<ul\b[\s\S]*?<\/ul>/g, ' ').split(/<li\b[^>]*>/).slice(1).map((x) => strip(x).replace(/\s+/g, ' ').trim());
}

/** 장 HTML 하나 → 화면 장 [{ id, label, cont, related: [], refs: [] }] (메타 표 screen-meta 가 있는 장만 화면. cont = data-continues: 한 쪽을 넘어 나눈 이어지는 장이면 원래 화면 ID) */
function screensOf(html) {
  const out = [];
  const parts = html.replace(/<!--[\s\S]*?-->/g, '').split(/(?=<section\b)/);
  for (const p of parts) {
    const tag = /^<section\b[^>]*>/.exec(p);
    if (!tag || !/\bclass="[^"]*\bsheet\b/.test(tag[0])) continue;
    const id = (/\bid="([^"]+)"/.exec(tag[0]) || [])[1] || '';
    const label = (/\bdata-label="([^"]+)"/.exec(tag[0]) || [])[1] || id;
    const cont = (/\bdata-continues="([^"]+)"/.exec(tag[0]) || [])[1] || '';
    const isScreen = /class="[^"]*\bscreen-meta\b/.test(p);
    const rel = /<th>\s*Related ID\s*<\/th>\s*<td>([\s\S]*?)<\/td>/i.exec(p);
    const side = /<aside class="side">([\s\S]*?)<\/aside>/.exec(p);
    out.push({ id, label, cont, isScreen, related: rel ? idsIn(strip(rel[1])) : [], refs: side ? idsIn(strip(side[1])) : [], desc: side ? descLines(side[1]) : [] });
  }
  return out;
}

/** 화면 목록 표에서 「화면 없음」 · 「다음 스프린트」 로 적은 행의 ID (기능 누락으로 세지 않는다. 다음 스프린트 = 스프린트 방식에서 미룬 기능). pages = { 쪽: HTML } */
function noScreenIds(pages) {
  const out = new Set();
  for (const c of Object.values(pages)) {
    for (const m of String(c).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) { const row = strip(m[1]); if (/화면\s*없음|다음\s*(반복|스프린트)/.test(row)) for (const x of idsIn(row)) out.add(x); }
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2).filter((a) => a !== 'check');
  let ws = null;
  try { ws = require(path.join(PACKS, 'core', 'lib', 'workspace.js')).load(path.resolve(PACKS, '..')); } catch { /* 워크스페이스 밖 */ }
  const arg = argv[0];
  let targets;
  if (arg && fs.existsSync(arg)) targets = [{ name: path.basename(path.resolve(arg)), dir: path.resolve(arg) }];
  else if (arg) targets = ((ws && ws.repos) || []).filter((r) => r.name === arg);
  else { try { targets = require(path.join(PACKS, 'core', 'bin', 'docs-site.js')).targets(ws, null); } catch { targets = []; } } // 워크스페이스 docs-site/ (연결한 기획 repo 포함) 또는 기획 repo 전부
  if (!targets.length) { console.error(`✖ 대상이 없습니다${arg ? ` (${arg})` : ' (워크스페이스 docs-site/ 또는 기획 repo kind: docs)'}`); process.exitCode = 1; return; }
  const fnPrefixes = String(((ws && ws.vars && ws.vars.screens) || {}).functionIds || '').split(',').map((x) => x.trim()).filter(Boolean);
  let bad = 0;
  for (const t of targets) {
    const res = generate(t, ws, 'docs-site');
    const ids = new Set(Object.keys(res.index.ids));
    const sheetDocs = res.docs.filter((d) => d.kind === 'sheets');
    if (!sheetDocs.length) { console.log(`- ${t.name}: 화면설계서 장(class="sheet")이 없습니다`); continue; }
    const errs = [];
    const warns = [];
    const seen = new Map();
    const covered = new Set();
    const screens = [];
    const conts = [];
    const descBad = [];
    for (const d of sheetDocs) {
      const html = fs.readFileSync(path.join(t.dir, d.md), 'utf8');
      for (const s of screensOf(html)) {
        if (seen.has(s.id)) errs.push(`화면 ID 중복: ${s.id} (${seen.get(s.id)} · ${d.md})`);
        seen.set(s.id, d.md);
        if (!s.isScreen) continue;
        if (s.cont) conts.push({ s, md: d.md }); else screens.push(s);   // 이어지는 장은 화면 목록 대조에서 뺀다
        if (!s.related.length && !s.cont) warns.push(`${d.md} ${s.id}: Related ID 가 비었습니다`);
        for (const x of new Set([...s.related, ...s.refs])) {
          if (!ids.has(x) && !seen.has(x) && !html.includes(`id="${x}"`)) errs.push(`${d.md} ${s.id}: ${x} 가 색인에 없습니다 (정의된 곳이 없거나 오타)`);
        }
        for (const x of s.related) covered.add(x);
        const bad = s.desc.map((t, k) => ({ k: k + 1, why: descIssues(t) })).filter((x) => x.why.length);
        if (bad.length) descBad.push(`${s.id} ${bad.map((x) => `${x.k}(${x.why.join(' · ')})`).join(' ')}`);
      }
    }
    if (descBad.length) {
      warns.push(`설명이 결론 한 줄이 아닌 장 ${descBad.length}개: 결론만 남기고 자세한 내용 · 경위는 근거 ID 문서로 (screens 스킬 「Description 쓰는 법」. 장 · 줄 번호(이유))`);
      for (const x of descBad.slice(0, 10)) warns.push(`  ${x}`);
      if (descBad.length > 10) warns.push(`  … 외 ${descBad.length - 10}장`);
    }
    for (const { s, md } of conts) if (!screens.some((x) => x.id === s.cont)) errs.push(`${md} ${s.id}: data-continues="${s.cont}" 인 화면 장이 없습니다`);
    if (fnPrefixes.length) {
      const fns = [...ids].filter((x) => fnPrefixes.some((p) => x.startsWith(`${p}-`))).sort();
      const noScreen = noScreenIds(Object.fromEntries(Object.entries(res.pages).filter(([p]) => p.endsWith('.html') && !sheetDocs.some((d) => d.page === p))));
      const miss = fns.filter((x) => !covered.has(x) && !noScreen.has(x));
      if (miss.length) warns.push(`기능 ID ${miss.length}/${fns.length}개가 어느 화면의 Related ID 에도 없습니다: ${miss.slice(0, 12).join(' · ')}${miss.length > 12 ? ' …' : ''} (화면이 없는 기능이면 화면 목록에 「화면 없음」, 스프린트 방식에서 미룬 기능이면 「다음 스프린트」 로 적는다)`);
    } else warns.push('기능 ID 누락 검사를 건너뜀: vars.screens.functionIds (예: FN) 가 비었습니다');
    // 화면 목록: md 표에서 화면 장 id 와 같은 꼴(숫자를 뺀 모양, 예: SCR-#)의 ID 로 시작하는 행
    const fam = (x) => x.replace(/\d+/g, '#');
    const fams = new Set(screens.map((s) => fam(s.id)));
    const listed = new Set();
    for (const [p, c] of Object.entries(res.pages)) {
      if (!p.endsWith('.html') || sheetDocs.some((d) => d.page === p)) continue;
      for (const m of String(c).matchAll(/<tr id="([^"]+)"/g)) if (fams.has(fam(m[1]))) listed.add(m[1]);
    }
    if (listed.size) {
      const sheetIds = new Set(screens.map((s) => s.id));
      const noSheet = [...listed].filter((x) => !sheetIds.has(x)).sort();
      const noList = [...sheetIds].filter((x) => !listed.has(x)).sort();
      if (noSheet.length) warns.push(`화면 목록에 있는데 장이 없음: ${noSheet.join(' · ')}`);
      if (noList.length) warns.push(`장은 있는데 화면 목록에 없음: ${noList.join(' · ')}`);
    }
    console.log(`${errs.length ? '✖' : '✔'} ${t.name}: 화면설계서 ${sheetDocs.length}개 · 화면 장 ${screens.length}${errs.length ? ` · 오류 ${errs.length}` : ''}`);
    for (const e of errs) console.log(`  ✖ ${e}`);
    for (const w of warns) console.log(`  ⚠ ${w}`);
    if (errs.length) bad++;
  }
  if (bad) process.exitCode = 1;
}

if (require.main === module) main();
module.exports = { screensOf, idsIn, noScreenIds, descIssues, DESC_MAX };
