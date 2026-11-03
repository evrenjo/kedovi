/* 캔버스: 그릴 자료(scene)를 SVG 로 · 끌어서 이동 · 휠 확대 · 표 누르기 · 돋보기 · 미니맵 */
(function () {
  'use strict';
  const E = window.ERD, M = E.M, st = E.st, html = E.html, H = E.H;
  const { byId, rels, lrels } = E;

  /** 표 하나 */
  function Table(n, cls, onPick, onPeek, hl) {
    const t = byId.get(n.id);
    const big = st.level === 'concept';
    const hh = big ? E.CH() : E.HEAD;
    const [a, b] = E.label(t.logical, t.name);
    const sc = E.shownCols(t);
    const rows = sc.map((c, i) => {
      const y = E.HEAD + i * E.ROW + 13;
      let x = 8;
      const keys = [];
      for (const [k, on] of [['PK', c.pk], ['FK', c.fk], ['UK', c.uk]]) if (on) {
        keys.push(html`<rect x=${x} y=${y - 9} width="17" height="11" rx="2" fill=${E.css(`--${k.toLowerCase()}`)} /><text class="kb" x=${x + 2} y=${y - 0.5}>${k}</text>`);
        x += 19;
      }
      const [ca, cb] = E.label(c.logical, c.name);
      const mark = hl && hl.has(c.name) ? html`<rect class="hlc" x="1" y=${E.HEAD + i * E.ROW} width=${n.width - 2} height=${E.ROW} />` : null;
      return html`${mark}${keys}<text class="cn" x=${Math.max(x + 2, 46)} y=${y}>${ca}${cb ? html`<tspan class="cp" dx="6">${cb}</tspan>` : null}</text><text class="ct" x=${n.width - 8} y=${y} text-anchor="end">${c.type + (c.nullable ? '?' : '')}</text>`;
    });
    const rest = t.columns.length - sc.length;
    const out = E.outside(t);
    const nrel = big ? rels.filter((r) => r.from === t.id || r.to === t.id).length : 0;
    return html`<g key=${t.id} class=${`tb${cls}`} data-id=${t.id} transform=${`translate(${n.x},${n.y})`}
        onClick=${(ev) => { ev.stopPropagation(); onPick(t.id); }} onMouseEnter=${() => onPeek(t.id)} onMouseLeave=${() => onPeek(null)}>
      <rect class="box" width=${n.width} height=${n.height} rx="6" />
      <path class="hd" d=${`M0 6 a6 6 0 0 1 6 -6 h${n.width - 12} a6 6 0 0 1 6 6 v${hh - 6} h${-n.width} z`} fill=${E.color(t.schema)} />
      <text class=${big ? 'tn big' : 'tn'} x=${big ? 14 * E.cs() : 10} y=${big ? 37 * E.cs() : 18} style=${big ? `font-size:${st.cf}px` : undefined}>${a}${b ? html`<tspan class="tp" dx=${big ? 7 * E.cs() : 7} style=${big ? `font-size:${st.cf * 0.7}px` : undefined}>${b}</tspan>` : null}</text>
      ${rows}
      ${big ? html`<text class="more big" x=${14 * E.cs()} y=${E.CH() + 24 * E.cs()} style=${`font-size:${st.cf * 0.67}px`}>컬럼 ${t.columns.length} · 관계 ${nrel}</text>`
        : !sc.length ? html`<text class="more" x="10" y=${E.HEAD + 13}>키 컬럼 없음</text>` : null}
      ${rest > 0 && st.level === 'compact' ? html`<text class="more" x="10" y=${E.HEAD + sc.length * E.ROW + 13}>+ 컬럼 ${rest}개 (확대하면 모두)</text>` : null}
      ${out.length ? html`<text class=${big ? 'more out big' : 'more out'} x=${big ? 14 * E.cs() : 10} y=${n.height - (big ? 8 * E.cs() : 5)} style=${big ? `font-size:${st.cf * 0.6}px` : undefined}>→ 영역 밖: ${out.slice(0, 3).join(' · ')}${out.length > 3 ? ` 외 ${out.length - 3}` : ''}<title>영역 밖 관계: ${out.join(', ')}</title></text>` : null}
    </g>`;
  }

  /** 그림 전체 (scene · 고른 표 · 검색이 바뀔 때만 다시 만든다) */
  function drawing(sc, sel, hit, onPick, onPeek, rsel) {
    const near = sel ? E.neighbors(sel) : null;
    // 고른 관계(선): 두 테이블 · 두 컬럼 · 그 선만 진하게
    const ends = rsel ? new Set([rsel.from, rsel.to]) : null;
    const hlOf = (id) => (!rsel ? null : new Set([...(rsel.from === id && rsel.fromCol ? [rsel.fromCol] : []), ...(rsel.to === id && rsel.toCol ? [rsel.toCol] : [])]));
    const visT = (key) => M.tables.filter((t) => E.visible(t) && E.chunkOf(t) === key);
    const groups = sc.groups.map((grp) => {
      const c = E.color(grp.schema);
      if (grp.kind === 'schema') {
        const f = !sc.area ? 13 : sc.overview ? 16 : Math.max(13, E.areaFont() * 0.85);
        return html`<g key=${grp.id} class="grp" data-schema=${grp.schema}><rect x=${grp.x} y=${grp.y} width=${grp.width} height=${grp.height} rx="10" stroke=${c} /><text x=${grp.x + 16} y=${grp.y + f + 12} fill=${c} style=${`font-size:${f}px`}>${grp.schema} 스키마 · ${M.tables.filter((t) => t.schema === grp.schema && E.visible(t)).length}</text></g>`;
      }
      // 영역 덩어리: 제목을 누르면 그 덩어리에 맞춘다
      const kids = visT(grp.key);
      const f = E.areaFont();
      return html`<g key=${grp.id} class="agrp" data-key=${grp.key}><rect x=${grp.x} y=${grp.y} width=${grp.width} height=${grp.height} rx="8" stroke=${c} />
        <text class="at" x=${grp.x + 14} y=${grp.y + f + 8} fill=${c} style=${`font-size:${f}px`} onClick=${(ev) => { ev.stopPropagation(); E.fitTables(kids.map((t) => t.id), grp.key); }}>${E.areaName(E.splitKey(grp.key)[1])}<tspan class="an" dx=${f * 0.5} style=${`font-size:${f * 0.7}px`}>테이블 ${kids.length}</tspan><title>누르면 이 영역에 맞춘다</title></text></g>`;
    });
    // 영역 개요 카드: 누르면 영역 배치로 바꿔 그 덩어리로 확대
    const cards = sc.cards.map((cd) => {
      const [s, a] = E.splitKey(cd.key);
      const kids = visT(cd.key);
      const ids = new Set(kids.map((t) => t.id));
      const fk = rels.filter((r) => ids.has(r.from) && ids.has(r.to)).length;
      const lg = lrels.filter((r) => ids.has(r.from) || ids.has(r.to)).length;
      const rep = E.repOf(kids);
      const on = !!hit && kids.some((t) => hit.has(t.id));
      return html`<g key=${cd.id} class=${`card${on ? ' hit' : hit ? ' dim' : ''}`} data-key=${cd.key} transform=${`translate(${cd.x},${cd.y})`} onClick=${(ev) => { ev.stopPropagation(); E.goArea(cd.key); }}>
        <rect class="box" width=${cd.width} height=${cd.height} rx="10" />
        <path class="hd" d=${`M0 10 a10 10 0 0 1 10 -10 h${cd.width - 20} a10 10 0 0 1 10 10 v44 h${-cd.width} z`} fill=${E.color(s)} />
        <text class="cn0" x="16" y="36" style=${`font-size:${E.CARD_F}px`}>${E.areaName(a)}</text>
        <text class="cs" x="16" y=${54 + 22}>테이블 ${kids.length} · FK ${fk}${lrels.length ? ` · 논리 참조 ${lg}` : ''}</text>
        ${rep.slice(0, E.cardRows).map((t, i) => html`<text key=${t.id} class="cr" x="16" y=${54 + 28 + 18 + i * 21}>· ${t.logical || t.name}${i === E.cardRows - 1 && rep.length > E.cardRows ? html`<tspan class="cm" dx="8">외 ${rep.length - E.cardRows}</tspan>` : null}</text>`)}
        <title>${`${s} · ${E.areaName(a)}: ${kids.map((t) => t.logical || t.name).join(', ')}\n누르면 이 영역으로 확대`}</title>
      </g>`;
    });
    const tables = sc.nodes.map((n) => {
      const id = n.id;
      const cls = ends
        ? (ends.has(id) ? ' rsel' : ' dim')
        : `${id === sel ? ' sel' : ''}${hit && hit.has(id) && id !== sel ? ' hit' : ''}${(near && !near.has(id)) || (!near && hit && !hit.has(id)) ? ' dim' : ''}`;
      return Table(n, cls, onPick, onPeek, hlOf(id));
    });
    // 선: 고른 표의 선은 맨 위에
    const ed = sc.edges.map((e, i) => ({ e, i, on: rsel ? e.r === rsel : !!sel && (e.r.from === sel || e.r.to === sel) })).sort((x, y) => x.on - y.on);
    const edges = ed.map(({ e, i, on }) => {
      const r = e.r;
      const dim = rsel ? !on : (sel && !on) || (!sel && hit && !(hit.has(r.from) && hit.has(r.to)));
      return html`<path key=${`e${i}`} class=${`ed${e.cls}${on ? ' on' : ''}${dim ? ' dim' : ''}`} d=${`M${e.pts.map((q) => `${q.x} ${q.y}`).join(' L')}`} marker-start="url(#one)" marker-end="url(#many)" stroke-dasharray=${r.nullable ? '5 3' : undefined}>
        <title>${`${r.from}${r.fromCol ? `.${r.fromCol}` : ''} 1 ─ N ${r.to}.${r.toCol}${r.nullable ? ' (선택)' : ''}${r.logical ? ' · 논리 참조 (DB 외래키 없음)' : e.cls === ' x' ? ' · 스키마 사이' : e.cls === ' hub' ? ' · 숨긴 선 (참조 많은 표)' : ''}`}</title></path>`;
    });
    // 누르기 쉬운 넓은 투명 선 (숨긴 선은 보일 때만)
    const hits = ed.filter(({ e, on }) => e.cls !== ' hub' || on).map(({ e, i }) => html`<path key=${`h${i}`} class="edhit" d=${`M${e.pts.map((q) => `${q.x} ${q.y}`).join(' L')}`} onClick=${(ev) => { ev.stopPropagation(); E.selectRel(e.r); }} />`);
    const sums = sc.sums.map((s, i) => html`<path key=${`s${i}`} class=${`sum${s.p.fk ? '' : ' lg'}`} d=${`M${s.s0.x} ${s.s0.y} L${s.t0.x} ${s.t0.y}`} style=${`stroke-width:${Math.min(8, 1.5 + Math.sqrt(s.p.fk + s.p.lg))}px`}><title>${`${s.p.a.replace('/', ' · ')} ↔ ${s.p.b.replace('/', ' · ')}: ${s.txt}`}</title></path>`);
    const sumTexts = sc.sums.map((s, i) => html`<text key=${`t${i}`} class="sumt" x=${(s.s0.x + s.t0.x) / 2} y=${(s.s0.y + s.t0.y) / 2 + s.f / 3} text-anchor="middle" style=${`font-size:${s.f}px`}>${s.txt}</text>`);
    return html`<g>${groups}</g><g>${edges}${sums}${hits}</g><g>${cards}${tables}</g><g>${sumTexts}</g>`;
  }

  /** 돋보기: 축소해서 글자가 작을 때 카드에 마우스를 올리면 읽기 좋은 크기로 띄운다 (늘 전체 컬럼) */
  function Peek(props) {
    const ref = H.useRef(null);
    const t = props.id && byId.get(props.id);
    H.useLayoutEffect(() => {
      const el = ref.current, n = t && st.pos.get(t.id);
      if (!el || !n) return;
      const b = E.stageEl.getBoundingClientRect();
      const r = { x: st.x + n.x * st.k, y: st.y + n.y * st.k, w: n.width * st.k };
      let x = r.x + r.w + 12;
      if (x + el.offsetWidth > b.width - 8) x = Math.max(8, r.x - el.offsetWidth - 12);
      el.style.left = `${x}px`;
      el.style.top = `${Math.min(Math.max(8, r.y - 4), b.height - el.offsetHeight - 8)}px`;
    });
    if (!t) return html`<div id="peek" ref=${ref}></div>`;
    const nm = (l, p) => { const [a, b] = E.label(l, p); return html`${a}${b ? html` <span class="pp">${b}</span>` : null}`; };
    const kb = (c) => [['pk', c.pk], ['fk', c.fk], ['uk', c.uk]].filter((x) => x[1]).map(([k]) => html`<i class=${`k ${k}`}>${k.toUpperCase()}</i>`);
    return html`<div id="peek" ref=${ref} style="display:block">
      <div class="ph" style=${`background:${E.color(t.schema)}`}>${nm(t.logical, t.name)}</div>
      <table>${t.columns.map((c) => html`<tr><td class="kk">${kb(c)}</td><td>${nm(c.logical, c.name)}</td><td class="ty">${c.type}${c.nullable ? '?' : ''}</td></tr>`)}</table>
      <div class="pf">관계 ${rels.filter((r) => r.from === t.id || r.to === t.id).length} · ${t.schema}</div>
    </div>`;
  }

  /** 미니맵: 전체 배치를 줄여 그리고(테이블 = 스키마 색) 지금 보이는 영역을 사각형으로. 누르거나 끌면 그 자리를 가운데로 */
  const MW = 200, MH = 140;
  function Mini(props) {
    const sc = props.scene;
    const on = H.useState(() => E.load('erd.mini', 'on') !== 'off');
    const svg = H.useRef(null), view = H.useRef(null);
    const ms = sc ? Math.min(MW / (sc.W || 1), MH / (sc.H || 1)) : 1;
    E.miniView = () => {
      const v = view.current;
      if (!v || !E.stageEl) return;
      const b = E.stageEl.getBoundingClientRect();
      // 지금 보이는 곳 = 미니맵 안으로 자른 사각형 (줄여서 전체가 보이면 미니맵 전체 테두리)
      const W = (sc ? sc.W : 0) * ms, Hh = (sc ? sc.H : 0) * ms;
      const x0 = Math.max(0, (-st.x / st.k) * ms), y0 = Math.max(0, (-st.y / st.k) * ms);
      const x1 = Math.min(W, ((b.width - st.x) / st.k) * ms), y1 = Math.min(Hh, ((b.height - st.y) / st.k) * ms);
      v.setAttribute('x', x0); v.setAttribute('y', y0);
      v.setAttribute('width', Math.max(2, x1 - x0)); v.setAttribute('height', Math.max(2, y1 - y0));
    };
    H.useLayoutEffect(() => E.miniView());
    const down = H.useRef(false);
    const go = (e) => {
      const r = svg.current.getBoundingClientRect();
      const b = E.stageEl.getBoundingClientRect();
      st.x = b.width / 2 - ((e.clientX - r.left) / ms) * st.k;
      st.y = b.height / 2 - ((e.clientY - r.top) / ms) * st.k;
      E.applyView();
    };
    const stop = (e) => e.stopPropagation();
    return html`<div id="mini" class=${on[0] ? '' : 'off'} aria-label="미니맵" onPointerDown=${stop} onClick=${stop} onWheel=${(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <button id="miniBtn" title="미니맵 접기 · 펴기" aria-expanded=${on[0]} onClick=${() => { on[1](!on[0]); E.keep('erd.mini', on[0] ? 'off' : 'on'); }}>${on[0] ? '미니맵 ▾' : '미니맵 ▸'}</button>
      <svg id="minisvg" ref=${svg} width=${sc ? Math.max(40, sc.W * ms) : 40} height=${sc ? Math.max(30, sc.H * ms) : 30}
        onPointerDown=${(e) => { down.current = true; props.onPeek(null); svg.current.setPointerCapture(e.pointerId); go(e); }} onPointerMove=${(e) => { if (down.current) go(e); }} onPointerUp=${() => { down.current = false; }}>
        <g id="minig">${sc ? [
          ...sc.groups.map((g) => html`<rect class=${g.kind === 'area' ? 'mg ma' : 'mg'} x=${g.x * ms} y=${g.y * ms} width=${g.width * ms} height=${g.height * ms} stroke=${E.color(g.schema)} />`),
          ...[...sc.nodes, ...sc.cards].map((n) => html`<rect x=${n.x * ms} y=${n.y * ms} width=${Math.max(1.5, n.width * ms)} height=${Math.max(1.5, n.height * ms)} fill=${E.color(n.schema || byId.get(n.id).schema)} />`),
        ] : null}</g>
        <rect id="miniView" ref=${view}></rect>
      </svg>
    </div>`;
  }

  E.Canvas = function Canvas(props) {
    const sc = st.scene;
    const stage = H.useRef(null), vp = H.useRef(null);
    const pk = H.useState(null), peekT = H.useRef(0);
    const drag = H.useRef(null);
    H.useLayoutEffect(() => { E.stageEl = stage.current; E.vpEl = vp.current; E.applyView(); });
    const onPeek = H.useCallback((id) => {
      clearTimeout(peekT.current);
      if (!id || st.k >= 0.95 || drag.current) { pk[1](null); return; }   // 충분히 크면 띄우지 않는다
      peekT.current = setTimeout(() => pk[1](id), 120);
    }, []);
    const onPick = H.useCallback((id) => E.select(id), []);
    const hit = E.matches();
    const body = H.useMemo(() => (sc ? drawing(sc, st.sel, hit, onPick, onPeek, st.selRel) : null), [sc, st.sel, st.selRel, st.q, st.lrefs]);
    /* 손 · 마우스로 움직이기: 한 손가락(마우스) 끌기 = 이동, 두 손가락 = 확대 · 축소 + 이동, 휠 = 확대 · 축소.
       캔버스에만 touch-action: none 을 걸어 브라우저(iPad Safari)의 화면 확대 · 스크롤 대신 이 그림이 움직인다. 표 · 카드 위에서 시작해도 움직이고, 움직였으면 누르기로 치지 않는다 */
    const pts = H.useRef(new Map()), pinch = H.useRef(null), moved = H.useRef(false);
    H.useEffect(() => {
      const el = stage.current;
      const at = (e) => { const b = el.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
      const wheel = (e) => { e.preventDefault(); onPeek(null); const [x, y] = at(e); E.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, x, y); };
      const two = () => { const [a, b] = [...pts.current.values()]; return { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; };
      const move = (e) => {
        if (!pts.current.has(e.pointerId)) return;
        pts.current.set(e.pointerId, at(e));
        if (pts.current.size >= 2 && pinch.current) {
          const n = two(), p = pinch.current;
          st.x += n.m[0] - p.m[0]; st.y += n.m[1] - p.m[1];   // 두 손가락 가운데가 움직인 만큼 이동
          E.zoomAt(n.d / p.d, n.m[0], n.m[1]);
          pinch.current = n; moved.current = true;
          return;
        }
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) { d.moved = true; moved.current = true; onPeek(null); }
        st.x = d.sx + dx; st.y = d.sy + dy; E.applyView();
      };
      const up = (e) => {
        if (!pts.current.delete(e.pointerId)) return;
        if (pts.current.size === 1) {   // 두 손가락 중 하나를 떼면 남은 손가락으로 이어서 끈다
          const [id, q] = [...pts.current.entries()][0];
          const b = el.getBoundingClientRect();
          pinch.current = null; drag.current = { x: q[0] + b.left, y: q[1] + b.top, sx: st.x, sy: st.y, moved: true }; void id;
          return;
        }
        if (pts.current.size) return;
        const d = drag.current;
        if (d && !d.moved && !e.target.closest('.tb, .card, .at, .edhit')) E.select(null);
        drag.current = null; pinch.current = null; el.classList.remove('drag');
      };
      /* Safari 의 화면 확대 제스처를 캔버스에서는 쓰지 않는다 */
      const gesture = (e) => e.preventDefault();
      /* 끌거나 확대한 뒤의 누르기는 표 · 카드 고르기로 치지 않는다 */
      const click = (e) => { if (moved.current && !e.target.closest('#tools, #mini, #detail, #ref, #legend, #peek')) { e.stopPropagation(); e.preventDefault(); } moved.current = false; };
      el.addEventListener('wheel', wheel, { passive: false });
      el.addEventListener('gesturestart', gesture);
      el.addEventListener('gesturechange', gesture);
      el.addEventListener('click', click, true);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      return () => {
        el.removeEventListener('wheel', wheel); el.removeEventListener('gesturestart', gesture); el.removeEventListener('gesturechange', gesture); el.removeEventListener('click', click, true);
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      };
    }, []);
    const down = (e) => {
      if (!pts.current.size) moved.current = false;   // 새로 누르기 시작: 지난 끌기 표시는 지운다
      if (e.target.closest('#tools, #mini, #detail, #ref, #legend, #peek') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const b = stage.current.getBoundingClientRect();
      pts.current.set(e.pointerId, [e.clientX - b.left, e.clientY - b.top]);
      moved.current = false;
      if (pts.current.size === 2) { const [a, c] = [...pts.current.values()]; pinch.current = { d: Math.hypot(a[0] - c[0], a[1] - c[1]) || 1, m: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2] }; drag.current = null; return; }
      drag.current = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y, moved: false };
      stage.current.classList.add('drag');
    };
    return html`<section id="stage" ref=${stage} onPointerDown=${down}>
      <svg id="svg" xmlns="http://www.w3.org/2000/svg"><defs>
        <marker id="many" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M11 6 L1 1 M11 6 L1 11 M11 6 L1 6" fill="none" stroke="context-stroke" stroke-width="1.2" /></marker>
        <marker id="one" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse"><path d="M7 1 L7 11 M10 1 L10 11" fill="none" stroke="context-stroke" stroke-width="1.2" /></marker>
      </defs><g id="vp" ref=${vp}>${body}</g></svg>
      <div id="msg" style=${st.busy || st.err ? '' : 'display:none'}>${st.err || '배치 계산 중…'}</div>
      ${props.children}
      <${Mini} scene=${sc} onPeek=${onPeek} />
      <${Peek} id=${pk[0]} />
    </section>`;
  };
})();
