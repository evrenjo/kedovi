// archrules.js 점검 (임시 폴더만 쓴다). 실행: node archrules.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const a = require('./archrules');

const cases = [];
const it = (name, fn) => cases.push([name, fn]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-archrules-'));

/** 워크스페이스 하나: repos/<이름> 폴더와 workspace.json */
function workspace(vars, repos) {
  const root = tmp();
  for (const r of repos) fs.mkdirSync(path.join(root, 'repos', r.name), { recursive: true });
  fs.writeFileSync(path.join(root, 'workspace.json'), JSON.stringify({ project: { name: 't' }, packs: ['core'], repos, vars }));
  return root;
}
const run = (root, args) => spawnSync(process.execPath, [path.join(__dirname, 'archrules.js'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });

it('spring: 기준 패키지 폴더에 ArchUnit 파일을 쓰고 설정 값을 채운다', () => {
  const root = workspace({ spring: { basePackage: 'com.acme.shop', packageLayout: 'feature-first' }, cleanCode: { helperMethods: 'none' } }, [{ name: 'api', stack: 'spring' }]);
  const r = run(root, ['spring']);
  assert.strictEqual(r.status, 0, r.stderr);
  const dir = path.join(root, 'repos', 'api', 'src', 'test', 'java', 'com', 'acme', 'shop', 'archrules');
  assert.ok(fs.existsSync(path.join(dir, 'ArchitectureTest.java')));
  const rules = fs.readFileSync(path.join(dir, 'ArchRules.java'), 'utf8');
  assert.ok(rules.startsWith('package com.acme.shop.archrules;'));
  assert.ok(/FEATURE_FIRST = true;/.test(rules) && /NO_HELPER_METHODS = true;/.test(rules));
  for (const f of fs.readdirSync(dir)) assert.ok(!/__[A-Z_]+__/.test(fs.readFileSync(path.join(dir, f), 'utf8')), `${f} 에 채우지 않은 자리표시`);
});

it('spring: 기본값은 계층 먼저 · 도우미 검사 끔', () => {
  const v = a.values({ vars: {} }, 'spring', {});
  assert.strictEqual(v.layout, 'layer-first');
  assert.strictEqual(v.noHelpers, false);
  const items = a.plan('spring', tmp(), { ...v, dir: '.' });
  const rules = items.find((x) => x.to.endsWith('ArchRules.java')).content;
  assert.ok(/FEATURE_FIRST = false;/.test(rules) && /NO_HELPER_METHODS = false;/.test(rules));
});

it('있는 파일은 덮지 않는다', () => {
  const root = workspace({ spring: { basePackage: 'com.acme' } }, [{ name: 'api', stack: 'spring' }]);
  const f = path.join(root, 'repos', 'api', 'src', 'test', 'java', 'com', 'acme', 'archrules', 'ArchRules.java');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '// 내가 고친 것');
  const r = run(root, ['spring']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '// 내가 고친 것');
  assert.ok(/있음 \(덮지 않음\)/.test(r.stdout));
});

it('--dry-run 은 쓰지 않고 목록만', () => {
  const root = workspace({}, [{ name: 'web', stack: 'react' }]);
  const r = run(root, ['react', '--dry-run', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepStrictEqual(j.files.map((x) => x.path), ['eslint.boundaries.config.js']);
  assert.ok(!fs.existsSync(path.join(root, 'repos', 'web', 'eslint.boundaries.config.js')));
});

it('react: 소스 · 생성 API 폴더를 채운다', () => {
  const items = a.plan('react', tmp(), a.values({ vars: { react: { srcDir: 'app/src', generatedApiDir: 'app/src/shared/api/gen' } } }, 'react', {}));
  assert.ok(items[0].content.includes("const SRC = 'app/src';"));
  assert.ok(items[0].content.includes("const GENERATED_API = 'app/src/shared/api/gen';"));
});

it('fastapi: .importlinter 와 검사 스크립트, 도우미 기준을 Python 값으로', () => {
  const v = a.values({ vars: { fastapi: { package: 'svc' }, cleanCode: { helperMethods: 'none' } } }, 'fastapi', {});
  const items = a.plan('fastapi', tmp(), v);
  assert.deepStrictEqual(items.map((x) => x.to), ['.importlinter', 'tools/check_role_files.py']);
  assert.ok(items[0].content.includes('root_package = svc'));
  assert.ok(items[1].content.includes('NO_HELPER_FUNCTIONS = True'));
  assert.ok(!/__[A-Z_]+__ *$/m.test(items[1].content.replace(/__init__|__main__|__name__|__pycache__|__file__/g, '')));
});

it('component-web: spring · fastapi 는 web 층 검사를 켜고, 기능 먼저가 아니면 멈춘다', () => {
  const cw = { backend: { layout: 'component-web' } };
  const sp = a.plan('spring', tmp(), a.values({ vars: { ...cw, spring: { packageLayout: 'feature-first' } } }, 'spring', {}));
  assert.ok(/COMPONENT_WEB = true;/.test(sp.find((x) => x.to.endsWith('ArchRules.java')).content));
  assert.ok(/COMPONENT_WEB = false;/.test(a.plan('spring', tmp(), a.values({ vars: {} }, 'spring', {})).find((x) => x.to.endsWith('ArchRules.java')).content));
  assert.throws(() => a.values({ vars: cw }, 'spring', {}), /feature-first/);
  const fa = a.plan('fastapi', tmp(), a.values({ vars: { ...cw, fastapi: { package: 'svc', packageLayout: 'feature' } } }, 'fastapi', {}));
  assert.ok(fa[0].content.includes('feature-no-web') && fa[1].content.includes('COMPONENT_WEB = True'));
  assert.ok(a.plan('fastapi', tmp(), a.values({ vars: {} }, 'fastapi', {}))[1].content.includes('COMPONENT_WEB = False'));
  assert.throws(() => a.values({ vars: cw }, 'fastapi', {}), /fastapi.packageLayout 을 feature/);
});

it('nestjs · django: component-web 일 때만, 소스 · 패키지를 채운다', () => {
  assert.throws(() => a.values({ vars: {} }, 'nestjs', {}), /component-web 일 때만/);
  assert.throws(() => a.values({ vars: {} }, 'django', {}), /component-web 일 때만/);
  const cw = { backend: { layout: 'component-web' } };
  const ns = a.plan('nestjs', tmp(), a.values({ vars: { ...cw, nestjs: { srcDir: 'apps/api/src' } } }, 'nestjs', {}));
  assert.deepStrictEqual(ns.map((x) => x.to), ['.dependency-cruiser.cjs']);
  assert.ok(ns[0].content.includes("const SRC = 'apps/api/src';"));
  const dj = a.plan('django', tmp(), a.values({ vars: { ...cw, django: { package: 'shop' } } }, 'django', {}));
  assert.deepStrictEqual(dj.map((x) => x.to), ['.importlinter', 'tools/check_web_layout.py']);
  assert.ok(dj[0].content.includes('root_package = shop') && dj[1].content.includes('PACKAGE = "shop"'));
  assert.throws(() => a.values({ vars: { ...cw, django: { package: 'a.b' } } }, 'django', {}), /패키지 이름 하나/);
});

it('repo 고르기: --repo · vars · stack 순, 없으면 알린다', () => {
  const ws = { vars: { react: { repo: 'b' } }, repos: [{ name: 'a', stack: 'react' }, { name: 'b', stack: 'vue' }, { name: 'd', stack: ['spring', 'react'], kind: 'docs' }] };
  assert.strictEqual(a.pickRepo(ws, 'react').name, 'b');
  assert.strictEqual(a.pickRepo(ws, 'react', 'a').name, 'a');
  assert.strictEqual(a.pickRepo({ vars: {}, repos: ws.repos }, 'react').name, 'a');
  assert.throws(() => a.pickRepo({ vars: {}, repos: ws.repos }, 'fastapi'), /fastapi/);
  assert.throws(() => a.pickRepo({ vars: {}, repos: ws.repos }, 'react', 'd'), /코드 repo/);
});

it('repo 고르기: workspace.json 에 stack 이 없으면 스택 감지로', () => {
  const root = workspace({}, [{ name: 'web', path: 'repos/web' }, { name: 'api', path: 'repos/api' }]);
  fs.writeFileSync(path.join(root, 'repos', 'api', 'build.gradle'), "plugins { id 'org.springframework.boot' version '3.5.5' }\n");
  const r = run(root, ['spring', '--dry-run', '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).repo, 'api');
});

it('잘못된 값은 쓰기 전에 멈춘다', () => {
  assert.throws(() => a.values({ vars: { spring: { packageLayout: 'domain' } } }, 'spring', {}), /layer-first \| feature-first/);
  assert.throws(() => a.values({ vars: { spring: { basePackage: 'Com.Bad-Name' } } }, 'spring', {}), /Java 패키지/);
  assert.throws(() => a.values({ vars: { fastapi: { package: 'a.b' } } }, 'fastapi', {}), /패키지 이름 하나/);
});

it('모르는 스택 · 인자 없음은 사용법', () => {
  const root = workspace({}, []);
  assert.strictEqual(run(root, ['vue']).status, 2);
  assert.ok(/사용법/.test(run(root, []).stdout));
});

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`✔ ${name}`); } catch (e) { failed++; console.log(`✖ ${name}\n  ${e.message}`); }
}
process.exit(failed ? 1 : 0);
