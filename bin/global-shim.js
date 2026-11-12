// Node 버전과 상관없는 kedovi 명령: 고정 위치(~/.local/bin · %LOCALAPPDATA%\kedovi\bin)에 실행 파일을 두고 PATH 에 넣는다.
// nvm 등은 전역 npm 명령을 Node 버전마다 따로 두어, 기본 Node 가 바뀌면 kedovi 이 PATH 에서 빠진다.
// 실행 파일은 이번 kedovi · 지금 node 의 전역 · 다른 Node 버전(nvm · fnm · volta)에 깔린 kedovi 중 버전이 가장 높은 것을 실행한다
// (Windows 는 지금 node 의 전역 → 이번 kedovi → nvm-windows 순). 없으면 npm root -g.
// kedovi 이 실행될 때마다 갱신한다. 전역 설치(node_modules 안)일 때만, KEDOVI_NO_GLOBAL_SHIM=1 이면 하지 않는다.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MARK = '# kedovi: Node 버전과 상관없는 kedovi 명령 (kedovi 이 넣음)';

function shDir(home) { return path.join(home, '.local', 'bin'); }
function winDir(env, home) { return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'kedovi', 'bin'); }

/** sh 실행 파일 본문. kit = 이번 kedovi.js, node = 이번 Node, pkg = 패키지 이름 */
function shBody({ kit, node, pkg }) {
  const mod = `lib/node_modules/${pkg}`;
  return `#!/bin/sh
${MARK}. 직접 고치지 않는다 (kedovi 이 실행될 때마다 다시 쓴다)
K="${kit}"
N="${node}"
# 깔린 kedovi 중 버전이 가장 높은 것 (같으면 이번 kedovi). Node 버전을 바꾼 뒤 npm i -g 로 올리면 새 버전은 그 Node 폴더에 깔린다
P="$(command -v node 2>/dev/null)"
B="$(for d in "\${NVM_DIR:-$HOME/.nvm}"/versions/node/*/${mod} "$HOME"/.local/share/fnm/node-versions/*/installation/${mod} "$HOME"/.volta/tools/image/packages/${pkg}/${mod} "\${P%/bin/node}/${mod}" "\${K%/bin/kedovi.js}"; do
  [ -f "$d/bin/kedovi.js" ] || continue
  v="$(sed -n 's/^ *"version": *"\\([0-9][0-9.]*\\)".*/\\1/p' "$d/package.json" 2>/dev/null | head -n 1)"
  printf '%s\\t%s\\n' "\${v:-0}" "$d"
done | sort -s -t. -k1,1n -k2,2n -k3,3n | tail -n 1 | cut -f2-)"
if [ -n "$B" ] && [ "$B/bin/kedovi.js" != "$K" ]; then
  K="$B/bin/kedovi.js"
  N="\${B%/lib/node_modules/*}/bin/node"
fi
if [ ! -f "$K" ] && command -v npm >/dev/null 2>&1; then
  f="$(npm root -g 2>/dev/null)/${pkg}/bin/kedovi.js"
  [ -f "$f" ] && K="$f" && N=node
fi
[ -x "$N" ] || N="\${K%/lib/node_modules/*}/bin/node"
[ -x "$N" ] || N=node
if [ ! -f "$K" ]; then echo "kedovi 을 찾지 못했습니다. 설치: npm i -g ${pkg}" >&2; exit 127; fi
exec "$N" "$K" "$@"
`;
}

