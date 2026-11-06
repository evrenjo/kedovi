#!/usr/bin/env node
// 운영 배포 연쇄: develop → release MR → MR 파이프라인 → 머지 → release 파이프라인 → (--deploy) 배포 작업. 사용: kedovi release <repo> [--deploy] [--yes] [--dry-run]
'use strict';

/*
 * kedovi release [<repo>] [--deploy] [--job <배포 작업>] [--yes] [--dry-run] [--timeout 분] [--title "…"] [--description-file F]
 *
 *   1. 배포 전 확인 (기본 판정): develop 머리 커밋과 같은 트리의 develop 파이프라인이 성공했고, 그 파이프라인 뒤로
 *      CI 설정(.gitlab-ci.yml 과 include 의 project · ref 파일)이 바뀌지 않았는지 GitLab API 로 본다.
 *      repos[].gitlab.releaseCheck(명령)이 있으면 그것도 통과해야 한다 (환경변수 KEDOVI_RELEASE_SHA · _TREE · _PIPELINE · _REF).
 *      하나라도 실패면 develop 파이프라인을 새로 돌린 뒤 다시 판정한다.
 *   2. release MR (develop → release, 열린 MR 은 다시 씀) → 3. MR 파이프라인 끝까지 → 4. 머지 (vars.gitlab.agentMerge)
 *   5. release 파이프라인 끝까지 → 6. (--deploy) 배포 작업(repos[].gitlab.deployJob 또는 --job) 실행 → 끝까지
 *
 *   파이프라인은 하나씩: 같은 repo(repos[].gitlab.runnerGroup 이 같으면 그 repo 들까지)에 도는 파이프라인이 있으면 끝난 뒤 다음 단계.
 *   일시 오류: 실패한 작업 로그 끝부분이 레지스트리 · 네트워크 일시 오류 모양이면 그 작업을 vars.gitlab.retryMax(기본 2)번까지 다시 실행. 그 밖의 실패는 바로 멈춘다.
 *   운영 배포 작업은 일시 오류여도 다시 실행하지 않고 다시 실행 명령을 보이며 멈춘다 (vars.gitlab.retryDeploy = true 면 다시 실행).
 *   --yes 가 없으면 계획과 판정만 보이고 멈춘다 (끝 코드 3). --dry-run 도 같고 끝 코드 0. 둘 다 GitLab 에 아무것도 쓰지 않는다.
 *   끝 코드: 0 끝 · 1 실패 · 3 승인 · 선택 필요 · 4 시간 초과 · 5 파이프라인이 안 생김.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const M = require('./gitlab-mr.js');
const L = require('./ci-load.js');

// 일시 오류 모양 (로그 끝부분). vars.gitlab.retryPatterns 로 더한다
const TRANSIENT = [
  /i\/o timeout/i,
  /connection reset by peer/i,
  /TLS handshake timeout/i,
  /proxyconnect/i,
  /context deadline exceeded/i,
  /Client\.Timeout exceeded/i,
  /net\/http: request canceled/i,
  /temporary failure in name resolution/i,
  /dial tcp [^\n]*: connect: connection refused/i,
  /\b50[234]\b[^\n]*(registry|manifest|blob|docker|pull|push|proxy)/i,
  /(registry|manifest|blob|docker|pull|push|proxy)[^\n]*\b50[234]\b/i,
  /(Bad Gateway|Service Unavailable|Gateway Time-?out)[^\n]*(registry|manifest|blob|v2\/)/i,
  /ERROR: Job failed \(system failure\)/i,
];
// GitLab 이 알려 주는 인프라 쪽 실패 이유
const INFRA_REASON = new Set(['runner_system_failure', 'stuck_or_timeout_failure', 'api_failure', 'scheduler_failure', 'data_integrity_failure', 'runner_unsupported']);

const sha7 = (s) => String(s || '').slice(0, 7);
const enc = encodeURIComponent;

function patterns(ws) {
  const extra = (M.vars(ws).retryPatterns || []).map((p) => { try { return new RegExp(p, 'i'); } catch { return null; } }).filter(Boolean);
  return [...TRANSIENT, ...extra];
}

/** 실패한 작업이 일시 오류인가 → { ok, why } */
async function transient(ws, r, job) {
  if (INFRA_REASON.has(job.failure_reason)) return { ok: true, why: job.failure_reason };
  let tail = [];
  try {
    tail = String(await M.api(ws, r, 'GET', `/jobs/${job.id}/trace`)).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').split('\n').filter((l) => l.trim()).slice(-Math.max(10, Number(M.vars(ws).retryTail) || 80));
  } catch { return { ok: false, why: '로그를 읽지 못함' }; }
  const pats = patterns(ws);
  for (let i = tail.length - 1; i >= 0; i--) if (pats.some((p) => p.test(tail[i]))) return { ok: true, why: tail[i].trim().slice(0, 160) };
  return { ok: false, why: (tail[tail.length - 1] || '').trim().slice(0, 160) };
}

// ── CI 설정의 include ────────────────────────────────────────────────

