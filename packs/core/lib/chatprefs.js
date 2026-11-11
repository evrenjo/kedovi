// 응답 언어 · 대화 스타일 (chat.language · chat.style): 이 PC(.agents/local.json) → 팀(workspace.json) → 킷 기본값.
/*
 * 쓰는 곳: kit.js sync (CLAUDE.local.md · AGENTS.override.md 머리 · .claude/settings.local.json language · outputStyle · .claude/output-styles/)
 *        · 훅 chat-prefs.js (요청마다 한 줄) · kedovi prefs (보기 · 바꾸기).
 * 의존성 없음 (kit.js 가 워크스페이스에서 require 한다).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LANGUAGES = {
  ko: { label: '한국어', claude: 'korean' },
  en: { label: 'English', claude: 'english' },
};
const STYLES = {
  learn: { label: '학습', hint: '진행하는 일마다 왜 · 어떻게를 자세히 설명' },
  normal: { label: '일반', hint: '결론 먼저 · 간결하게 (Claude Code 는 공식 Concise 스타일 위에)' },
  expert: { label: '전문가', hint: '부가 설명 없이 현업 용어 · 결과 · 근거 표와 그림 위주' },
};
const DEFAULT_STYLE = 'normal';
const OUTPUT_STYLE_PREFIX = 'kedovi-'; // .claude/output-styles/kedovi-<스타일>.md · settings outputStyle 값

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };

/** 팀 문서 언어 변수(vars.language.docs: 한국어 · 영어 …)로 정한 기본 응답 언어 */
function languageFromVars(ws) {
  const v = String((((ws || {}).vars || {}).language || {}).docs || '');
  return /영어|english|^en\b/i.test(v) ? 'en' : 'ko';
}

/** 한 곳(chat 객체)에서 유효한 값만 */
function pick(chat) {
  const c = chat || {};
  return { language: LANGUAGES[c.language] ? c.language : undefined, style: STYLES[c.style] ? c.style : undefined };
}

/**
 * 적용 값과 출처. ws = workspace.json 객체(없으면 root 에서 읽는다), local = .agents/local.json 객체(없으면 읽는다).
 * 반환: { language, style, from: { language: 'local'|'team'|'default', style: … }, team: {…}, local: {…} }
 */
function resolve(root, ws, local) {
  const w = ws || readJson(path.join(root, 'workspace.json'));
  const l = local || readJson(path.join(root, '.agents', 'local.json'));
  const team = pick(w.chat);
  const mine = pick(l.chat);
  const lang = mine.language ? ['local', mine.language] : team.language ? ['team', team.language] : ['default', languageFromVars(w)];
  const style = mine.style ? ['local', mine.style] : team.style ? ['team', team.style] : ['default', DEFAULT_STYLE];
  return { language: lang[1], style: style[1], from: { language: lang[0], style: style[0] }, team, local: mine };
}

// 스타일별 지침 (한 곳이 정본: 개인 지침 머리 · Claude 출력 스타일 파일)
const STYLE_RULES = {
  learn: [
    '단계마다 무엇을 · 왜 하는지 한두 문장으로 먼저 말하고 진행한다. 끝나면 바뀐 것 · 그렇게 한 이유 · 고려한 대안을 짧게 덧붙인다.',
    '처음 나오는 용어 · 약어는 현업 이름 그대로 쓰고 한 줄 풀이를 붙인다 (예: 멱등성(idempotency): 여러 번 해도 결과가 같음).',
    '흐름 · 구조 · 상태 바뀜은 그림으로 보여 준다. 사용자가 직접 확인해 볼 방법(명령 · 화면 위치)을 알려 준다.',
  ],
  normal: [
    '결론 먼저 · 간결하게. 비교 · 절차 · 상태는 표 · 목록으로. 자세한 설명은 요청할 때만.',
    '그림은 흐름 · 구조가 글보다 그림으로 빨리 읽힐 때만.',
  ],
  expert: [
    '부가 설명 · 개념 풀이 · 과정 서술을 뺀다. 순서는 결과 → 근거(표 · 그림 · 수치 · 출처 링크).',
    '용어는 공식 문서 · 표준 · 현업에서 쓰는 이름 그대로 쓴다 (예: race condition, idempotency, N+1 query, debounce, optimistic update). 직접 지어낸 말 · 풀어 쓴 말을 쓰지 않는다. 이름이 확실하지 않으면 공식 문서나 웹 검색으로 확인한 이름을 쓴다.',
    '문장은 짧게, 표 · 그림 · 코드 블록 위주로 읽기 쉽게.',
  ],
};

