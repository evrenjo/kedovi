// 보고 페이지 공용: 보고 파일 위치 · 이 PC 웹 서버 주소 · 서버 띄우기 (bin/report.js · hooks/agent-report.js 가 쓴다)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const DIR = path.join('.agents', 'reports');
const pad = (n) => String(n).padStart(2, '0');

const stateFile = (root) => path.join(root, '.agents', 'board.serve.json');
function readState(root) { try { return JSON.parse(fs.readFileSync(stateFile(root), 'utf8')); } catch { return null; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

/** 워크스페이스마다 같은 포트 (8700 ~ 8899) */
function basePort(root) {
  let h = 0;
  for (const c of root) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 8700 + (h % 200);
}

/** 보고 파일 → 페이지 주소 */
function urlOf(root, port, file) {
  const rel = path.relative(path.join(root, DIR), path.resolve(root, file)).split(path.sep).join('/').replace(/\.md$/, '.html');
  return `http://127.0.0.1:${port}/reports/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * 뒤에서 도는 서버 (없으면 띄운다) → 포트. wait=false 면 기다리지 않고 기본 포트를 준다 (훅: 시간 제한이 짧다)
 */
function ensureServer(root, { wait = true } = {}) {
  const st = readState(root);
  if (st && st.pid && alive(st.pid)) return st.port;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'report.js'), 'serve', '--quiet'], { cwd: root, detached: true, stdio: 'ignore' });
  child.unref();
  if (!wait) return basePort(root);
  for (let i = 0; i < 40; i += 1) { // 최대 4초 기다린다
    const s = readState(root);
    if (s && s.pid === child.pid && s.port) return s.port;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},100)']);
  }
  return basePort(root);
}

/** 새 보고 파일 경로 (.agents/reports/<날짜>/<시각>[-<꼬리>].md, 겹치면 -2 · -3) → { file, day, time } */
function newFile(root, suffix = '') {
  const d = new Date();
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dir = path.join(root, DIR, day);
  fs.mkdirSync(dir, { recursive: true });
  // 파일 이름은 시각(+ 영문 꼬리)만 (한글이 주소에 들어가면 링크가 %EC… 로 길어진다). 제목은 페이지 첫 줄
  const hm = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  const tail = String(suffix).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const stem = tail ? `${hm}-${tail}` : hm;
  let file = path.join(dir, `${stem}.md`);
  for (let i = 2; fs.existsSync(file); i += 1) file = path.join(dir, `${stem}-${i}.md`);
  return { file, day, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

module.exports = { DIR, pad, stateFile, readState, alive, basePort, urlOf, ensureServer, newFile };
