#!/usr/bin/env node
// 확정한 시안을 프로토타입 파일로 가져오기: 아티팩트(claude.ai) · Pencil 내보내기 · 다른 곳에서 만든 HTML 을 repo 의 프로토타입 정본으로 저장하고 화면 목록에 등록한다. 실행: kedovi screens import
/*
 * kedovi screens import <HTML 파일> <화면 ID> [--from <시안 링크>] [--to <저장 경로>] [--measure]
 *   저장 위치: 화면 목록 「프로토타입」 칸에 있는 파일 → prototype/ 아래 이름에 화면 ID 가 든 파일 → <화면 폴더>/prototype/<화면 ID>.html (화면 폴더가 없으면 docs-site/화면/prototype/)
 *   파일 머리에 <!-- kedovi:source <링크> · 날짜 --> 를 남기고, 화면 목록에 그 화면 행이 있으면 「프로토타입」 칸을 [파일](경로) · [시안](링크) 로 고친다
 *   이미 있던 파일을 덮으면 더한 줄 · 뺀 줄 수를 알린다 (git diff 로 본다). --measure 면 이어서 kedovi screens quality <화면 ID> --design
 * 아티팩트는 claude.ai 계정에 있어 이 명령이 직접 받지 못한다: 에이전트가 링크를 읽어 받은 HTML 파일을 넘긴다
 * 끝 코드: 0 = 저장 · 1 = 파일 · 화면 ID 없음 · 한 페이지 앱 프로토타입이라 덮지 않음
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./compare-screens.js');

const PACKS = path.resolve(__dirname, '..', '..');
const today = () => new Date().toISOString().slice(0, 10);
const safeId = (id) => String(id).replace(/[^\w.-]+/g, '_');
const SOURCE = /^<!--\s*kedovi:source[^>]*-->\s*\n?/m;

/** 저장할 곳 { file, dir(화면 폴더 or null), how } */
function targetOf(ws, id, a) {
  if (a.to && a.to !== true) return { file: path.resolve(process.cwd(), String(a.to)), dir: null, how: '--to' };
  const dirs = C.screenDirs(ws);
  for (const d of dirs) {
    const listed = C.listedPrototype(path.join(d.dir, 'README.md'), id);
    if (!listed) continue;
    if (/^https?:/.test(listed)) break;
    if (/#/.test(listed)) throw new Error(`${id} 의 프로토타입이 한 페이지 앱(${listed})입니다. 덮으면 다른 화면까지 바뀌니, 그 앱 소스에 직접 옮기거나 --to <파일> 로 따로 저장한다`);
    const f = [d.dir, path.join(d.dir, 'prototype'), d.repo.dir, ws.root].map((b) => path.resolve(b, listed)).find((p) => fs.existsSync(p)) || path.resolve(d.dir, listed);
    return { file: f, dir: d, how: '화면 목록 「프로토타입」 칸' };
  }
  for (const d of dirs) {
    const files = C.walk(path.join(d.dir, 'prototype')).filter((f) => /\.html?$/i.test(f) && C.idRe(id).test(path.basename(f)));
    if (files.length === 1) return { file: files[0], dir: d, how: '파일 이름' };
    if (files.length > 1) throw new Error(`이름에 ${id} 가 든 프로토타입이 여럿입니다: ${files.map((f) => path.relative(ws.root, f)).join(', ')}. --to 로 고른다`);
  }
  if (dirs.length) return { file: path.join(dirs[0].dir, 'prototype', `${safeId(id)}.html`), dir: dirs[0], how: '새 파일' };
  return { file: path.join(ws.root, 'docs-site', '화면', 'prototype', `${safeId(id)}.html`), dir: null, how: '새 파일 (화면 폴더 없음)' };
}

/** 화면 목록 README 의 그 화면 행 「프로토타입」 칸 고치기. 고쳤으면 README 경로 */
function register(d, id, file, from) {
  if (!d) return null;
  const readme = path.join(d.dir, 'README.md');
  let text;
  try { text = fs.readFileSync(readme, 'utf8'); } catch { return null; }
  const rel = path.relative(d.dir, file).split(path.sep).join('/');
  const want = `[${path.basename(file)}](${rel})${from ? ` · [시안](${from})` : ''}`;
  let col = -1;
  let done = false;
  const lines = text.split('\n').map((l) => {
    if (!/^\s*\|/.test(l)) { col = -1; return l; }
    const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const at = cells.findIndex((c) => /^프로토타입$/.test(c.replace(/\*/g, '')));
    if (at >= 0) { col = at; return l; }
    if (col < 0 || cells[0].replace(/[`*]/g, '') !== id) return l;
    cells[col] = want;
    done = true;
    return `| ${cells.join(' | ')} |`;
  });
  if (!done) return null;
  fs.writeFileSync(readme, lines.join('\n'));
  return readme;
}

/** 줄 단위 더한 · 뺀 수 (간단 비교: 같은 줄의 개수 차이) */
function lineDiff(a, b) {
  const count = (t) => { const m = new Map(); for (const l of t.split('\n')) m.set(l, (m.get(l) || 0) + 1); return m; };
  const A = count(a); const B = count(b);
  let add = 0; let del = 0;
  for (const [l, n] of B) add += Math.max(0, n - (A.get(l) || 0));
  for (const [l, n] of A) del += Math.max(0, n - (B.get(l) || 0));
  return { add, del };
}

function main() {
  const a = C.parseArgs(process.argv.slice(2));
  const [src, id] = a._;
  if (!src || !id || a.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 8).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    process.exit(src ? 1 : 0);
  }
  let ws;
  try { ws = require(path.join(PACKS, 'core', 'lib', 'workspace.js')).load(path.resolve(PACKS, '..')); } catch (e) { console.error(`✖ workspace.json 을 읽지 못했습니다. ${e.message}`); process.exit(1); }
  const srcFile = path.resolve(process.cwd(), src);
  if (!fs.existsSync(srcFile)) { console.error(`✖ ${src} 파일이 없습니다. 아티팩트면 링크를 읽어 받은 HTML 파일을 넘긴다`); process.exit(1); }
  let html = fs.readFileSync(srcFile, 'utf8');
  if (!/<(html|body|div|main|section)\b/i.test(html)) { console.error(`✖ ${src} 가 HTML 이 아닙니다`); process.exit(1); }
  let t;
  try { t = targetOf(ws, id, a); } catch (e) { console.error(`✖ ${e.message}`); process.exit(1); }
  const from = a.from && a.from !== true ? String(a.from) : '';
  const mark = `<!-- kedovi:source ${from || path.basename(srcFile)} · ${today()} · 화면 ${id} -->\n`;
  html = html.replace(SOURCE, '');
  html = /^\s*<!doctype[^>]*>\s*\n?/i.test(html) ? html.replace(/^(\s*<!doctype[^>]*>\s*\n?)/i, `$1${mark}`) : mark + html;
  const before = fs.existsSync(t.file) ? fs.readFileSync(t.file, 'utf8') : null;
  fs.mkdirSync(path.dirname(t.file), { recursive: true });
  fs.writeFileSync(t.file, html);
  const rel = path.relative(ws.root, t.file);
  const d = before === null ? null : lineDiff(before.replace(SOURCE, ''), html.replace(SOURCE, ''));
  console.log(`✔ ${id} 프로토타입: ${rel} (${t.how}${before === null ? ', 새로 만듦' : `, 덮음: 더한 줄 ${d.add} · 뺀 줄 ${d.del}`})`);
  const readme = register(t.dir, id, t.file, from);
  if (readme) console.log(`  화면 목록 등록: ${path.relative(ws.root, readme)} 의 ${id} 「프로토타입」 칸`);
  else if (t.how.startsWith('새 파일')) console.log(`  화면 목록에 ${id} 행이 없어 등록하지 않았습니다. 화면 목록(화면 폴더 README.md)에 행을 더하거나 파일 이름(${path.basename(t.file)})으로 찾게 둔다`);
  if (from) console.log(`  시안 링크: ${from} (계정에 묶인 원본. 다시 고치면 그 링크에서 고치고 이 명령으로 다시 가져온다)`);
  console.log(`  다음: kedovi screens inventory ${id} (요소 체크리스트) · kedovi screens quality ${id} --design (설계 단계 품질)`);
  if (a.measure) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'screens-quality.js'), 'quality', id, '--design', '--proto', t.file], { stdio: 'inherit' });
    process.exit(r.status || 0);
  }
  process.exit(0);
}

if (require.main === module) main();
module.exports = { targetOf, register, lineDiff };
