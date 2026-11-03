#!/usr/bin/env node
// 다른 벤더 에이전트(Codex ↔ Claude Code)에게 읽기 전용 교차 리뷰를 받는다. 실행: node packs/core/bin/cross-review.js [--to codex|claude|auto] [--model <m>] [--effort <e>] [--base <ref>] [--files a,b] [--question "..."] [--dry-run]
/*
 * 프롬프트 = packs/core/agents/reviewer.md 본문 + 변경(diff) + 질문.
 *   변경: 워크스페이스 repos/* 중 변경이 있는 repo 들, 없으면 현재 git repo. --base 가 있으면 <base> 대비, 없으면 HEAD 대비 + 추적 안 된 파일.
 *   --files 를 주면 diff 대신 그 파일 내용을 싣는다.
 * 실행 (읽기 전용):
 *   codex : codex exec --sandbox read-only [-m <m>] [-c model_reasoning_effort=<e>] -o <tmp> -      (프롬프트는 stdin)
 *   claude: claude -p --permission-mode plan --tools Read,Grep,Glob --allowedTools Read,Grep,Glob [--model <m>] [--effort <e>]  (프롬프트는 stdin)
 * --to auto(기본): 호출한 쪽과 다른 벤더. Claude Code 세션은 CLAUDECODE=1, Codex 는 CODEX_* 환경변수로 추정한다.
 * 모델 기본값: 프로필·팀·개인 설정을 합친 교차 검토 모델·추론 강도 (bin/kit.js resolveModels — kedovi models 에 보이는 값). 없으면 CLI 기본값.
 * 비용: 상대 CLI 가 사용자 본인의 구독·API 로 돈다.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_PROMPT_BYTES = 400 * 1024;
const MAX_UNTRACKED_BYTES = 64 * 1024;
const CLAUDE_TOOLS = 'Read,Grep,Glob';

function parseArgs(argv) {
  const o = { to: 'auto', model: null, effort: null, base: null, files: [], question: '', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, null];
    const val = () => (inline !== null ? inline : argv[++i]);
    if (k === '--to') o.to = val();
    else if (k === '--model') o.model = val();
    else if (k === '--effort') o.effort = val();
    else if (k === '--base') o.base = val();
    else if (k === '--files') o.files = val().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--question' || k === '-q') o.question = val();
    else if (k === '--dry-run') o.dryRun = true;
    else if (k === '-h' || k === '--help') o.help = true;
    else throw new Error(`알 수 없는 인자: ${a}`);
  }
  if (!['codex', 'claude', 'auto'].includes(o.to)) throw new Error('--to 는 codex | claude | auto');
  return o;
}

const { findCli } = require('../lib/cli');
const which = (bin) => !!findCli(bin);
const git = (cwd, args) => {
  const r = spawnSync('git', ['-C', cwd, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};

/** 호출한 쪽 추정 — claude | codex | null */
function caller(env = process.env) {
  if (env.CLAUDECODE === '1' || env.CLAUDE_CODE_ENTRYPOINT) return 'claude';
  if (Object.keys(env).some((k) => k.startsWith('CODEX_'))) return 'codex';
  return null;
}

function pickVendor(to, env = process.env, has = which) {
  if (to !== 'auto') return { vendor: to, why: '--to 지정' };
  const me = caller(env);
  if (me === 'claude') return { vendor: 'codex', why: '호출자 Claude Code (CLAUDECODE)' };
  if (me === 'codex') return { vendor: 'claude', why: `호출자 ${me} (환경변수 추정)` };
  if (has('codex')) return { vendor: 'codex', why: '호출자 미확인: 설치된 codex' };
  if (has('claude')) return { vendor: 'claude', why: '호출자 미확인: 설치된 claude' };
  return { vendor: null, why: '호출자 미확인, codex·claude 둘 다 없음' };
}

function loadWorkspace() {
  try { return require('../lib/workspace').load(); } catch { return null; }
}