/** Windows .cmd 본문 (nvm-windows 는 NVM_HOME\v<버전>\node_modules) */
function cmdBody({ kit, node, pkg }) {
  const w = pkg.replace(/\//g, '\\');
  return [
    '@echo off',
    'rem kedovi launcher independent of the Node version. Rewritten on every kedovi run, do not edit', // cmd 는 UTF-8 한글이 깨질 수 있어 영문
    'setlocal',
    `set "K=${kit}"`,
    `set "N=${node}"`,
    // 지금 Node(PATH 의 node.exe)에 깔린 kedovi 먼저: Node 버전을 바꾼 뒤 npm i -g 로 올린 새 버전
    `for /f "delims=" %%P in ('where node 2^>nul') do if exist "%%~dpPnode_modules\\${w}\\bin\\kedovi.js" (set "K=%%~dpPnode_modules\\${w}\\bin\\kedovi.js"& set "N=%%P"& goto run)`,
    'if exist "%K%" goto run',
    // nvm-windows: 최근에 만든 Node 버전 폴더부터, kedovi 이 있는 첫 버전
    `if defined NVM_HOME for /f "delims=" %%D in ('dir /b /ad /o-d "%NVM_HOME%\\v*" 2^>nul') do if exist "%NVM_HOME%\\%%D\\node_modules\\${w}\\bin\\kedovi.js" (set "K=%NVM_HOME%\\%%D\\node_modules\\${w}\\bin\\kedovi.js"& set "N=%NVM_HOME%\\%%D\\node.exe"& goto run)`,
    `for /f "delims=" %%R in ('npm root -g 2^>nul') do if exist "%%R\\${w}\\bin\\kedovi.js" (set "K=%%R\\${w}\\bin\\kedovi.js"& set "N=node"& goto run)`,
    ':run',
    'if not exist "%N%" set "N=node"',
    `if not exist "%K%" (echo kedovi not found. Install: npm i -g ${pkg} 1>&2 & exit /b 9009)`,
    '"%N%" "%K%" %*',
    '',
  ].join('\r\n');
}

function writeIfChanged(f, body, mode) {
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8') === body) return false;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  if (mode) fs.chmodSync(f, mode);
  return true;
}

const onPath = (dir, env, win) => String(env.PATH || env.Path || '').split(win ? ';' : ':').some((p) => path.resolve(p || '.').toLowerCase() === path.resolve(dir).toLowerCase());

/** 셸 설정 파일: zsh → .zshrc, bash → .bashrc (+ macOS 로그인 셸 .bash_profile), 그 밖 → .profile */
function rcFiles(env, home, platform) {
  const sh = path.basename(env.SHELL || '');
  if (sh === 'zsh') return [path.join(home, '.zshrc')];
  if (sh === 'bash') return platform === 'darwin' ? [path.join(home, '.bash_profile'), path.join(home, '.bashrc')] : [path.join(home, '.bashrc')];
  if (sh === 'fish') return [];
  return [path.join(home, '.profile')];
}

/**
 * 고정 위치 실행 파일을 쓰고, 그 폴더가 PATH 에 없으면 넣는다.
 * @returns { file, changed, pathAdded: [설정 파일 · 'user PATH'], note } (하지 않았으면 null)
 */
function ensure(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const platform = opts.platform || process.platform;
  const kit = opts.kit;
  if (!kit || env.KEDOVI_NO_GLOBAL_SHIM === '1') return null;
  if (!opts.force && !/[\\/]node_modules[\\/]/.test(kit)) return null; // 킷 repo 에서 직접 실행 · 개발 중이면 건드리지 않는다
  const pkg = opts.pkg || 'kedovi';
  const node = opts.node || process.execPath;
  const win = platform === 'win32';
  const dir = win ? winDir(env, home) : shDir(home);
  const file = path.join(dir, win ? 'kedovi.cmd' : 'kedovi');
  const res = { file, changed: false, pathAdded: [], note: '' };
  try {
    res.changed = writeIfChanged(file, (win ? cmdBody : shBody)({ kit, node, pkg }), win ? 0 : 0o755);
  } catch (e) { return { ...res, note: `실행 파일을 쓰지 못함: ${e.message}` }; }
  if (onPath(dir, env, win)) return res;
  if (win) {
    if (opts.skipUserPath) return res;
    // 사용자 PATH (레지스트리 HKCU\Environment). setx 는 1024자에서 자르므로 PowerShell 로
    const ps = `$d='${dir.replace(/'/g, "''")}';$p=[Environment]::GetEnvironmentVariable('Path','User');if(-not $p){$p=''};if(($p -split ';') -notcontains $d){[Environment]::SetEnvironmentVariable('Path',($(if($p){$p.TrimEnd(';')+';'}else{''})+$d),'User');'added'}`;
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.status === 0 && /added/.test(r.stdout || '')) res.pathAdded.push('사용자 PATH');
    else if (r.status !== 0) res.note = `사용자 PATH 에 넣지 못함. 직접 넣을 폴더: ${dir}`;
    return res;
  }
  const rcs = rcFiles(env, home, platform);
  if (!rcs.length) { res.note = `이 셸 설정은 고치지 않았습니다. PATH 에 넣을 폴더: ${dir}`; return res; }
  const line = `${MARK}\nexport PATH="$HOME/.local/bin:$PATH"\n`;
  for (const rc of rcs) {
    try {
      const cur = fs.existsSync(rc) ? fs.readFileSync(rc, 'utf8') : '';
      if (cur.includes(MARK)) continue;
      fs.appendFileSync(rc, `${cur && !cur.endsWith('\n') ? '\n' : ''}\n${line}`);
      res.pathAdded.push(rc.replace(home, '~'));
    } catch (e) { res.note = `${rc} 에 넣지 못함: ${e.message}`; }
  }
  return res;
}

module.exports = { ensure, shBody, cmdBody, rcFiles, MARK };
