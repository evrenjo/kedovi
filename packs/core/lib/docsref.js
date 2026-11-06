// 기획 문서를 ID 단위로 읽기 · 사용처 찾기 · 코드 대조 · 문서 점검. 사용: kedovi docs show · refs · trace · build/check 의 「문서 점검」 경고
/*
 * 큰 문서를 통째로 읽지 않고 ID 하나의 정의만 꺼내고(show), 그 ID 가 나오는 곳을 도구가 찾는다(refs).
 *   정의 = 그 ID 로 시작하는 제목의 절 · 첫 칸이 그 ID 인 표 행(표 머리와 함께) · **ID** 로 시작하는 문단 · 화면설계서 장(<section id="ID">)
 * 동결 문서: 머리말 「상태: 동결」 (문단 또는 | 상태 | 동결 | 표). 구현이 끝나 코드가 정본이 된 문서. 점검에서 빼고, show · refs 에 [동결] 로 표시한다.
 * 코드 대조(trace): 머리말(FN 등) ID 의 정의와 코드 repo 의 구현 표시(주석의 ID)를 맞춰 본다. 코드에 없는 ID · 기획에 없는 ID.
 * 문서 점검(경고만): 큰 문서(vars.docs.maxKB) · 문장형 제목 · 긴 코드 블록(codeMax) · 파일:줄 참조(인용구 밖) · 본문 근거 줄 · 머리말에 쌓인 변경 이력 · 여러 문서에 같은 문장 · 긴 표 칸(cellMax) · 문단형 표(cellAvg) · 표 칸 안 경위 · 그림 없는 큰 문서(figureKB).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const FR = require('./freshness');

const SKIP_DIRS = new Set(['docs-site', 'html', 'originals', 'node_modules', '.git', '.github', '.gitlab']);
const SKIP_ROOT = new Set(['AGENTS.md', 'CLAUDE.md', 'AGENTS.override.md', 'CLAUDE.local.md']);
const SHEET_RE = /<section\b[^>]*\bclass="[^"]*\bsheet\b/;
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idRe = (id) => new RegExp(`(?<![\\w-])${escRe(id)}(?![\\w-])`);

/** 기획 repo 의 문서 [{ rel, text, sheet }] (md 와 화면설계서 장 HTML. docs-site/ 등 생성물은 뺀다) */
function listDocs(dir) {
  const out = [];
  (function walk(rel) {
    let ents = [];
    try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(r); continue; }
      if (!rel && SKIP_ROOT.has(e.name)) continue;
      if (/\.md$/i.test(e.name)) out.push({ rel: r, text: fs.readFileSync(path.join(dir, r), 'utf8'), sheet: false });
      else if (/\.html?$/i.test(e.name)) {
        const text = fs.readFileSync(path.join(dir, r), 'utf8');
        if (SHEET_RE.test(text)) out.push({ rel: r, text, sheet: true });
      }
    }
  })('');
  return out;
}

/** 머리말(첫 40줄)에 「상태: 동결」 이 있으면 동결 문서 */
function isFrozen(text) {
  const head = String(text).split('\n').slice(0, 40).join('\n');
  return /^\s*(?:>\s*)?\**상태\**\s*[:：]\s*\**\s*동결/m.test(head) || /^\s*\|\s*\**상태\**\s*\|\s*\**\s*동결/m.test(head);
}

