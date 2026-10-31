#!/usr/bin/env node
// 팀원 git 안전장치 (Claude Code · Codex PreToolUse Bash): 팀원 · 서브에이전트 · 위임 세션은 워크스페이스 루트 repo 에 git 쓰기를 하지 않고, push 는 어디서도 하지 않는다 (리더만).
// 명령을 나눠 cd 를 따라가며 실제로 git 이 도는 위치를 본다. cd 대상이 없으면(실패하면 그 자리에서 다음 명령이 돈다) 위치가 바뀌지 않은 것으로, $변수 · `명령` 이면 위치를 모르는 것으로 본다.
// bash x.sh · sh x.sh · ./x.sh 로 부르는 스크립트와 bash -c "…" 의 내용도 같은 방법으로 본다 (python · make 안의 git 은 못 본다).
// cd 뒤에 && · || exit · set -e 없이 이어지는 git 쓰기도 막는다 (git -C <절대경로> 로). 리더 세션은 막지 않고 경고(additionalContext)만, push 는 리더 몫이라 조용. 막을 때만 deny JSON, 예외는 삼키고 항상 exit 0
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokens } = require('./repo-guard');

// 루트 repo 에서 막는 git 하위 명령 (작업 트리 · 브랜치 · 원격을 바꾸는 것). status · log · diff · show · fetch 같은 읽기는 통과
const ROOT_WRITE = new Set(['commit', 'push', 'add', 'rm', 'mv', 'reset', 'restore', 'checkout', 'switch', 'merge', 'rebase', 'cherry-pick', 'revert', 'apply', 'am', 'tag', 'clean', 'stash', 'pull', 'branch', 'worktree', 'update-ref', 'filter-branch', 'gc', 'prune']);
// 읽기로만 쓰이는 형태 (branch 목록 · stash 목록 · tag 목록)
const READ_FORM = { branch: (a) => !a.some((x) => /^-[dDmMcC]$|^--(delete|move|copy|force|set-upstream-to|unset-upstream)/.test(x)) && !a.some((x) => !x.startsWith('-')), stash: (a) => ['list', 'show'].includes(a[0]), tag: (a) => !a.length || a.every((x) => /^-[ln]|^--(list|contains|points-at|sort)/.test(x)) };
const WRAP = new Set(['sudo', 'env', 'nohup', 'time', 'command', 'exec', 'xargs', 'nice']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const DYNAMIC = /[$`]|^~[^/]/;

/** 명령 줄을 단위 명령과 그 뒤의 연결자로 (; · 줄바꿈 · && · || · | · 괄호). 따옴표 안은 그대로 */
function parts(cmd) {
  const out = [];
  let cur = '';
  let q = null;
  const s = String(cmd);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === q) q = null; else if (c === '\\' && q === '"' && i + 1 < s.length) cur += s[++i]; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += c + s[++i]; continue; }
    if (c === '#' && /(^|\s)$/.test(cur)) { while (i + 1 < s.length && s[i + 1] !== '\n') i++; continue; } // 주석
    let sep = null;
    if (c === '&' && s[i + 1] === '&') { sep = '&&'; i++; } else if (c === '|' && s[i + 1] === '|') { sep = '||'; i++; } else if ('\n;()|'.includes(c)) sep = c;
    if (sep) { out.push({ text: cur, next: sep }); cur = ''; continue; }
    cur += c;
  }
  out.push({ text: cur, next: '' });
  return out.filter((x) => x.text.trim() || x.next === '&&' || x.next === '||');
}

const real = (p) => { try { return p && fs.realpathSync(p); } catch { return p; } };

/** dir 이 속한 git repo 의 최상위 (.git 이 있는 가장 가까운 상위). 없으면 null */
function repoTop(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
}

/**
 * 명령 → 막을 git 호출 목록 [{ kind: 'push' | 'root' | 'unknown' | 'unsafe-cd', sub, where }]
 * unsafe-cd = cd 뒤에 && · || exit 연결도 set -e 도 없이 git 쓰기 (cd 가 실패하면 그 자리에서 돈다)
 * root = 워크스페이스 루트, depth = 스크립트 안으로 들어간 깊이
 */
function findGit(cmd, cwd, root, depth = 0) {
  const home = os.homedir();
  const abs = (p, base) => path.resolve(base, String(p).replace(/^~(?=\/|$)/, home));
  const out = [];
  let dir = cwd; // null = 위치를 모른다
  const made = new Set();
  const inited = []; // 이 명령에서 git init 한 폴더 (아직 .git 이 없다)
  let errexit = /^#!\S*\s+-\w*e/.test(String(cmd)); // set -e (또는 #!/bin/bash -e) 뒤로는 cd 가 실패하면 멈춘다
  let shaky = false; // 앞 cd 가 실패해도 이어서 도는 연결이었다
  const segs = parts(cmd);
  for (let si = 0; si < segs.length; si++) {
    const raw = segs[si].text;
    const t = tokens(raw.trim()).filter((x, i, a) => x !== '>' && a[i - 1] !== '>');
    let k = 0;
    for (;;) {
      if (k < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[k])) { k++; continue; }
      if (k < t.length && WRAP.has(path.basename(t[k]))) { k++; while (k < t.length && t[k].startsWith('-')) k++; continue; }
      break;
    }
    if (k >= t.length) continue;
    const name = path.basename(t[k]);
    const args = t.slice(k + 1);
    if (name === 'set' && args.some((x, i) => /^-\w*e/.test(x) || (x === '-o' && args[i + 1] === 'errexit'))) { errexit = true; continue; }
    if (name === 'mkdir' && dir) { args.filter((x) => !x.startsWith('-')).forEach((x) => made.add(abs(x, dir))); continue; }
    if (name === 'cd' || name === 'pushd') {
      const nx = segs[si].next;
      const after = segs[si + 1] ? tokens(segs[si + 1].text.trim())[0] : '';
      shaky = !errexit && nx !== '&&' && !(nx === '||' && /^(exit|return)$/.test(after || ''));
      const to = args.find((x) => !x.startsWith('-') || x === '-');
      if (!to) { dir = home; continue; }
      if (to === '-' || DYNAMIC.test(to) || !dir && !path.isAbsolute(to)) { dir = null; continue; }
      const next = abs(to, dir || '/');
      if (fs.existsSync(next) || made.has(next)) dir = next; // 없는 폴더면 cd 가 실패해 그 자리에 남는다
      continue;
    }
    if (name === 'popd') { dir = null; continue; }
    // 셸 스크립트 · bash -c 안으로
    if (depth < 2 && (SHELLS.has(name) || /\.(?:sh|bash|zsh)$/.test(name) || t[k].startsWith('./'))) {
      const ci = args.indexOf('-c');
      if (SHELLS.has(name) && ci >= 0 && args[ci + 1]) { out.push(...findGit(args[ci + 1], dir || cwd, root, depth + 1).map((x) => (dir ? x : { ...x, kind: x.kind === 'root' ? 'unknown' : x.kind }))); continue; }
      const file = SHELLS.has(name) ? args.find((x) => !x.startsWith('-')) : t[k];
      if (file && !DYNAMIC.test(file) && dir) {
        const f = abs(file, dir);
        try {
          const st = fs.statSync(f);
          const body = st.isFile() && st.size < 256 * 1024 ? fs.readFileSync(f, 'utf8') : '';
          if (body && (SHELLS.has(name) || /\.(?:sh|bash|zsh)$/.test(f) || /^#!.*\b(?:ba|z|da)?sh\b/.test(body))) out.push(...findGit(body, dir, root, depth + 1).map((x) => ({ ...x, via: path.relative(root, f) || f })));
        } catch { /* 없는 파일 */ }
      }
      continue;
    }
    if (name !== 'git') continue;
    let where = dir;
    let fixed = false; // -C 절대경로면 앞 cd 와 상관없다
    let j = 0;
    while (j < args.length && args[j].startsWith('-')) {
      if (args[j] === '-C') { fixed = path.isAbsolute(String(args[j + 1] || '').replace(/^~(?=\/|$)/, home)); const c = args[j + 1] || '.'; where = DYNAMIC.test(c) || !where && !path.isAbsolute(c) ? null : abs(c, where || '/'); j += 2; } else if (args[j] === '-c' || args[j] === '--git-dir' || args[j] === '--work-tree') j += 2; else j++;
    }
    const sub = args[j];
    const rest = args.slice(j + 1);
    if (!sub) continue;
    if (sub === 'init' || sub === 'clone') { if (where) inited.push(sub === 'init' ? abs(rest.find((x) => !x.startsWith('-')) || '.', where) : abs(rest.filter((x) => !x.startsWith('-'))[1] || path.basename(String(rest.filter((x) => !x.startsWith('-'))[0] || '')).replace(/\.git$/, ''), where)); continue; }
    if (sub === 'push') { out.push({ kind: 'push', sub, where }); continue; }
    if (!ROOT_WRITE.has(sub) || (READ_FORM[sub] && READ_FORM[sub](rest))) continue;
    if (!where) { out.push({ kind: 'unknown', sub, where }); continue; }
    if (inited.some((d) => where === d || where.startsWith(d + path.sep))) continue;
    if (real(repoTop(where)) === real(root)) out.push({ kind: 'root', sub, where });
    else if (shaky && !fixed) out.push({ kind: 'unsafe-cd', sub, where });
  }
  return out;
}

function message(hit, root) {
  const via = hit.via ? ` (스크립트 ${hit.via} 안)` : '';
  if (hit.kind === 'push') return `팀원은 git push 를 하지 않는다${via}. push 는 리더만 한다: 올릴 repo · 브랜치 · 커밋을 리더에게 보고한다.`;
  if (hit.kind === 'unsafe-cd') return `cd 뒤 git ${hit.sub} 이(가) && 연결 · set -e 없이 이어진다${via}. cd 가 실패하면 워크스페이스 루트 repo 에서 돈다. \`git -C <절대경로> ${hit.sub} …\` 로 위치를 명시해 다시 실행한다 (또는 \`cd <경로> && git …\`).`;
  if (hit.kind === 'unknown') return `git ${hit.sub} 이(가) 어느 repo 에서 도는지 알 수 없다${via} (cd · -C 대상이 변수이거나 위치가 바뀐 뒤). cd 가 실패하면 워크스페이스 루트 repo 에서 돈다. 맡은 repo 를 \`git -C repos/<이름> ${hit.sub} …\` 처럼 실제 경로로 적어 다시 실행한다.`;
  return `팀원은 워크스페이스 루트 repo(${root}) 에 git ${hit.sub} 을(를) 하지 않는다${via}. 사용자의 미커밋 파일이 사라질 수 있다. 맡은 repo 를 \`git -C repos/<이름> ${hit.sub} …\` 로 부른다. 루트를 바꿔야 하면 멈추고 리더에게 알린다.`;
}

function main() {
  const { readInput, deny, note, root, isTeammate } = require('../lib/hook');
  const input = readInput();
  if (String(input.tool_name || '') !== 'Bash') return;
  const member = isTeammate(input) || process.env.KEDOVI_DELEGATED === '1';
  const R = root();
  const cmd = String((input.tool_input || {}).command || '');
  if (!/\bgit\b|\.(?:sh|bash|zsh)\b|\b(?:bash|sh|zsh)\b|\.\//.test(cmd)) return;
  const hits = findGit(cmd, input.cwd || R, path.resolve(R));
  if (member) { if (hits[0]) deny(`${message(hits[0], R)} (팀원 git 안전장치: packs/core/hooks/git-guard.js)`); return; }
  // 리더: push 는 리더 몫이라 그대로, 나머지는 막지 않고 경고만
  // 루트 커밋은 리더 일(워크스페이스 설정 · 기록)이라 지우는 쪽(reset · clean · checkout · restore · stash · rebase · branch)만
  const warn = hits.find((h) => h.kind === 'unsafe-cd' || h.kind === 'unknown' || (h.kind === 'root' && /^(reset|clean|checkout|restore|stash|rebase|branch)$/.test(h.sub)));
  if (warn) note(`⚠ git 안전장치 (리더라 막지 않음): ${message(warn, R).replace(/^팀원은 /, '')} 의도한 것이 아니면 이 명령을 되돌리고 사용자에게 알린다.`);
}

if (require.main === module) {
  try { main(); } catch { /* 훅은 세션을 깨지 않는다 */ }
  process.exit(0);
}
module.exports = { findGit, repoTop, parts };
