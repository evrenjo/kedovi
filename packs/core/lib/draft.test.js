// 글 형식 검사 (lib/draft.js · bin/draft.js staged · 훅 draft-guard.js) 시험
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const D = require('./draft');

const kinds = (text, opts) => D.check(text, opts).map((h) => `${h.line}:${h.kind}`);
const has = (list, re) => list.some((k) => re.test(k));

// 1. 빈칸: 자리표시자 · 값이 빈 항목 · 빈 글머리 · 빈 표 행 · 빈 절. 머리 줄(아래 하위 글머리 · 표 · 코드)은 빈 항목이 아니다
{
  const t = [
    '**결과**:', '',
    '- **원인**: 널 처리 누락',
    '- **조치**:',
    '- 영향 범위: <같은 화면>',
    '- 실행 순서:', '  - 하나',
    '- 명령:', '```', 'ls /tmp/x', '```',
    '| a | b |', '|---|---|', '|  |  |',
    '## 빈 절', '## 다음', '- TODO 채우기', '-',
  ].join('\n');
  const k = kinds(t, {});
  assert.ok(has(k, /^1:값이 빈 항목/), k);
  assert.ok(has(k, /^4:값이 빈 항목/), k);
  assert.ok(has(k, /^5:빈칸 자리표시자 <…>/), k);
  assert.ok(!has(k, /^6:/) && !has(k, /^8:/), `머리 줄은 빈 항목 아님: ${k}`);
  assert.ok(!has(k, /임시 폴더/), `코드 블록은 보지 않음: ${k}`);
  assert.ok(has(k, /^14:빈 표 행/), k);
  assert.ok(has(k, /^15:빈 절/) && !has(k, /^16:빈 절/), k);
  assert.ok(has(k, /^17:빈칸 자리표시자 TODO/) && has(k, /^18:빈 글머리/), k);
}

// 2. 개조식: 한 글머리 여러 문장 · 긴 글머리 (링크 주소는 세지 않음). 개조식 검사를 끄면 안 본다
{
  const t = `- 이 줄은 문장입니다. 또 하나의 문장입니다.\n- ${'가'.repeat(160)}\n- [짧은 글](https://example.com/${'x'.repeat(300)})`;
  const k = kinds(t, { bullets: true });
  assert.ok(has(k, /^1:한 글머리에 여러 문장/) && has(k, /^2:긴 글머리 160자 > 150자/) && !has(k, /^3:/), k);
  assert.deepStrictEqual(kinds(t, { bullets: false }), []);
  assert.ok(has(kinds(`- ${'가'.repeat(100)}`, { bullets: true, bulletMax: 80 }), /긴 글머리 100자 > 80자/));
}

// 3. 이 PC 에만 있는 것 + 팀이 더한 모양
{
  const t = ['자세히: http://127.0.0.1:4310/reports/2026-11-17/0901.html', '파일 .agents/reports/a.md', '로그 /private/tmp/claude-1/x.log', '브랜치 kedovi/login-fix', '`agent-a61b58e0f437fb593` 결과', 'kedovi 0.98', 'LOCAL-12 참고'].join('\n');
  const k = kinds(t, { localPatterns: [['로컬 ID', /\bLOCAL-\d+\b/]] });
  for (let n = 1; n <= 5; n++) assert.ok(has(k, new RegExp(`^${n}:이 PC 에만 있는 것`)), `${n}줄: ${k}`);
  assert.ok(!has(k, /^6:/), `패키지 이름은 아님: ${k}`);
  assert.ok(has(k, /^7:이 PC 에만 있는 것: 로컬 ID/), k);
}

// 4. 필수 절: 형식별 · 틀 자체는 통과 · 채운 틀은 깨끗 · 이슈는 결함 · 작업 항목 중 맞는 쪽
{
  for (const k of Object.keys(D.FORMATS).filter((x) => D.FORMATS[x].sections)) {
    const t = D.template(k);
    assert.deepStrictEqual(D.check(t, { type: k }).filter((h) => /필수 절/.test(h.kind)), [], `${k} 틀의 절`);
    assert.deepStrictEqual(kinds(t.replace(/<[^>]*>/g, '채움'), { type: k, bullets: true }), [], `${k} 채운 틀`);
  }
  assert.ok(has(kinds('## Summary\n수정\n', { type: 'done' }), /필수 절 없음: 결과/));
  assert.strictEqual(D.issueType('## 현상\nx\n## 재현\n1. y'), 'bug');
  assert.strictEqual(D.issueType('## 요약\nx'), 'task');
  assert.strictEqual(D.resolveType('comment', 'x'), null);
}

