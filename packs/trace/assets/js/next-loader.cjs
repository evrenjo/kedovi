// kedovi trace Next.js 로더 (Turbopack · webpack 공용): 프로젝트 소스를 계측한다. next-dev.cjs 가 설정에 덧붙인다 (프로젝트의 next.config 는 고치지 않는다)
/*
 * 옵션: { root, ts(typescript 경로), side: 'client' | 'server' | 'any'(조건 문법이 없는 판: 빌드 대상으로 가른다) }
 * 서버 쪽에서는 화면 컴포넌트를 서버에서 미리 그리는 것(SSR)을 건너뛴다: 같은 컴포넌트가 브라우저에서 다시 돌아 기록이 두 번 남는다
 *   webpack = 모듈 층(layer)이 'ssr' 이면 · Turbopack = 'use client' 파일이면
 */
'use strict';
const path = require('path');
const { instrument } = require('./instrument.cjs');

const SKIP = /[\\/](node_modules|\.next|dist|build|coverage|\.git)[\\/]|\.d\.[cm]?ts$|(^|[\\/])(next|playwright|eslint|tailwind|postcss|vitest|jest)\.config\.|(^|[\\/])(e2e|__tests__)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$/;
const CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*(['"])use client\1/;
const parsers = new Map();

module.exports = function kedoviNextLoader(source) {
  const o = (typeof this.getOptions === 'function' ? this.getOptions() : this.query) || {};
  const file = this.resourcePath || '';
  const root = path.resolve(o.root || process.cwd());
  if (typeof source !== 'string' || !file.startsWith(root + path.sep) || SKIP.test(file)) return source;
  const layer = this._module && this._module.layer;
  // 조건 없는 규칙(15 이하): 빌드 대상(target)으로 가른다. 대상을 주지 않는 판(Turbopack 15)이면 가리지 않고 모두 (서버에서 미리 그리는 것도 기록된다)
  const side = o.side === 'any' ? (!this.target ? 'any' : /^(web|browser)/.test(String(this.target)) ? 'client' : 'server') : o.side;
  if (side === 'server' && (layer === 'ssr' || (!layer && CLIENT.test(source)))) return source;
  let ts = parsers.get(o.ts);
  if (!ts) { ts = require(o.ts); parsers.set(o.ts, ts); }
  try {
    const r = instrument(source, file, { ts, src: path.relative(root, file).split(path.sep).join('/') });
    return r ? r.code : source;
  } catch { return source; }
};
