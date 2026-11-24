// 요청 장부: 사용자 요청마다 번호 · 맡은 에이전트 · 상태 · 결과. 쓰는 곳: hooks/request-ledger.js (기록 · 답변 끝 표 검사) · bin/requests.js (kedovi requests)
/*
 * 파일 = handoffs/<id>/topics/요청-목록.md (작업 기록 머리 형식. 상태: 기록 이라 진행 중 작업 · 완료 조건 점검에 잡히지 않는다)
 * 표 한 줄 = | 번호 | 받은 때 | 요청 | 맡은 에이전트 | 상태 | 결과 |. 칸 안의 | 는 ¦ 로 바꿔 적는다
 * 상태: 접수 · 진행 · 완료 · 보류 · 취소 (업무) · 물음 → 답함 (질문). 열린 요청 = 완료 · 취소 · 답함이 아닌 것. 답변 끝 표는 업무만
 * 적지 않는 것: 맞장구, 백그라운드 알림 · 다른 세션 · 에이전트 메시지 · 예약 실행 (사람이 보낸 말이 아님)
 * 질문(「얼마나 했어?」)은 물음으로 적고 답하면(Stop) 답함으로 닫는다. 질문 뒤 「그럼 고쳐줘」 · 「진행해」 면 그 질문을 이어 업무로 올린다
 */
'use strict';
const fs = require('fs');
const path = require('path');

const NAME = '요청-목록';
const STATUSES = ['접수', '진행', '완료', '보류', '취소', '물음', '답함'];
const CLOSED = ['완료', '취소', '답함'];
const ASK = '물음';
const FOLLOW_MS = 30 * 60000; // 질문 뒤 이만큼 안의 짧은 지시는 그 질문을 이어 업무로
const HEAD = '| 번호 | 받은 때 | 요청 | 맡은 에이전트 | 상태 | 결과 |';
const TABLE_HEAD = '| 번호 | 요청 | 맡은 에이전트 | 상태 | 결과 |';
/** 답변 끝 표가 있나 (머리 줄 모양) */
const TABLE_RE = /^\s*\|\s*번호\s*\|\s*요청\s*\|[^\n]*상태[^\n]*\|\s*$/m;
const SUMMARY_MAX = 80;

// 맞장구 · 고마움: 새 요청으로 적지 않는다
const ACK_RE = /^(응+|어+|네+|넵|예|ㅇㅇ+|ㅇㅋ|ok(ay)?|yes|y|good|좋아(요)?|좋습니다|굿|고마워(요)?|감사(합니다|해요)?|땡큐|thanks?|thx|확인(했어|했습니다)?|알겠(어|습니다)(요)?|그래(요)?|맞아(요)?)[.!~ ]*$/i;
// 짧은 승인 · 재촉: 열린 직전 요청에 붙인다 (없으면 새 요청)
const GO_RE = /^(진행(해|해줘|하자|해요|해 ?주세요)?|계속(해|해줘|하자)?|ㄱㄱ|고고|go|해(줘|주세요)|그렇게 ?해(줘)?|그걸로|그대로 ?(해|진행)(줘)?|시작(해|해줘)|배포(해|해줘|하자)|머지(해|해줘)|커밋(해|해줘)|올려(줘)?)[.!~ ]*$/i;

// 사람이 보낸 말이 아닌 것: 백그라운드 작업 알림 · 다른 세션 · 에이전트 · 팀원 메시지 · 시스템 알림 · 명령 출력
const SYSTEM_RE = /^\s*(?:<task-notification>|<teammate-message\b|<agent-message\b|<cross-session-message\b|Another Claude session sent a message|\[SYSTEM NOTIFICATION|<system-reminder>|<local-command-(?:stdout|stderr|caveat)>|<command-(?:name|message)>|<bash-(?:stdout|stderr)>|Caveat: The messages below were generated)/i;
// 업무 요청 말: 이것이 있으면 물음 꼴이어도 업무로 본다
const WORK_RE = /(?:해\s*(?:줘|주세요|주라|줄래|봐|보자)|하자|고쳐|바꿔|만들어|추가|넣어|빼\s*(?:줘|주세요)|지워|삭제해|배포|진행해|올려|커밋|머지|부탁|정리해|확인해\s*(?:줘|주세요)|찾아\s*(?:줘|봐)|분석해|조사해|작성해|구현|적용해|반영해|설치해|붙여|돌려\s*(?:줘|봐))/;
// 물음 꼴: 물음표 · 물음 어미 · 물음 낱말(얼마나 · 어디 · 왜 …) · 「알려줘 · 보여줘」
const ASK_RE = /[?？]\s*$|(?:나요|까요|니|냐|는지|인지|인가요?|던가|는가|죠|지요|ㄹ까|을까|일까|어때|어때요)\s*[.~]*$|(?:^|\s)(?:얼마나|언제|어디|어디까지|왜|뭐|무엇|몇|어떻게|어떤|어느|누가|혹시)(?:\s|$|[가-힣])|(?:알려|보여)\s*(?:줘|주세요)/;

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

/**
 * 요청 종류: skip = 빈 것 · system = 사람이 보낸 말이 아님 · ack = 맞장구 · go = 직전 열린 요청에 붙임 · ask = 물음 · new = 새 업무
 * meta = 훅 입력에 출처가 있으면 ({ origin: { kind }, prompt_source }) 그것을 먼저 본다
 */
function kindOf(text, meta = {}) {
  const kind = meta && ((meta.origin && meta.origin.kind) || meta.turn_origin);
  if (kind && !['human', 'channel'].includes(String(kind))) return 'system';
  if (meta && meta.prompt_source === 'system') return 'system';
  const raw = String(text || '');
  if (SYSTEM_RE.test(raw)) return 'system';
  const s = raw.replace(/<\/?[a-z_-]+(?:\s[^>]*)?>/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return 'skip';
  if (s.length <= 20 && ACK_RE.test(s)) return 'ack';
  if (s.length <= 20 && GO_RE.test(s)) return 'go';
  if (ASK_RE.test(s) && !WORK_RE.test(s)) return 'ask';
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

const isAsk = (r) => r.status === ASK || r.status === '답함';
const isWork = (r) => !isAsk(r);

/** 받은 때(MM-DD HH:MM) → ms (올해 기준, 미래면 작년) */
function atMs(at, now = new Date()) {
  const m = String(at || '').match(/^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) return 0;
  const d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4]));
  if (d.getTime() > now.getTime() + 60000) d.setFullYear(d.getFullYear() - 1);
  return d.getTime();
}

