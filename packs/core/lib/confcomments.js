// 환경 · 설정 파일 주석 검사. 값은 읽어도 결과에 찍지 않는다 (줄 번호와 종류만 낸다).
/*
 * 대상: .env 계열, .conf, .ini, .properties, .toml, .yml, .yaml
 * 쓰는 곳: bin/draft.js (kedovi draft config), hooks/config-comment.js
 */
'use strict';
const path = require('path');
const P = require('./prosestyle');

const CHANGE_LOG = /(?:이전에는|예전에는|요청에 따라|요청대로|이번에|방금)/;
const KEY = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*[=:]/;
const DISABLED = /^[#;]+\s*(?:export\s+)?[A-Za-z_][\w.-]*\s*[=:]\s*\S*\s*$|^[#;]+\s*(?:export\s+)?[A-Z_][A-Z0-9_.]*=/;
const RULER = /^[#;\s=\-*_~]+$/;
const EXAMPLE = /^[#;]+\s*(?:예|e\.?g\.?|example)\s*[:：]/i;

function kindOf(file) {
  const b = path.basename(String(file)).toLowerCase();
  if (b === '.env' || b.startsWith('.env.') || b.endsWith('.env')) return 'env';
  if (b.endsWith('.properties')) return 'properties';
  if (/\.(?:conf|ini|cfg)$/.test(b)) return 'conf';
  if (/\.(?:toml|ya?ml)$/.test(b)) return 'structured';
  return null;
}
const isTemplate = (file) => /\.(?:example|sample|template|dist)$/i.test(path.basename(String(file)));

/** 값 뒤에 붙은 주석인가 (따옴표 안의 # 은 값이다) */
function trailing(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && /\s/.test(line[i - 1] || '')) return true;
  }
  return false;
}

/** 검사: [{ line, kind }]. cfg = prosestyle 설정 */
function scan(file, text, cfg = P.DEFAULTS) {
  const type = kindOf(file);
  if (!type) return [];
  const flat = type === 'env' || type === 'properties';
  const rows = String(text).split('\n');
  const hits = [];
  rows.forEach((raw, i) => {
    const n = i + 1;
    const t = raw.trim();
    if (!t) return;
    if (/^[#;]/.test(t)) {
      if (t.startsWith('#!') || RULER.test(t) || DISABLED.test(t) || EXAMPLE.test(t)) return;
      const body = t.replace(/^[#;]+\s*/, '');
      const list = P.sentences(body);
      if (list.length > 1) hits.push({ line: n, kind: '한 주석 줄에 여러 문장 (한 줄에 하나)' });
      for (const k of P.lineKinds(body, cfg)) hits.push({ line: n, kind: `주석 ${k}` });
      if (CHANGE_LOG.test(body)) hits.push({ line: n, kind: '주석에 작업 경위 (지금 뜻만 적음)' });
      return;
    }
    if (flat && KEY.test(raw) && trailing(raw)) hits.push({ line: n, kind: type === 'properties' ? '값 뒤 주석 (값의 일부로 읽힘, 윗줄로)' : '값 뒤 주석 (도구마다 다르게 읽음, 윗줄로)' });
  });
  if (type === 'env' && isTemplate(file)) {
    rows.forEach((raw, i) => {
      if (/^\s*#/.test(raw) || !KEY.test(raw)) return;
      let j = i - 1;
      while (j >= 0 && KEY.test(rows[j]) && !/^\s*#/.test(rows[j])) j--;
      if (j < 0 || !/^\s*#/.test(rows[j])) hits.push({ line: i + 1, kind: '설명 없는 키 (윗줄에 뜻 · 허용값)' });
    });
  }
  return hits.sort((a, b) => a.line - b.line);
}

module.exports = { kindOf, isTemplate, scan };
