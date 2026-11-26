// 차례 끝 변경 보고 · IDE diff (훅 ide-diff.js · kedovi prefs ide).
/*
 * 설정 (이 PC .agents/local.json → 팀 workspace.json → 기본값), 키 ide:
 *   open   off | auto | intellij | vscode | cursor   (기본 off: 팀 기본값도 끔)
 *   max    한 차례에 띄울 파일 수 (기본 5, 1~20). 넘는 파일은 보고 표에만
 *   report on | off   차례 끝에 repo · 브랜치 · 커밋 · 푸시 · 바뀐 파일 표를 사용자 화면에 띄움 (기본 on)
 * 차례 = 사용자 요청 하나. 요청 때(UserPromptSubmit) 각 repo 의 HEAD 와 고친 중이던 파일 내용을 적어 두고,
 * 멈출 때(Stop) 그때와 달라진 파일만 본다. diff 의 원본 = 이번 차례 시작 때 내용 (커밋을 했어도 이번 차례 변경만 보인다).
 * 의존성 없음.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, spawn } = require('child_process');

const OPENERS = ['off', 'auto', 'intellij', 'vscode', 'cursor'];
const DEFAULTS = { open: 'off', max: 5, report: 'on' };
const MAX_SNAP_FILE = 1024 * 1024;
const MAX_SNAP_FILES = 300;
// 생성물 · 잠금파일: 띄우지 않고 표에서도 센다만
const GENERATED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|gradle\.lockfile)$|(^|\/)(node_modules|dist|build|out|target|coverage|\.next|\.nuxt|\.turbo|\.gradle|__pycache__)\/|\.min\.(js|css)$|\.map$|\.(pyc|class|o|so|dll|exe)$/;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };

/** 적용 값과 출처 { open, max, report, from: {…}, team: {…}, local: {…} } */
function resolve(root, ws, local) {
  const t = ((ws || readJson(path.join(root, 'workspace.json'))).ide) || {};
  const l = ((local || readJson(path.join(root, '.agents', 'local.json'))).ide) || {};
  const valid = { open: (v) => OPENERS.includes(v), max: (v) => Number.isInteger(v) && v >= 1 && v <= 20, report: (v) => v === 'on' || v === 'off' };
  const out = { from: {}, team: {}, local: {} };
  for (const k of Object.keys(DEFAULTS)) {
    if (valid[k](t[k])) out.team[k] = t[k];
    if (valid[k](l[k])) out.local[k] = l[k];
    out[k] = k in out.local ? out.local[k] : k in out.team ? out.team[k] : DEFAULTS[k];
    out.from[k] = k in out.local ? 'local' : k in out.team ? 'team' : 'default';
  }
  return out;
}

function git(dir, args, opts = {}) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: opts.buffer ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 });
  return r.status === 0 ? r.stdout : null;
}

/** 지금 고친 중(추적 파일 수정 · 새 파일)인 경로 목록 */
function dirtyFiles(dir) {
  const out = git(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (out == null) return [];
  const parts = out.split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i += 1) {
    const e = parts[i];
    if (!e) continue;
    const st = e.slice(0, 2);
    files.push({ st, file: e.slice(3) });
    if (/[RC]/.test(st)) i += 1; // 옮긴 파일은 옛 이름이 한 칸 더 온다
  }
  return files;
}

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

/** 요청 때: repo 마다 HEAD · 고친 중이던 파일 내용 사본 */
function snapshot(repos, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const meta = {};
  let copied = 0;
  for (const r of repos) {
    if (!fs.existsSync(path.join(r.dir, '.git'))) continue;
    const head = (git(r.dir, ['rev-parse', 'HEAD']) || '').trim() || null;
    const dirty = {};
    for (const { file } of dirtyFiles(r.dir)) {
      const abs = path.join(r.dir, file);
      let st;
      try { st = fs.statSync(abs); } catch { dirty[file] = { gone: true }; continue; }
      if (!st.isFile()) continue;
      if (st.size > MAX_SNAP_FILE || copied >= MAX_SNAP_FILES) { dirty[file] = { big: true }; continue; }
      const to = path.join(dir, 'base', safe(r.name), file);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(abs, to);
      copied += 1;
      dirty[file] = { copy: to };
    }
    meta[r.name] = { dir: r.dir, head, dirty };
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ at: new Date().toISOString(), repos: meta }));
}

