/* 화면 이동 · 확대 · 맞춤 · 표시 수준 바꾸기 · 고르기. 이동 · 확대는 다시 그리지 않고 SVG 변환만 바꾼다 (E.applyView) */
(function () {
  'use strict';
  const E = window.ERD, M = E.M, st = E.st;

  const stageBox = () => (E.stageEl ? E.stageEl.getBoundingClientRect() : { width: 1600, height: 900, left: 0, top: 0 });
  E.mid = () => { const b = stageBox(); return [b.width / 2, b.height / 2]; };

  /** 지금 위치 · 비율을 그림 · 확대 비율 글자 · 미니맵 사각형에 */
  E.applyView = function applyView() {
    if (E.vpEl) E.vpEl.setAttribute('transform', `translate(${st.x},${st.y}) scale(${st.k})`);
    if (E.zoomEl) E.zoomEl.textContent = `${Math.round(st.k * 100)}%`;
    if (E.miniView) E.miniView();
  };
  function fitK() {
    const b = stageBox();
    const pad = 30;
    st.k = Math.min(2, (b.width - pad * 2) / st.W, (b.height - pad * 2) / st.H);
    st.x = (b.width - st.W * st.k) / 2;
    st.y = (b.height - st.H * st.k) / 2;
    E.applyView();
  }
  E.fitK = fitK;
  // 맞춤: 글자를 키우면 카드도 커져 맞춤 비율이 같이 줄어든다. 화면 글자가 15% 이상 커질 때만 키운다 (못 키우면 돋보기로 읽는다)
  async function fitConcept() {
    for (let i = 0; i < 5 && st.level === 'concept'; i++) {
      const want = E.cfFor(st.k);
      if (want <= st.cf) break;
      const prev = st.cf;
      const px = st.cf * st.k;
      st.cf = want; await E.layout(); fitK();
      if (st.cf * st.k < px * 1.15) { st.cf = prev; await E.layout(); fitK(); break; }
    }
  }
  /** 맞춤: 자동이면 맞춘 비율에 맞는 단계로 바꾸고 다시 맞춘다. stay = 영역 개요로 바꾸지 않는다 */
  E.fit = async function fit(stay) {
    if (st.overview && E.areaMode()) { fitK(); return; }
    if (st.mode !== 'auto') { fitK(); await fitConcept(); return; }
    // 영역 배치 전체가 한 화면에서 영역 이름을 읽을 수 없을 만큼 작아지면 영역 개요로 보인다 (카드를 누르면 그 영역으로)
    if (!stay && E.areaMode() && new Set(M.tables.filter(E.visible).map(E.chunkOf)).size > 1) {
      if (st.level !== 'concept') { st.level = 'concept'; st.cf = 24; await E.layout(); }
      fitK();
      if (st.k * E.areaFont() < 11) { st.overview = true; await E.layout(); fitK(); return; }
    }
    // 키 수준으로 맞춰 보고, 너무 작으면 테이블, 넉넉하면 컬럼으로
    if (st.level !== 'compact') { st.level = 'compact'; await E.layout(); }
    fitK();
    const want = E.levelFor(st.k);
    if (want !== st.level) { st.level = want; if (want === 'concept') st.cf = E.cfFor(st.k); await E.layout(); fitK(); }
    await fitConcept();
  };
  // 다시 배치할 때(표시 수준 · 글자 크기) 화면 한 점(확대 중심) 가까이 있던 테이블이 같은 자리에 남게 한다
  async function relayoutAt(change, cx, cy) {
    if (st.switching) return;
    st.switching = true;
    const wx = (cx - st.x) / st.k;
    const wy = (cy - st.y) / st.k;
    let anchor = null;
    let best = Infinity;
    for (const [id, n] of st.pos) {
      const d = Math.hypot(n.x + n.width / 2 - wx, n.y + n.height / 2 - wy);
      if (d < best) { best = d; anchor = id; }
    }
    const a0 = anchor && st.pos.get(anchor);
    const sx = a0 ? st.x + (a0.x + a0.width / 2) * st.k : 0;
    const sy = a0 ? st.y + a0.y * st.k : 0;
    change();
    try { await E.layout(); } finally { st.switching = false; }
    const a1 = anchor && st.pos.get(anchor);
    if (a1) { st.x = sx - (a1.x + a1.width / 2) * st.k; st.y = sy - a1.y * st.k; E.applyView(); }
  }
  E.switchLevel = (level, cx, cy) => (level === st.level ? Promise.resolve() : relayoutAt(() => { st.level = level; if (level === 'concept') st.cf = E.cfFor(st.k); }, cx, cy));
  let zt = null;
  E.zoomAt = function zoomAt(f, cx, cy) {
    const k = Math.min(3, Math.max(0.03, st.k * f));
    st.x = cx - ((cx - st.x) * k) / st.k;
    st.y = cy - ((cy - st.y) * k) / st.k;
    st.k = k;
    E.applyView();
    clearTimeout(zt);
    zt = setTimeout(async () => {
      if (st.overview && E.areaMode()) return; // 영역 개요는 카드만 그린다 (표시 수준이 없다)
      // 한 번에 여러 단계를 건너뛸 수 있게 안정될 때까지 반복한다
      if (st.mode === 'auto') for (let i = 0; i < 3; i++) { const want = E.levelFor(st.k, st.level); if (want === st.level) break; await E.switchLevel(want, cx, cy); }
      if (st.level === 'concept' && E.cfFor(st.k) !== st.cf) await relayoutAt(() => { st.cf = E.cfFor(st.k); }, cx, cy);
    }, 120);
  };
  function centerOn(id) {
    const n = st.pos.get(id);
    if (!n) return;
    const b = stageBox();
    st.k = Math.max(st.k, 0.9);
    const dw = st.sel && E.detailEl ? Math.min(E.detailEl.offsetWidth || 0, b.width * 0.6) : 0; // 드로어가 가리는 오른쪽을 빼고 가운데
    st.x = (b.width - dw) / 2 - (n.x + n.width / 2) * st.k;
    st.y = b.height / 2 - (n.y + n.height / 2) * st.k;
    E.applyView();
    if (st.mode === 'auto') { const want = E.levelFor(st.k, st.level); if (want !== st.level) E.switchLevel(want, b.width / 2, b.height / 2).then(() => centerOn(id)); }
  }
  /** 테이블 묶음(스키마 · 영역 덩어리)에 맞춘다. 자동이면 맞춘 비율에 맞는 단계로 바꾸고 다시 맞춘다 */
  E.fitTables = async function fitTables(ids, key) {
    const box = () => {
      // 영역 덩어리면 제목까지 들어가게 덩어리 상자에 맞춘다
      const ns = key && st.boxes.has(key) ? [st.boxes.get(key)] : ids.map((id) => st.pos.get(id)).filter(Boolean);
      if (!ns.length) return false;
      const x0 = Math.min(...ns.map((n) => n.x)); const y0 = Math.min(...ns.map((n) => n.y));
      const x1 = Math.max(...ns.map((n) => n.x + n.width)); const y1 = Math.max(...ns.map((n) => n.y + n.height));
      const b = stageBox();
      const pad = 40;
      const top = 64; // 위쪽 조작 막대에 가리지 않게
      st.k = Math.min(1.2, (b.width - pad * 2) / (x1 - x0), (b.height - pad - top) / (y1 - y0)); // 하한 없이 (하한에 걸리면 글자 키우기 판정이 틀어진다)
      st.x = b.width / 2 - ((x0 + x1) / 2) * st.k;
      st.y = top + (b.height - pad - top) / 2 - ((y0 + y1) / 2) * st.k;
      E.applyView();
      return true;
    };
    // 단계 · 글자 크기가 바뀌면 다시 배치되어 자리가 달라지므로, 바뀔 때마다 다시 맞춘다 (전체 맞춤과 같은 규칙)
    if (st.level === 'concept' && st.cf !== 24) { st.cf = 24; await E.layout(); }
    if (!box()) return;
    for (let i = 0; i < 3 && st.mode === 'auto'; i++) {
      const want = E.levelFor(st.k, st.level);
      if (want === st.level) break;
      st.level = want;
      if (want === 'concept') st.cf = 24;
      await E.layout(); box();
    }
    // [테이블] 수준: 글자를 키우면 카드도 커진다. 화면 글자가 15% 이상 커질 때만 키운다
    for (let i = 0; i < 5 && st.level === 'concept'; i++) {
      const want = E.cfFor(st.k);
      if (want <= st.cf) break;
      const prev = st.cf;
      const px = st.cf * st.k;
      st.cf = want; await E.layout(); box();
      if (st.cf * st.k < px * 1.15) { st.cf = prev; await E.layout(); box(); break; }
    }
  };
  /** 영역 덩어리로: 영역 배치로 바꾸고 그 덩어리에 맞춘다 */
  E.goArea = async function goArea(key) {
    const ids = M.tables.filter((t) => E.visible(t) && E.chunkOf(t) === key).map((t) => t.id);
    if (!ids.length) return;
    st.arrange = 'area'; st.overview = false;
    await E.layout(); await E.fitTables(ids, key);
  };
  /** 표 고르기 (null = 해제). center = 그 표로 화면을 옮긴다 */
  E.select = function select(id, center) {
    // 영역 개요에서 표를 고르면(목록 · 검색 · 주소) 영역 배치로 바꿔 그 표로 간다
    if (id && center && st.overview && E.areaMode()) { st.overview = false; E.layout().then(() => select(id, center)); return; }
    st.sel = id;
    st.selRel = null;
    E.update().then(() => { if (id && center) centerOn(id); });
  };
  /** 관계(선) 고르기: 그 관계의 두 테이블 · 두 컬럼 · 선만 진하게. 표를 고르거나 빈 곳을 누르면 풀린다 */
  E.selectRel = function selectRel(r) {
    st.sel = null;
    st.selRel = r || null;
    E.update();
  };
  /** 근거 패널: 기능 ID · 결정 ID · 정의서 */
  E.openRef = (label, hrefs) => { st.ref = { label, hrefs, i: 0 }; E.update(); };
  E.closeRef = () => { st.ref = null; E.update(); };

  /** 보일 스키마 · 영역을 바꾼 뒤: 고른 표가 안 보이면 해제, 연달아 바꿔도 한 번만 다시 배치 */
  let relayoutT = null;
  E.applySchemas = () => {
    if (st.sel && !E.visible(E.byId.get(st.sel))) st.sel = null;
    E.update();
    clearTimeout(relayoutT);
    relayoutT = setTimeout(async () => { await E.layout(); E.fit(true); }, 250);
  };
  E.setTheme = () => {
    const v = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = v;
    E.keep('kedovi-docs-theme', v);
    st.scene = st.scene && { ...st.scene };   // 스키마 색(CSS 변수)을 다시 읽어 그린다
    E.update();
  };
})();
