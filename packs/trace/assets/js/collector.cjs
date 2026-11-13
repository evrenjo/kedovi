// kedovi trace 브라우저 기록 받기: 페이지(런타임)가 POST /__kedovi/trace 로 보낸 조각을 페이지마다 모아 파일 하나로 쓴다 (Vite 플러그인 · Next.js 개발 서버 공용)
'use strict';
const fs = require('fs');

function collector(out) {
  const sessions = new Map(); // sid → { page, at, epoch, steps: Map, notes, truncated }
  const save = () => {
    if (!out) return;
    const list = [...sessions.entries()].map(([sid, s]) => ({ sid, page: s.page, at: s.at, epoch: s.epoch, notes: s.notes, truncated: s.truncated, steps: [...s.steps.values()].sort((a, b) => a.i - b.i) }));
    fs.writeFileSync(`${out}.part`, JSON.stringify({ sessions: list }));
    fs.renameSync(`${out}.part`, out);
  };
  /** (req, res) → 처리했으면 true */
  function handle(req, res, info) {
    if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ sessions: sessions.size, ...(info || {}) })); return true; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        let s = sessions.get(b.sid);
        if (!s) { s = { page: b.page, at: Date.now(), epoch: b.epoch, steps: new Map(), notes: [], truncated: false }; sessions.set(b.sid, s); }
        for (const st of b.steps || []) s.steps.set(st.i, st);
        s.notes = b.notes || s.notes;
        s.truncated = b.truncated || s.truncated;
        save();
      } catch { /* 깨진 조각은 버린다 */ }
      res.statusCode = 204;
      res.end();
    });
    return true;
  }
  return { handle, sessions };
}

module.exports = { collector };
