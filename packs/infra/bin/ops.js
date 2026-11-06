#!/usr/bin/env node
/**
 * compose 스택 운영 검증 템플릿 넣기 · 실행 (kedovi ops).
 *
 *   kedovi ops add lifecycle|alerts|preflight|all [--repo R] [--dir compose 폴더] [--dry-run] [--json]
 *   kedovi ops preflight [서비스...] [--repo R | --dir 배포 폴더] [--force] [-- 통과하면 실행할 명령]
 *   kedovi ops lifecycle [서비스...] [--repo R | --dir compose 폴더]
 *
 * lifecycle : release 수명 시험 (restart 2회 · SIGKILL · stop/start → healthy · 재시작 루프 · PIDS · 좀비) + GitLab CI job 예시
 * alerts    : 운영 수명 지표(node_exporter textfile: 재시작 · PIDS · 메모리 anon/file · 기동 시각 · 소켓 재연결) + Prometheus 경보 규칙
 * preflight : 배포 전 확인 (도는 배치 · 재생성 컨테이너 · 사라지는 상태 → 위험하면 멈춤) + 설정 파일
 *
 * 파일은 <repo>/<--dir>/<ops.dir>/ 에 쓴다 (서버에 kedovi 이 없어도 bash 로 돈다). 있는 파일은 덮지 않는다.
 * 값은 workspace.json vars: ops.repo · ops.dir · ops.metricsPrefix · branch.release. Node 기본 모듈만 쓴다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKS = path.resolve(__dirname, '..', '..');
const ASSETS = path.join(PACKS, 'infra', 'assets', 'ops');
const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

const KINDS = {
  lifecycle: {
    title: 'release 수명 시험',
    files: ['lifecycle-test.sh', 'lifecycle.gitlab-ci.yml'],
    next: (v) => [
      `로컬: docker compose up -d --wait 뒤 bash ${v.opsDir}/lifecycle-test.sh  (또는 kedovi ops lifecycle)`,
      `CI: .gitlab-ci.yml 에 include: [{ local: ${v.opsDir}/lifecycle.gitlab-ci.yml }] (${v.releaseBranch} 브랜치에서만 돈다. stage · compose 파일 · 이미지 태그를 프로젝트에 맞춘다)`,
    ],
  },
  alerts: {
    title: '운영 수명 경보',
    files: ['container-metrics.sh', 'container-lifecycle.rules.yml'],
    next: (v) => [
      `서버: ${v.opsDir}/container-metrics.sh 를 복사하고 cron 1분 (* * * * * <경로>/container-metrics.sh). TEXTFILE_DIR = node_exporter --collector.textfile.directory`,
      `Prometheus: rule_files 에 ${v.opsDir}/container-lifecycle.rules.yml (promtool check rules 로 검사, 기준값은 실측으로)`,
      `지표 접두사 ${v.prefix} (workspace.json vars ops.metricsPrefix)`,
    ],
  },
  preflight: {
    title: '배포 전 확인 (preflight)',
    files: ['preflight.sh', 'preflight.conf'],
    next: (v) => [
      `${v.opsDir}/preflight.conf 를 채운다: 도는 배치 조회(BATCH_QUERY) · 분 주기 작업(MINUTE_JOBS) · 서비스별 사라지는 상태(STATES)`,
      `서버(배포 폴더): pull · build 뒤 bash ${v.opsDir}/preflight.sh [서비스...] -- docker compose up -d [서비스...]`,
      '로컬: kedovi ops preflight [서비스...] [--force]',
    ],
  },
};

function parse(argv) {
  const a = { _: [], run: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--') { a.run = argv.slice(i + 1); break; }
    if (x.startsWith('--')) {
      const k = x.slice(2);
      if (['dry-run', 'json', 'help', 'force'].includes(k)) a[k] = true;
      else a[k] = argv[++i];
    } else a._.push(x);
  }
  return a;
}

const get = (obj, key) => {
  if (!obj) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  return key.split('.').reduce((c, k) => (c && typeof c === 'object' ? c[k] : undefined), obj);
};

const hasCompose = (dir) => COMPOSE_FILES.some((f) => fs.existsSync(path.join(dir, f)));

/** 대상 폴더: { repo, base(compose 폴더 절대 경로), rel(repo 기준) }. --dir 이 절대 경로이고 --repo 가 없으면 그 폴더 */
function target(ws, a) {
  if (a.dir && path.isAbsolute(a.dir) && !a.repo) return { repo: null, base: a.dir, rel: '.' };
  const code = ((ws && ws.repos) || []).filter((r) => (r.kind || 'code') === 'code');
  const want = a.repo || get(ws && ws.vars, 'ops.repo');
  let repo;
  if (want) {
    repo = code.find((x) => x.name === want);
    if (!repo) throw new Error(`workspace.json repos 에 코드 repo '${want}' 가 없습니다`);
  } else {
    const sub = a.dir || '.';
    const found = code.filter((r) => hasCompose(path.join(r.dir, sub)));
    if (found.length === 1) repo = found[0];
    else if (found.length > 1) throw new Error(`compose 파일이 있는 repo 가 여럿입니다 (${found.map((r) => r.name).join(' · ')}). --repo <이름> 으로 고릅니다`);
    else throw new Error('compose 파일(compose.yaml · docker-compose.yml)이 있는 코드 repo 가 없습니다. --repo <이름> [--dir 폴더] 로 지정합니다');
  }
  const rel = (a.dir || '.').replace(/\/$/, '') || '.';
  return { repo, base: path.join(repo.dir, rel), rel };
}

