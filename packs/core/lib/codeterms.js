// 사람이 읽는 글의 소스 코드 표현 찾기. 쓰는 곳: lib/draft.js (올리기 · 커밋 전 검사) · lib/docsref.js (문서 점검). 의존성 없음.
/*
 * 확실한 것(soft 아님) = 파일:줄 · 소스 파일명 · src 경로 · 함수 호출 모양
 * 이름 모양(soft = 알림만) = 클래스 이름 · 변수 이름. 일반 낱말 · 제품 이름 · API 필드와 헷갈릴 수 있어 막지 않고, 표 안(데이터 · API 정의)은 보지 않는다
 * 보지 않는 곳 = 코드 블록 · HTML 주석 · 머리말 · 링크 주소 · 띄어쓰기가 있는 인라인 코드(독자가 입력하는 명령)
 * 괜찮은 것 = 설정 키(vars.a.b) · 환경 변수(ALL_CAPS) · 설정 파일(*.config.js · manage.py 등) · 제품 이름(Node.js 등) · vars.writing.codeAllow 정규식
 */
'use strict';

const FILE_LINE = /(?<![\w/])[\w./-]+\.(?:js|mjs|cjs|ts|tsx|jsx|java|kt|kts|py|go|rb|php|cs|swift|sql|xml|jsp|vue|svelte|c|cc|cpp|h|hpp|rs|dart|scala|sh|gradle|json|ya?ml|properties):\d+(?:[-~]\d+)?|#L\d+/g;
const SOURCE_FILE = /(?<![\w@/.-])(?:\.{0,2}\/)?(?:[\w.-]+\/)*[\w.-]*[A-Za-z0-9_]\.(?:js|mjs|cjs|ts|tsx|jsx|java|kt|kts|py|go|rb|php|cs|swift|jsp|vue|svelte|c|cc|cpp|h|hpp|rs|dart|scala)(?![\w-]|\.[A-Za-z]|\((?![가-힣\s]))/g;
const SOURCE_PATH = /(?<![\w./-])(?:\.{1,2}\/)?src\/[\w./-]*[\w-]/g;
const NOT_CALL_END = '(?:json|md|ya?ml|toml|xml|html?|css|txt|lock|env|sh|sql|com|net|org|io|kr|dev|ai)';
const CALL = new RegExp(`(?<![\\w.$-])[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*\\(\\)|(?<![\\w.$-])(?:[a-z_$][\\w$]*\\.)+(?!${NOT_CALL_END}\\()[A-Za-z_$][\\w$]*\\((?![가-힣\\s])|(?<![\\w.$-])[a-z]+[A-Z][\\w$]*\\((?![가-힣\\s])`, 'g');
const CLASS_NAME = /(?<![\w.$-])[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)*(?:Service|Controller|Repository|Repo|Manager|Handler|Factory|Impl|Dto|DTO|Dao|DAO|Entity|Mapper|Adapter|Provider|Resolver|Interceptor|Middleware|Helper|Utils?|Config)(?![\w$-])/g;
const CAMEL = /(?<![\w.$/-])[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+(?![\w$-])/g;
const SNAKE = /(?<![\w.$/-])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![\w$-])/g;

// 소스처럼 보이지만 이름인 것
const PRODUCTS = /(?<![\w.-])(?:node|next|nuxt|vue|react|nest|express|three|d3|deno|angular|ember|backbone|chart|alpine|solid|electron|p5|pixi|babylon|socket|moment|day|web3|ethers|preact|svelte|fastify|koa|hapi|meteor)\.js(?![\w-])/gi;
const SETTING_FILE = /(?:^|\/)(?:[\w.-]+\.config\.[cm]?[jt]s|\.[\w.-]+|docs-site\.extra\.js|(?:manage|setup|conftest|wsgi|asgi)\.py)$/;
const BRANDS = new Set(['arXiv', 'iPhone', 'iPad', 'iPod', 'iMac', 'iCloud', 'iTunes', 'jQuery', 'eBay', 'macBook']);

const LABEL = { fileLine: '파일:줄', file: '소스 파일명', path: '소스 경로', call: '함수 호출', cls: '클래스 이름', variable: '변수 이름' };

/** 글에서 볼 줄만 [{ n, raw }]: 머리말 · 코드 블록 · HTML 주석 뺌 */
function proseLines(text) {
  const all = String(text).split('\n');
  const out = [];
  let i = 0;
  if (/^---\s*$/.test(all[0] || '')) { const e = all.findIndex((l, k) => k > 0 && /^---\s*$/.test(l)); if (e > 0) i = e + 1; }
  let fence = null;
  let comment = false;
  for (; i < all.length; i++) {
    let l = all[i];
    const f = /^\s*(```+|~~~+)/.exec(l);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    if (comment) { const e = l.indexOf('-->'); if (e < 0) continue; l = l.slice(e + 3); comment = false; }
    l = l.replace(/<!--.*?-->/g, ' ');
    const s = l.indexOf('<!--');
    if (s >= 0) { l = l.slice(0, s); comment = true; }
    out.push({ n: i + 1, raw: l });
  }
  return out;
}

/** 이름만 보게 줄을 닦는다: 명령 · 링크 주소 · 태그 · 제품 이름을 지운다 */
function clean(l) {
  return l
    .replace(/`([^`\n]*)`/g, (a, c) => (/\s/.test(c.trim()) ? ' ' : ` ${c.trim()} `))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<\/?[A-Za-z][^>\n]*>/g, ' ')
    .replace(PRODUCTS, ' ');
}

/**
 * 찾기. 반환 [{ line, kind, label, text, soft }] (kind = fileLine · file · path · call · cls · variable)
 * opts.allow = [RegExp] 맞는 표현은 뺀다
 */
function scan(text, opts = {}) {
  const allow = opts.allow || [];
  const out = [];
  for (const { n, raw } of proseLines(text)) {
    const table = /^\s*\|/.test(raw);
    const seen = new Set();
    const add = (kind, t, soft) => {
      const k = `${kind}\0${t}`;
      if (seen.has(k) || allow.some((re) => re.test(t))) return;
      seen.add(k);
      out.push({ line: n, kind, label: LABEL[kind], text: t, soft: !!soft });
    };
    // 파일:줄은 링크 주소까지 본다 (코드 저장소의 #L12 링크)
    for (const m of raw.replace(/`/g, '').match(FILE_LINE) || []) add('fileLine', m);
    let l = clean(raw.replace(FILE_LINE, ' '));
    const take = (re, fn) => { l = l.replace(re, (m) => (fn(m) === false ? m : ' ')); };
    take(SOURCE_FILE, (m) => { if (SETTING_FILE.test(m)) return; add('file', m); });
    take(SOURCE_PATH, (m) => add('path', m));
    take(CALL, (m) => { if (!m.startsWith('vars.')) add('call', m.endsWith('(') ? m.slice(0, -1) : m); });
    take(CLASS_NAME, (m) => add('cls', m, true));
    if (!table) {
      take(CAMEL, (m) => { if (!BRANDS.has(m)) add('variable', m, true); });
      take(SNAKE, (m) => add('variable', m, true));
    }
  }
  return out;
}

/** vars.writing.codeAllow → [RegExp] (잘못된 정규식은 넘긴다) */
function allowOf(ws) {
  const v = (((ws || {}).vars || {}).writing || {}).codeAllow;
  const list = Array.isArray(v) ? v : String(v || '').split(',');
  const out = [];
  for (const s of list.map((x) => String(x).trim()).filter(Boolean)) { try { out.push(new RegExp(s)); } catch { /* 넘김 */ } }
  return out;
}

module.exports = { scan, allowOf, proseLines, LABEL };