const stripTags = (h) => String(h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
  .replace(/<(br|\/p|\/li|\/tr|\/h\d|\/div|\/section|\/aside|\/table)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** 한 문서에서 ID 의 정의 [{ line(1부터), kind, lines }] */
function defsIn(doc, id) {
  const out = [];
  const lines = doc.text.split('\n');
  if (doc.sheet) {
    const m = new RegExp(`<section\\b[^>]*\\bid="${escRe(id)}"`).exec(doc.text);
    if (m) {
      const end = doc.text.indexOf('</section>', m.index);
      out.push({ line: doc.text.slice(0, m.index).split('\n').length, kind: '화면설계서 장', lines: stripTags(doc.text.slice(m.index, end < 0 ? undefined : end)) });
    }
    return out;
  }
  const lead = new RegExp(`^\\**\\s*(?:\\[[ xX]\\]\\s*)?${escRe(id)}(?![\\w-])`);
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h && lead.test(h[2].trim())) {
      let j = i + 1;
      for (let f = false; j < lines.length; j++) {
        if (/^\s*```/.test(lines[j])) f = !f;
        const n = !f && /^(#{1,6})\s/.exec(lines[j]);
        if (n && n[1].length <= h[1].length) break;
      }
      out.push({ line: i + 1, kind: '제목', lines: lines.slice(i, j) });
      continue;
    }
    if (/^\s*\|/.test(l)) {
      const first = (l.trim().replace(/^\|/, '').split('|')[0] || '').replace(/\*\*|`/g, '').trim();
      if (lead.test(first)) {
        let k = i;
        while (k > 0 && /^\s*\|/.test(lines[k - 1])) k--;
        const head = k < i - 1 ? [lines[k], lines[k + 1]] : [];
        out.push({ line: i + 1, kind: '표 행', lines: [...head, l] });
      }
      continue;
    }
    const p = /^\s*(?:[-*]\s+)?\*\*([^*]+)\*\*/.exec(l);
    if (p && lead.test(p[1].trim())) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() && !/^\s*[-*]\s+\*\*/.test(lines[j]) && !/^#{1,6}\s/.test(lines[j])) j++;
      out.push({ line: i + 1, kind: '문단', lines: lines.slice(i, j) });
    }
  }
  return out;
}

