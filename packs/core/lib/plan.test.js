// plan.js 점검: 기본 단계 뼈대 · 읽기 · 다음 칸 · 흐름도 폭 · 한 줄 요약 · 팀 알림 문장. 실행: node plan.test.js
'use strict';
const assert = require('assert');
const P = require('./plan');

// 종류마다 뼈대가 읽히고, 첫 단계가 진행 중 · 기본값 표시가 있다
for (const type of Object.keys(P.PRESETS).filter((k) => !P.PRESETS[k].issue)) {
  const plan = P.parse(P.template(type));
  assert.ok(plan, `${type} 뼈대를 읽는다`);
  assert.deepStrictEqual(plan.stages.map((s) => s.name), [...(type === 'new' ? [P.IDEA_STAGE] : []), ...P.PRESETS[type].stages], '신규 구축은 아이디어 · 전체 그림부터');
  assert.strictEqual(plan.stages[0].state, 'doing');
  assert.strictEqual(plan.preset, true);
  assert.strictEqual(plan.changes.length, 0, '머리말의 안내 줄은 분모 변경으로 세지 않는다');
}
assert.ok(!P.template('enhancement').includes('## 지난 릴리스'), '운영·고도화 + 전체 = 고도화(개발형) 단계');
assert.deepStrictEqual(P.PRESETS.enhancement.stages, ['요구사항', '설계', '구현', '테스트', '오픈']);
assert.ok(!P.template('new').includes('## 지난 릴리스'));
assert.ok(P.parse(P.template('없는종류')), '모르는 종류는 신규 기본값');