function reviewerInstructions() {
  const f = path.join(__dirname, '..', 'agents', 'reviewer.md');
  const raw = fs.readFileSync(f, 'utf8');
  return raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

/** 변경이 있는 repo 들의 diff. [{ name, dir, diff }] */
function collectDiffs(ws, base) {
  const dirs = [];
  if (ws) for (const r of ws.repos || []) if (fs.existsSync(r.dir)) dirs.push({ name: r.name, dir: r.dir });
  const one = (d) => {
    if (git(d.dir, ['rev-parse', '--is-inside-work-tree']) === null) return null;
    let diff = git(d.dir, base ? ['diff', base] : ['diff', 'HEAD']) || '';
    if (!base) {
      const untracked = (git(d.dir, ['ls-files', '--others', '--exclude-standard']) || '').split('\n').filter(Boolean);
      for (const f of untracked) {
        const p = path.join(d.dir, f);
        let body;
        try { body = fs.statSync(p).size > MAX_UNTRACKED_BYTES ? '(큰 파일: 내용 생략)' : fs.readFileSync(p, 'utf8'); } catch { continue; }
        diff += `\n--- /dev/null\n+++ b/${f}  (추적 안 된 새 파일)\n${body.split('\n').map((l) => `+${l}`).join('\n')}\n`;
      }
    }
    return diff.trim() ? { ...d, diff } : null;
  };
  const changed = dirs.map(one).filter(Boolean);
  if (changed.length) return changed;
  const top = (git(process.cwd(), ['rev-parse', '--show-toplevel']) || '').trim();
  if (!top) return [];
  const self = one({ name: path.basename(top), dir: top });
  return self ? [self] : [];
}

function buildPrompt({ question, base, files }, ws) {
  const parts = [
    '너는 다른 AI 코딩 에이전트가 만든 변경을 검토하는 **교차 리뷰어**다. 읽기 전용이다. 파일을 고치거나 명령으로 상태를 바꾸지 않는다.',
    '답은 한국어로, 아래 리뷰 지침의 보고 형식을 따른다. 발견마다 확인됨/추정/미확인과 `파일:라인` 을 단다.',
    '', '# 리뷰 지침', '', reviewerInstructions(), '',
  ];
  if (question) parts.push('# 질문', '', question, '');
  let scope;
  if (files.length) {
    scope = `파일 ${files.length}개`;
    parts.push('# 검토 대상 파일', '');
    for (const f of files) {
      let body;
      try { body = fs.readFileSync(path.resolve(f), 'utf8'); } catch (e) { body = `(읽지 못함: ${e.message})`; }
      parts.push(`## ${f}`, '', '```', body, '```', '');
    }
  } else {
    const diffs = collectDiffs(ws, base);
    scope = diffs.length ? `diff ${diffs.map((d) => d.name).join(', ')}${base ? ` (기준 ${base})` : ''}` : '변경 없음';
    if (diffs.length) {
      parts.push('# 변경 (git diff)', '');
      for (const d of diffs) parts.push(`## repo: ${d.name} (${d.dir})`, '', '```diff', d.diff.trim(), '```', '');
    } else if (!question) {
      throw new Error('검토할 변경이 없습니다. --base, --files 또는 --question 을 주세요');
    }
  }
  let prompt = parts.join('\n');
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) {
    prompt = `${Buffer.from(prompt).subarray(0, MAX_PROMPT_BYTES).toString('utf8')}\n\n(… ${MAX_PROMPT_BYTES / 1024}KB 에서 잘림. 잘린 뒤쪽은 검토 대상이 아니다. 필요하면 파일을 직접 읽어라)\n`;
    scope += ': 잘림';
  }
  return { prompt, scope };
}

function buildCommand(vendor, model, outFile, effort) {
  if (vendor === 'codex') {
    return { cmd: 'codex', args: ['exec', '--sandbox', 'read-only', ...(model ? ['-m', model] : []), ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []), '-o', outFile, '-'] };
  }
  return { cmd: 'claude', args: ['-p', '--permission-mode', 'plan', '--tools', CLAUDE_TOOLS, '--allowedTools', CLAUDE_TOOLS, ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])] };
}

function run(cmd, args, input, cwd) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    const p = spawn(findCli(cmd) || cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* 이미 끝남 */ } resolve({ code: null, out, err: `${err}\n시간 초과 (${TIMEOUT_MS / 60000}분)` }); }, TIMEOUT_MS);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    p.stdin.on('error', () => { /* 상대가 먼저 닫음 */ });
    p.stdin.end(input);
  });
}

