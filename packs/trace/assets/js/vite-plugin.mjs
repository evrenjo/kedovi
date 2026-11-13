// kedovi trace Vite 플러그인: 개발 서버 · Vitest 에서 프로젝트 소스를 계측하고(enforce: 'pre', 원본 TS · TSX 그대로), 브라우저 기록을 받아 파일로 모은다
// 프로젝트의 vite.config 는 고치지 않는다. kedovi trace 가 createServer(…, { plugins: [kedoviTrace(…)] }) 로 덧붙인다
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { instrument } = require('./instrument.cjs');
const SKIP = /[\\/](node_modules|\.vite|dist|build|coverage|\.git)[\\/]|\.d\.[cm]?ts$|(^|[\\/])(vite|vitest|playwright|eslint|tailwind|postcss)\.config\./;

/**
 * opts: { root, ts(경로), out(브라우저 기록을 모을 파일), maxSteps, maxHits, include(정규식 문자열, 선택) }
 */
export default function kedoviTrace(opts) {
  const ts = require(opts.ts);
  const root = path.resolve(opts.root);
  const include = opts.include ? new RegExp(opts.include) : null;
  const runtime = fs.readFileSync(path.join(HERE, 'runtime.js'), 'utf8');
  const sessions = new Map(); // sid → { page, files, steps: Map }
  let count = 0;
  const save = () => {
    if (!opts.out) return;
    const list = [...sessions.entries()].map(([sid, s]) => ({ sid, page: s.page, at: s.at, notes: s.notes, truncated: s.truncated, steps: [...s.steps.values()].sort((a, b) => a.i - b.i) }));
    fs.writeFileSync(`${opts.out}.part`, JSON.stringify({ sessions: list }));
    fs.renameSync(`${opts.out}.part`, opts.out);
  };
  const ours = (id) => {
    const file = id.split('?')[0];
    if (file.startsWith('\0') || !/\.([cm]?[jt]sx?)$/.test(file) || SKIP.test(file)) return null;
    const abs = path.resolve(file);
    if (!abs.startsWith(root + path.sep)) return null;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (include && !include.test(rel)) return null;
    return rel;
  };
  return {
    name: 'kedovi-trace',
    enforce: 'pre',
    /** 킷 파일(vitest-setup.mjs 등)이 부르는 'vitest' 같은 패키지는 프로젝트 기준으로 찾는다 */
    async resolveId(source, importer) {
      if (!importer || !importer.startsWith(HERE) || source.startsWith('.') || source.startsWith('/') || source.startsWith('node:')) return null;
      return this.resolve(source, path.join(root, 'package.json'), { skipSelf: true });
    },
    transform(code, id) {
      const rel = ours(id);
      if (!rel) return undefined;
      let r = null;
      try { r = instrument(code, id, { ts, src: rel }); } catch (e) { this.warn(`kedovi trace: ${rel} 계측 실패 (${e.message}). 이 파일은 기록하지 않습니다`); }
      count += r ? 1 : 0;
      return r ? { code: r.code, map: null } : undefined;
    },
    transformIndexHtml() {
      const o = { maxSteps: opts.maxSteps || 30000, maxHits: opts.maxHits || 30, collect: '/__kedovi/trace' };
      return [{ tag: 'script', injectTo: 'head-prepend', children: `globalThis.__kedoviTraceOpts=${JSON.stringify(o)};\n${runtime}` }];
    },
    configureServer(server) {
      server.middlewares.use('/__kedovi/trace', (req, res) => {
        if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ sessions: sessions.size, files: count })); return; }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          try {
            const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            let s = sessions.get(b.sid);
            if (!s) { s = { page: b.page, at: Date.now(), steps: new Map(), notes: [], truncated: false }; sessions.set(b.sid, s); }
            for (const st of b.steps || []) s.steps.set(st.i, st);
            s.notes = b.notes || s.notes;
            s.truncated = b.truncated || s.truncated;
            save();
          } catch (e) { /* 깨진 조각은 버린다 */ }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}
