// 쉬운 글 검사: 긴 문장, 가운데점 나열, 긴 괄호, 번역 투, 줄인 말투, 인사말, 긴 단락. 모두 알림만 한다.
/*
 * 쓰는 곳: lib/draft.js (올리기 전 · 커밋 검사), lib/docsref.js (문서 점검), lib/confcomments.js (설정 파일 주석)
 * 기준값: vars.writing.sentenceMax, dotMax, parenMax, paragraphMax
 * 의존성 없음.
 */
'use strict';

const DEFAULTS = { sentenceMax: 100, dotMax: 3, parenMax: 40, paragraphMax: 400 };
const DOT = /[·ㆍ・]/g;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

// 국립국어원 「쉬운 공공언어 쓰기 길잡이」의 번역 투 · 줄인 표현. 일반 문장과 헷갈리지 않는 모양만 본다
const PHRASES = [
  ['번역 투 「에 있어서」 (「에서」 로)', /(?:함|것|데|측면|관점|과정|경우|부분)에\s?있어서?(?=[\s,.]|$)/],
  ['번역 투 「에 의해」 (주어를 앞에)', /[가-힣]에\s?의해서?(?=[\s,.]|$)/],
  ['번역 투 「에 대해서」 (「에」 · 「을」 로)', /[가-힣]에\s?대해서(?:는)?(?=[\s,.]|$)/],
  ['줄인 말투 「요망 · 바람」 (풀어 씀)', /(?:조치|확인|검토|협조|회신|제출|이용|참고)\s?(?:요망|바람)(?=[\s,.]|$)/],
];
const GREETING = /^(?:안녕하세요|감사합니다|고맙습니다|이상입니다|잘 부탁드립니다)[.!]?$/;

/** 설정: vars.writing 값 중 쓸 수 있는 것만, 나머지는 기본값 */
function settings(ws) {
  const w = ((ws || {}).vars || {}).writing || {};
  const out = {};
  for (const [k, d] of Object.entries(DEFAULTS)) {
    const n = Number(w[k]);
    out[k] = w[k] !== undefined && w[k] !== '' && Number.isFinite(n) && n >= 0 ? n : d;
  }
  return out;
}

/** 본문 → 검사할 줄 [{ n, raw, text }] (코드 블록 · HTML 주석을 빼고 인라인 코드를 비운다) */
function lines(text) {
  const out = [];
  let fence = null;
  let comment = false;
  String(text).split('\n').forEach((raw, i) => {
    let l = raw;
    const f = /^\s*(```+|~~~+)/.exec(l);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return; }
    if (f) { fence = f[1]; return; }
    if (comment) { const e = l.indexOf('-->'); if (e < 0) return; l = l.slice(e + 3); comment = false; }
    l = l.replace(/<!--[\s\S]*?-->/g, '');
    const s = l.indexOf('<!--');
    if (s >= 0) { l = l.slice(0, s); comment = true; }
    out.push({ n: i + 1, raw, text: l.replace(/`[^`\n]*`/g, '``') });
  });
  return out;
}

/** 꾸밈을 뺀 글 (링크 · 주소 · 굵게) */
const plain = (s) => String(s).replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, 'URL').replace(/\*\*|__/g, '').trim();
/** 문장으로 나눈다 (마침표 · 물음표 · 느낌표 뒤 공백) */
const sentences = (s) => String(s).split(/(?<=[.!?。])\s+/).map((x) => x.trim()).filter(Boolean);
const len = (s) => [...s].length;

/** 글 한 줄의 걸린 것: [낱말 설명] */
function lineKinds(text, cfg = DEFAULTS) {
  const body = plain(String(text).replace(BULLET, '').replace(/^\s*>\s?/, ''));
  if (!body) return [];
  const out = [];
  const list = sentences(body);
  const long = list.map(len).filter((n) => n > cfg.sentenceMax);
  if (long.length) out.push(`긴 문장 ${Math.max(...long)}자 > ${cfg.sentenceMax}자 (한 문장에 한 가지)`);
  const dots = Math.max(0, ...list.map((s) => (s.match(DOT) || []).length));
  if (dots > cfg.dotMax) out.push(`가운데점 나열 ${dots + 1}개 (표 · 하위 글머리로)`);
  const paren = Math.max(0, ...[...body.matchAll(/[(（]([^()（）]*)[)）]/g)].map((m) => len(m[1])));
  if (paren > cfg.parenMax) out.push(`긴 괄호 ${paren}자 > ${cfg.parenMax}자 (따로 한 줄로)`);
  for (const [kind, re] of PHRASES) if (re.test(body)) out.push(kind);
  if (list.some((s) => GREETING.test(s))) out.push('인사말');
  return out;
}

const isProse = (t) => t.trim() && !/^\s*(?:#{1,6}\s|\||:?-{3,}|={3,})/.test(t);
const isPara = (t) => isProse(t) && !BULLET.test(t) && !/^\s*>/.test(t);

/** 글 전체: [{ line, kind }] (머리말 · 제목 · 표 · 코드 블록 제외). only = 이 줄 번호만 */
function scan(text, cfg = DEFAULTS, only = null) {
  const all = lines(text);
  let skipTo = 0;
  if (/^---\s*$/.test(all[0] ? all[0].text : '')) {
    const end = all.findIndex((x, i) => i > 0 && /^---\s*$/.test(x.text));
    if (end > 0) skipTo = all[end].n;
  }
  const L = all.filter((x) => x.n > skipTo);
  const hits = [];
  const seen = (n) => !only || only.has(n);
  for (const x of L) if (seen(x.n) && isProse(x.text)) for (const kind of lineKinds(x.text, cfg)) hits.push({ line: x.n, kind });
  let start = null;
  let size = 0;
  let touched = false;
  const flush = () => {
    if (start !== null && touched && size > cfg.paragraphMax) hits.push({ line: start, kind: `긴 단락 ${size}자 > ${cfg.paragraphMax}자 (나누거나 글머리로)` });
    start = null; size = 0; touched = false;
  };
  let prev = 0;
  for (const x of L) {
    if (!isPara(x.text) || x.n !== prev + 1) flush();
    if (isPara(x.text)) {
      if (start === null) start = x.n;
      size += len(plain(x.text));
      touched = touched || seen(x.n);
    }
    prev = x.n;
  }
  flush();
  return hits.sort((a, b) => a.line - b.line);
}

module.exports = { DEFAULTS, settings, lines, plain, sentences, lineKinds, scan };
