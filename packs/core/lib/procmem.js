// Claude Code 프로세스 메모리 (macOS · Linux): 세션마다 프로세스 나무(MCP · 셸 · 브라우저 포함)의 메모리 합계, 주인 없이 남은 브라우저 · MCP, Docker VM.
// ps 하나로 읽고 아무것도 멈추지 않는다. Windows 는 null (ps 없음)
'use strict';
const { spawnSync } = require('child_process');

const GB = 1024 * 1024; // ps rss 는 KB
const CLAUDE = /(^|\/)claude$|\/\.local\/share\/claude\/versions\//;
const BROWSER_RE = /Chrome|Chromium|chrome-headless|msedge/i;
const BROWSER = { test: (x) => BROWSER_RE.test(x) && !/mcp|devtools-mcp|node_modules/i.test(x) }; // 브라우저 실행 파일 (MCP 서버 경로 제외)
const MCP = /mcp|chrome-devtools|playwright/i;
const DOCKER_VM = /Virtualization\.framework.*VirtualMachine|com\.docker\.virtualization|qemu-system/i;

/** 실행 파일 경로 (인자 앞까지. 「Google Chrome.app」 처럼 공백이 든 경로도) */
const exe = (cmd) => String(cmd || '').split(/\s+-/)[0];

/** "dd-hh:mm:ss" · "hh:mm:ss" · "mm:ss" → 초 */
function seconds(etime) {
  const m = String(etime || '').match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3]) * 60) + Number(m[4]);
}

function list() {
  if (process.platform === 'win32') return null;
  const r = spawnSync('ps', ['-axo', 'pid=,ppid=,rss=,etime=,command='], { encoding: 'utf8', timeout: 5000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null;
  return r.stdout.split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]), age: seconds(m[4]), cmd: m[5] }));
}

/**
 * → { total, sessions: [{ pid, rss, age, children, mcp, browsers }], orphans: [{ pid, rss, kind, cmd }], docker } (rss 는 KB) | null
 *   세션 = claude 프로세스 중 부모가 claude 가 아닌 것 (팀원 · 하위 claude 는 부모 세션에 더한다)
 *   orphans = 부모가 1(launchd · init)인 브라우저 · MCP 중 MCP 가 띄운 흔적이 있는 것 (자동화 표시 · ms-playwright · chrome-devtools-mcp)
 */
function snapshot(procs = list()) {
  if (!procs) return null;
  const by = new Map(procs.map((p) => [p.pid, p]));
  const kids = new Map();
  for (const p of procs) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const isClaude = (p) => CLAUDE.test(exe(p.cmd)) || /^claude(\s|$)/.test(p.cmd);
  const tree = (pid) => { const out = []; const stack = [...(kids.get(pid) || [])]; while (stack.length) { const c = stack.pop(); out.push(c); stack.push(...(kids.get(c.pid) || [])); } return out; };
  const sessions = procs.filter((p) => isClaude(p) && !(by.get(p.ppid) && isClaude(by.get(p.ppid)))).map((p) => {
    const t = tree(p.pid);
    return { pid: p.pid, age: p.age, rss: p.rss + t.reduce((n, c) => n + c.rss, 0), self: p.rss, children: t.length, mcp: t.filter((c) => MCP.test(c.cmd) && !BROWSER.test(exe(c.cmd))).length, browsers: t.filter((c) => BROWSER.test(exe(c.cmd)) && !/Helper|crashpad/.test(exe(c.cmd))).length };
  });
  const automated = /--remote-debugging|ms-playwright|chrome-devtools-mcp|--enable-automation|puppeteer/;
  const orphans = procs.filter((p) => p.ppid === 1 && ((BROWSER.test(exe(p.cmd)) && automated.test(p.cmd)) || (MCP.test(p.cmd) && /node|npx|python|uvx/.test(p.cmd))))
    .map((p) => ({ pid: p.pid, rss: p.rss + tree(p.pid).reduce((n, c) => n + c.rss, 0), kind: BROWSER.test(exe(p.cmd)) ? 'browser' : 'mcp', age: p.age, cmd: p.cmd.slice(0, 120) }));
  const vm = procs.filter((p) => DOCKER_VM.test(p.cmd));
  return {
    total: sessions.reduce((n, s) => n + s.rss, 0) + orphans.reduce((n, o) => n + o.rss, 0),
    sessions: sessions.sort((a, b) => b.rss - a.rss),
    orphans,
    docker: vm.length ? vm.reduce((n, p) => n + p.rss, 0) : null,
  };
}

const gb = (kb) => `${(kb / GB).toFixed(1)}GB`;
const hours = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}시간` : `${Math.floor(s / 60)}분`);

/** 사람이 읽는 줄들 */
function lines(snap) {
  if (!snap) return ['프로세스 목록을 읽지 못했습니다 (Windows 는 지원하지 않음)'];
  const out = [`Claude Code 합계 ${gb(snap.total)} · 세션 ${snap.sessions.length}개${snap.orphans.length ? ` · 주인 없이 남은 브라우저 · MCP ${snap.orphans.length}개` : ''}${snap.docker !== null ? ` · Docker VM ${gb(snap.docker)} (따로)` : ''}`];
  for (const s of snap.sessions.slice(0, 8)) out.push(`  세션 pid ${s.pid} · ${gb(s.rss)} · ${hours(s.age)} 째 · 하위 프로세스 ${s.children}개 (MCP ${s.mcp} · 브라우저 ${s.browsers})`);
  for (const o of snap.orphans.slice(0, 8)) out.push(`  남은 ${o.kind === 'browser' ? '브라우저' : 'MCP'} pid ${o.pid} · ${gb(o.rss)} · ${hours(o.age)} 째 · 끄기: kill ${o.pid}`);
  return out;
}

module.exports = { list, snapshot, lines, gb, hours, seconds, GB };
