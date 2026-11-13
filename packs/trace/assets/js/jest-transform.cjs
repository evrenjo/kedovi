// kedovi trace: Jest 변환기 감싸기 (기록할 때만). 프로젝트 소스에 먼저 계측을 넣고, 원래 변환기(ts-jest · babel-jest · @swc/jest …)에 넘긴다
'use strict';
const path = require('path');
const crypto = require('crypto');
const { instrument } = require('./instrument.cjs');

const ROOT = path.resolve(process.env.KEDOVI_TRACE_ROOT || process.cwd());
const SKIP = /[\\/](node_modules|\.git|coverage|dist|build)[\\/]|\.d\.[cm]?ts$/;
let ts = null;

function ours(file) {
  const abs = path.resolve(file);
  return abs.startsWith(ROOT + path.sep) && !SKIP.test(abs) && /\.([cm]?[jt]sx?)$/.test(abs) ? path.relative(ROOT, abs).split(path.sep).join('/') : null;
}

function wrap(code, file) {
  const rel = ours(file);
  if (!rel) return code;
  ts = ts || require(process.env.KEDOVI_TRACE_TS);
  try { const r = instrument(code, file, { ts, src: rel }); return r ? r.code : code; } catch { return code; }
}

/** options.transformerConfig = { inner: 원래 변환기 경로, innerConfig } */
function createTransformer(options) {
  const cfg = options || {};
  let inner = require(cfg.inner);
  inner = inner && inner.default ? inner.default : inner;
  if (inner && typeof inner.createTransformer === 'function') inner = inner.createTransformer(cfg.innerConfig);
  const pass = (o) => ({ ...o, transformerConfig: cfg.innerConfig });
  return {
    canInstrument: !!inner.canInstrument,
    getCacheKey(src, file, o) {
      const base = inner.getCacheKey ? inner.getCacheKey(wrap(src, file), file, pass(o)) : crypto.createHash('md5').update(src).digest('hex');
      return `${base}-kedovi-trace-1`;
    },
    process(src, file, o) { return inner.process(wrap(src, file), file, pass(o)); },
    processAsync: inner.processAsync ? (src, file, o) => inner.processAsync(wrap(src, file), file, pass(o)) : undefined,
  };
}

module.exports = { createTransformer };
