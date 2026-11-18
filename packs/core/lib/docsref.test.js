// docsref.js 점검: ID 정의 찾기(제목 · 표 행 · 문단 · 화면설계서 장) · 동결 · 사용처 · 문서 점검. 실행: node docsref.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DR = require('./docsref');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-docsref-'));
const put = (f, c) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); };
put('40-functions.md', '# 기능정의\n\n## 주문\n\n### FN-001 수동 주문\n\n본문 한 줄\n\n#### 처리\n\n세부\n\n### FN-002 취소\n\nFN-001 과 같은 경로\n\n## 대조\n\n| 요구 | 기능 |\n|---|---|\n| REQ-001 | FN-001 · FN-002 |\n');
put('30-design.md', '# 설계\n\n| 결정 | 내용 |\n|---|---|\n| D-1 | 확인창을 띄운다 |\n| D-2 | 원클릭 |\n\n- **POL-001** 한도는 계좌마다\n  둘째 줄\n\n```\n### FN-001 코드 블록 안은 정의가 아니다\n```\n');
put('old.md', '# 옛 설계\n\n| 항목 | 값 |\n|---|---|\n| 상태 | 동결 (2026-10-09, 정본: app/src) |\n\n### FN-009 옛 기능\n\n본문\n');
put('screens/web.html', '<body><section class="sheet" id="SCR-001" data-label="로그인"><h2>로그인</h2><p>아이디 <b>입력</b></p></section></body>');
put('html/40-functions.html', '### FN-001 생성물은 보지 않는다');
put('AGENTS.md', '### FN-001 지침 파일은 보지 않는다');

// 정의: 제목 절(하위 제목 포함, 다음 같은 수준 제목 전까지) · 표 행(머리와 함께) · 문단 · 화면설계서 장 · 코드 블록 · 생성물 · 지침 파일은 뺀다
const docs = DR.listDocs(dir);
assert.deepStrictEqual(docs.map((d) => d.rel).sort(), ['30-design.md', '40-functions.md', 'old.md', 'screens/web.html']);
const t = [{ name: 'plans', dir }];
const fn1 = DR.show(t, 'FN-001');
assert.strictEqual(fn1.length, 1, '대조 표 행(첫 칸 REQ)은 FN-001 의 정의가 아니다 · 코드 블록 안 제목도 아니다');
assert.deepStrictEqual([fn1[0].rel, fn1[0].line, fn1[0].kind], ['40-functions.md', 5, '제목']);
assert.ok(fn1[0].lines.join('\n').includes('#### 처리') && !fn1[0].lines.join('\n').includes('FN-002 취소'), '하위 제목까지, 다음 같은 수준 제목 전까지');
const d1 = DR.show(t, 'D-1')[0];
assert.deepStrictEqual(d1.lines, ['| 결정 | 내용 |', '|---|---|', '| D-1 | 확인창을 띄운다 |'], '표 행은 머리와 함께');
assert.deepStrictEqual(DR.show(t, 'POL-001')[0].lines, ['- **POL-001** 한도는 계좌마다', '  둘째 줄']);
const scr = DR.show(t, 'SCR-001')[0];
assert.strictEqual(scr.kind, '화면설계서 장');
assert.ok(scr.lines.includes('로그인') && scr.lines.some((l) => l.includes('아이디 입력')), '장은 태그를 벗긴 글로');
assert.strictEqual(DR.show(t, 'FN-009')[0].frozen, true, '「| 상태 | 동결」 문서는 동결');
assert.strictEqual(DR.show(t, 'FN-001', '30-design').length, 0, '--in 으로 문서를 고른다');
assert.strictEqual(DR.show(t, 'FN-404').length, 0);
assert.ok(DR.isFrozen('# a\n\n**상태**: 동결 (2026-10-09)\n') && !DR.isFrozen('# a\n\n상태: 초안\n'));

// 사용처: 정의 줄 ★ · 동결 · 생성물(html/) 빼기 · 다른 ID 의 일부(FN-0011)는 아님
put('more.md', '# 더\n\nFN-0011 은 다른 ID, FN-001 은 같은 ID\n');
const hits = DR.refs([{ name: 'plans', dir, kind: 'docs' }], 'FN-001');
assert.deepStrictEqual(hits.map((h) => `${h.rel}:${h.line}${h.def ? '★' : ''}`).sort(), ['30-design.md:12', '40-functions.md:15', '40-functions.md:21', '40-functions.md:5★', 'more.md:3'].sort(), '코드 블록 안도 나오는 곳이다 (정의는 아님)');

