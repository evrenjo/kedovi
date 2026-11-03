/* ERD 뷰어 (datamodel 팩): kedovi docs build 가 정의서(md)에서 만든 모델(window.ERD_MODEL)을 elkjs 로 배치하고 Preact 로 그린다.
 * 생성기가 src/*.js 를 이름 순으로 이어 assets/erd/erd.js 하나로 만든다. 화면 라이브러리는 문서 사이트와 같은 assets/vendor.js (Preact + htm).
 * 모델 = { title, schemas, tables, conv: { dialect, fkInDb, hideEdgesTo, hubMin }, refs: { ID: [근거 문서 주소] } }. 테이블의 src = 정의서 쪽 주소
 * 여기: 이름공간 E · 상태(st) · 관계 · 영역 · 크기 계산 */
(function () {
  'use strict';
  const E = window.ERD = window.ERD || {};
  const M = E.M = window.ERD_MODEL || { title: '', schemas: [], tables: [] };
  E.html = window.htm.bind(window.preact.h);
  E.H = window.preactHooks;
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  E.keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 기억 못 해도 바뀐다 */ } };
  E.load = load;

  /* 상태: 그림 · 화면 위치 · 고른 것. 바꾼 뒤 E.update() 로 다시 그린다 (화면 이동 · 확대는 다시 그리지 않고 E.applyView) */
  const st = E.st = {
    cf: 24, hidden: new Set(), fold: new Set(), areas: null, hideHub: load('erd.hub', 'off') === 'on', level: 'compact', mode: 'auto', switching: false,
    cache: new Map(), arrange: 'rel', overview: false, lrefs: false, xarea: false, names: load('erd.names', 'both'), sel: null, selRel: null, q: '',
    k: 1, x: 0, y: 0, W: 0, H: 0, pos: new Map(), boxes: new Map(), scene: null, busy: true, err: '', ref: null,
  };
  const byId = E.byId = new Map(M.tables.map((t) => [t.id, t]));
  E.css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  E.color = (schema) => E.css(`--s${M.schemas.indexOf(schema) % 6}`);

  // 관계: 부모(참조 받는 쪽) → 자식(FK 쪽)
  const rels = E.rels = [];
  for (const t of M.tables) for (const c of t.columns) if (c.fk) {
    const m = c.ref.match(/^(\w+)\.(\w+)\.(\w+)$/);
    if (m && byId.has(`${m[1]}.${m[2]}`)) rels.push({ from: `${m[1]}.${m[2]}`, fromCol: m[3], to: t.id, toCol: c.name, nullable: c.nullable });
  }
  // 논리 참조: 키에 FK 없이 참조 칸에 「논리: 스키마.테이블[.컬럼]」. DB 외래키가 없어 배치에 넣지 않고, 켜면 점선으로 그린다
  const lrels = E.lrels = [];
  for (const t of M.tables) for (const c of t.columns) if (c.lref && !c.fk) {
    const m = c.ref.match(/^(\w+)\.(\w+)(?:\.(\w+))?$/);
    if (m && byId.has(`${m[1]}.${m[2]}`)) lrels.push({ from: `${m[1]}.${m[2]}`, fromCol: m[3] || '', to: t.id, toCol: c.name, nullable: c.nullable, logical: true });
  }
  E.allRels = () => (st.lrefs ? [...rels, ...lrels] : rels);

  // 선을 숨길 표(「참조 많은 표 선 숨김」): 들어오는 관계가 hubMin(기본 10) 이상 · 「분류: 코드」 · 「ERD: 선 숨김」 · vars.datamodel.erdHideEdgesTo
  const CONV = E.CONV = M.conv || {};
  const HUB = E.HUB = new Set(M.tables.filter((t) => t.code || t.hideEdges || (CONV.hideEdgesTo || []).includes(t.id) || rels.filter((r) => r.from === t.id).length >= (CONV.hubMin || 10)).map((t) => t.id));
  E.hubRel = (r) => st.hideHub && HUB.has(r.from);
  // 주제 영역(「영역: …」): 고른 영역의 테이블만 그린다. 꼬리표가 없는 테이블은 「영역 없음」
  const NOAREA = E.NOAREA = '(영역 없음)';
  const areasOf = E.areasOf = (t) => (t.areas && t.areas.length ? t.areas : [NOAREA]);
  const AREAS = E.AREAS = (() => { const a = [...new Set(M.tables.flatMap((t) => t.areas || []))]; return a.length ? [...a, ...(M.tables.some((t) => !(t.areas || []).length) ? [NOAREA] : [])] : []; })();
  st.areas = new Set(AREAS);
  E.areaOn = () => AREAS.length && st.areas.size < AREAS.length;
  const visible = E.visible = (t) => !st.hidden.has(t.schema) && (!E.areaOn() || areasOf(t).some((a) => st.areas.has(a)));
  // 영역 밖 표와의 관계: 선 대신 상자 아래에 「→ 표」 한 줄
  E.outside = (t) => (E.areaOn() ? [...new Set(rels.filter((r) => (r.from === t.id || r.to === t.id)).map((r) => (r.from === t.id ? r.to : r.from)).filter((id) => id !== t.id && !visible(byId.get(id))))] : []);
  E.OUT_H = () => (st.level === 'concept' ? 22 * E.cs() : 16);

  // 표시 수준(Display Level): concept = 테이블(이름만), compact = 키(PK · FK · UK), full = 컬럼(전체)
  // 「자동」 이면 확대 비율에 따라 단계가 바뀐다(경계에 여유를 둬 깜빡이지 않게)
  const LEVELS = ['concept', 'compact', 'full'];
  E.LEVEL_NAME = { concept: '테이블', compact: '키', full: '컬럼' }; // erwin · ER/Studio Display Level 의 Table · Keys · Column
  E.levelFor = (k, cur) => {
    const up = { concept: 0.6, compact: 1.0 }; // 이 비율보다 크면 한 단계 위로
    const down = { compact: 0.45, full: 0.9 }; // 이 비율보다 작으면 한 단계 아래로
    if (!cur) return k < 0.45 ? 'concept' : k < 0.95 ? 'compact' : 'full';
    if (cur !== 'full' && k > up[cur]) return LEVELS[LEVELS.indexOf(cur) + 1];
    if (cur !== 'concept' && k < down[cur]) return LEVELS[LEVELS.indexOf(cur) - 1];
    return cur;
  };
  // [테이블] 수준 글자 크기: 화면에서 약 15px 로 보이게 (24px 아래로는 줄이지 않는다, 1.25 배 단위로 바꿔 배치 계산을 아낀다)
  E.cfFor = (k) => { const raw = Math.min(480, Math.max(24, 15 / k)); return Math.round(24 * 1.25 ** Math.round(Math.log(raw / 24) / Math.log(1.25))); };
  const shownCols = E.shownCols = (t) => (st.level === 'full' ? t.columns : st.level === 'compact' ? t.columns.filter((c) => c.pk || c.fk || c.uk) : []);
  // 이름 보기: both = 논리명 + 물리명, logical = 논리명, physical = 물리명 (논리명이 없으면 물리명)
  const tw = E.tw = (str, px) => [...String(str)].reduce((w, ch) => w + (ch.charCodeAt(0) < 128 ? px * 0.62 : px * 1.02), 0);
  const label = E.label = (logical, physical) => {
    if (st.names === 'physical' || !logical) return [physical, ''];
    if (st.names === 'logical') return [logical, ''];
    return [logical, physical];
  };
  const labelW = (logical, physical, px) => { const [a, b] = label(logical, physical); return tw(a, px) + (b ? tw(b, px - 1.5) + 8 : 0); };
  // [테이블] 수준은 축소해서 보므로 글자를 크게 그린다. 크게 줄여 볼 때도 화면에서 비슷한 크기로 보이게 st.cf 를 확대 비율에 맞춰 다시 정한다
  E.ROW = 19;
  E.HEAD = 28;
  E.cs = () => st.cf / 24;
  E.CH = () => 56 * E.cs();
  E.width = (t) => (st.level === 'concept' ? Math.max(220 * E.cs(), labelW(t.logical, t.name, st.cf) + 40 * E.cs()) : Math.max(170, labelW(t.logical, t.name, 12) + 30, ...shownCols(t).map((c) => labelW(c.logical, c.name, 11.5) + tw(c.type, 10.5) + 72)));
  E.height = (t) => (st.level === 'concept' ? E.CH() + 36 * E.cs() : E.HEAD + Math.max(1, shownCols(t).length) * E.ROW + (t.columns.length > shownCols(t).length ? 16 : 0) + 6) + (E.outside(t).length ? E.OUT_H() : 0);

  // 영역 덩어리(영역 배치 · 영역 개요): 스키마 안의 영역 하나. 여러 영역에 든 표는 첫 영역(목록과 같다)
  for (const t of M.tables) t.listArea = areasOf(t)[0];
  E.chunkOf = (t) => `${t.schema}/${t.listArea}`;
  E.splitKey = (k) => { const i = k.indexOf('/'); return [k.slice(0, i), k.slice(i + 1)]; };
  E.areaName = (a) => (a === NOAREA ? '영역 없음' : a);
  E.areaMode = () => st.arrange === 'area' && AREAS.length > 0;
  E.areaFont = () => (st.level === 'concept' ? Math.round(st.cf * 0.9) : 16);
  E.degree = (id) => rels.filter((r) => r.from === id || r.to === id).length + lrels.filter((r) => r.from === id || r.to === id).length / 2;
  // 영역 개요 카드: 영역 이름 · 테이블 수 · 대표 테이블(관계가 많은 순 3개)
  E.CARD_F = 22;
  E.cardRows = 3;
  E.cardSize = (a, kids) => ({ width: Math.max(280, tw(E.areaName(a), E.CARD_F) + 48, ...kids.slice(0, E.cardRows).map((t) => tw(t.logical || t.name, 14) + 40)), height: 54 + 28 + E.cardRows * 21 + 14 });
  E.repOf = (kids) => [...kids].sort((x, y) => E.degree(y.id) - E.degree(x.id) || M.tables.indexOf(x) - M.tables.indexOf(y));

  /* 검색: 표 ID · 논리명 · 설명 · 컬럼 이름 */
  E.matches = () => {
    const q = st.q.toLowerCase();
    if (!q) return null;
    return new Set(M.tables.filter((t) => t.id.toLowerCase().includes(q) || (t.logical || '').toLowerCase().includes(q) || (t.desc || '').toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q) || (c.logical || '').toLowerCase().includes(q))).map((t) => t.id));
  };
  E.neighbors = (id) => {
    const s = new Set([id]);
    for (const r of E.allRels()) { if (r.from === id) s.add(r.to); if (r.to === id) s.add(r.from); }
    return s;
  };

  /* 다시 그리기: 앱이 E.render 를 걸어 둔다. 돌려주는 Promise 는 화면에 반영된 뒤 풀린다 */
  let waiters = [];
  E.update = () => new Promise((ok) => { waiters.push(ok); if (E.render) E.render(); else ok(); });
  E.committed = () => { const w = waiters; waiters = []; w.forEach((f) => f()); };
})();