/** 기획 repo 들에서 ID 의 정의 [{ repo, rel, line, kind, lines, frozen }]. within = 파일 경로 조각(여러 문서에 같은 번호가 있을 때) */
function show(targets, id, within) {
  const out = [];
  for (const t of targets) {
    for (const d of listDocs(t.dir)) {
      if (within && !d.rel.includes(within)) continue;
      for (const def of defsIn(d, id)) out.push({ repo: t.name, rel: d.rel, frozen: !d.sheet && isFrozen(d.text), ...def });
    }
  }
  // 제목 · 문단 정의가 먼저, 표 행은 그 다음 (대응 표의 행보다 본 정의를 먼저 보인다)
  const rank = { 제목: 0, 문단: 1, '화면설계서 장': 1, '표 행': 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** repo 하나에서 ID 가 나오는 줄 [{ rel, line, text }]. git 저장소면 git grep(추적 파일), 아니면 문서 목록에서 */
function grepRepo(dir, id) {
  const re = idRe(id);
  try {
    const out = execFileSync('git', ['-C', dir, '-c', 'core.quotePath=false', 'grep', '-n', '-I', '-F', '-e', id, '--', '.', ':(exclude)docs-site/**', ':(exclude)html/**'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    return out.split('\n').filter(Boolean).map((l) => { const m = /^(.*?):(\d+):(.*)$/.exec(l); return m && { rel: m[1], line: Number(m[2]), text: m[3] }; })
      .filter((x) => x && re.test(x.text));
  } catch (e) {
    if (e.status === 1) return []; // git grep: 찾은 것 없음
    const hits = [];
    for (const d of listDocs(dir)) d.text.split('\n').forEach((t, i) => { if (re.test(t)) hits.push({ rel: d.rel, line: i + 1, text: t }); });
    return hits;
  }
}

/** ID 가 나오는 곳 [{ repo, kind, rel, line, text, def, frozen }] */
function refs(repos, id) {
  const out = [];
  for (const r of repos) {
    if (!fs.existsSync(r.dir)) continue;
    const frozen = new Map();
    const fz = (rel) => { if (!frozen.has(rel)) { let v = false; if (/\.md$/i.test(rel)) { try { v = isFrozen(fs.readFileSync(path.join(r.dir, rel), 'utf8')); } catch { /* 없음 */ } } frozen.set(rel, v); } return frozen.get(rel); };
    const defLines = new Set();
    if (r.kind === 'docs') for (const d of listDocs(r.dir)) for (const def of defsIn(d, id)) defLines.add(`${d.rel}:${def.line}`);
    for (const h of grepRepo(r.dir, id)) out.push({ repo: r.name, kind: r.kind, ...h, def: defLines.has(`${h.rel}:${h.line}`), frozen: fz(h.rel) });
  }
  return out;
}

/** 머리말들(['FN', …])의 ID 하나를 잡는 정규식 (mdsite 의 ID 꼴: 머리말-…-숫자) */
function prefixRe(prefixes, flags = 'g') {
  const ps = prefixes.map((p) => String(p).replace(/[^A-Za-z0-9]/g, '')).filter(Boolean);
  return ps.length ? new RegExp(`(?<![\\w-])(?:${ps.join('|')})(?:-[A-Z0-9]+)*-\\d+(?![\\w-])`, flags) : null;
}

/** 한 문서에서 정의된 ID [{ id, line, later }] (defsIn 과 같은 자리: 제목 · 표 첫 칸 · **ID** 문단 · 화면설계서 장). later = 그 줄에 「다음 스프린트」 */
function defIdsIn(doc, re) {
  const out = [];
  const one = (s) => { re.lastIndex = 0; const m = re.exec(s); return m && s.slice(0, m.index).replace(/[*\s]|\[[ xX]\]/g, '') === '' ? m[0] : null; };
  if (doc.sheet) {
    for (const m of doc.text.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)) if (one(m[1]) === m[1]) out.push({ id: m[1], line: doc.text.slice(0, m.index).split('\n').length, later: false });
    return out;
  }
  let fence = false;
  doc.text.split('\n').forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const h = /^#{1,4}\s+(.*)$/.exec(l);
    const cell = /^\s*\|/.test(l) && (l.trim().replace(/^\|/, '').split('|')[0] || '').replace(/`/g, '').trim();
    const p = /^\s*(?:[-*]\s+)?\*\*([^*]+)\*\*/.exec(l);
    const id = h ? one(h[1].trim()) : cell !== false ? one(cell) : p ? one(p[1].trim()) : null;
    if (id) out.push({ id, line: i + 1, later: l.includes('다음 스프린트') });
  });
  return out;
}

/**
 * 기획 ID 와 코드의 구현 표시 대조. docs = [{ name, dir }] 기획 repo, code = [{ name, dir }] 코드 repo.
 * 반환 { defined: Map(ID → { repo, rel, line, frozen, later }), found: Map(ID → [{ repo, rel, line }]), unknown: [{ id, repo, rel, line }], missing: [ID], skipped: { frozen, later } }
 */
function trace(docs, code, prefixes) {
  const re = prefixRe(prefixes);
  if (!re) throw new Error('대조할 ID 머리말이 없습니다');
  const defined = new Map();
  for (const t of docs) {
    for (const d of listDocs(t.dir)) {
      if (path.basename(d.rel).startsWith('_')) continue; // 견본(_template)의 자리표시 ID 는 정의가 아니다 (문서 사이트도 뺀다)
      const frozen = !d.sheet && isFrozen(d.text);
      for (const x of defIdsIn(d, re)) if (!defined.has(x.id)) defined.set(x.id, { repo: t.name, rel: d.rel, line: x.line, frozen, later: x.later });
    }
  }
  const found = new Map();
  const unknown = [];
  const pat = prefixes.map((p) => String(p).replace(/[^A-Za-z0-9]/g, '')).filter(Boolean).join('|');
  for (const r of code) {
    if (!fs.existsSync(r.dir)) continue;
    let out = '';
    try {
      // --untracked: 아직 커밋 안 한 파일도 (.gitignore 는 따르므로 빌드 결과물은 보통 빠진다)
      out = execFileSync('git', ['-C', r.dir, '-c', 'core.quotePath=false', 'grep', '--untracked', '-n', '-I', '-E', '-e', `(${pat})-[A-Z0-9-]*[0-9]`, '--', '.', ':(exclude)docs-site/**', ':(exclude)html/**'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) { if (e.status !== 1) throw new Error(`${r.name}: git grep 실패 (git 저장소인지 확인)`); }
    for (const l of out.split('\n')) {
      const m = /^(.*?):(\d+):(.*)$/.exec(l);
      if (!m) continue;
      re.lastIndex = 0; // matchAll 은 lastIndex 를 이어받는다
      for (const [id] of m[3].matchAll(re)) {
        const at = { repo: r.name, rel: m[1], line: Number(m[2]) };
        if (defined.has(id)) { if (!found.has(id)) found.set(id, []); found.get(id).push(at); } else unknown.push({ id, ...at });
      }
    }
  }
  const skipped = { frozen: 0, later: 0 };
  const missing = [];
  for (const [id, d] of defined) {
    if (found.has(id)) continue;
    if (d.frozen) skipped.frozen++;
    else if (d.later) skipped.later++;
    else missing.push(id);
  }
  return { defined, found, unknown, missing, skipped };
}

const cut = (s, n) => { const t = String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** 표 본문 칸 [{ line(1부터), text(보이는 글자) }]. 머리 줄 · 코드 블록 안은 뺀다 */
function tableCells(text) {
  const out = [];
  const lines = String(text).split('\n');
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
    if (fence || !/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) continue;
    for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
      const cells = lines[i].trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/);
      for (const c of cells) {
        const t = c.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim();
        if (t) out.push({ line: i + 1, text: t });
      }
    }
    i--;
  }
  return out;
}
const DATE_G = /20\d{2}-\d{2}-\d{2}/g;
/** 칸 안에 경위(날짜 3개 이상 · 날짜와 함께 쓴 개정 · 다시 엶)가 들었나. 「개정 후보」 같은 용어만 있는 칸은 아니다 */
const cellHistory = (t) => { const n = (t.match(DATE_G) || []).length; return n >= 3 || (n > 0 && /개정|다시\s*엶/.test(t)); };
const figureMarks = (text) => {
  // 코드 블록 · 표 줄은 세지 않는다 (흐름을 문단으로 풀어 쓴 것만)
  const body = String(text).replace(/```[\s\S]*?```/g, '').split('\n').filter((l) => !/^\s*\|/.test(l)).join('\n');
  return { arrows: (body.match(/→/g) || []).length, steps: (body.match(/[①-⑳]/g) || []).length, mermaid: /^\s*```mermaid/m.test(text) };
};
// 문장형 제목: 제목 · 헤더 끝의 종결 어미(~다 · ~요 · ~까 · ~나 · ~가 · ~기 · 물음표). 제목은 명사 · 명사구로 쓴다
const HEAD_STEM = '쓰|읽|보|넣|빼|만들|고치|바꾸|받|묻|찾|두|잇|닫|지우|나누|맞추|줄이|늘리|올리|내리|켜|끄|돌리|남기|살피|따르|붙이|옮기|띄우|알리|열|가|오|세우|짜|그리|꾸미|모으|다루|거치|쌓|풀|막|피하|잡|걸|채우|비우|익히|배우|시키|되|하|담|싣|살리|감추|숨기|끝내|마치';
const HEAD_ENDS = [/[?？]$/, /다$/, /까$/, /(니다|세요|어요|아요|해요|예요|에요|나요|가요|까요|죠|데요|래요|네요|군요|봐요|줘요)$/,
  /(는|인|은|던|한|된|른|운)가$/, /(하|되|있|없|쓰|보|가|오|는|았|었|했|할|될|볼|쓸|나|두)나$/, new RegExp(`(?:${HEAD_STEM})기$`)];
const HEAD_NOUN = /(^|\s)(바다|크기|주기|동기|비동기|분기|초기|시기|전기|기기|일기|무기|용기|공기|얘기|이야기|하나)$/;
const headText = (h) => String(h).replace(/<[^>]+>/g, '').replace(/`([^`]*)`/g, '$1').replace(/[*_~]/g, '').replace(/\s*\{#[^}]*\}\s*$/, '')
  .replace(/(\s*[(（][^()（）]*[)）])+\s*$/, '').replace(/[.。!:：…]+$/, '').trim();
const sentenceHead = (h) => { const t = headText(h); return !!t && !HEAD_NOUN.test(t) && HEAD_ENDS.some((r) => r.test(t)); };
/** 문장형 제목 줄: [{ line, text }] (머리말 title: · # 제목 · ## 헤더, 코드 블록 밖) */
function sentenceHeads(text) {
  const out = [];
  let fence = false;
  String(text).split('\n').forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const m = l.match(/^#{1,6}\s+(.+?)\s*#*\s*$/) || (i < 20 && l.match(/^title:\s*(.+)$/));
    if (m && sentenceHead(m[1])) out.push({ line: i + 1, text: m[1].trim() });
  });
  return out;
}
// 코드 붙인 곳: mermaid · tree · screen 밖의 긴 코드 블록(codeMax 줄 넘음) · 파일:줄 참조(a.js:12 · #L12). 사람이 읽는 문서는 표 · 그림 + 짧은 설명으로
const CODE_FIG = /^(mermaid|tree|screen)$/i;
const FILE_LINE = /(?<![\w/])[\w./-]+\.(?:js|mjs|cjs|ts|tsx|jsx|java|kt|kts|py|go|rb|php|cs|swift|sql|xml|jsp|vue|svelte|c|cc|cpp|h|hpp|sh|gradle|json|ya?ml|properties):\d+(?:[-~]\d+)?|#L\d+/g;
/** { blocks: [{ line, lang, lines }], refs: [{ line, text }] } */
function codeMarks(text, codeMax) {
  const blocks = [];
  const refs = [];
  let open = null;
  String(text).split('\n').forEach((l, i) => {
    const f = l.match(/^\s*```\s*([\w-]*)/);
    if (f) {
      if (open) { if (!CODE_FIG.test(open.lang) && i - open.line > codeMax) blocks.push({ line: open.line, lang: open.lang || '-', lines: i - open.line }); open = null; } else open = { line: i + 1, lang: f[1] };
      return;
    }
    if (open || /^\s*>/.test(l)) return; // 인용구 안 근거(파일:줄)는 괜찮다
    for (const m of l.replace(/`/g, '').match(FILE_LINE) || []) refs.push({ line: i + 1, text: m });
  });
  return { blocks, refs };
}
// 본문에 쓴 근거 · 출처 줄: 「근거: · 출처: · 참고: · 자료:」 로 시작하는 문단 · 목록 줄 (인용구 · 표 · 코드 블록 밖). 부가 설명은 인용구로
const SRC_BODY = /^\s*(?:[-*]\s+|\d+\.\s+)?\**(?:근거|출처|참고|자료)(?:\s*(?:자료|문서|경로))?\**\s*[:：]/;
function sourceLines(text) {
  const out = [];
  let fence = false;
  String(text).split('\n').forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return; }
    if (!fence && SRC_BODY.test(l)) out.push({ line: i + 1, text: l.trim() });
  });
  return out;
}
/**
 * 본문 괄호 속 근거(파일:줄)를 그 문단 · 목록 · 표 아래 「> 근거: …」 인용구로 옮긴다 (kedovi docs refs-quote).
 * 괄호 안에 파일:줄이 하나라도 있으면 그 괄호를 통째로 옮긴다. 코드 블록 · 인용구 · 제목 줄은 건드리지 않는다.
 * @returns { text, moved: 옮긴 괄호 수 }
 */
const PAREN = /\s?[(（]([^()（）\n]*)[)）]/g;
function refsToQuote(text) {
  const lines = String(text).split('\n');
  const out = [];
  let fence = false;
  let got = [];
  let moved = 0;
  const flush = () => { if (got.length) { out.push('', `> 근거: ${got.join(' · ')}`); got = []; } };
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) { if (!fence) flush(); fence = !fence; out.push(l); continue; }
    if (fence) { out.push(l); continue; }
    if (!l.trim()) { flush(); out.push(l); continue; }
    if (/^\s*>/.test(l) || /^#{1,6}\s/.test(l)) { flush(); out.push(l); continue; }
    const row = /^\s*\|/.test(l);
    const next = l.replace(PAREN, (all, inner) => {
      FILE_LINE.lastIndex = 0;
      if (!FILE_LINE.test(inner.replace(/`/g, ''))) return all;
      FILE_LINE.lastIndex = 0;
      const ref = inner.trim().replace(/^\**(?:근거|출처|참고|자료)\**\s*[:：]\s*/, '');
      if (ref) { got.push(ref); moved++; }
      return '';
    });
    out.push(row ? next.replace(/[ \t]+\|/g, ' |') : next.replace(/\s+$/, '').replace(/\s+([.,。])/g, '$1'));
  }
  flush();
  return { text: out.join('\n'), moved };
}

