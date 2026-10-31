#!/usr/bin/env node
// GitLab MR 미리보기·생성 · 파이프라인 조회 · 대기 · 작업 실행 · 머지 도우미. 사용: node packs/gitlab/bin/gitlab-mr.js <명령> --repo <name> … (= kedovi gitlab <명령>)
'use strict';

/*
 * preview  --repo R --source S [--target T]
 *     커밋 목록(머지 제외, 오래된 순) · 기존 열린 MR · 제안 remove_source_branch 를 출력. 아무것도 만들지 않는다.
 * create   --repo R --source S [--target T] --title "..." --description-file F
 *          [--assignee <username>] [--remove-source true|false] [--dry-run] [--json]
 *     MR 을 만든다. 같은 source→target 의 열린 MR 이 있으면 새로 만들지 않고 그 MR 을 쓴다 (--json: {iid, url, reused}).
 * pipeline [--repo R] [--ref 브랜치 | --mr 번호 | --id 파이프라인ID] [--limit N] [--log [줄 수]] [--json]
 *     최근 파이프라인 목록(기본 5개)과 맨 위(또는 --id) 파이프라인의 단계별 작업 상태. 읽기만 한다. --log 는 실패한 작업의 로그 끝부분(기본 40줄).
 * wait     [--repo R] --mr 번호 | --id 파이프라인ID | --ref 브랜치 [--sha 커밋] [--timeout 분] [--json]
 *     파이프라인이 끝날 때까지 기다린다. --mr · --ref 는 지금 커밋(MR 머리 · 머지 커밋 · 브랜치 머리)의 파이프라인이 생길 때까지 먼저 기다린다.
 *     끝 코드: 성공 0 · 실패 · 취소 1 · 시간 초과 4 · 파이프라인이 안 생김 5. 수동 작업에서 멈추면 0 과 수동 작업 이름.
 * merge    <MR 번호> [--repo R] [--yes] [--timeout 분] [--json]
 *     머지할 수 있는지(충돌 · 초안 · 토론 · 승인 · 파이프라인) 확인하고, 파이프라인이 돌고 있으면 끝날 때까지 기다린 뒤 머지한다. 머지 커밋 SHA 를 낸다.
 * play     --id 파이프라인ID --job <작업> [--repo R] [--yes] [--timeout 분]     (= pipeline --id ID --play <작업>)
 *     수동 작업 실행: 앞 작업이 끝나 manual 이 될 때까지 기다린 뒤 실행하고 끝날 때까지 상태를 보인다.
 * retry    --id 파이프라인ID [--job <작업>] [--repo R] [--yes] [--timeout 분]
 *     실패한 작업 다시 실행. --job 이 없으면 그 파이프라인의 실패한 작업 전부.
 * cancel   --ref 브랜치 [--sha 커밋] | --id 파이프라인ID [--repo R] [--yes]
 *     도는 파이프라인 취소 (같은 브랜치의 낡은 파이프라인이 겹칠 때).
 *   play · retry · merge · cancel 은 --yes 가 없으면 무엇을 할지만 보이고 멈춘다 (끝 코드 3). 사용자 승인을 받은 뒤에만 --yes.
 *   merge · cancel 은 vars.gitlab.agentMerge 가 true 이거나 사람이 터미널에서 직접 칠 때만 한다.
 * repos    workspace.json repos 중 gitlab 설정이 있는 것 목록
 *
 * 설정: workspace.json repos[].gitlab = { host, projectId, apiBase? }
 * 토큰: 환경변수 GITLAB_TOKEN (vars.gitlab.tokenEnv 로 이름 변경) → 비밀값 저장소(kedovi secret: 프로젝트 > 전역 > 옛 ~/.config/kedovi/gitlab-token) → 없으면 git credential fill.
 * 토큰은 어떤 출력에도 찍지 않는다. auto-merge(merge_when_pipeline_succeeds) 는 쓰지 않는다.
 * 의존성 없음 (Node 18+ fetch).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function loadWs() {
  // packs/gitlab/bin → 워크스페이스 루트의 core 헬퍼
  let load;
  try { ({ load } = require(path.join(__dirname, '..', '..', 'core', 'lib', 'workspace.js'))); } catch { load = null; }
  if (load) return load();
  let dir = process.cwd();
  for (;;) {
    const f = path.join(dir, 'workspace.json');
    if (fs.existsSync(f)) {
      const ws = JSON.parse(fs.readFileSync(f, 'utf8'));
      ws.root = dir;
      ws.repos = (ws.repos || []).map((x) => ({ ...x, dir: path.join(dir, 'repos', ...(x.group ? [x.group] : []), x.name) }));
      return ws;
    }
    const up = path.dirname(dir);
    if (up === dir) throw new Error('workspace.json 을 찾지 못했습니다');
    dir = up;
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

const die = (m) => { console.error(`✖ ${m}`); process.exit(1); };
const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function vars(ws) { return (ws.vars && ws.vars.gitlab) || {}; }

function repoOf(ws, name) {
  if (!name) die('--repo 가 필요합니다');
  const r = ws.repos.find((x) => x.name === name);
  if (!r) die(`workspace.json repos 에 '${name}' 이 없습니다`);
  if (!r.gitlab || !r.gitlab.host || r.gitlab.projectId === undefined) die(`repos '${name}' 에 "gitlab": {"host", "projectId"} 가 없습니다`);
  return r;
}

/** --repo 생략: gitlab 설정이 있는 repo 가 하나뿐이면 그것 */
function repoOrOnly(ws, name) {
  if (name && name !== true) return repoOf(ws, name);
  const list = ws.repos.filter((x) => x.gitlab && x.gitlab.host && x.gitlab.projectId !== undefined);
  if (list.length === 1) return list[0];
  die(list.length ? `--repo 가 필요합니다 (${list.map((x) => x.name).join(' · ')})` : 'gitlab 설정이 있는 repo 가 없습니다. workspace.json repos[].gitlab = {host, projectId}');
}

