/* 검색 창 (머리 줄 돋보기 · ⌘K): 화면 가운데 큰 창. 종류 칩으로 거르고, 결과마다 「탭 › 기능 › 문서」 위치를 보인다.
   찾는 곳: 정의 ID(앞부분) · 문서 제목 · 소제목 · 본문(MiniSearch, 낱말 앞부분 · 오타 조금) + 프로젝트 사이트는 빌드 DB(기능 · 수용 기준 · API · 화면 · 이슈 · 게시판 · 자료 · 화면 이름).
   제목 색인은 assets/search.js(DS_SEARCH), 본문 색인은 assets/search-text.js(DS_TEXT) 를 처음 열 때 읽는다. 빈 검색어면 최근 본 문서 */
(function () {
  "use strict";
  var DS = window.DS, html = DS.html, H = DS.hooks;
  var NAV = window.DS_NAV || {};
  var MAX = 40;
  var mini = null, miniLoad = null;

  function textIndex() {
    if (mini) return Promise.resolve(mini);
    if (!miniLoad) miniLoad = DS.script("assets/search-text.js", function () { return !!window.DS_TEXT; }).then(function () {
      var docs = (window.DS_TEXT || []).map(function (x, i) { return { id: i, u: x.u, h: x.h, t: x.t, x: x.x }; });
      mini = new window.MiniSearch({ fields: ["t", "x"], storeFields: ["u", "h", "t", "x"] });
      mini.addAll(docs);
      return mini;
    });
    return miniLoad;
  }

  function snippet(text, terms) {
    var low = text.toLowerCase(), at = -1, len = 0;
    terms.forEach(function (t) { var i = low.indexOf(t); if (i >= 0 && (at < 0 || i < at)) { at = i; len = t.length; } });
    if (at < 0) return [text.slice(0, 90)];
    var a = Math.max(0, at - 36), b = Math.min(text.length, at + len + 54);
    return [(a ? "…" : "") + text.slice(a, at), html`<mark>${text.slice(at, at + len)}</mark>`, text.slice(at + len, b) + (b < text.length ? "…" : "")];
  }

  /* ID 종류 → 칩 */
  var KIND_OF = { FN: "명세", REQ: "명세", DEC: "명세", POL: "명세", Q: "명세", BR: "명세", API: "API", SCR: "화면", AC: "테스트", TC: "테스트", TS: "테스트", ISSUE: "이슈", TABLE: "데이터" };
  function idKind(id, db) {
    var x = db && db.ids && db.ids[id];
    var k = x ? x.kind : String(id).split("-")[0];
    return DS.project ? KIND_OF[k] || "명세" : "ID";
  }
  /* 위치 줄: 탭 › 기능 › 문서 */
  function crumbOf(page, db, extra) {
    var tab = DS.tabOf(page) || "", f = DS.featureOf(db, page);
    var parts = [tab];
    if (f) parts.push(f.no + " " + (f.name || f.title)); else parts.push(DS.titleOf(page));
    if (extra) parts.push(extra);
    return parts.filter(Boolean).join(" › ");
  }

  /* DB · 메뉴로 만든 색인 (한 번) */
  var dbIndex = null, dbIndexOf = null;
  function fromDb(db) {
    if (dbIndexOf === db && dbIndex) return dbIndex;
    var out = [];
    var walk = function (items, tab) { (items || []).forEach(function (x) { if (x.items) walk(x.items, tab); else if (x.v && !x.hide) out.push({ href: DS.url(x.p), t: x.t, c: tab + " › " + x.t, k: "메뉴" }); }); };
    (NAV.groups || []).forEach(function (g) { walk(g.items, g.group); });
    (NAV.me || []).forEach(function (x) { out.push({ href: DS.url(x.p), t: x.t, c: "나 › " + x.t, k: "메뉴" }); });
    if (db) {
      (db.features || []).forEach(function (f) {
        var fc = "기능 › " + f.no + " " + (f.name || f.title);
        (f.fn || []).forEach(function (x) { out.push({ href: DS.url(f.page) + "#" + encodeURIComponent(x.id), t: x.text, id: x.id, c: fc + " › 명세", k: "명세" }); });
        (f.ac || []).forEach(function (x) { out.push({ href: DS.url(f.page) + "#" + encodeURIComponent(x.id), t: x.text, id: x.id, c: fc + " › 검증", k: "테스트" }); });
      });
      Object.keys(db.ids || {}).forEach(function (id) {
        var x = db.ids[id];
        if (x.kind === "FN" || x.kind === "AC") return;
        var href = DS.idHref(db, id);
        if (!href) return;
        out.push({ href: href, t: x.title && x.title !== id ? x.title : id, id: id, c: x.kind === "ISSUE" ? "이슈 › 열린 이슈" : x.kind === "TABLE" ? "설계 › 데이터 › " + id : x.page ? crumbOf(x.page, db) : "", k: idKind(id, db), ext: x.kind === "ISSUE" });
      });
      (db.board || []).forEach(function (b) { out.push({ href: DS.url("_/board/post.html") + "?id=" + encodeURIComponent(b.id), t: b.title, id: b.pinned ? "공지" : b.id, c: "자료실 › 게시판", k: "자료" }); });
      (db.files || []).forEach(function (f) { out.push({ href: DS.url(f.path), t: f.name, id: String(f.kind || "").toUpperCase(), c: "자료실 › 참고 문서", k: "자료", ext: true }); });
    }
    dbIndex = out; dbIndexOf = db;
    return out;
  }

  function find(v, kind, db) {
    var S = window.DS_SEARCH || { pages: [], ids: [] }, out = [], seen = {};
    var add = function (h) { if (out.length >= MAX || seen[h.href]) return; if (kind !== "전체" && h.k !== kind) return; seen[h.href] = 1; out.push(h); };
    var low = v.toLowerCase();
    var dbx = DS.project ? fromDb(db) : [];
    /* ① ID 앞부분 */
    dbx.forEach(function (x) { if (x.id && String(x.id).toLowerCase().indexOf(low) === 0) add(x); });
    S.ids.forEach(function (x) { if (x[0].toLowerCase().indexOf(low) === 0) add({ href: DS.url(x[1]), t: x[2] || x[0], id: x[0], c: crumbOf(x[1].split("#")[0], db), k: idKind(x[0], db) }); });
    /* ② 제목 */
    var titleOf = {};
    S.pages.forEach(function (p) {
      titleOf[p.u] = p;
      if ((p.t + " " + p.g).toLowerCase().indexOf(low) >= 0) add({ href: DS.url(p.u), t: p.t, c: crumbOf(p.u, db), k: DS.project && DS.tabOf(p.u) === "자료실" ? "자료" : "문서" });
    });
    dbx.forEach(function (x) { if ((x.t + " " + (x.c || "")).toLowerCase().indexOf(low) >= 0) add(x); });
    /* ③ 소제목 */
    S.pages.forEach(function (p) {
      p.h.forEach(function (h) { if (h[1].toLowerCase().indexOf(low) >= 0) add({ href: DS.url(p.u) + "#" + h[0], t: h[1], c: crumbOf(p.u, db), k: "문서" }); });
    });
    /* ④ 본문 */
    if (mini && out.length < MAX) {
      var terms = low.split(/\s+/).filter(Boolean);
      mini.search(v, { prefix: true, fuzzy: function (t) { return t.length > 4 ? 0.2 : false; }, boost: { t: 2 }, combineWith: "AND" }).slice(0, MAX).forEach(function (r) {
        add({ href: DS.url(r.u) + (r.h ? "#" + r.h : ""), t: r.h ? r.t : (titleOf[r.u] || { t: r.u }).t, c: crumbOf(r.u, db, r.h ? r.t : ""), k: "본문", x: snippet(r.x, terms.concat(Object.keys(r.match || {}))) });
      });
    }
    return out;
  }

  DS.SearchDialog = function SearchDialog(props) {
    var db = props.db;
    var q = H.useState(""), v = q[0], setV = q[1];
    var s = H.useState(0), sel = s[0], setSel = s[1];
    var ks = H.useState("전체"), kind = ks[0], setKind = ks[1];
    var r = H.useState(0), bump = r[1];
    var input = H.useRef(null), list = H.useRef(null);
    H.useLayoutEffect(function () { if (input.current) input.current.focus(); }, []);
    H.useEffect(function () { textIndex().then(function () { bump(function (n) { return n + 1; }); }, function () {}); }, []);
    var chips = DS.project ? ["전체", "명세", "API", "화면", "데이터", "테스트", "이슈", "자료", "문서", "본문"] : ["전체", "문서", "ID", "본문"];
    var hits = H.useMemo(function () {
      if (v.trim()) return find(v.trim(), kind, db);
      return (DS.my.get("recent", []) || []).slice(0, 8).map(function (p) { return { href: DS.url(p), t: DS.titleOf(p), c: crumbOf(p, db), k: "최근" }; });
    }, [v, kind, r[0], db]);
    H.useEffect(function () { var on = list.current && list.current.querySelector(".sp-item.on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" }); }, [sel]);
    function pick(h) { props.onClose(); if (h.ext) window.open(h.href, "_blank", "noopener"); else DS.go(h.href); }
    function onKey(e) {
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && hits.length) { e.preventDefault(); setSel((sel + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length); }
      else if (e.key === "Enter" && hits[sel]) { e.preventDefault(); pick(hits[sel]); }
      else if (e.key === "Escape") { e.preventDefault(); props.onClose(); }
    }
    return html`<div class="sp-veil" onMouseDown=${function (e) { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="sp" role="dialog" aria-modal="true" aria-label="검색">
        <div class="sp-in"><${DS.Icon} paths=${DS.ICON.search} />
          <input id="q" ref=${input} value=${v} placeholder="검색" autocomplete="off" aria-label="검색어" onInput=${function (e) { setV(e.currentTarget.value); setSel(0); }} onKeyDown=${onKey} />
          <kbd>Esc</kbd></div>
        <div class="chips" role="group" aria-label="종류">${chips.map(function (c) { return html`<button type="button" key=${c} class="chip" aria-pressed=${c === kind} onClick=${function () { setKind(c); setSel(0); if (input.current) input.current.focus(); }}>${c}</button>`; })}</div>
        <div class="sp-list" id="results" ref=${list}>
          ${hits.length ? hits.map(function (h, i) {
            return html`<a key=${h.href + i} href=${h.href} class=${"sp-item" + (i === sel ? " on" : "")} onMouseMove=${function () { if (sel !== i) setSel(i); }} onClick=${function (e) { if (e.button || e.metaKey || e.ctrlKey) return; e.preventDefault(); pick(h); }}>
              <span class="t">${h.t}</span>${h.id ? html`<span class="idc">${h.id}</span>` : null}
              <span class="c"><span class="kind">${h.k}</span>${h.c}</span>
              ${h.x ? html`<span class="snip">${h.x}</span>` : null}</a>`;
          }) : html`<div class="sp-empty">${v.trim() ? (mini || !miniLoad ? "맞는 문서가 없습니다. 다른 낱말이나 ID 로 찾아 보세요" : "본문 색인을 읽는 중…") : "검색어를 넣으세요. 제목 · 본문 · ID 를 찾습니다"}</div>`}
        </div>
        <div class="sp-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> 이동</span><span><kbd>Enter</kbd> 열기</span><span>위치는 탭 › 기능 › 문서</span></div>
      </div>
    </div>`;
  };
})();
