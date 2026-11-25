// 워크스페이스 문서 사이트의 문서별 지난 판 (assets/history/<이름>.json): 화면의 「바뀐 점 보기」 가 필요할 때만 읽는다 (site-db.json 은 작게).
// 문서(md)마다 최근 커밋(기본 20개 · 180일, docs-site.json "history": { "commits", "days" })과 그때의 md 글을 남긴다.
// 비교(줄 diff)는 브라우저가 한다. 같은 글은 한 번만 (texts 번호로 가리킨다). Node 기본 모듈만.
// 상한: 한 판 200KB 넘는 문서 · 문서 하나 1MB · 사이트 전체 5MB 를 넘는 쪽은 넣지 않는다 (화면은 「이전 판이 없습니다」).
'use strict';
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DIR = 'assets/history';
const DEF = { commits: 20, days: 180 };
const CAP = { text: 200 * 1024, file: 1024 * 1024, total: 5 * 1024 * 1024 };

function git(dir, args, input) {
  try {
    return execFileSync('git', ['-C', dir, '-c', 'core.quotePath=false', ...args], { input, encoding: input == null ? 'utf8' : null, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024, timeout: 60000 });
  } catch { return input == null ? '' : null; }
}

/** docs-site.json "history" → { commits, days } | null (false 면 끔) */
function optsOf(config) {
  const h = config && config.history;
  if (h === false) return null;
  const o = h && typeof h === 'object' ? h : {};
  const n = (v, d, max) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(Math.floor(Number(v)), max) : d);
  return { commits: n(o.commits, DEF.commits, 100), days: n(o.days, DEF.days, 3650) };
}

/** 문서 경로 → 사이트 안 파일 (경로만으로 정해진다: 다시 만들어도 같은 이름) */
const fileOf = (md) => `${DIR}/${crypto.createHash('sha1').update(String(md)).digest('hex').slice(0, 12)}.json`;

/** git cat-file --batch 로 여러 「커밋:경로」 의 글을 한 번에. 반환 [글 | null] (없거나 글이 아니면 null) */
function blobs(dir, specs) {
  if (!specs.length) return [];
  const buf = git(dir, ['cat-file', '--batch'], `${specs.join('\n')}\n`);
  const out = [];
  if (!buf) return specs.map(() => null);
  let i = 0;
  for (let k = 0; k < specs.length; k++) {
    const nl = buf.indexOf(10, i);
    if (nl < 0) { out.push(null); continue; }
    const head = buf.slice(i, nl).toString('utf8').split(' ');
    i = nl + 1;
    if (head[1] !== 'blob') { out.push(null); continue; }
    const size = Number(head[2]);
    const body = buf.slice(i, i + size);
    i += size + 1;
    out.push(size > CAP.text || body.includes(0) ? null : body.toString('utf8'));
  }
  return out;
}

