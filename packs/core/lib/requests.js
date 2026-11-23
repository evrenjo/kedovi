// 요청 장부: 사용자 요청마다 번호 · 맡은 에이전트 · 상태 · 결과. 쓰는 곳: hooks/request-ledger.js (기록 · 답변 끝 표 검사) · bin/requests.js (kedovi requests)
/*
 * 파일 = handoffs/<id>/topics/요청-목록.md (작업 기록 머리 형식. 상태: 기록 이라 진행 중 작업 · 완료 조건 점검에 잡히지 않는다)
 * 표 한 줄 = | 번호 | 받은 때 | 요청 | 맡은 에이전트 | 상태 | 결과 |. 칸 안의 | 는 ¦ 로 바꿔 적는다
 * 상태: 접수 · 진행 · 완료 · 보류 · 취소. 열린 요청 = 완료 · 취소가 아닌 것
 */
'use strict';
const fs = require('fs');
const path = require('path');

const NAME = '요청-목록';
const STATUSES = ['접수', '진행', '완료', '보류', '취소'];
const CLOSED = ['완료', '취소'];
const HEAD = '| 번호 | 받은 때 | 요청 | 맡은 에이전트 | 상태 | 결과 |';
const TABLE_HEAD = '| 번호 | 요청 | 맡은 에이전트 | 상태 | 결과 |';
/** 답변 끝 표가 있나 (머리 줄 모양) */
const TABLE_RE = /^\s*\|\s*번호\s*\|\s*요청\s*\|[^\n]*상태[^\n]*\|\s*$/m;
const SUMMARY_MAX = 80;

// 맞장구 · 고마움: 새 요청으로 적지 않는다
const ACK_RE = /^(응+|어+|네+|넵|예|ㅇㅇ+|ㅇㅋ|ok(ay)?|yes|y|good|좋아(요)?|좋습니다|굿|고마워(요)?|감사(합니다|해요)?|땡큐|thanks?|thx|확인(했어|했습니다)?|알겠(어|습니다)(요)?|그래(요)?|맞아(요)?)[.!~ ]*$/i;
// 짧은 승인 · 재촉: 열린 직전 요청에 붙인다 (없으면 새 요청)
const GO_RE = /^(진행(해|해줘|하자|해요|해 ?주세요)?|계속(해|해줘|하자)?|ㄱㄱ|고고|go|해(줘|주세요)|그렇게 ?해(줘)?|그걸로|그대로 ?(해|진행)(줘)?|시작(해|해줘)|배포(해|해줘|하자)|머지(해|해줘)|커밋(해|해줘)|올려(줘)?)[.!~ ]*$/i;

const two = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
const today = (d = new Date()) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const cell = (s) => String(s == null ? '' : s).replace(/\r?\n+/g, ' ').replace(/\|/g, '¦').trim();

function fileOf(root, id) { return path.join(root, 'handoffs', id, 'topics', `${NAME}.md`); }

/** 요청 원문 → 장부에 적을 요약 (태그 · 공백 정리, 앞 80자, 비밀값 모양이면 가림) */
function summarize(text) {
  let s = String(text || '').replace(/<\/?[a-z_-]+(?:\s[^>]*)?>/gi, ' ').replace(/\s+/g, ' ').trim();
  try { if (require('../hooks/secret-guard').scanOutput(s).length) return '(비밀값 모양이 있어 내용 가림)'; } catch { /* 검사기 없음 */ }
  if (s.length > SUMMARY_MAX) s = `${s.slice(0, SUMMARY_MAX - 1)}…`;
  return s;
}

/** 요청 종류: ack = 적지 않음 · go = 직전 열린 요청에 붙임 · new = 새 요청 · skip = 빈 것 */
function kindOf(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return 'skip';
  if (s.length <= 20 && ACK_RE.test(s)) return 'ack';
  if (s.length <= 20 && GO_RE.test(s)) return 'go';
  return 'new';
}

