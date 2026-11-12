#!/usr/bin/env node
'use strict';
/*
 * 킷 문서 사이트: md 원본(README · docs/*.md)을 기획 문서 사이트와 같은 생성기(packs/core/lib/mdsite.js)로 docs-site/ 에 만든다. 원본은 md 이고 HTML 은 보기용 생성물이다.
 *   node bin/docs.js           docs/packs.md 의 팩 목록을 다시 쓰고 docs-site/ 를 다시 만든다. 문서 점검 경고(⚠)를 낸다
 *   node bin/docs.js --check   팩 목록 · docs-site/ 가 md 와 다르면 실패 (selftest 가 쓴다)
 * 메뉴 묶음 · 사이트 이름은 킷 루트의 docs-site.json (프로젝트의 기획 repo 와 같은 형식). 버전 · 원본 주소는 package.json 에서 넣는다.
 * 사이트 밖 파일(팩 파일 등) 링크와 원본 버튼은 package.json repository 의 파일 보기 주소로 (git remote 가 아니라 package.json: PC · CI 마다 같은 결과).
 * 의존성 없음.
 */
const fs = require('fs');
const path = require('path');
const { build } = require('../packs/core/lib/mdsite');
const DR = require('../packs/core/lib/docsref');
const MC = require('../packs/core/lib/mermaid-check');

const KIT = path.resolve(__dirname, '..');
const OUT = path.join(KIT, 'docs-site');
const MANIFEST = 'assets/site.json';
// 사이트에 넣는 md: README 와 docs/ 바로 아래 md · docs/images/ 그림 (docs-site.json groups 에 없는 문서는 메뉴 「기타」 로 가고 경고한다)
const sources = () => {
  const files = { 'README.md': fs.readFileSync(path.join(KIT, 'README.md'), 'utf8') };
  for (const f of fs.readdirSync(path.join(KIT, 'docs')).filter((x) => x.endsWith('.md')).sort()) files[`docs/${f}`] = fs.readFileSync(path.join(KIT, 'docs', f), 'utf8');
  // 문서 그림 (docs/images/): md 의 상대 경로 그림이 사이트에서도 보이게
  const img = path.join(KIT, 'docs', 'images');
  if (fs.existsSync(img)) for (const f of fs.readdirSync(img).filter((x) => /\.(png|jpe?g|gif|svg|webp)$/i.test(x)).sort()) files[`docs/images/${f}`] = fs.readFileSync(path.join(img, f));
  return files;
};

