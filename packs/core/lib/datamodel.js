// 데이터 설계 정의서(md 테이블 정의서) 읽기 · 검사: kedovi docs build 의 ERD 와 kedovi datamodel check 가 같이 쓴다 (외부 모듈 없음)
/*
 * 정의서 형식 (스키마마다 한 파일, 견본 packs/datamodel/assets/erd/template.md)
 *   ### <스키마>.<테이블> <논리명>
 *   설명 한 줄. 기능: FN-… · FN-…           (설명 줄의 꼬리표: 기능 · 결정 · 파티션 · 보존 · 공통 컬럼 · 영역 · 분류 · ERD · 고정 스키마)
 *   영역: 주문 · 체결   (ERD 주제 영역, 여럿이면 쉼표 · 가운뎃점) · 분류: 코드 (값 목록 표: ERD 가 그리로 가는 선을 숨길 수 있다) · ERD: 선 숨김 (그 표로 가는 선을 숨길 수 있다)
 *   파티션: … · 보존: … · 고정 스키마: <근거> (프레임워크가 만드는 테이블: 기본키 없음은 ⚠, 이름 · 공통 컬럼 · 타입 규칙은 건너뜀)
 *   | 컬럼 | 논리명 | 타입 | 널 | 키 | 참조 | 설명 |   키: PK · FK · UK 를 쉼표로, 참조: <스키마>.<테이블>.<컬럼>, 널: Y 면 허용
 *   논리 참조(DB 외래키 없이 앱이 지키는 참조): 키에 FK 없이 참조 칸에 「논리: <스키마>.<테이블>[.<컬럼>]」
 * 「기능: 없음」 · 「공통 컬럼: 없음」 처럼 「없음」 으로 적은 항목은 검사에서 세지 않는다.
 */
'use strict';

