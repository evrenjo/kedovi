// release.js · ci-load.js 점검 (로컬 가짜 GitLab API): 계획 · --dry-run · 승인 없음(3) · 같은 트리 판정 · include(project · ref · 태그 · 중첩 local) 변경 판정 · 확인 명령 ·
// develop 다시 돌리기 · 일시 오류 재시도 · 일시 오류가 아니면 멈춤 · 파이프라인 하나씩 · 머지 · release 파이프라인 · 배포 작업 · 에이전트 머지 꺼짐 · 배포 작업 이름 없음 · 자원 경합. 실행: node release.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const TOKEN = 'glpat-test-release-0001';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-release-'));
const seen = [];
const D1 = 'd1'.padEnd(40, 'a'); // develop 의 옛 커밋 (D2 와 트리가 같다)
const D2 = 'd2'.padEnd(40, 'b'); // develop 머리
const D9 = 'd9'.padEnd(40, 'c'); // 둘째 프로젝트의 develop 머리
const M1 = 'e1'.padEnd(40, 'd'); // release 머지 커밋
const C1 = 'c1'.padEnd(40, 'e');
const C2 = 'c2'.padEnd(40, 'f');
const CHANGE_AT = '2026-11-05T00:00:00.000Z';

// 파이프라인 · 작업 상태기계: 파이프라인을 읽을 때마다 끝나지 않은 첫 작업이 한 걸음 나아간다
let nextJob = 5000;
const S = { ciChanged: false, busyLeft: 0, merged: false, mrOpen: null, pipes: {}, jobs: {}, posts: [] };
const TERMINAL = new Set(['success', 'failed', 'canceled', 'skipped', 'manual']);
function mkJob(pid, name, stage, seq, extra = {}) {
  const j = { id: nextJob++, pid, name, stage, seq, i: 0, ...extra };
  S.jobs[j.id] = j;
  S.pipes[pid].jobs.push(j.id);
  return j;
}
function mkPipe(id, ref, sha, created = new Date().toISOString()) { S.pipes[id] = { id, ref, sha, created_at: created, jobs: [] }; return S.pipes[id]; }
const jst = (j) => j.seq[j.i];
const tick = (j) => { if (!TERMINAL.has(jst(j)) && j.i < j.seq.length - 1) j.i += 1; };
const liveJobs = (p) => p.jobs.map((id) => S.jobs[id]).filter((j) => !j.retried);
function pstatus(p) {
  const js = liveJobs(p);
  if (js.some((j) => ['created', 'pending', 'running'].includes(jst(j)))) return 'running';
  if (js.some((j) => jst(j) === 'failed' && !j.allow_failure)) return 'failed';
  if (js.some((j) => jst(j) === 'manual')) return 'manual';
  return 'success';
}
const jobView = (j) => ({ id: j.id, name: j.name, stage: j.stage, status: jst(j), duration: 30, allow_failure: !!j.allow_failure, when: j.when, failure_reason: jst(j) === 'failed' ? j.reason : undefined, web_url: `http://git.test/j/${j.id}` });
const pipeView = (p) => ({ id: p.id, ref: p.ref, sha: p.sha, status: p.status || pstatus(p), created_at: p.created_at, web_url: `http://git.test/p/${p.id}`, duration: 60 });

// 프로젝트 9: develop 파이프라인 #100(D2) 실패 · #99(D1, 같은 트리) 성공. release 의 지난 파이프라인 #150 (수동 배포 작업 후보)
mkPipe(99, 'develop', D1, '2026-11-01T00:00:00.000Z'); mkJob(99, 'build', 'build', ['success']);
mkPipe(100, 'develop', D2, '2026-11-02T00:00:00.000Z'); mkJob(100, 'unit', 'test', ['failed'], { trace: 'AssertionError: flaky\nERROR: Job failed: exit code 1' });
mkPipe(150, 'release', 'f'.repeat(40), '2026-10-20T00:00:00.000Z'); mkJob(150, 'deploy-prod', 'deploy', ['manual'], { when: 'manual' });
// 프로젝트 11: 성공한 develop 파이프라인이 없다 → 새로 돌리면 일시 오류가 아닌 실패