// 문서 점검: 큰 문서 · 머리말 이력 · 같은 문장 (동결 문서는 뺀다)
const same = '이 문장은 두 문서에 똑같이 들어 있어서 한 문서에만 남겨 두고 다른 문서에서는 ID 링크로 바꿔야 하는 꽤 긴 설명 문장이다';
put('big.md', `# 큰 문서\n\n| 변경 | ${Array.from({ length: 6 }, (_, i) => `2026-10-0${i + 1}: 결정 반영 ${'가'.repeat(200)}`).join(' · ')} |\n\n## 본문\n\n${same}\n\n${'긴 본문 '.repeat(9000)}\n`);
put('dup.md', `# 다른 문서\n\n${same}\n`);
put('old2.md', `# 동결\n\n상태: 동결\n\n${'옛 본문 '.repeat(20000)}\n${same}\n`);
const w = DR.health(dir, { maxKB: 60 });
assert.strictEqual(w.length, 3, w.join('\n'));
assert.match(w[0], /큰 문서 1개 \(상한 60KB, vars\.docs\.maxKB\): big\.md \d+KB/);
assert.match(w[1], /머리말에 변경 이력이 쌓인 문서 1개: big\.md \dKB · 날짜 6/);
assert.match(w[2], /같은 문장 1개가 여러 문서에 있습니다 .*big\.md · dup\.md/);
assert.deepStrictEqual(DR.health(dir, { maxKB: 1000 }).filter((x) => /큰 문서/.test(x)), [], '상한을 올리면 큰 문서 경고 없음');

