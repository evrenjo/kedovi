// 사람이 읽는 글의 틀과 올리기 · 커밋 전 검사 (빈칸 자리표시자 · 필수 절 · 긴 글머리 · 이 PC 에만 있는 것).
/*
 * 쓰는 곳: bin/draft.js (kedovi draft) · issue-check.js · gitlab 팩 이슈 · MR 도구 · 훅 draft-guard.js(gh · glab 명령) · 기획 repo pre-commit · report.js new
 * 틀(FORMATS)이 정본이다. 스킬 · 룰은 `kedovi draft template <형식>` 으로 가리키고 틀을 옮겨 적지 않는다.
 * 의존성 없음.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// 형식: label, sections = 필수 절(별칭 목록. 제목 · 굵은 머리 · 「이름:」 줄 어느 것이든), oneOf = 그중 하나의 묶음만 맞으면 됨, template
const FORMATS = {
  task: {
    label: '작업 항목 (이슈)',
    target: 'issue',
    sections: [['요약', 'Summary'], ['할 일', 'Tasks', 'To do'], ['완료 조건', 'Done when', 'Acceptance criteria']],
    template: [
      '## 요약', '<무엇을 · 왜 한 줄>', '',
      '## 배경 · 현황', '- <지금 상태 · 문제 한 줄에 하나>', '',
      '## 할 일', '- [ ] <한 줄에 하나>', '',
      '## 완료 조건', '- <확인할 수 있는 결과>', '',
    ],
  },
  bug: {
    label: '결함 (이슈)',
    target: 'issue',
    sections: [['현상', 'Summary', '요약'], ['재현', 'Steps to reproduce', 'Reproduce'], ['기대 / 실제', '기대', 'Expected']],
    template: [
      '## 현상', '<무엇이 · 언제 · 어디서 한 줄>', '',
      '## 재현', '1. <한 줄에 한 동작>', '',
      '## 기대 / 실제', '- 기대: <…>', '- 실제: <…>', '',
      '## 환경', '- <버전 · 브라우저 · OS. 개인 경로 · 계정 · 사내 주소는 쓰지 않음>', '',
    ],
  },
  mr: {
    label: 'MR · PR 본문',
    target: 'mr',
    sections: [['Summary', '요약']],
    template: [
      '## Summary', '<무엇을 / 왜 한 줄. 아래에 바뀐 것을 한 줄에 하나>', '- <바뀐 것>', '',
      '## Change Type', '- [ ] Feature', '- [ ] Fix', '- [ ] Refactor', '- [ ] Chore / Docs', '',
      '## Related Issues', 'N/A', '',
    ],
  },
  done: {
    label: '완료 댓글 (조치 보고)',
    target: 'comment',
    sections: [['결과', 'Result'], ['조치', 'Fix', 'Changes'], ['확인', 'Verified', 'Verification']],
    template: [
      '**결과**: <한 줄: 무엇을 고쳤고 어디에 반영됐나>', '',
      '- **원인**: <확정한 원인. 결함이 아니면 「해당 없음」>',
      '- **조치**: <바뀐 것 · 커밋 · MR>',
      '- **영향 범위**: <같은 데이터 · 화면을 쓰는 곳>',
      '- **확인**: <검증 방법과 결과>',
      '- **재발 방지**: <없으면 「없음」>', '',
    ],
  },
  weekly: {
    label: '주간보고',
    target: 'weekly',
    sections: [['요약', 'Summary'], ['완료', 'Done'], ['진행 중', '진행', 'In progress']],
    template: [
      '## 주간 보고 (<시작> ~ <끝>)', '',
      '**요약**: <완료 n · 진행 n · 새 접수 n, 가장 중요한 한 줄>', '',
      '### 완료', '- <한 줄에 하나>', '',
      '### 진행 중', '- <항목 · 상태 · 다음 단계>', '',
      '### 다음 주', '- <계획>', '',
      '### 요청 · 이슈', '- <결정 · 도움이 필요한 것. 없으면 「없음」>', '',
    ],
  },
  report: {
    label: '보고 (위키 · 보고 페이지 · 제안)',
    target: 'report',
    sections: [['핵심 요약', '요약', '결론', 'Summary'], ['내용', '개선안', '결과', '바뀐 것'], ['다음 할 일 · 요청', '다음 할 일', '요청', '남은 것', 'Next']],
    template: [
      '## 핵심 요약', '- <결론 · 요청 한두 줄>', '',
      '## 배경 · 현황', '- <왜 · 지금 상태 한 줄에 하나>', '',
      '## 내용', '| 항목 | 내용 |', '|---|---|', '| <…> | <…> |', '',
      '## 다음 할 일 · 요청', '- <누가 · 무엇을. 없으면 「없음」>', '',
    ],
  },
  plan: {
    label: '기획 문서',
    target: 'plan',
    sections: null,
    template: ['기획 문서 틀은 기획 repo 의 각 폴더 _template.md 다 (기능 20-features/_template.md · 결정 90-decisions/_template.md).', '새 문서는 그 틀을 복사해 쓰고, 커밋할 때 틀의 절이 모두 있는지 기획 repo 커밋 훅이 본다.'],
  },
};

// 개조식 예외로 고를 수 있는 대상 (kedovi prefs writing-except)
const TARGETS = { chat: '채팅 답변', issue: '이슈 · 작업 항목', mr: 'MR · PR', comment: '댓글', report: '보고 · 위키', weekly: '주간보고', plan: '기획 문서' };

const DEFAULT_BULLET_MAX = 150;

// 이 PC 에만 있어 읽는 사람이 열 수 없는 것
const LOCAL_RULES = [
  ['이 PC 링크(보고 · 현황판)', /https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/(?:reports|board|traces)\b/],
  ['.agents 경로', /(?:^|[\s(`'"[])\.agents\//],
  ['임시 폴더 경로', /(?:^|[\s(`'"[])(?:\/private)?\/tmp\/|\/var\/folders\//],
  ['worktree 경로', /(?:^|[\s(`'"[/])\.(?:claude\/)?worktrees\//],
  ['로컬 작업 브랜치', /(?:^|[\s(`'"[])kedovi\/[a-z0-9][\w.-]*/i],
  ['에이전트 ID', /\bagent-[0-9a-f]{8,}\b/],
];

