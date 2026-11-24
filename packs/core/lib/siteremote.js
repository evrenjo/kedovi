// 문서 사이트와 원격(GitLab · GitHub): 빌드 때 읽기(이슈 · 작업 항목 · 마일스톤 · 의견 · 게시판), 로컬 서버의 쓰기(의견 · 게시판 글 · 이슈),
// kedovi remote add 의 재빌드 연결(GitLab 파이프라인 트리거 + 웹훅). Node 기본 모듈만. 토큰은 어떤 출력 · 파일에도 쓰지 않는다.
//
// 인증: CI 는 KEDOVI_SITE_TOKEN. 이 PC 는 GITLAB_TOKEN · GITHUB_TOKEN(GH_TOKEN) 환경변수 → kedovi secret 저장소 → glab · gh 로그인.
// 시험: KEDOVI_SITE_REMOTE_FIXTURE=<json> 이면 네트워크 대신 그 파일에서 답한다 ({ "GET /경로": 값, "POST /경로": 값 }, 경로는 API 주소 뒤 · 물음표 앞).
//       쓰기 요청은 KEDOVI_SITE_REMOTE_LOG 파일에 한 줄씩 남긴다. KEDOVI_SITE_REMOTE=off 면 원격을 읽지 않는다.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const LABEL = { comment: '의견', board: '게시판', notice: '공지' };
const PAGE_MARK = /<!--\s*kedovi-page:\s*(.+?)\s*-->/;
const STAGE_LABELS = ['접수', '분석', '수정', '검증'];
const ID_RE = /(?<![\w-])[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+(?![\w-])/g;
const idsIn = (t) => [...new Set(String(t || '').match(ID_RE) || [])];

const gitOut = (dir, args) => { try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).trim(); } catch { return ''; } };