/** 템플릿 값 */
function values(ws, a) {
  const vars = (ws && ws.vars) || {};
  const opsDir = String(a['ops-dir'] || get(vars, 'ops.dir') || 'ops').replace(/\/$/, '');
  const prefix = String(a.prefix || get(vars, 'ops.metricsPrefix') || 'compose_container');
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(prefix)) throw new Error(`ops.metricsPrefix 는 Prometheus 지표 이름 꼴(영문 · 숫자 · _)입니다: ${prefix}`);
  if (path.isAbsolute(opsDir) || opsDir.split('/').includes('..')) throw new Error(`ops.dir 은 compose 폴더 안의 상대 경로입니다: ${opsDir}`);
  return { opsDir, prefix, releaseBranch: String(get(vars, 'branch.release') || 'release') };
}

function render(text, v, opsRel) {
  return text.split('__PREFIX__').join(v.prefix).split('__OPS_DIR__').join(opsRel).split('__RELEASE_BRANCH__').join(v.releaseBranch);
}

/** 쓸 파일 목록: [{ to(repo 기준), path, content, mode, exists }] */
function plan(kinds, t, v) {
  const opsRel = path.posix.join(t.rel === '.' ? '' : t.rel, v.opsDir) || v.opsDir;
  const out = [];
  for (const k of kinds) {
    for (const f of KINDS[k].files) {
      const abs = path.join(t.base, v.opsDir, f);
      out.push({ kind: k, to: path.posix.join(opsRel, f), path: abs, content: render(fs.readFileSync(path.join(ASSETS, f), 'utf8'), v, opsRel),
        mode: f.endsWith('.sh') ? 0o755 : 0o644, exists: fs.existsSync(abs) });
    }
  }
  return out;
}

function write(items) {
  for (const it of items.filter((x) => !x.exists)) {
    fs.mkdirSync(path.dirname(it.path), { recursive: true });
    fs.writeFileSync(it.path, it.content, { mode: it.mode });
    fs.chmodSync(it.path, it.mode);
  }
}

function usage() {
  return '사용법\n'
    + '  kedovi ops add lifecycle|alerts|preflight|all [--repo R] [--dir compose 폴더] [--dry-run] [--json]\n'
    + '      lifecycle : release 수명 시험 스크립트 + GitLab CI job 예시 (release 브랜치에서만)\n'
    + '      alerts    : 운영 수명 지표 수집(cron → node_exporter textfile) + Prometheus 경보 규칙 (메모리 anon/file 분리)\n'
    + '      preflight : 배포 전 확인 스크립트 + 설정 파일 (도는 배치 · 재생성 컨테이너 · 사라지는 상태)\n'
    + '  kedovi ops preflight [서비스...] [--repo R | --dir 배포 폴더] [--force] [-- 통과하면 실행할 명령]\n'
    + '  kedovi ops lifecycle [서비스...] [--repo R | --dir compose 폴더]   (스택이 떠 있어야 한다)\n'
    + '  파일은 <repo>/<dir>/<ops.dir>/ 에 쓴다 (ops.dir 기본 ops). 있는 파일은 덮지 않는다. 값: workspace.json vars ops.repo · ops.dir · ops.metricsPrefix';
}