// 문서 점검: 긴 표 칸 · 문단형 표 · 칸 안 경위 · 그림 없는 큰 문서
{
  const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-health-'));
  const w2 = (f, c) => fs.writeFileSync(path.join(t2, f), c);
  const row = (a, b) => `| ${a} | ${b} |`;
  w2('dec.md', ['# 결정', '', '| ID | 결정 |', '|---|---|', row('D-1', '가'.repeat(500)), row('D-2', '2026-01-01 정함 · 2026-02-01 개정 · 2026-03-01 다시 엶'),
    ...Array.from({ length: 10 }, (_, i) => row(`D-${i + 3}`, '설명 '.repeat(60))), row('D-13', '2026-04-01 개정: ' + '설명 '.repeat(30)), '', '```', row('X', '나'.repeat(900)), '```', ''].join('\n'));
  w2('flow.md', `# 흐름\n\n${'① 받는다 → ② 고른다 → ③ 보낸다. '.repeat(20)}\n${'본문 '.repeat(8000)}\n`);
  w2('ok.md', `# 짧은 표\n\n| a | b |\n|---|---|\n${Array.from({ length: 12 }, () => row('x', 'y')).join('\n')}\n${row('IA 개정', '개정 후보')}\n`);
  const h = DR.health(t2, {});
  assert.ok(h.some((x) => /^긴 표 칸 1곳 \(400자 넘음.*dec\.md 1곳.*dec\.md:5 500자/.test(x)), h.join('\n'));
  assert.ok(h.some((x) => /^문단형 표 문서 1개 \(표 칸 평균 80자 넘음.*dec\.md 평균 \d+자/.test(x)), '문단형 표');
  assert.ok(h.some((x) => /^표 칸 안 경위 2곳 .*dec\.md:6/.test(x)), h.join('\n'));
  assert.ok(h.some((x) => /^그림 없는 큰 문서 1개 .*flow\.md \d+KB · → 40 · ① 60/.test(x)), '그림 없는 큰 문서');
  assert.ok(!h.some((x) => /ok\.md/.test(x)), '짧은 표는 경고 없음');
  assert.ok(!DR.health(t2, { cellMax: 1000, cellAvg: 1000 }).some((x) => /긴 표 칸|문단형/.test(x)), '기준을 올리면 경고 없음');
  w2('flow.md', `# 흐름\n\n\`\`\`mermaid\nflowchart LR\n a-->b\n\`\`\`\n\n${'① 받는다 → '.repeat(20)}\n${'본문 '.repeat(8000)}\n`);
  assert.ok(!DR.health(t2, {}).some((x) => /그림 없는/.test(x)), 'mermaid 가 있으면 경고 없음');
  assert.ok(DR.health(null, { docs: [{ rel: 'x.md', text: '# x\n\n| a | b |\n|---|---|\n| 1 | ' + '다'.repeat(450) + ' |\n' }] }).some((x) => /x\.md:5/.test(x)), 'docs 목록을 직접 준다');
}

// 문서 점검: 문장형 제목 (제목 · 헤더 끝의 종결 어미 · 물음표, 코드 블록 · 명사는 뺀다)
{
  const md = ['---', 'title: 설치하기', '---', '# 빠른 시작', '## 무엇이 어디에 저장되나', '## 저장 위치', '### 규칙은 넣지 않는다', '## 왜 이 모델인가', '## 크기 · 주기',
    '## 설정 바꾸기 (관리자)', '## 필요', '## 문서 개요', '## 추가', '## 어떻게 하나요?', '```', '## 코드 안 하기', '```', ''].join('\n');
  assert.deepStrictEqual(DR.sentenceHeads(md).map((h) => h.text), ['설치하기', '무엇이 어디에 저장되나', '규칙은 넣지 않는다', '왜 이 모델인가', '설정 바꾸기 (관리자)', '어떻게 하나요?']);
  const hw = DR.health(null, { docs: [{ rel: 'a.md', text: md }] }).find((x) => /^문장형 제목/.test(x));
  assert.match(hw, /^문장형 제목 6곳 .*a\.md:2 「설치하기」.* 외 1개\. 제목 · 헤더는 명사 · 명사구로/);
  assert.ok(!DR.health(null, { docs: [{ rel: 'b.md', text: '# 빠른 시작\n\n## 저장 위치\n' }] }).some((x) => /문장형/.test(x)), '명사형 제목은 경고 없음');
}

// 문서 점검: 긴 코드 블록 · 파일:줄 참조 (mermaid · tree · screen 은 뺀다)
{
  const long = Array.from({ length: 16 }, (_, i) => `int a${i} = ${i};`).join('\n');
  const md = ['# 주문', '', '```java', long, '```', '', '```mermaid', long, '```', '', '```tree', long, '```', '', '```bash', 'kedovi init', '```', '',
    '처리는 OrderService.java:120 과 `src/order.ts:30-42` 에서 한다. [링크](https://x/y#L77). 시각 10:30 · v1.2:3 은 아니다.', ''].join('\n');
  const c = DR.codeMarks(md, 15);
  assert.deepStrictEqual(c.blocks, [{ line: 3, lang: 'java', lines: 16 }]);
  assert.deepStrictEqual(c.refs.map((r) => r.text), ['OrderService.java:120', 'src/order.ts:30-42', '#L77']);
  const hw = DR.health(null, { docs: [{ rel: 'a.md', text: md }] });
  assert.ok(hw.some((x) => /^긴 코드 블록 1곳 \(15줄 넘음, vars\.docs\.codeMax.*a\.md:3 16줄/.test(x)), hw.join('\n'));
  assert.ok(hw.some((x) => /^파일:줄 참조 3곳: a\.md:64 「OrderService\.java:120」 외 2곳/.test(x)), hw.join('\n'));
  assert.ok(!DR.health(null, { docs: [{ rel: 'a.md', text: md }], codeMax: 40 }).some((x) => /긴 코드/.test(x)), '기준을 올리면 경고 없음');
}

// 문서 점검: 본문에 쓴 근거 · 출처 줄 (인용구 · 코드 블록 밖), 인용구 안 파일:줄도 잡는다
{
  const md = ['# 분석', '', '주문은 한 번 저장한다.', '근거: OrderService.java:120', '- 출처: 회의록 3', '**참고 자료**: 정책 문서', '', '> 근거: OrderDao.java:40', '', '| 근거 | 값 |', '|---|---|', '```', '근거: 코드', '```', '근거라는 말은 괜찮다', ''].join('\n');
  assert.deepStrictEqual(DR.sourceLines(md).map((x) => x.line), [4, 5, 6]);
  assert.deepStrictEqual(DR.codeMarks(md, 15).refs.map((r) => r.text), ['OrderService.java:120', 'OrderDao.java:40'], '인용구 안 파일:줄도 잡는다');
  const hw = DR.health(null, { docs: [{ rel: 'a.md', text: md }] });
  assert.ok(hw.some((x) => /^본문에 쓴 근거 · 출처 3줄: a\.md:4 외 2줄\. .*인용구로/.test(x)), hw.join('\n'));
}

// 문서 점검: 소스 코드 표현 · 이름 모양. 코드 블록 · 명령 · 설정 키 · 표 안 변수는 뺀다 · 허용 목록 · 건너뛸 문서
{
  const md = ['# 주문', '', '저장은 order.ts 의 saveOrder() 가 한다. OrderService 와 orderId 를 쓴다.', '`kedovi docs build x.js` · `vars.docs.maxKB` 는 괜찮다.', '| 필드 |', '|---|', '| orderId |', '```', 'a.js', '```', ''].join('\n');
  const hw = DR.health(null, { docs: [{ rel: 'a.md', text: md }] });
  assert.ok(hw.some((x) => /^소스 코드 표현 2곳 .*a\.md:3 「order\.ts」 · a\.md:3 「saveOrder\(\)」/.test(x)), hw.join('\n'));
  assert.ok(hw.some((x) => /^코드 이름 모양 2곳 .*「OrderService」 · a\.md:3 「orderId」/.test(x)), hw.join('\n'));
  const off = DR.health(null, { docs: [{ rel: 'a.md', text: md }], codeAllow: [/^order/i, /saveOrder/] });
  assert.ok(!off.some((x) => /소스 코드 표현|코드 이름 모양/.test(x)), off.join('\n'));
  assert.ok(!DR.health(null, { docs: [{ rel: 'a.md', text: md }], codeSkip: ['a.md'] }).some((x) => /소스 코드 표현/.test(x)));
}

// 코드 대조: 정의(제목 · 표 첫 칸 · 화면설계서 장) ↔ 코드 주석의 ID. 동결 · 「다음 스프린트」 는 누락에서 뺀다
const plan = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-trace-docs-'));
const code = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-trace-code-'));
const putIn = (root, f, c) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), c); };
putIn(plan, 'fn.md', '# 기능\n\n### FN-001 주문\n\n본문 FN-002 참조\n\n| 기능 | 이름 |\n|---|---|\n| **FN-002** | 취소 |\n| FN-003 | 정정 (다음 스프린트) |\n| FN-004 | 조회 |\n\n```\n### FN-005 코드 블록\n```\n');
putIn(plan, 'old.md', '# 옛\n\n상태: 동결\n\n### FN-006 옛 기능\n');
putIn(plan, 'screens/a.html', '<section class="sheet" id="FN-007"></section>');
putIn(code, 'src/order.js', '// FN-001 주문\nfunction order() {}\n/** FN-002 취소 */\n');
putIn(code, 'src/x.js', '// FN-099 오타\nconst a = "SCR-001";\n');
const git = (args) => require('child_process').execFileSync('git', ['-C', code, ...args], { stdio: 'ignore' });
git(['init', '-q']); git(['add', '-A']);
const tr = DR.trace([{ name: 'plans', dir: plan }], [{ name: 'app', dir: code }], ['FN']);
assert.deepStrictEqual([...tr.defined.keys()].sort(), ['FN-001', 'FN-002', 'FN-003', 'FN-004', 'FN-006', 'FN-007'], '본문 언급 · 코드 블록은 정의가 아니다');
assert.deepStrictEqual([...tr.found.keys()].sort(), ['FN-001', 'FN-002']);
assert.deepStrictEqual(tr.missing.sort(), ['FN-004', 'FN-007']);
assert.deepStrictEqual(tr.skipped, { frozen: 1, later: 1 });
assert.deepStrictEqual(tr.unknown.map((u) => `${u.id} ${u.rel}:${u.line}`), ['FN-099 src/x.js:1'], '다른 머리말(SCR)은 아님');
assert.throws(() => DR.trace([], [], []), /머리말/);
for (const d of [plan, code]) fs.rmSync(d, { recursive: true, force: true });

