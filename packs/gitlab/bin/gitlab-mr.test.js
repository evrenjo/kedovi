// gitlab-mr.js 점검 (로컬 가짜 API): 파이프라인 목록 · 단계별 작업 · 실패 로그 · MR 머지 커밋 · --repo 생략 · 수동 작업 실행 · 다시 실행 · 배포 연쇄(wait · merge · retry · cancel · create 재사용) · 전역 API · remove_source 제안 · 출력에 토큰 없음. 실행: node gitlab-mr.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const TOKEN = 'glpat-test-pipeline-0001';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-gitlab-'));
const seen = [];
const pipe = (id, status, ref, sha) => ({ id, status, ref, sha, source: 'push', created_at: '2026-01-02T03:04:05.000Z', web_url: `http://git.test/p/${id}`, duration: 75, user: { username: 'dev' } });
const routes = {
  '/projects/7/pipelines': (q) => (q.get('sha') === 'aaa1111bbb' ? [pipe(12, 'failed', 'main', 'aaa1111bbb')] : q.get('ref') === 'none' ? [] : flow.list(q) || [pipe(12, 'failed', 'main', 'aaa1111bbb'), pipe(11, 'success', 'main', 'ccc2222ddd')]),
  '/projects/7/pipelines/12': () => pipe(12, 'failed', 'main', 'aaa1111bbb'),
  '/projects/7/pipelines/12/jobs': () => [
    { id: 102, stage: 'deploy', name: 'publish', status: 'failed', duration: 9, web_url: 'http://git.test/j/102' },
    { id: 101, stage: 'test', name: 'unit', status: 'success', duration: 61, web_url: 'http://git.test/j/101' },
    { id: 103, stage: 'deploy', name: 'lint', status: 'failed', allow_failure: true, duration: 3, web_url: 'http://git.test/j/103' }],
  '/projects/7/jobs/102/trace': () => 'step 1\n\u001b[31mnpm ERR! 403 Forbidden\u001b[0m\n\nERROR: Job failed: exit code 1\n',
  '/projects/7/jobs/103/trace': () => 'lint warn\n',
  '/projects/7/merge_requests/5/pipelines': () => [],
  '/projects/7/merge_requests/5': () => ({ iid: 5, merge_commit_sha: 'aaa1111bbb', sha: 'eee' }),
};
// 수동 작업: deploy(202) 는 앞 작업(build 201)이 끝나기 전 created → 끝나면 manual → play 뒤 pending → running → success. 21 은 앞이 실패해 skipped
const jobState = { buildPolls: 0, deployPolls: 0, played: false, retried: false, newPolls: 0 };
const deployJob = () => ({ id: 202, stage: 'deploy', name: 'deploy', status: jobState.played ? (jobState.deployPolls++ < 1 ? 'pending' : jobState.deployPolls < 3 ? 'running' : 'success') : jobState.buildPolls >= 2 ? 'manual' : 'created', duration: 42, web_url: 'http://git.test/j/202' });
Object.assign(routes, {
  '/projects/7/pipelines/20': () => pipe(20, 'running', 'release', 'fff3333aaa'),
  '/projects/7/pipelines/20/jobs': () => { jobState.buildPolls += 1; return [{ id: 201, stage: 'build', name: 'build', status: jobState.buildPolls >= 2 ? 'success' : 'running' }, deployJob()]; },
  '/projects/7/jobs/202': () => deployJob(),
  '/projects/7/pipelines/21': () => pipe(21, 'failed', 'release', 'fff4444aaa'),
  '/projects/7/pipelines/21/jobs': () => [{ id: 211, stage: 'build', name: 'build', status: 'failed' }, { id: 212, stage: 'deploy', name: 'deploy', status: 'skipped' }],
  '/projects/7/jobs/104': () => ({ id: 104, stage: 'deploy', name: 'publish', status: jobState.newPolls++ < 1 ? 'running' : 'failed', duration: 5, web_url: 'http://git.test/j/104' }),
});
// 배포 연쇄: MR 30(파이프라인 30 이 돌다 성공 → 머지), MR 31(옛 커밋 파이프라인 40 은 성공, 새 커밋 파이프라인 41 은 조금 뒤에 생겨 실패), release 50(수동 배포에서 멈춤)
const flow = { p30: 0, merged30: false, p41: 0, appear41: 0, canceled: [], retried12: false, raceOpen: 0 };
const mr30 = () => ({ iid: 30, title: 'feat: [develop] 주문', state: flow.merged30 ? 'merged' : 'opened', source_branch: 'feature/x', target_branch: 'develop', sha: 'h30', merge_commit_sha: flow.merged30 ? 'm30full000' : null, detailed_merge_status: 'mergeable', head_pipeline: { id: 30, status: flow.p30 >= 2 ? 'success' : 'running' }, force_remove_source_branch: true, web_url: 'http://git.test/mr/30' });
flow.list = (q) => {
  if (q.get('sha') === 'h30') return [pipe(30, flow.p30 >= 2 ? 'success' : 'running', 'feature/x', 'h30')];
  if (q.get('sha') === 'h31new') return flow.appear41++ < 2 ? [] : [pipe(41, 'running', 'feature/y', 'h31new')];
  if (q.get('ref') === 'release' && q.get('sha') === 'r50') return [pipe(50, 'manual', 'release', 'r50')];
  if (q.get('ref') === 'feature/x' && !q.get('sha')) return [pipe(60, 'running', 'feature/x', 'h30'), pipe(59, 'success', 'feature/x', 'h29')];
  return null;
};
Object.assign(routes, {
  '/projects/7': () => ({ default_branch: 'develop' }),
  '/runners': () => [{ id: 1, description: 'nas' }],
  '/projects/7/merge_requests': (q) => (q.get('source_branch') === 'feature/x' && !flow.merged30 ? [mr30()] : q.get('source_branch') === 'feature/race' && flow.raceOpen++ > 0 ? [{ iid: 34, web_url: 'http://git.test/mr/34', title: 'race', sha: 'r34' }] : []),
  '/projects/7/merge_requests/30': () => mr30(),
  '/projects/7/pipelines/30': () => { flow.p30 += 1; return pipe(30, flow.p30 >= 2 ? 'success' : 'running', 'feature/x', 'h30'); },
  '/projects/7/pipelines/30/jobs': () => [{ id: 301, stage: 'test', name: 'unit', status: flow.p30 >= 2 ? 'success' : 'running' }],
  '/projects/7/merge_requests/31': () => ({ iid: 31, state: 'opened', source_branch: 'feature/y', target_branch: 'develop', sha: 'h31new' }),
  '/projects/7/merge_requests/31/pipelines': () => [pipe(40, 'success', 'feature/y', 'h31old')],
  '/projects/7/pipelines/41': () => { flow.p41 += 1; return pipe(41, flow.p41 >= 2 ? 'failed' : 'running', 'feature/y', 'h31new'); },
  '/projects/7/pipelines/41/jobs': () => [{ id: 411, stage: 'test', name: 'unit', status: flow.p41 >= 2 ? 'failed' : 'running' }],
  '/projects/7/merge_requests/32': () => ({ iid: 32, title: 'x', state: 'opened', source_branch: 'feature/c', target_branch: 'develop', sha: 'c32', has_conflicts: true, detailed_merge_status: 'conflict', web_url: 'http://git.test/mr/32' }),
  '/projects/7/repository/branches/release': () => ({ name: 'release', commit: { id: 'r50' } }),
  '/projects/7/pipelines/50': () => pipe(50, 'manual', 'release', 'r50'),
  '/projects/7/pipelines/50/jobs': () => [{ id: 501, stage: 'build', name: 'build', status: 'success' }, { id: 502, stage: 'deploy', name: 'deploy-prod', status: 'manual' }],
});
const puts = {
  '/projects/7/merge_requests/30/merge': (body) => { if (body.sha !== 'h30' || flow.p30 < 2) return [405, { message: '405 Method Not Allowed' }]; flow.merged30 = true; return [200, mr30()]; },
};
const posts = {
  '/projects/7/pipelines/12/retry': () => { flow.retried12 = true; return [201, pipe(12, 'running', 'main', 'aaa1111bbb')]; },
  '/projects/7/pipelines/60/cancel': () => { flow.canceled.push(60); return [200, pipe(60, 'canceled', 'feature/x', 'h30')]; },
  '/projects/7/merge_requests': () => [409, { message: ['Another open merge request already exists for this source branch'] }],
  '/projects/7/jobs/202/play': () => { if (deployJob().status !== 'manual') return [400, { message: '400 Unplayable Job' }]; jobState.played = true; return [200, deployJob()]; },
  '/projects/7/jobs/102/retry': () => { jobState.retried = true; return [201, { id: 104, stage: 'deploy', name: 'publish', status: 'pending' }]; },
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  seen.push({ path: u.pathname, token: req.headers['private-token'], method: req.method });
  if (req.method === 'POST' || req.method === 'PUT') {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    return req.on('end', () => {
      const ph = (req.method === 'PUT' ? puts : posts)[u.pathname.replace(/^\/api\/v4/, '')];
      const [code, body] = ph ? ph(raw ? JSON.parse(raw) : {}) : [404, { message: '404 Not Found' }];
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  }
  const h = routes[u.pathname.replace(/^\/api\/v4/, '')];
  if (!h) { res.writeHead(404); return res.end('{"message":"404 Not Found"}'); }
  const body = h(u.searchParams);
  res.writeHead(200, { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
});

function run(args, cwd) {
  return new Promise((resolve) => {
    const env = { ...process.env, KEDOVI_POLL_MS: '200', GITLAB_TOKEN: TOKEN, KEDOVI_CONFIG_DIR: path.join(tmp, 'config'), KEDOVI_SECRETS_BACKEND: 'file' };
    delete env.CLAUDE_PROJECT_DIR;
    const c = spawn(process.execPath, [path.join(__dirname, 'gitlab-mr.js'), ...args], { cwd, env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
}

server.listen(0, '127.0.0.1', async () => {
  try {
    const apiBase = `http://127.0.0.1:${server.address().port}/api/v4`;
    const one = path.join(tmp, 'one');
    const two = path.join(tmp, 'two');
    for (const d of [one, two]) fs.mkdirSync(d, { recursive: true });
    const repo = (name) => ({ name, gitlab: { host: `127.0.0.1:${server.address().port}`, projectId: 7, apiBase } });
    fs.writeFileSync(path.join(one, 'workspace.json'), JSON.stringify({ project: { name: 'one' }, repos: [repo('api'), { name: 'docs' }] }));
    fs.writeFileSync(path.join(two, 'workspace.json'), JSON.stringify({ project: { name: 'two' }, repos: [repo('api'), repo('web')] }));

    // 목록 + 맨 위 파이프라인의 작업 (단계 순서 = 작업 ID 순). --repo 생략: gitlab 설정이 하나뿐
    let r = await run(['pipeline'], one);
    assert.strictEqual(r.code, 0, r.out);
    assert.ok(/#12\t✖ failed\tmain\taaa1111/.test(r.out) && /#11\t✔ success/.test(r.out), r.out);
    assert.ok(r.out.indexOf('✔ unit') < r.out.indexOf('✖ publish'), '단계 순서');
    assert.ok(/✖ publish\tfailed\t9초\thttp:\/\/git\.test\/j\/102/.test(r.out) && /✖ lint\tfailed \(실패 허용\)/.test(r.out) && /1분 15초/.test(r.out), r.out);
    assert.ok(r.out.includes('--id 12 --log') && !r.out.includes('npm ERR'), '로그는 --log 일 때만');

    // 실패한 작업의 로그 끝부분 (색 코드 · 빈 줄 제거, 줄 수 제한)
    r = await run(['pipeline', '--id', '12', '--log', '1'], one);
    assert.ok(r.out.includes('| ERROR: Job failed: exit code 1') && !r.out.includes('npm ERR') && !r.out.includes('파이프라인 ('), r.out);
    r = await run(['pipeline', '--log'], one);
    assert.ok(r.out.includes('| npm ERR! 403 Forbidden') && !r.out.includes('\u001b['), r.out);

    // MR: MR 파이프라인이 없으면 머지 커밋의 파이프라인
    r = await run(['pipeline', '--mr', '!5'], one);
    assert.ok(/MR !5 머지 커밋 aaa1111/.test(r.out) && /#12\t✖ failed/.test(r.out), r.out);

    // JSON · 없음 · repo 가 여럿이면 --repo 필요
    r = await run(['pipeline', '--json', '--limit', '1'], one);
    const j = JSON.parse(r.out);
    assert.ok(j.repo === 'api' && j.detail.id === 12 && j.detail.jobs.length === 3 && j.detail.jobs[0].name === 'unit');
    r = await run(['pipeline', '--ref', 'none'], one);
    assert.ok(r.code === 0 && r.out.includes('(없음)'), r.out);
    r = await run(['pipeline'], two);
    assert.ok(r.code === 1 && r.out.includes('--repo 가 필요합니다 (api · web)'), r.out);
    r = await run(['pipeline', '--repo', 'web', '--limit', '1'], two);
    assert.strictEqual(r.code, 0, r.out);

    // 수동 작업 실행: --yes 없으면 확인 문구만 (끝 코드 3, POST 없음) → --yes 면 created 동안 기다렸다가 manual 이 되면 play → 끝까지 상태
    r = await run(['pipeline', '--id', '20', '--play', 'deploy'], one);
    assert.ok(r.code === 3 && /사용자 승인/.test(r.out) && /--yes/.test(r.out) && !seen.some((x) => x.method === 'POST'), r.out);
    jobState.buildPolls = 0;
    r = await run(['pipeline', '--id', '20', '--play', 'deploy', '--yes'], one);
    assert.ok(r.code === 0 && /앞 작업을 기다림 \(created\): build running/.test(r.out) && /▶ 실행 요청/.test(r.out) && /▶ running/.test(r.out) && /✔ deploy 성공/.test(r.out), r.out);
    assert.ok(seen.filter((x) => x.method === 'POST').length === 1, 'play 는 manual 이 된 뒤 한 번만');
    // 앞 작업 실패로 skipped · 없는 작업 · --id 없음
    r = await run(['pipeline', '--id', '21', '--play', 'deploy', '--yes'], one);
    assert.ok(r.code === 1 && /skipped/.test(r.out) && /실행할 수 없습니다/.test(r.out), r.out);
    r = await run(['pipeline', '--id', '21', '--play', 'nope', '--yes'], one);
    assert.ok(r.code === 1 && /있는 작업: build, deploy/.test(r.out), r.out);
    r = await run(['pipeline', '--play', 'deploy', '--yes'], one);
    assert.ok(r.code === 1 && /--id/.test(r.out), r.out);
    // 다시 실행: 실패한 작업 → 새 작업을 끝까지 보고 실패면 끝 코드 1 · 로그 안내
    r = await run(['pipeline', '--id', '12', '--retry', 'publish', '--yes'], one);
    assert.ok(r.code === 1 && jobState.retried && /새 작업 104/.test(r.out) && /✖ publish failed/.test(r.out) && /--log/.test(r.out), r.out);

    // 배포 연쇄 ─ 셋째 워크스페이스는 에이전트 머지를 켠다
    const three = path.join(tmp, 'three');
    fs.mkdirSync(three, { recursive: true });
    fs.writeFileSync(path.join(three, 'workspace.json'), JSON.stringify({ project: { name: 'three' }, vars: { gitlab: { agentMerge: true } }, repos: [repo('api')] }));
    const writes = () => seen.filter((x) => x.method === 'PUT' || (x.method === 'POST' && /cancel|merge_requests$/.test(x.path))).length;
    // 머지: 꺼진 워크스페이스는 안내만 · --yes 없으면 확인 문구만 · 충돌은 거부
    let w0 = writes();
    r = await run(['merge', '30', '--yes'], one);
    assert.ok(r.code === 1 && /agentMerge = false/.test(r.out) && writes() === w0, r.out);
    r = await run(['merge', '30'], three);
    assert.ok(r.code === 3 && /feature\/x → develop/.test(r.out) && /파이프라인 #30 running/.test(r.out) && writes() === w0, r.out);
    r = await run(['merge', '!32', '--yes'], three);
    assert.ok(r.code === 1 && /충돌/.test(r.out), r.out);
    // 돌던 파이프라인을 기다렸다가 MR 머리 커밋(sha)으로 머지 → 머지 커밋 SHA
    r = await run(['merge', '30', '--yes'], three);
    assert.ok(r.code === 0 && /끝나길 기다림/.test(r.out) && /✔ 파이프라인 #30 성공|파이프라인 #30 ✔ success/.test(r.out) && /머지 커밋 m30full/.test(r.out) && /merge_commit_sha=m30full000/.test(r.out), r.out);
    r = await run(['merge', '30', '--json'], one); // 이미 머지됐으면 설정과 상관없이 결과만
    assert.ok(r.code === 0 && JSON.parse(r.out).mergeCommit === 'm30full000', r.out);
    // wait --mr: 옛 커밋의 성공한 파이프라인(40)이 아니라 지금 커밋 파이프라인(41)이 생길 때까지 기다리고 끝까지 → 실패 1
    r = await run(['wait', '--mr', '31'], one);
    assert.ok(r.code === 1 && /머리 커밋 \(feature\/y\) h31new/.test(r.out) && /생기길 기다림/.test(r.out) && /파이프라인 #41/.test(r.out) && !/#40/.test(r.out) && /✖ 파이프라인 #41 failed/.test(r.out) && /retry --repo api --id 41/.test(r.out), r.out);
    // wait --ref: 브랜치 머리 커밋의 파이프라인이 수동 배포에서 멈추면 0 + play 안내
    r = await run(['wait', '--ref', 'release'], one);
    assert.ok(r.code === 0 && /수동 작업에서 멈춤: deploy-prod/.test(r.out) && /play --repo api --id 50 --job deploy-prod --yes/.test(r.out), r.out);
    r = await run(['wait', '--id', '50', '--json'], one);
    assert.ok(r.code === 0 && JSON.parse(r.out).manual[0] === 'deploy-prod', r.out);
    // play 는 pipeline --play 와 같다 (--yes 없으면 3)
    r = await run(['play', '--id', '20', '--job', 'deploy'], one);
    assert.ok(r.code === 3 && /수동 작업/.test(r.out), r.out);
    // retry: --job 없으면 실패한 작업 전부 (파이프라인 다시 실행)
    r = await run(['retry', '--id', '12'], one);
    assert.ok(r.code === 3 && /deploy\/publish/.test(r.out) && !flow.retried12, r.out);
    r = await run(['retry', '--id', '12', '--yes'], one);
    assert.ok(r.code === 1 && flow.retried12 && /다시 실행 요청/.test(r.out), r.out);
    // cancel: 꺼진 곳은 안내만, 켠 곳은 도는 것만 (--yes)
    r = await run(['cancel', '--ref', 'feature/x', '--yes'], one);
    assert.ok(r.code === 1 && !flow.canceled.length, r.out);
    r = await run(['cancel', '--ref', 'feature/x'], three);
    assert.ok(r.code === 3 && /#60 feature\/x/.test(r.out) && !/#59/.test(r.out) && !flow.canceled.length, r.out);
    r = await run(['cancel', '--ref', 'feature/x', '--yes'], three);
    assert.ok(r.code === 0 && flow.canceled.join() === '60', r.out);
    // create: 열린 MR 은 그대로 쓴다 (--json) · 만드는 순간 409 면 다시 찾아 쓴다
    const desc = path.join(tmp, 'desc.md'); fs.writeFileSync(desc, '본문');
    flow.merged30 = false;
    r = await run(['create', '--repo', 'api', '--source', 'feature/x', '--target', 'develop', '--title', 't', '--description-file', desc, '--json'], one);
    assert.ok(r.code === 0 && JSON.parse(r.out).iid === 30 && JSON.parse(r.out).reused === true, r.out);
    r = await run(['create', '--repo', 'api', '--source', 'feature/race', '--target', 'develop', '--title', 't', '--description-file', desc], one);
    assert.ok(r.code === 0 && /!34/.test(r.out) && /그대로 씀/.test(r.out), r.out);
    // 전역 API (프로젝트 밖)
    process.env.GITLAB_TOKEN = TOKEN;
    const M = require('./gitlab-mr.js');
    const runners = await M.apiRoot({ root: tmp, vars: {} }, repo('api'), 'GET', '/runners');
    assert.ok(runners[0].description === 'nas' && seen.some((x) => x.path === '/api/v4/runners'));

    // remove_source_branch 제안: 설정의 영구 브랜치 · 원격 기본 브랜치만 지키고 main · master 를 늘 지키지 않는다
    const { defaultRemoveSource } = require('./gitlab-mr.js');
    const wsv = { vars: { branch: { develop: 'dev', release: 'rel' }, gitlab: { persistentBranches: ['keep'] } } };
    assert.deepStrictEqual(['dev', 'rel', 'keep', 'main', 'master', 'hotfix/x', 'feature/a'].map((b) => defaultRemoveSource(wsv, b, 'main')), [false, false, false, false, true, false, true]);
    assert.strictEqual(defaultRemoveSource(wsv, 'main', null), true);

    // 토큰은 헤더로만 가고 출력에 없다
    assert.ok(seen.length && seen.every((s) => s.token === TOKEN));
    const all = (await Promise.all([run(['pipeline', '--log'], one), run(['pipeline', '--json'], one), run(['pipeline', '--id', '999'], one)])).map((x) => x.out).join('\n');
    assert.ok(!all.includes(TOKEN) && /HTTP 404/.test(all));
    console.log('gitlab-mr.test.js OK');
  } catch (e) {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