// 진행 방식 스프린트: 반복 단계 · 이번 스프린트(목표 · 끝 · 기능 = 구현 하위 작업) · 백로그 · 지난 스프린트. 운영·고도화는 단계 그대로 + 백로그. 전체 · 없음은 종류별 기본
assert.deepStrictEqual(P.stagesFor('new', { db: true, ui: true }, 'sprint'), [P.IDEA_STAGE, '스프린트 계획', '구현', '데모', '회고'], '스프린트는 스택 단계를 늘리지 않는다 (신규는 아이디어부터)');
assert.deepStrictEqual(P.stagesFor('enhancement', {}, 'sprint'), P.PRESETS.sprint.stages, '운영·고도화 + 스프린트 = 다른 유형과 같은 스프린트');
assert.deepStrictEqual(P.stagesFor('new', {}, 'full'), [P.IDEA_STAGE, ...P.PRESETS.new.stages]);
assert.match(P.template('new', {}, 'sprint'), /「아이디어 · 전체 그림」: 무엇을 왜 만드는지 .*`idea` 스킬.*✔ 건너뜀/, '건너뛰는 법 안내');
assert.match(P.template('new', {}, 'sprint'), /단계 상태를 처음으로 되돌린다 \(「아이디어 · 전체 그림」 은 그대로\)/);
assert.strictEqual(P.skillOf({ name: P.IDEA_STAGE }), 'idea');
assert.ok(P.isIdea('아이디어·전체 그림') && !P.isIdea('계획'), '띄어쓰기가 달라도 아이디어 단계');
assert.strictEqual(P.skillOf({ name: '설계' }), null, '고도화 「설계」 는 아키텍처 스킬로 보내지 않는다');
assert.strictEqual(P.parse(P.template('new').replace(`| 1 | ${P.IDEA_STAGE} | ▶ |`, `| 1 | ${P.IDEA_STAGE} | ✔ 건너뜀 |`)).stages[0].state, 'done', '건너뜀 = 완료로 셈');
assert.deepStrictEqual(P.missingStages(P.parse(P.template('new', {}, 'sprint')), { db: true, ui: true }, 'new', 'sprint'), [], '스프린트는 데이터 설계 · 화면설계 단계가 없어도 경고하지 않는다');
const sp = P.template('enhancement', { db: true }, 'sprint'); // 아이디어 단계 없는 스프린트 (신규는 아래에서 따로)
assert.match(P.template('new', { db: true }, 'sprint'), /## 스프린트 계획\n\n- \[ \] 이번 스프린트의 목표/, '신규 스프린트도 스프린트 계획 확인 목록');
assert.match(sp, /## 스프린트 계획\n\n- \[ \] 이번 스프린트의 목표/);
assert.match(sp, /스키마 변경 여부 \(이번 스프린트 기능만\. 있으면 `datamodel`/);
assert.ok(sp.includes('## 이번 스프린트') && sp.includes('## 백로그') && sp.includes('## 지난 스프린트') && !sp.includes('## 지난 릴리스'));
assert.deepStrictEqual(P.parse(sp).sprint, { goal: '', end: '' }, '자리표시 목표 · 끝은 빈 값');
assert.ok(P.template('enhancement', {}, 'sprint').includes('## 백로그') && !P.template('enhancement').includes('## 백로그'));

// 이슈형(운영 · 유지보수): 단계 대신 이슈 보드. 상태 줄로 상태 목록, 보류 = 멈춤, 그 밖 마지막 = 완료, 멈춘 이슈 · 이번 달 반영 · 기간 보고
assert.deepStrictEqual(P.stagesFor('enhancement', {}, 'issue'), []);
const it = P.template('enhancement', { db: true }, 'issue');
assert.ok(it.includes('## 이슈') && it.includes('## 개선 후보') && !it.includes('| # | 단계 |'));
const ib = P.parse(it.replace('|---|---|---|---|---|---|---|\n', '|---|---|---|---|---|---|---|\n| #1 | 로그인 오류 | 수정 | st_1 | 2026-09-01 | 2026-09-02 | |\n| #2 | 화면 깨짐 | 운영 반영 | st_2 | 2026-10-01 | 2026-10-10 | 2026-10-15 |\n| #3 | 배치 | 보류 | | 2026-10-05 | | |\n| #4 | 권한 | 접수 | | 2026-10-18 | | |\n').replace('## 개선 후보\n', '## 개선 후보\n\n- 검색 개선\n'));
assert.strictEqual(ib.mode, 'issue');
const is = P.issueSummary(ib, '2026-10-19');
assert.deepStrictEqual([is.active.length, is.hold.length, is.month.length, is.stale.map((r) => [r.id, r.idle])], [2, 1, 1, [['#1', 47]]]);
assert.deepStrictEqual(is.counts, { 접수: 1, 분석: 0, 수정: 1, 검증: 0 });
assert.match(P.issueReport(ib, '2026-10-13', '2026-10-19'), /## 주간 보고 \(2026-10-13 ~ 2026-10-19\)\n\n진행 2 · 운영 반영 1 · 새 접수 1 · 보류 1\n\n### 운영 반영\n\n- #2 화면 깨짐 \(2026-10-15\)/);
assert.strictEqual(P.current(ib), null, '이슈형은 지금 단계가 없다');
assert.match(P.flow(ib), /^접수 1 → 분석 0 → 수정 1 → 검증 0 → 운영 반영 \d+ \(이번 달\)\n보류 1$/);
assert.deepStrictEqual(ib.backlog, ['검색 개선']);
const custom = P.parse('# 로드맵\n\n## 이슈\n\n상태: 접수 · 원인 확인 · develop 검증 · master · 운영 반영 · 대기\n멈춤 기준: 3일\n\n| 이슈 | 제목 | 상태 | 시작 |\n|---|---|---|---|\n| 7 | a | master | 2026-10-10 |\n');
const cs = P.issueSummary(custom, '2026-10-19');
assert.deepStrictEqual([cs.doneState, Object.keys(cs.counts), cs.stale.length], ['운영 반영', ['접수', '원인 확인', 'develop 검증', 'master'], 1], '상태 목록 · 멈춤 기준은 PLAN.md 가 정한다');
assert.strictEqual(P.upgradePreset(it, 'enhancement', { db: true }, 'issue'), null);
const spPlan = P.parse(sp.replace('목표: <데모에서 보여 줄 한 줄>', '목표: 로그인해서 목록을 본다').replace(/끝: <[^>]*>/, '끝: 2026-10-12').replace('## 이번 스프린트\n\n', '## 이번 스프린트\n\n- [x] 로그인\n- [ ] 목록\n').replace('## 백로그\n', '## 백로그\n\n- 알림\n- 통계\n').replace('## 지난 스프린트\n', '## 지난 스프린트\n\n- 2026-10-05 · S1 뼈대 · 잘 된 것 a · 바꿀 것 b\n'));
assert.deepStrictEqual(spPlan.sprint, { goal: '로그인해서 목록을 본다', end: '2026-10-12' });
assert.deepStrictEqual(spPlan.backlog, ['알림', '통계']);
assert.strictEqual(spPlan.releases.length, 1, '지난 스프린트 = 지난 릴리스처럼 센다');
assert.deepStrictEqual([spPlan.stages[1].detail.done, spPlan.stages[1].detail.total], [1, 2], '이번 스프린트 기능 = 구현 단계의 하위 작업');
spPlan.stages[0].state = 'done'; spPlan.stages[1].state = 'doing';
assert.strictEqual(P.shortLine(spPlan), '로드맵 완료 1/4 · 스프린트 목표 「로그인해서 목록을 본다」 (끝 2026-10-12) · 지금 2.구현 1/2 · 다음 구현: 목록 · 백로그 2 · 기본 단계 그대로 (프로젝트에 맞게 고칠지 사용자에게 묻는다)');
assert.strictEqual(P.parse(P.template('new')).backlog, null, '전체 방식은 백로그 절이 없다');

// 상태 · 하위 작업(표 · 목록) · 분모 변경 · 지난 릴리스
const text = `# 로드맵

| # | 단계 | 상태 | 시작 | 완료 |
|---|---|---|---|---|
| 1 | 계획 | ✔ | 2026-09-01 | 2026-09-05 |
| 2 | 요구사항 분석 | 완료 | | |
| 3 | 설계 | ▶ | 2026-10-01 | |
| 4 | 구현 | ◇ | | |
| 5 | 테스트 | | | |

## 3. 설계

| 영역 | 상세 설계 | 기능정의 |
|---|---|---|
| 주문 | ✔ | ✔ |
| 배송 | ✔ | ○ |
| 회원 | ○ | - |

## 구현

- [x] 공통 모듈
- [ ] 주문 API

## 분모 변경

- 2026-10-03 · 설계 영역 2 → 3 · 회원 추가

## 지난 릴리스

- 2026-08-30 · R1
- 2026-09-20 · R2
`;
const plan = P.parse(text);
assert.deepStrictEqual(plan.stages.map((s) => s.state), ['done', 'done', 'doing', 'unsplit', 'todo']);
assert.strictEqual(plan.stages[0].start, '2026-09-01');
assert.strictEqual(plan.stages[2].start, '2026-10-01');
assert.strictEqual(plan.preset, false);
const design = plan.stages[2].detail;
assert.strictEqual(design.kind, 'table');
assert.deepStrictEqual(design.cols, ['상세 설계', '기능정의']);
assert.deepStrictEqual([design.done, design.total], [3, 5], '- 칸은 분모에서 뺀다');
assert.strictEqual(plan.stages[3].detail.kind, 'list');
assert.deepStrictEqual([plan.stages[3].detail.done, plan.stages[3].detail.total], [1, 2]);
assert.strictEqual(plan.changes.length, 1);
assert.strictEqual(plan.releases.length, 2);
assert.strictEqual(P.doneCount(plan), 2);
assert.strictEqual(P.current(plan).name, '설계');

// 다음 칸: 진행 칸이 없으면 첫 미착수 칸 (영역 순서대로)
assert.strictEqual(P.nextLine(plan), '설계: 배송 기능정의');
const allDone = P.parse(text.replace('| 배송 | ✔ | ○ |', '| 배송 | ✔ | ✔ |').replace('| 회원 | ○ | - |', '| 회원 | ✔ | - |'));
assert.strictEqual(P.nextLine(allDone), '설계 마무리 → 구현');
assert.strictEqual(P.nextLine(P.parse(text.replace('| 3 | 설계 | ▶ |', '| 3 | 설계 | ○ |'))), '설계 시작');
// 모든 단계 완료: 다음 유형은 같은 워크스페이스에서 kedovi type
const finished = P.parse('# 로드맵\n\n| # | 단계 | 상태 | 시작 | 완료 |\n|---|---|---|---|---|\n| 1 | 착수 | ✔ | | |\n| 2 | 최종 보고 | ✔ | | |\n');
assert.strictEqual(P.nextLine(finished), '모든 단계 완료');
assert.match(P.nextLine(finished, 'consulting'), /^모든 단계 완료 → 다음 유형은 새 워크스페이스 없이 여기서 kedovi type new \(신규 구축\) 또는 kedovi type modernization/);
assert.match(P.nextLine(finished, 'new'), /kedovi type enhancement/);
assert.strictEqual(P.nextLine(finished, 'enhancement'), '모든 단계 완료');
assert.match(P.shortLine(finished, '', 'consulting'), /다음 모든 단계 완료 → .*kedovi type new/);

// 표에 ◀다음 · 진행 막대
const table = P.detailTable(P.current(plan));
assert.match(table, /\| 배송 \| ✔ \| ◀다음 \| 1\/2 \|/);
assert.match(table, /\| 회원 \| ○ \| - \| 0\/1 \|/);
assert.match(table, /■+□+ 3\/5/);
assert.match(P.detailTable(plan.stages[4]), /쪼개지 않았습니다/);

// 흐름도: 한글 2칸 폭으로 맞춘다 · 폭을 넘으면 줄을 바꾼다 · 지금 위치 ▲
assert.strictEqual(P.width('설계'), 4);
assert.strictEqual(P.width('A·B'), 3);
const lines = P.flow(plan, 40).split('\n');
assert.ok(lines.every((l) => P.width(l) <= 40), '폭 안');
assert.ok(lines.some((l) => l.includes('▲ 지금')));
const nameLine = lines.find((l) => l.includes('3.설계'));
const markLine = lines[lines.indexOf(nameLine) + 1];
const col = (l, s) => P.width(l.slice(0, l.indexOf(s)));
assert.strictEqual(col(markLine, '▶'), col(nameLine, '3.설계'), '상태가 단계 이름 아래에 온다');
assert.ok(lines.some((l) => l.startsWith('→ ')), '다음 줄은 화살표로 이어진다');

// 한 줄 · JSON
assert.strictEqual(P.shortLine(plan), '로드맵 완료 2/5 · 지금 3.설계 3/5 · 다음 설계: 배송 기능정의');
assert.match(P.shortLine(P.parse(P.template('new'))), /기본 단계 그대로/);
const j = P.toJson(plan);
assert.strictEqual(j.current, 3);
assert.strictEqual(j.stages[2].sub.total, 5);
assert.strictEqual(j.releases, 2);

// 스택에 따른 단계: 데이터 설계 → 화면설계 를 구현 앞에. 반복형은 단계를 늘리지 않고 분석 체크 목록
assert.deepStrictEqual(P.stagesFor('modernization', { db: true, ui: true }), ['AS-IS 분석', '범위·계획', '요구사항', '아키텍처·설계', '데이터 설계', '화면설계', '구현', '테스트', '데이터 이관', '전환', '안정화']);
assert.deepStrictEqual(P.stagesFor('new', { ui: true }), [P.IDEA_STAGE, '계획', '요구사항 분석', '설계', '화면설계', '구현', '테스트', '배포', '운영']);
assert.deepStrictEqual(P.stagesFor('new', {}), [P.IDEA_STAGE, ...P.PRESETS.new.stages]);
assert.deepStrictEqual(P.stagesFor('enhancement', { db: true, ui: true }), ['요구사항', '설계', '데이터 설계', '화면설계', '구현', '테스트', '오픈'], '고도화도 스택 단계를 구현 앞에');
const enh = P.parse(P.template('enhancement', { db: true, ui: true }, 'sprint'));
assert.deepStrictEqual(enh.stages[0].detail.items.map((x) => x.name.split(' (')[0]).slice(1), ['스키마 변경 여부', '화면 변경 여부']);
assert.deepStrictEqual(P.parse(P.template('new', { db: true })).stages.map((x) => x.name).slice(3, 6), ['설계', '데이터 설계', '구현']);
assert.match(P.template('new', { db: true }), /단계별 스킬: 아이디어 · 전체 그림 → `idea` · 데이터 설계 → `datamodel`[\s\S]*「설계」: 서버 아키텍처.*`architecture` 스킬/);
assert.strictEqual(P.skillOf({ name: '화면 설계' }), 'screens', '띄어 써도 같은 단계');
// 사람이 고친 로드맵은 그대로 두고 경고만
assert.deepStrictEqual(P.missingStages(plan, { db: true, ui: true }, 'new'), ['스택에 DB · 화면이 있는데 「데이터 설계」 · 「화면설계」 단계가 없습니다 (산출물: datamodel 스킬 · screens 스킬. 구현 앞에 넣을지 사용자에게 묻는다)'], '한 줄');
assert.deepStrictEqual(P.missingStages(plan, { db: true }, 'new'), ['스택에 DB 가 있는데 「데이터 설계」 단계가 없습니다 (산출물: datamodel 스킬. 구현 앞에 넣을지 사용자에게 묻는다)']);
assert.deepStrictEqual(P.missingStages(P.parse(text.replace('| 4 | 구현 |', '| 4 | 화면 설계 | ○ | | |\n| 5 | 구현 |')), { ui: true }, 'new'), [], '띄어 쓴 「화면 설계」 도 있는 것');
assert.deepStrictEqual(P.missingStages(plan, {}, 'new'), []);
assert.deepStrictEqual(P.missingStages(plan, { db: true }, 'enhancement', 'sprint'), [], '반복형은 단계 경고 없음');
assert.deepStrictEqual(P.missingStages(plan, { db: true }, 'enhancement', 'issue'), [], '이슈형은 단계 경고 없음');
assert.strictEqual(P.upgradePreset(text, 'new', { db: true }), null, '기본 단계 표시가 없으면 고치지 않는다');
// 기본 단계 그대로면 상태 · 날짜를 옮기며 단계를 더한다
const pre = P.template('new').replace(`| 1 | ${P.IDEA_STAGE} | ▶ | | |`, `| 1 | ${P.IDEA_STAGE} | ✔ | 2026-10-01 | 2026-10-03 |`);
const up = P.parse(P.upgradePreset(pre, 'new', { db: true, ui: true }));
assert.deepStrictEqual(up.stages.map((x) => [x.no, x.name, x.state]).slice(0, 6), [[1, P.IDEA_STAGE, 'done'], [2, '계획', 'todo'], [3, '요구사항 분석', 'todo'], [4, '설계', 'todo'], [5, '데이터 설계', 'todo'], [6, '화면설계', 'todo']]);
// 0.74 전에 만든 신규 로드맵(아이디어 단계 없음)에는 아이디어 단계를 끼우지 않는다
const old = P.template('new').split('\n').filter((l) => !l.includes(`| ${P.IDEA_STAGE} |`)).join('\n').replace('| 2 | 계획 | ○ | | |', '| 1 | 계획 | ✔ | 2026-10-01 | 2026-10-03 |');
const upOld = P.parse(P.upgradePreset(old, 'new', { db: true }));
assert.ok(upOld && !upOld.stages.some((x) => x.name === P.IDEA_STAGE) && upOld.stages.some((x) => x.name === '데이터 설계'), '옛 신규 로드맵: 아이디어 없이 스택 단계만');
assert.strictEqual(up.stages[0].end, '2026-10-03');
assert.strictEqual(P.upgradePreset(P.template('new', { db: true }), 'new', { db: true }), null, '이미 맞으면 null');

// 분모 변경의 최근 줄: 위가 최신이든 아래가 최신이든 날짜로
assert.strictEqual(P.latest(['2026-10-08 · c', '2026-10-07 · b', '2026-10-06 · a']), '2026-10-08 · c');
assert.strictEqual(P.latest(['2026-10-06 · a', '2026-10-07 · b', '2026-10-08 · c']), '2026-10-08 · c');
assert.strictEqual(P.latest(['2026-10-06 · a', '2026-10-06 · b']), '2026-10-06 · b', '같은 날 · 아래가 최신인 꼴이면 아래');
assert.strictEqual(P.latest(['2026-10-08 · x', '2026-10-08 · y', '2026-10-01 · z']), '2026-10-08 · x', '같은 날 · 위가 최신인 꼴이면 위');
assert.strictEqual(P.latest([]), null);

// 단계 표가 없으면 null
assert.strictEqual(P.parse('# 로드맵\n\n아직 없음\n'), null);

// 팀 알림: PLAN.md 가 바뀐 push 는 로드맵 한 줄 + 흐름도
process.env.KEDOVI_CONFIG_DIR = require('path').join(require('os').tmpdir(), `kedovi-plan-${process.pid}`);
const n = require('./notify');
const msgs = n.teamMessages({ chat: '1', token: 't', events: ['handoff'] }, { project: 'p', handoffs: [], settings: [], plan: { author: 'kim', text } });
assert.strictEqual(msgs.length, 1);
assert.match(msgs[0], /로드맵 갱신 \(kim\)\n로드맵 완료 2\/5/);
assert.ok(msgs[0].includes('```'));
assert.strictEqual(n.teamMessages({ chat: '1', token: 't', events: ['settings'] }, { project: 'p', plan: { author: 'kim', text } }).length, 0, 'handoff 알림을 끈 팀은 보내지 않는다');

// 외부 일정 정본(vars.plan.external): 「기본 단계 그대로」 안내 대신 그 위치, check 경고 없음, kedovi plan external 로 적고 지운다
{
  const preset = P.parse(P.template('enhancement'));
  assert.match(P.shortLine(preset), /기본 단계 그대로/);
  const ext = 'GitLab 마일스톤 https://gitlab.example.com/grp/app/-/milestones';
  assert.ok(!/기본 단계 그대로/.test(P.shortLine(preset, ext)) && P.shortLine(preset, ext).includes(`일정 정본: ${ext}`));
  assert.strictEqual(P.externalOf({ vars: { plan: { external: ` ${ext} ` } } }), ext);
  assert.strictEqual(P.externalOf({}), '');
  const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawnSync } = require('child_process');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-plan-ext-'));
  spawnSync('git', ['-C', d, 'init', '-q']);
  fs.writeFileSync(path.join(d, 'workspace.json'), JSON.stringify({ project: { name: 'p', type: 'enhancement' }, packs: ['core'], repos: [] }, null, 2));
  fs.mkdirSync(path.join(d, 'handoffs'));
  fs.writeFileSync(path.join(d, 'handoffs', 'PLAN.md'), `${P.template('enhancement')}\n`);
  const tool = (...a) => spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'plan.js'), ...a], { cwd: d, encoding: 'utf8' });
  assert.match(tool('check').stdout, /⚠ 로드맵: 로드맵이 기본 단계 그대로입니다/);
  assert.match(tool('external', ext).stdout, /✔ 일정 정본: /);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, 'workspace.json'), 'utf8')).vars.plan.external, ext);
  const c = tool('check').stdout;
  assert.ok(!c.includes('⚠'), 'check 경고 없음');
  assert.ok(c.includes(`· 로드맵: 일정 정본은 ${ext}`), '위치 한 줄');
  assert.ok(tool('--short').stdout.includes(`일정 정본: ${ext}`));
  assert.match(tool('external', 'off').stdout, /지웠습니다/);
  assert.match(tool('check').stdout, /기본 단계 그대로/);
  fs.rmSync(d, { recursive: true, force: true });
}

console.log('plan.test.js ✔');