/** 한 repo 안 문서들의 지난 판. items [{ md(사이트 안 경로), rel(그 repo 폴더 기준 경로) }] → { md: 기록 } */
function repoHistory(dir, items, o, who, now) {
  const out = {};
  if (git(dir, ['rev-parse', '--is-inside-work-tree']).trim() !== 'true' || !items.length) return out;
  const shallow = git(dir, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  const cutoff = new Date(now - o.days * 86400000).toISOString();
  // 기간 안에 바뀐 파일만 (문서마다 git log 를 부르기 전에 한 번 거른다)
  const recent = new Set(git(dir, ['log', '--no-merges', '--relative', `--since=${cutoff}`, '--format=', '--name-only', '--', '.']).split('\n').map((s) => s.trim()).filter(Boolean));
  for (const it of items) {
    if (!recent.has(it.rel)) continue;
    const log = git(dir, ['log', '--follow', '--no-merges', `-n${o.commits + 1}`, '--format=%x1e%h%x1f%H%x1f%aI%x1f%an%x1f%ae%x1f%s', '--name-only', '--', it.rel]);
    const list = [];
    for (const chunk of log.split('\x1e')) {
      if (!chunk.trim()) continue;
      const [head, ...names] = chunk.split('\n');
      const [sha, full, at, name, email, subject] = head.split('\x1f');
      const p = names.map((s) => s.trim()).filter(Boolean).pop();
      if (p) list.push({ sha, full, at, name, email, subject: subject || '', path: p });
    }
    if (!list.length) continue;
    // 기간 안 커밋 (최대 commits 개) + 그 앞 판 하나(바탕)
    let keep = list.filter((c, k) => k < o.commits && new Date(c.at).getTime() >= now - o.days * 86400000);
    if (!keep.length) continue;
    const prev = list[keep.length] || null;
    const texts = blobs(dir, [...keep, ...(prev ? [prev] : [])].map((c) => `${c.full}:${c.path}`));
    // 글로 못 읽은 판(너무 큼 · 글이 아님)부터는 뒤를 버린다
    const bad = texts.findIndex((t) => t == null);
    let base;
    if (bad >= 0 && bad < keep.length) { keep = keep.slice(0, bad); base = null; } else base = prev ? texts[keep.length] : (shallow ? null : '');
    if (!keep.length) continue;
    const rec = { md: it.md, texts: [], commits: [], base: null };
    const idx = (t) => { let k = rec.texts.indexOf(t); if (k < 0) { rec.texts.push(t); k = rec.texts.length - 1; } return k; };
    keep.forEach((c, k) => rec.commits.push({ sha: c.sha, at: c.at, by: who(c.name, c.email), summary: c.subject, t: idx(texts[k]) }));
    rec.base = base == null ? null : idx(base);
    out[it.md] = rec;
  }
  return out;
}

const sizeOf = (rec) => Buffer.byteLength(JSON.stringify(rec));

/** 문서 하나 상한: 넘치면 오래된 커밋부터 빼고, 뺀 판을 바탕으로 */
function trim(rec, cap) {
  while (rec.commits.length > 1 && sizeOf(rec) > cap) {
    const old = rec.commits.pop();
    rec.base = old.t;
    const used = new Set([...rec.commits.map((c) => c.t), rec.base]);
    const map = new Map();
    const texts = [];
    rec.texts.forEach((t, k) => { if (used.has(k)) { map.set(k, texts.length); texts.push(t); } });
    rec.texts = texts;
    rec.commits.forEach((c) => { c.t = map.get(c.t); });
    rec.base = map.get(rec.base);
  }
  return sizeOf(rec) <= cap ? rec : null;
}

/**
 * 사이트에 넣을 지난 판 파일. docs [{ md, page, dir(git 폴더), rel(그 폴더 기준 경로) }].
 * 반환 { pages: { 'assets/history/<이름>.json': 글 }, map: { 쪽: 파일 }, skipped: 수 }
 */
function collect(docs, opts = {}) {
  const o = opts.config === undefined ? { ...DEF } : optsOf(opts.config);
  const res = { pages: {}, map: {}, skipped: 0 };
  if (!o) return res;
  const cap = { ...CAP, ...(opts.cap || {}) };
  const who = opts.who || ((n) => n);
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const byDir = new Map();
  for (const d of docs) if (d && d.dir && d.md && /\.md$/i.test(d.md)) { if (!byDir.has(d.dir)) byDir.set(d.dir, []); byDir.get(d.dir).push(d); }
  const recs = [];
  for (const [dir, items] of byDir) {
    const got = repoHistory(dir, items, o, who, now);
    for (const d of items) if (got[d.md]) recs.push({ d, rec: got[d.md] });
  }
  // 최근에 바뀐 문서부터 전체 상한 안에서
  recs.sort((a, b) => String(b.rec.commits[0].at).localeCompare(String(a.rec.commits[0].at)) || a.d.md.localeCompare(b.d.md));
  let total = 0;
  for (const { d, rec } of recs) {
    const r = trim(rec, cap.file);
    const body = r ? `${JSON.stringify({ v: 1, ...r })}\n` : null;
    if (!body || total + Buffer.byteLength(body) > cap.total) { res.skipped++; continue; }
    total += Buffer.byteLength(body);
    const f = fileOf(d.md);
    res.pages[f] = body;
    res.map[d.page] = f;
  }
  return res;
}

module.exports = { DIR, DEF, CAP, optsOf, fileOf, collect };
