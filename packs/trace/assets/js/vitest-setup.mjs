// kedovi trace: Vitest 설정 파일 (기록할 때만 덧붙인다). 기록 런타임을 올리고, 파일의 테스트가 끝나면 기록을 쓴다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { afterAll } from 'vitest'; // kedovi trace 플러그인이 프로젝트의 vitest 로 풀어 준다

globalThis.__kedoviTraceOpts = JSON.parse(process.env.KEDOVI_TRACE_OPTS || '{}');
createRequire(import.meta.url)(path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime.js'));


afterAll(() => {
  const T = globalThis.__kedoviT;
  if (!T || !process.env.KEDOVI_TRACE_RAW) return;
  T.stop();
  fs.writeFileSync(process.env.KEDOVI_TRACE_RAW, JSON.stringify(T.dump()));
});
