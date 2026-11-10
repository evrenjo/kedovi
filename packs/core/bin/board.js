#!/usr/bin/env node
// 워크스페이스 현황판: 로드맵 · 팀원별 마지막 핸드오프 · 미완 작업 · 공지와 기록(핸드오프 · 로드맵 · 모델 조사 · 설정 요약)을 문서 사이트와 같은 틀의 HTML 로. 실행: kedovi board [--no-open] [--no-fetch]
/*
 * 보기 전용. 이 PC 의 .agents/board/ 에 만든다 (gitignore. 현황이 매번 바뀌고 사람마다 달라 커밋하지 않는다).
 * 팀 현황은 kedovi team 과 같은 기준(git fetch 뒤 upstream, 본인 폴더는 작업 폴더), 로드맵은 kedovi plan 과 같은 계산.
 */
'use strict';
const TL = require('../lib/team');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { load, git, devId } = require('../lib/workspace');
const P = require('../lib/plan');
const { build } = require('../lib/mdsite');

const argv = process.argv.slice(2);
const has = (k) => argv.includes(`--${k}`);
const ws = load();
const ROOT = ws.root;
const OUT = path.join(ROOT, '.agents', 'board');
const me = devId(ROOT);
const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { return null; } };
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** 팀 현황: team-status.js --json 을 그대로 쓴다 (같은 기준) */
function team() {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'team-status.js'), '--json', ...(has('no-fetch') ? ['--no-fetch'] : [])], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(r.stdout); } catch { return { source: '팀 현황을 읽지 못함', people: [] }; }
}