function loadWs() {
  try { return require(path.join(PACKS, 'core', 'lib', 'workspace.js')).load(path.resolve(PACKS, '..')); } catch { return null; }
}

function cmdAdd(a, ws) {
  const which = a._[1];
  const kinds = which === 'all' ? Object.keys(KINDS) : [which];
  if (!which || !kinds.every((k) => KINDS[k])) { console.error(`✖ 무엇을 넣을지: lifecycle | alerts | preflight | all\n${usage()}`); return 2; }
  let t, v;
  try { v = values(ws, a); t = target(ws, a); } catch (e) { console.error(`✖ ${e.message}`); return 1; }
  if (!fs.existsSync(t.base)) { console.error(`✖ 폴더가 없습니다: ${t.base}${t.repo ? ' (kedovi install 뒤 다시)' : ''}`); return 1; }
  const items = plan(kinds, t, v);
  if (!a['dry-run']) write(items);
  if (a.json) {
    console.log(JSON.stringify({ kinds, repo: t.repo && t.repo.name, dir: t.base, dryRun: !!a['dry-run'], values: v,
      files: items.map((x) => ({ path: x.to, written: !x.exists && !a['dry-run'], exists: x.exists })), next: kinds.flatMap((k) => KINDS[k].next({ ...v, opsDir: path.posix.join(t.rel === '.' ? '' : t.rel, v.opsDir) })) }, null, 2));
    return 0;
  }
  console.log(`${a['dry-run'] ? '미리보기 (쓰지 않음)' : '운영 검증 템플릿'}: ${t.repo ? t.repo.name : t.base}${hasCompose(t.base) ? '' : ' · ⚠ 이 폴더에 compose 파일이 없음 (--dir 로 compose 폴더 지정)'}`);
  for (const it of items) console.log(`  ${it.exists ? '· 있음 (덮지 않음)' : a['dry-run'] ? '+ 만들 파일' : '✔ 만듦'} ${it.to}`);
  console.log('다음');
  for (const k of kinds) for (const n of KINDS[k].next({ ...v, opsDir: path.posix.join(t.rel === '.' ? '' : t.rel, v.opsDir) })) console.log(`  ${KINDS[k].title}: ${n}`);
  return 0;
}

/** 로컬 실행: repo 에 넣은 스크립트가 있으면 그것, 없으면 팩의 원본 */
function cmdRun(kind, a, ws) {
  const file = kind === 'preflight' ? 'preflight.sh' : 'lifecycle-test.sh';
  let t, v;
  try { v = values(ws, a); t = target(ws, a); } catch (e) { console.error(`✖ ${e.message}`); return 1; }
  if (!hasCompose(t.base)) { console.error(`✖ compose 파일이 없습니다: ${t.base} (--dir 로 compose 폴더 지정)`); return 1; }
  const inRepo = path.join(t.base, v.opsDir, file);
  const script = fs.existsSync(inRepo) ? inRepo : path.join(ASSETS, file);
  const env = { ...process.env };
  const args = [script, ...a._.slice(1)];
  if (kind === 'preflight') {
    const conf = path.join(t.base, v.opsDir, 'preflight.conf');
    if (!env.PREFLIGHT_CONF && fs.existsSync(conf)) env.PREFLIGHT_CONF = conf;
    if (a.force) env.PREFLIGHT_FORCE = '1';
    if (a.run.length) args.push('--', ...a.run);
  }
  if (script !== inRepo) console.log(`(repo 에 ${path.posix.join(v.opsDir, file)} 가 없어 킷 원본으로 돈다. 넣기: kedovi ops add ${kind === 'preflight' ? 'preflight' : 'lifecycle'})`);
  const r = spawnSync('bash', args, { cwd: t.base, stdio: 'inherit', env });
  if (r.error) { console.error(`✖ bash 실행 실패: ${r.error.message}`); return 2; }
  return r.status == null ? 1 : r.status;
}

function main(argv) {
  const a = parse(argv);
  const sub = a._[0];
  if (a.help || !sub) { console.log(usage()); return sub || a.help ? 0 : 2; }
  const ws = loadWs();
  if (sub === 'add') return cmdAdd(a, ws);
  if (sub === 'preflight' || sub === 'lifecycle') return cmdRun(sub, a, ws);
  console.error(`✖ 모르는 하위 명령: ${sub}\n${usage()}`);
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { KINDS, parse, target, values, render, plan, write, main, hasCompose };
