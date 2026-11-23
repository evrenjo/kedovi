#!/usr/bin/env node
// GitLab 이슈 찾기 · 읽기 · 등록 · 댓글 · 닫기 도우미 (다시 열기 · 라벨 · 담당자는 하지 않는다). 사용: node packs/gitlab/bin/gitlab-issue.js <search|view|create|comment|close> --repo <name> …
'use strict';

/*
 * search   [--repo R] --q "낱말" [--state opened|closed|all] [--limit N]
 *     비슷한 이슈 목록 (기본 열린 것 + 닫힌 것, 10개). 등록 전 중복 확인용.
 * view     [--repo R] --iid N
 *     이슈 제목 · 상태 · 본문과 사람이 쓴 댓글 (시스템 기록 제외, 오래된 순).
 * create   [--repo R] --title "..." --description-file F [--type task|bug] [--dry-run]
 *     이슈를 등록한다. 본문에 비밀값 모양이 있거나 글 형식(kedovi draft check)에 걸리면 보내지 않는다. --dry-run 이면 보낼 요청만 출력한다.
 * comment  [--repo R] --iid N --body-file F [--type done] [--dry-run]
 *     이슈에 댓글(조치 보고 등)을 단다. 완료 댓글이면 --type done (필수 절까지). 검사 · --dry-run 은 create 와 같다.
 * close    [--repo R] --iid N [--reason-file F] [--type done] [--dry-run]
 *     이슈를 닫는다. 사유 파일이 있으면 댓글로 먼저 남긴다 (검사는 comment 와 같다). 이미 닫혔으면 알리고 끝낸다.
 *
 * 설정 · 토큰은 gitlab-mr.js 와 같다: workspace.json repos[].gitlab = { host, projectId, apiBase? }, GITLAB_TOKEN.
 * --repo 는 gitlab 설정이 있는 repo 가 하나면 생략. 토큰은 어떤 출력에도 찍지 않는다.
 */

const fs = require('fs');
const path = require('path');
const { loadWs, parseArgs, die, draftGuard, api, apiBase, repoOrOnly } = require('./gitlab-mr.js');

function kitSecretHits(root, text) {
  for (const f of [path.join(root, 'bin', 'kit.js'), path.join(__dirname, '..', '..', '..', 'bin', 'kit.js')]) {
    if (fs.existsSync(f)) return require(f).secretHits(text);
  }
  return [];
}

/** 보내기 전 마지막 확인: 비밀값 모양이면 멈춘다 (나머지 검사는 스킬이 issue-check.js 로 미리 한다) */
function guard(ws, text, title) {
  const hits = [...(title ? kitSecretHits(ws.root, title).map((h) => `제목 ${h.kind}`) : []), ...kitSecretHits(ws.root, text).map((h) => `${h.line}줄 ${h.kind}`)];
  if (hits.length) die(`비밀값 모양이 있어 보내지 않았습니다: ${hits.join(' · ')}`);
}