const DIAGRAM_RULE = '**그림:** 이 세션에 `mermaid_preview` 도구(claude-mermaid 플러그인)가 있으면 mermaid 로 그려 그 도구로 브라우저에 띄우고(preview_id 는 주제별 짧은 영문 이름, 같은 주제는 같은 id 로 고쳐 그린다), 대화에는 그림의 요점 2~3줄만 쓴다. 도구가 없으면 터미널 폭(80자) 안의 간단한 텍스트 그림(상자 · 화살표)으로 그린다. 문서 파일(docs · 기획 repo)에는 지금처럼 mermaid 코드 블록을 쓴다.';

/** 개인 지침 머리 (CLAUDE.local.md · AGENTS.override.md 맨 앞). 다른 규칙과 겹치면 이것이 먼저다 */
function headSection(p, { codeLanguage } = {}) {
  const L = LANGUAGES[p.language];
  const S = STYLES[p.style];
  const lang = p.language === 'en'
    ? `**응답 언어: English.** 진행 알림 · 도구 호출 사이의 짧은 설명 · 결과 보고 · 질문 · 요약을 모두 영어로 쓴다. 팀 규칙의 "대화 언어" 보다 이것이 먼저다. 예외: 사용자가 쓴 원문 인용 · 고유명사.`
    : `**응답 언어: 한국어.** 진행 알림 · 도구 호출 사이의 짧은 설명 · 결과 보고 · 질문 · 요약을 모두 한국어로 쓴다. 긴 작업 중간의 한 줄 알림도 영어로 쓰지 않는다. 예외: 코드 · 명령 · 경로 · 식별자 · 로그 · 오류 원문 · 현업에서 영어로 쓰는 용어.`;
  return [
    `## 응답 언어 · 대화 스타일 (${L.label} · ${S.label}, 다른 규칙보다 먼저)`, '',
    `- ${lang}${codeLanguage ? ` 코드 · 커밋 · 식별자 언어는 팀 규칙(${codeLanguage}) 그대로.` : ''}`,
    `- **대화 스타일: ${S.label}.** ${STYLE_RULES[p.style].join(' ')}`,
    `- ${DIAGRAM_RULE}`,
    '- 바꾸기: `kedovi prefs language ko|en` · `kedovi prefs style learn|normal|expert` (팀 기본값은 `--team`).', '',
  ].join('\n');
}

/** 요청마다 넣는 한 줄 (훅 chat-prefs.js). 긴 작업 중 다른 언어로 새는 것을 막는다 */
function reminder(p) {
  const S = STYLES[p.style];
  if (p.language === 'en') return `Reply in English only, progress notes included · style: ${p.style} · diagram: mermaid_preview if available, else text`;
  return `응답: 한국어만 (진행 알림 포함, 코드 · 명령 · 로그 · 현업 용어만 원문) · 스타일 ${S.label} · 그림: mermaid_preview 있으면 그것, 없으면 텍스트`;
}

/** Claude Code 출력 스타일 파일 (.claude/output-styles/kedovi-<스타일>.md). 일반은 기본 스타일이라 만들지 않는다 */
function outputStyleFiles() {
  const out = new Map();
  for (const key of ['learn', 'expert']) {
    const s = STYLES[key];
    out.set(`.claude/output-styles/${OUTPUT_STYLE_PREFIX}${key}.md`, [
      '---', `name: ${OUTPUT_STYLE_PREFIX}${key}`, `description: kedovi 대화 스타일 ${s.label}: ${s.hint}`, 'keep-coding-instructions: true', '---', '',
      `# 대화 스타일: ${s.label}`, '', ...STYLE_RULES[key].map((x) => `- ${x}`), `- ${DIAGRAM_RULE}`, '',
    ].join('\n'));
  }
  return out;
}

// 일반 스타일은 Claude Code 기본 제공 Concise (결과 먼저 · 앞뒤 설명 · 단계 중계 · 마무리 요약 없음, 오류 · 실패 · 경고는 그대로 다). 2.1.237 미만이면 모르는 값이라 기본 스타일로 돈다
const BUILTIN_CONCISE = 'Concise';
/** 킷이 관리하는 값인가 (사용자가 직접 고른 다른 스타일은 건드리지 않는다) */
const kitOwned = (v) => !v || String(v).startsWith(OUTPUT_STYLE_PREFIX) || v === BUILTIN_CONCISE;

/** settings.local.json 에 넣을 값. 일반 = Concise (사용자가 다른 스타일을 직접 골랐으면 그대로 둔다) */
function claudeSettings(p) {
  return { language: LANGUAGES[p.language].claude, outputStyle: p.style === 'normal' ? BUILTIN_CONCISE : `${OUTPUT_STYLE_PREFIX}${p.style}`, soft: p.style === 'normal' };
}

module.exports = { BUILTIN_CONCISE, kitOwned, LANGUAGES, STYLES, DEFAULT_STYLE, OUTPUT_STYLE_PREFIX, resolve, headSection, reminder, outputStyleFiles, claudeSettings, languageFromVars };