function repoFileOf(pkg) {
  const url = String((pkg.repository && (pkg.repository.url || pkg.repository)) || '').replace(/^git\+/, '').replace(/\.git$/, '');
  if (!/^https:\/\//.test(url)) return () => null;
  return (file) => (file.startsWith('..') ? null : `${url}/${/github\.com/.test(url) ? '' : '-/'}blob/${(pkg.repository && pkg.repository.branch) || 'main'}/${file.split('/').map(encodeURIComponent).join('/')}`);
}

/** 사이트 생성: { pages: { 경로: 내용 }, unlisted, warnings, files } */
function site() {
  const DS = require('../packs/core/bin/docs-site');
  const pkg = JSON.parse(fs.readFileSync(path.join(KIT, 'package.json'), 'utf8'));
  const config = { ...JSON.parse(fs.readFileSync(path.join(KIT, 'docs-site.json'), 'utf8')), version: `v${pkg.version}` };
  const repoFile = repoFileOf(pkg);
  const assets = DS.siteAssets();
  const files = sources();
  const res = build(files, { config, title: config.title, assets, mermaid: DS.mermaidAssets(), srcOf: repoFile, fileUrl: repoFile });
  res.files = files;
  res.pages[MANIFEST] = `${JSON.stringify({ generator: 'kedovi docs', note: '이 폴더는 node bin/docs.js 가 만든다. 손으로 고치지 않는다 (다시 만들면 사라진다)', files: Object.keys(res.pages).sort() }, null, 1)}\n`;
  return res;
}

const same = (a, b) => (Buffer.isBuffer(a) || Buffer.isBuffer(b) ? Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0 : a === b);
const oldFiles = () => { try { return JSON.parse(fs.readFileSync(path.join(OUT, MANIFEST), 'utf8')).files || []; } catch { return []; } };
/** 디스크와 다른 파일 (바뀜 · 없음 · 남음) */
function changed(pages) {
  const out = [];
  for (const [p, c] of Object.entries(pages)) {
    const f = path.join(OUT, p);
    if (!fs.existsSync(f)) out.push(`없음 ${p}`);
    else if (!same(fs.readFileSync(f, Buffer.isBuffer(c) ? null : 'utf8'), c)) out.push(`바뀜 ${p}`);
  }
  for (const p of oldFiles()) if (!(p in pages)) out.push(`남음 ${p}`);
  return out;
}

/** 경고 줄: 메뉴 「기타」 · 문서 점검 (프로젝트 문서 사이트와 같은 기준) */
function warnLines(res) {
  const out = [];
  if ((res.unlisted || []).length) out.push(`⚠ 메뉴 「기타」 문서 ${res.unlisted.length}개 (docs-site.json groups 어느 묶음에도 안 맞음): ${res.unlisted.join(' · ')}`);
  const docs = Object.entries(res.files).filter(([rel]) => rel.endsWith('.md')).map(([rel, text]) => ({ rel, text }));
  for (const w of DR.health(null, { docs })) out.push(`⚠ 문서 점검: ${w}`);
  const art = MC.asciiArt(Object.fromEntries(Object.entries(res.files).filter(([rel]) => rel.endsWith('.md'))));
  if (art.length) out.push(`⚠ ASCII 그림 ${art.length}개: ${art.map((a) => `${a.file}:${a.line}`).join(' · ')}. mermaid 로 바꿀 수 있는지 본다 (폴더 나무 · 화면 모양은 그대로 둬도 된다)`);
  return out;
}

// ───────── 팩 목록 (docs/packs.md 의 packs:catalog 구간) ─────────

const PACK_MD = path.join(KIT, 'docs', 'packs.md');
const CAT_MARK = ['<!-- packs:catalog: node bin/docs.js 가 packs/ 로 쓴다. 손으로 고치지 않는다 -->', '<!-- /packs:catalog -->'];
const CATEGORIES = [
  ['core', '공통'], ['type', '유형'], ['workflow', '협업 도구'], ['layer', '계층'], ['stack', '스택'], ['lang', '언어'], ['other', '산출물'],
];

function frontmatter(file) {
  const m = fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  const meta = {};
  if (m) for (const l of m[1].split('\n')) { const x = l.match(/^([A-Za-z]+):\s*(.*)$/); if (x) meta[x[1]] = x[2].replace(/^["']|["']$/g, ''); }
  return meta;
}
// 스킬 설명은 에이전트가 고를 때 쓰는 요청 예시까지 길게 쓴다. 목록 칸에는 300자가 넘으면 첫 문장만 (원문은 SKILL.md)
const brief = (d) => { const t = String(d || ''); if (t.length <= 300) return t; const m = /^[\s\S]*?\.(?=\s|$)/.exec(t.replace(/\([^()]*\)/g, (x) => x.replace(/\./g, '\u0000'))); return m ? m[0].replace(/\u0000/g, '.') : t; };
const cell = (v) => String(v || '').replace(/\|/g, '\\|').replace(/ — /g, ': ');

function packCatalogMd() {
  const kit = require('./kit.js');
  const stacks = JSON.parse(fs.readFileSync(path.join(KIT, 'packs', 'core', 'stacks.json'), 'utf8'));
  const stackList = Array.isArray(stacks) ? stacks : stacks.stacks || [];
  const dir = path.join(KIT, 'packs');
  const packs = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'pack.json')))
    .map((n) => ({ name: n, dir: path.join(dir, n), meta: JSON.parse(fs.readFileSync(path.join(dir, n, 'pack.json'), 'utf8')) }));
  const catOf = (pk) => pk.meta.category || (pk.name === 'core' ? 'core' : Object.values(kit.TYPE_RULES || {}).some((t) => t.pack === pk.name) ? 'type' : 'other');
  const typeOf = (name) => Object.entries(kit.TYPE_RULES || {}).find(([, t]) => t.pack === name);
  const when = (pk, cat) => {
    if (cat === 'core') return '항상';
    if (cat === 'type') { const t = typeOf(pk.name); return `시작 유형이 ${t ? (kit.PROJECT_TYPES || {})[t[0]] || t[0] : pk.name} 일 때`; }
    if (cat === 'workflow') return `repo 주소가 ${pk.name === 'github' ? 'GitHub' : 'GitLab'} 인 repo 에`;
    if (cat === 'layer') { const ids = stackList.filter((s) => s.layer === pk.meta.layer && !s.parent).map((s) => s.label || s.id); return `repo 스택의 계층이 ${pk.meta.layer} 일 때 (${ids.length}종: ${ids.slice(0, 8).join(', ')}${ids.length > 8 ? ' …' : ''})`; }
    if (cat === 'stack') return `repo 스택이 ${(pk.meta.stacks || []).join(', ')} 일 때 (${pk.meta.layer} 계층 팩과 함께)`;
    if (cat === 'lang') { const langs = stacks.languages || []; return pk.meta.languages ? `repo 에 ${kit.labelLanguages(langs, pk.meta.languages)} 소스가 있을 때 (언어 감지)` : `repo 에 감지된 언어(${kit.labelLanguages(langs, langs.map((l) => l.id))})가 하나라도 있을 때`; }
    const on = Object.entries(kit.TYPE_RULES || {}).filter(([, t]) => (t.defaults || []).includes(pk.name)).map(([k]) => (kit.PROJECT_TYPES || {})[k] || k);
    return on.length ? `시작 유형이 ${on.join(' · ')} 이면 기본. 다른 유형은 kedovi upgrade --add ${pk.name}` : `kedovi upgrade --add ${pk.name}`;
  };
  const list = (d, pred) => { try { return fs.readdirSync(d).filter(pred).sort(); } catch { return []; } };
  const out = [];
  for (const [cat, label] of CATEGORIES) {
    const group = packs.filter((pk) => catOf(pk) === cat);
    if (!group.length) continue;
    out.push(`## ${label} 팩`, '');
    for (const pk of group) {
      const m = pk.meta;
      out.push('<details>', `<summary><b>${pk.name}</b> · ${cell(m.title)}${m.summary ? `: ${cell(m.summary)}` : ''}</summary>`, '');
      out.push(cell(m.description), '');
      out.push('| 항목 | 내용 |', '|---|---|', `| 붙는 조건 | ${cell(when(pk, cat))} |`);
      if ((m.requires || []).length) out.push(`| 함께 붙는 팩 | ${m.requires.map((x) => `\`${x}\``).join(' · ')} |`);
      if ((m.secrets || []).length) out.push(`| 비밀값 | ${m.secrets.map((x) => `\`${x.name}\` (${x.scope === 'global' ? '전역' : '프로젝트'}${x.optional ? ' · 선택' : ''}): ${cell(x.purpose || '')}${(x.needs || []).length ? ` · 권한 ${x.needs.join(', ')}` : ''}`).join('<br>')} |`);
      out.push('');
      const rules = list(path.join(pk.dir, 'rules'), (f) => f.endsWith('.md'));
      if (rules.length) {
        out.push('**규칙**', '', '| ID | 제목 | 읽는 때 |', '|---|---|---|');
        for (const f of rules) {
          const fm = frontmatter(path.join(pk.dir, 'rules', f));
          const id = `${pk.name}--${f.replace(/\.md$/, '')}`;
          const load = fm.load === 'always' ? '상시' : `필요할 때: ${cell(fm.when)}`;
          out.push(`| \`${id}\`${fm.required === 'true' ? ' (필수)' : ''} | ${cell(fm.title)} | ${load} |`);
        }
        out.push('');
      }
      const skills = list(path.join(pk.dir, 'skills'), (f) => fs.existsSync(path.join(pk.dir, 'skills', f, 'SKILL.md')));
      if (skills.length) {
        out.push('**스킬**', '', '| 이름 | 설명 |', '|---|---|');
        for (const f of skills) out.push(`| \`${f}\` | ${cell(brief(frontmatter(path.join(pk.dir, 'skills', f, 'SKILL.md')).description))} |`);
        out.push('');
      }
      const agents = list(path.join(pk.dir, 'agents'), (f) => f.endsWith('.md'));
      if (agents.length) out.push(`**팀 에이전트 역할**: ${agents.map((f) => { const fm = frontmatter(path.join(pk.dir, 'agents', f)); return `${fm.title || fm.name} (\`${fm.name}\`)`; }).join(' · ')}`, '');
      const tools = list(path.join(pk.dir, 'bin'), (f) => /\.(js|py|sh)$/.test(f) && !/\.test\.js$/.test(f));
      if (tools.length) out.push(`**도구**: ${tools.map((f) => `\`bin/${f}\``).join(' · ')}`, '');
      try {
        const hooks = JSON.parse(fs.readFileSync(path.join(pk.dir, 'hooks.json'), 'utf8'));
        const hs = Object.entries(hooks).flatMap(([ev, arr]) => arr.map((h) => `${ev === 'SessionStart' ? '세션 시작' : ev === 'Stop' ? '세션 끝' : ev}: \`${path.basename(h.script)}\``));
        if (hs.length) out.push(`**훅**: ${hs.join(' · ')}`, '');
      } catch { /* 훅 없음 */ }
      out.push('</details>', '');
    }
  }
  return out.join('\n').trim();
}

