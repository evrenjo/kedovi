// kedovi docs serve 의 쓰기 길 (이 PC 의 사이트 서버만): GET /_api/whoami · POST /_api/comment · /_api/board · /_api/issue.
// 원격이 있고 이 PC 인증이 되면 원격(GitLab · GitHub)에 만들고, 아니면 워크스페이스 파일에 쓰고 그 파일만 git 커밋한다. 쓴 뒤 사이트를 다시 만든다.
// 지킴: 127.0.0.1 에서만 듣고(서버), Host 가 이 PC 주소여야 하고(서버), Origin 이 있으면 같은 주소여야 하며, POST 는 JSON 만 (다른 사이트의 폼 · 단순 요청 차단).
// Node 기본 모듈만.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const SD = require('./sitedb');
const SR = require('./siteremote');

const MAX_BODY = 64 * 1024;
const LIMIT = { page: 300, quote: 500, text: 10000, title: 200, body: 20000, ids: 30 };
const ID_OK = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+|#\d+)$/;

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(obj));
}
const sameOrigin = (origin, port) => new RegExp(`^http://(localhost|127\\.0\\.0\\.1|\\[::1\\]):${port}$`, 'i').test(String(origin));

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('요청이 너무 큽니다'), { status: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

/** 이 PC 의 나 { id, name } | null: .agents/local.json me (kedovi start 가 정한 아이디 · 이름) > 팀 구성 이름 > git user.name */
function whoami(root) {
  let id = '', name = '';
  try { const me = (readJson(path.join(root, '.agents', 'local.json')) || {}).me || {}; id = String(me.username || '').trim(); name = String(me.name || '').trim(); } catch { /* 없음 */ }
  if (!id) { try { id = require('./team').me(root).username || ''; } catch { /* 없음 */ } }
  if (!id) return null;
  if (!name) {
    try {
      const ws = require('./workspace').load(root);
      const { leads, members } = require('./team').roster(ws);
      const p = [...leads, ...members].find((x) => x.username === id);
      if (p && p.nickname) name = p.nickname;
    } catch { /* 없음 */ }
  }
  return { id, name: name || id };
}

/** 비밀값 모양이 있으면 그 종류 목록 (킷의 검사) */
function secretKinds(root, text) {
  for (const f of [path.join(root, 'bin', 'kit.js'), path.join(__dirname, '..', '..', '..', 'bin', 'kit.js')]) {
    try { if (fs.existsSync(f)) return require(f).secretHits(text).map((h) => h.kind); } catch { /* 다음 */ }
  }
  return [];
}

const str = (v, max, name, { required = true } = {}) => {
  const s = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : v == null ? '' : null;
  if (s === null) throw Object.assign(new Error(`${name}: 글자여야 합니다`), { status: 400 });
  if (required && !s) throw Object.assign(new Error(`${name} 이(가) 비었습니다`), { status: 400 });
  if (s.length > max) throw Object.assign(new Error(`${name} 이(가) 너무 깁니다 (${max}자까지)`), { status: 400 });
  return s;
};
const slug = (t) => String(t).replace(/[\\/:*?"<>|#%{}^~[\]`'\0-\x1f]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 40) || '글';
/** 이 PC 시간대의 ISO 시각 (git 의 %aI 와 같은 꼴: 2026-11-25T09:30:00+09:00) */
function nowIso(d = new Date()) {
  const p = (n) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}
const today = () => nowIso().slice(0, 10);

/** 파일 하나만 커밋 (git repo 가 아니면 쓰기만). 반환 { committed, error? } */
function commitOne(root, file, message) {
  const rel = path.relative(root, file);
  const g = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8', timeout: 60000 });
  if (g('rev-parse', '--is-inside-work-tree').status !== 0) return { committed: false, error: 'git 저장소가 아닙니다' };
  const add = g('add', '--', rel);
  if (add.status !== 0) return { committed: false, error: (add.stderr || '').trim().split('\n').pop() };
  const c = g('commit', '-q', '-m', message, '--', rel);
  if (c.status !== 0) return { committed: false, error: `${((c.stdout || '') + (c.stderr || '')).trim().split('\n').slice(-2).join(' ')}. 파일은 남겼습니다 (직접 커밋)` };
  return { committed: true };
}

/** 쪽이 사이트에 있는가 (만든 사이트의 파일 목록) 또는 가상 화면(_/…) */
function pageKnown(outDir, page) {
  if (/^_\/[\w가-힣\-/.]{1,200}$/.test(page) && !page.includes('..')) return true;
  const man = readJson(path.join(outDir, 'assets', 'site.json'));
  return !!(man && Array.isArray(man.files) && man.files.includes(page) && /\.html$/.test(page));
}

/**
 * 요청 처리기를 만든다. ctx: { root(워크스페이스), src(docs-site), outDir(.agents/site), port(), rebuild() }.
 * 반환 (req, res) => boolean (처리했으면 true)
 */
function api(ctx) {
  return (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://x'); } catch { return false; }
    if (!url.pathname.startsWith('/_api/')) return false;
    const origin = req.headers.origin;
    if ((origin && !sameOrigin(origin, ctx.port())) || req.headers['sec-fetch-site'] === 'cross-site') { send(res, 403, { ok: false, error: '이 PC 의 사이트 주소에서 온 요청만 받습니다' }); return true; }
    const name = url.pathname.slice('/_api/'.length);
    if (name === 'whoami') {
      if (req.method !== 'GET') { send(res, 405, { ok: false, error: 'GET 만' }); return true; }
      const w = SR.writer(ctx.root);
      send(res, 200, { ok: true, me: whoami(ctx.root), remote: w.remote ? { kind: w.remote.kind, web: w.remote.web } : null, canWrite: true, where: w.remote && w.token ? 'remote' : 'local' });
      return true;
    }
    if (!['comment', 'board', 'issue'].includes(name)) { send(res, 404, { ok: false, error: `없는 길: ${name}` }); return true; }
    if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST 만' }); return true; }
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) { send(res, 415, { ok: false, error: 'JSON 으로 보낸다 (content-type: application/json)' }); return true; }
    (async () => {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { throw Object.assign(new Error(e.status ? e.message : 'JSON 을 읽지 못했습니다'), { status: e.status || 400 }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('JSON 객체여야 합니다'), { status: 400 });
      const out = await write(ctx, name, body);
      ctx.rebuild();
      send(res, 200, { ok: true, ...out });
    })().catch((e) => send(res, e.status || 500, { ok: false, error: e.message }));
    return true;
  };
}

async function write(ctx, kind, b) {
  const me = whoami(ctx.root);
  const who = me ? me.id : '';
  const check = (...texts) => { const k = secretKinds(ctx.root, texts.join('\n')); if (k.length) throw Object.assign(new Error(`비밀값 모양이 있어 쓰지 않았습니다: ${[...new Set(k)].join(' · ')}`), { status: 400 }); };
  const w = SR.writer(ctx.root);
  const remote = !!(w.remote && w.token);
  if (kind === 'comment') {
    const page = str(b.page, LIMIT.page, 'page');
    if (!pageKnown(ctx.outDir, page)) throw Object.assign(new Error(`사이트에 없는 쪽입니다: ${page}`), { status: 400 });
    const quote = str(b.quote, LIMIT.quote, 'quote', { required: false });
    const text = str(b.text, LIMIT.text, 'text');
    check(quote, text);
    if (remote) {
      const db = readJson(path.join(ctx.outDir, 'assets', 'site-db.json')) || {};
      const doc = (db.docs || []).find((d) => d.page === page);
      return { where: 'remote', ...(await SR.writeComment(ctx.root, { page, title: doc ? doc.title : page, quote, text, who })) };
    }
    const f = path.join(ctx.src, SD.COMMENTS_DIR, SD.commentFile(page));
    const cur = readJson(f) || { page, items: [] };
    if (cur.page !== page || !Array.isArray(cur.items)) throw Object.assign(new Error(`의견 파일이 다른 쪽 것입니다: ${path.relative(ctx.root, f)}`), { status: 409 });
    const item = { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, who, at: nowIso(), quote, text };
    cur.items.push(item);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${JSON.stringify(cur, null, 1)}\n`);
    return { where: 'local', id: item.id, file: path.relative(ctx.root, f).split(path.sep).join('/'), ...commitOne(ctx.root, f, `docs: 의견 (${page})`) };
  }
  if (kind === 'board') {
    const title = str(b.title, LIMIT.title, 'title');
    const body = str(b.body, LIMIT.body, 'body');
    const pinned = b.pinned === true;
    check(title, body);
    if (remote) return { where: 'remote', ...(await SR.writeBoard(ctx.root, { title, body, pinned })) };
    const dir = path.join(ctx.src, SD.BOARD_DIR);
    fs.mkdirSync(dir, { recursive: true });
    let base = `${today()}-${slug(title)}`;
    for (let i = 2; fs.existsSync(path.join(dir, `${base}.md`)); i++) base = `${today()}-${slug(title)}-${i}`;
    const f = path.join(dir, `${base}.md`);
    fs.writeFileSync(f, `# ${title.replace(/\n/g, ' ')}\n\n> 작성: ${who || '모름'} · 날짜: ${nowIso()}${pinned ? ' · 공지' : ''}\n\n${body}\n`);
    return { where: 'local', id: base, file: path.relative(ctx.root, f).split(path.sep).join('/'), ...commitOne(ctx.root, f, `docs: 게시판 글 「${title.slice(0, 60)}」`) };
  }
  // issue
  const title = str(b.title, LIMIT.title, 'title');
  const body = str(b.body, LIMIT.body, 'body', { required: false });
  const ids = Array.isArray(b.ids) ? b.ids.map(String).map((x) => x.trim()).filter(Boolean) : [];
  if (ids.length > LIMIT.ids || ids.some((x) => !ID_OK.test(x))) throw Object.assign(new Error('ids 는 문서 ID(예: FN-001) · #번호 목록 (30개까지)'), { status: 400 });
  check(title, body);
  if (remote) return { where: 'remote', ...(await SR.writeIssue(ctx.root, { title, body, ids })) };
  const dir = path.join(ctx.root, 'issues');
  fs.mkdirSync(dir, { recursive: true });
  const nums = fs.readdirSync(dir).map((x) => Number((/^(\d+)-/.exec(x) || [])[1])).filter((n) => n > 0);
  const n = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0');
  const f = path.join(dir, `${n}-${slug(title)}.md`);
  fs.writeFileSync(f, `# ${n} ${title.replace(/\n/g, ' ')}\n\n> 상태: 열림 · 종류: 요청 · 담당: 없음 · 관련: ${ids.join(' ') || '없음'} · 작성: ${who || '모름'} · 날짜: ${today()}\n\n${body || '(내용 없음)'}\n`);
  return { where: 'local', id: `ISSUE-${n}`, file: path.relative(ctx.root, f).split(path.sep).join('/'), ...commitOne(ctx.root, f, `docs: 이슈 ISSUE-${n} 「${title.slice(0, 60)}」`) };
}

/**
 * 다시 만들기 (한 번에 하나, 도는 중에 또 부르면 끝난 뒤 한 번 더). 반환 { rebuild(), stop() }.
 * watch: docs-site/ · issues/ 가 바뀌면 (짧게 모아) 다시 만든다
 */
function rebuilder({ root, src, tool, watch = true, delay = 400, log = () => {} }) {
  let running = false, again = false, timer = null;
  const go = () => {
    if (running) { again = true; return; }
    running = true;
    const child = spawn(process.execPath, [tool, 'build'], { cwd: root, stdio: 'ignore', env: process.env });
    child.on('exit', (code) => { running = false; log(code === 0 ? '다시 만듦' : `다시 만들기 실패 (${code})`); if (again) { again = false; schedule(); } });
    child.on('error', () => { running = false; });
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(go, delay); };
  const watchers = [];
  if (watch) {
    for (const dir of [src, path.join(root, 'issues')]) {
      try { watchers.push(fs.watch(dir, { recursive: true }, (ev, f) => { if (f && /(^|[\\/])\.(git|DS_Store)/.test(String(f))) return; schedule(); })); } catch { /* 이 OS 에서 폴더 감시를 못 하면 쓰기 뒤에만 */ }
    }
  }
  return { rebuild: schedule, stop: () => { clearTimeout(timer); for (const w of watchers) try { w.close(); } catch { /* 이미 닫힘 */ } } };
}

module.exports = { api, rebuilder, whoami, pageKnown, sameOrigin, slug, commitOne, LIMIT };