{
  // 규모 문서: 구성 · 결정 문서가 생겼는데 수치가 없으면 알린다 (「과하다 · 필요 없다」 판단의 근거)
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'assets', 'scale', 'template.md'), 'utf8');
  const sc = (docs) => DR.health(null, { docs, scale: true }).filter((x) => /^규모 문서/.test(x));
  const dec = { rel: '90-decisions/DEC-001.md', text: '# DEC-001 서버\n\n> 상태: 확정\n' };
  const archTpl = { rel: '10-system/architecture.md', text: '# 시스템 구성도\n\n> 상태: 초안 · 아래 서비스 이름 · 버전 · 서버 사양은 견본이다\n' };
  const archOwn = { rel: '10-system/architecture.md', text: '# 시스템 구성도\n\n> 상태: 초안\n' };
  assert.deepStrictEqual(sc([archTpl]), [], '구성 문서가 견본 그대로면 아직 묻지 않는다');
  assert.deepStrictEqual(sc([{ rel: 'a.md', text: '# a\n' }]), [], '구성 · 결정 문서가 없으면 경고 없음');
  assert.ok(/규모 문서 없음/.test(sc([dec]).join()), '결정이 있는데 규모 문서가 없으면 알린다');
  assert.ok(/규모 문서 없음/.test(sc([archOwn]).join()), '직접 쓴 구성 문서도 같다');
  assert.ok(/수치 없음.*00-overview\/scale\.md/.test(sc([dec, { rel: '00-overview/scale.md', text: tpl }]).join()), '견본 그대로면 수치 없음');
  assert.ok(!DR.scaleFilled(tpl), '견본의 <예: 100명> 은 채운 것이 아니다');
  const filled = tpl.replace('| 가입 사용자 | <예: 100명> |', '| 가입 사용자 | 2,000명 |');
  assert.ok(DR.scaleFilled(filled) && !sc([dec, { rel: '00-overview/scale.md', text: filled }]).length, '「지금」 칸에 수치가 있으면 경고 없음');
  assert.ok(DR.scaleFilled(tpl.replace('| 하루 생성 데이터 (건) | <> |', '| 하루 생성 데이터 (건) | 미정 |')), '미정도 답한 것으로 본다 (미결 목록이 쫓는다)');
  assert.ok(!DR.scaleFilled(tpl.replace('| 가입 사용자 | <예: 100명> | <> |', '| 가입 사용자 | <예: 100명> | 5만 |')), '1년 뒤 칸만 채우면 아직 아니다');
  assert.deepStrictEqual(DR.health(null, { docs: [dec] }).filter((x) => /^규모 문서/.test(x)), [], '기획 repo 가 아니면(scale 꺼짐) 묻지 않는다');
  const frozen = { rel: '00-overview/scale.md', text: '# 규모\n\n> 상태: 동결\n\n| 항목 | 지금 |\n|---|---|\n| 사용자 | 100 |\n' };
  assert.ok(DR.isFrozen(frozen.text) && !sc([dec, frozen]).length, '인용구 「> 상태: 동결」 도 동결이고, 동결된 규모 문서도 있는 것으로 센다');
  const row = (v) => `| 항목 | 지금 | 1년 |\n|---|---|---|\n| 사용자 | ${v} | 1 |\n`;
  assert.ok(DR.scaleFilled(row('<50명')) && DR.scaleFilled(row('수천 명')) && DR.scaleFilled(row('a \\| b 3')), '<50명 · 수 단위 · 이스케이프한 | 는 값이다');
  assert.ok(DR.scaleFilled(row('천만 건')) && !DR.scaleFilled(row('백업 예정')) && !DR.scaleFilled(row('만들 예정')), '수 단위 글자는 수로 쓰인 때만');
  assert.ok(!DR.scaleFilled(row('<>')) && !DR.scaleFilled(row('')), '칸 전체가 <…> 이거나 빈 칸은 아니다');
  assert.ok(!DR.scaleFilled('```\n' + row('100') + '```\n'), '코드 블록 안 표는 보지 않는다');
  assert.ok(DR.scaleFilled('| 항목 | 현재 |\n|---|---|\n| 사용자 | 100 |\n'), '「현재」 열도 본다');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log('docsref.test.js ✔');