const ID_SRC = '[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\\d+';
const HEAD_RE = /^###\s+([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)(?:\s+(.+?))?\s*$/;
const REF_RE = /^([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)$/;
// 논리 참조 대상: 테이블까지만 적어도 된다 (단축코드처럼 기본키가 아닌 컬럼을 가리키면 컬럼까지)
const LREF_RE = /^([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)(?:\.([A-Za-z_][\w$]*))?$/;
const LOGICAL = /^논리\s*:\s*/;
// 컬럼 표 머리 (영문도 받는다)
const COLS = {
  name: ['컬럼', '컬럼명', '물리명', 'column'],
  logical: ['논리명', '컬럼 논리명', 'logical'],
  type: ['타입', '자료형', '데이터 타입', 'type'],
  nullable: ['널', 'null', 'nullable', '널 허용'],
  keys: ['키', 'key', 'keys'],
  ref: ['참조', 'ref', 'references'],
  desc: ['설명', '비고', 'description'],
};
const LABELS = ['기능', '결정', '근거', '파티션', '보존', '공통 컬럼', '영역', '분류', 'ERD', '고정 스키마'];
const LABEL_RE = new RegExp(`(${LABELS.join('|')})\\s*:`, 'g');
const NONE = /^없음(?![\w가-힣])/;

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const isSep = (cells) => cells.every((c) => /^:?-{2,}:?$/.test(c));
const plain = (s) => String(s).replace(/`/g, '').replace(/\*\*/g, '').trim();
const idsIn = (s) => String(s).match(new RegExp(`(?<![\\w-])${ID_SRC}(?![\\w-])`, 'g')) || [];

/** 설명 줄 하나 → { desc, tags: { 기능: 값, … } } */
function splitTags(line) {
  const marks = [...line.matchAll(LABEL_RE)];
  if (!marks.length) return { desc: line.trim(), tags: {} };
  const tags = {};
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : line.length;
    tags[m[1]] = line.slice(m.index + m[0].length, end).trim().replace(/\s*[·,]\s*$/, '').replace(/\.$/, '').trim();
  });
  return { desc: line.slice(0, marks[0].index).trim().replace(/\s*[·,]\s*$/, '').replace(/\.$/, '').trim(), tags };
}

/**
 * 정의서 md 하나 → { tables, problems }
 * problems: 표 형식 문제 [{ line, table, msg }] (✖)
 */
function parseFile(text, file) {
  const tables = [];
  const problems = [];
  let t = null;
  let head = null; // 컬럼 표 머리 → 열 번호
  let inTable = false;
  let fence = false;
  String(text).split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
    if (fence) return;
    const h = HEAD_RE.exec(line);
    if (h) {
      t = { id: `${h[1]}.${h[2]}`, schema: h[1], name: h[2], logical: plain(h[3] || ''), heading: line.replace(/^###\s+/, '').trim(), desc: '', fns: [], noFns: false, refs: [], partition: '', retention: '', noAudit: false, areas: [], code: false, hideEdges: false, fixed: '', columns: [], file, line: i + 1 };
      tables.push(t);
      head = null; inTable = false;
      return;
    }
    if (/^#{1,6}\s/.test(line)) { t = null; return; } // 다른 제목이면 그 테이블 정의는 끝
    if (!t) return;
    if (/^\s*\|/.test(line)) {
      const cells = cellsOf(line);
      if (t.done) return; // 컬럼 표 뒤의 다른 표(인덱스 등)는 읽지 않는다
      if (!head) {
        const low = cells.map((c) => plain(c).toLowerCase());
        const col = (k) => low.findIndex((c) => COLS[k].includes(c));
        if (col('name') < 0 || col('type') < 0) { if (!inTable) problems.push({ line: i + 1, table: t.id, msg: '컬럼 표 머리에 「컬럼」 · 「타입」 이 없습니다 (컬럼 | 논리명 | 타입 | 널 | 키 | 참조 | 설명)' }); inTable = true; return; }
        head = Object.fromEntries(Object.keys(COLS).map((k) => [k, col(k)]));
        head.n = cells.length;
        inTable = true;
        return;
      }
      if (isSep(cells)) return;
      if (cells.length !== head.n) problems.push({ line: i + 1, table: t.id, msg: `칸 수가 머리(${head.n})와 다릅니다 (${cells.length}). 칸 안의 | 는 \\| 로` });
      const get = (k) => (head[k] >= 0 ? plain(cells[head[k]] || '') : '');
      const keys = get('keys').toUpperCase().split(/[,\s/·]+/).filter(Boolean);
      const name = get('name');
      if (!name) { problems.push({ line: i + 1, table: t.id, msg: '컬럼 이름이 비었습니다' }); return; }
      const ref = get('ref');
      const lref = LOGICAL.test(ref);
      t.columns.push({ name, logical: get('logical'), type: get('type'), nullable: /^(y|yes|o|null|✔|허용)$/i.test(get('nullable')), pk: keys.includes('PK'), fk: keys.includes('FK'), uk: keys.includes('UK'), ref: lref ? ref.replace(LOGICAL, '').trim() : ref, ...(lref ? { lref: true } : {}), desc: get('desc'), line: i + 1 });
      return;
    }
    if (inTable && head) { t.done = true; inTable = false; return; }
    if (!line.trim() || t.columns.length) return;
    const { desc, tags } = splitTags(plain(line.replace(/^>\s?/, '')));
    if (desc && !t.desc) t.desc = desc;
    if (tags['기능'] != null) { if (NONE.test(tags['기능'])) t.noFns = true; else t.fns.push(...idsIn(tags['기능'])); }
    if (tags['파티션']) t.partition = tags['파티션'];
    if (tags['보존']) t.retention = tags['보존'];
    if (tags['공통 컬럼'] != null && NONE.test(tags['공통 컬럼'])) t.noAudit = true;
    // 영역 이름에는 쌍점이 없다: 모르는 꼬리표(「예외: …」 등)가 뒤에 붙으면 거기서 끊는다
    if (tags['영역']) { const xs = tags['영역'].split(/\s*[,·]\s*/).filter(Boolean); const cut = xs.findIndex((x) => /:/.test(x)); t.areas.push(...(cut < 0 ? xs : xs.slice(0, cut))); }
    if (tags['분류'] && /코드/.test(tags['분류'])) t.code = true;
    if (tags['ERD'] && /선\s*숨김/.test(tags['ERD'])) t.hideEdges = true;
    if (tags['고정 스키마'] != null) t.fixed = tags['고정 스키마'] || '근거 없음';
    t.refs.push(...idsIn(line));
  });
  for (const x of tables) {
    delete x.done;
    x.fns = [...new Set(x.fns)];
    x.areas = [...new Set(x.areas)];
    x.refs = [...new Set([...x.refs, ...x.columns.flatMap((c) => idsIn(c.desc))])];
  }
  return { tables, problems };
}

/** 폴더 하나의 정의서들 { 파일: 내용 } → 모델 { schemas, tables, rels, lrels, problems } (파일 이름 순). lrels = 논리 참조 (대상이 정의서에 있는 것만) */
function model(files) {
  const tables = [];
  const problems = [];
  for (const f of Object.keys(files).sort()) {
    const r = parseFile(files[f], f);
    tables.push(...r.tables);
    problems.push(...r.problems.map((p) => ({ ...p, file: f })));
  }
  const schemas = [...new Set(tables.map((t) => t.schema))];
  const byId = new Map(tables.map((t) => [t.id, t]));
  const rels = [];
  for (const t of tables) for (const c of t.columns) if (c.fk) {
    const m = REF_RE.exec(c.ref);
    if (m && byId.has(`${m[1]}.${m[2]}`)) rels.push({ from: `${m[1]}.${m[2]}`, fromCol: m[3], to: t.id, toCol: c.name, nullable: c.nullable });
  }
  const lrels = [];
  for (const t of tables) for (const c of t.columns) if (c.lref && !c.fk) {
    const m = LREF_RE.exec(c.ref);
    if (m && byId.has(`${m[1]}.${m[2]}`)) lrels.push({ from: `${m[1]}.${m[2]}`, fromCol: m[3] || '', to: t.id, toCol: c.name, nullable: c.nullable, logical: true });
  }
  return { schemas, tables, rels, lrels, problems };
}

/** 정의서가 들어 있는가 (「### 스키마.테이블」 제목 뒤 컬럼 표) */
const hasTables = (text) => parseFile(text, '').tables.some((t) => t.columns.length);

// 이름 규칙 (vars.datamodel.naming): 이름 하나 또는 ^ 로 시작하는 정규식
const NAMING = {
  snake_case: /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/,
  UPPER_SNAKE: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/,
  camelCase: /^[a-z][a-zA-Z0-9]*$/,
  PascalCase: /^[A-Z][a-zA-Z0-9]*$/,
};
function namingRe(v) {
  if (!v) return null;
  if (NAMING[v]) return NAMING[v];
  try { return new RegExp(v); } catch { return null; }
}
const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
const TIME_NAME = /(_at|At|_AT|_dt|_DT|_ts|_TS)$/;

const yes = (v) => /^(y|yes|true|on|예|켬)$/i.test(String(v || '').trim());
const JSON_TYPE = /^jsonb?\b/i;
const JSON_OK = /JSON\s*허용\s*:/i;
// SQLite: 저장 형식(타입 친화도) 다섯 가지. 그 밖의 이름(VARCHAR · DATETIME 등)도 받아 주지만 친화도 규칙으로 바뀌어 저장돼 정의서와 실제가 어긋난다
const SQLITE_TYPES = ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'];
const isSqlite = (d) => /^sqlite3?$/i.test(String(d || '').trim());

/**
 * 검사. conv = vars.datamodel ({ dialect, naming, tablePrefix, pkType, auditColumns, timeType, jsonReason }). dialect 가 sqlite 면 타입이 SQLite 타입(INTEGER · TEXT · REAL · BLOB · NUMERIC)인지도 본다
 * 반환 { errors, warns } (문자열, 「파일:줄 테이블」 로 시작)
 */
function check(m, conv = {}) {
  const errors = [];
  const warns = [];
  for (const p of m.problems) errors.push(`${p.file}:${p.line} ${p.table}: ${p.msg}`);
  const byId = new Map();
  const nameRe = namingRe(conv.naming);
  const audit = list(conv.auditColumns);
  const pkType = String(conv.pkType || '').trim().toLowerCase();
  const timeType = String(conv.timeType || '').trim().toLowerCase();
  const sqlite = isSqlite(conv.dialect);
  for (const t of m.tables) {
    const at = `${t.file}:${t.line} ${t.id}`;
    if (byId.has(t.id)) errors.push(`${at}: 같은 이름 테이블이 또 있습니다 (${byId.get(t.id).file}:${byId.get(t.id).line})`);
    else byId.set(t.id, t);
  }
  for (const t of m.tables) {
    const at = `${t.file}:${t.line} ${t.id}`;
    if (!t.columns.length) { errors.push(`${at}: 컬럼 표가 없습니다`); continue; }
    // 고정 스키마(프레임워크가 만드는 테이블): 이름 · 컬럼을 바꿀 수 없으므로 기본키 없음은 ⚠, 이름 · 공통 컬럼 · 타입 규칙은 보지 않는다
    const fx = t.fixed;
    if (!t.columns.some((c) => c.pk)) (fx ? warns : errors).push(`${at}: 기본키(PK)가 없습니다${fx ? ` (고정 스키마: ${fx})` : ''}`);
    const seen = new Set();
    for (const c of t.columns) {
      if (seen.has(c.name)) errors.push(`${at}.${c.name}: 같은 이름 컬럼이 또 있습니다`);
      seen.add(c.name);
      if (!c.type) errors.push(`${at}.${c.name}: 타입이 비었습니다`);
      if (c.fk) {
        const r = REF_RE.exec(c.ref);
        if (!r) { errors.push(`${at}.${c.name}: FK 인데 참조(<스키마>.<테이블>.<컬럼>)가 없습니다`); continue; }
        const rt = byId.get(`${r[1]}.${r[2]}`);
        if (!rt) errors.push(`${at}.${c.name}: 참조 테이블 ${r[1]}.${r[2]} 이 없습니다`);
        else if (!rt.columns.some((x) => x.name === r[3])) errors.push(`${at}.${c.name}: 참조 컬럼 ${c.ref} 이 없습니다`);
        if (c.lref) warns.push(`${at}.${c.name}: FK 인데 참조가 「논리:」 입니다 (DB 외래키를 걸면 「논리:」 를 지우고, 안 걸면 키에서 FK 를 뺀다)`);
      } else if (c.lref) {
        const r = LREF_RE.exec(c.ref);
        if (!r) warns.push(`${at}.${c.name}: 논리 참조(${c.ref})는 <스키마>.<테이블>[.<컬럼>] 으로 적습니다`);
        else {
          const rt = byId.get(`${r[1]}.${r[2]}`);
          if (!rt) warns.push(`${at}.${c.name}: 논리 참조 테이블 ${r[1]}.${r[2]} 이 정의서에 없습니다`);
          else if (r[3] && !rt.columns.some((x) => x.name === r[3])) warns.push(`${at}.${c.name}: 논리 참조 컬럼 ${c.ref} 이 없습니다`);
        }
      } else if (c.ref) warns.push(`${at}.${c.name}: 참조(${c.ref})가 있는데 키에 FK 가 없습니다 (DB 외래키 없이 앱이 지키면 참조 칸에 「논리: ${c.ref}」)`);
      if (!c.logical) warns.push(`${at}.${c.name}: 컬럼 논리명이 없습니다`);
      if (fx) continue;
      if (nameRe && !nameRe.test(c.name)) warns.push(`${at}.${c.name}: 컬럼 이름 규칙(${conv.naming})과 다릅니다`);
      if (timeType && (TIME_NAME.test(c.name) || /일시$/.test(c.logical)) && !c.type.toLowerCase().startsWith(timeType)) warns.push(`${at}.${c.name}: 시점 타입이 ${conv.timeType} 가 아닙니다 (${c.type})`);
      if (sqlite && c.type && !SQLITE_TYPES.includes(c.type.replace(/\(.*$/, '').trim().toUpperCase())) warns.push(`${at}.${c.name}: SQLite 타입(${SQLITE_TYPES.join(' · ')})이 아닙니다 (${c.type}). 일시는 TEXT(ISO 8601) 또는 INTEGER(유닉스 시각)로 적는다`);
      if (yes(conv.jsonReason) && JSON_TYPE.test(c.type) && !JSON_OK.test(c.desc)) warns.push(`${at}.${c.name}: JSON 컬럼(${c.type})인데 설명에 「JSON 허용: <사유>」 가 없습니다`);
    }
    if (!t.logical) warns.push(`${at}: 테이블 논리명이 없습니다 (「### 스키마.테이블 논리명」)`);
    if (!fx) {
      if (nameRe && !nameRe.test(t.name)) warns.push(`${at}: 테이블 이름 규칙(${conv.naming})과 다릅니다`);
      if (conv.tablePrefix && !t.name.startsWith(conv.tablePrefix)) warns.push(`${at}: 테이블 접두어(${conv.tablePrefix})가 없습니다`);
      const pk = t.columns.filter((c) => c.pk);
      if (pkType && pk.length === 1 && !pk[0].fk && !pk[0].type.toLowerCase().startsWith(pkType)) warns.push(`${at}.${pk[0].name}: 기본키 타입이 ${conv.pkType} 가 아닙니다 (${pk[0].type})`);
      if (audit.length && !t.noAudit) {
        const miss = audit.filter((a) => !t.columns.some((c) => c.name === a));
        if (miss.length) warns.push(`${at}: 공통 컬럼 ${miss.join(' · ')} 이 없습니다 (빼는 테이블이면 설명 줄에 「공통 컬럼: 없음」)`);
      }
    }
    if (!t.fns.length && !t.noFns) warns.push(`${at}: 이 테이블을 쓰는 기능 ID 가 없습니다 (「기능: FN-…」, 없으면 「기능: 없음」)`);
  }
  // 주제 영역: 일부 테이블에만 있으면 ERD 영역 보기에서 빠지는 테이블이 생긴다
  const noArea = m.tables.filter((t) => !t.areas.length);
  if (noArea.length && noArea.length < m.tables.length) warns.unshift(`영역 꼬리표가 ${m.tables.length - noArea.length}/${m.tables.length} 테이블에만 있습니다. 없는 테이블: ${noArea.slice(0, 8).map((t) => t.id).join(', ')}${noArea.length > 8 ? ` 외 ${noArea.length - 8}개` : ''} (설명 줄에 「영역: …」)`);
  return { errors, warns };
}

module.exports = { parseFile, model, hasTables, check, namingRe, splitTags, idsIn, REF_RE, LREF_RE, NAMING, SQLITE_TYPES, isSqlite };
