// 문서 사이트를 이 PC 에서 띄워 두기 — kedovi start 가 백그라운드로 띄우고(이미 떠 있으면 그대로), 세션 브리핑이 주소를 한 줄 보인다.
// 사이트 위치: 워크스페이스 .agents/site/ (워크스페이스 문서 사이트 생성물) → 없으면 연결된 기획 repo 의 docs-site/ 중 처음 것. 만든 적이 없으면 아무것도 하지 않는다.
// 워크스페이스 docs-site/ 원본이 있으면 lib/site.js(빌드 · 서버 · Pages 주소)를 그대로 쓴다. 옛 기획 repo 사이트만 있을 때만 여기 서버(bin/site-serve.js)를 띄운다.
// 상태 파일(옛 기획 repo 사이트): .agents/status/site-server.json { pid, port, dir, at } (.agents/status/ 는 gitignore)
'use strict';
const fs = require('fs');
const path = require('path');

const STATE = path.join('.agents', 'status', 'site-server.json');

/** 보여 줄 사이트 폴더 (index.html 이 있는 곳). 없으면 null */
function siteDir(root) {
  const cands = [path.join(root, '.agents', 'site')];
  try {
    const { load } = require('./workspace');
    const ws = load(root);
    for (const r of ws.repos || []) if (r.kind === 'docs') cands.push(path.join(r.dir, 'docs-site'));
  } catch { /* workspace.json 문제: 워크스페이스 사이트만 본다 */ }
  return cands.find((d) => { try { return fs.statSync(path.join(d, 'index.html')).isFile(); } catch { return false; } }) || null;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === 'EPERM'); } };

const site = () => { try { return require('./site'); } catch { return null; } };
const wsLayout = (root) => { const S = site(); try { return S && S.siteInfo(root).layout === 'workspace' ? S : null; } catch { return null; } };

/** 떠 있는 서버 상태 (프로세스가 살아 있을 때만). 없으면 null */
function serverState(root) {
  const S = wsLayout(root);
  if (S) { const s = S.serving(root); return s ? { pid: s.pid, port: s.port, dir: S.siteInfo(root).out } : null; }
  try {
    const st = JSON.parse(fs.readFileSync(path.join(root, STATE), 'utf8'));
    return st && st.pid && st.port && alive(st.pid) ? st : null;
  } catch { return null; }
}

/** Pages 주소 (workspace.json project.pagesUrl, 원격 연결 때 정해진다). 없으면 null */
function pagesUrl(root) {
  const S = wsLayout(root);
  if (S) { try { const u = S.siteInfo(root).pagesUrl; if (u) return u; } catch { /* 아래 */ } }
  try { return JSON.parse(fs.readFileSync(path.join(root, 'workspace.json'), 'utf8')).project.pagesUrl || null; } catch { return null; }
}

/** { local, pages } — 둘 다 없으면 null. 세션 브리핑 · kedovi start 가 쓴다 */
function siteUrl(root) {
  const st = serverState(root);
  const local = st ? `http://localhost:${st.port}/` : null;
  const pages = pagesUrl(root);
  return local || pages ? { local, pages } : null;
}

/** 브리핑 한 줄. 없으면 '' */
function siteLine(root) {
  const u = siteUrl(root);
  if (!u) return '';
  return `문서 사이트: ${[u.local, u.pages && `Pages ${u.pages}`].filter(Boolean).join(' · ')}`;
}

/**
 * 서버를 띄운다 (이미 같은 폴더로 떠 있으면 그대로). 빈 포트를 서버가 골라 상태 파일에 적는다. 반환 상태 | null (사이트 없음 · 실패)
 * waitMs 동안 상태 파일을 기다린다 (브리핑 훅이 주소를 읽도록)
 */
async function ensureServer(root, { waitMs = 2000 } = {}) {
  const S = wsLayout(root);
  if (S) { const r = S.ensureServer(root, { wait: true, build: true }); return r ? { pid: r.pid, port: r.port, dir: S.siteInfo(root).out } : null; }
  const dir = siteDir(root);
  if (!dir) return null;
  const cur = serverState(root);
  if (cur && path.resolve(cur.dir) === path.resolve(dir)) return cur;
  if (cur) { try { process.kill(cur.pid); } catch { /* 이미 끝남 */ } }
  try { fs.unlinkSync(path.join(root, STATE)); } catch { /* 없음 */ }
  const { spawn } = require('child_process');
  const tool = path.join(__dirname, '..', 'bin', 'site-serve.js');
  if (!fs.existsSync(tool)) return null;
  const child = spawn(process.execPath, [tool, dir, '--state', path.join(root, STATE)], { detached: true, stdio: 'ignore', cwd: root });
  child.unref();
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    const st = serverState(root);
    if (st) return st;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

module.exports = { STATE, siteDir, serverState, siteUrl, siteLine, ensureServer, pagesUrl };
