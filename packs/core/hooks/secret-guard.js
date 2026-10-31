#!/usr/bin/env node
// 비밀값 출력 막기 (Claude Code · Codex). 모든 세션(리더 · 팀원 · 위임)에서 돈다.
// PreToolUse(Bash · Read): 비밀값 파일(.pgpass · .env(예시 제외) · ~/.ssh/*(공개 키 · known_hosts 제외) · *.pem · *.key · 러너 config.toml · .netrc · .git-credentials)의
//   내용을 출력하는 명령(cat · head · tail · less · awk · sed · grep · diff …)과 Read 도구를 막는다.
//   통과: 존재 · 권한(ls · test · stat), 세기(wc · awk 의 NF · NR 만 · grep -c/-q/-l), 키 이름만(cut -d= -f1), 파일 → 파일(cp · sed -i · > 파일), 불러오기(source).
// PostToolUse(Bash): 출력에 비밀값 모양(토큰 · PEM 개인 키 · DB 주소 비밀번호 · KEY=무작위 16자 이상)이 있으면 노출 가능성을 알린다 (값은 다시 찍지 않는다).
// 막을 때만 deny JSON, 알림은 additionalContext JSON. 예외는 삼키고 항상 exit 0
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tokens } = require('./repo-guard');
const { parts } = require('./git-guard');

const HOME = os.homedir();
const EXAMPLE = /\.(example|sample|template|dist|defaults?|tmpl)$/i;

/** 비밀값 파일인가 (절대경로) */
function isSecretFile(p) {
  const b = path.basename(p);
  const d = path.dirname(p);
  if (b === '.pgpass' || b === '.netrc' || b === '.git-credentials') return true;
  if ((b === '.env' || b.startsWith('.env.')) && !EXAMPLE.test(b)) return true;
  if (b === 'config.toml' && /(^|\/)\.?gitlab-runner$/.test(d)) return true;
  if (d === path.join(HOME, '.ssh') && !/\.pub$/.test(b) && !/^known_hosts/.test(b) && b !== 'authorized_keys') return true;
  if (/\.(pem|key)$/i.test(b)) return true;
  return false;
}

// 내용을 출력하는 명령
const SHOW = new Set(['cat', 'less', 'more', 'head', 'tail', 'bat', 'batcat', 'nl', 'tac', 'awk', 'gawk', 'mawk', 'sed', 'gsed', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'strings', 'xxd', 'od', 'hexdump', 'cut', 'sort', 'uniq', 'jq', 'yq', 'diff', 'base64', 'openssl', 'column', 'fold', 'paste', 'tr', 'perl', 'python', 'python3', 'ruby', 'node', 'view', 'vim', 'vi', 'nano', 'emacs', 'code']);
const SINK = new Set(['wc', 'md5sum', 'md5', 'sha1sum', 'sha256sum', 'shasum', 'test', 'true', 'cmp']);
const WRAP = new Set(['sudo', 'env', 'nohup', 'time', 'command', 'exec', 'xargs', 'nice']);

const expand = (s) => String(s).replace(/^~(?=\/|$)/, HOME).replace(/^\$\{?HOME\}?(?=\/|$)/, HOME);