/** 기록 파일: 남의 것은 upstream, 본인 것은 작업 폴더 (팀 현황과 같은 기준) */
function records() {
  const up = git(ROOT, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const out = {};
  const wt = [];
  (function walk(rel) {
    let es = [];
    try { es = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r); else if (/\.md$/.test(e.name)) wt.push(r);
    }
  })('handoffs');
  const upFiles = up ? (git(ROOT, ['-c', 'core.quotepath=false', 'ls-tree', '-r', '--name-only', up, '--', 'handoffs/']) || '').split('\n').filter((f) => /\.md$/.test(f)) : [];
  const mine = (f) => me && f.startsWith(`handoffs/${me}/`);
  for (const f of new Set([...wt, ...upFiles])) {
    if (/\/archive\//.test(f)) continue;
    const local = read(f);
    const remote = up && upFiles.includes(f) ? git(ROOT, ['show', `${up}:${f}`]) : null;
    const text = mine(f) || !up ? (local != null ? local : remote) : (remote != null ? remote : local);
    if (text != null) out[f] = text;
  }
  return { files: out, up };
}

function dashboard(t, plan) {
  const L = [`# ${ws.project.title || ws.project.name} 현황판`, '',
    `> 기준: ${t.source}. 보기 전용 (다시 만들기: kedovi board)`, ''];
  L.push('## 로드맵', '');
  if (plan) {
    L.push(P.shortLine(plan, P.externalOf(ws), (ws.project || {}).type), '', '```', P.flow(plan, 100), '```', '');
    const cur = P.current(plan);
    if (cur) L.push(`### 지금 단계: ${cur.no}. ${cur.name}`, '', P.detailTable(cur), '');
    L.push('자세히: [로드맵](handoffs/PLAN.md)', '');
  } else L.push('로드맵(handoffs/PLAN.md)이 없습니다. 만들기: kedovi plan init', '');
  L.push('## 팀', '');
  const people = (t.people || []).filter((p) => p.joined);
  if (people.length) {
    L.push('| 사람 | 마지막 핸드오프 | 오늘 핵심 | 미완 작업 | TODO |', '|---|---|---|---|---|');
    for (const p of people) {
      const when = p.date ? `${p.date}${p.days ? ` (${p.days}일 전)` : ' (오늘)'}` : '없음';
      L.push(`| [${cell(p.id)}](handoffs/${p.id}/LATEST.md) | ${when} | ${cell((p.core || [])[0] || '')} | ${(p.open || []).length} | ${(p.todoOpen || []).length} |`);
    }
    L.push('');
    for (const p of people) {
      if (!(p.open || []).length && !(p.doing || []).length) continue;
      L.push(`### ${p.id}`, '');
      for (const d of p.doing || []) L.push(`- 진행 중: ${d}`);
      for (const o of p.open || []) L.push(`- [ ] [${o.name}](handoffs/${p.id}/topics/${o.name}.md)${o.left ? `: 남은 완료 조건 ${o.left}개` : ''}`);
      L.push('');
    }
  } else L.push('아직 핸드오프가 없습니다.', '');
  const notice = read('NOTICE.md');
  if (notice && notice.trim()) L.push('## 공지', '', notice.replace(/^#\s+.*\n/, '').trim(), '');
  return L.join('\n');
}

function settings(t) {
  const a = ws.agents || {};
  const L = ['# 설정 요약', '', '> workspace.json 기준. 바꾸기는 kedovi 명령으로 (kedovi 스킬 참고)', '',
    '| 항목 | 값 |', '|---|---|',
    `| 프로젝트 | ${cell(ws.project.title || ws.project.name)} (${cell(ws.project.type || '')}) |`,
    `| 킷 버전 | ${cell((ws.kit || {}).version || '')} |`,
    `| 팩 | ${cell((ws.packs || []).join(' · '))} |`,
    `| 팀 구성 | ${a.mode === 'auto' ? '자동 (리더가 작업마다 역할 · 모델)' : '고정 (프로필대로)'} |`,
    `| 팀장 | ${cell(TL.roster(ws).leads.map(TL.callName).join(' · ') || '없음')} |`,
    `| 팀 명단 | ${cell(TL.roster(ws).members.map((p) => `${TL.callName(p)}${p.repos ? ` (${p.repos.join(', ')})` : ''}`).join(' · ') || '명단 없이 운영')} |`,
    `| 이 PC 사용자 | ${cell(me || '')} |`, '',
    '## repo', '', '| 이름 | 종류 | 스택 | 역할 |', '|---|---|---|---|'];
  for (const r of ws.repos) L.push(`| ${cell(r.name)} | ${cell(r.kind)} | ${cell((r.stacks || []).join(' · '))} | ${cell(r.role || '')} |`);
  return `${L.join('\n')}\n`;
}

function main() {
  const t = team();
  const plan = P.read(ROOT);
  const rec = records();
  const files = { 'README.md': dashboard(t, plan), '설정.md': settings(t), ...rec.files };
  const ids = [...new Set(Object.keys(rec.files).map((f) => (f.match(/^handoffs\/([^/]+)\//) || [])[1]).filter((x) => x && !/\.md$/.test(x)))].sort((x, y) => (x === me ? -1 : y === me ? 1 : x.localeCompare(y)));
  const config = {
    title: `${ws.project.title || ws.project.name} 워크스페이스`, version: `kedovi ${(ws.kit || {}).version || ''}`.trim(),
    groups: [
      { group: '현황', icon: '◆', files: ['README.md', '설정.md'] },
      { group: '로드맵 · 공용 기록', icon: '⇢', files: ['handoffs/PLAN.md', 'handoffs/MODELS.md', 'handoffs/README.md'] },
      ...ids.map((id) => ({ group: id === me ? `${id} (나)` : id, icon: '●', files: [`handoffs/${id}/LATEST.md`, `handoffs/${id}/TODO.md`, `handoffs/${id}/topics/*.md`, `handoffs/${id}/*.md`] })),
    ],
  };
  const res = build(files, { config, prefixes: [], assets: require('./docs-site').siteAssets() });
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const [p, c] of Object.entries(res.pages)) {
    if (p === 'assets/ids.json') continue;
    fs.mkdirSync(path.dirname(path.join(OUT, p)), { recursive: true });
    fs.writeFileSync(path.join(OUT, p), c);
  }
  const index = path.join(OUT, 'index.html');
  console.log(`✔ 현황판: ${path.relative(ROOT, index)} (팀원 ${ids.length} · 기록 ${Object.keys(rec.files).length}개 · 기준 ${t.source})`);
  if (!has('no-open')) {
    const opener = process.platform === 'darwin' ? ['open', [index]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', index]] : ['xdg-open', [index]];
    spawnSync(opener[0], opener[1], { stdio: 'ignore' });
  }
}

main();