/** kedovi models 와 같은 계산 — 워크스페이스의 bin/kit.js 가 없으면(옛 워크스페이스) workspace.json 값만. 반환 { model, effort } */
function crossReviewModel(ws, vendor) {
  if (!ws) return {};
  let cr;
  let blocked = false;
  try {
    const { resolveModels } = require(path.join(ws.root, 'bin', 'kit.js'));
    const m = resolveModels(ws.root, ws);
    cr = (m.run || m.effective).crossReview || {};
    // 이 PC 설정(kedovi ai)이 그 회사 모델을 쓰지 않거나 섞지 않으면 막는다
    if (m.access && (!m.access.vendors.includes(vendor) || m.access.compose !== 'mix')) blocked = true;
  } catch { cr = ws?.agents?.crossReview || {}; }
  const e = cr.effort; // 문자열 = 두 도구 공통, 객체 = 도구별
  return { model: cr[vendor] || null, effort: (typeof e === 'string' ? e : (e || {})[vendor]) || null, blocked };
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (o.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n')[1].replace(/^\/\/ /, '')); return; }

  const ws = loadWorkspace();
  const { vendor, why } = pickVendor(o.to);
  if (!vendor) { console.error(`교차 리뷰를 맡길 CLI 가 없습니다 (${why}). codex 또는 claude 를 설치하세요.`); process.exit(1); }
  const conf = crossReviewModel(ws, vendor);
  if (conf.blocked && o.to === 'auto') { console.error(`이 PC 설정(kedovi ai)은 ${vendor === 'codex' ? 'GPT' : 'Claude'} 모델을 쓰지 않습니다. 교차 리뷰 대신 같은 회사 모델의 reviewer 로 검토하세요 (쓰려면 kedovi ai 로 바꾸거나 --to ${vendor})`); process.exit(3); }
  const model = o.model || conf.model || null;
  const effort = o.effort || conf.effort || null;

  let built;
  try { built = buildPrompt(o, ws); } catch (e) { console.error(e.message); process.exit(1); }
  const outFile = path.join(os.tmpdir(), `cross-review-${process.pid}.md`);
  const { cmd, args } = buildCommand(vendor, model, outFile, effort);
  const cwd = ws ? ws.root : process.cwd();
  const shown = `${cmd} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`;

  const head = [`교차 리뷰 → ${vendor} (${why})`, `모델: ${model || 'CLI 기본값'}${effort ? ` · 추론 ${effort}` : ''}`, `범위: ${built.scope}`,
    `프롬프트: ${(Buffer.byteLength(built.prompt) / 1024).toFixed(1)}KB (stdin)`, `명령: ${shown}`, `위치: ${cwd}`];
  if (o.dryRun) { console.log([...head, '', '(--dry-run: 실행하지 않음)'].join('\n')); return; }
  if (!which(cmd)) { console.error(`${cmd} 가 설치돼 있지 않습니다. --to 로 다른 쪽을 고르거나 설치하세요.`); process.exit(1); }

  console.error(head.join('\n'));
  // 리뷰 확인을 켠 워크스페이스: 시작 때 상태를 잡아 두고 끝나면 리뷰 기록으로 남긴다 (lib/review.js)
  let reviewed = null;
  try { if (ws) { const R = require('../lib/review'); const st = R.settings(ws.root); if (st.level !== 'off') reviewed = { R, st, trees: R.snapshot(ws.root, ws, st) }; } } catch { /* 기록은 부가 기능 */ }
  const r = await run(cmd, args, built.prompt, cwd);
  let text = r.out;
  if (vendor === 'codex' && fs.existsSync(outFile)) { text = fs.readFileSync(outFile, 'utf8'); fs.rmSync(outFile, { force: true }); }
  if (r.code !== 0) {
    console.error(`\n✖ ${cmd} 실패 (exit ${r.code})\n${r.err.trim().split('\n').slice(-15).join('\n')}`);
    if (text.trim()) console.log(text.trim());
    process.exit(1);
  }
  if (reviewed) { try { reviewed.R.record(ws.root, ws, reviewed.st, { by: `교차 검토 → ${vendor}`, trees: reviewed.trees }); } catch { /* 기록은 부가 기능 */ } }
  console.log(`# 교차 리뷰: ${vendor}${model ? ` (${model})` : ''}\n\n${text.trim()}`);
}

if (require.main === module) main();
module.exports = { parseArgs, caller, pickVendor, buildCommand, collectDiffs, buildPrompt };