/** 이 워크스페이스 설정: { bulletMax, localPatterns: [[이름, RegExp]] } */
function varsOf(ws) {
  const w = ((ws || {}).vars || {}).writing || {};
  const n = Number(w.bulletMax);
  const local = (Array.isArray(w.localIds) ? w.localIds : String(w.localIds || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
  const pats = [];
  for (const s of local) { try { pats.push(['로컬 ID', new RegExp(s)]); } catch { /* 잘못된 정규식은 넘긴다 */ } }
  return { bulletMax: Number.isFinite(n) && n >= 40 ? n : DEFAULT_BULLET_MAX, localPatterns: pats };
}

/** 글 형식 설정 (chat.writing · chat.writingExcept): 이 PC → 팀 → 기본(개조식 · 예외 없음) */
function prefsOf(ws, local) {
  const pick = (c) => ({
    writing: ['bullet', 'prose'].includes((c || {}).writing) ? c.writing : undefined,
    except: Array.isArray((c || {}).writingExcept) ? c.writingExcept.filter((x) => TARGETS[x]) : undefined,
  });
  const t = pick((ws || {}).chat);
  const m = pick((local || {}).chat);
  return {
    writing: m.writing || t.writing || 'bullet',
    except: m.except || t.except || [],
    from: { writing: m.writing ? 'local' : t.writing ? 'team' : 'default', except: m.except ? 'local' : t.except ? 'team' : 'default' },
    team: t, local: m,
  };
}

/** 개조식 검사를 할 대상인가 */
function bulletsFor(prefs, target) {
  if (!prefs || prefs.writing === 'prose') return false;
  return !(prefs.except || []).includes(target);
}

/** 검사 수준 agents.enforce.draftCheck: block(기본) · warn · off */
function levelOf(root) {
  if (!fs.existsSync(path.join(root, 'workspace.json'))) return 'block';
  try {
    const kit = require(path.join(root, 'bin', 'kit.js'));
    return (kit.resolveModels(root, kit.loadWorkspace(root)).enforce || {}).draftCheck || 'block';
  } catch { return 'block'; }
}

const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 줄이 그 절의 머리인가: # 제목 · **이름** · - **이름** · 이름: */
function headOf(line) {
  const t = line.trim();
  let m = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
  if (m) return m[1].replace(/\*\*/g, '').trim();
  m = /^(?:[-*+]\s+)?\*\*([^*]+)\*\*/.exec(t);
  if (m) return m[1].replace(/[:：]\s*$/, '').trim();
  m = /^(?:[-*+]\s+)?([^:：|`]{1,24})[:：]/.exec(t);
  if (m) return m[1].trim();
  return null;
}

/** 이 절 별칭 중 하나가 머리로 있나 (앞부분 일치: 「진행 중 (3)」 · 「요약 (2026-11-17)」) */
function hasSection(heads, aliases) {
  return aliases.some((a) => heads.some((h) => new RegExp(`^${ESC(a)}(?![\\p{L}])`, 'iu').test(h)));
}

/**
 * 프로젝트 자체 틀의 절 (있으면 킷 틀보다 먼저): GitLab · GitHub 템플릿 폴더의 ## · ### 제목.
 * 틀이 여럿이면 본문과 제목이 가장 많이 겹치는 것 (모두 0 이면 Default · 첫 파일)
 */
function projectSections(repoDir, target, text) {
  if (!repoDir) return null;
  const dirs = target === 'mr'
    ? ['.gitlab/merge_request_templates', '.github/PULL_REQUEST_TEMPLATE', '.github/pull_request_template']
    : target === 'issue' ? ['.gitlab/issue_templates', '.github/ISSUE_TEMPLATE'] : [];
  const files = target === 'mr' ? ['.github/pull_request_template.md', '.github/PULL_REQUEST_TEMPLATE.md', 'docs/pull_request_template.md', 'pull_request_template.md'] : [];
  const cands = [...files];
  for (const d of dirs) { try { for (const f of fs.readdirSync(path.join(repoDir, d)).sort()) if (/\.md$/i.test(f)) cands.push(`${d}/${f}`); } catch { /* 없음 */ } }
  const bodyHeads = text ? lines(text).map((x) => headOf(x.text)).filter(Boolean) : [];
  let best = null;
  for (const c of cands) {
    let t;
    try { t = fs.readFileSync(path.join(repoDir, c), 'utf8'); } catch { continue; }
    t = t.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->/g, '');
    const heads = t.split('\n').map((l) => /^#{2,3}\s+(.+)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1].trim()]);
    if (!heads.length) continue;
    const score = heads.filter((h) => hasSection(bodyHeads, h)).length + (/default/i.test(c) ? 0.5 : 0);
    if (!best || score > best.score) best = { from: c, sections: heads, score };
  }
  return best ? { from: best.from, sections: best.sections } : null;
}

/** 본문 → 검사할 줄 [{ n, text }] (코드 블록 · HTML 주석 · 인라인 코드 빼고) */
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

const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
// 값이 빈 항목: 「- 원인:」 · 「**결과**:」 · 「- **조치**」
const EMPTY_ITEM = [/^\s*(?:[-*+]\s+)?\*\*[^*]+\*\*\s*[:：]?\s*$/, /^\s*(?:[-*+]\s+)?[^:：|`*#\s<][^:：|`*<]{0,23}[:：]\s*$/];
const plain = (s) => s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, 'URL').replace(/\*\*|__/g, '').trim();

/**
 * 검사. 반환 [{ line, kind }] (line 0 = 문서 전체)
 * opts: type(FORMATS 키) · sections(필수 절, 없으면 형식의 것) · bullets(개조식 검사) · bulletMax · localPatterns · repoDir(push 안 한 커밋 확인) · added(Set: 이 줄 번호만 본다, 커밋 훅)
 */
function check(text, opts = {}) {
  const hits = [];
  const add = (line, kind) => hits.push({ line, kind });
  const L = lines(text);
  const rawLines = String(text).split('\n');
  const only = opts.added || null;
  const seen = (n) => !only || only.has(n);
  const bulletMax = opts.bulletMax || DEFAULT_BULLET_MAX;
  const locals = [...LOCAL_RULES, ...(opts.localPatterns || [])];

  L.forEach((x) => {
    if (!seen(x.n)) return;
    const t = x.text;
    // 빈칸 자리표시자
    if (/<[^<>\n]*[가-힣][^<>\n]*>/.test(t) || /<(?:…|\.\.\.)>/.test(t)) add(x.n, '빈칸 자리표시자 <…>');
    else if (/\b(?:TODO|TBD|FIXME)\b/.test(t)) add(x.n, '빈칸 자리표시자 TODO · TBD');
    else if (/^\s*(?:[-*+]\s+)?(?:…|\.\.\.)\s*$/.test(t)) add(x.n, '빈칸 자리표시자 …');
    else if (/^\s*(?:[-*+]|\d+[.)])\s*(?:\[[ xX]\]\s*)?$/.test(t)) add(x.n, '빈 글머리');
    else if (EMPTY_ITEM.some((re) => re.test(t))) {
      // 「- 원인:」 처럼 값이 없는 항목. 바로 아래가 더 들여 쓴 글머리 · 표 · 코드 블록이면 머리다
      const ind = (BULLET.exec(t) || ['', ''])[1].length;
      const below = rawLines.slice(x.n).find((r) => r.trim()) || '';
      const childInd = (BULLET.exec(below) || [null, null])[1];
      const head = (childInd !== null && childInd.length > ind) || /^\s*(?:\||```|~~~)/.test(below)
        || (!BULLET.test(t) && BULLET.test(rawLines[x.n] || ''));
      if (!head) add(x.n, '값이 빈 항목');
    } else if (/^\s*\|/.test(t) && !/^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(t) && t.split('|').slice(1, -1).every((c) => !c.trim())) add(x.n, '빈 표 행');
    // 긴 글머리 (개조식)
    if (opts.bullets && BULLET.test(t)) {
      const body = plain(t.replace(BULLET, ''));
      if ((body.match(/[가-힣]\.(?=\s|$)/g) || []).length >= 2) add(x.n, '한 글머리에 여러 문장 (하나씩 나눔)');
      else if ([...body].length > bulletMax) add(x.n, `긴 글머리 ${[...body].length}자 > ${bulletMax}자 (나누거나 하위 글머리로)`);
    }
    // 이 PC 에만 있는 것
    for (const [kind, re] of locals) if (re.test(x.raw.replace(/<!--[\s\S]*?-->/g, ''))) { add(x.n, `이 PC 에만 있는 것: ${kind}`); break; }
  });

  // 빈 절: 제목 뒤에 내용 없이 같은 · 더 높은 제목이나 끝 (문서 전체를 볼 때만)
  if (!only) {
    L.forEach((x, idx) => {
      const m = /^(#{1,6})\s+\S/.exec(x.text.trim());
      if (!m) return;
      const nx = L.slice(idx + 1).find((y) => y.text.trim());
      const nm = nx && /^(#{1,6})\s+\S/.exec(nx.text.trim());
      if (!nx || (nm && nm[1].length <= m[1].length)) add(x.n, '빈 절 (해당 없으면 「없음」)');
    });
  }

  // 필수 절
  const sections = opts.sections !== undefined ? opts.sections : (FORMATS[opts.type] || {}).sections;
  if (sections && sections.length && !only) {
    const heads = L.map((x) => headOf(x.text)).filter(Boolean);
    for (const s of sections) if (!hasSection(heads, s)) add(0, `필수 절 없음: ${s[0]}`);
  }

  // push 안 한 커밋 (repo 를 알 때)
  if (opts.repoDir) {
    const shas = [...new Set((String(text).match(/\b[0-9a-f]{7,40}\b/g) || []).filter((s) => /\d/.test(s) && /[a-f]/.test(s)))].slice(0, 20);
    const git = (...a) => { try { return execFileSync('git', ['-C', opts.repoDir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
    for (const s of shas) {
      if (git('cat-file', '-e', `${s}^{commit}`) === null) continue;
      if (git('branch', '-r', '--contains', s) === '') {
        const n = String(text).split('\n').findIndex((l) => l.includes(s)) + 1;
        if (!only || only.has(n)) add(n, `이 PC 에만 있는 것: push 안 한 커밋 ${s.slice(0, 8)}`);
      }
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

/** 이슈 본문: 프로젝트 틀이 없으면 작업 항목 · 결함 중 더 맞는 쪽으로 본다 */
function issueType(text) {
  const heads = lines(text).map((x) => headOf(x.text)).filter(Boolean);
  const score = (k) => FORMATS[k].sections.filter((s) => hasSection(heads, s)).length;
  return score('bug') > score('task') ? 'bug' : 'task';
}

/** 형식 이름 → FORMATS 키 (issue = 작업 항목 · 결함 자동, comment = 일반 댓글: 필수 절 없음) */
function resolveType(type, text) {
  if (type === 'issue') return issueType(text);
  if (type === 'comment' || type === 'wiki' || !type) return null;
  return FORMATS[type] ? type : null;
}

/**
 * 워크스페이스 기준 한 번에: 형식 · 설정 · 프로젝트 틀을 붙여 검사한다.
 * 반환 { hits, type, level, from(프로젝트 틀 경로) }
 */
function checkFor(root, text, { type, repoDir, ws, local } = {}) {
  const w = ws || (() => { try { return JSON.parse(fs.readFileSync(path.join(root, 'workspace.json'), 'utf8')); } catch { return {}; } })();
  const l = local || (() => { try { return JSON.parse(fs.readFileSync(path.join(root, '.agents', 'local.json'), 'utf8')); } catch { return {}; } })();
  const k = resolveType(type, text);
  const target = k ? FORMATS[k].target : type === 'wiki' ? 'report' : 'comment';
  const proj = k && ['issue', 'mr'].includes(FORMATS[k].target) ? projectSections(repoDir, FORMATS[k].target, text) : null;
  const v = varsOf(w);
  const hits = check(text, {
    type: k, sections: proj ? proj.sections : undefined, bullets: bulletsFor(prefsOf(w, l), target),
    bulletMax: v.bulletMax, localPatterns: v.localPatterns, repoDir,
  });
  return { hits, type: k, level: levelOf(root), from: proj ? proj.from : null };
}

/** 틀 글 */
function template(type) {
  const f = FORMATS[type];
  return f ? f.template.join('\n') : null;
}

/** 걸린 것 한 줄씩 */
function format(hits) {
  return hits.map((h) => `${h.line ? `${h.line}줄` : '문서'}: ${h.kind}`);
}

module.exports = { FORMATS, TARGETS, DEFAULT_BULLET_MAX, LOCAL_RULES, varsOf, prefsOf, bulletsFor, levelOf, check, checkFor, issueType, resolveType, projectSections, template, format, headOf };
