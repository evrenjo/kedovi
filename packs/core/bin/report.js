#!/usr/bin/env node
// 보고 페이지: 채팅에는 결론 · 핵심만 쓰고, 자세한 보고(바뀐 파일 · 검증 표 · 근거 · 남은 것)는 이 PC 의 웹 페이지로. 실행: kedovi report <명령>
/*
 * 명령
 *   new "<제목>"        .agents/reports/<날짜>/<시각>.md 를 틀로 만들고 (제목은 첫 줄) 파일 경로 · 링크를 준다 (AI 가 그 파일에 쓴다)
 *   link <파일>         그 보고의 링크 (이 PC 웹 서버가 없으면 띄운다)
 *   list [--n 10]       최근 보고
 *   open [파일]         브라우저로 연다 (없으면 가장 최근)
 *   serve [--port N]    현황판 · 보고를 http://127.0.0.1:<포트>/ 로 (앞에서 계속). 보통은 new · link 가 뒤에서 띄운다
 *   stop                뒤에서 띄운 서버를 끈다
 * 보고는 이 PC 에만 둔다 (.agents/reports/, gitignore). 남길 것은 핸드오프로. 페이지는 kedovi board 와 같은 문서 사이트 틀
 * 서버는 이 PC 에서만 열린다(127.0.0.1). 페이지를 열 때 보고 · 기록이 바뀌었으면 다시 만든다
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const { load } = require('../lib/workspace');

const R = require('../lib/reports');

const { DIR } = R;
const ws = load();
const ROOT = ws.root;
const BOARD = path.join(ROOT, '.agents', 'board');
const STATE = R.stateFile(ROOT);
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const readState = () => R.readState(ROOT);
const { alive } = R;
const basePort = () => R.basePort(ROOT);
const urlOf = (port, file) => R.urlOf(ROOT, port, file);
const ensureServer = () => R.ensureServer(ROOT);

/** 보고 목록 (최근 것 먼저) → [{ rel, file, mtime, title }] */
function reports() {
  const base = path.join(ROOT, DIR);
  const out = [];
  (function walk(d) {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        const text = fs.readFileSync(p, 'utf8');
        out.push({ rel: path.relative(ROOT, p).split(path.sep).join('/'), file: p, mtime: fs.statSync(p).mtimeMs, title: ((text.match(/^#\s+(.+)$/m) || [])[1] || e.name).trim() });
      }
    }
  })(base);
  return out.sort((a, b) => b.mtime - a.mtime);
}

const TEMPLATE = (title, when) => `# ${title}

> ${when} · 이 PC 의 보고 (kedovi report). 채팅에는 결론과 핵심만 있다

## 결론

(한두 줄: 무엇을 했고 결과가 어떤가)

## 바뀐 것

| 파일 | 무엇 |
|---|---|

## 검증

| 대상 | 방법 | 기대 | 실제 | 판정 |
|---|---|---|---|---|

## 근거

- (파일:라인 · 명령 출력 · 출처)

## 남은 것 · 사용자가 할 일

- 없음
`;

function cmdNew(title) {
  if (!title) { console.error('사용법: kedovi report new "<제목>"'); process.exit(1); }
  const { file, day, time } = R.newFile(ROOT);
  fs.writeFileSync(file, TEMPLATE(title, `${day} ${time}`));
  const port = ensureServer();
  console.log(`파일: ${path.relative(ROOT, file)}`);
  console.log(`링크: ${urlOf(port, file)}`);
  console.log('이 파일의 틀을 채운 뒤, 채팅에는 결론 1줄 + 핵심 3~5줄 + 「자세히: <링크>」 를 쓴다. 오류 · 실패 · 사용자가 정할 것은 채팅에도 남긴다');
}

/** 현황판 다시 만들기 (보고 포함, fetch 없이, 브라우저 열지 않음) */
function rebuild() {
  spawnSync(process.execPath, [path.join(__dirname, 'board.js'), '--no-open', '--no-fetch', '--quiet'], { cwd: ROOT, stdio: 'ignore' });
}

/** 보고 · 기록의 마지막 변경 시각 */
function sourceTime() {
  let t = 0;
  const walk = (d) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) t = Math.max(t, fs.statSync(p).mtimeMs); } };
  walk(path.join(ROOT, DIR));
  walk(path.join(ROOT, 'handoffs'));
  return t;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

function serve() {
  const quiet = argv.includes('--quiet');
  let built = 0;
  const fresh = () => { const t = sourceTime(); if (!built || t > built) { rebuild(); built = Date.now(); } };
  fresh();
  const server = http.createServer((req, res) => {
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(req.headers.host || '')) { res.writeHead(400); res.end(); return; }
    let rel = decodeURIComponent(String(req.url || '/').split('?')[0]).replace(/^\/+/, '');
    if (rel.includes('\0') || rel.split('/').includes('..')) { res.writeHead(400); res.end(); return; }
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    if (rel.endsWith('.html')) fresh();
    const f = path.join(BOARD, rel);
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('없는 페이지입니다. 보고가 지워졌거나 아직 쓰지 않았습니다'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  let port = Number(opt('port')) || basePort();
  server.on('error', (e) => { if (e.code === 'EADDRINUSE' && port < basePort() + 20) { port += 1; server.listen(port, '127.0.0.1'); } else { console.error(`✖ 서버를 띄우지 못했습니다: ${e.message}`); process.exit(1); } });
  server.on('listening', () => {
    try { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify({ pid: process.pid, port, at: new Date().toISOString() })); } catch { /* 기록 실패 */ }
    if (!quiet) console.log(`✔ 현황판 · 보고: http://127.0.0.1:${port}/  (이 PC 에서만, 끝내기 Ctrl+C)`);
  });
  server.listen(port, '127.0.0.1');
}

function open(url) {
  const opener = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawnSync(opener[0], opener[1], { stdio: 'ignore' });
}

const [cmd, ...rest] = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').match(/^--(port|n)$/));
if (cmd === 'new') cmdNew(rest.join(' '));
else if (cmd === 'link') { if (!rest[0]) { console.error('사용법: kedovi report link <파일>'); process.exit(1); } console.log(urlOf(ensureServer(), rest[0])); }
else if (cmd === 'open') { const f = rest[0] || (reports()[0] || {}).file; if (!f) { console.log('보고가 없습니다 (kedovi report new "<제목>")'); } else { const u = urlOf(ensureServer(), f); console.log(u); open(u); } }
else if (cmd === 'serve') serve();
else if (cmd === 'stop') { const st = readState(); if (st && st.pid && alive(st.pid)) { process.kill(st.pid); console.log(`✔ 서버를 껐습니다 (포트 ${st.port})`); } else console.log('뒤에서 도는 서버가 없습니다'); try { fs.unlinkSync(STATE); } catch { /* 없음 */ } }
else if (!cmd || cmd === 'list') {
  const list = reports().slice(0, Number(opt('n')) || 10);
  if (!list.length) console.log('보고가 없습니다 (kedovi report new "<제목>")');
  const st = readState();
  const port = st && st.pid && alive(st.pid) ? st.port : null;
  for (const r of list) console.log(`${new Date(r.mtime).toLocaleString()} · ${r.title} · ${port ? urlOf(port, r.file) : r.rel}`);
} else { console.error('사용법: kedovi report new "<제목>" · link <파일> · list · open [파일] · serve [--port N] · stop'); process.exit(1); }