/** docs/packs.md 의 팩 목록 구간을 다시 쓴다. 반환: 바뀌었나 */
function writePackCatalog({ dryRun = false } = {}) {
  const text = fs.readFileSync(PACK_MD, 'utf8');
  const a = text.indexOf(CAT_MARK[0]);
  const b = text.indexOf(CAT_MARK[1]);
  if (a < 0 || b < a) throw new Error('docs/packs.md 에 packs:catalog 표시가 없습니다');
  const next = `${text.slice(0, a + CAT_MARK[0].length)}\n${packCatalogMd()}\n${text.slice(b)}`;
  if (next !== text && !dryRun) fs.writeFileSync(PACK_MD, next);
  return next !== text;
}

function main(argv) {
  const check = argv.includes('--check');
  const staleCatalog = writePackCatalog({ dryRun: check });
  if (staleCatalog && check) { console.log('✖ docs/packs.md 의 팩 목록이 packs/ 와 다릅니다. node bin/docs.js'); process.exit(1); }
  const res = site();
  const diff = changed(res.pages);
  if (check) {
    if (diff.length) { console.log(`✖ docs-site/ 가 md 와 다릅니다 (${diff.length}개: ${diff.slice(0, 5).join(' · ')}). node bin/docs.js`); process.exit(1); }
    console.log('✔ docs-site/ 가 md 와 같습니다');
    return;
  }
  for (const p of oldFiles()) if (!(p in res.pages)) fs.rmSync(path.join(OUT, p), { force: true });
  for (const [p, c] of Object.entries(res.pages)) {
    const f = path.join(OUT, p);
    if (fs.existsSync(f) && same(fs.readFileSync(f, Buffer.isBuffer(c) ? null : 'utf8'), c)) continue;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, c);
  }
  const html = Object.keys(res.pages).filter((p) => p.endsWith('.html')).length;
  console.log(`✔ docs-site/ 쪽 ${html} · 바뀐 파일 ${diff.length}`);
  for (const l of warnLines(res)) console.log(`  ${l}`);
  // mermaid 문법 오류 (✖): 사이트에는 원문과 오류 문구로 보인다
  MC.check(MC.blocks(res.files)).then((bad) => {
    for (const b of bad) console.log(`  ✖ mermaid 문법 오류: ${b.file}:${b.line}  ${b.error}`);
    if (bad.length) process.exitCode = 1;
  });
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { site, changed, warnLines, OUT, writePackCatalog };