const iidOf = (a) => {
  const v = String(a.iid === true || a.iid === undefined ? '' : a.iid).replace(/^#/, '');
  if (!/^\d+$/.test(v)) die('--iid 가 필요합니다 (이슈 번호)');
  return v;
};

const readFile = (f, flag) => {
  if (!f || f === true) die(`--${flag} 이 필요합니다`);
  return fs.readFileSync(f, 'utf8');
};

async function cmdSearch(ws, a) {
  const r = repoOrOnly(ws, a.repo);
  if (!a.q || a.q === true) die('--q 가 필요합니다');
  const state = ['opened', 'closed', 'all'].includes(a.state) ? a.state : 'all';
  const limit = Math.max(1, Math.min(50, Number(a.limit) || 10));
  const list = await api(ws, r, 'GET', `/issues?search=${encodeURIComponent(a.q)}&in=title,description&state=${state}&per_page=${limit}&order_by=updated_at`);
  console.log(`repo: ${r.name} · 찾은 낱말: ${a.q} · ${list.length}건`);
  list.forEach((i) => console.log(`  #${i.iid}\t${i.state}\t${i.title}\t${i.web_url}`));
  if (!list.length) console.log('  (비슷한 이슈 없음)');
}

async function cmdView(ws, a) {
  const r = repoOrOnly(ws, a.repo);
  const iid = iidOf(a);
  const i = await api(ws, r, 'GET', `/issues/${iid}`);
  const notes = (await api(ws, r, 'GET', `/issues/${iid}/notes?sort=asc&order_by=created_at&per_page=100`)).filter((n) => !n.system);
  console.log(`#${i.iid} ${i.title}`);
  console.log(`상태: ${i.state} · 작성: ${(i.author && i.author.username) || '-'} · ${String(i.created_at || '').slice(0, 10)}${(i.labels || []).length ? ` · 라벨: ${i.labels.join(', ')}` : ''}`);
  console.log(i.web_url);
  console.log(`\n${i.description || '(본문 없음)'}`);
  for (const n of notes) console.log(`\n--- 댓글 ${(n.author && n.author.username) || '-'} · ${String(n.created_at || '').slice(0, 10)}\n${n.body}`);
}

async function cmdCreate(ws, a) {
  const r = repoOrOnly(ws, a.repo);
  if (!a.title || a.title === true) die('--title 이 필요합니다');
  const description = readFile(a['description-file'], 'description-file');
  guard(ws, description, a.title);
  draftGuard(ws, r, description, a.type && a.type !== true ? a.type : 'issue');
  const body = { title: a.title, description };
  if (a['dry-run']) {
    console.log(`[dry-run] POST ${apiBase(r)}/projects/${r.gitlab.projectId}/issues`);
    console.log('[dry-run] header: PRIVATE-TOKEN: ***');
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  const i = await api(ws, r, 'POST', '/issues', body);
  console.log(`✔ 이슈 #${i.iid} ${i.web_url}`);
}

async function cmdComment(ws, a) {
  const r = repoOrOnly(ws, a.repo);
  const iid = iidOf(a);
  const text = readFile(a['body-file'], 'body-file');
  guard(ws, text);
  draftGuard(ws, r, text, a.type && a.type !== true ? a.type : 'comment');
  if (a['dry-run']) {
    console.log(`[dry-run] POST ${apiBase(r)}/projects/${r.gitlab.projectId}/issues/${iid}/notes`);
    console.log('[dry-run] header: PRIVATE-TOKEN: ***');
    console.log(JSON.stringify({ body: text }, null, 2));
    return;
  }
  const n = await api(ws, r, 'POST', `/issues/${iid}/notes`, { body: text });
  console.log(`✔ 이슈 #${iid} 댓글 ${n.id}`);
}

async function cmdClose(ws, a) {
  const r = repoOrOnly(ws, a.repo);
  const iid = iidOf(a);
  const text = a['reason-file'] !== undefined ? readFile(a['reason-file'], 'reason-file') : null;
  if (text !== null) {
    guard(ws, text);
    draftGuard(ws, r, text, a.type && a.type !== true ? a.type : 'comment');
  }
  if (a['dry-run']) {
    if (text !== null) {
      console.log(`[dry-run] POST ${apiBase(r)}/projects/${r.gitlab.projectId}/issues/${iid}/notes`);
      console.log(JSON.stringify({ body: text }, null, 2));
    }
    console.log(`[dry-run] PUT ${apiBase(r)}/projects/${r.gitlab.projectId}/issues/${iid}`);
    console.log('[dry-run] header: PRIVATE-TOKEN: ***');
    console.log(JSON.stringify({ state_event: 'close' }, null, 2));
    return;
  }
  const cur = await api(ws, r, 'GET', `/issues/${iid}`);
  if (cur.state === 'closed') { console.log(`✔ 이슈 #${iid} 는 이미 닫혀 있습니다 (사유 댓글도 남기지 않음) ${cur.web_url || ''}`.trim()); return; }
  if (text !== null) {
    const n = await api(ws, r, 'POST', `/issues/${iid}/notes`, { body: text });
    console.log(`✔ 이슈 #${iid} 사유 댓글 ${n.id}`);
  }
  const i = await api(ws, r, 'PUT', `/issues/${iid}`, { state_event: 'close' });
  if (i.state !== 'closed') die(`이슈 #${iid} 를 닫지 못했습니다 (상태: ${i.state || '알 수 없음'})`);
  console.log(`✔ 이슈 #${iid} 닫음 ${i.web_url || ''}`.trim());
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  const run = { search: cmdSearch, view: cmdView, create: cmdCreate, comment: cmdComment, close: cmdClose }[cmd];
  if (!run) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(5, 19).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    process.exit(cmd ? 1 : 0);
  }
  return run(loadWs(), a);
}

main().catch((e) => die(e.message));