/** apiBase 는 gitlab.host 와 같은 호스트의 https 일 때만 (토큰을 그 주소로 보낸다) */
function apiBase(r) {
  const S = require(path.join(__dirname, '..', '..', 'core', 'lib', 'secrets.js'));
  const base = S.gitlabApi(r.gitlab.host, r.gitlab.apiBase);
  if (!base) throw new Error(`gitlab.apiBase(${r.gitlab.apiBase}) 가 gitlab.host(${r.gitlab.host}) 와 다르거나 https 가 아니라 토큰을 보내지 않습니다`);
  return base;
}

/** 토큰 → { value, from } (값은 출력하지 않는다. from 은 어디서 읽었는지) */
function token(ws, r) {
  const envName = vars(ws).tokenEnv || 'GITLAB_TOKEN';
  if (process.env[envName]) return { value: process.env[envName], from: `환경변수 ${envName}` };
  try {
    const S = require(path.join(__dirname, '..', '..', 'core', 'lib', 'secrets.js'));
    const g = S.get('GITLAB_TOKEN', { root: ws.root });
    if (g) return { value: g.value, from: g.label };
  } catch { /* 옛 워크스페이스: 저장소 없음 */ }
  try {
    const out = execFileSync('git', ['credential', 'fill'], { input: `protocol=https\nhost=${r.gitlab.host}\n\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    const m = out.match(/^password=(.*)$/m);
    if (m) return { value: m[1], from: 'git credential' };
  } catch { /* 자격증명 없음 */ }
  return null;
}

/** 프로젝트 API (/projects/:id 아래) */
async function api(ws, r, method, p, body) {
  return apiRoot(ws, r, method, `/projects/${encodeURIComponent(r.gitlab.projectId)}${p}`, body);
}

/** 전역 API (/runners · /users · /groups 등 프로젝트 밖). 호스트 · 토큰은 그 repo 의 gitlab 설정을 쓴다 */
async function apiRoot(ws, r, method, p, body) {
  const t = token(ws, r);
  if (!t) throw new Error('토큰이 없습니다. 터미널에서 kedovi secret set GITLAB_TOKEN (숨김 입력, 권한 api)');
  const res = await fetch(`${apiBase(r)}${p}`, {
    method,
    headers: { 'PRIVATE-TOKEN': t.value, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (res.status === 401) throw new Error(`HTTP 401: 토큰이 거부됐습니다 (${t.from}).${t.from === 'git credential' ? ' git 계정 비밀번호는 API 에 쓸 수 없습니다.' : ' 만료 · 취소됐을 수 있습니다.'} 개인 액세스 토큰(권한 api)을 터미널에서 kedovi secret set GITLAB_TOKEN 으로 넣고 kedovi secret test GITLAB_TOKEN 으로 확인하세요`);
  if (!res.ok) { const e = new Error(`HTTP ${res.status} ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data.message || data).slice(0, 300)}`); e.status = res.status; throw e; }
  return data;
}

/** 머지 뒤 source 를 지울지 (제안값). 지우지 않는 것: 영구 브랜치(vars.branch) · 상시 작업 브랜치(vars.gitlab.persistentBranches) · 원격 기본 브랜치 · hotfix/* */
function defaultRemoveSource(ws, source, defaultBranch) {
  const b = (ws.vars && ws.vars.branch) || {};
  const permanent = [b.develop || 'develop', b.release || 'release', defaultBranch].filter(Boolean);
  const persistent = vars(ws).persistentBranches || [];
  if (permanent.includes(source) || persistent.includes(source)) return false;
  if (source.startsWith('hotfix/')) return false; // MR 2건(release·develop)이 같은 source 를 쓴다
  return true;
}

/** 원격 기본 브랜치 (GitLab 프로젝트 설정). 못 읽으면 null */
async function defaultBranchOf(ws, r) {
  try { return (await api(ws, r, 'GET', '')).default_branch || null; } catch { return null; }
}

function commits(r, source, target) {
  if (!fs.existsSync(r.dir)) throw new Error(`${r.dir} 가 없습니다. kedovi install (또는 node bin/kit.js install)`);
  git(r.dir, ['fetch', '-q', 'origin', target, source]);
  const out = git(r.dir, ['log', '--no-merges', '--reverse', '--format=%h%x09%s', `origin/${target}..origin/${source}`]);
  return out ? out.split('\n').map((l) => { const [sha, ...s] = l.split('\t'); return { sha, subject: s.join('\t') }; }) : [];
}

function unpushed(r, source) {
  try { return Number(git(r.dir, ['rev-list', '--count', `origin/${source}..${source}`])); } catch { return null; }
}

async function cmdPreview(ws, a) {
  const r = repoOf(ws, a.repo);
  const source = a.source; const target = a.target || (ws.vars && ws.vars.branch && ws.vars.branch.develop) || 'develop';
  if (!source) die('--source 가 필요합니다');
  if (source === target) die('source 와 target 이 같습니다');
  const list = commits(r, source, target);
  console.log(`repo: ${r.name} (project ${r.gitlab.projectId} @ ${r.gitlab.host})`);
  console.log(`방향: ${source} → ${target}`);
  const defBranch = await defaultBranchOf(ws, r);
  console.log(`remove_source_branch(제안): ${defaultRemoveSource(ws, source, defBranch)}${defBranch && defBranch !== ((ws.vars && ws.vars.branch && ws.vars.branch.develop) || 'develop') ? ` · ⚠ 원격 기본 브랜치가 ${defBranch} (통합 브랜치가 아님: kedovi doctor)` : ''}`);
  const ahead = unpushed(r, source);
  if (ahead) console.log(`⚠ 로컬 ${source} 에 push 안 된 커밋 ${ahead}개`);
  console.log(`커밋 ${list.length}개 (머지 제외, 오래된 순):`);
  list.forEach((c) => console.log(`  ${c.sha}\t${c.subject}`));
  if (!list.length) console.log('  (변경 없음: MR 을 만들 필요가 없습니다)');
  const types = [...new Set(list.map((c) => (c.subject.match(/^(\w+):/) || [])[1]).filter(Boolean))];
  console.log(`커밋 type: ${types.join(', ') || '-'}`);
  try {
    const open = await api(ws, r, 'GET', `/merge_requests?state=opened&source_branch=${encodeURIComponent(source)}&target_branch=${encodeURIComponent(target)}`);
    if (open.length) console.log(`⚠ 이미 열린 MR: ${open.map((m) => `!${m.iid} ${m.web_url}`).join(' · ')}`);
    else console.log('열린 MR: 없음');
  } catch (e) { console.log(`열린 MR 확인 불가: ${e.message}`); }
}

async function cmdCreate(ws, a) {
  const r = repoOf(ws, a.repo);
  const source = a.source; const target = a.target || (ws.vars && ws.vars.branch && ws.vars.branch.develop) || 'develop';
  if (!source) die('--source 가 필요합니다');
  if (source === target) die('source 와 target 이 같습니다');
  if (!a.title || a.title === true) die('--title 이 필요합니다');
  if (!a['description-file']) die('--description-file 이 필요합니다');
  const description = fs.readFileSync(a['description-file'], 'utf8');
  const remove = a['remove-source'] === undefined ? defaultRemoveSource(ws, source, a['dry-run'] ? null : await defaultBranchOf(ws, r)) : String(a['remove-source']) === 'true';
  const body = { source_branch: source, target_branch: target, title: a.title, description, remove_source_branch: remove };

  if (a['dry-run']) {
    console.log(`[dry-run] POST ${apiBase(r)}/projects/${r.gitlab.projectId}/merge_requests`);
    console.log('[dry-run] header: PRIVATE-TOKEN: ***');
    if (a.assignee) console.log(`[dry-run] assignee username '${a.assignee}' → id 조회 후 assignee_id 로 넣는다`);
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  if (a.assignee && a.assignee !== true) {
    let users = [];
    try { users = await apiRoot(ws, r, 'GET', `/users?username=${encodeURIComponent(a.assignee)}`); } catch { users = []; }
    if (!users.length) die(`assignee '${a.assignee}' 를 찾지 못했습니다. 임의 id 로 대체하지 않습니다`);
    body.assignee_id = users[0].id;
  }
  const openMr = async () => (await api(ws, r, 'GET', `/merge_requests?state=opened&source_branch=${encodeURIComponent(source)}&target_branch=${encodeURIComponent(target)}`))[0];
  const reuse = (m) => {
    if (a.json) { console.log(JSON.stringify({ iid: m.iid, url: m.web_url, reused: true, sha: m.sha })); return; }
    console.log(`✔ MR !${m.iid} ${m.web_url} (이미 열린 MR 을 그대로 씀: 새로 만들지 않았습니다)`);
    console.log(`  ${source} → ${target} · 제목: ${m.title}`);
  };
  const existing = await openMr();
  if (existing) return reuse(existing);
  let mr;
  try { mr = await api(ws, r, 'POST', '/merge_requests', body); } catch (e) {
    // 같은 순간 다른 쪽이 만들었으면 409: 그 MR 을 쓴다
    const again = e.status === 409 ? await openMr() : null;
    if (again) return reuse(again);
    throw e;
  }
  if (a.json) { console.log(JSON.stringify({ iid: mr.iid, url: mr.web_url, reused: false, sha: mr.sha })); return; }
  console.log(`✔ MR !${mr.iid} ${mr.web_url}`);
  console.log(`  ${source} → ${target} · remove_source_branch=${remove} · assignee=${mr.assignee ? mr.assignee.username : '비움'}`);
}

const MARK = { success: '✔', failed: '✖', running: '▶', canceled: '⊘', canceling: '⊘', skipped: '-', manual: '✋' };
const mark = (st) => MARK[st] || '…';
const two = (n) => String(n).padStart(2, '0');
const when = (iso) => { if (!iso) return '-'; const d = new Date(iso); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; };
const took = (sec) => { if (sec == null) return '-'; const s = Math.round(sec); return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`; };

async function cmdPipeline(ws, a) {
  const r = repoOrOnly(ws, a.repo);
  const limit = Math.max(1, Math.min(50, Number(a.limit) || 5));
  const asked = a.id && a.id !== true ? String(a.id).replace(/^#/, '') : null;
  let list = [];
  let scope = '모든 브랜치';
  if (asked) scope = null;
  else if (a.mr && a.mr !== true) {
    const iid = String(a.mr).replace(/^!/, '');
    list = (await api(ws, r, 'GET', `/merge_requests/${encodeURIComponent(iid)}/pipelines?per_page=${limit}`)).slice(0, limit);
    scope = `MR !${iid}`;
    if (!list.length) {
      // MR 파이프라인을 안 쓰는 프로젝트: 머지했으면 머지 커밋, 아니면 source 브랜치 머리 커밋의 파이프라인
      const mr = await api(ws, r, 'GET', `/merge_requests/${encodeURIComponent(iid)}`);
      const sha = mr.merge_commit_sha || mr.squash_commit_sha || mr.sha;
      if (sha) list = await api(ws, r, 'GET', `/pipelines?per_page=${limit}&order_by=id&sort=desc&sha=${encodeURIComponent(sha)}`);
      scope = `MR !${iid} ${mr.merge_commit_sha || mr.squash_commit_sha ? '머지 커밋' : 'source 커밋'} ${String(sha || '').slice(0, 7)}`;
    }
  } else {
    const ref = a.ref && a.ref !== true ? a.ref : null;
    list = await api(ws, r, 'GET', `/pipelines?per_page=${limit}&order_by=id&sort=desc${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`);
    if (ref) scope = `브랜치 ${ref}`;
  }
  const id = asked || (list[0] && list[0].id);
  let detail = null;
  let jobs = [];
  if (id) {
    detail = await api(ws, r, 'GET', `/pipelines/${encodeURIComponent(id)}`);
    jobs = (await api(ws, r, 'GET', `/pipelines/${encodeURIComponent(id)}/jobs?per_page=100`)).sort((x, y) => x.id - y.id);
  }
  const wantLog = a.log !== undefined;
  const logLines = a.log === true ? 40 : Math.max(1, Math.min(500, Number(a.log) || 40));
  const logs = {};
  if (wantLog) for (const j of jobs.filter((x) => x.status === 'failed')) {
    try { logs[j.id] = String(await api(ws, r, 'GET', `/jobs/${j.id}/trace`)).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n').filter((l) => l.trim()).slice(-logLines); } catch (e) { logs[j.id] = [`(로그를 읽지 못함: ${e.message})`]; }
  }
  if (a.json) {
    const slim = (p) => ({ id: p.id, status: p.status, ref: p.ref, sha: p.sha, source: p.source, createdAt: p.created_at, url: p.web_url });
    console.log(JSON.stringify({ repo: r.name, pipelines: list.map(slim), detail: detail ? { ...slim(detail), duration: detail.duration, user: detail.user && detail.user.username, jobs: jobs.map((j) => ({ id: j.id, stage: j.stage, name: j.name, status: j.status, duration: j.duration, allowFailure: !!j.allow_failure, url: j.web_url, ...(logs[j.id] ? { log: logs[j.id] } : {}) })) } : null }, null, 2));
    return;
  }
  console.log(`repo: ${r.name} (project ${r.gitlab.projectId} @ ${r.gitlab.host})`);
  if (scope) {
    console.log(`파이프라인 (${scope}, 최근 ${list.length}개):`);
    list.forEach((p) => console.log(`  #${p.id}\t${mark(p.status)} ${p.status}\t${p.ref}\t${String(p.sha || '').slice(0, 7)}\t${when(p.created_at)}\t${p.web_url}`));
    if (!list.length) { console.log('  (없음)'); return; }
  }
  console.log(`\n#${detail.id} ${mark(detail.status)} ${detail.status} · ${detail.ref} · ${String(detail.sha || '').slice(0, 7)} · ${when(detail.created_at)} · ${took(detail.duration)}${detail.user ? ` · ${detail.user.username}` : ''}`);
  if (asked) console.log(`  ${detail.web_url}`);
  const stages = [...new Set(jobs.map((j) => j.stage))];
  for (const st of stages) for (const j of jobs.filter((x) => x.stage === st)) {
    console.log(`  ${st}\t${mark(j.status)} ${j.name}\t${j.status}${j.allow_failure && j.status === 'failed' ? ' (실패 허용)' : ''}\t${took(j.duration)}${j.status === 'failed' ? `\t${j.web_url}` : ''}`);
    if (logs[j.id]) logs[j.id].forEach((l) => console.log(`      | ${l}`));
  }
  if (!jobs.length) console.log('  (작업 없음)');
  const failed = jobs.filter((j) => j.status === 'failed' && !j.allow_failure);
  if (failed.length && !wantLog) console.log(`실패한 작업의 로그 끝부분: --id ${detail.id} --log`);
}

const DONE = new Set(['success', 'failed', 'canceled', 'skipped']);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const clock = () => { const d = new Date(); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`; };

/** 수동 작업 실행(--play) · 다시 실행(--retry): 실행할 수 있을 때까지 기다리고, 실행한 뒤 끝날 때까지 상태를 보인다 */
async function cmdJobRun(ws, a) {
  const r = repoOrOnly(ws, a.repo);
  const act = a.play !== undefined ? 'play' : 'retry';
  const name = a[act];
  if (!name || name === true) die(`--${act} <작업 이름> 이 필요합니다`);
  const id = a.id && a.id !== true ? String(a.id).replace(/^#/, '') : null;
  if (!id) die(`--${act} 는 --id <파이프라인 ID> 와 함께 씁니다 (어느 파이프라인의 작업인지 정확히 정한다)`);
  const poll = Math.max(200, Number(process.env.KEDOVI_POLL_MS) || 5000);
  const until = Date.now() + Math.max(1, Number(a.timeout) || 30) * 60000;
  const detail = await api(ws, r, 'GET', `/pipelines/${encodeURIComponent(id)}`);
  const jobsOf = async () => api(ws, r, 'GET', `/pipelines/${encodeURIComponent(id)}/jobs?per_page=100`);
  const pick = (jobs) => jobs.filter((j) => j.name === name).sort((x, y) => y.id - x.id)[0];
  let jobs = await jobsOf();
  let job = pick(jobs);
  if (!job) die(`파이프라인 #${id} 에 '${name}' 작업이 없습니다. 있는 작업: ${[...new Set(jobs.map((j) => j.name))].join(', ') || '없음'}`);
  console.log(`⚠ 작업 ${act === 'play' ? '실행 (수동 작업)' : '다시 실행'}: ${r.name} · 파이프라인 #${id} (${detail.ref} ${String(detail.sha || '').slice(0, 7)}) · ${job.stage}/${job.name} · 지금 ${job.status}`);
  console.log('  운영 배포 · 데이터를 바꾸는 작업은 사용자 승인을 받은 뒤에만 실행한다.');
  if (!a.yes) { console.log('  실행하지 않았습니다. 사용자 승인을 받았으면 같은 명령에 --yes 를 붙여 다시 실행합니다'); process.exit(3); }

  if (act === 'play') {
    // 앞 작업이 끝나기 전에는 created 다 (그때 play 하면 HTTP 400 Unplayable Job). manual 이 될 때까지 기다린다
    let shown = '';
    while (job.status === 'created' || job.status === 'waiting_for_resource' || job.status === 'preparing') {
      const ahead = jobs.filter((j) => j.id !== job.id && ['running', 'pending', 'created', 'waiting_for_resource', 'preparing'].includes(j.status) && j.stage !== job.stage).map((j) => `${j.name} ${j.status}`);
      const line = `앞 작업을 기다림 (${job.status})${ahead.length ? `: ${ahead.slice(0, 4).join(' · ')}` : ''}`;
      if (line !== shown) { console.log(`  ${clock()} ${line}`); shown = line; }
      if (Date.now() > until) { console.log(`✖ 시간이 지나 멈춥니다 (지금 ${job.status}). 다시 보기: kedovi gitlab pipeline --id ${id}`); process.exit(4); }
      await sleep(poll);
      jobs = await jobsOf();
      job = pick(jobs) || job;
    }
    if (job.status === 'skipped' || job.status === 'canceled') die(`${name} 이(가) ${job.status} 입니다. 앞 작업이 실패 · 취소돼 실행할 수 없습니다 (kedovi gitlab pipeline --id ${id} --log)`);
    if (job.status === 'manual') {
      job = await api(ws, r, 'POST', `/jobs/${job.id}/play`);
      console.log(`  ${clock()} ▶ 실행 요청 (작업 ${job.id})`);
    } else if (DONE.has(job.status)) die(`${name} 은(는) 이미 ${job.status} 입니다${job.status === 'success' ? '' : `. 다시 실행: --retry ${name} --yes`}`);
    else console.log(`  ${clock()} 이미 시작됨 (${job.status}). 끝날 때까지 봅니다`);
  } else {
    if (job.status === 'manual') die(`${name} 은(는) 아직 실행하지 않은 수동 작업입니다. --play ${name} --yes`);
    if (!DONE.has(job.status) || job.status === 'skipped') die(`${name} 은(는) ${job.status} 라 다시 실행할 수 없습니다 (끝난 작업만: failed · canceled · success)`);
    job = await api(ws, r, 'POST', `/jobs/${job.id}/retry`);
    console.log(`  ${clock()} ▶ 다시 실행 요청 (새 작업 ${job.id})`);
  }

  // 끝날 때까지 상태가 바뀔 때마다 한 줄
  let last = job.status;
  console.log(`  ${clock()} ${mark(last)} ${last}`);
  while (!DONE.has(job.status) && job.status !== 'manual') {
    if (Date.now() > until) { console.log(`✖ 시간이 지나 멈춥니다 (지금 ${job.status}, 작업은 계속 돈다). 다시 보기: kedovi gitlab pipeline --id ${id}`); process.exit(4); }
    await sleep(poll);
    job = await api(ws, r, 'GET', `/jobs/${job.id}`);
    if (job.status !== last) { last = job.status; console.log(`  ${clock()} ${mark(last)} ${last}`); }
  }
  if (job.status === 'success') { console.log(`✔ ${name} 성공 (${took(job.duration)}) ${job.web_url || ''}`.trim()); return; }
  console.log(`✖ ${name} ${job.status} ${job.web_url || ''}`.trim());
  console.log(`  로그 끝부분: kedovi gitlab pipeline --id ${id} --log${job.status === 'failed' ? ` · 다시 실행: --id ${id} --retry ${name} --yes` : ''}`);
  process.exit(1);
}

const WAITING = new Set(['created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled']);
const pollMs = () => Math.max(200, Number(process.env.KEDOVI_POLL_MS) || 5000);
const deadline = (a, def = 30) => Date.now() + Math.max(1, Number(a.timeout) || def) * 60000;

/** merge · cancel: vars.gitlab.agentMerge 가 true 이거나 사람이 터미널에서 직접 칠 때만 */
function allowWrite(ws, what) {
  if (vars(ws).agentMerge === true) return;
  if (process.stdin.isTTY && process.stdout.isTTY) return;
  console.error(`✖ ${what} 하지 않았습니다: 에이전트 ${what}은(는) 꺼져 있습니다 (workspace.json vars.gitlab.agentMerge = false).`);
  console.error(`  GitLab 화면에서 직접 하거나 터미널에서 직접 kedovi gitlab ${what === '머지' ? 'merge' : 'cancel'} … 를 실행합니다. 에이전트에게 맡기려면 팀장이 vars.gitlab.agentMerge 를 true 로 두고 node bin/kit.js sync.`);
  process.exit(1);
}

/** 파이프라인이 끝날 때까지 (수동 작업에서 멈춘 것도 끝으로 본다). 상태가 바뀔 때마다 한 줄 */
async function follow(ws, r, id, until, quiet = false) {
  const say = quiet ? () => {} : (t) => console.log(t);
  let last = '';
  const seen = {};
  for (;;) {
    const p = await api(ws, r, 'GET', `/pipelines/${encodeURIComponent(id)}`);
    const jobs = (await api(ws, r, 'GET', `/pipelines/${encodeURIComponent(id)}/jobs?per_page=100`)).sort((x, y) => x.id - y.id);
    // 작업: 처음 볼 때는 도는 · 실패 · 수동만, 그 뒤로는 바뀔 때마다
    for (const j of jobs) {
      const first = seen[j.id] === undefined;
      if (seen[j.id] !== j.status && (first ? ['running', 'failed', 'manual'] : ['running', 'success', 'failed', 'canceled', 'manual']).includes(j.status)) say(`  ${clock()} ${mark(j.status)} ${j.stage}/${j.name} ${j.status}`);
      seen[j.id] = j.status;
    }
    if (p.status !== last) { last = p.status; say(`  ${clock()} 파이프라인 #${p.id} ${mark(p.status)} ${p.status}`); }
    if (!WAITING.has(p.status)) return { p, jobs };
    if (Date.now() > until) { console.log(`✖ 시간이 지나 멈춥니다 (지금 ${p.status}, 파이프라인은 계속 돈다). 다시: kedovi gitlab wait --id ${id}`); process.exit(4); }
    await sleep(pollMs());
  }
}

/** 끝난 파이프라인 보고 → 끝 코드 (0 성공 · 수동 작업 대기, 1 실패 · 취소) */
function finish(r, { p, jobs }, json) {
  const manual = jobs.filter((j) => j.status === 'manual').map((j) => j.name);
  const failed = jobs.filter((j) => j.status === 'failed' && !j.allow_failure).map((j) => j.name);
  const code = p.status === 'success' || p.status === 'manual' ? 0 : 1;
  if (json) { console.log(JSON.stringify({ repo: r.name, pipeline: p.id, status: p.status, ref: p.ref, sha: p.sha, url: p.web_url, manual, failed })); return code; }
  if (p.status === 'success') console.log(`✔ 파이프라인 #${p.id} 성공 (${took(p.duration)}) ${p.web_url}`);
  else if (p.status === 'manual') console.log(`✋ 파이프라인 #${p.id} 수동 작업에서 멈춤: ${manual.join(' · ')} ${p.web_url}`);
  else console.log(`✖ 파이프라인 #${p.id} ${p.status}${failed.length ? `: ${failed.join(' · ')}` : ''} ${p.web_url}`);
  if (manual.length) console.log(`  수동 작업 실행 (사용자 승인 뒤): kedovi gitlab play --repo ${r.name} --id ${p.id} --job ${manual[0]} --yes`);
  if (code) console.log(`  로그 끝부분: kedovi gitlab pipeline --repo ${r.name} --id ${p.id} --log · 다시 실행: kedovi gitlab retry --repo ${r.name} --id ${p.id} --yes`);
  return code;
}

/** 이 커밋의 파이프라인 (가장 새것). mr 이 있으면 MR 파이프라인도 본다 */
async function pipelineFor(ws, r, { sha, ref, mr }) {
  const list = [];
  if (mr) list.push(...await api(ws, r, 'GET', `/merge_requests/${encodeURIComponent(mr)}/pipelines?per_page=20`));
  list.push(...await api(ws, r, 'GET', `/pipelines?per_page=20&order_by=id&sort=desc${sha ? `&sha=${encodeURIComponent(sha)}` : ''}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}`));
  return list.filter((x) => !sha || x.sha === sha || String(x.sha || '').startsWith(sha)).sort((x, y) => y.id - x.id)[0] || null;
}

async function cmdWait(ws, a) {
  const r = repoOrOnly(ws, a.repo);
  const until = deadline(a);
  const say = a.json ? () => {} : (t) => console.log(t);
  let id = a.id && a.id !== true ? String(a.id).replace(/^#/, '') : null;
  if (!id) {
    let sha = a.sha && a.sha !== true ? String(a.sha) : null;
    let ref = null;
    let mr = null;
    let what;
    if (a.mr && a.mr !== true) {
      mr = String(a.mr).replace(/^!/, '');
      const m = await api(ws, r, 'GET', `/merge_requests/${encodeURIComponent(mr)}`);
      if (m.state === 'closed') die(`MR !${mr} 은(는) 닫혀 있습니다`);
      const merged = m.state === 'merged';
      sha = sha || (merged ? m.merge_commit_sha || m.squash_commit_sha || m.sha : m.sha);
      if (merged) { ref = m.target_branch; mr = null; }
      what = `MR !${m.iid} ${merged ? `머지 커밋 (${m.target_branch})` : `머리 커밋 (${m.source_branch})`} ${String(sha).slice(0, 7)}`;
    } else if (a.ref && a.ref !== true) {
      ref = a.ref;
      if (!sha) sha = (await api(ws, r, 'GET', `/repository/branches/${encodeURIComponent(ref)}`)).commit.id;
      what = `브랜치 ${ref} 커밋 ${String(sha).slice(0, 7)}`;
    } else die('--mr <번호> · --id <파이프라인ID> · --ref <브랜치> 중 하나가 필요합니다');
    say(`repo: ${r.name} · ${what}`);
    const appear = Date.now() + Math.max(1, Number(a.appear) || 5) * 60000;
    let shown = false;
    for (;;) {
      const p = await pipelineFor(ws, r, { sha, ref, mr });
      if (p) { id = p.id; break; }
      if (!shown) { say(`  ${clock()} 이 커밋의 파이프라인이 생기길 기다림`); shown = true; }
      if (Date.now() > Math.min(appear, until)) { console.log(`✖ 이 커밋(${String(sha).slice(0, 7)})의 파이프라인이 생기지 않았습니다. CI 규칙상 없을 수 있습니다 ([skip ci] · rules). 확인: kedovi gitlab pipeline --repo ${r.name}${ref ? ` --ref ${ref}` : ''}`); process.exit(5); }
      await sleep(pollMs());
    }
    say(`  파이프라인 #${id}`);
  }
  process.exit(finish(r, await follow(ws, r, id, until, a.json), a.json));
}

const MERGE_BLOCK = {
  conflict: '충돌이 있습니다. 작업 브랜치에 대상 브랜치를 머지해 풀고 다시 push 합니다',
  draft_status: '초안(Draft) MR 입니다',
  discussions_not_resolved: '풀리지 않은 토론이 있습니다',
  not_approved: '승인이 모자랍니다',
  requested_changes: '변경 요청이 남아 있습니다',
  blocked_status: '다른 MR 에 막혀 있습니다',
  need_rebase: '대상 브랜치에 맞춰 rebase 가 필요합니다 (프로젝트 설정)',
  not_open: '열린 MR 이 아닙니다',
  jira_association_missing: '이슈 연결이 필요합니다',
  external_status_checks: '외부 상태 검사가 통과하지 않았습니다',
  merge_request_blocked: '머지가 막혀 있습니다',
  security_policy_violations: '보안 정책 위반이 있습니다',
};

async function cmdMerge(ws, a) {
  const r = repoOrOnly(ws, a.repo);
  const iid = String((a._[1] || (a.mr !== true && a.mr) || '')).replace(/^!/, '');
  if (!iid) die('머지할 MR 번호가 필요합니다: kedovi gitlab merge <번호> [--repo R] --yes');
  const say = a.json ? () => {} : (t) => console.log(t);
  const get = () => api(ws, r, 'GET', `/merge_requests/${encodeURIComponent(iid)}`);
  const done = (m) => {
    const sha = m.merge_commit_sha || m.squash_commit_sha || m.sha;
    if (a.json) console.log(JSON.stringify({ repo: r.name, iid: m.iid, state: m.state, target: m.target_branch, mergeCommit: sha, url: m.web_url }));
    else { console.log(`✔ 머지됨 !${m.iid} ${m.source_branch} → ${m.target_branch} · 머지 커밋 ${String(sha).slice(0, 7)} ${m.web_url}`); console.log(`merge_commit_sha=${sha}`); }
  };
  let m = await get();
  if (m.state === 'merged') return done(m);
  if (m.state !== 'opened') die(`MR !${iid} 은(는) ${m.state} 입니다`);
  allowWrite(ws, '머지');
  const pipe = m.head_pipeline || m.pipeline;
  say(`⚠ 머지: ${r.name} !${m.iid} ${m.title}`);
  say(`  ${m.source_branch} → ${m.target_branch} · 상태 ${m.detailed_merge_status || m.merge_status} · 파이프라인 ${pipe ? `#${pipe.id} ${pipe.status}` : '없음'} · 머지 뒤 source ${m.force_remove_source_branch || m.should_remove_source_branch ? '지움' : '남김'}`);
  const blocked = () => (m.has_conflicts ? MERGE_BLOCK.conflict : (m.draft || m.work_in_progress) ? MERGE_BLOCK.draft_status : MERGE_BLOCK[m.detailed_merge_status]);
  if (blocked()) die(`머지할 수 없습니다: ${blocked()} (${m.web_url})`);
  if (!a.yes) { console.log('  머지하지 않았습니다. 사용자가 이 MR 의 머지를 지시했으면 같은 명령에 --yes 를 붙여 다시 실행합니다'); process.exit(3); }
  const until = deadline(a);
  // 파이프라인이 돌고 있으면 끝날 때까지
  if (pipe && WAITING.has(pipe.status)) {
    say(`  ${clock()} 파이프라인 #${pipe.id} 이(가) 끝나길 기다림`);
    const res = await follow(ws, r, pipe.id, until, a.json);
    if (res.p.status !== 'success' && res.p.status !== 'manual' && res.p.status !== 'skipped') { finish(r, res, false); die(`파이프라인이 ${res.p.status} 라 머지하지 않습니다`); }
    m = await get();
  } else if (pipe && (pipe.status === 'failed' || pipe.status === 'canceled')) die(`파이프라인 #${pipe.id} 이(가) ${pipe.status} 라 머지하지 않습니다. 다시 실행: kedovi gitlab retry --repo ${r.name} --id ${pipe.id} --yes`);
  // 머지 가능 판정이 아직이면 잠깐 기다린다 (그래도 머지 요청은 보낸다: 서버가 판정한다)
  for (let i = 0; i < 6 && ['checking', 'unchecked', 'preparing', 'approvals_syncing'].includes(m.detailed_merge_status); i++) { await sleep(Math.min(5000, pollMs())); m = await get(); }
  if (blocked()) die(`머지할 수 없습니다: ${blocked()} (${m.web_url})`);
  try {
    m = await api(ws, r, 'PUT', `/merge_requests/${encodeURIComponent(iid)}/merge`, { sha: m.sha });
  } catch (e) {
    const why = { 405: `지금 머지할 수 없는 상태입니다 (${m.detailed_merge_status})`, 406: '충돌이 있거나 머지할 수 없습니다', 409: 'MR 커밋이 바뀌었습니다 (새 push). kedovi gitlab wait --mr 로 새 파이프라인을 본 뒤 다시', 401: '권한이 없습니다', 403: '이 계정은 대상 브랜치에 머지할 권한이 없습니다' }[e.status];
    die(`머지 실패: ${why || e.message}`);
  }
  say(`  ${clock()} ▶ 머지 요청`);
  while (m.state !== 'merged') {
    if (Date.now() > until) { console.log(`✖ 시간이 지나 멈춥니다 (지금 ${m.state}). 확인: ${m.web_url}`); process.exit(4); }
    await sleep(Math.min(3000, pollMs()));
    m = await get();
    if (m.state === 'closed') die('MR 이 닫혔습니다');
  }
  done(m);
}

async function cmdRetry(ws, a) {
  if (a.job && a.job !== true) return cmdJobRun(ws, { ...a, retry: a.job });
  const r = repoOrOnly(ws, a.repo);
  const id = a.id && a.id !== true ? String(a.id).replace(/^#/, '') : null;
  if (!id) die('--id <파이프라인 ID> 가 필요합니다 (작업 하나만: --job <이름>)');
  const p = await api(ws, r, 'GET', `/pipelines/${encodeURIComponent(id)}`);
  const jobs = await api(ws, r, 'GET', `/pipelines/${encodeURIComponent(id)}/jobs?per_page=100`);
  const failed = jobs.filter((j) => j.status === 'failed' || j.status === 'canceled');
  if (!failed.length) die(`파이프라인 #${id} (${p.status}) 에 실패 · 취소된 작업이 없습니다`);
  console.log(`⚠ 다시 실행: ${r.name} · 파이프라인 #${id} (${p.ref} ${String(p.sha || '').slice(0, 7)}) · ${failed.map((j) => `${j.stage}/${j.name}`).join(' · ')}`);
  console.log('  운영 배포 · 데이터를 바꾸는 작업이 들어 있으면 사용자 승인을 받은 뒤에만 실행한다.');
  if (!a.yes) { console.log('  실행하지 않았습니다. 사용자 승인을 받았으면 같은 명령에 --yes 를 붙여 다시 실행합니다'); process.exit(3); }
  await api(ws, r, 'POST', `/pipelines/${encodeURIComponent(id)}/retry`);
  console.log(`  ${clock()} ▶ 다시 실행 요청`);
  process.exit(finish(r, await follow(ws, r, id, deadline(a), a.json), a.json));
}

async function cmdCancel(ws, a) {
  const r = repoOrOnly(ws, a.repo);
  allowWrite(ws, '취소');
  let list;
  if (a.id && a.id !== true) list = [await api(ws, r, 'GET', `/pipelines/${encodeURIComponent(String(a.id).replace(/^#/, ''))}`)];
  else if (a.ref && a.ref !== true) list = await api(ws, r, 'GET', `/pipelines?per_page=50&order_by=id&sort=desc&ref=${encodeURIComponent(a.ref)}`);
  else die('--ref <브랜치> [--sha 커밋] 또는 --id <파이프라인 ID> 가 필요합니다');
  const sha = a.sha && a.sha !== true ? String(a.sha) : null;
  list = list.filter((p) => WAITING.has(p.status) && (!sha || String(p.sha || '').startsWith(sha)));
  if (!list.length) { console.log('취소할(도는) 파이프라인이 없습니다'); return; }
  console.log(`⚠ 파이프라인 취소: ${r.name} · ${list.map((p) => `#${p.id} ${p.ref} ${String(p.sha || '').slice(0, 7)} ${p.status}`).join(' · ')}`);
  if (!a.yes) { console.log('  취소하지 않았습니다. 사용자가 지시했으면 같은 명령에 --yes 를 붙여 다시 실행합니다'); process.exit(3); }
  for (const p of list) { await api(ws, r, 'POST', `/pipelines/${p.id}/cancel`); console.log(`  ⊘ #${p.id} 취소 요청`); }
}

function cmdRepos(ws) {
  const list = ws.repos.filter((r) => r.gitlab);
  if (!list.length) { console.log('gitlab 설정이 있는 repo 가 없습니다. workspace.json repos[].gitlab = {host, projectId}'); return; }
  list.forEach((r) => console.log(`${r.name}\t${r.gitlab.host}\tproject ${r.gitlab.projectId}`));
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (!['preview', 'create', 'pipeline', 'repos', 'wait', 'merge', 'play', 'retry', 'cancel'].includes(cmd)) {
    const lines = fs.readFileSync(__filename, 'utf8').split('\n');
    const from = lines.indexOf('/*') + 1;
    console.log(lines.slice(from, lines.findIndex((l, i) => i > from && l.startsWith(' * 설정:'))).map((l) => l.replace(/^ \* ?/, '')).join('\n').trim());
    process.exit(cmd ? 1 : 0);
  }
  const ws = loadWs();
  if (cmd === 'repos') return cmdRepos(ws);
  if (cmd === 'pipeline') return a.play !== undefined || a.retry !== undefined ? cmdJobRun(ws, a) : cmdPipeline(ws, a);
  if (cmd === 'wait') return cmdWait(ws, a);
  if (cmd === 'merge') return cmdMerge(ws, a);
  if (cmd === 'retry') return cmdRetry(ws, a);
  if (cmd === 'cancel') return cmdCancel(ws, a);
  if (cmd === 'play') { if (!a.job || a.job === true) die('--job <작업 이름> 이 필요합니다'); return cmdJobRun(ws, { ...a, play: a.job }); }
  if (cmd === 'preview') return cmdPreview(ws, a);
  return cmdCreate(ws, a);
}

if (require.main === module) main().catch((e) => die(e.message));

module.exports = { loadWs, parseArgs, die, token, api, apiRoot, apiBase, repoOf, repoOrOnly, defaultRemoveSource, pipelineFor };
