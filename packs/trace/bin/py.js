// kedovi trace: Python 기록 (pytest 테스트 한 건 · 로컬 서버 요청 한 번). 기록기 = assets/python/kedovi_trace.py (sys.monitoring, 3.11 이하는 settrace)
'use strict';
const fs = require('fs');
const path = require('path');

const PY = path.join(__dirname, '..', 'assets', 'python');
const SKIP = new Set(['.git', 'node_modules', '.venv', 'venv', 'env', '__pycache__', 'build', 'dist', '.tox', '.nox', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'site-packages']);

/** Python 프로젝트인가 */
function isPython(dir) {
  return ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile', 'manage.py'].some((f) => fs.existsSync(path.join(dir, f)));
}

/** .py 파일 목록 (가상 환경 · 캐시 제외) */
function pyFiles(dir, out = [], depth = 0) {
  if (depth > 15) return out;
  let es = [];
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) pyFiles(path.join(dir, e.name), out, depth + 1); } else if (e.name.endsWith('.py')) out.push(path.join(dir, e.name));
  }
  return out;
}

const isTestFile = (f) => /(^|[\\/])(test_[^\\/]*|[^\\/]*_test)\.py$/.test(f) || /[\\/]tests?[\\/]/.test(f);

/**
 * 테스트 이름 → pytest nodeid (dir 기준 상대 경로)
 * 받는 모양: tests/test_x.py::test_y · tests/test_x.py::TestA::test_y · test_y · TestA::test_y · TestA.test_y
 */
function findTest(dir, spec, files = pyFiles(dir)) {
  const s = String(spec).trim();
  const m = s.match(/^(.+\.py)((?:::[\w[\]-]+)+)$/);
  if (m) {
    const f = path.resolve(dir, m[1]);
    return fs.existsSync(f) ? { nodeid: `${path.relative(dir, f).split(path.sep).join('/')}${m[2]}`, file: f } : null;
  }
  const parts = s.split(/::|\./).filter(Boolean);
  const fn = parts.pop();
  const cls = parts.pop();
  const hits = [];
  for (const f of files.filter(isTestFile)) {
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    if (!new RegExp(`^\\s*(async\\s+)?def\\s+${fn.replace(/\W/g, '')}\\s*\\(`, 'm').test(text)) continue;
    const rel = path.relative(dir, f).split(path.sep).join('/');
    if (cls) {
      if (new RegExp(`^class\\s+${cls.replace(/\W/g, '')}\\b`, 'm').test(text)) hits.push({ nodeid: `${rel}::${cls}::${fn}`, file: f });
      continue;
    }
    // 클래스 안 메서드면 클래스 이름까지
    const lines = text.split('\n');
    const at = lines.findIndex((l) => new RegExp(`^\\s*(async\\s+)?def\\s+${fn.replace(/\W/g, '')}\\s*\\(`).test(l));
    const indented = /^\s+/.test(lines[at]);
    let owner = null;
    if (indented) for (let i = at - 1; i >= 0; i -= 1) { const c = lines[i].match(/^class\s+(\w+)/); if (c) { owner = c[1]; break; } }
    hits.push({ nodeid: owner ? `${rel}::${owner}::${fn}` : `${rel}::${fn}`, file: f });
  }
  return hits.length === 1 ? hits[0] : hits.length ? { many: hits } : null;
}

/** Python 실행 명령 (uv · poetry · pdm · 가상 환경 · python3) → [명령, 앞 인자] */
function runner(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  let pp = '';
  try { pp = fs.readFileSync(path.join(dir, 'pyproject.toml'), 'utf8'); } catch { /* 없음 */ }
  if (has('uv.lock') || /\[tool\.uv\]|uv_build/.test(pp)) return ['uv', ['run', 'python']];
  if (has('poetry.lock') || /\[tool\.poetry\]/.test(pp)) return ['poetry', ['run', 'python']];
  if (has('pdm.lock') || /\[tool\.pdm\]/.test(pp)) return ['pdm', ['run', 'python']];
  if (has('Pipfile')) return ['pipenv', ['run', 'python']];
  for (const v of ['.venv', 'venv', 'env']) {
    const bin = process.platform === 'win32' ? path.join(dir, v, 'Scripts', 'python.exe') : path.join(dir, v, 'bin', 'python');
    if (fs.existsSync(bin)) return [bin, []];
  }
  return [process.platform === 'win32' ? 'python' : 'python3', []];
}

/** pytest 인자: 병렬 실행(xdist)을 쓰는 프로젝트면 한 프로세스로 */
function pytestArgs(dir, nodeid) {
  let cfg = '';
  for (const f of ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini']) { try { cfg += fs.readFileSync(path.join(dir, f), 'utf8'); } catch { /* 없음 */ } }
  const xdist = /xdist|(^|\s|["'])-n\s*(auto|\d)/m.test(cfg);
  return ['-m', 'pytest', '-p', 'kedovi_trace', '-p', 'no:cacheprovider', ...(xdist ? ['-n', '0'] : []), '-q', nodeid];
}

/** 로컬 서버 실행 명령 찾기: FastAPI · Starlette → uvicorn, Flask → flask run, Django → manage.py runserver */
function serveCommand(dir, port, files = pyFiles(dir)) {
  if (fs.existsSync(path.join(dir, 'manage.py'))) return ['manage.py', 'runserver', '--noreload', `127.0.0.1:${port}`];
  for (const f of files.filter((x) => !isTestFile(x))) {
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const asgi = text.match(/^(\w+)\s*(?::[^=]+)?=\s*(FastAPI|Starlette)\s*\(/m);
    const wsgi = text.match(/^(\w+)\s*(?::[^=]+)?=\s*Flask\s*\(/m);
    if (!asgi && !wsgi) continue;
    const rel = path.relative(dir, f).replace(/\.py$/, '').split(path.sep);
    if (rel[0] === 'src') rel.shift();
    if (rel[rel.length - 1] === '__init__') rel.pop();
    const mod = rel.join('.');
    if (asgi) return ['uvicorn', `${mod}:${asgi[1]}`, '--host', '127.0.0.1', '--port', String(port)];
    return ['flask', '--app', `${mod}:${wsgi[1]}`, 'run', '--no-reload', '--port', String(port)];
  }
  return null;
}

/** 기록기 환경 변수 */
function env(dir, out, opts, extra = {}) {
  const e = { ...process.env, ...extra };
  e.PYTHONPATH = [PY, e.PYTHONPATH].filter(Boolean).join(path.delimiter);
  e.KEDOVI_TRACE_OUT = out;
  e.KEDOVI_TRACE_ROOT = dir;
  e.KEDOVI_TRACE_MAX_STEPS = String(opts.maxSteps || 5000);
  e.KEDOVI_TRACE_MAX_HITS = String(opts.maxHits || 30);
  e.KEDOVI_TRACE_SQL = opts.sql === 'off' ? 'off' : 'on';
  e.PYTHONDONTWRITEBYTECODE = '1';
  return e;
}

/** 기록의 src(프로젝트 상대 경로) → 파일 */
function mapSources(dir, trace) {
  const out = {};
  for (const src of new Set((trace.steps || []).map((s) => s.src).filter(Boolean))) {
    const f = path.join(dir, src);
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    out[src] = { path: src, text: text.length > 400000 ? text.slice(0, 400000) : text };
  }
  return out;
}

module.exports = { PY, isPython, pyFiles, isTestFile, findTest, runner, pytestArgs, serveCommand, env, mapSources };