const CI_MAIN = `stages: [build, promote]
include:
  - local: '/ci/x.yml'
  - project: 'grp/ci'
    ref: main
    file:
      - '/t/build.yml'
  - remote: 'https://ci.example.com/extra.yml'
variables:
  A: "1"
`;
const CI_X = "include:\n  - project: grp/ci\n    ref: v3\n    file: /t/promote.yml\n";
const PROMOTE = "include:\n  - local: /t/common.yml\npromote:\n  script: [echo]\n";

function handle(method, p, q, body) {
  const P9 = '/projects/9';
  const P11 = '/projects/11';
  const G = '/projects/grp%2Fci';
  // 프로젝트 9
  if (method === 'GET' && p === P9) return { default_branch: 'develop', ci_config_path: null };
  if (p === `${P9}/repository/branches/develop`) return { commit: { id: D2 } };
  if (p === `${P9}/repository/branches/release`) return { commit: { id: S.merged ? M1 : 'f'.repeat(40) } };
  if (p === `${P9}/repository/compare` || p === `${P11}/repository/compare`) {
    const from = q.get('from'); const to = q.get('to');
    if (from === 'release' && to === 'develop') return S.merged ? { commits: [] } : { commits: [{ id: D2, short_id: 'd2bbbbb', title: 'feat: 주문 취소', parent_ids: ['x'] }, { id: 'm', title: 'Merge branch', parent_ids: ['x', 'y'] }] };
    if (from === 'develop' && to === 'release') return { commits: [] };
    if (q.get('straight') === 'true') return { diffs: (from === D1 && to === D2) ? [] : [{ new_path: 'src/a.js', old_path: 'src/a.js' }] };
    return { commits: [] };
  }
  if (p === `${P9}/repository/files/.gitlab-ci.yml/raw`) return CI_MAIN;
  if (p === `${P9}/repository/files/ci%2Fx.yml/raw`) return CI_X;
  if (p === `${P9}/pipelines` || p === `${P11}/pipelines`) {
    const proj = p.startsWith(P9) ? 9 : 11;
    if (q.get('status') === 'running') return proj === 9 && S.busyLeft-- > 0 ? [{ id: 90, ref: 'feature/z', sha: 'z', status: 'running' }] : [];
    if (q.get('status')) return [];
    const mine = Object.values(S.pipes).filter((x) => (proj === 9 ? x.id < 300 : x.id >= 300)).sort((x, y) => y.id - x.id);
    let list = mine;
    if (q.get('ref')) list = list.filter((x) => x.ref === q.get('ref'));
    if (q.get('sha')) list = list.filter((x) => x.sha === q.get('sha'));
    return list.slice(0, Number(q.get('per_page')) || 20).map(pipeView);
  }
  const pm = /^\/projects\/(9|11)\/pipelines\/(\d+)(\/jobs)?$/.exec(p);
  if (pm && method === 'GET') {
    const pp = S.pipes[pm[2]];
    if (!pp) return [404, { message: '404 Not found' }];
    if (pm[3]) return liveJobs(pp).sort((x, y) => x.id - y.id).map(jobView);
    const first = liveJobs(pp).find((j) => !TERMINAL.has(jst(j)));
    if (first) tick(first);
    return pipeView(pp);
  }
  const jm = /^\/projects\/(9|11)\/jobs\/(\d+)(\/trace|\/retry|\/play)?$/.exec(p);
  if (jm) {
    const j = S.jobs[jm[2]];
    if (!j) return [404, { message: '404' }];
    if (jm[3] === '/trace') return j.trace || 'ok';
    if (jm[3] === '/retry' && method === 'POST') { j.retried = true; const n = mkJob(j.pid, j.name, j.stage, j.retrySeq || ['pending', 'running', 'success'], { trace: j.retryTrace, retrySeq: j.retrySeq2 }); return [201, jobView(n)]; }
    if (jm[3] === '/play' && method === 'POST') { if (jst(j) !== 'manual') return [400, { message: '400 Unplayable Job' }]; if (S.deployFailOnce) { S.deployFailOnce = false; j.seq = ['pending', 'running', 'failed']; j.trace = 'kubectl apply\nUnable to connect to the server: net/http: TLS handshake timeout\nERROR: Job failed: exit code 1'; } else j.seq = ['pending', 'running', 'success']; j.i = 0; return jobView(j); }
    tick(j);
    return jobView(j);
  }
  if (method === 'POST' && (p === `${P9}/pipeline` || p === `${P11}/pipeline`)) {
    if (p.startsWith(P9)) {
      const np = mkPipe(101, 'develop', D2);
      mkJob(101, 'build', 'build', ['running', 'failed'], { trace: 'step\nGet "https://registry.example.com/v2/": dial tcp 10.0.0.1:443: i/o timeout\nERROR: Job failed: exit code 1', retrySeq: ['running', 'success'] });
      return [201, pipeView(np)];
    }
    const np = mkPipe(301, 'develop', D9);
    mkJob(301, 'unit', 'test', ['running', 'failed'], { trace: 'expected 1 to equal 2\nAssertionError\nERROR: Job failed: exit code 1' });
    return [201, pipeView(np)];
  }
  // MR
  if (p === `${P9}/merge_requests` && method === 'GET') return S.mrOpen && !S.merged ? [mrView()] : [];
  if (p === `${P9}/merge_requests` && method === 'POST') { S.mrOpen = { title: body.title, description: body.description }; return [201, mrView()]; }
  if (p === `${P9}/merge_requests/7/pipelines`) return [];
  if (p === `${P9}/merge_requests/7`) return mrView();
  if (p === `${P9}/merge_requests/7/merge` && method === 'PUT') {
    if (body.sha !== D2) return [409, { message: 'SHA mismatch' }];
    S.merged = true;
    mkPipe(200, 'release', M1);
    mkJob(200, 'build', 'build', ['running', 'success']);
    mkJob(200, 'promote', 'promote', ['running', 'failed'], { trace: 'pushing image\nError response from daemon: received unexpected HTTP status: 503 Service Unavailable (registry.example.com)\nERROR: Job failed: exit code 1', retrySeq: ['running', 'success'] });
    mkJob(200, 'deploy-prod', 'deploy', ['manual'], { when: 'manual' });
    return mrView();
  }
  if (p === `${P9}/repository/commits/${M1}`) return { id: M1, last_pipeline: null };
  // 공용 CI 프로젝트
  if (p === `${G}/repository/branches/main`) return { commit: { id: S.ciChanged ? C2 : C1 } };
  if (p === `${G}/repository/branches/v3`) return [404, { message: '404 Branch Not Found' }];
  if (p === `${G}/repository/tags/v3`) return { commit: { id: 'a3'.padEnd(40, '0'), committed_date: '2026-10-01T00:00:00.000Z' } };
  if (p === `${G}/repository/commits`) return [{ id: S.ciChanged && new Date(q.get('until')) >= new Date(CHANGE_AT) ? C2 : C1 }];
  if (p === `${G}/repository/compare`) return { diffs: [{ new_path: 't/build.yml', old_path: 't/build.yml' }] };
  if (p === `${G}/repository/files/t%2Fbuild.yml/raw`) return 'build:\n  script: [make]\n';
  if (p === `${G}/repository/files/t%2Fpromote.yml/raw`) return PROMOTE;
  if (p === `${G}/repository/files/t%2Fcommon.yml/raw`) return 'x: 1\n';
  // 프로젝트 11
  if (p === `${P11}/repository/branches/develop`) return { commit: { id: D9 } };
  if (p === `${P11}/merge_requests`) return [];
  return [404, { message: `404 ${p}` }];
}
function mrView() {
  return { iid: 7, title: S.mrOpen ? S.mrOpen.title : '', state: S.merged ? 'merged' : 'opened', source_branch: 'develop', target_branch: 'release', sha: D2, merge_commit_sha: S.merged ? M1 : null, detailed_merge_status: 'mergeable', has_conflicts: false, head_pipeline: S.pipes[101] ? { id: 101, status: pstatus(S.pipes[101]) } : { id: 99, status: 'success' }, web_url: 'http://git.test/mr/7' };
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/api\/v4/, '');
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    seen.push({ method: req.method, path: p, token: req.headers['private-token'] });
    let out = handle(req.method, p, u.searchParams, raw ? JSON.parse(raw) : {});
    let code = 200;
    if (Array.isArray(out) && typeof out[0] === 'number') [code, out] = out;
    res.writeHead(code, { 'Content-Type': typeof out === 'string' ? 'text/plain' : 'application/json' });
    res.end(typeof out === 'string' ? out : JSON.stringify(out));
  });
});

