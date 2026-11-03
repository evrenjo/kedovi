/* 배치: elkjs 로 위치를 계산하고(같은 조건은 기억) 그릴 자료(scene)로 바꾼다.
 * scene = { W, H, groups: [스키마 상자 · 영역 덩어리], cards: [영역 개요 카드], nodes: [테이블], edges: [{ pts, r, cls }], sums: [덩어리 사이 요약선] } */
(function () {
  'use strict';
  const E = window.ERD, M = E.M, st = E.st;
  const { byId, rels, lrels } = E;

  // 화면 비율: 덩어리 · 카드를 바둑판으로 놓을 때 이 비율에 맞춰 열 수가 정해진다
  E.aspect = () => { const s = E.stageEl; const b = s ? s.getBoundingClientRect() : { width: 1600, height: 900 }; return Math.max(0.8, Math.min(3, (b.width || 1600) / (b.height || 900))); };
  const chunks = (vis) => M.schemas.filter((s) => !st.hidden.has(s)).map((s) => ({ s, areas: E.AREAS.map((a) => ({ a, key: `${s}/${a}`, kids: vis.filter((t) => t.schema === s && t.listArea === a) })).filter((x) => x.kids.length) })).filter((x) => x.areas.length);
  const cacheKey = () => [st.level, st.level === 'concept' ? st.cf : 0, st.names, st.arrange, st.overview, E.areaMode() ? E.aspect().toFixed(1) : '', [...st.hidden].sort().join(','), st.hideHub, st.lrefs, E.areaOn() ? [...st.areas].sort().join(',') : ''].join('|');

  /** 배치하고 다시 그린다 (화면에 반영된 뒤 풀린다) */
  E.layout = async function layout() {
    const key = cacheKey();
    if (!st.cache.has(key)) st.cache.set(key, compute());
    const { out, edges, hub } = await st.cache.get(key);
    st.scene = scene(out, edges, hub);
    st.busy = false;
    await E.update();
    E.applyView();
  };

  async function compute() {
    st.busy = true;
    E.update();
    const vis = M.tables.filter(E.visible);
    const visIds = new Set(vis.map((t) => t.id));
    const area = E.areaMode();
    const { width, height, shownCols, HEAD, ROW } = E;
    // 영역 배치는 위 → 아래(부모 → 자식)라 테이블 단위로 잇는다. 그 밖에는 컬럼 높이에서 잇는다
    const ports = (t) => {
      if (area) return [];
      const w = width(t);
      return shownCols(t).flatMap((c, i) => {
        const y = HEAD + i * ROW + ROW / 2;
        return [{ id: `${t.id}#${c.name}#e`, x: w, y, width: 0, height: 0 }, { id: `${t.id}#${c.name}#w`, x: 0, y, width: 0, height: 0 }];
      });
    };
    const portOf = (tid, col, side) => (!area && shownCols(byId.get(tid)).some((c) => c.name === col) ? `${tid}#${col}#${side}` : tid);
    const node = (t) => ({ id: t.id, width: width(t), height: height(t), ports: ports(t), ...(area ? {} : { layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } }) });
    // 층마다 상한: 층 수 L 이면 층 방향 길이 ≈ L × (카드 + 층 간격), 다른 방향 ≈ (n / L) × (카드 + 간격). 목표 비율이 되는 L 에서 상한 = n / L
    const layerBound = (kids, down) => {
      const n = kids.length;
      const w = kids.reduce((x, t) => x + width(t), 0) / n + (down ? 36 : 110);
      const h = kids.reduce((x, t) => x + height(t), 0) / n + (down ? 60 : 48);
      // 목표 비율은 재 보며 정했다(124표 견본: 가로:세로 약 1.45). 묶기 없는 [컬럼] 수준은 포트가 많아 계산이 오래 걸려(목표 3 이면 3초) 낮춘다
      const L = down ? Math.sqrt((n * w) / (1.4 * h)) : Math.sqrt(((st.level === 'full' && st.arrange === 'rel' ? 1.6 : 3) * n * h) / w);
      return Math.max(3, Math.ceil(n / Math.max(1, L)));
    };
    // 배치 옵션: 층마다 테이블 수에 상한을 둔다. 많이 참조되는 테이블(종목 · 사용자 · 코드)이 있으면 자식이 한 층에 몰려 길어지기 때문 (Coffman-Graham)
    const opts = (kids, down) => {
      // 여유 있는 간격. [테이블] 수준은 글자를 키운 만큼 간격도 조금 넓힌다 (제곱근 비율: 줄여 보면 여전히 촘촘해진다)
      const c = st.level === 'concept';
      const g = c ? Math.sqrt(E.cs()) : 1;
      const v = (a, b) => String(Math.round((c ? a : b) * g));
      return {
        'elk.algorithm': 'layered', 'elk.direction': down ? 'DOWN' : 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.spacing.nodeNodeBetweenLayers': v(down ? 44 : 60, down ? 60 : 110), 'elk.spacing.nodeNode': v(24, down ? 36 : 48), 'elk.spacing.edgeNode': v(14, 28), 'elk.spacing.edgeEdge': v(7, 14),
        'elk.layered.spacing.edgeNodeBetweenLayers': v(14, 28), 'elk.layered.spacing.edgeEdgeBetweenLayers': v(7, 14), 'elk.spacing.componentComponent': v(down ? 36 : 80, down ? 48 : 80),
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP', 'elk.layered.thoroughness': '30',
        'elk.separateConnectedComponents': 'true', 'elk.aspectRatio': down ? '1.4' : '1.6',
        ...(kids.length > 12 ? { 'elk.layered.layering.strategy': 'COFFMAN_GRAHAM', 'elk.layered.layering.coffmanGraham.layerBound': String(layerBound(kids, down)) } : {}),
      };
    };
    // 숨길 선(허브 · 코드 표로 가는 선)은 배치에서 빼고, 그 표를 고를 때만 꺾은선으로 보인다 (hub)
    const bothVis = rels.filter((r) => visIds.has(r.from) && visIds.has(r.to));
    const visRels = bothVis.filter((r) => !E.hubRel(r));
    const hub = bothVis.filter(E.hubRel);
    const edge = (r, i) => ({ id: `e${i}`, sources: [portOf(r.from, r.fromCol, 'e')], targets: [portOf(r.to, r.toCol, 'w')], rel: r });
    const ix = visRels.map((r, i) => [r, i]);
    const schemaOf = (id) => byId.get(id).schema;
    // 논리 참조(켰을 때)는 배치 힌트로만: 테이블끼리 잇는 선을 배치에 넣되 rel 이 없어 그리지 않는다 (선은 scene 의 route 가 그린다).
    // FK 가 없고 논리 참조만 있는 정의서도 관계 있는 표가 붙게 한다. FK 와 같은 쌍 · 자기 참조는 뺀다
    const fkPair = new Set(visRels.map((r) => `${r.from}\u0000${r.to}`));
    const hints = (keep) => (!st.lrefs ? [] : lrels
      .filter((r) => r.from !== r.to && visIds.has(r.from) && visIds.has(r.to) && !fkPair.has(`${r.from}\u0000${r.to}`) && keep(r))
      .map((r, i) => ({ id: `l${i}:${r.from}>${r.to}`, sources: [r.from], targets: [r.to] })));
    const pack = (extra) => ({ 'elk.algorithm': 'rectpacking', 'elk.aspectRatio': String(E.aspect()), 'elk.hierarchyHandling': 'SEPARATE_CHILDREN', ...extra });
    let graph;
    if (area && st.overview) {
      // 영역 개요: 덩어리 하나 = 카드 하나. 스키마 상자 안에 카드를 바둑판으로
      graph = { id: 'root', layoutOptions: pack({ 'elk.spacing.nodeNode': '60' }), edges: [], children: chunks(vis).map(({ s, areas }) => ({
        id: `g:${s}`, layoutOptions: pack({ 'elk.spacing.nodeNode': '28', 'elk.padding': '[top=56,left=26,bottom=26,right=26]' }), edges: [],
        children: areas.map(({ a, key, kids }) => ({ id: `c:${key}`, ...E.cardSize(a, kids) })),
      })) };
    } else if (area) {
      // 영역 배치: 스키마 상자 → 영역 덩어리(바둑판) → 덩어리 안은 부모 → 자식 위에서 아래로. 덩어리 사이 선은 배치에 넣지 않는다
      const pad = Math.round(E.areaFont() * 1.6 + 22);
      graph = { id: 'root', layoutOptions: pack({ 'elk.spacing.nodeNode': '80' }), edges: [], children: chunks(vis).map(({ s, areas }) => ({
        id: `g:${s}`, layoutOptions: pack({ 'elk.spacing.nodeNode': '40', 'elk.padding': `[top=${pad + 16},left=26,bottom=26,right=26]` }), edges: [],
        children: areas.map(({ key, kids }) => {
          const ids = new Set(kids.map((t) => t.id));
          return { id: `a:${key}`, layoutOptions: { ...opts(kids, true), 'elk.padding': `[top=${pad},left=22,bottom=22,right=22]` }, children: kids.map(node), edges: ix.filter(([r]) => ids.has(r.from) && ids.has(r.to)).map(([r, i]) => edge(r, i)) };
        }),
      })) };
    } else if (st.arrange === 'schema') {
      // 스키마 묶기: 스키마마다 따로 배치해 상자로 나란히 놓는다. 스키마 사이 관계선은 scene 이 직접 잇는다
      graph = { id: 'root', layoutOptions: { 'elk.algorithm': 'rectpacking', 'elk.aspectRatio': '1.6', 'elk.spacing.nodeNode': '80', 'elk.hierarchyHandling': 'SEPARATE_CHILDREN' }, edges: [], children: M.schemas.filter((s) => !st.hidden.has(s)).map((s) => {
        const kids = vis.filter((t) => t.schema === s);
        return { id: `g:${s}`, layoutOptions: { ...opts(kids), 'elk.padding': '[top=44,left=26,bottom=26,right=26]' }, children: kids.map(node), edges: [...ix.filter(([r]) => schemaOf(r.from) === s && schemaOf(r.to) === s).map(([r, i]) => edge(r, i)), ...hints((r) => schemaOf(r.from) === s && schemaOf(r.to) === s)] };
      }) };
    } else {
      // 관계 중심(기본, 영역이 없을 때): 묶음 없이 배치해 관계있는 테이블이 붙는다
      graph = { id: 'root', layoutOptions: { ...opts(vis), 'elk.spacing.componentComponent': '80', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' }, children: vis.map(node), edges: [...visRels.map(edge), ...hints(() => true)] };
    }
    const edges = [];
    const collect = (n) => { edges.push(...(n.edges || [])); for (const c of n.children || []) collect(c); };
    collect(graph);
    const out = await new window.ELK().layout(graph);
    return { out, edges, hub };
  }

  /** ELK 결과(부모 기준 좌표) → 절대 좌표 그릴 자료. 테이블 위치는 st.pos, 덩어리 · 카드 상자는 st.boxes */
  function scene(g, edgeDefs, hub) {
    st.pos = new Map();
    st.boxes = new Map();
    st.W = g.width; st.H = g.height;
    const groups = []; const nodes = []; const cards = []; const laid = [];
    const walk = (n, ox, oy) => {
      for (const c of n.children || []) {
        const a = { id: c.id, width: c.width, height: c.height, x: ox + c.x, y: oy + c.y };
        if (c.id.startsWith('g:')) { groups.push({ ...a, kind: 'schema', schema: c.id.slice(2) }); walk(c, a.x, a.y); }
        else if (c.id.startsWith('a:')) { groups.push({ ...a, kind: 'area', key: c.id.slice(2), schema: E.splitKey(c.id.slice(2))[0] }); walk(c, a.x, a.y); }
        else if (c.id.startsWith('c:')) cards.push({ ...a, key: c.id.slice(2), schema: E.splitKey(c.id.slice(2))[0] });
        else nodes.push(a);
      }
      for (const e of n.edges || []) laid.push([e, { x: ox, y: oy }]);
    };
    walk(g, 0, 0);
    for (const n of nodes) st.pos.set(n.id, n);
    for (const x of groups) if (x.kind === 'area') st.boxes.set(x.key, x);
    for (const x of cards) st.boxes.set(x.key, x);
    const edges = [];
    const add = (pts, r, cls = '') => edges.push({ pts, r, cls });
    const defs = new Map(edgeDefs.map((d) => [d.id, d.rel]));
    for (const [e, o] of laid) {
      const r = defs.get(e.id);
      if (r) for (const sec of e.sections || []) add([sec.startPoint, ...(sec.bendPoints || []), sec.endPoint].map((q) => ({ x: q.x + o.x, y: q.y + o.y })), r);
    }
    // 배치에 넣지 않은 선: 부모 오른쪽(그 컬럼 높이) → 자식 왼쪽으로 꺾은선. 상자 사이 빈 곳으로 돌아간다
    const area = E.areaMode();
    const portY = (tid, col) => { const n = st.pos.get(tid); const i = area ? -1 : E.shownCols(byId.get(tid)).findIndex((c) => c.name === col); return n.y + (i >= 0 ? E.HEAD + i * E.ROW + E.ROW / 2 : n.height / 2); };
    const route = (r, cls) => {
      const a = st.pos.get(r.from); const b = st.pos.get(r.to);
      if (!a || !b || r.from === r.to) return;
      const s0 = { x: a.x + a.width, y: portY(r.from, r.fromCol) };
      const t0 = { x: b.x, y: portY(r.to, r.toCol) };
      const pts = t0.x > s0.x + 40
        ? [s0, { x: (s0.x + t0.x) / 2, y: s0.y }, { x: (s0.x + t0.x) / 2, y: t0.y }, t0]
        : [s0, { x: s0.x + 24, y: s0.y }, { x: s0.x + 24, y: (s0.y + t0.y) / 2 }, { x: t0.x - 24, y: (s0.y + t0.y) / 2 }, { x: t0.x - 24, y: t0.y }, t0];
      add(pts, r, cls);
    };
    const shown = (r) => st.pos.has(r.from) && st.pos.has(r.to);
    // 스키마 묶기: 스키마 사이 관계 · 숨긴 선(허브) · 논리 참조(켰을 때). 영역 배치에서는 같은 덩어리 안만 하나씩, 덩어리 사이는 요약선
    const sameChunk = (r) => E.chunkOf(byId.get(r.from)) === E.chunkOf(byId.get(r.to));
    if (st.arrange === 'schema' && !area) for (const r of rels.filter((x) => shown(x) && !E.hubRel(x) && byId.get(x.from).schema !== byId.get(x.to).schema)) route(r, ' x');
    for (const r of hub) if (!area || sameChunk(r)) route(r, ' hub');
    if (st.lrefs) for (const r of lrels.filter(shown)) if (!area || sameChunk(r)) route(r, ' lg');
    // 덩어리 사이 요약선: 덩어리 → 덩어리 하나에 개수 (FK 는 「영역 사이 선」, 논리 참조는 「논리 참조」 를 켰을 때)
    const sums = [];
    if (area) {
      const vis = (id) => E.visible(byId.get(id));
      const pairs = new Map();
      const count = (r, k) => {
        if (!vis(r.from) || !vis(r.to)) return;
        const a = E.chunkOf(byId.get(r.from)); const b = E.chunkOf(byId.get(r.to));
        if (a === b) return;
        const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
        const p = pairs.get(key) || { a: a < b ? a : b, b: a < b ? b : a, fk: 0, lg: 0 };
        p[k]++; pairs.set(key, p);
      };
      if (st.xarea) for (const r of rels) count(r, 'fk');
      if (st.lrefs) for (const r of lrels) count(r, 'lg');
      const clip = (bx, tx, ty) => { const cx = bx.x + bx.width / 2; const cy = bx.y + bx.height / 2; const dx = tx - cx; const dy = ty - cy; const k = Math.min(Math.abs(bx.width / 2 / (dx || 1e-9)), Math.abs(bx.height / 2 / (dy || 1e-9))); return { x: cx + dx * k, y: cy + dy * k }; };
      const f = st.overview ? 15 : Math.max(13, E.areaFont() * 0.8);
      for (const p of pairs.values()) {
        const A = st.boxes.get(p.a); const B = st.boxes.get(p.b);
        if (!A || !B) continue;
        sums.push({ p, f, s0: clip(A, B.x + B.width / 2, B.y + B.height / 2), t0: clip(B, A.x + A.width / 2, A.y + A.height / 2), txt: [p.fk ? `FK ${p.fk}` : '', p.lg ? `논리 ${p.lg}` : ''].filter(Boolean).join(' · ') });
      }
    }
    // 그때의 그리기 조건도 같이 둔다 (scene 이 바뀔 때만 다시 그린다)
    return { W: g.width, H: g.height, groups, nodes, cards, edges, sums, level: st.level, cf: st.cf, names: st.names, area, overview: st.overview };
  }
})();
