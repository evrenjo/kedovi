#!/usr/bin/env node
// 문서 사이트 폴더를 이 PC 에서만 보는 웹 주소로 (백그라운드용). kedovi start 가 lib/sitehost.js 로 띄운다.
//   node packs/core/bin/site-serve.js <폴더> [--state <상태 파일>] [--port 8000]
// 빈 포트를 8000 부터 찾고, 듣기 시작하면 상태 파일에 { pid, port, dir, at } 를 적는다. 끝날 때 지운다.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const dir = path.resolve(argv[0] || '.');
const stateFile = opt('state');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
  // 이 PC 의 주소로 온 요청만 (다른 사이트가 DNS 를 127.0.0.1 로 돌려 읽는 것을 막는다). NUL 이 든 경로는 막는다
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(req.headers.host || '') || rel.includes('\0')) { res.writeHead(400); res.end(); return; }
  let f = path.join(dir, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (f !== dir && !f.startsWith(dir + path.sep)) { res.writeHead(403); res.end(); return; }
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch { /* 아래에서 404 */ }
  fs.readFile(f, (e, data) => {
    if (e) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end(`없음: ${rel}`); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(data);
  });
});

let port = Number(opt('port')) || 8000;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && port < 8100) { port++; server.listen(port, '127.0.0.1'); return; }
  process.exit(1);
});
server.on('listening', () => {
  if (!stateFile) { process.stdout.write(`http://localhost:${port}/\n`); return; }
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ pid: process.pid, port, dir, at: new Date().toISOString() }) + '\n');
  } catch { process.exit(1); }
});
const bye = () => {
  try { if (stateFile && JSON.parse(fs.readFileSync(stateFile, 'utf8')).pid === process.pid) fs.unlinkSync(stateFile); } catch { /* 없음 */ }
  process.exit(0);
};
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
server.listen(port, '127.0.0.1');