// 5. 프로젝트 틀이 먼저 (여럿이면 본문과 가장 겹치는 것) · push 안 한 커밋
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-draft-'));
try {
  const repo = path.join(tmp, 'app');
  fs.mkdirSync(path.join(repo, '.github', 'ISSUE_TEMPLATE'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'bug.md'), '---\nname: Bug\n---\n## Describe\n## Steps\n');
  fs.writeFileSync(path.join(repo, '.github', 'ISSUE_TEMPLATE', 'feature.md'), '## Motivation\n## Proposal\n');
  const r = D.checkFor(tmp, '## Motivation\n왜 필요한가\n', { type: 'issue', repoDir: repo });
  assert.strictEqual(r.from, '.github/ISSUE_TEMPLATE/feature.md');
  assert.deepStrictEqual(r.hits.map((h) => h.kind), ['필수 절 없음: Proposal']);

  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'maintenance.auto', 'false'); g('config', 'gc.auto', '0');
  g('commit', '-q', '--allow-empty', '-m', 'local');
  const sha = g('rev-parse', '--short=10', 'HEAD');
  const k = D.check(`- 조치: 커밋 ${sha}`, { repoDir: repo }).map((h) => h.kind);
  assert.ok(k.some((x) => /push 안 한 커밋/.test(x)), k);

  // 6. 기획 repo 커밋 훅 (bin/draft.js staged): 고친 파일은 더한 줄만, 새 문서는 같은 폴더 _template.md 의 절까지
  const docs = path.join(tmp, 'plans');
  const dg = (...a) => execFileSync('git', ['-C', docs, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  fs.mkdirSync(path.join(docs, '20-features'), { recursive: true });
  dg('init', '-q'); dg('config', 'user.email', 't@t'); dg('config', 'user.name', 't'); dg('config', 'maintenance.auto', 'false'); dg('config', 'gc.auto', '0');
  fs.writeFileSync(path.join(docs, '20-features', '_template.md'), '# <영역> 기능\n\n## FN-<영역>-001 <이름>\n\n### 동작\n\n1. <동작>\n\n### 수용 기준\n\n| ID | 조건 |\n|---|---|\n');
  fs.writeFileSync(path.join(docs, 'old.md'), '# 옛 문서\n\n- <옛 자리표시자는 그대로 둔다>\n');
  dg('add', '-A'); dg('commit', '-qm', 'init');
  const staged = () => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'draft.js'), 'staged', docs], { encoding: 'utf8' });
  fs.appendFileSync(path.join(docs, 'old.md'), '- 새 줄은 깔끔함\n');
  dg('add', '-A');
  assert.strictEqual(staged().status, 0, '옛 줄의 자리표시자는 보지 않음');
  fs.appendFileSync(path.join(docs, 'old.md'), '- 원인:\n');
  fs.writeFileSync(path.join(docs, '20-features', 'order.md'), '# 주문 기능\n\n## FN-ORD-001 주문\n\n### 동작\n\n1. 주문을 받는다\n');
  fs.writeFileSync(path.join(docs, '20-features', '_template.md'), fs.readFileSync(path.join(docs, '20-features', '_template.md'), 'utf8') + '<!-- 틀 자체는 보지 않음 -->\n- <x>\n');
  dg('add', '-A');
  const s1 = staged();
  assert.strictEqual(s1.status, 1, s1.stderr);
  assert.match(s1.stderr, /old\.md 5줄: 값이 빈 항목/);
  assert.match(s1.stderr, /20-features\/order\.md 문서: 필수 절 없음: 수용 기준/);
  assert.doesNotMatch(s1.stderr, /_template\.md/);

  // 7. 훅: gh · glab 본문 (heredoc · --body-file · cd 따라가기), 본문을 모르는 것은 넘김
  const { bodies } = require('../hooks/draft-guard');
  const b1 = bodies(`(cd repos/app && gh issue comment 3 --body "$(cat <<'EOF'\n**결과**: 고침\n- **조치**:\nEOF\n)")`, '/w');
  assert.deepStrictEqual(b1.map((x) => [x.type, x.dir, x.body]), [['comment', '/w/repos/app', '**결과**: 고침\n- **조치**:']]);
  const b2 = bodies("gh pr create --base main --title t --body-file - <<'EOF'\n## Summary\nx\nEOF", '/w');
  assert.deepStrictEqual(b2.map((x) => [x.type, x.body]), [['mr', '## Summary\nx']]);
  assert.deepStrictEqual(bodies('gh pr create --fill; echo "gh issue create --body x"; gh issue comment 1 --body "$MSG"', '/w'), []);
  assert.deepStrictEqual(bodies('glab mr note 3 -m "<무엇>"', '/w').map((x) => x.type), ['comment']);
  const hook = (command) => spawnSync(process.execPath, [path.join(__dirname, '..', 'hooks', 'draft-guard.js'), '--agent=claude'], { encoding: 'utf8', cwd: tmp, input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: tmp, session_id: 'd1' }), env: { ...process.env, CLAUDE_PROJECT_DIR: tmp } }).stdout;
  assert.match(hook('gh issue comment 3 --body "- **조치**:"'), /"permissionDecision":"deny".*값이 빈 항목/);
  assert.strictEqual(hook('gh issue comment 3 --body "확인했습니다"'), '');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 8. 설정: 이 PC 값이 팀 값보다 먼저 · 모르는 대상은 버림 · 서술식이면 개조식 검사 안 함
{
  const p = D.prefsOf({ chat: { writing: 'bullet', writingExcept: ['plan', 'nope'] } }, { chat: { writing: 'prose' } });
  assert.deepStrictEqual([p.writing, p.except, p.from.writing, p.from.except], ['prose', ['plan'], 'local', 'team']);
  assert.strictEqual(D.bulletsFor(p, 'issue'), false);
  const q = D.prefsOf({ chat: { writingExcept: ['chat'] } }, {});
  assert.strictEqual(D.bulletsFor(q, 'chat'), false);
  assert.strictEqual(D.bulletsFor(q, 'mr'), true);
  assert.deepStrictEqual(D.varsOf({ vars: { writing: { bulletMax: '90', localIds: ['TK-\\d+', '('] } } }).bulletMax, 90);
}

console.log('draft.test.js OK');
