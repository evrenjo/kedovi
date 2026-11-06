// 환경 사실 표의 신선도: 「확인일」 칸이 있는 md 표에서 오래된 행을 찾는다. 훅(fact-freshness) · 문서 점검(docsref.health)이 같이 쓴다. 의존성 없음
/*
 * 대상 표: 머리 줄에 「확인일」 칸이 있는 표 (「확인 명령」 칸은 있으면 함께 알린다). 칸이 없는 옛 표는 보지 않는다.
 * 확인일 = YYYY-MM-DD (또는 YYYY.MM.DD · YYYY/MM/DD). 코드 블록(``` · ~~~) 안의 표(양식 예시)는 뺀다.
 * 사실 이름 = 「사실」 · 「항목」 칸, 없으면 첫 칸 (+ 「값」 칸이 있으면 함께).
 */
'use strict';

const DEFAULT_DAYS = 30;

/** vars.docs.factDays → 일수. 0 · off = 끔 */
function daysOf(ws) {
  const v = ws && ws.vars && ws.vars.docs ? ws.vars.docs.factDays : undefined;
  if (v === undefined || v === null || v === '') return DEFAULT_DAYS;
  if (/^off$/i.test(String(v))) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAYS;
}

const cells = (line) => {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim());
};
const plain = (s) => String(s).replace(/\*\*|__|`/g, '').trim();
const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** "2026-10-01" → 그날 0시(이 PC 시간대) ms. 없으면 null */
function dateOf(s) {
  const m = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(String(s || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? null : d.getTime();
}

/**
 * 표의 사실 행 전부 → [{ line, fact, date, command, age(일, 확인일 없으면 null) }]
 * now = 기준 시각(ms, 기본 지금)
 */
function factRows(text, now = Date.now()) {
  const lines = String(text).split('\n');
  const out = [];
  let fence = null;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = /^\s*(```|~~~)/.exec(l);
    if (f) { fence = fence ? (fence === f[1] ? null : fence) : f[1]; continue; }
    if (fence || !/^\s*\|/.test(l) || !SEP.test(lines[i + 1] || '')) continue;
    const head = cells(l).map(plain);
    const at = head.indexOf('확인일');
    if (at < 0) continue;
    const cmdAt = head.indexOf('확인 명령');
    let factAt = head.findIndex((h) => h === '사실' || h === '항목');
    if (factAt < 0) factAt = 0;
    const valAt = head.indexOf('값');
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const c = cells(lines[j]);
      const raw = c[at] || '';
      const d = dateOf(raw);
      const fact = plain(c[factAt] || '') + (valAt >= 0 && valAt !== factAt && c[valAt] ? ` = ${plain(c[valAt])}` : '');
      out.push({ line: j + 1, fact, date: d != null ? raw.match(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/)[0] : plain(raw), command: cmdAt >= 0 ? plain(c[cmdAt] || '') : '', age: d != null ? Math.floor((today.getTime() - d) / 86400000) : null });
    }
    i = j - 1;
  }
  return out;
}

/** 확인일이 days 일보다 오래된 행 */
const staleRows = (text, days = DEFAULT_DAYS, now = Date.now()) => (days > 0 ? factRows(text, now).filter((r) => r.age != null && r.age > days) : []);
/** 확인일이 비었거나 날짜가 아닌 행 (자리표시 <…> · … · - 는 뺀다) */
const undatedRows = (text, now = Date.now()) => factRows(text, now).filter((r) => r.age == null && !/^(<[^>]*>|…|\.\.\.|-)$/.test(r.date)); // 양식 자리표시 · 해당 없음(-)은 뺀다

/** 알림 한 줄 */
const staleLine = (r) => `재확인 필요: ${r.fact} (확인일 ${r.date} · ${r.age}일 전${r.command ? `, 확인 명령 ${r.command}` : ''})`;

module.exports = { DEFAULT_DAYS, daysOf, factRows, staleRows, undatedRows, staleLine, dateOf };