/** origin 주소 → { kind: 'gitlab'|'github', host, project, web } | null (이 PC 폴더 · file:// 이면 null) */
function parseRemote(url) {
  if (!url) return null;
  let host, p;
  let m = /^(?:ssh:\/\/)?[^@\s/]+@([^:/\s]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(url);
  if (m) [host, p] = [m[1], m[2]];
  else if (/^https?:\/\//.test(url)) { try { const u = new URL(url); host = u.host; p = u.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, ''); } catch { return null; } }
  if (!host || !p) return null;
  const kind = /github/i.test(host) ? 'github' : 'gitlab';
  return { kind, host: host.toLowerCase(), project: p, web: `https://${host}/${p}` };
}

/** 워크스페이스의 원격 정보 (CI 면 CI 변수로) */
function remoteOf(root) {
  const env = process.env;
  // CI 변수는 CI 가 받아 온 그 폴더(또는 그 안)일 때만 쓴다. 시험이 만든 임시 워크스페이스 등에는 붙이지 않는다
  const inCi = (dir) => { if (!dir) return false; const a = path.resolve(dir) + path.sep; const b = path.resolve(root || '.') + path.sep; return b.startsWith(a); };
  if (env.GITLAB_CI && env.CI_SERVER_HOST && env.CI_PROJECT_PATH && inCi(env.CI_PROJECT_DIR)) {
    const base = env['CI_API_V4_URL'] || null; // CI 가 주는 API 주소 (값은 주소, 비밀값 아님)
    return { kind: 'gitlab', host: env.CI_SERVER_HOST.toLowerCase(), project: env.CI_PROJECT_PATH, web: env.CI_PROJECT_URL || `https://${env.CI_SERVER_HOST}/${env.CI_PROJECT_PATH}`, api: base };
  }
  if (env.GITHUB_ACTIONS && env.GITHUB_REPOSITORY && inCi(env.GITHUB_WORKSPACE)) {
    const server = (env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
    return { kind: 'github', host: new URL(server).host, project: env.GITHUB_REPOSITORY, web: `${server}/${env.GITHUB_REPOSITORY}`, api: env.GITHUB_API_URL || null };
  }
  return parseRemote(gitOut(root, ['remote', 'get-url', 'origin']));
}

function apiOf(r) {
  if (r.api) return r.api.replace(/\/$/, '');
  if (r.kind === 'github') return r.host === 'github.com' ? 'https://api.github.com' : `https://${r.host}/api/v3`;
  try { return require('./secrets').gitlabApi(r.host, null); } catch { return `https://${r.host}/api/v4`; }
}
const graphqlOf = (r) => (r.host === 'github.com' ? 'https://api.github.com/graphql' : `https://${r.host}/api/graphql`);

function tryExec(cmd, args) { try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim(); } catch { return ''; } }

/** 토큰 { value, from } | null. 값은 어디에도 찍지 않는다 */
function tokenOf(root, r) {
  const env = process.env;
  if (env.KEDOVI_SITE_TOKEN) return { value: env.KEDOVI_SITE_TOKEN, from: 'KEDOVI_SITE_TOKEN' };
  const names = r.kind === 'github' ? ['GITHUB_TOKEN', 'GH_TOKEN'] : ['GITLAB_TOKEN'];
  for (const n of names) if (env[n]) return { value: env[n], from: `환경변수 ${n}` };
  try { const S = require('./secrets'); for (const n of names) { const g = S.get(n, { root, legacy: n === 'GITLAB_TOKEN' }); if (g) return { value: g.value, from: g.label }; } } catch { /* 저장소 없음 */ }
  if (env.KEDOVI_SITE_REMOTE_FIXTURE) return null; // 시험: 로그인 도구를 부르지 않는다
  const v = r.kind === 'github' ? tryExec('gh', ['auth', 'token', '--hostname', r.host]) : tryExec('glab', ['config', 'get', 'token', '--host', r.host]);
  return v && !/\s/.test(v) ? { value: v, from: r.kind === 'github' ? 'gh 로그인' : 'glab 로그인' } : null;
}

// ───────── 요청 (시험이면 fixture) ─────────

let fixture = null;
function fixtureAnswer(method, pathname) {
  if (!fixture) fixture = JSON.parse(fs.readFileSync(process.env.KEDOVI_SITE_REMOTE_FIXTURE, 'utf8'));
  const key = `${method} ${pathname}`;
  if (key in fixture) return fixture[key];
  if (method === 'GET') return pathname.endsWith('/graphql') ? { data: null } : [];
  return { id: 1, iid: 1, number: 1, web_url: 'https://remote.example/x/1', html_url: 'https://remote.example/x/1' };
}

async function request(r, token, method, url, body) {
  const u = new URL(url);
  if (process.env.KEDOVI_SITE_REMOTE_FIXTURE) {
    const base = new URL(r.kind === 'github' && url.endsWith('/graphql') ? graphqlOf(r) : apiOf(r));
    const p = decodeURIComponent(u.pathname.slice(base.pathname.replace(/\/$/, '').length)) || '/';
    if (method !== 'GET' || p === '/graphql' || url.endsWith('/graphql')) {
      if (process.env.KEDOVI_SITE_REMOTE_LOG) fs.appendFileSync(process.env.KEDOVI_SITE_REMOTE_LOG, `${JSON.stringify({ method, path: url.endsWith('/graphql') ? '/graphql' : p, body: body || null })}\n`);
    }
    return fixtureAnswer(method, url.endsWith('/graphql') ? '/graphql' : p);
  }
  const headers = { accept: 'application/json', 'user-agent': 'kedovi-docs' };
  if (token) { if (r.kind === 'github') headers.authorization = `Bearer ${token.value}`; else headers['PRIVATE-TOKEN'] = token.value; }
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) { const e = new Error(`${r.kind === 'github' ? 'GitHub' : 'GitLab'} ${res.status}${typeof data === 'object' && data && data.message ? `: ${String(JSON.stringify(data.message)).slice(0, 160)}` : ''}`); e.status = res.status; throw e; }
  return data;
}
async function pages(r, token, url, max = 3) {
  const out = [];
  for (let p = 1; p <= max; p++) {
    const d = await request(r, token, 'GET', `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${p}`);
    if (!Array.isArray(d)) break;
    out.push(...d);
    if (d.length < 100) break;
  }
  return out;
}

// ───────── 읽기 ─────────

const stateKo = (s) => (/^(opened|open)$/i.test(s) ? '열림' : /^closed$/i.test(s) ? '닫힘' : String(s || ''));
const date10 = (s) => (s ? String(s).slice(0, 10) : null);
const enc = (p) => encodeURIComponent(p);
/** 의견 첫 줄 「> 「고른 글자」」 → { quote, text } */
function splitQuote(body) {
  const m = /^>\s*「([\s\S]*?)」\s*\n?/.exec(String(body || ''));
  return m ? { quote: m[1].trim(), text: String(body).slice(m[0].length).trim() } : { quote: '', text: String(body || '').trim() };
}
const labelNames = (l) => (l || []).map((x) => (typeof x === 'string' ? x : x && x.name)).filter(Boolean);

function issueItem(i, kind) {
  const labels = labelNames(i.labels);
  const stage = (labels.map((x) => x.replace(/^단계::/, '')).find((x) => STAGE_LABELS.includes(x))) || '';
  const who = kind === 'github' ? (i.assignee && i.assignee.login) : (i.assignee && i.assignee.username) || ((i.assignees || [])[0] || {}).username;
  return {
    id: `#${kind === 'github' ? i.number : i.iid}`, title: String(i.title || ''), state: stateKo(i.state), stage,
    labels: labels.filter((x) => !Object.values(LABEL).includes(x) && !STAGE_LABELS.includes(x.replace(/^단계::/, ''))),
    assignee: who || null, ids: idsIn(`${i.title} ${i.description || i.body || ''}`), milestone: (i.milestone && i.milestone.title) || null,
    created: i.created_at || null, updated: i.updated_at || null, url: i.web_url || i.html_url || null,
  };
}

/**
 * 원격에서 사이트 DB 에 넣을 것을 읽는다. 실패해도 던지지 않는다.
 * 반환 { ok, kind, web, project, api, pages, issuesUrl, issues, workItems, milestones, board, comments, commentIssues, error? } | null (원격 없음)
 */
async function read(root, { pagesUrl = null } = {}) {
  const r = remoteOf(root);
  if (!r) return null;
  const base = { ok: false, kind: r.kind, web: r.web, project: r.project, api: apiOf(r), pages: pagesUrl, issuesUrl: `${r.web}${r.kind === 'github' ? '' : '/-'}/issues`, issues: [], workItems: [], milestones: [], board: [], comments: {}, commentIssues: {} };
  if (process.env.KEDOVI_SITE_REMOTE === 'off') return { ...base, error: '원격 읽기 꺼짐 (KEDOVI_SITE_REMOTE=off)' };
  const token = tokenOf(root, r);
  if (!token && !process.env.KEDOVI_SITE_REMOTE_FIXTURE) return { ...base, error: '인증 없음' };
  try {
    return { ...base, ...(r.kind === 'github' ? await readGithub(r, token) : await readGitlab(r, token)), ok: true };
  } catch (e) { return { ...base, error: e.name === 'TimeoutError' ? '시간 초과' : e.message }; }
}

async function readGitlab(r, token) {
  const api = `${apiOf(r)}/projects/${enc(r.project)}`;
  const all = await pages(r, token, `${api}/issues?state=all&order_by=updated_at`);
  const out = { issues: [], workItems: [], milestones: [], board: [], comments: {}, commentIssues: {} };
  const notes = async (iid) => (await pages(r, token, `${api}/issues/${iid}/notes?sort=asc`, 1)).filter((n) => !n.system);
  let noteCalls = 0;
  for (const i of all) {
    const labels = labelNames(i.labels);
    if (labels.includes(LABEL.comment)) {
      const m = PAGE_MARK.exec(i.description || '');
      if (!m || noteCalls++ > 60) continue;
      const page = m[1];
      out.commentIssues[page] = i.web_url;
      out.comments[page] = [...(out.comments[page] || []), ...(await notes(i.iid)).map((n) => ({ id: `n${n.id}`, who: (n.author && n.author.username) || '', at: n.created_at, ...splitQuote(n.body), url: `${i.web_url}#note_${n.id}` }))];
      continue;
    }
    if (labels.includes(LABEL.board) || labels.includes(LABEL.notice)) {
      const cs = noteCalls++ < 60 ? await notes(i.iid) : [];
      out.board.push({ id: `#${i.iid}`, title: i.title, body: i.description || '', author: (i.author && i.author.username) || null, at: i.created_at, pinned: labels.includes(LABEL.notice), comments: cs.map((n) => ({ who: (n.author && n.author.username) || '', at: n.created_at, text: n.body })), url: i.web_url });
      continue;
    }
    if (i.issue_type === 'task' || (i.type && /task/i.test(i.type))) {
      const it = issueItem(i, 'gitlab');
      out.workItems.push({ id: it.id, title: it.title, assignee: it.assignee, start: date10(i.start_date) || null, due: date10(i.due_date), state: it.state, feature: null, milestone: it.milestone, url: it.url, ids: it.ids });
      continue;
    }
    out.issues.push(issueItem(i, 'gitlab'));
  }
  out.milestones = (await pages(r, token, `${api}/milestones?state=all`, 1)).map((m) => ({ name: m.title, start: date10(m.start_date), due: date10(m.due_date), url: m.web_url || null }));
  return out;
}

async function readGithub(r, token) {
  const api = `${apiOf(r)}/repos/${r.project}`;
  const all = (await pages(r, token, `${api}/issues?state=all&sort=updated`)).filter((i) => !i.pull_request);
  const out = { issues: [], workItems: [], milestones: [], board: [], comments: {}, commentIssues: {} };
  const comments = async (n) => pages(r, token, `${api}/issues/${n}/comments`, 1);
  let calls = 0;
  for (const i of all) {
    const labels = labelNames(i.labels);
    if (labels.includes(LABEL.comment)) {
      const m = PAGE_MARK.exec(i.body || '');
      if (!m || calls++ > 60) continue;
      out.commentIssues[m[1]] = i.html_url;
      out.comments[m[1]] = [...(out.comments[m[1]] || []), ...(await comments(i.number)).map((c) => ({ id: `c${c.id}`, who: (c.user && c.user.login) || '', at: c.created_at, ...splitQuote(c.body), url: c.html_url }))];
      continue;
    }
    if (labels.includes(LABEL.board) || labels.includes(LABEL.notice)) {
      const cs = calls++ < 60 ? await comments(i.number) : [];
      out.board.push({ id: `#${i.number}`, title: i.title, body: i.body || '', author: (i.user && i.user.login) || null, at: i.created_at, pinned: labels.includes(LABEL.notice), comments: cs.map((c) => ({ who: (c.user && c.user.login) || '', at: c.created_at, text: c.body })), url: i.html_url });
      continue;
    }
    out.issues.push(issueItem(i, 'github'));
  }
  out.milestones = (await pages(r, token, `${api}/milestones?state=all`, 1)).map((m) => ({ name: m.title, start: null, due: date10(m.due_on), url: m.html_url || null }));
  // Discussions (켜져 있고 토큰이 있으면): 공지 · 게시판 분류는 게시판, 의견 분류(쪽 표시가 있는 글)는 의견
  if (token || process.env.KEDOVI_SITE_REMOTE_FIXTURE) {
    const [owner, name] = r.project.split('/');
    const q = 'query($o:String!,$n:String!){repository(owner:$o,name:$n){hasDiscussionsEnabled discussions(first:50,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title body url createdAt author{login} category{name} comments(first:50){nodes{id body createdAt url author{login}}}}}}}';
    try {
      const d = await request(r, token, 'POST', graphqlOf(r), { query: q, variables: { o: owner, n: name } });
      const repo = d && d.data && d.data.repository;
      for (const x of (repo && repo.hasDiscussionsEnabled && repo.discussions && repo.discussions.nodes) || []) {
        const cat = (x.category && x.category.name) || '';
        const cs = ((x.comments && x.comments.nodes) || []);
        const m = PAGE_MARK.exec(x.body || '');
        if (m) {
          out.commentIssues[m[1]] = out.commentIssues[m[1]] || x.url;
          out.comments[m[1]] = [...(out.comments[m[1]] || []), ...cs.map((c) => ({ id: `d${c.id}`, who: (c.author && c.author.login) || '', at: c.createdAt, ...splitQuote(c.body), url: c.url }))];
        } else if (cat === LABEL.board || cat === LABEL.notice) {
          out.board.push({ id: `D${x.number}`, title: x.title, body: x.body || '', author: (x.author && x.author.login) || null, at: x.createdAt, pinned: cat === LABEL.notice, comments: cs.map((c) => ({ who: (c.author && c.author.login) || '', at: c.createdAt, text: c.body })), url: x.url });
        }
      }
    } catch { /* Discussions 를 못 읽으면 이슈만 */ }
  }
  return out;
}

// ───────── 쓰기 (로컬 서버) ─────────

/** 이 PC 에서 원격에 쓸 수 있나 { remote, token } (token 은 쓰기에만 쓰고 내보내지 않는다) */
function writer(root) {
  const r = remoteOf(root);
  if (!r || process.env.KEDOVI_SITE_REMOTE === 'off') return { remote: r, token: null };
  return { remote: r, token: tokenOf(root, r) || (process.env.KEDOVI_SITE_REMOTE_FIXTURE ? { value: 'fixture', from: 'fixture' } : null) };
}

/** 문서 의견: 문서마다 「의견」 이슈 하나(없으면 만든다), 의견 = 댓글. 반환 { url } */
async function writeComment(root, { page, title, quote, text, who }) {
  const { remote: r, token } = writer(root);
  const body = `${quote ? `> 「${quote.replace(/\n/g, ' ')}」\n\n` : ''}${text}${who ? `\n\n(작성: ${who}, 문서 사이트)` : ''}`;
  if (r.kind === 'github') {
    const api = `${apiOf(r)}/repos/${r.project}`;
    const list = await pages(r, token, `${api}/issues?labels=${enc(LABEL.comment)}&state=all`, 2);
    let it = list.find((i) => (PAGE_MARK.exec(i.body || '') || [])[1] === page);
    if (!it) it = await request(r, token, 'POST', `${api}/issues`, { title: `의견: ${title || page}`, body: `<!-- kedovi-page: ${page} -->\n문서 「${title || page}」 의견을 모으는 이슈 (문서 사이트가 만듦).`, labels: [LABEL.comment] });
    const c = await request(r, token, 'POST', `${api}/issues/${it.number}/comments`, { body });
    return { url: c.html_url || it.html_url || null };
  }
  const api = `${apiOf(r)}/projects/${enc(r.project)}`;
  const list = await pages(r, token, `${api}/issues?labels=${enc(LABEL.comment)}&state=all`, 2);
  let it = list.find((i) => (PAGE_MARK.exec(i.description || '') || [])[1] === page);
  if (!it) it = await request(r, token, 'POST', `${api}/issues`, { title: `의견: ${title || page}`, description: `<!-- kedovi-page: ${page} -->\n문서 「${title || page}」 의견을 모으는 이슈 (문서 사이트가 만듦).`, labels: LABEL.comment });
  const n = await request(r, token, 'POST', `${api}/issues/${it.iid}/notes`, { body });
  return { url: it.web_url ? `${it.web_url}#note_${n.id}` : null };
}

/** 게시판 글: 라벨 「게시판」(공지면 「공지」 도) 이슈. 반환 { url } */
async function writeBoard(root, { title, body, pinned }) {
  const { remote: r, token } = writer(root);
  const labels = [LABEL.board, ...(pinned ? [LABEL.notice] : [])];
  if (r.kind === 'github') { const it = await request(r, token, 'POST', `${apiOf(r)}/repos/${r.project}/issues`, { title, body, labels }); return { url: it.html_url || null }; }
  const it = await request(r, token, 'POST', `${apiOf(r)}/projects/${enc(r.project)}/issues`, { title, description: body, labels: labels.join(',') });
  return { url: it.web_url || null };
}

/** 이슈. 반환 { url } */
async function writeIssue(root, { title, body, ids }) {
  const { remote: r, token } = writer(root);
  const text = `${body || ''}${ids && ids.length ? `\n\n관련: ${ids.join(' · ')}` : ''}`.trim();
  if (r.kind === 'github') { const it = await request(r, token, 'POST', `${apiOf(r)}/repos/${r.project}/issues`, { title, body: text }); return { url: it.html_url || null }; }
  const it = await request(r, token, 'POST', `${apiOf(r)}/projects/${enc(r.project)}/issues`, { title, description: text });
  return { url: it.web_url || null };
}

// ───────── kedovi remote add: 원격 이슈가 바뀌면 Pages 다시 만들기 ─────────

const HOOK_MARK = '/trigger/pipeline';
/**
 * GitLab: 파이프라인 트리거 + 프로젝트 웹훅(이슈 · 댓글 이벤트 → 트리거). 토큰(권한 api)이 있으면 API 로 만들고, 없으면 손으로 하는 법.
 * 반환 [안내 줄] (토큰 · 트리거 값은 넣지 않는다)
 */
async function setupGitlab(root, { branch = 'main' } = {}) {
  const r = remoteOf(root);
  if (!r || r.kind !== 'gitlab') return [];
  const api = `${apiOf(r)}/projects/${enc(r.project)}`;
  const manual = [
    'GitLab 이슈 · 의견이 바뀌면 사이트 다시 만들기 (한 번만, 프로젝트 관리자):',
    `  1. ${r.web}/-/settings/ci_cd 의 「파이프라인 트리거 토큰」 에서 토큰을 만든다 (설명: kedovi docs pages)`,
    `  2. ${r.web}/-/hooks 에 웹훅 추가. 주소: ${apiOf(r)}/projects/${enc(r.project)}/ref/${branch}/trigger/pipeline?token=<1의 토큰>, 이벤트: 이슈 · 댓글 · 작업 항목`,
    '  또는 토큰(권한 api)을 넣고 다시: kedovi secret set GITLAB_TOKEN → kedovi remote setup',
  ];
  const token = tokenOf(root, r);
  if (!token) return manual;
  try {
    const hooks = await request(r, token, 'GET', `${api}/hooks?per_page=100`);
    if (Array.isArray(hooks) && hooks.some((h) => String(h.url || '').includes(HOOK_MARK))) return ['✔ GitLab 웹훅(이슈 · 댓글 → 사이트 다시 만들기)이 이미 있습니다'];
    const triggers = await request(r, token, 'GET', `${api}/triggers?per_page=100`);
    let trig = Array.isArray(triggers) ? triggers.find((t) => t.description === 'kedovi docs pages' && t.token && !/\*/.test(t.token)) : null;
    if (!trig) trig = await request(r, token, 'POST', `${api}/triggers`, { description: 'kedovi docs pages' });
    if (!trig || !trig.token) return ['⚠ 파이프라인 트리거 토큰을 받지 못했습니다.', ...manual];
    await request(r, token, 'POST', `${api}/hooks`, { url: `${apiOf(r)}/projects/${enc(r.project)}/ref/${enc(branch)}/trigger/pipeline?token=${trig.token}`, issues_events: true, note_events: true, confidential_issues_events: false, push_events: false, enable_ssl_verification: true });
    return [`✔ GitLab 웹훅을 만들었습니다: 이슈 · 댓글이 바뀌면 ${branch} 파이프라인이 사이트를 다시 만든다 (${token.from} 사용)`];
  } catch (e) {
    return [`⚠ GitLab 웹훅을 만들지 못했습니다 (${e.message}). 권한(프로젝트 관리자) · 서버 설정(웹훅의 내부 주소 요청 허용)을 확인한다.`, ...manual];
  }
}

/** GitLab Pages 주소 (API 가 알려 주면). 없으면 null */
async function gitlabPagesUrl(root) {
  const r = remoteOf(root);
  if (!r || r.kind !== 'gitlab') return null;
  const token = tokenOf(root, r);
  if (!token) return null;
  try { const d = await request(r, token, 'GET', `${apiOf(r)}/projects/${enc(r.project)}/pages`); return (d && d.url) || null; } catch { return null; }
}

module.exports = { LABEL, PAGE_MARK, parseRemote, remoteOf, apiOf, tokenOf, read, writer, writeComment, writeBoard, writeIssue, setupGitlab, gitlabPagesUrl, splitQuote };