/** 이번 차례 시작 때 그 파일 내용 (Buffer, 없던 파일이면 null, 알 수 없으면 undefined) */
function beforeOf(m, file) {
  const d = m.dirty[file];
  if (d) {
    if (d.gone) return null;
    if (d.big) return undefined;
    try { return fs.readFileSync(d.copy); } catch { return undefined; }
  }
  if (!m.head) return null;
  const b = git(m.dir, ['show', `${m.head}:${file}`], { buffer: true });
  return b == null ? null : b;
}

/** 멈출 때: repo 마다 이번 차례에 바뀐 파일 · 브랜치 · 커밋 · 푸시 상태 */
function changes(dir) {
  const meta = readJson(path.join(dir, 'meta.json'));
  const out = [];
  for (const [name, m] of Object.entries(meta.repos || {})) {
    const head = (git(m.dir, ['rev-parse', 'HEAD']) || '').trim() || null;
    const cand = new Set();
    if (m.head && head && head !== m.head) (git(m.dir, ['diff', '--name-only', '-z', m.head, head]) || '').split('\0').filter(Boolean).forEach((f) => cand.add(f));
    dirtyFiles(m.dir).forEach(({ file }) => cand.add(file));
    Object.keys(m.dirty || {}).forEach((f) => cand.add(f)); // 고친 중이던 것을 되돌렸으면 그것도 바뀜
    const files = [];
    for (const file of cand) {
      const abs = path.join(m.dir, file);
      let now = null;
      try { if (fs.statSync(abs).isFile()) now = fs.readFileSync(abs); } catch { now = null; }
      const before = beforeOf(m, file);
      if (before === undefined) { if (now) files.push({ file, kind: 'mod', before: undefined, abs }); continue; }
      if (before == null && now == null) continue;
      if (before && now && Buffer.compare(before, now) === 0) continue;
      const kind = before == null ? 'new' : now == null ? 'del' : 'mod';
      let mtime = 0;
      try { mtime = fs.statSync(abs).mtimeMs; } catch { /* 지움 */ }
      files.push({ file, kind, before, abs, mtime, generated: GENERATED.test(file) });
    }
    if (!files.length) continue;
    const commits = m.head && head && head !== m.head ? Number((git(m.dir, ['rev-list', '--count', `${m.head}..${head}`]) || '0').trim()) || 0 : 0;
    const uncommitted = new Set(dirtyFiles(m.dir).map((x) => x.file));
    const branch = (git(m.dir, ['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim() || '-';
    const up = git(m.dir, ['rev-list', '--count', '@{u}..HEAD']);
    out.push({ name, dir: m.dir, branch, commits, uncommitted: files.filter((f) => uncommitted.has(f.file)).length, ahead: up == null ? null : Number(up.trim()) || 0, files: files.sort((a, b) => (b.mtime || 0) - (a.mtime || 0)) });
  }
  return out;
}

const KIND = { mod: '수정', new: '새 파일', del: '삭제' };

/** 사용자 화면에 띄울 표 (글자 표, 터미널 그대로) */
function reportText(list, { opened = [], skipped = '' } = {}) {
  if (!list.length) return '';
  const rows = list.map((r) => {
    const commit = `${r.commits ? `커밋 ${r.commits}개` : '커밋 없음'}${r.uncommitted ? ` · 커밋 안 한 파일 ${r.uncommitted}개` : ''}`;
    const push = r.ahead == null ? '원격 브랜치 없음' : r.ahead ? `푸시 안 한 커밋 ${r.ahead}개` : '푸시됨';
    const names = r.files.slice(0, 3).map((f) => `${f.file}(${KIND[f.kind]})`).join(', ') + (r.files.length > 3 ? ` 외 ${r.files.length - 3}개` : '');
    return `• ${r.name} · ${r.branch} · ${commit} · ${push}\n    ${names}`;
  });
  const tail = opened.length ? `\nIDE 에 띄움: ${opened.length}개${skipped ? ` (${skipped})` : ''}` : skipped ? `\nIDE: ${skipped}` : '';
  return `이번 차례에 바뀐 repo ${list.length}개 (repo · 브랜치 · 커밋 · 푸시)\n${rows.join('\n')}${tail}`;
}

/** IDE 를 띄울 수 없는 환경 (원격 · 컨테이너 · 화면 없음) 이면 그 이유 */
function noGui(env = process.env) {
  if (env.KEDOVI_IDE_DRY) return '';
  if (env.SSH_CONNECTION || env.SSH_TTY) return '원격(SSH) 세션';
  if (env.CODESPACES || env.REMOTE_CONTAINERS || fs.existsSync('/.dockerenv')) return '컨테이너';
  if (process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return '화면 없음';
  return '';
}

const which = (cmd) => {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
};

/** macOS 앱 찾기: 이름 정규식에 맞는 .app (Applications · 사용자 Applications · JetBrains Toolbox) */
function macApps(re) {
  const dirs = ['/Applications', path.join(os.homedir(), 'Applications'), path.join(os.homedir(), 'Applications', 'JetBrains Toolbox')];
  const out = [];
  for (const d of dirs) { try { for (const n of fs.readdirSync(d)) if (n.endsWith('.app') && re.test(n)) out.push(path.join(d, n)); } catch { /* 없음 */ } }
  return out;
}

const IDES = {
  intellij: { app: /^IntelliJ IDEA.*\.app$/, bin: 'Contents/MacOS/idea', cmd: 'idea' },
  vscode: { app: /^Visual Studio Code.*\.app$/, bin: 'Contents/Resources/app/bin/code', cmd: 'code' },
  cursor: { app: /^Cursor\.app$/, bin: 'Contents/Resources/app/bin/cursor', cmd: 'cursor' },
};

/**
 * 띄울 IDE 하나 { kind, exe, app } . want = auto 면 실행 중 → 설치된 앱 → PATH 순.
 * IntelliJ 는 앱 안 실행 파일로 넘긴다 (open -na 로 열면 이미 떠 있을 때 두 번째 프로젝트가 무시된다)
 */
function findIde(want, env = process.env) {
  if (env.KEDOVI_IDE_DRY) return { kind: want === 'auto' ? 'vscode' : want, exe: want === 'auto' ? 'code' : IDES[want].cmd, app: null };
  const kinds = want === 'auto' ? Object.keys(IDES) : [want];
  const mac = process.platform === 'darwin';
  const pick = (kind, appPath) => ({ kind, exe: appPath ? path.join(appPath, IDES[kind].bin) : which(IDES[kind].cmd), app: appPath ? path.basename(appPath, '.app') : null });
  if (mac) {
    let ps = '';
    try { ps = spawnSync('ps', ['-axo', 'command'], { encoding: 'utf8', timeout: 3000 }).stdout || ''; } catch { ps = ''; }
    const apps = ps.split('\n').map((l) => l.match(/^(\/.*?\/([^/]+\.app))\/Contents\/MacOS\//)).filter(Boolean);
    for (const k of kinds) {
      const m = apps.find((x) => IDES[k].app.test(x[2]) && fs.existsSync(path.join(x[1], IDES[k].bin)));
      if (m) return pick(k, m[1]);
    }
    for (const k of kinds) { const a = macApps(IDES[k].app).find((x) => fs.existsSync(path.join(x, IDES[k].bin))); if (a) return pick(k, a); }
  }
  for (const k of kinds) { const p = which(IDES[k].cmd); if (p) return { kind: k, exe: p, app: null }; }
  return null;
}

/** 실행 (기다리지 않음). KEDOVI_IDE_DRY=<파일> 이면 실행 대신 그 파일에 한 줄씩 적는다 (시험) */
function launch(exe, args, env = process.env) {
  if (env.KEDOVI_IDE_DRY) { fs.appendFileSync(env.KEDOVI_IDE_DRY, `${JSON.stringify([exe, ...args])}\n`); return; }
  try { const c = spawn(exe, args, { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); } catch { /* 못 띄움 */ }
}

/** 하루 지난 diff 원본 임시 폴더 지우기 */
function cleanTmp(tmpRoot) {
  try {
    for (const n of fs.readdirSync(tmpRoot)) {
      const p = path.join(tmpRoot, n);
      if (Date.now() - fs.statSync(p).mtimeMs > 24 * 3600 * 1000) fs.rmSync(p, { recursive: true, force: true });
    }
  } catch { /* 없음 */ }
}

/**
 * IDE 에 띄우기: 수정 = diff(이번 차례 시작 때 ↔ 지금), 새 파일 = 열기, 삭제 · 생성물 = 표에만. 같은 내용은 다시 띄우지 않는다(seen).
 * 반환 { opened: [파일], skipped: '이유' }
 */
function openInIde(list, prefs, { tmpRoot, seen = {}, env = process.env } = {}) {
  if (prefs.open === 'off') return { opened: [], skipped: '' };
  const why = noGui(env);
  if (why) return { opened: [], skipped: `${why}이라 띄우지 않음` };
  const ide = findIde(prefs.open, env);
  if (!ide || !ide.exe) return { opened: [], skipped: `${prefs.open === 'auto' ? 'IDE' : prefs.open} 를 찾지 못함` };
  const crypto = require('crypto');
  const all = [];
  for (const r of list) for (const f of r.files) if (f.kind !== 'del' && !f.generated) all.push({ r, f });
  all.sort((a, b) => (b.f.mtime || 0) - (a.f.mtime || 0));
  const todo = [];
  for (const x of all) {
    let h = '';
    try { h = crypto.createHash('sha1').update(fs.readFileSync(x.f.abs)).digest('hex'); } catch { continue; }
    const key = `${x.r.name}:${x.f.file}`;
    if (seen[key] === h) continue;
    x.hash = h; x.key = key;
    todo.push(x);
  }
  const show = todo.slice(0, prefs.max);
  if (!show.length) return { opened: [], skipped: all.length ? '이미 띄운 내용' : '' };
  cleanTmp(tmpRoot);
  const stamp = path.join(tmpRoot, String(Date.now()));
  for (const { r, f, key, hash } of show) {
    if (f.kind === 'mod' && f.before) {
      const orig = path.join(stamp, safe(r.name), path.dirname(f.file), `이번 차례 전 · ${path.basename(f.file)}`);
      fs.mkdirSync(path.dirname(orig), { recursive: true });
      fs.writeFileSync(orig, f.before);
      launch(ide.exe, ide.kind === 'intellij' ? ['diff', orig, f.abs] : ['--diff', orig, f.abs], env);
    } else {
      launch(ide.exe, ide.kind === 'intellij' ? [r.dir, f.abs] : [f.abs], env);
    }
    seen[key] = hash;
  }
  if (process.platform === 'darwin' && ide.app) launch('osascript', ['-e', `tell application "${ide.app.replace(/"/g, '')}" to activate`], env);
  const more = todo.length - show.length;
  return { opened: show.map((x) => `${x.r.name}/${x.f.file}`), skipped: more > 0 ? `나머지 ${more}개는 표에만, 한 번에 ${prefs.max}개` : '' };
}

module.exports = { OPENERS, DEFAULTS, GENERATED, resolve, snapshot, changes, reportText, noGui, findIde, openInIde, dirtyFiles };
