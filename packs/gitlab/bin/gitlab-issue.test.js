// gitlab-issue.js 점검 (로컬 가짜 API): 찾기 · 읽기(시스템 기록 제외) · 등록 · 댓글 · 닫기 · dry-run · 비밀값 모양이면 안 보냄 · 출력에 토큰 없음. 실행: node gitlab-issue.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const TOKEN = 'glpat-test-issue-00001';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-gitlab-issue-'));
const seen = [];
const issue = (iid, state, title) => ({ iid, state, title, description: `본문 ${iid}`, author: { username: 'dev' }, created_at: '2026-01-02T03:04:05.000Z', labels: ['bug'], web_url: `http://git.test/i/${iid}` });
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    seen.push({ method: req.method, path: u.pathname, query: u.searchParams, token: req.headers['private-token'], body: body ? JSON.parse(body) : null });
    const p = u.pathname.replace(/^\/api\/v4\/projects\/7/, '');
    let out = null;
    if (req.method === 'GET' && p === '/issues') out = u.searchParams.get('search') === '없음' ? [] : [issue(3, 'opened', '로그인 실패'), issue(1, 'closed', '로그인 느림')];
    else if (req.method === 'GET' && p === '/issues/3') out = issue(3, 'opened', '로그인 실패');
    else if (req.method === 'GET' && p === '/issues/3/notes') out = [{ id: 1, system: true, body: 'changed label', author: { username: 'dev' } }, { id: 2, system: false, body: '재현됩니다', author: { username: 'qa' }, created_at: '2026-01-03T00:00:00Z' }];
    else if (req.method === 'POST' && p === '/issues') out = { iid: 9, web_url: 'http://git.test/i/9' };
    else if (req.method === 'POST' && p === '/issues/3/notes') out = { id: 77 };
    else if (req.method === 'GET' && p === '/issues/1') out = issue(1, 'closed', '로그인 느림');
    else if (req.method === 'PUT' && p === '/issues/3') out = { ...issue(3, 'closed', '로그인 실패') };
    if (!out) { res.writeHead(404); return res.end('{"message":"404 Not Found"}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});

function run(args, cwd) {
  return new Promise((resolve) => {
    const env = { ...process.env, GITLAB_TOKEN: TOKEN, KEDOVI_CONFIG_DIR: path.join(tmp, 'config'), KEDOVI_SECRETS_BACKEND: 'file' };
    delete env.CLAUDE_PROJECT_DIR;
    const c = spawn(process.execPath, [path.join(__dirname, 'gitlab-issue.js'), ...args], { cwd, env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
  });
}

server.listen(0, '127.0.0.1', async () => {
  try {
    const host = `127.0.0.1:${server.address().port}`;
    const ws = path.join(tmp, 'ws');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ project: { name: 'ws' }, repos: [{ name: 'api', gitlab: { host, projectId: 7, apiBase: `http://${host}/api/v4` } }, { name: 'docs' }] }));
    const desc = path.join(tmp, 'desc.md');
    fs.writeFileSync(desc, '## 현상\n로그인 버튼을 눌러도 반응이 없습니다\n');

    // 찾기: 열린 것 · 닫힌 것 모두, --repo 생략
    let r = await run(['search', '--q', '로그인'], ws);
    assert.ok(r.code === 0 && /#3\topened\t로그인 실패/.test(r.out) && /#1\tclosed/.test(r.out), r.out);
    assert.strictEqual(seen.at(-1).query.get('state'), 'all');
    r = await run(['search', '--q', '없음'], ws);
    assert.ok(r.out.includes('(비슷한 이슈 없음)'), r.out);

    // 읽기: 시스템 기록은 빼고 사람 댓글만
    r = await run(['view', '--iid', '#3'], ws);
    assert.ok(r.code === 0 && r.out.includes('#3 로그인 실패') && r.out.includes('라벨: bug') && r.out.includes('재현됩니다') && !r.out.includes('changed label'), r.out);

    // 등록: dry-run 은 보내지 않는다
    const before = seen.length;
    r = await run(['create', '--title', '로그인 확인 요청', '--description-file', desc, '--dry-run'], ws);
    assert.ok(r.code === 0 && r.out.includes('[dry-run] POST') && r.out.includes('PRIVATE-TOKEN: ***') && seen.length === before, r.out);
    r = await run(['create', '--title', '로그인 확인 요청', '--description-file', desc], ws);
    assert.ok(r.code === 0 && r.out.includes('✔ 이슈 #9'), r.out);
    assert.deepStrictEqual(seen.at(-1).body, { title: '로그인 확인 요청', description: fs.readFileSync(desc, 'utf8') });

    // 댓글
    r = await run(['comment', '--iid', '3', '--body-file', desc], ws);
    assert.ok(r.code === 0 && r.out.includes('✔ 이슈 #3 댓글 77'), r.out);

    // 닫기: dry-run 은 보내지 않는다 · 사유 댓글 → 닫기 · 이미 닫힌 것은 알리고 성공
    let m = seen.length;
    r = await run(['close', '--iid', '3', '--reason-file', desc, '--dry-run'], ws);
    assert.ok(r.code === 0 && r.out.includes('[dry-run] PUT') && r.out.includes('"state_event": "close"') && seen.length === m, r.out);
    r = await run(['close', '--iid', '3', '--reason-file', desc], ws);
    assert.ok(r.code === 0 && r.out.includes('사유 댓글 77') && r.out.includes('✔ 이슈 #3 닫음'), r.out);
    assert.deepStrictEqual(seen.slice(m).map((s) => `${s.method} ${s.path.replace(/^\/api\/v4\/projects\/7/, '')}`), ['GET /issues/3', 'POST /issues/3/notes', 'PUT /issues/3']);
    assert.deepStrictEqual(seen.at(-1).body, { state_event: 'close' });
    m = seen.length;
    r = await run(['close', '--iid', '1', '--reason-file', desc], ws);
    assert.ok(r.code === 0 && r.out.includes('이미 닫혀') && seen.length === m + 1, r.out);

    // 비밀값 모양이면 보내지 않는다 (제목 · 본문 · 댓글)
    const leak = path.join(tmp, 'leak.md');
    fs.writeFileSync(leak, `로그\ntoken=${'glpat-'}abcdefghij0123456789\n`);
    const n = seen.length;
    r = await run(['create', '--title', 't', '--description-file', leak], ws);
    assert.ok(r.code === 1 && r.out.includes('2줄 GitLab 토큰') && !r.out.includes('abcdefghij0123456789'), r.out);
    r = await run(['comment', '--iid', '3', '--body-file', leak], ws);
    assert.ok(r.code === 1 && seen.length === n, r.out);
    r = await run(['close', '--iid', '3', '--reason-file', leak], ws);
    assert.ok(r.code === 1 && seen.length === n, r.out);

    // 인자 확인 · 토큰은 헤더로만
    r = await run(['view'], ws);
    assert.ok(r.code === 1 && r.out.includes('--iid'), r.out);
    assert.ok(seen.every((s) => s.token === TOKEN));
    console.log('gitlab-issue.test.js OK');
  } catch (e) {
    console.error(e.stack || e.message);
    process.exitCode = 1;
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
