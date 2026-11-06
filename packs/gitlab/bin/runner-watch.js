#!/usr/bin/env node
// CI 러너 감시: 디스크 · 대기열 · 작업 시간 급증 → 알림, 캐시 상한. 사용: kedovi gitlab runner-watch add | check | status
'use strict';

/*
 * add [--repo R] [--dir 폴더] [--interval 초(600)] [--standalone] [--force] [--dry-run]
 *     설정(runner-watch.json) · macOS launchd plist · Linux systemd service/timer 를 만들고 등록 명령을 보인다. 등록은 하지 않는다.
 *     기본 폴더 = ~/.config/kedovi/runner-watch/<프로젝트>/ (이 PC). --repo R 이면 repos/R/ops/runner-watch/ 에 스크립트까지 복사(러너가 다른 머신일 때).
 *     --standalone 은 기본 폴더에도 스크립트를 복사한다. 있는 설정은 --force 없이는 덮지 않는다.
 * check [--config F] [--dry-run] [--json]
 *     한 번 점검: 디스크 사용률 · 대기(pending) 작업 수와 대기 시간 · 작업 시간이 최근 중앙값보다 급증 · 캐시 크기.
 *     새로 생기거나 해소된 것만 알린다 (같은 경보는 notify.repeatMin 분마다 다시). 알림 명령이 실패하면 다음 주기에 다시 보낸다.
 *     docker 빌드 캐시 · 오래된 이미지는 상한을 넘으면 정리한다 (cache.docker.prune). --dry-run 은 알림 · 정리 없이 보이기만.
 * status [--config F]
 *     마지막 점검 시각 · 지금 경보 · 보내지 못한 알림.
 *
 * 토큰: 환경변수(gitlab.tokenEnv, 기본 GITLAB_TOKEN) → 워크스페이스 비밀값 저장소(kedovi secret) → git credential fill. 파일에 쓰지 않는다.
 * 의존성 없음 (Node 18+). 다른 머신에 이 파일과 runner-watch.json 만 옮겨도 돈다.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x.startsWith('--')) {
      const eq = x.indexOf('=');
      if (eq > 0) out[x.slice(2, eq)] = x.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) out[x.slice(2)] = argv[++i];
      else out[x.slice(2)] = true;
    } else out._.push(x);
  }
  return out;
}

const DEFAULTS = {
  disk: { paths: ['/'], maxPct: 85 },
  queue: { maxPending: 5, maxWaitMin: 10 },
  duration: { factor: 2, minSec: 120, samples: 30 },
  cache: { docker: { prune: true, builderKeepGB: 20, imageUntilHours: 168 }, dirs: [], maxGB: 30, clean: false },
  notify: { repeatMin: 180 },
};

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  return out;
}

function configDir() { return process.env.KEDOVI_CONFIG_DIR || path.join(os.homedir(), '.config', 'kedovi'); }

// ── 점검 ───────────────────────────────────────────────────────────

function token(cfg) {
  const envName = (cfg.gitlab && cfg.gitlab.tokenEnv) || 'GITLAB_TOKEN';
  if (process.env[envName]) return process.env[envName];
  if (cfg.workspace) {
    try { const g = require(path.join(cfg.workspace, 'packs', 'core', 'lib', 'secrets.js')).get('GITLAB_TOKEN', { root: cfg.workspace }); if (g) return g.value; } catch { /* 저장소 없음 */ }
  }
  try {
    const out = execFileSync('git', ['credential', 'fill'], { input: `protocol=https\nhost=${cfg.gitlab.host}\n\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    const m = out.match(/^password=(.*)$/m);
    if (m) return m[1];
  } catch { /* 자격증명 없음 */ }
  return null;
}

async function api(cfg, tok, p) {
  const base = cfg.gitlab.apiBase || `https://${cfg.gitlab.host}/api/v4`;
  const res = await fetch(`${base}${p}`, { headers: { 'PRIVATE-TOKEN': tok } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${p.split('?')[0]}`);
  return res.json();
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const mins = (sec) => (sec < 90 ? `${Math.round(sec)}초` : `${Math.round(sec / 60)}분`);

function diskAlerts(cfg, opt) {
  const out = [];
  for (const p of cfg.disk.paths || []) {
    let text = opt.df && opt.df[p];
    if (text === undefined) { try { text = execFileSync('df', ['-kP', p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { out.push({ key: `disk:${p}`, text: `디스크 ${p}: df 실패` }); continue; } }
    const row = String(text).trim().split('\n').pop().split(/\s+/);
    const pct = Number(String(row[4] || '').replace('%', ''));
    if (pct >= cfg.disk.maxPct) out.push({ key: `disk:${p}`, text: `디스크 ${p} ${pct}% (상한 ${cfg.disk.maxPct}%, 남은 ${Math.round(Number(row[3]) / 1048576)}GB)` });
  }
  return out;
}

async function ciAlerts(cfg, tok, now) {
  const out = [];
  for (const pid of cfg.gitlab.projects || []) {
    // 대기열: pending 작업 수 · 가장 오래 기다린 시간
    const pending = await api(cfg, tok, `/projects/${encodeURIComponent(pid)}/jobs?scope[]=pending&per_page=100`);
    const oldest = pending.reduce((m, j) => Math.min(m, new Date(j.created_at).getTime()), now);
    const waitSec = (now - oldest) / 1000;
    if (pending.length >= cfg.queue.maxPending || (pending.length && waitSec >= cfg.queue.maxWaitMin * 60)) {
      out.push({ key: `queue:${pid}`, text: `대기열 project ${pid}: pending ${pending.length}개 · 가장 오래 ${mins(waitSec)} (상한 ${cfg.queue.maxPending}개 · ${cfg.queue.maxWaitMin}분)` });
    }
    // 작업 시간: 이름별 최근 성공 작업의 중앙값 대비
    const done = await api(cfg, tok, `/projects/${encodeURIComponent(pid)}/jobs?scope[]=success&per_page=100`);
    const byName = {};
    for (const j of done) if (j.duration) (byName[j.name] = byName[j.name] || []).push(j);
    const { factor, minSec, samples } = cfg.duration;
    for (const [name, list] of Object.entries(byName)) {
      list.sort((x, y) => y.id - x.id);
      if (list.length < 5) continue;
      const [latest, ...rest] = list.slice(0, samples);
      const med = median(rest.map((j) => j.duration));
      if (latest.duration >= med * factor && latest.duration - med >= minSec) out.push({ key: `dur:${pid}:${name}:${latest.id}`, text: `작업 시간 급증 project ${pid} ${name}: ${mins(latest.duration)} (최근 중앙값 ${mins(med)}) ${latest.web_url || ''}`.trim() });
    }
    const running = await api(cfg, tok, `/projects/${encodeURIComponent(pid)}/jobs?scope[]=running&per_page=100`);
    for (const j of running) {
      const list = byName[j.name];
      if (!list || list.length < 5 || !j.started_at) continue;
      const med = median(list.slice(0, samples).map((x) => x.duration));
      const el = (now - new Date(j.started_at).getTime()) / 1000;
      if (el >= med * factor && el - med >= minSec) out.push({ key: `slow:${pid}:${j.id}`, text: `작업이 오래 돈다 project ${pid} ${j.name}: ${mins(el)}째 (최근 중앙값 ${mins(med)}) ${j.web_url || ''}`.trim() });
    }
  }
  return out;
}

const GB = 1024 ** 3;
function sizeOf(s) { const m = /([\d.]+)\s*([kMGT]?)B/i.exec(String(s)); if (!m) return 0; return Number(m[1]) * ({ '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2]] || 1); }

function dirSize(d) {
  try { return Number(execFileSync('du', ['-sk', d], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\s+/)[0]) * 1024; } catch { return 0; }
}

/** 캐시 상한: docker 빌드 캐시 · 오래된 이미지 정리, 러너 캐시 폴더 크기 → { alerts, actions } */
function cacheCheck(cfg, dry, opt = {}) {
  const alerts = [];
  const actions = [];
  const dk = cfg.cache.docker || {};
  const docker = opt.docker || ((args) => spawnSync('docker', args, { encoding: 'utf8', timeout: 600000 }));
  if (dk.prune) {
    const df = docker(['system', 'df', '--format', '{{json .}}']);
    if (df.status === 0) {
      const rows = String(df.stdout).trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
      const build = rows.find((x) => /build cache/i.test(x.Type || ''));
      const bsize = build ? sizeOf(build.Size) : 0;
      if (bsize > dk.builderKeepGB * 1e9) {
        if (dry) actions.push(`(dry-run) docker 빌드 캐시 ${(bsize / 1e9).toFixed(1)}GB → ${dk.builderKeepGB}GB 로 정리할 것`);
        else {
          // 새 docker 는 --max-used-space, 옛 docker 는 --keep-storage
          let r = docker(['builder', 'prune', '-f', '--max-used-space', `${dk.builderKeepGB}gb`]);
          if (r.status !== 0) r = docker(['builder', 'prune', '-f', '--keep-storage', `${dk.builderKeepGB}gb`]);
          actions.push(r.status === 0 ? `docker 빌드 캐시 ${(bsize / 1e9).toFixed(1)}GB → ${dk.builderKeepGB}GB 로 정리` : `docker 빌드 캐시 정리 실패: ${String(r.stderr || '').trim().slice(0, 120)}`);
        }
      }
      const img = rows.find((x) => /^images$/i.test(x.Type || ''));
      if (img && sizeOf(img.Reclaimable) > dk.builderKeepGB * 1e9) {
        if (dry) actions.push(`(dry-run) 안 쓰는 이미지 중 ${dk.imageUntilHours}시간 지난 것 정리할 것 (회수 가능 ${img.Reclaimable})`);
        else {
          const r = docker(['image', 'prune', '-af', '--filter', `until=${dk.imageUntilHours}h`]);
          actions.push(r.status === 0 ? `안 쓰는 이미지 정리 (${dk.imageUntilHours}시간 지난 것)` : `이미지 정리 실패: ${String(r.stderr || '').trim().slice(0, 120)}`);
        }
      }
    }
  }
  const dirs = (cfg.cache.dirs || []).filter((d) => fs.existsSync(d));
  if (dirs.length) {
    const size = opt.dirSize || dirSize;
    let total = dirs.reduce((s, d) => s + size(d), 0);
    const cap = cfg.cache.maxGB * GB;
    if (total > cap && cfg.cache.clean && !dry) {
      // 오래된 항목부터 지운다 (폴더 바로 아래 항목 단위)
      const items = dirs.flatMap((d) => fs.readdirSync(d).map((n) => { const p = path.join(d, n); let t = 0; try { t = fs.statSync(p).mtimeMs; } catch { /* 사라짐 */ } return { p, t }; })).sort((x, y) => x.t - y.t);
      let removed = 0;
      for (const it of items) {
        if (total <= cap) break;
        const s = size(it.p);
        try { fs.rmSync(it.p, { recursive: true, force: true }); total -= s; removed += 1; } catch { /* 쓰는 중 */ }
      }
      actions.push(`러너 캐시 폴더에서 오래된 항목 ${removed}개 지움 → ${(total / GB).toFixed(1)}GB`);
    }
    if (total > cap) alerts.push({ key: 'cache:dirs', text: `러너 캐시 폴더 ${(total / GB).toFixed(1)}GB (상한 ${cfg.cache.maxGB}GB${cfg.cache.clean ? '' : ', 자동 정리 꺼짐: cache.clean'})` });
  }
  return { alerts, actions };
}

function loadCfg(file) {
  if (!file || !fs.existsSync(file)) throw new Error(`설정이 없습니다: ${file}. 만들기: kedovi gitlab runner-watch add`);
  return merge(DEFAULTS, JSON.parse(fs.readFileSync(file, 'utf8')));
}
function stateFile(file) { return file.replace(/\.json$/, '') + '.state.json'; }
function readState(file) { try { return JSON.parse(fs.readFileSync(stateFile(file), 'utf8')); } catch { return { alerts: {}, pending: [] }; } }

async function check(a) {
  const file = path.resolve(a.config && a.config !== true ? a.config : path.join(__dirname, 'runner-watch.json'));
  const cfg = loadCfg(file);
  const dry = !!a['dry-run'];
  const now = Date.now();
  const state = readState(file);
  state.alerts = state.alerts || {};
  state.pending = state.pending || [];
  let alerts = diskAlerts(cfg, {});
  const tok = cfg.gitlab && cfg.gitlab.host ? token(cfg) : null;
  if (cfg.gitlab && (cfg.gitlab.projects || []).length) {
    if (!tok) alerts.push({ key: 'token', text: `GitLab 토큰이 없어 대기열 · 작업 시간을 보지 못함 (${cfg.gitlab.tokenEnv || 'GITLAB_TOKEN'} · kedovi secret set GITLAB_TOKEN · git credential)` });
    else {
      try { alerts = alerts.concat(await ciAlerts(cfg, tok, now)); } catch (e) { alerts.push({ key: 'api', text: `GitLab API 실패: ${e.message}` }); }
    }
  }
  const cache = cacheCheck(cfg, dry);
  alerts = alerts.concat(cache.alerts);

  // 새 경보 · 다시 알릴 경보 · 해소
  const repeat = Math.max(10, Number(cfg.notify.repeatMin) || 180) * 60000;
  const lines = [];
  const active = {};
  for (const al of alerts) {
    const prev = state.alerts[al.key];
    active[al.key] = { text: al.text, first: prev ? prev.first : now, lastSent: prev ? prev.lastSent : 0 };
    if (!prev) lines.push(`- ⚠ ${al.text}`);
    else if (now - prev.lastSent >= repeat) lines.push(`- ⚠ 계속: ${al.text}`);
  }
  for (const [k, prev] of Object.entries(state.alerts)) if (!active[k] && !/^(dur|slow):/.test(k)) lines.push(`- ✔ 해소: ${prev.text}`);
  cache.actions.forEach((x) => lines.push(`- 🧹 ${x}`));
  const msg = lines.length ? `## 러너 감시 ${cfg.name || ''}\n${lines.join('\n')}\n` : '';
  const outbox = [...state.pending, ...(msg ? [msg] : [])];

  let sent = false;
  let sendErr = '';
  if (outbox.length && !dry) {
    const cmd = (cfg.notify && cfg.notify.cmd) || (cfg.workspace ? [process.execPath, path.join(cfg.workspace, 'packs', 'core', 'bin', 'notify.js'), 'say'] : null);
    if (!cmd) sendErr = 'notify.cmd 가 없음';
    else {
      const r = spawnSync(cmd[0], cmd.slice(1), { input: outbox.join('\n'), encoding: 'utf8', cwd: cfg.workspace || process.cwd(), timeout: 60000 });
      sent = r.status === 0;
      if (!sent) sendErr = `알림 명령 끝 코드 ${r.status == null ? '시간 초과' : r.status}: ${String(r.stderr || r.stdout || '').trim().split('\n').pop() || ''}`.trim();
    }
  }
  if (!dry) {
    if (outbox.length) {
      // 보냈거나 보낼 줄에 넣은 경보는 알린 것으로 (실패분은 pending 이 다음 주기에 다시 보낸다: 같은 경보가 두 번 쌓이지 않게)
      for (const k of Object.keys(active)) if (lines.some((l) => l.includes(active[k].text))) active[k].lastSent = now;
      state.pending = sent ? [] : outbox.slice(-5);
    }
    state.alerts = active;
    state.lastRun = new Date(now).toISOString();
    state.lastError = sendErr || null;
    fs.writeFileSync(stateFile(file), JSON.stringify(state, null, 2));
  }
  const stamp = new Date(now).toISOString();
  if (a.json) console.log(JSON.stringify({ at: stamp, alerts, actions: cache.actions, message: msg, sent, pending: dry ? outbox.length : state.pending.length, error: sendErr || null }));
  else {
    console.log(`${stamp} 러너 감시 ${cfg.name || ''}: 경보 ${alerts.length}개${dry ? ' (dry-run: 알림 · 정리 안 함)' : ''}`);
    if (msg) console.log(msg.trim());
    if (outbox.length && !dry) console.log(sent ? `알림 보냄 (${outbox.length}건)` : `✖ 알림 실패, 다음 주기에 다시: ${sendErr}`);
  }
}

function status(a) {
  const file = path.resolve(a.config && a.config !== true ? a.config : path.join(__dirname, 'runner-watch.json'));
  const st = readState(file);
  console.log(`설정: ${file}`);
  console.log(`마지막 점검: ${st.lastRun || '아직 없음'}${st.lastError ? ` · 마지막 알림 실패: ${st.lastError}` : ''}`);
  const al = Object.values(st.alerts || {});
  console.log(`지금 경보 ${al.length}개${al.length ? `:\n${al.map((x) => `  ⚠ ${x.text}`).join('\n')}` : ''}`);
  console.log(`보내지 못한 알림 ${(st.pending || []).length}건`);
}

// ── 설치 파일 ──────────────────────────────────────────────────────

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function plist({ label, node, script, cfgFile, interval, log }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(script)}</string>
    <string>check</string>
    <string>--config</string>
    <string>${xml(cfgFile)}</string>
  </array>
  <key>StartInterval</key><integer>${interval}</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`;
}

function systemd({ name, node, script, cfgFile, interval }) {
  return {
    service: `[Unit]
Description=kedovi 러너 감시 (${name})

[Service]
Type=oneshot
ExecStart=${node} ${script} check --config ${cfgFile}
`,
    timer: `[Unit]
Description=kedovi 러너 감시 주기 (${name})

[Timer]
OnBootSec=2min
OnUnitActiveSec=${interval}
Unit=kedovi-runner-watch-${name}.service

[Install]
WantedBy=timers.target
`,
  };
}

function add(a) {
  const M = require('./gitlab-mr.js');
  const ws = M.loadWs();
  const name = String(((ws.project && ws.project.name) || path.basename(ws.root))).replace(/[^\w.-]+/g, '-');
  const target = a.repo && a.repo !== true ? M.repoOf(ws, a.repo) : null;
  const dir = path.resolve(a.dir && a.dir !== true ? a.dir : target ? path.join(target.dir, 'ops', 'runner-watch') : path.join(configDir(), 'runner-watch', name));
  const standalone = !!(a.standalone || target);
  const interval = Math.max(60, Number(a.interval) || 600);
  const repos = ws.repos.filter((x) => x.gitlab && x.gitlab.host && x.gitlab.projectId !== undefined);
  if (!repos.length) M.die('gitlab 설정이 있는 repo 가 없습니다. workspace.json repos[].gitlab = {host, projectId}');
  const host = (target && target.gitlab ? target : repos[0]).gitlab;
  const sameHost = repos.filter((x) => x.gitlab.host === host.host);
  const node = process.execPath;
  const script = standalone ? path.join(dir, 'runner-watch.js') : __filename;
  const cfgFile = path.join(dir, 'runner-watch.json');
  const label = `com.kedovi.runner-watch.${name}`;
  const cfg = {
    name,
    workspace: target ? undefined : ws.root,
    gitlab: { host: host.host, ...(host.apiBase ? { apiBase: host.apiBase } : {}), projects: sameHost.map((x) => x.gitlab.projectId), tokenEnv: M.vars(ws).tokenEnv || 'GITLAB_TOKEN' },
    ...DEFAULTS,
    notify: { ...DEFAULTS.notify, cmd: target ? ['node', '<워크스페이스>/packs/core/bin/notify.js', 'say'] : [node, path.join(ws.root, 'packs', 'core', 'bin', 'notify.js'), 'say'] },
  };
  const sd = systemd({ name, node, script, cfgFile, interval });
  const files = [
    [cfgFile, `${JSON.stringify(cfg, null, 2)}\n`, true],
    [path.join(dir, `${label}.plist`), plist({ label, node, script, cfgFile, interval, log: path.join(dir, 'runner-watch.log') })],
    [path.join(dir, `kedovi-runner-watch-${name}.service`), sd.service],
    [path.join(dir, `kedovi-runner-watch-${name}.timer`), sd.timer],
    ...(standalone ? [[script, fs.readFileSync(__filename, 'utf8')]] : []),
  ];
  console.log(`러너 감시: ${name} · ${host.host} project ${cfg.gitlab.projects.join(', ')} · ${interval}초마다`);
  console.log(`폴더: ${dir}${standalone ? ' (스크립트 복사: 다른 머신으로 옮겨도 돈다)' : ''}`);
  for (const [f, body, keep] of files) {
    const exists = fs.existsSync(f);
    if (keep && exists && !a.force) { console.log(`  = ${path.basename(f)} (있음: 그대로. 새 기본값은 --force)`); continue; }
    if (a['dry-run']) { console.log(`  [dry-run] ${exists ? '고침' : '만듦'} ${path.basename(f)}`); continue; }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, body);
    console.log(`  ✔ ${exists ? '고침' : '만듦'} ${path.basename(f)}`);
  }
  const plistDst = `~/Library/LaunchAgents/${label}.plist`;
  console.log('\n등록 (러너가 도는 머신에서, 사람이 직접):');
  console.log(`  macOS : cp "${path.join(dir, `${label}.plist`)}" ${plistDst} && launchctl bootstrap gui/$(id -u) ${plistDst}`);
  console.log(`          끄기: launchctl bootout gui/$(id -u)/${label}`);
  console.log(`  Linux : cp "${dir}"/kedovi-runner-watch-${name}.{service,timer} ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now kedovi-runner-watch-${name}.timer`);
  console.log(`          끄기: systemctl --user disable --now kedovi-runner-watch-${name}.timer`);
  console.log(`  한 번 시험: node "${script}" check --config "${cfgFile}" --dry-run`);
  console.log('  상한(디스크 % · 대기열 · 급증 배수 · 캐시 GB · 정리 여부)은 runner-watch.json 에서 고친다. 토큰은 파일에 넣지 않는다 (환경변수 · kedovi secret · git credential)');
  if (target) console.log('  다른 머신이면 runner-watch.json 의 notify.cmd 를 그 머신의 알림 명령으로 고친다 (실패 코드면 다음 주기에 다시 보낸다)');
}

async function main(argv) {
  const a = parseArgs(argv);
  const sub = a._[0];
  if (sub === 'add') return add(a);
  if (sub === 'check') return check(a);
  if (sub === 'status') return status(a);
  const lines = fs.readFileSync(__filename, 'utf8').split('\n');
  const from = lines.indexOf('/*') + 1;
  console.log(lines.slice(from, lines.findIndex((l, i) => i > from && l.startsWith(' * 토큰:'))).map((l) => l.replace(/^ \* ?/, '')).join('\n').trim());
  process.exit(sub ? 1 : 0);
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(`✖ ${e.message}`); process.exit(1); });

module.exports = { main, check, cacheCheck, diskAlerts, ciAlerts, median, plist, systemd, DEFAULTS };