/** 바로 앞 줄이 최근 물음이면 그 행 (질문 뒤 「그럼 고쳐줘」 를 잇는다) */
function recentAsk(rows, now = new Date()) {
  const last = rows[rows.length - 1];
  return last && isAsk(last) && now.getTime() - atMs(last.at, now) <= FOLLOW_MS ? last : null;
}

/** 새 요청 한 줄 → 그 행 (status 물음이면 질문) */
function add(root, id, text, { agent = '메인', at = new Date(), status = '접수' } = {}) {
  const rows = read(root, id);
  const row = { no: (rows.length ? rows[rows.length - 1].no : 0) + 1, at: stamp(at), text: summarize(text), agent, status, result: '' };
  write(root, id, [...rows, row]);
  return row;
}

/** 열린 직전 업무에 짧은 승인을 붙인다 (접수면 진행으로). 열린 업무가 없으면 null */
function attach(root, id, text) {
  const rows = read(root, id);
  const last = [...rows].reverse().find((r) => isOpen(r) && isWork(r));
  if (!last) return null;
  const note = summarize(text);
  if (!last.text.includes(`(+ ${note})`)) last.text = `${last.text} (+ ${note})`.slice(0, SUMMARY_MAX * 2);
  if (last.status === '접수') last.status = '진행';
  write(root, id, rows);
  return last;
}

/** 요청 원문을 종류대로 적는다 → { kind, row } (meta = 훅 입력의 출처) */
function record(root, id, text, opts = {}, meta = {}) {
  const kind = kindOf(text, meta);
  if (['skip', 'ack', 'system'].includes(kind)) return { kind, row: null };
  if (kind === 'ask') return { kind, row: add(root, id, text, { ...opts, status: ASK }) };
  const rows = read(root, id);
  const q = recentAsk(rows);
  if (kind === 'go') {
    // 질문에 대한 「진행해」 · 「그렇게 해줘」 는 그 질문을 업무로 올린다
    if (q && !rows.some((r) => isOpen(r) && isWork(r))) return { kind: 'new', row: add(root, id, `${q.text} → ${summarize(text)}`, { ...opts, status: '진행' }) };
    const row = attach(root, id, text);
    if (row) return { kind, row };
  }
  // 질문 바로 뒤 짧은 지시(「그럼 고쳐줘」)는 그 질문을 이어 적는다
  const s = summarize(text);
  if (q && s.length <= 30) return { kind: 'new', row: add(root, id, `${q.text} → ${s}`, opts) };
  return { kind: 'new', row: add(root, id, text, opts) };
}

/** 답한 물음을 닫는다 (Stop). 닫은 수 */
function closeAsks(root, id) {
  const rows = read(root, id);
  let n = 0;
  for (const r of rows) if (r.status === ASK) { r.status = '답함'; n++; }
  if (n) write(root, id, rows);
  return n;
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
  const open = rows.filter((r) => isOpen(r) && isWork(r));
  if (!open.length) return '';
  const shown = open.slice(-max);
  return [TABLE_HEAD, '|---|---|---|---|---|', ...shown.map((r) => `| ${r.no} | ${cell(r.text)} | ${cell(r.agent)} | ${cell(r.status)} | ${cell(r.result) || '-'} |`),
    ...(open.length > shown.length ? [`| … | 앞선 열린 요청 ${open.length - shown.length}건 (kedovi requests list) | | | |`] : [])].join('\n');
}

module.exports = { ASK, SYSTEM_RE, isAsk, isWork, closeAsks, recentAsk, NAME, STATUSES, CLOSED, HEAD, TABLE_HEAD, TABLE_RE, fileOf, summarize, kindOf, read, write, isOpen, add, attach, record, set, table };