/** 낱말 → 비밀값 파일 경로 목록 (글롭 * ? 은 그 폴더에서 맞춰 본다) */
function secretsIn(word, cwd) {
  const w = expand(word);
  if (!w || w.startsWith('-') || /[$`]/.test(w)) return [];
  const p = path.resolve(cwd, w);
  if (!/[*?[]/.test(path.basename(p))) return isSecretFile(p) ? [p] : [];
  const re = new RegExp(`^${path.basename(p).replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  try { return fs.readdirSync(path.dirname(p)).filter((n) => re.test(n)).map((n) => path.join(path.dirname(p), n)).filter(isSecretFile); } catch { return isSecretFile(p.replace(/[*?]/g, 'x')) ? [p] : []; }
}

/** 단위 명령 하나 → { name, args, files(읽는 비밀값 파일), toFile(> 파일로 보냄), quiet(값을 내지 않는 형태) } */
function stage(text, cwd) {
  const raw = tokens(text.trim());
  let toFile = false;
  for (let i = 0; i < raw.length; i++) if (raw[i] === '>' && raw[i + 1] && !/^\/dev\/(stdout|stderr|tty)$/.test(raw[i + 1])) toFile = true;
  const t = raw.filter((x, i) => x !== '>' && raw[i - 1] !== '>' && x !== '<');
  let k = 0;
  for (;;) {
    if (k < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[k])) { k++; continue; }
    if (k < t.length && WRAP.has(path.basename(t[k]))) { k++; while (k < t.length && t[k].startsWith('-')) k++; continue; }
    break;
  }
  const name = path.basename(t[k] || '');
  const args = t.slice(k + 1);
  const files = args.flatMap((a) => secretsIn(a, cwd));
  let quiet = false;
  const joined = ` ${args.join(' ')} `;
  if (/^[gm]?awk$/.test(name)) {
    const prog = args.filter((a, i) => !a.startsWith('-') && !['-F', '-v', '-f'].includes(args[i - 1]))[0] || '';
    quiet = !/\$|getline|system/.test(prog) && !/\bprint\b(?!\s+(?:NF|NR|FNR)\b)/.test(prog);
  } else if (/^(e|f)?grep$|^rg$/.test(name)) quiet = args.some((a) => /^-[a-zA-Z]*[cqlL]/.test(a) || /^--(count|quiet|silent|files-with(out)?-matches)$/.test(a));
  else if (/^g?sed$/.test(name)) quiet = args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place');
  else if (name === 'cut') quiet = / -f ?1 /.test(joined) && / -d ?[=:] /.test(joined);
  else if (name === 'openssl') quiet = args.includes('-noout') && !args.includes('-text');
  return { name, args, files, toFile, quiet };
}

/** Bash 명령 → 막을 이유 (없으면 null) */
function bashLeak(cmd, cwd) {
  const segs = parts(cmd);
  // 파이프로 이어진 것끼리 묶는다
  const pipes = [];
  let cur = [];
  for (const s of segs) { cur.push(s.text); if (s.next !== '|') { pipes.push(cur); cur = []; } }
  if (cur.length) pipes.push(cur);
  for (const pipe of pipes) {
    const st = pipe.map((x) => stage(x, cwd)).filter((x) => x.name);
    const src = st.findIndex((x) => x.files.length && SHOW.has(x.name) && !x.quiet && !x.toFile);
    if (src < 0) continue;
    // 뒤 단계가 값을 내지 않으면(세기 · 해시 · 파일로) 통과
    const rest = st.slice(src + 1);
    const last = rest[rest.length - 1];
    if (last && (SINK.has(last.name) || last.quiet || last.toFile || (last.name === 'grep' && last.quiet))) continue;
    return { file: st[src].files[0], name: st[src].name };
  }
  return null;
}

const RULES = [
  [/\bglpat-[A-Za-z0-9_-]{20,}/, 'GitLab 개인 토큰(glpat-)'],
  [/\bglrt-[A-Za-z0-9_-]{20,}/, 'GitLab 러너 토큰(glrt-)'],
  [/\bgl(?:dt|ptt|cbt|oas|imt|agent)-[A-Za-z0-9_-]{20,}/, 'GitLab 토큰'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/, 'GitHub 토큰'],
  [/\bnpm_[A-Za-z0-9]{36}\b/, 'npm 토큰'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'Slack 토큰'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS 액세스 키'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/, 'API 키(sk-)'],
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, 'PEM 개인 키'],
  [/\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:/@]+:(?!\*+@|<|\$\{?|x+@|password@|pass@)[^\s@/]{3,}@/i, 'DB 접속 주소의 비밀번호'],
];

function entropy(s) {
  const n = {};
  for (const c of s) n[c] = (n[c] || 0) + 1;
  return Object.values(n).reduce((a, v) => a - (v / s.length) * Math.log2(v / s.length), 0);
}

/** 출력 → 찾은 비밀값 종류 목록 (값은 담지 않는다) */
function scanOutput(text) {
  const s = String(text || '');
  const found = new Set();
  for (const [re, label] of RULES) if (re.test(s)) found.add(label);
  // KEY=무작위 16자 이상 (.pgpass · .env 한 줄). 16진수만이면(커밋 · 해시) 키 이름이 비밀값다울 때만
  for (const m of s.matchAll(/\b([A-Z][A-Z0-9_]{2,})\s*[=:]\s*["']?([A-Za-z0-9+/_.~!@#%^&*-]{16,})["']?/g)) {
    const [, key, v] = m;
    const secretName = /PASS|PWD|SECRET|TOKEN|KEY|AUTH|CRED|PRIVATE|SALT/.test(key);
    const mixed = /[A-Za-z]/.test(v) && /\d/.test(v) && entropy(v) >= 3.5;
    const hexOnly = /^[0-9a-f]+$/i.test(v);
    if ((secretName && v.length >= 12 && !/^(true|false|null|undefined|changeme|placeholder|your[_-]?\w+|x+|\*+)$/i.test(v)) || (mixed && !hexOnly)) { found.add(`${key}= 값`); if (found.size > 6) break; }
  }
  // .pgpass 줄 (호스트:포트:DB:사용자:비밀번호)
  if (/^[^\s:#]+:(?:\d+|\*):[^\s:]+:[^\s:]+:\S{6,}$/m.test(s)) found.add('.pgpass 비밀번호 칸');
  return [...found];
}

function out(json) { process.stdout.write(JSON.stringify(json)); }

function main() {
  const { readInput, deny } = require('../lib/hook');
  const input = readInput();
  const ev = String(input.hook_event_name || '');
  const tool = String(input.tool_name || '');
  const ti = input.tool_input || {};
  const cwd = input.cwd || process.cwd();
  const how = '존재 · 권한은 ls -l · test -f · stat, 형식은 줄 · 칸 수만 (wc -l · awk -F: \'{print NF}\'), 키 이름은 cut -d= -f1. 값이 필요한 명령에는 파일을 그대로 넘긴다 (예: PGPASSFILE · source .env 뒤 실행)';
  if (ev === 'PostToolUse') {
    if (tool !== 'Bash') return;
    const r = input.tool_response;
    const text = typeof r === 'string' ? r : r ? [r.stdout, r.stderr, r.output, r.content].filter((x) => typeof x === 'string').join('\n') : '';
    const kinds = scanOutput(text);
    if (!kinds.length) return;
    out({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `⚠ 비밀값 노출 가능성: 방금 명령 출력에 ${kinds.join(' · ')} 모양이 있다. 값을 다시 출력 · 인용 · 저장하지 말고, 사용자에게 어떤 명령에서 무엇이 보였는지(값 없이) 알리고 그 값을 교체할지 묻는다. 팀원이면 리더에게 같은 내용을 보고한다. (secret-guard)` } });
    return;
  }
  if (ev && ev !== 'PreToolUse') return;
  if (tool === 'Read') {
    const f = ti.file_path ? path.resolve(cwd, expand(ti.file_path)) : '';
    if (f && isSecretFile(f)) deny(`비밀값 파일(${f.replace(HOME, '~')}) 은 읽어 출력하지 않는다. ${how}. 꼭 내용이 필요하면 사용자에게 무엇을 확인할지 묻는다. (secret-guard)`);
    return;
  }
  if (tool !== 'Bash') return;
  const hit = bashLeak(String(ti.command || ''), cwd);
  if (hit) deny(`비밀값 파일(${hit.file.replace(HOME, '~')}) 의 내용을 출력하는 명령이다 (${hit.name}). 값이 대화 기록에 남는다. ${how}. (secret-guard)`);
}

if (require.main === module) {
  try { main(); } catch { /* 훅은 세션을 깨지 않는다 */ }
  process.exit(0);
}
module.exports = { isSecretFile, bashLeak, scanOutput };