function run(args, cwd, extraEnv = {}, script = 'release.js') {
  return new Promise((resolve) => {
    const env = { ...process.env, KEDOVI_POLL_MS: '100', KEDOVI_MERGE_SETTLE_MS: '1000', KEDOVI_RELEASE_SETTLE_MS: '300', GITLAB_TOKEN: TOKEN, KEDOVI_CONFIG_DIR: path.join(tmp, 'config'), KEDOVI_SECRETS_BACKEND: 'file', ...extraEnv };
    delete env.CLAUDE_PROJECT_DIR;
    const c = spawn(process.execPath, [path.join(__dirname, script), ...args], { cwd, env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
}
const writes = () => seen.filter((x) => x.method === 'POST' || x.method === 'PUT').length;

server.listen(0, '127.0.0.1', async () => {
  try {
    const port = server.address().port;
    const apiBase = `http://127.0.0.1:${port}/api/v4`;
    const gl = (projectId, extra = {}) => ({ host: `127.0.0.1:${port}`, projectId, apiBase, ...extra });
    const on = path.join(tmp, 'on');
    const off = path.join(tmp, 'off');
    for (const d of [on, off]) fs.mkdirSync(d, { recursive: true });
    const check = `test "$KEDOVI_RELEASE_SHA" = "${D2}" && test "$KEDOVI_RELEASE_PIPELINE" = "99" && test "$KEDOVI_RELEASE_REF" = develop && test -z "$GITLAB_TOKEN" && echo image-tag-ok`;
    fs.writeFileSync(path.join(on, 'workspace.json'), JSON.stringify({ project: { name: 'on' }, vars: { branch: { develop: 'develop', release: 'release' }, gitlab: { agentMerge: true, retryMax: 2 } }, repos: [
      { name: 'svc', gitlab: gl(9, { deployJob: 'deploy-prod' }) },
      { name: 'svc-check', gitlab: gl(9, { releaseCheck: check }) },
      { name: 'svc-bad', gitlab: gl(9, { releaseCheck: 'echo 이미지 없음; exit 7' }) },
      { name: 'svc-nojob', gitlab: gl(9) },
      { name: 'svc2', gitlab: gl(11) },
    ] }));
    fs.writeFileSync(path.join(off, 'workspace.json'), JSON.stringify({ project: { name: 'off' }, vars: { gitlab: { agentMerge: false } }, repos: [{ name: 'svc', gitlab: gl(9, { deployJob: 'deploy-prod' }) }] }));

    // --dry-run: 계획 · 같은 트리(#99, 커밋 D1) 판정 통과 · 바깥 include(브랜치 · 태그 · 중첩 local) · remote 는 판정 못 함 경고 · 쓰기 없음
    let w0 = writes();
    let r = await run(['svc', '--deploy', '--dry-run'], on);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(/올릴 커밋 1개: d2bbbbb feat: 주문 취소/.test(r.out) && /\[2\/6\] release MR 만들기/.test(r.out) && /\[6\/6\] 운영 배포: deploy-prod/.test(r.out), r.out);
    assert.ok(/같은 트리 develop 파이프라인: #99 ✔ success .*커밋 d1aaaaa/.test(r.out) && /바깥 include: grp\/ci@main · grp\/ci@v3/.test(r.out) && /remote https:\/\/ci\.example\.com\/extra\.yml/.test(r.out) && /→ 판정 통과/.test(r.out), r.out);
    assert.ok(/\[dry-run\]/.test(r.out) && writes() === w0, r.out);
    // --yes 없음: 계획만, 끝 코드 3
    r = await run(['svc'], on);
    assert.ok(r.code === 3 && /--yes 를 붙여/.test(r.out) && writes() === w0, r.out);
    // 확인 명령: 환경변수(SHA · 파이프라인 · ref)를 받고 토큰은 받지 않는다 · 실패하면 판정 실패
    r = await run(['svc-check', '--dry-run'], on);
    assert.ok(r.code === 0 && /확인 명령: .* → ✔ 통과/.test(r.out) && /\| image-tag-ok/.test(r.out) && /→ 판정 통과/.test(r.out), r.out);
    r = await run(['svc-bad', '--dry-run'], on);
    assert.ok(r.code === 0 && /✖ 실패/.test(r.out) && /\| 이미지 없음/.test(r.out) && /판정 실패: 확인 명령 실패 \(끝 코드 7\)/.test(r.out) && /develop 파이프라인을 새로 돌린 뒤/.test(r.out), r.out);
    // 에이전트 머지가 꺼진 워크스페이스: 계획에 표시, --yes 여도 아무것도 하지 않고 1
    r = await run(['svc', '--yes'], off);
    assert.ok(r.code === 1 && /에이전트 머지가 꺼져/.test(r.out) && writes() === w0, r.out);
    // 배포 작업 이름이 없으면: 최근 release 파이프라인의 수동 작업을 후보로 보이고 시작하지 않는다 (3)
    r = await run(['svc-nojob', '--deploy', '--yes'], on);
    assert.ok(r.code === 3 && /최근 release 파이프라인 #150 의 수동 작업: deploy-prod/.test(r.out) && writes() === w0, r.out);
    // 공용 CI(grp/ci@main 의 t/build.yml)가 #99 뒤에 바뀜 → 판정 실패
    S.ciChanged = true;
    r = await run(['svc', '--dry-run'], on);
    assert.ok(r.code === 0 && /✖ CI 설정 바뀜: grp\/ci@main \(브랜치\): t\/build\.yml/.test(r.out) && /판정 실패/.test(r.out), r.out);

    // 끝까지: 판정 실패 → (다른 파이프라인을 기다림) develop 새로 실행 #101 → build 일시 오류(i/o timeout) 재시도 → 다시 판정 통과
    //   → MR 만들기 → MR 파이프라인(같은 커밋 #101) → 머지 → release #200 promote 일시 오류(레지스트리 503) 재시도 → 수동 배포 → 성공
    S.busyLeft = 2;
    S.deployFailOnce = true; // 운영 배포가 일시 오류(TLS handshake timeout)로 실패한다
    r = await run(['svc', '--deploy', '--yes'], on);
    assert.strictEqual(r.code, 1, r.out);
    const order = (...res) => res.every((re, i) => i === 0 || r.out.search(res[i - 1]) < r.out.search(re));
    assert.ok(/다른 파이프라인이 끝나길 기다림 \(develop 파이프라인 전\): svc #90 feature\/z running/.test(r.out), r.out);
    assert.ok(/▶ develop 파이프라인 새로 실행 #101/.test(r.out) && /↻ build 다시 실행 \(1\/2\) · 일시 오류: .*i\/o timeout/.test(r.out), r.out);
    assert.ok(/같은 트리 develop 파이프라인: #101/.test(r.out) && /판정 통과 \(develop #101\)/.test(r.out), r.out);
    assert.ok(/MR !7 만듦/.test(r.out) && /MR 파이프라인 #101 success/.test(r.out) && /머지 커밋 e1ddddd/.test(r.out), r.out);
    assert.ok(/↻ promote 다시 실행 \(1\/2\) · 일시 오류: .*503 Service Unavailable/.test(r.out) && /release 파이프라인 #200 manual \(수동 작업: deploy-prod\)/.test(r.out), r.out);
    // 운영 배포는 기본(retryDeploy 꺼짐)으로 다시 돌리지 않고 다시 실행 명령을 보이며 1
    assert.ok(/▶ deploy-prod 실행 요청/.test(r.out) && /deploy-prod 실패: 일시 오류로 보입니다 \(.*TLS handshake timeout\)\. 다시 실행: kedovi gitlab retry --repo svc --id 200 --job deploy-prod --yes \(사람이 배포 상태를 확인한 뒤\)/.test(r.out) && !/✔ release 끝/.test(r.out), r.out);
    assert.ok(order(/\[1\/6\]/, /\[2\/6\]/, /\[3\/6\]/, /\[4\/6\]/, /\[5\/6\]/, /\[6\/6\]/) && (r.out.match(/멈출 조건: /g) || []).length === 6, r.out);
    assert.ok(/chore: \[release\] develop 반영 \(커밋 1개\)/.test(S.mrOpen.title) && /- feat: 주문 취소/.test(S.mrOpen.description), JSON.stringify(S.mrOpen));
    const posts = seen.filter((x) => x.method === 'POST' || x.method === 'PUT').map((x) => `${x.method} ${x.path}`);
    assert.deepStrictEqual(posts.filter((x) => /pipeline$|merge_requests$|merge$|retry$|play$/.test(x)).map((x) => x.replace(/\/jobs\/\d+/, '/jobs/N')),
      ['POST /projects/9/pipeline', 'POST /projects/9/jobs/N/retry', 'POST /projects/9/merge_requests', 'PUT /projects/9/merge_requests/7/merge', 'POST /projects/9/jobs/N/retry', 'POST /projects/9/jobs/N/play'], posts.join('\n'));
    // 다시 불러도(올릴 커밋 없음 → release 머리 배포) 이미 실패한 배포 작업은 기본으로 다시 돌리지 않는다 (5단계 자동 재시도도 배포 작업은 건드리지 않음)
    w0 = writes();
    r = await run(['svc', '--deploy', '--yes'], on);
    assert.ok(r.code === 1 && /올릴 커밋 없음: release 머리 e1ddddd 를 배포/.test(r.out) && /deploy-prod 이\(가\) 이미 실패해 있습니다\. .*kedovi gitlab retry --repo svc --id 200 --job deploy-prod --yes/.test(r.out) && writes() === w0, r.out);
    // vars.gitlab.retryDeploy 를 켜면 배포 작업도 다시 실행한다
    const onRetry = path.join(tmp, 'on-retry');
    fs.mkdirSync(onRetry);
    const wsOn = JSON.parse(fs.readFileSync(path.join(on, 'workspace.json'), 'utf8'));
    wsOn.vars.gitlab.retryDeploy = true;
    fs.writeFileSync(path.join(onRetry, 'workspace.json'), JSON.stringify(wsOn));
    r = await run(['svc', '--deploy', '--yes'], onRetry);
    assert.ok(r.code === 0 && /배포 작업 포함/.test(r.out) && /▶ deploy-prod 다시 실행 요청/.test(r.out) && /✔ deploy-prod 성공/.test(r.out) && /✔ release 끝/.test(r.out), r.out);

    // 일시 오류가 아닌 실패는 다시 실행하지 않고 멈춘다 (MR 을 만들지 않음)
    w0 = writes();
    r = await run(['svc2', '--yes'], on);
    assert.ok(r.code === 1 && /성공한 develop 파이프라인이 없음/.test(r.out) && /▶ develop 파이프라인 새로 실행 #301/.test(r.out) && /✖ unit: 일시 오류가 아님 → 멈춤/.test(r.out) && /develop 파이프라인 #301 failed/.test(r.out), r.out);
    assert.ok(writes() === w0 + 1 && !seen.some((x) => x.method === 'POST' && /projects\/11\/(jobs|merge_requests)/.test(x.path)), '재시도 · MR 없음');

    // 일시 오류 판정 (작업 로그 끝부분 · GitLab 실패 이유 · 변수로 더한 모양)
    process.env.GITLAB_TOKEN = TOKEN;
    const R = require('./release.js');
    const ws = { root: tmp, vars: { gitlab: { retryPatterns: ['quota exceeded tmp'] } }, repos: [] };
    const repo = { name: 'svc', gitlab: gl(9) };
    S.jobs[9001] = { id: 9001, pid: 99, seq: ['failed'], i: 0, trace: 'x\nERROR: tmp quota exceeded tmp area' };
    S.jobs[9002] = { id: 9002, pid: 99, seq: ['failed'], i: 0, trace: 'Tests failed: 3\nERROR: Job failed: exit code 1' };
    assert.ok((await R.transient(ws, repo, { id: 9001 })).ok, '변수로 더한 모양');
    assert.ok(!(await R.transient(ws, repo, { id: 9002 })).ok, '테스트 실패는 일시 오류가 아님');
    assert.ok((await R.transient(ws, repo, { id: 9002, failure_reason: 'runner_system_failure' })).ok, '러너 시스템 실패');
    assert.ok(['proxyconnect tcp: dial tcp 10.1.1.1:3128: connect: connection refused', 'net/http: TLS handshake timeout', 'read tcp 1.2.3.4: connection reset by peer', 'toomanyrequests: 502 Bad Gateway from registry'].every((l) => R.TRANSIENT.some((p) => p.test(l))));
    assert.ok(!['HTTP 503 from /api/orders in test', 'expected status 504 but got 200'].some((l) => R.TRANSIENT.some((p) => p.test(l))), '앱 시험의 50x 는 일시 오류가 아님');

    // include 해석: 목록 · 흐름 표기 · 한 항목 맵 · 문자열
    assert.deepStrictEqual(R.parseIncludes(CI_MAIN).map((x) => x.local || x.project || x.remote), ['/ci/x.yml', 'grp/ci', 'https://ci.example.com/extra.yml']);
    assert.deepStrictEqual(R.parseIncludes('include: { project: g/p, ref: v3, file: [a.yml, b.yml] }')[0], { project: 'g/p', ref: 'v3', file: ['a.yml', 'b.yml'] });
    assert.deepStrictEqual(R.parseIncludes('include:\n  project: g/p\n  ref: v3\n  file: /a.yml\n')[0], { project: 'g/p', ref: 'v3', file: ['/a.yml'] });
    assert.deepStrictEqual(R.parseIncludes("include: 'x.yml'\n"), [{ local: 'x.yml' }]);
    assert.deepStrictEqual(R.parseIncludes('stages: [a]\n'), []);

    // 자원 경합: 러너가 이 PC 일 때만 경고 · 무거운 프로세스 판정
    const L = require('./ci-load.js');
    const ps = `  11 180.0 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n  12 95.5 java\n  13 3.0 node\n  14 99.0 Safari\n`;
    const load = L.localLoad({ vars: {} }, { ps });
    assert.deepStrictEqual(load.heavy.map((x) => x.cmd), ['com.docker.backend', 'java']);
    assert.strictEqual(L.localWarn({ vars: { gitlab: { localRunner: false } } }, { ps }), null);
    assert.ok(/러너가 이 PC 인데 로컬에서 무거운 작업이 돈다 \(com\.docker\.backend 180% · java 96%\)/.test(L.localWarn({ vars: { gitlab: { localRunner: true } } }, { ps })));
    assert.strictEqual(L.localLoad({ vars: { gitlab: { localHeavy: 'gradle' } } }, { ps }).heavy.length, 0);
    S.busyLeft = 1;
    const wsL = { root: tmp, vars: { gitlab: { localRunner: true } }, repos: [repo] };
    assert.ok(/CI 파이프라인이 돈다 \(svc #90 feature\/z running\)/.test(await L.warnBeforeLocalTest(wsL, repo)));
    assert.strictEqual(await L.warnBeforeLocalTest(wsL, repo), null);
    // kedovi gitlab busy: 도는 파이프라인 · 러너가 다른 머신이면 경합 아님(0)
    S.busyLeft = 1;
    r = await run(['busy', '--repo', 'svc'], on, {}, 'gitlab-mr.js');
    assert.ok(r.code === 0 && /CI: svc #90 feature\/z running/.test(r.out) && /러너가 다른 머신/.test(r.out), r.out);

    // 토큰은 헤더로만 가고 출력에 없다
    assert.ok(seen.length && seen.every((s) => s.token === TOKEN));
    assert.ok(!r.out.includes(TOKEN));
    console.log('release.test.js OK');
  } catch (e) {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