/** 장부 읽기 → [{ no, at, text, agent, status, result }] (번호 순) */
function read(root, id) {
  let t = '';
  try { t = fs.readFileSync(fileOf(root, id), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of t.split('\n')) {
    const m = line.match(/^\|\s*(\d+)\s*\|(.*)\|\s*$/);
    if (!m) continue;
    const c = m[2].split('|').map((x) => x.trim());
    out.push({ no: Number(m[1]), at: c[0] || '', text: c[1] || '', agent: c[2] || '', status: c[3] || '접수', result: c[4] || '' });
  }
  return out.sort((a, b) => a.no - b.no);
}

const KEEP = 300; // 이보다 많으면 오래된 끝난 요청부터 덜어 낸다 (열린 요청은 남긴다)

function write(root, id, rows) {
  const f = fileOf(root, id);
  while (rows.length > KEEP) { const i = rows.findIndex((r) => !isOpen(r)); if (i < 0) break; rows = [...rows.slice(0, i), ...rows.slice(i + 1)]; }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const open = rows.filter(isOpen).length;
  const body = [
    '# 요청 목록',
    '',
    '관련: 메인 대화의 사용자 요청 장부 (kedovi requests, 요청 시작 훅이 자동 기록)',
    '상태: 기록',
    `마지막: ${today()}`,
    `한 줄: 요청 ${rows.length}건 · 열린 요청 ${open}건`,
    '',
    HEAD,
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.no} | ${cell(r.at)} | ${cell(r.text)} | ${cell(r.agent)} | ${cell(r.status)} | ${cell(r.result)} |`),
    '',
  ].join('\n');
  fs.writeFileSync(f, body);
}

const isOpen = (r) => !CLOSED.includes(r.status);

/** 새 요청 한 줄 → 그 행 */
function add(root, id, text, { agent = '메인', at = new Date() } = {}) {
  const rows = read(root, id);
  const row = { no: (rows.length ? rows[rows.length - 1].no : 0) + 1, at: stamp(at), text: summarize(text), agent, status: '접수', result: '' };
  write(root, id, [...rows, row]);
  return row;
}

/** 열린 직전 요청에 짧은 승인을 붙인다 (접수면 진행으로). 열린 것이 없으면 null */
function attach(root, id, text) {
  const rows = read(root, id);
  const last = [...rows].reverse().find(isOpen);
  if (!last) return null;
  const note = summarize(text);
  if (!last.text.includes(`(+ ${note})`)) last.text = `${last.text} (+ ${note})`.slice(0, SUMMARY_MAX * 2);
  if (last.status === '접수') last.status = '진행';
  write(root, id, rows);
  return last;
}

/** 요청 원문을 종류대로 적는다 → { kind, row } */
function record(root, id, text, opts) {
  const kind = kindOf(text);
  if (kind === 'skip' || kind === 'ack') return { kind, row: null };
  if (kind === 'go') { const row = attach(root, id, text); if (row) return { kind, row }; }
  return { kind: 'new', row: add(root, id, text, opts) };
}

/** 번호의 칸을 바꾼다 → 바뀐 행 (없으면 null) */
function set(root, id, no, patch) {
  const rows = read(root, id);
  const r = rows.find((x) => x.no === Number(no));
  if (!r) return null;
  for (const k of ['status', 'agent', 'result']) if (patch[k] !== undefined) r[k] = String(patch[k]);
  write(root, id, rows);
  return r;
}

/** 열린 요청 표 (답변 끝에 붙이는 모양). 없으면 '' */
function table(rows, max = 12) {
  const open = rows.filter(isOpen);
  if (!open.length) return '';
  const shown = open.slice(-max);
  return [TABLE_HEAD, '|---|---|---|---|---|', ...shown.map((r) => `| ${r.no} | ${cell(r.text)} | ${cell(r.agent)} | ${cell(r.status)} | ${cell(r.result) || '-'} |`),
    ...(open.length > shown.length ? [`| … | 앞선 열린 요청 ${open.length - shown.length}건 (kedovi requests list) | | | |`] : [])].join('\n');
}

module.exports = { NAME, STATUSES, CLOSED, HEAD, TABLE_HEAD, TABLE_RE, fileOf, summarize, kindOf, read, write, isOpen, add, attach, record, set, table };
