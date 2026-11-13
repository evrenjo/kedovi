// kedovi trace: Jest 설정 파일 (기록할 때만). 기록 런타임을 올리고, 파일의 테스트가 끝나면 기록을 쓴다
'use strict';
const fs = require('fs');
const path = require('path');

globalThis.__kedoviTraceOpts = JSON.parse(process.env.KEDOVI_TRACE_OPTS || '{}');
require(path.join(__dirname, 'runtime.js'));
require('./sql-hooks.cjs').install();

afterAll(() => {
  const T = globalThis.__kedoviT;
  if (!T || !process.env.KEDOVI_TRACE_RAW) return;
  T.stop();
  fs.writeFileSync(process.env.KEDOVI_TRACE_RAW, JSON.stringify(T.dump()));
});