const n0 = (v, d) => (Number(v) > 0 ? Number(v) : d);
const topList = (list, n, f) => `${list.slice(0, n).map(f).join(' · ')}${list.length > n ? ` 외 ${list.length - n}개` : ''}`;

/**
 * 문서 점검 경고 (경고만. 동결 문서 · 화면설계서 장은 뺀다).
 * opts: { maxKB, headKB, headDates, minLen, codeMax(15), cellMax(400), cellAvg(80), figureKB(20), docs: [{ rel, text }] (주면 dir 대신) }
 */
function health(dir, opts = {}) {
  const maxKB = n0(opts.maxKB, 60);
  const headKB = opts.headKB || 3;
  const headDates = opts.headDates || 5;
  const minLen = opts.minLen || 60;
  const cellMax = n0(opts.cellMax, 400);
  const cellAvg = n0(opts.cellAvg, 80);
  const figureKB = n0(opts.figureKB, 20);
  const codeMax = n0(opts.codeMax, 15);
  const listed = (opts.docs || listDocs(dir)).filter((d) => !d.sheet);
  const docs = listed.filter((d) => !isFrozen(d.text));
  const warn = [];
  const big = docs.map((d) => [d.rel, Buffer.byteLength(d.text)]).filter(([, b]) => b > maxKB * 1024).sort((a, b) => b[1] - a[1]);
  if (big.length) warn.push(`큰 문서 ${big.length}개 (상한 ${maxKB}KB, vars.docs.maxKB): ${big.slice(0, 5).map(([r, b]) => `${r} ${Math.round(b / 1024)}KB`).join(' · ')}${big.length > 5 ? ` 외 ${big.length - 5}개` : ''}. 주제별로 나누거나, 구현이 끝난 문서는 「상태: 동결」`);
  const heavy = [];
  for (const d of docs) {
    const pre = d.text.split(/^## /m)[0];
    const dates = (pre.match(/20\d{2}-\d{2}-\d{2}/g) || []).length;
    if (Buffer.byteLength(pre) > headKB * 1024 && dates >= headDates) heavy.push(`${d.rel} ${Math.round(Buffer.byteLength(pre) / 1024)}KB · 날짜 ${dates}`);
  }
  // 표: 긴 칸 · 문단형 표(칸 평균) · 칸 안 경위
  const long = [];
  const wordy = [];
  const hist = [];
  for (const d of docs) {
    const cells = tableCells(d.text);
    for (const c of cells) {
      if (c.text.length > cellMax) long.push({ rel: d.rel, line: c.line, len: c.text.length });
      if (cellHistory(c.text)) hist.push({ rel: d.rel, line: c.line });
    }
    const avg = cells.length >= 10 ? cells.reduce((a, c) => a + c.text.length, 0) / cells.length : 0;
    if (avg > cellAvg) wordy.push({ rel: d.rel, avg: Math.round(avg) });
  }
  const perDoc = (list) => { const m = new Map(); for (const x of list) m.set(x.rel, (m.get(x.rel) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };
  if (long.length) {
    const top = [...long].sort((a, b) => b.len - a.len).slice(0, 3).map((x) => `${x.rel}:${x.line} ${x.len}자`).join(' · ');
    warn.push(`긴 표 칸 ${long.length}곳 (${cellMax}자 넘음, vars.docs.cellMax): ${topList(perDoc(long), 5, ([r, n]) => `${r} ${n}곳`)}. 가장 긴 곳 ${top}. 칸에는 한두 문장, 자세한 설명은 표 아래 「<ID> 자세히」 소절이나 정본 문서로`);
  }
  if (wordy.length) warn.push(`문단형 표 문서 ${wordy.length}개 (표 칸 평균 ${cellAvg}자 넘음, vars.docs.cellAvg): ${topList(wordy.sort((a, b) => b.avg - a.avg), 5, (x) => `${x.rel} 평균 ${x.avg}자`)}. 표는 짧은 값만, 설명은 소절로`);
  if (hist.length) warn.push(`표 칸 안 경위 ${hist.length}곳 (날짜 3개 이상 · 개정 · 다시 엶): ${topList(perDoc(hist), 5, ([r, n]) => `${r} ${n}곳`)}. 예: ${hist.slice(0, 3).map((x) => `${x.rel}:${x.line}`).join(' · ')}. 칸에는 결론만, 경위는 문서 끝 「결정 경위」 로`);
  const flat = [];
  for (const d of docs) {
    const kb = Buffer.byteLength(d.text) / 1024;
    if (kb <= figureKB) continue;
    const f = figureMarks(d.text);
    if (!f.mermaid && f.arrows + f.steps >= 20) flat.push(`${d.rel} ${Math.round(kb)}KB · → ${f.arrows} · ① ${f.steps}`);
  }
  if (flat.length) warn.push(`그림 없는 큰 문서 ${flat.length}개 (${figureKB}KB 넘고 mermaid 0, 「→」 「①」 많음): ${topList(flat, 5, (x) => x)}. 흐름 · 구성 · 상태 전이는 mermaid 로`);
  const heads = docs.flatMap((d) => sentenceHeads(d.text).map((h) => ({ rel: d.rel, ...h })));
  if (heads.length) warn.push(`문장형 제목 ${heads.length}곳 (끝이 ~다 · ~요 · ~까 · ~나 · ~가 · ~기 · ?): ${topList(heads, 5, (x) => `${x.rel}:${x.line} 「${cut(x.text, 30)}」`)}. 제목 · 헤더는 명사 · 명사구로 (예: 「설치하기」 → 「설치」)`);
  const code = docs.map((d) => ({ rel: d.rel, ...codeMarks(d.text, codeMax) }));
  const cb = code.filter((x) => x.blocks.length);
  if (cb.length) warn.push(`긴 코드 블록 ${cb.reduce((a, x) => a + x.blocks.length, 0)}곳 (${codeMax}줄 넘음, vars.docs.codeMax. mermaid · tree · screen 제외): ${topList(cb, 5, (x) => `${x.rel}:${x.blocks[0].line} ${x.blocks[0].lines}줄${x.blocks.length > 1 ? ` 외 ${x.blocks.length - 1}곳` : ''}`)}. 사람이 읽는 문서에는 코드를 붙이지 않고 표 · mermaid 그림과 짧은 설명으로 (코드는 repo 가 정본)`);
  const fr = code.filter((x) => x.refs.length);
  if (fr.length) warn.push(`파일:줄 참조 ${fr.reduce((a, x) => a + x.refs.length, 0)}곳: ${topList(fr, 5, (x) => `${x.rel}:${x.refs[0].line} 「${x.refs[0].text}」${x.refs.length > 1 ? ` 외 ${x.refs.length - 1}곳` : ''}`)}. 줄 번호는 코드가 바뀌면 틀린다. 기능 · 화면 이름이나 기획 ID 로`);
  const srcs = docs.map((d) => ({ rel: d.rel, list: sourceLines(d.text) })).filter((x) => x.list.length);
  if (srcs.length) warn.push(`본문에 쓴 근거 · 출처 ${srcs.reduce((a, x) => a + x.list.length, 0)}줄: ${topList(srcs, 5, (x) => `${x.rel}:${x.list[0].line}${x.list.length > 1 ? ` 외 ${x.list.length - 1}줄` : ''}`)}. 부가 설명 · 근거 · 출처는 본문을 가리지 않게 인용구로 (> 근거: …)`);
  // 환경 사실 표(「확인일」 칸): 확인일이 factDays 일 넘은 행 · 확인일이 빈 행
  const factDays = opts.factDays == null ? FR.DEFAULT_DAYS : opts.factDays;
  const stale = factDays > 0 ? docs.flatMap((d) => FR.staleRows(d.text, factDays).map((r) => ({ rel: d.rel, ...r }))) : [];
  if (stale.length) warn.push(`오래된 환경 사실 ${stale.length}행 (확인일 ${factDays}일 넘음, vars.docs.factDays): ${topList(stale.sort((a, b) => b.age - a.age), 5, (x) => `${x.rel}:${x.line} 「${cut(x.fact, 30)}」 ${x.date}`)}. 확인 명령을 다시 돌려 값 · 확인일을 고친다`);
  const undated = docs.flatMap((d) => FR.undatedRows(d.text).map((r) => ({ rel: d.rel, ...r })));
  if (undated.length) warn.push(`확인일 없는 환경 사실 ${undated.length}행: ${topList(undated, 5, (x) => `${x.rel}:${x.line} 「${cut(x.fact, 30)}」`)}. 확인 명령을 돌리고 그날 날짜(YYYY-MM-DD)를 적는다`);
  if (heavy.length) warn.push(`머리말에 변경 이력이 쌓인 문서 ${heavy.length}개: ${heavy.slice(0, 5).join(' · ')}${heavy.length > 5 ? ` 외 ${heavy.length - 5}개` : ''}. 이력은 git 에 맡기고(바꾼 이유가 결정이면 결정 기록 ID 를 건다) 머리말에서 지운다`);
  const seen = new Map();
  for (const d of docs) {
    let fence = false;
    for (const line of d.text.split('\n')) {
      if (/^\s*```/.test(line)) { fence = !fence; continue; }
      if (fence || /^\s*<!--/.test(line)) continue;
      for (const s of line.split(/(?<=[.다])\s+|\s*\|\s*/)) {
        const t = s.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
        if (t.length < minLen || /^[-:| ]+$/.test(t) || /^(근거|출처|변경|상태)\s*[:：]/.test(t)) continue;
        if (!seen.has(t)) seen.set(t, new Set());
        seen.get(t).add(d.rel);
      }
    }
  }
  const dup = [...seen.entries()].filter(([, s]) => s.size >= 2).sort((a, b) => b[1].size - a[1].size);
  if (dup.length) warn.push(`같은 문장 ${dup.length}개가 여러 문서에 있습니다 (${minLen}자 이상). 예: ${dup.slice(0, 2).map(([t, s]) => `「${cut(t, 40)}」 ${[...s].slice(0, 3).join(' · ')}`).join(' / ')}. 한 문서에만 두고 다른 곳은 ID 링크로`);
  // 규모 문서는 기획 repo 에서만 본다 (코드 repo 의 docs/architecture.md 에는 묻지 않는다). 동결된 규모 문서도 있는 것으로 센다
  const sc = opts.scale ? scaleWarn(docs, listed) : null;
  if (sc) warn.push(sc);
  return warn;
}

/* 규모 문서: 「과하다 · 필요 없다」 판단의 근거. 구성 · 결정 문서가 생겼는데 수치가 없으면 알린다.
 * 구성 문서는 init-docs 견본 그대로(상태 줄에 「견본」)면 아직 안 쓴 것으로 본다 */
const SCALE_DOC = /(^|\/)scale\.md$/i;
const DECISION_DOC = /(^|\/)DEC-\d+[^/]*\.md$/i;
const ARCH_DOC = /(^|\/)architecture\.md$/i;
// 수 단위 글자는 수로 쓰인 때만 (수천 명 · 천만 건). 「백업 예정」 같은 낱말은 아니다
const SCALE_VALUE = /\d|(?:수|몇)\s*[십백천만억]|[십백천만억]+\s*(?:명|건|개|회|원|곳|대)|미정/;

/** 「지금」 열에 값이 한 칸이라도 있으면 채운 것: 숫자 · 수 단위(천 · 만 …) · 「미정」(미결 목록이 쫓는다). 칸 전체가 <…> 이면 자리표시. 코드 블록 안 표는 보지 않는다 */
function scaleFilled(text) {
  let head = null;
  let fence = false;
  for (const line of String(text).split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; head = null; continue; }
    if (fence || !/^\s*\|/.test(line)) { head = null; continue; }
    const cells = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
    if (!head) { head = cells; continue; }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const i = head.findIndex((c) => /지금|현재/.test(c));
    const v = i >= 0 ? (cells[i] || '') : '';
    if (i > 0 && !/^<[^>]*>$/.test(v) && SCALE_VALUE.test(v)) return true;
  }
  return false;
}

function scaleWarn(docs, all = docs) {
  const arch = (d) => ARCH_DOC.test(d.rel) && !/견본/.test(d.text.split('\n').slice(0, 6).join('\n'));
  if (!docs.some((d) => DECISION_DOC.test(d.rel) || arch(d))) return null;
  const s = all.filter((d) => SCALE_DOC.test(d.rel));
  if (!s.length) return '규모 문서 없음: 구성 · 결정 문서는 있는데 사용자 · 하루 데이터 건수 · 증가량 · 보존 기간을 적은 곳이 없습니다. 00-overview/scale.md 로 만든다 (양식: 워크스페이스 packs/core/assets/scale/template.md). 「과하다 · 필요 없다」 판단과 결정의 「전제한 규모」 근거가 된다';
  if (!s.some((d) => scaleFilled(d.text))) return `규모 문서에 수치 없음: ${s.map((d) => d.rel).join(' · ')} 의 「지금」 칸이 비었습니다. 사용자 · 하루 데이터 건수 · 증가량 · 보존 기간을 채운다 (모르면 사용자에게 묻고, 정할 수 없으면 미정과 미결)`;
  return null;
}

module.exports = { listDocs, isFrozen, sentenceHeads, codeMarks, sourceLines, refsToQuote, defsIn, defIdsIn, prefixRe, show, refs, trace, health, tableCells, cut, scaleFilled };
