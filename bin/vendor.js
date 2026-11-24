#!/usr/bin/env node
/**
 * 문서 사이트 외부 라이브러리 받기 (킷 개발용, `npm run vendor`). 의존성 없음.
 *
 * vendor.json 의 패키지를 공개 npm 레지스트리에서 `npm pack` 으로 받아(무결성은 vendor.json 의 integrity 와 대조한다)
 * 브라우저용 파일만 out 폴더에 둔다. 빌드 도구는 쓰지 않는다:
 *   - UMD 파일은 그대로 (전역 이름: preact · preactHooks · htm · MiniSearch)
 *   - CommonJS 파일(global 이 있는 것)은 즉시 실행 함수로 감싸 그 전역 이름에 둔다
 *   - 끝의 sourceMappingURL 줄은 뺀다 (지도 파일은 넣지 않는다)
 * 라이선스는 패키지마다 <이름>-LICENSE.txt 로 같이 둔다. 문서 사이트 생성기가 이 폴더를 assets/vendor.js 하나로 이어 붙인다.
 * bundles(생성기가 Node 에서 쓰는 것, 예: markdown-it): 임시 폴더에 설치해(같이 딸린 의존 버전은 vendor-lock.json 으로 고정) esbuild 로
 *   CommonJS 파일 하나로 묶는다. 워크스페이스는 npm 설치 없이 이 파일을 require 한다. 묶인 패키지들의 라이선스는 <파일>-LICENSES.txt
 *   --check   받은 파일이 vendor.json 과 같은지만 본다 (다르면 exit 1)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const KIT = path.resolve(__dirname, '..');
const conf = JSON.parse(fs.readFileSync(path.join(KIT, 'vendor.json'), 'utf8'));
const OUT = path.join(KIT, conf.out);
const check = process.argv.includes('--check');

/** 받은 파일 내용 → 넣을 내용 */
function shape(text, pkg, file) {
  let t = text.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
  if (pkg.global) t = `/* ${pkg.name} ${pkg.version} (${pkg.license}) ${file} */\n(function () { var module = { exports: {} }, exports = module.exports;\n${t}\nwindow.${pkg.global} = module.exports; })();\n`;
  else t = `/* ${pkg.name} ${pkg.version} (${pkg.license}) ${file} */\n${t}`;
  return t.endsWith('\n') ? t : `${t}\n`;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-vendor-'));
const want = {};
try {
  for (const pkg of conf.packages) {
    const r = spawnSync('npm', ['pack', `${pkg.name}@${pkg.version}`, `--registry=${conf.registry}`, '--pack-destination', tmp, '--silent'], { encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error(`${pkg.name}@${pkg.version} 받기 실패: ${r.stderr || r.stdout}`);
    const tgz = path.join(tmp, r.stdout.trim().split('\n').pop());
    // 레지스트리가 주는 값이 아니라 vendor.json 에 적어 둔 값과 대조한다 (같은 버전을 바꿔치기한 tgz 대비)
    if (!pkg.integrity) throw new Error(`${pkg.name}: vendor.json 에 integrity 가 없습니다 (npm view ${pkg.name}@${pkg.version} dist.integrity)`);
    const [algo, want64] = pkg.integrity.split('-');
    const got64 = require('crypto').createHash(algo).update(fs.readFileSync(tgz)).digest('base64');
    if (got64 !== want64) throw new Error(`${pkg.name}@${pkg.version}: 받은 tgz 의 ${algo} 가 vendor.json integrity 와 다릅니다`);
    const dir = path.join(tmp, `${pkg.name}-x`);
    fs.mkdirSync(dir);
    const x = spawnSync('tar', ['xzf', tgz, '-C', dir]);
    if (x.status !== 0) throw new Error(`${tgz} 풀기 실패`);
    const root = path.join(dir, 'package');
    const got = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (got.version !== pkg.version) throw new Error(`${pkg.name}: 받은 버전 ${got.version} ≠ ${pkg.version}`);
    for (const [from, to] of Object.entries(pkg.files)) want[to] = shape(fs.readFileSync(path.join(root, from), 'utf8'), pkg, from);
    const lic = fs.readdirSync(root).find((f) => /^licen[cs]e(\.(txt|md))?$/i.test(f));
    if (!lic) throw new Error(`${pkg.name}: 라이선스 파일이 없습니다`);
    want[`${pkg.name}-LICENSE.txt`] = fs.readFileSync(path.join(root, lic), 'utf8');
  }
  // 이어 붙일 순서 · 버전 (생성기가 읽는다. 워크스페이스에는 vendor.json 이 없다)
  want['index.json'] = `${JSON.stringify({ note: 'npm run vendor 가 만든다', files: conf.packages.filter((p) => !p.lazy).flatMap((p) => Object.values(p.files)), lazy: conf.packages.filter((p) => p.lazy).flatMap((p) => Object.values(p.files)), packages: conf.packages.map(({ name, version, license, home }) => ({ name, version, license, home })) }, null, 1)}\n`;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

/** 생성기용 묶음: 설치(lock 고정) → esbuild → { 경로: 내용 } */
function bundles() {
  const out = {};
  const list = conf.bundles || [];
  if (!list.length) return out;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kedovi-bundle-'));
  try {
    const deps = Object.assign({}, ...list.map((b) => b.packages));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'kedovi-vendor', private: true, dependencies: deps }, null, 1));
    const lockFile = path.join(KIT, 'vendor-lock.json');
    const locked = fs.existsSync(lockFile) && (() => { const l = JSON.parse(fs.readFileSync(lockFile, 'utf8')); return JSON.stringify((l.packages[''] || {}).dependencies) === JSON.stringify(deps); })();
    if (locked) fs.copyFileSync(lockFile, path.join(dir, 'package-lock.json'));
    const r = spawnSync('npm', [locked ? 'ci' : 'install', `--registry=${conf.registry}`, '--no-audit', '--no-fund', '--ignore-scripts', '--silent'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.status !== 0) throw new Error(`묶음 설치 실패: ${r.stderr || r.stdout}`);
    if (!check) fs.copyFileSync(path.join(dir, 'package-lock.json'), lockFile);
    const esbuild = require('esbuild');
    for (const b of list) {
      fs.writeFileSync(path.join(dir, 'entry.mjs'), b.entry);
      const res = esbuild.buildSync({ entryPoints: [path.join(dir, 'entry.mjs')], bundle: true, platform: 'node', format: 'cjs', target: 'node20', write: false, metafile: true, legalComments: 'none', minify: false, absWorkingDir: dir, logLevel: 'silent' });
      const pkgs = [...new Set(Object.keys(res.metafile.inputs).map((f) => (/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(f) || [])[1]).filter(Boolean))].sort();
      const info = pkgs.map((n) => { const pj = JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', n, 'package.json'), 'utf8')); return { n, v: pj.version, l: pj.license }; });
      const rel = path.relative(KIT, path.join(KIT, b.out));
      out[rel] = `/* 생성물: npm run vendor (vendor.json bundles). 손으로 고치지 않는다. ${info.map((x) => `${x.n}@${x.v} (${x.l})`).join(' · ')}. 라이선스: ${path.basename(b.out, '.js')}-LICENSES.txt */\n${res.outputFiles[0].text}`;
      out[rel.replace(/\.js$/, '-LICENSES.txt')] = info.map((x) => {
        const d = path.join(dir, 'node_modules', x.n);
        const lic = fs.readdirSync(d).find((f) => /^licen[cs]e/i.test(f));
        if (!lic) throw new Error(`${x.n}: 라이선스 파일이 없습니다`);
        return `== ${x.n} ${x.v} (${x.l})\n\n${fs.readFileSync(path.join(d, lic), 'utf8').trim()}\n`;
      }).join('\n');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return out;
}
const bundled = bundles();
const bdiff = Object.keys(bundled).filter((f) => !fs.existsSync(path.join(KIT, f)) || fs.readFileSync(path.join(KIT, f), 'utf8') !== bundled[f]).map((f) => `~ ${f}`);

const have = fs.existsSync(OUT) ? fs.readdirSync(OUT) : [];
const diff = [...bdiff, ...Object.keys(want).filter((f) => !have.includes(f) || fs.readFileSync(path.join(OUT, f), 'utf8') !== want[f]).map((f) => `~ ${f}`),
  ...have.filter((f) => !(f in want)).map((f) => `- ${f}`)];
if (check) {
  if (diff.length) { console.error(`✖ ${conf.out} 가 vendor.json 과 다릅니다: ${diff.join(' · ')}. npm run vendor`); process.exit(1); }
  console.log(`✔ ${conf.out} = vendor.json`);
  process.exit(0);
}
fs.mkdirSync(OUT, { recursive: true });
for (const f of have) if (!(f in want)) fs.rmSync(path.join(OUT, f));
for (const [f, t] of Object.entries(want)) fs.writeFileSync(path.join(OUT, f), t);
for (const [f, t] of Object.entries(bundled)) { fs.mkdirSync(path.dirname(path.join(KIT, f)), { recursive: true }); fs.writeFileSync(path.join(KIT, f), t); }
console.log(`✔ ${conf.out}: ${[...conf.packages.map((p) => `${p.name}@${p.version}`), ...(conf.bundles || []).map((b) => `${path.basename(b.out)} (${Object.entries(b.packages).map(([n, v]) => `${n}@${v}`).join(' + ')})`)].join(' · ')}${diff.length ? ` (바뀐 파일 ${diff.length})` : ' (그대로)'}`);
