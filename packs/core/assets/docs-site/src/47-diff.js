/* 바뀐 점 보기 (프로젝트 사이트): 문서 md 의 지난 판(assets/history/<이름>.json, 필요할 때만 읽음)과 지금 판을 줄 단위로 비교한다.
   「합쳐 보기」 = 고른 기간 앞 판 → 지금, 「커밋별」 = 커밋마다 그 앞 판 → 그 커밋. 더한 줄 초록 · 지운 줄 빨강 · 같은 줄은 접는다.
   기간 기본: 지난 방문 이후 (모르면 최근 7일, 그 사이 커밋이 없으면 마지막 커밋). 비교는 이 파일의 줄 diff (Myers) */
(function () {
  "use strict";
  var DS = window.DS, html = DS.html, H = DS.hooks;
  var CTX = 3;
  DS.ICON.diff = '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M11 18H8a2 2 0 0 1-2-2V9"/>';

  /* ── 줄 diff: 앞뒤 같은 줄을 걷고 Myers O(ND). 너무 다르면 통째로 지우고 더한다 ── */
  DS.lineDiff = function (a, b) {
    var s = 0, ea = a.length, eb = b.length, out = [], i;
    while (s < ea && s < eb && a[s] === b[s]) s++;
    while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    for (i = 0; i < s; i++) out.push({ k: " ", s: a[i] });
    var mid = myers(a.slice(s, ea), b.slice(s, eb));
    out = out.concat(mid);
    for (i = ea; i < a.length; i++) out.push({ k: " ", s: a[i] });
    return out;
  };
  var whole = function (a, b) { return a.map(function (s) { return { k: "-", s: s }; }).concat(b.map(function (s) { return { k: "+", s: s }; })); };
  /* 차례마다 그때 쓰인 칸(-d-1 … d+1)만 남긴다 (메모리 O(D²)). 2000 차례가 넘게 다르면 통째로 */
  function myers(a, b) {
    var n = a.length, m = b.length, max = n + m, off = max + 1, v = new Int32Array(2 * max + 3), trace = [], d, k, x, y;
    if (!n || !m) return whole(a, b);
    for (d = 0; d <= max; d++) {
      if (d > 2000) return whole(a, b);
      trace.push({ lo: off - d - 1, a: v.slice(off - d - 1, off + d + 2) });
      for (k = -d; k <= d; k += 2) {
        x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        y = x - k;
        while (x < n && y < m && a[x] === b[y]) { x++; y++; }
        v[off + k] = x;
        if (x >= n && y >= m) return back(trace, a, b, off, x, y, d);
      }
    }
    return whole(a, b);
  }
  function back(trace, a, b, off, x, y, D) {
    var out = [], d, k, t, pk, px, py;
    var at = function (i) { return t.a[i - t.lo]; };
    for (d = D; d > 0; d--) {
      t = trace[d]; k = x - y;
      pk = k === -d || (k !== d && at(off + k - 1) < at(off + k + 1)) ? k + 1 : k - 1;
      px = at(off + pk); py = px - pk;
      while (x > px && y > py) { out.push({ k: " ", s: a[x - 1] }); x--; y--; }
      if (x === px) out.push({ k: "+", s: b[py] }); else out.push({ k: "-", s: a[px] });
      x = px; y = py;
    }
    while (x > 0 && y > 0) { out.push({ k: " ", s: a[x - 1] }); x--; y--; }
    return out.reverse();
  }

  /* 지운 줄 묶음 바로 뒤 같은 수의 더한 줄: 짝을 지어 바뀐 글자만 진하게 (앞뒤 같은 글자를 걷는 정도) */
  function pairWords(ops) {
    for (var i = 0; i < ops.length; i++) {
      if (ops[i].k !== "-") continue;
      var j = i; while (j < ops.length && ops[j].k === "-") j++;
      var e = j; while (e < ops.length && ops[e].k === "+") e++;
      if (e - j === j - i) for (var t = 0; t < j - i; t++) mark(ops[i + t], ops[j + t]);
      i = e - 1;
    }
    return ops;
  }
  function mark(o, n) {
    var a = o.s, b = n.s, p = 0, q = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
    if (p + q === 0) return;
    o.w = [p, a.length - q]; n.w = [p, b.length - q];
  }
  var lines = function (t) { return t == null ? [] : String(t).replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n"); };

  /* ── 지난 판 읽기 (쪽마다 한 번) ── */
  var cache = {};
  DS.histLoad = function (db, page) {
    var f = db && db.history && db.history[page];
    if (!f) return Promise.resolve(null);
    if (!cache[f]) cache[f] = (window.fetch ? fetch(DS.url(f), { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }) : Promise.reject(new Error("fetch 없음")))
      .then(function (j) { return j && Array.isArray(j.commits) && Array.isArray(j.texts) ? j : null; }, function () { delete cache[f]; return null; });
    return cache[f];
  };
  /* 이 사이트가 지난 판을 만들었는가 (옛 빌드 DB 에는 칸이 없다) */
  DS.hasHist = function (db) { return !!(db && db.history && typeof db.history === "object"); };

  /* 기간: since(지난 방문) · 7d · last(마지막 커밋) · all(남은 기록 전체). 반환 { list(새것부터 커밋), from(앞 판 글 | null) } */
  function rangeOf(h, key) {
    var cs = h.commits, cut = null, n;
    if (key === "since") cut = DS.since;
    if (key === "7d") cut = new Date(Date.now() - 7 * 86400000).toISOString();
    if (key === "last") n = 1;
    else if (key === "all") n = cs.length;
    else { n = 0; while (n < cs.length && new Date(cs[n].at) > new Date(cut)) n++; }
    return { list: cs.slice(0, n), from: textBefore(h, n) };
  }
  /* n 번째 커밋 앞 판: 그다음 커밋의 글, 없으면 바탕 (null = 모름) */
  function textBefore(h, n) { return n < h.commits.length ? h.texts[h.commits[n].t] : h.base == null ? null : h.texts[h.base]; }
  var RANGES = [["since", "지난 방문 이후"], ["7d", "최근 7일"], ["last", "마지막 커밋"], ["all", "남은 기록 전체"]];

  /* 비교 한 벌: 더한 줄 · 지운 줄 · 같은 줄(앞뒤 CTX 줄만, 나머지는 접음) */
  function Diff(props) {
    var es = H.useState({}), open = es[0], setOpen = es[1];
    var ops = H.useMemo(function () { return pairWords(DS.lineDiff(lines(props.a), lines(props.b))); }, [props.a, props.b]);
    var add = 0, del = 0;
    ops.forEach(function (o) { if (o.k === "+") add++; else if (o.k === "-") del++; });
    if (!add && !del) return html`<div class="df-none">글은 그대로입니다</div>`;
    var keep = ops.map(function () { return false; });
    ops.forEach(function (o, i) { if (o.k !== " ") for (var j = Math.max(0, i - CTX); j <= Math.min(ops.length - 1, i + CTX); j++) keep[j] = true; });
    var rows = [], i = 0, oldN = 0, newN = 0;
    while (i < ops.length) {
      if (keep[i] || open[i]) {
        var o = ops[i];
        if (o.k !== "+") oldN++;
        if (o.k !== "-") newN++;
        rows.push(html`<div key=${i} class=${"df-row " + (o.k === "+" ? "add" : o.k === "-" ? "del" : "ctx")}><span class="df-n">${o.k === "+" ? "" : oldN}</span><span class="df-n">${o.k === "-" ? "" : newN}</span><span class="df-s" aria-hidden="true">${o.k === " " ? "" : o.k}</span><span class="df-t">${o.w ? [o.s.slice(0, o.w[0]), html`<mark>${o.s.slice(o.w[0], o.w[1])}</mark>`, o.s.slice(o.w[1])] : o.s || " "}</span></div>`);
        i++;
        continue;
      }
      var j = i; while (j < ops.length && !keep[j] && !open[j]) j++;
      var from = i, cnt = j - i;
      oldN += cnt; newN += cnt;
      rows.push(html`<button type="button" key=${"f" + i} class="df-fold" onClick=${function () { var x = Object.assign({}, open); for (var t = from; t < from + cnt; t++) x[t] = true; setOpen(x); }}>같은 줄 ${cnt}개 펼치기</button>`);
      i = j;
    }
    return html`<div class="df"><div class="df-sum">${add ? html`<span class="df-add">+${add}</span>` : null}${del ? html`<span class="df-del">−${del}</span>` : null}</div><div class="df-body" role="table" aria-label="바뀐 줄">${rows}</div></div>`;
  }

  function Commit(props) {
    var c = props.c;
    return html`<div class="df-c"><span class="df-when">${DS.mdhm(c.at)}</span><b>${c.by}</b><span class="df-msg">${c.summary}</span><code>${c.sha}</code></div>`;
  }

  /* ── 서랍 ── */
  DS.DiffDrawer = function DiffDrawer(props) {
    var db = props.db, page = props.page;
    var hs = H.useState(undefined), h = hs[0], setH = hs[1];
    var ms = H.useState("sum"), mode = ms[0], setMode = ms[1];
    var rs = H.useState(null), key = rs[0], setKey = rs[1];
    H.useEffect(function () { setH(undefined); setKey(null); DS.histLoad(db, page).then(function (j) { setH(j); }); }, [page]);
    var head = html`<div class="rel-h"><b>바뀐 점</b><button type="button" class="lbtn rel-x" onClick=${props.onClose}>닫기</button></div><div class="muted-s">${DS.titleOf(page)} · md 원본 기준</div>`;
    if (h === undefined) return html`${head}<div class="kempty">읽는 중…</div>`;
    if (!h || !h.commits.length) return html`${head}<div class="kempty">이전 판이 없습니다</div>`;
    /* 쓸 수 있는 기간 (커밋이 있고 앞 판과 다른 것만, 같은 커밋 묶음은 하나만) */
    var opts = [], seen = {};
    RANGES.forEach(function (r) {
      if (r[0] === "since" && !DS.since) return;
      var x = rangeOf(h, r[0]), sig = x.list.length;
      if (!x.list.length || seen[sig]) return;
      seen[sig] = 1; opts.push({ k: r[0], t: r[1], x: x });
    });
    var cur = opts.find(function (o) { return o.k === key; }) || opts[0];
    var now = h.texts[h.commits[0].t];
    var list = cur.x.list;
    return html`${head}
      <div class="df-bar">
        <div class="subtabs" role="tablist">${[["sum", "합쳐 보기"], ["each", "커밋별"]].map(function (t) { return html`<button type="button" role="tab" key=${t[0]} class=${mode === t[0] ? "on" : ""} aria-selected=${mode === t[0]} onClick=${function () { setMode(t[0]); }}>${t[1]}</button>`; })}</div>
        <select class="tin df-range" aria-label="기간" value=${cur.k} onChange=${function (e) { setKey(e.currentTarget.value); }}>${opts.map(function (o) { return html`<option key=${o.k} value=${o.k}>${o.t} · 커밋 ${o.x.list.length}</option>`; })}</select>
      </div>
      ${mode === "sum" ? html`<div class="df-cs">${list.map(function (c) { return html`<${Commit} key=${c.sha} c=${c} />`; })}</div>
          ${cur.x.from == null ? html`<div class="kempty">이전 판이 없습니다</div>` : html`<${Diff} a=${cur.x.from} b=${now} />`}`
        : list.map(function (c, i) {
          var before = textBefore(h, h.commits.indexOf(c) + 1);
          return html`<section class="df-each" key=${c.sha}><${Commit} c=${c} />${before == null ? html`<div class="kempty">이전 판이 없습니다</div>` : html`<${Diff} a=${before} b=${h.texts[c.t]} />`}</section>`;
        })}`;
  };

  /* 행 끝 아이콘: 바뀐 점 서랍 열기 */
  DS.DiffGo = function (props) {
    if (!DS.hasHist(DS.db)) return null;
    return html`<button type="button" class="go df-go" title="바뀐 점 보기" aria-label="바뀐 점 보기" onClick=${function (e) { e.preventDefault(); DS.emit("drawer", { kind: "diff", page: props.page }); }}><${DS.Icon} paths=${DS.ICON.diff} size=${14} /></button>`;
  };
})();