const unq = (v) => String(v).trim().replace(/^(['"])(.*)\1$/, '$2');
function flowList(v) {
  const s = v.trim().replace(/^\[/, '').replace(/\]$/, '');
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '{' || ch === '[') depth++;
    if (ch === '}' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
function flowMap(v) {
  const o = {};
  for (const part of flowList(v.trim().replace(/^\{/, '[').replace(/\}$/, ']'))) {
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(part);
    if (m) o[m[1]] = m[2].startsWith('[') ? flowList(m[2]).map(unq) : unq(m[2]);
  }
  return o;
}
const scalar = (v) => (v.startsWith('{') ? flowMap(v) : unq(v));

/** .gitlab-ci.yml 텍스트 → include 항목 [{ local | project, ref, file[] | remote | template | component }]. 맨 위 include 키만 본다 (의존성 없는 작은 해석) */
function parseIncludes(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const at = lines.findIndex((l) => /^include\s*:/.test(l));
  if (at < 0) return [];
  const inline = lines[at].replace(/^include\s*:\s*/, '').replace(/\s+#.*$/, '').trim();
  let items = [];
  if (inline) items = inline.startsWith('[') ? flowList(inline).map(scalar) : [scalar(inline)];
  else {
    const block = [];
    for (let i = at + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^\S/.test(l) && !/^#/.test(l)) break;
      if (!l.trim() || /^\s*#/.test(l)) continue;
      block.push(l.replace(/\s+#.*$/, ''));
    }
    const ind = (l) => l.match(/^\s*/)[0].length;
    const isList = block.length && /^\s*-\s/.test(block[0]);
    const base = block.length ? ind(block[0]) : 0;
    let cur = null; let lastKey = null;
    const put = (k, v) => { cur[k] = v === '' ? [] : v.startsWith('[') ? flowList(v).map(unq) : unq(v); lastKey = k; };
    if (!isList && block.length) { cur = {}; items.push(cur); }
    for (const l of block) {
      const dash = /^(\s*)-\s+(.*)$/.exec(l);
      if (isList && dash && ind(l) === base) {
        const rest = dash[2];
        const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(rest);
        if (kv && !/^https?:/.test(rest)) { cur = {}; items.push(cur); put(kv[1], kv[2]); } else { cur = null; items.push(scalar(rest)); }
        continue;
      }
      if (!cur) continue;
      if (dash && lastKey && Array.isArray(cur[lastKey])) { cur[lastKey].push(unq(dash[2])); continue; }
      const kv = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(l);
      if (kv && ind(l) <= base + 4) put(kv[1], kv[2]);
    }
  }
  return items.map((x) => {
    if (typeof x === 'string') return /^https?:\/\//.test(x) ? { remote: x } : { local: x };
    const o = { ...x };
    if (o.file !== undefined) o.file = [].concat(o.file);
    return o;
  }).filter((x) => x.local || x.project || x.remote || x.template || x.component);
}

const normPath = (p) => String(p).replace(/^\/+/, '');

/** 프로젝트(경로 또는 ID)의 파일 원문. 없으면 null */
async function rawFile(ws, r, project, file, ref) {
  try {
    const t = await M.apiRoot(ws, r, 'GET', `/projects/${enc(project)}/repository/files/${enc(normPath(file))}/raw?ref=${enc(ref)}`);
    return typeof t === 'string' ? t : JSON.stringify(t);
  } catch (e) { if (e.status === 404) return null; throw e; }
}

/**
 * CI 설정을 따라가며 바깥 include 를 모은다.
 * → { external: Map("project@ref" → { project, ref, files:Set }), unknown: [설명] }
 * local 은 같은 트리라 바뀌지 않았다 (중첩된 바깥 include 를 찾으려고만 읽는다).
 */
async function collectIncludes(ws, r, sha) {
  const external = new Map();
  const unknown = [];
  const seen = new Set();
  const proj = await M.api(ws, r, 'GET', '');
  let entry = proj.ci_config_path || '.gitlab-ci.yml';
  const queue = [];
  // CI 설정 경로가 다른 프로젝트(파일@그룹/프로젝트[:ref])면 그것도 바깥 include
  const ext = /^(.+)@([^:]+)(?::(.+))?$/.exec(entry);
  if (ext) queue.push({ project: ext[2], ref: ext[3] || null, file: ext[1], depth: 0 });
  else queue.push({ project: String(r.gitlab.projectId), ref: sha, file: entry, depth: 0, self: true });
  while (queue.length) {
    const q = queue.shift();
    let ref = q.ref;
    if (!q.self) {
      if (!ref) {
        try { ref = (await M.apiRoot(ws, r, 'GET', `/projects/${enc(q.project)}`)).default_branch; } catch { unknown.push(`${q.project}: 프로젝트를 읽지 못함`); continue; }
      }
      const k = `${q.project}@${ref}`;
      if (!external.has(k)) external.set(k, { project: q.project, ref, files: new Set() });
      external.get(k).files.add(normPath(q.file));
    }
    const key = `${q.project}@${ref}:${normPath(q.file)}`;
    if (seen.has(key) || q.depth > 4) continue;
    seen.add(key);
    if (/[*$]/.test(q.file)) { if (/\$/.test(q.file)) unknown.push(`${q.file}: 변수가 든 경로`); continue; }
    let text = null;
    try { text = await rawFile(ws, r, q.project, q.file, ref); } catch (e) { unknown.push(`${q.project}:${q.file}@${ref}: ${e.message}`); continue; }
    if (text == null) { if (q.self && q.depth === 0) unknown.push(`${q.file}: CI 설정 파일이 없음`); else unknown.push(`${q.project}:${q.file}@${ref}: 파일이 없음`); continue; }
    for (const inc of parseIncludes(text)) {
      if (inc.local) queue.push({ project: q.project, ref, file: inc.local, depth: q.depth + 1, self: q.self });
      else if (inc.project) {
        if (/\$/.test(inc.project) || /\$/.test(inc.ref || '')) { unknown.push(`include project ${inc.project}@${inc.ref || '기본 브랜치'}: 변수가 들어 있어 판정하지 못함`); continue; }
        for (const f of inc.file || []) queue.push({ project: inc.project, ref: inc.ref || null, file: f, depth: q.depth + 1 });
      } else if (inc.component) {
        // 호스트/그룹/프로젝트/이름@버전 → 그 프로젝트의 templates/이름.yml · templates/이름/template.yml
        const m = /^[^/]+\/(.+)\/([^/@]+)@(.+)$/.exec(inc.component);
        if (!m || /\$|~latest/.test(inc.component)) { unknown.push(`component ${inc.component}: 판정하지 못함 (변수 · ~latest)`); continue; }
        for (const f of [`templates/${m[2]}.yml`, `templates/${m[2]}/template.yml`]) {
          const k = `${m[1]}@${m[3]}`;
          if (!external.has(k)) external.set(k, { project: m[1], ref: m[3], files: new Set() });
          external.get(k).files.add(f);
        }
      } else if (inc.remote) unknown.push(`remote ${inc.remote}: 판정하지 못함 (releaseCheck 로 확인)`);
      else if (inc.template) { /* GitLab 내장 템플릿: GitLab 버전에 묶인다. 판정에서 뺀다 */ }
    }
  }
  return { external, unknown };
}

/** 바깥 include 가 그 시각(since) 뒤에 바뀌었나 → { changed: [설명], unknown: [설명] } */
async function includesChangedSince(ws, r, external, since) {
  const changed = [];
  const unknown = [];
  for (const { project, ref, files } of external.values()) {
    const label = `${project}@${ref}`;
    if (/^[0-9a-f]{40}$/i.test(ref)) continue; // 커밋 고정: 안 바뀐다
    let kind = null; let head = null;
    try { head = (await M.apiRoot(ws, r, 'GET', `/projects/${enc(project)}/repository/branches/${enc(ref)}`)).commit; kind = 'branch'; } catch (e) { if (e.status !== 404) { unknown.push(`${label}: ${e.message}`); continue; } }
    if (!kind) {
      try { head = (await M.apiRoot(ws, r, 'GET', `/projects/${enc(project)}/repository/tags/${enc(ref)}`)).commit; kind = 'tag'; } catch (e) { unknown.push(`${label}: 브랜치 · 태그를 찾지 못함`); continue; }
    }
    if (kind === 'tag') {
      // 태그가 파이프라인 뒤의 커밋을 가리키면 바뀐 것 (태그를 옮긴 경우)
      if (head && head.committed_date && new Date(head.committed_date) > new Date(since)) changed.push(`${label} (태그): 파이프라인 뒤 커밋 ${sha7(head.id)} ${M.when(head.committed_date)}`);
      continue;
    }
    // 브랜치: 파이프라인 시각의 커밋 → 지금 머리 사이에 include 파일이 바뀌었나
    let old = null;
    try { old = (await M.apiRoot(ws, r, 'GET', `/projects/${enc(project)}/repository/commits?ref_name=${enc(ref)}&until=${enc(since)}&per_page=1`))[0]; } catch { old = null; }
    if (!old) { unknown.push(`${label}: 파이프라인 시각의 커밋을 찾지 못함`); continue; }
    if (old.id === head.id) continue;
    let cmp;
    try { cmp = await M.apiRoot(ws, r, 'GET', `/projects/${enc(project)}/repository/compare?from=${enc(old.id)}&to=${enc(head.id)}&straight=true`); } catch (e) { unknown.push(`${label}: 비교 실패 ${e.message}`); continue; }
    const touched = (cmp.diffs || []).filter((d) => files.has(normPath(d.new_path)) || files.has(normPath(d.old_path))).map((d) => d.new_path);
    if (touched.length) changed.push(`${label} (브랜치): ${touched.join(', ')} 이(가) 파이프라인 뒤 바뀜 (${sha7(old.id)} → ${sha7(head.id)})`);
  }
  return { changed, unknown };
}

// ── 판정 ────────────────────────────────────────────────────────────

/** 두 커밋의 트리가 같은가 (GitLab compare, 직접 비교) */
async function sameTree(ws, r, a, b) {
  if (a === b) return true;
  try { return !((await M.api(ws, r, 'GET', `/repository/compare?from=${enc(a)}&to=${enc(b)}&straight=true`)).diffs || [1]).length; } catch { return false; }
}

function localTree(r, sha, branch) {
  if (!r.dir || !fs.existsSync(r.dir)) return '';
  const g = (args) => execFileSync('git', ['-C', r.dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try { return g(['rev-parse', `${sha}^{tree}`]); } catch { /* 아직 안 받은 커밋 */ }
  try { g(['fetch', '-q', 'origin', branch]); return g(['rev-parse', `${sha}^{tree}`]); } catch { return ''; }
}

/**
 * 배포 전 확인 → { ok, head, tree, match, running, ci, check, reasons[] }
 *   match: 같은 트리의 성공한 develop 파이프라인, running: 같은 트리의 도는 develop 파이프라인
 */
async function verify(ws, r, br) {
  const head = (await M.refHead(ws, r, br.develop)).sha;
  const tree = localTree(r, head, br.develop);
  const list = await M.api(ws, r, 'GET', `/pipelines?ref=${enc(br.develop)}&per_page=30&order_by=id&sort=desc`);
  let match = null; let running = null; let compares = 0;
  for (const p of list) {
    const same = p.sha === head || (compares++ < 6 && await sameTree(ws, r, p.sha, head));
    if (!same) continue;
    if (!running && M.WAITING.has(p.status)) running = p;
    if (p.status === 'success') { match = p; break; }
  }
  const reasons = [];
  const out = { head, tree, match, running, ci: { changed: [], unknown: [] }, check: null, reasons };
  if (!match) reasons.push(running ? `같은 트리의 develop 파이프라인 #${running.id} 이(가) 아직 ${running.status}` : `develop 머리 ${sha7(head)} 와 같은 트리의 성공한 develop 파이프라인이 없음`);
  else {
    const { external, unknown } = await collectIncludes(ws, r, head);
    const res = await includesChangedSince(ws, r, external, match.created_at);
    out.ci = { changed: res.changed, unknown: [...unknown, ...res.unknown], includes: [...external.keys()] };
    if (res.changed.length) reasons.push(`파이프라인 #${match.id} 뒤 CI 설정이 바뀜: ${res.changed.join(' · ')}`);
  }
  const cmd = r.gitlab.releaseCheck;
  if (cmd && match && !reasons.length) {
    const env = { ...process.env, KEDOVI_RELEASE_SHA: head, KEDOVI_RELEASE_TREE: tree, KEDOVI_RELEASE_REF: br.develop, KEDOVI_RELEASE_PIPELINE: String(match.id), KEDOVI_GITLAB_PROJECT: String(r.gitlab.projectId), KEDOVI_GITLAB_HOST: r.gitlab.host };
    delete env[(M.vars(ws).tokenEnv || 'GITLAB_TOKEN')];
    const c = spawnSync('sh', ['-c', cmd], { cwd: r.dir && fs.existsSync(r.dir) ? r.dir : ws.root, env, encoding: 'utf8', timeout: (Number(M.vars(ws).releaseCheckTimeout) || 300) * 1000 });
    const lines = `${c.stdout || ''}${c.stderr || ''}`.split('\n').filter((l) => l.trim()).slice(-5);
    out.check = { cmd, code: c.status, out: lines };
    if (c.status !== 0) reasons.push(`확인 명령 실패 (끝 코드 ${c.status == null ? '시간 초과' : c.status}): ${cmd}`);
  }
  out.ok = !reasons.length;
  return out;
}

function showVerify(v) {
  console.log(`  develop 머리 ${sha7(v.head)}${v.tree ? ` · 트리 ${sha7(v.tree)}` : ''}`);
  if (v.match) console.log(`  같은 트리 develop 파이프라인: #${v.match.id} ✔ success (${M.when(v.match.created_at)}${v.match.sha !== v.head ? `, 커밋 ${sha7(v.match.sha)}` : ''})`);
  if (v.ci.includes && v.ci.includes.length) console.log(`  바깥 include: ${v.ci.includes.join(' · ')}`);
  v.ci.changed.forEach((x) => console.log(`  ✖ CI 설정 바뀜: ${x}`));
  v.ci.unknown.forEach((x) => console.log(`  ⚠ ${x}`));
  if (v.check) { console.log(`  확인 명령: ${v.check.cmd} → ${v.check.code === 0 ? '✔ 통과' : '✖ 실패'}`); v.check.out.forEach((l) => console.log(`      | ${l}`)); }
  console.log(v.ok ? '  → 판정 통과' : `  → 판정 실패: ${v.reasons.join(' · ')}`);
}

// ── 실행 ────────────────────────────────────────────────────────────

async function main(argv) {
  const a = M.parseArgs(argv);
  const ws = M.loadWs();
  const r = M.repoOrOnly(ws, a._[0] || a.repo);
  const V = M.vars(ws);
  const br = { develop: (ws.vars && ws.vars.branch && ws.vars.branch.develop) || 'develop', release: (ws.vars && ws.vars.branch && ws.vars.branch.release) || 'release' };
  const deploy = !!a.deploy;
  const job = (a.job && a.job !== true && String(a.job)) || r.gitlab.deployJob || null;
  const retryMax = Math.max(0, Math.min(5, V.retryMax === undefined ? 2 : Number(V.retryMax)));
  const until = Date.now() + Math.max(1, Number(a.timeout) || 120) * 60000;
  const mergeOk = V.agentMerge === true || (process.stdin.isTTY && process.stdout.isTTY);
  const say = (t) => console.log(`  ${M.clock()} ${t}`);
  const warned = new Set();
  const loadWarn = () => { const w = L.localWarn(ws); if (w && !warned.has(w)) { warned.add(w); console.log(`  ${w}`); } };

  // 계획
  const cmp = await M.api(ws, r, 'GET', `/repository/compare?from=${enc(br.release)}&to=${enc(br.develop)}`);
  const commits = (cmp.commits || []).filter((c) => !(c.parent_ids && c.parent_ids.length > 1));
  const behind = ((await M.api(ws, r, 'GET', `/repository/compare?from=${enc(br.develop)}&to=${enc(br.release)}`)).commits || []).filter((c) => !(c.parent_ids && c.parent_ids.length > 1));
  const openMr = async () => (await M.api(ws, r, 'GET', `/merge_requests?state=opened&source_branch=${enc(br.develop)}&target_branch=${enc(br.release)}`))[0] || null;
  const existing = await openMr();
  const N = deploy ? 6 : 5;
  console.log(`release: ${r.name} (project ${r.gitlab.projectId} @ ${r.gitlab.host}) · ${br.develop} → ${br.release} · 브랜치 방식 ${V.branchMode || 'feature'}`);
  console.log(`올릴 커밋 ${commits.length}개${commits.length ? `: ${commits.slice(0, 5).map((c) => `${c.short_id || sha7(c.id)} ${c.title}`).join(' · ')}${commits.length > 5 ? ' …' : ''}` : ''}`);
  if (behind.length) console.log(`⚠ ${br.release} 에만 있는 커밋 ${behind.length}개 (hotfix 등): 머지 결과의 트리가 ${br.develop} 과 달라 같은 트리 판정이 맞지 않을 수 있습니다. 먼저 ${br.release} → ${br.develop} 반영`);
  console.log('계획:');
  console.log(`  [1/${N}] 배포 전 확인: 같은 트리 develop 파이프라인 성공 · 그 뒤 CI 설정 안 바뀜${r.gitlab.releaseCheck ? ' · 확인 명령' : ''} (실패면 develop 파이프라인부터 새로)`);
  console.log(`  [2/${N}] release MR ${existing ? `!${existing.iid} 다시 씀` : '만들기'}`);
  console.log(`  [3/${N}] MR 파이프라인 끝까지`);
  console.log(`  [4/${N}] 머지${mergeOk ? '' : ' ✖ 에이전트 머지가 꺼져 있어 할 수 없음 (vars.gitlab.agentMerge = false). GitLab 에서 직접 머지하거나 터미널에서 직접 실행'}`);
  console.log(`  [5/${N}] release 파이프라인 끝까지`);
  let jobHint = '';
  if (deploy && !job) {
    // 최근 release 파이프라인의 수동 작업을 후보로
    try {
      const last = (await M.api(ws, r, 'GET', `/pipelines?ref=${enc(br.release)}&per_page=1&order_by=id&sort=desc`))[0];
      const names = last ? [...new Set((await M.api(ws, r, 'GET', `/pipelines/${last.id}/jobs?per_page=100`)).filter((j) => j.when === 'manual' || j.status === 'manual').map((j) => j.name))] : [];
      jobHint = names.length ? ` 최근 release 파이프라인 #${last.id} 의 수동 작업: ${names.join(' · ')}` : '';
    } catch { /* 후보 없음 */ }
  }
  if (deploy) console.log(`  [6/${N}] 운영 배포: ${job ? `${job} 실행 → 끝까지` : `✖ 배포 작업을 모름. --job <이름> 또는 repos[].gitlab.deployJob.${jobHint}`}`);
  console.log('  파이프라인은 하나씩 (같은 repo · 러너 그룹에 도는 것이 있으면 기다림) · 일시 오류는 작업마다 ' + `${retryMax}번까지 다시 실행${deploy ? (V.retryDeploy === true ? ' (배포 작업 포함)' : ' (배포 작업은 다시 실행하지 않고 멈춤)') : ''}`);
  if (V.localRunner === true) loadWarn();

  console.log('\n[판정 미리 보기]');
  let v = await verify(ws, r, br);
  showVerify(v);
  if (!v.ok) console.log(`  실행하면 ${v.running ? `도는 develop 파이프라인 #${v.running.id} 을(를) 기다린 뒤` : 'develop 파이프라인을 새로 돌린 뒤'} 다시 판정합니다`);

  if (a['dry-run']) { console.log('\n[dry-run] GitLab 에 아무것도 쓰지 않았습니다'); process.exit(0); }
  if (!a.yes) { console.log(`\n실행하지 않았습니다. 사용자 승인을 받았으면 같은 명령에 --yes 를 붙여 다시 실행합니다${deploy ? ' (운영 배포 포함)' : ''}`); process.exit(3); }
  if (!mergeOk) { console.error('✖ 머지 단계를 할 수 없어 시작하지 않았습니다 (vars.gitlab.agentMerge = false)'); process.exit(1); }
  if (deploy && !job) { console.log(`✖ 배포 작업 이름이 필요해 시작하지 않았습니다: --job <이름>${jobHint}`); process.exit(3); }

  /** 같은 repo · 러너 그룹의 다른 파이프라인이 끝날 때까지 */
  const own = new Set();
  const waitTurn = async (what) => {
    let shown = '';
    for (;;) {
      const busy = await L.busyPipelines(ws, r, { except: [...own] });
      if (!busy.length) return;
      const line = `다른 파이프라인이 끝나길 기다림 (${what} 전): ${busy.slice(0, 3).map((p) => `${p.repo} #${p.id} ${p.ref} ${p.status}`).join(' · ')}`;
      if (line !== shown) { say(line); shown = line; }
      if (Date.now() > until) { console.log('✖ 시간이 지나 멈춥니다 (다른 파이프라인이 끝나지 않음)'); process.exit(4); }
      await M.sleep(M.pollMs());
    }
  };

  /** 파이프라인을 끝까지 + 일시 오류면 그 작업만 다시 */
  const followRetry = async (id) => {
    own.add(String(id));
    const tries = {};
    for (;;) {
      loadWarn();
      const res = await M.follow(ws, r, id, until);
      if (res.p.status !== 'failed') return res;
      // 운영 배포 작업은 여기서 다시 돌리지 않는다 (6단계가 retryDeploy 규칙으로 다룬다)
      const failed = res.jobs.filter((j) => j.status === 'failed' && !j.allow_failure && !(deploy && j.name === job));
      if (!failed.length) return res;
      const judged = [];
      for (const j of failed) judged.push({ j, t: await transient(ws, r, j) });
      const hard = judged.filter((x) => !x.t.ok);
      if (hard.length) { hard.forEach((x) => say(`✖ ${x.j.name}: 일시 오류가 아님 → 멈춤 (${x.t.why})`)); return res; }
      const over = judged.filter((x) => (tries[x.j.name] || 0) >= retryMax);
      if (over.length) { say(`✖ ${over.map((x) => x.j.name).join(' · ')}: 일시 오류 재시도 ${retryMax}번을 다 써서 멈춤`); return res; }
      const fresh = [];
      for (const { j, t } of judged) {
        tries[j.name] = (tries[j.name] || 0) + 1;
        say(`↻ ${j.name} 다시 실행 (${tries[j.name]}/${retryMax}) · 일시 오류: ${t.why}`);
        fresh.push(await M.api(ws, r, 'POST', `/jobs/${j.id}/retry`));
      }
      await waitJobs(fresh);
    }
  };
  /** 다시 실행한 작업이 끝날 때까지 (파이프라인 상태가 따라오기 전에 follow 가 옛 실패를 보지 않게) */
  const waitJobs = async (jobs) => {
    let left = jobs.filter(Boolean);
    while (left.length) {
      if (Date.now() > until) { console.log('✖ 시간이 지나 멈춥니다 (작업은 계속 돈다)'); process.exit(4); }
      await M.sleep(M.pollMs());
      const now = [];
      for (const j of left) now.push(await M.api(ws, r, 'GET', `/jobs/${j.id}`));
      left = now.filter((j) => !M.DONE.has(j.status) && j.status !== 'manual');
    }
  };
  const appear = async (opt, label, maxMs) => {
    const end = Date.now() + maxMs;
    let shown = false;
    for (;;) {
      const p = await M.pipelineFor(ws, r, opt);
      if (p) return p;
      if (!shown) { say(`${label} 파이프라인이 생기길 기다림`); shown = true; }
      if (Date.now() > Math.min(end, until)) return null;
      await M.sleep(M.pollMs());
    }
  };
  const report = [];
  const step = (n, title, stop) => { console.log(`\n[${n}/${N}] ${title}`); console.log(`  멈출 조건: ${stop}`); };
  const done = (t) => { console.log(`  → ${t}`); report.push(t); };
  const stop = (t, code = 1) => { console.log(`✖ ${t}`); if (report.length) console.log(`지금까지: ${report.join(' · ')}`); process.exit(code); };

  // 1. 배포 전 확인
  step(1, '배포 전 확인', '같은 트리 develop 파이프라인 실패 · develop 을 다시 돌린 뒤에도 판정 실패');
  if (!v.ok) {
    let pid;
    if (v.running) { pid = v.running.id; say(`도는 develop 파이프라인 #${pid} 을(를) 끝까지 봄`); } else {
      await waitTurn('develop 파이프라인');
      const p = await M.api(ws, r, 'POST', '/pipeline', { ref: br.develop });
      pid = p.id;
      say(`▶ develop 파이프라인 새로 실행 #${pid} (${sha7(p.sha)})`);
    }
    const res = await followRetry(pid);
    if (res.p.status !== 'success' && res.p.status !== 'manual') stop(`develop 파이프라인 #${pid} ${res.p.status}. 로그: kedovi gitlab pipeline --repo ${r.name} --id ${pid} --log`);
    v = await verify(ws, r, br);
    showVerify(v);
    if (!v.ok) stop('develop 을 다시 돌린 뒤에도 판정 실패');
  }
  done(`판정 통과 (develop #${v.match.id})`);

  // 2. release MR
  step(2, `release MR (${br.develop} → ${br.release})`, 'MR 을 만들 수 없음 · 올릴 커밋 없음(--deploy 가 없을 때)');
  let mr = await openMr();
  let mergeSha = null;
  if (!mr && !commits.length) {
    if (!deploy) { done(`올릴 커밋이 없습니다 (${br.release} 가 ${br.develop} 을 다 담고 있음)`); console.log('✔ 할 일 없음'); return; }
    mergeSha = (await M.refHead(ws, r, br.release)).sha;
    done(`올릴 커밋 없음: ${br.release} 머리 ${sha7(mergeSha)} 를 배포`);
  } else {
    let created = false;
    if (!mr) {
      await waitTurn('MR 만들기');
      const title = a.title && a.title !== true ? String(a.title) : `chore: [${br.release}] ${br.develop} 반영 (커밋 ${commits.length}개)`;
      const description = a['description-file'] ? fs.readFileSync(a['description-file'], 'utf8') : `## Summary\n${commits.map((c) => `- ${c.title}`).join('\n')}\n`;
      try { mr = await M.api(ws, r, 'POST', '/merge_requests', { source_branch: br.develop, target_branch: br.release, title, description, remove_source_branch: false }); created = true; } catch (e) {
        mr = e.status === 409 ? await openMr() : null;
        if (!mr) throw e;
      }
    }
    done(`MR !${mr.iid} ${created ? '만듦' : '다시 씀'} ${mr.web_url || ''}`.trim());

    // 3. MR 파이프라인
    step(3, 'MR 파이프라인', '파이프라인 실패(일시 오류 재시도 뒤) · 취소 · 시간 초과');
    const fresh = await M.api(ws, r, 'GET', `/merge_requests/${mr.iid}`);
    const settle = Math.max(1000, Number(process.env.KEDOVI_RELEASE_SETTLE_MS) || 30000);
    // 막 만든 MR 은 MR 파이프라인이 늦게 생긴다: 잠깐 MR 파이프라인을 기다리고, 없으면 같은 커밋의 브랜치 파이프라인
    let p = null;
    const mrEnd = Date.now() + (created ? settle : 0);
    for (;;) {
      const list = await M.api(ws, r, 'GET', `/merge_requests/${mr.iid}/pipelines?per_page=5`);
      p = list.find((x) => x.sha === fresh.sha) || null;
      if (p || Date.now() >= mrEnd) break;
      await M.sleep(M.pollMs());
    }
    if (!p) p = await appear({ sha: fresh.sha }, 'MR 커밋', 60000);
    if (!p) done('MR 파이프라인 없음 (머지 판정에 맡김)');
    else {
      const res = await followRetry(p.id);
      if (!['success', 'manual', 'skipped'].includes(res.p.status)) stop(`MR 파이프라인 #${p.id} ${res.p.status}. 로그: kedovi gitlab pipeline --repo ${r.name} --id ${p.id} --log`);
      done(`MR 파이프라인 #${p.id} ${res.p.status}`);
    }

    // 4. 머지
    step(4, `머지 !${mr.iid}`, '충돌 · 초안 · 토론 · 승인 · 파이프라인 실패 · 권한');
    await waitTurn('머지');
    await M.cmdMerge(ws, { _: ['merge', String(mr.iid)], repo: r.name, yes: true, timeout: Math.max(1, Math.round((until - Date.now()) / 60000)) });
    const m = await M.api(ws, r, 'GET', `/merge_requests/${mr.iid}`);
    mergeSha = m.merge_commit_sha || m.squash_commit_sha || m.sha;
    done(`머지 커밋 ${sha7(mergeSha)}`);
  }

  // 5. release 파이프라인
  step(5, `${br.release} 파이프라인`, '파이프라인 실패(일시 오류 재시도 뒤) · 취소 · 안 생김');
  const rp = await appear({ sha: mergeSha, ref: br.release }, `${br.release} 커밋 ${sha7(mergeSha)}`, 5 * 60000);
  if (!rp) stop(`${br.release} 커밋 ${sha7(mergeSha)} 의 파이프라인이 생기지 않았습니다 ([skip ci] · rules 확인)`, 5);
  const rres = await followRetry(rp.id);
  const onlyDeployFailed = deploy && rres.p.status === 'failed' && rres.jobs.filter((j) => j.status === 'failed' && !j.allow_failure).every((j) => j.name === job);
  if (!['success', 'manual'].includes(rres.p.status) && !onlyDeployFailed) stop(`${br.release} 파이프라인 #${rp.id} ${rres.p.status}. 로그: kedovi gitlab pipeline --repo ${r.name} --id ${rp.id} --log`);
  const manual = rres.jobs.filter((j) => j.status === 'manual').map((j) => j.name);
  done(`${br.release} 파이프라인 #${rp.id} ${rres.p.status}${manual.length ? ` (수동 작업: ${manual.join(' · ')})` : ''}`);

  // 6. 운영 배포
  if (deploy) {
    step(6, `운영 배포: ${job}`, '작업이 없음 · 앞 작업 실패로 skipped · 배포 실패(일시 오류 재시도 뒤)');
    let jobs = await M.api(ws, r, 'GET', `/pipelines/${rp.id}/jobs?per_page=100`);
    const pick = () => jobs.filter((j) => j.name === job).sort((x, y) => y.id - x.id)[0];
    let j = pick();
    if (!j) stop(`파이프라인 #${rp.id} 에 '${job}' 작업이 없습니다. 있는 작업: ${[...new Set(jobs.map((x) => x.name))].join(', ')}`, 3);
    if (j.status === 'success') { done(`${job} 은(는) 이미 성공 ${j.web_url || ''}`.trim()); } else {
      while (['created', 'waiting_for_resource', 'preparing'].includes(j.status)) {
        if (Date.now() > until) stop('시간이 지나 멈춥니다 (배포 작업이 manual 이 되지 않음)', 4);
        await M.sleep(M.pollMs());
        jobs = await M.api(ws, r, 'GET', `/pipelines/${rp.id}/jobs?per_page=100`);
        j = pick();
      }
      if (j.status === 'skipped' || j.status === 'canceled') stop(`${job} 이(가) ${j.status} 입니다`);
      await waitTurn('배포');
      own.add(String(rp.id));
      let tries = 0;
      if (j.status === 'manual') { j = await M.api(ws, r, 'POST', `/jobs/${j.id}/play`); say(`▶ ${job} 실행 요청 (작업 ${j.id})`); } else if (j.status === 'failed') {
        if (V.retryDeploy !== true) stop(`${job} 이(가) 이미 실패해 있습니다. 배포 상태를 확인한 뒤 다시 실행: kedovi gitlab retry --repo ${r.name} --id ${rp.id} --job ${job} --yes`);
        j = await M.api(ws, r, 'POST', `/jobs/${j.id}/retry`); say(`▶ ${job} 다시 실행 요청 (새 작업 ${j.id})`);
      }
      for (;;) {
        let last = '';
        while (!M.DONE.has(j.status) && j.status !== 'manual') {
          if (j.status !== last) { say(`${M.mark(j.status)} ${job} ${j.status}`); last = j.status; }
          if (Date.now() > until) stop(`시간이 지나 멈춥니다 (${job} 은(는) 계속 돈다)`, 4);
          await M.sleep(M.pollMs());
          loadWarn();
          j = await M.api(ws, r, 'GET', `/jobs/${j.id}`);
        }
        if (j.status === 'success') break;
        const t = j.status === 'failed' ? await transient(ws, r, j) : { ok: false, why: j.status };
        if (!t.ok) stop(`${job} ${j.status}: ${t.why}. 로그: kedovi gitlab pipeline --repo ${r.name} --id ${rp.id} --log`);
        // 운영 배포는 반쯤 적용됐을 수 있어 기본으로 다시 돌리지 않는다 (vars.gitlab.retryDeploy 를 켜면 앞 단계처럼)
        if (V.retryDeploy !== true) stop(`${job} 실패: 일시 오류로 보입니다 (${t.why}). 다시 실행: kedovi gitlab retry --repo ${r.name} --id ${rp.id} --job ${job} --yes (사람이 배포 상태를 확인한 뒤)`);
        if (tries >= retryMax) stop(`${job}: 일시 오류 재시도 ${retryMax}번을 다 써서 멈춤 (${t.why})`);
        tries += 1;
        say(`↻ ${job} 다시 실행 (${tries}/${retryMax}) · 일시 오류: ${t.why}`);
        j = await M.api(ws, r, 'POST', `/jobs/${j.id}/retry`);
      }
      say(`✔ ${job} 성공 (${M.took(j.duration)})`);
      // 배포 뒤 자동 작업이 있으면 끝까지
      const after = await followRetry(rp.id);
      if (!['success', 'manual'].includes(after.p.status)) stop(`배포 뒤 파이프라인 #${rp.id} ${after.p.status}`);
      done(`운영 배포 ${job} 성공 ${j.web_url || ''}`.trim());
    }
  }
  console.log(`\n✔ release 끝: ${report.join(' · ')}`);
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });

module.exports = { main, parseIncludes, transient, verify, collectIncludes, includesChangedSince, TRANSIENT };
