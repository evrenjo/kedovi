// 결함 기록: 작업별 기록(handoffs/<id>/topics/<티켓>.md) 머리의 결함 칸을 읽고 검사 · 월간 집계한다. handoff.js check · bin/defects.js 가 같이 쓴다. 의존성 없음
/*
 * 운영 결함 기록의 머리 (ticket 스킬 · 35-issue-handling 룰):
 *   종류: 운영 결함          ← vars.defects.kinds 중 하나면 결함 기록으로 본다
 *   분류: 외부 API 가정       ← vars.defects.categories 중 하나 (필수)
 *   발견: 2026-11-03 10:20    ← 필수
 *   해소: 2026-11-04 09:00    ← 상태가 완료면 필수
 *   원인 커밋: abc1234        ← 선택. 있으면 그 커밋 시각부터 발견까지를 잠복으로 센다 (또는 발생: <시각>)
 */
'use strict';
const { spawnSync } = require('child_process');

const DEFAULT_KINDS = ['운영 결함', '장애'];
const DEFAULT_CATEGORIES = ['외부 API 가정', '수명', 'CI 자원', '환경', '한도', '실데이터 모양', '운영 절차', '파이프라인', 'flaky/TZ', '문서 신선도'];

const list = (v, d) => {
  const a = (Array.isArray(v) ? v : String(v == null ? '' : v).split(',')).map((x) => String(x).trim()).filter(Boolean);
  return a.length ? a : d;
};
/** workspace.json vars.defects → { kinds, categories } (비우면 기본) */
function settings(ws) {
  const v = (ws && ws.vars && ws.vars.defects) || {};
  return { kinds: list(v.kinds, DEFAULT_KINDS), categories: list(v.categories, DEFAULT_CATEGORIES) };
}

/** "2026-11-03 10:20" · "2026-11-03T10:20" · "2026-11-03" (이 PC 시간대) → ms. 못 읽으면 null */
function parseTime(s) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(String(s || '').trim());
  if (!m) return null;
  const iso = `${m[1]}T${(m[2] || '00').padStart(2, '0')}:${m[3] || '00'}:${m[4] || '00'}${m[5] ? m[5].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2') : ''}`;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** 본문 → 결함 칸. 결함 기록이 아니면 null */
function parseDefect(text, cfg) {
  const head = (k) => ((String(text).match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'm')) || [])[1] || '').trim();
  const kind = head('종류');
  if (!kind || !cfg.kinds.some((k) => kind.includes(k))) return null;
  const cause = head('원인 커밋');
  return {
    kind, category: head('분류'), status: head('상태') || '진행 중',
    found: head('발견'), resolved: head('해소'), occurred: head('발생'),
    causeCommit: (cause.match(/\b[0-9a-f]{7,40}\b/i) || [])[0] || '',
    causeRepo: (cause.match(/^([\w./-]+)@/) || [])[1] || '',
  };
}

const DONE = /^(완료|해소|닫힘|done|closed)/i;

/** 결함 기록의 빈 칸 · 잘못된 값 → 문구 목록 */
function problems(d, cfg) {
  const out = [];
  if (!d.found) out.push('발견 시각(발견:)이 없다');
  else if (parseTime(d.found) == null) out.push(`발견 시각을 읽지 못했다: ${d.found} (YYYY-MM-DD HH:MM)`);
  if (!d.category) out.push(`분류(분류:)가 없다. 다음 중 하나: ${cfg.categories.join(' · ')}`);
  else if (!cfg.categories.includes(d.category)) out.push(`분류 「${d.category}」 가 목록에 없다: ${cfg.categories.join(' · ')} (목록은 vars.defects.categories)`);
  if (DONE.test(d.status) && !d.resolved) out.push('상태가 완료인데 해소 시각(해소:)이 없다');
  if (d.resolved && parseTime(d.resolved) == null) out.push(`해소 시각을 읽지 못했다: ${d.resolved}`);
  if (d.resolved && d.found && parseTime(d.resolved) != null && parseTime(d.found) != null && parseTime(d.resolved) < parseTime(d.found)) out.push('해소 시각이 발견 시각보다 앞이다');
  return out;
}

/** 원인 커밋 시각 (repo 목록에서 찾는다). 못 찾으면 null */
function commitTime(sha, dirs) {
  for (const dir of dirs) {
    const r = spawnSync('git', ['-C', dir, 'show', '-s', '--format=%cI', sha], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (r.status === 0 && r.stdout.trim()) { const t = new Date(r.stdout.trim()).getTime(); if (!Number.isNaN(t)) return t; }
  }
  return null;
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** 분 → "3.5일" · "4.2시간" · "12분" */
function span(min) {
  if (min == null) return '-';
  if (min >= 1440) return `${(min / 1440).toFixed(1)}일`;
  if (min >= 60) return `${(min / 60).toFixed(1)}시간`;
  return `${Math.round(min)}분`;
}
const monthOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/**
 * 월간 집계. records = [{ file, defect }], month = 'YYYY-MM' (발견 시각 기준). dirs = 원인 커밋을 찾을 repo 폴더.
 * 반환 { month, count, open, byCategory: [{ category, count, latency(분 중앙값), resolve(분 중앙값) }], latency, resolve, missing }
 */
function report(records, month, { dirs = [], timeOf = commitTime } = {}) {
  const rows = [];
  let missing = 0;
  for (const r of records) {
    const found = parseTime(r.defect.found);
    if (found == null) { missing++; continue; }
    if (monthOf(found) !== month) continue;
    const resolved = parseTime(r.defect.resolved);
    const occurred = parseTime(r.defect.occurred) != null ? parseTime(r.defect.occurred) : (r.defect.causeCommit ? timeOf(r.defect.causeCommit, dirs) : null);
    rows.push({ ...r, category: r.defect.category || '(분류 없음)', latency: occurred != null && occurred <= found ? (found - occurred) / 60000 : null, resolve: resolved != null && resolved >= found ? (resolved - found) / 60000 : null });
  }
  const cats = [...new Set(rows.map((x) => x.category))];
  const byCategory = cats.map((c) => {
    const xs = rows.filter((x) => x.category === c);
    const lat = xs.map((x) => x.latency).filter((x) => x != null);
    const res = xs.map((x) => x.resolve).filter((x) => x != null);
    return { category: c, count: xs.length, latency: median(lat), latencyN: lat.length, resolve: median(res), resolveN: res.length, resolveSum: res.reduce((a, b) => a + b, 0) };
  }).sort((a, b) => b.resolveSum - a.resolveSum || b.count - a.count);
  const lat = rows.map((x) => x.latency).filter((x) => x != null);
  const res = rows.map((x) => x.resolve).filter((x) => x != null);
  return { month, count: rows.length, open: rows.filter((x) => x.resolve == null).length, byCategory, latency: median(lat), latencyN: lat.length, resolve: median(res), resolveN: res.length, missing };
}

module.exports = { DEFAULT_KINDS, DEFAULT_CATEGORIES, settings, parseTime, parseDefect, problems, report, commitTime, median, span, monthOf };
