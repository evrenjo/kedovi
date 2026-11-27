/* 생성물: kedovi docs build. 원본은 킷의 packs/core/assets/docs-site/src/ (+ 공통 부품 packs/core/assets/docs-site/shared/) (손으로 고치지 않는다) */
/* ── 10-sidehead.js ── */
/* 사이드바 머리 줄 (문서 사이트 · ERD 뷰어 공통 부품): 왼쪽 = 제목(문서는 「홈」 링크, ERD 는 「테이블 n」), 오른쪽 = 모두 접기 ↔ 모두 펴기 토글 하나.
   펼친 묶음이 하나라도 있으면 「모두 접기」, 모두 접혀 있으면 「모두 펴기」 (아이콘 · 툴팁이 다음 동작). 생성기가 site.js · erd.js 앞에 같이 넣는다.
   아이콘: Lucide house · chevrons-down-up · chevrons-up-down (ISC) */
(function () {
  "use strict";
  var h = window.preact.h, html = window.htm.bind(h);
  var svg = function (d) { return html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: d }}></svg>`; };
  var I = {
    home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    fold: '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>',
    unfold: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>'
  };
  /** props: { label, href?, home?, current?, anyOpen, onToggle(open) } */
  window.SideHead = function SideHead(props) {
    var title = props.href
      ? html`<a class=${"side-head-title" + (props.current ? " on" : "")} href=${props.href} aria-current=${props.current ? "page" : undefined}>${props.home ? svg(I.home) : null}<span>${props.label}</span></a>`
      : html`<span class="side-head-title">${props.label}</span>`;
    var tip = props.anyOpen ? "모두 접기" : "모두 펴기";
    return html`<div class="side-head">${title}<button type="button" class="side-head-btn" title=${tip} aria-label=${tip} onClick=${function () { props.onToggle(!props.anyOpen); }}>${svg(props.anyOpen ? I.fold : I.unfold)}</button></div>`;
  };
})();
/* ── 00-core.js ── */
/* 문서 사이트 앱 (kedovi docs build · kedovi board · 킷 가이드 공통). 생성기가 src/*.js 를 이름 순으로 이어 assets/site.js 하나로 만든다.
   화면은 Preact + htm (assets/vendor.js, 빌드 없음). 쪽마다 본문 HTML(.ds-body)과 쪽 정보(script#ds-page)가 있고,
   앱이 그 둘로 화면 전체를 그린다. 다른 쪽으로 갈 때는 그 쪽 파일을 읽어 둘만 꺼내 바꾼다 (새로고침 없음, file:// 에서는 새로 연다).
   여기: 이름공간 DS · 공통 도구 (주소 · 저장 · 이스케이프 · 알림) */
(function () {
  "use strict";
  var DS = window.DS = window.DS || {};
  var P = window.preact;
  DS.h = P.h;
  DS.render = P.render;
  DS.html = window.htm.bind(P.h);
  DS.hooks = window.preactHooks;

  /* 사이트 맨 위 주소: 이 스크립트(assets/site.js)의 한 단계 위. 쪽마다 깊이가 달라도, 하위 경로(/그룹/repo/)에 올려도 같다 */
  var me = document.currentScript && document.currentScript.src;
  DS.root = me ? new URL("../", me).href : new URL(document.body.getAttribute("data-root") || "./", location.href).href;
  DS.url = function (p) { return new URL(p, DS.root).href; };
  /* 주소 → 사이트 안 쪽 경로 (index.html 생략 · # · ? 뺌). 사이트 밖이면 null */
  DS.pageOf = function (href) {
    var u;
    try { u = new URL(href, location.href); } catch (e) { return null; }
    var base = new URL(DS.root);
    if (u.origin !== base.origin || u.pathname.indexOf(base.pathname) !== 0) return null;
    var p = u.pathname.slice(base.pathname.length);
    try { p = decodeURIComponent(p); } catch (e) { /* 그대로 */ }
    if (!p || /\/$/.test(p)) p += "index.html";
    return p;
  };
  DS.file = location.protocol === "file:";
  try { DS.embedded = window.self !== window.top; } catch (e) { DS.embedded = true; }   /* 화면설계서 · ERD 근거 패널(iframe) 안 = 본문만 */
  if (DS.embedded) document.documentElement.classList.add("embedded");

  DS.esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };
  /* 이 기기 저장: 사생활 창 · 막힌 저장소에서도 화면은 그대로 */
  DS.load = function (k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } };
  DS.keep = function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 못 함 */ } };

  /* 알림: page(새 쪽을 그린 뒤 { el, meta }) · theme. docs-site.extra.js 도 DS.on("page", fn) 으로 쪽마다 돈다 */
  var subs = {};
  DS.on = function (name, fn) { (subs[name] = subs[name] || []).push(fn); };
  DS.off = function (name, fn) { subs[name] = (subs[name] || []).filter(function (f) { return f !== fn; }); };
  DS.emit = function (name, arg) { (subs[name] || []).forEach(function (fn) { try { fn(arg); } catch (e) { if (window.console) console.error(e); } }); };

  /* 스크립트 하나 읽기 (file:// 에서도 된다): 검색 색인 · mermaid */
  var scripts = {};
  DS.script = function (p, check) {
    if (check && check()) return Promise.resolve();
    if (!scripts[p]) scripts[p] = new Promise(function (ok, no) {
      var s = document.createElement("script");
      var v = ((window.DS_NAV || {}).v || {})[p];
      s.src = DS.url(p) + (v ? "?v=" + v : "");   /* 다시 만든 파일은 주소가 바뀐다 (옛 캐시를 쓰지 않게) */
      s.onload = function () { ok(); };
      s.onerror = function () { delete scripts[p]; no(new Error(p + " 가 없습니다 (kedovi docs build 로 다시 만든다)")); };
      document.head.appendChild(s);
    });
    return scripts[p];
  };

  /* 선 아이콘 한 벌 (Lucide, ISC). 머리 줄 · 메뉴 · 바로가기 모두 이것만 쓴다 */
  DS.ICON = {
    ink: '<path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    print: '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
    theme: '<circle cx="12" cy="12" r="10"/><path d="M12 18a6 6 0 0 0 0-12v12z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    go: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    note: '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>',
    download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
    upload: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>'
  };
  /* 선 아이콘 (Lucide, ISC). paths = SVG 경로 글자, size 기본 18 */
  DS.Icon = function (props) {
    var n = props.size || 18;
    return DS.h("svg", { viewBox: "0 0 24 24", width: n, height: n, fill: "none", stroke: "currentColor", "stroke-width": 1.75, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", dangerouslySetInnerHTML: { __html: props.paths } });
  };
  /* 바로가기: 행 · 카드 오른쪽 끝의 화살표 링크 하나 (행 전체를 링크로 만들지 않는다). ext = 사이트 밖 (새 창) */
  DS.Go = function (props) {
    var label = props.label || "열기";
    if (!props.href) return null;
    return DS.h("a", { class: "go" + (props.cls ? " " + props.cls : ""), href: props.href, title: label, "aria-label": label, target: props.ext ? "_blank" : undefined, rel: props.ext ? "noopener" : undefined, onClick: props.onClick },
      DS.h(DS.Icon, { paths: props.ext ? DS.ICON.ext : DS.ICON.go, size: 14 }));
  };

  /* 날짜: ISO 문자열 → 「11-24」 · 「11-24 15:30」 · 「11월 24일」 (이 기기 시간대) */
  function d0(iso) { if (!iso) return null; var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + "T00:00:00" : iso); return isNaN(d) ? null : d; }
  var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
  DS.date = d0;
  DS.md = function (iso) { var d = d0(iso); return d ? p2(d.getMonth() + 1) + "-" + p2(d.getDate()) : ""; };
  DS.mdhm = function (iso) { var d = d0(iso); return d ? DS.md(iso) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) : ""; };
  DS.kday = function (iso) { var d = d0(iso); return d ? (d.getMonth() + 1) + "월 " + d.getDate() + "일" : ""; };
  /* 주소의 ?이름= 값 (가상 화면이 대상을 고를 때) */
  DS.param = function (k) { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } };
})();
/* ── 10-router.js ── */
/* 쪽 이동: 사이트 안 링크를 누르면 그 쪽 파일을 읽어 쪽 정보 · 본문만 꺼내 바꾼다 (주소는 history 로).
   못 옮기는 곳(화면설계서 · ERD 뷰어 · 사이트 밖 · file://)이나 읽기에 실패하면 브라우저가 그냥 연다.
   뒤로 · 앞으로 가기는 그 쪽의 스크롤 위치로 돌아간다 */
(function () {
  "use strict";
  var DS = window.DS;
  var NAV = window.DS_NAV || { groups: [], pages: [] };
  var routable = {};
  (NAV.pages || []).forEach(function (p) { routable[p] = true; });
  var cache = {};

  /* 문서(쪽 파일) → { meta, body } */
  DS.readDoc = function (doc) {
    var m = doc.getElementById("ds-page"), b = doc.querySelector(".ds-body");
    if (!m || !b) return null;
    var meta;
    try { meta = JSON.parse(m.textContent); } catch (e) { return null; }
    return { meta: meta, body: b.innerHTML };
  };
  /* 쪽 경로 → Promise<{ meta, body }> (한 번 읽은 쪽은 기억) */
  DS.fetchPage = function (page) {
    if (!cache[page]) cache[page] = fetch(DS.url(page), { credentials: "same-origin", cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(r.status + " " + page);
      return r.text();
    }).then(function (t) {
      var d = DS.readDoc(new DOMParser().parseFromString(t, "text/html"));
      if (!d) throw new Error("쪽 정보가 없습니다: " + page);
      return d;
    }).catch(function (e) { delete cache[page]; throw e; });
    return cache[page];
  };
  DS.canRoute = function (href) {
    if (DS.file || !window.fetch || !window.history.pushState) return false;
    var p = DS.pageOf(href);
    return !!(p && routable[p]);
  };

  var listeners = [];
  /* 앱이 듣는다: fn({ meta, body }, { hash, y }) */
  DS.onRoute = function (fn) { listeners.push(fn); };
  var seq = 0;
  function show(d, opt) { listeners.forEach(function (fn) { fn(d, opt); }); }
  function remember() { try { history.replaceState({ ds: 1, y: window.scrollY }, ""); } catch (e) { /* 막힘 */ } }

  /* 주소로 간다. push = 새 기록 (뒤로 가기용) */
  DS.go = function (href, push) {
    if (push === undefined) push = true;
    var u = new URL(href, location.href);
    if (!DS.canRoute(u.href)) { location.assign(u.href); return; }
    var page = DS.pageOf(u.href), my = ++seq;
    document.documentElement.classList.add("ds-loading");
    DS.fetchPage(page).then(function (d) {
      if (my !== seq) return;
      document.documentElement.classList.remove("ds-loading");
      if (push) { remember(); history.pushState({ ds: 1, y: 0 }, "", u.href); }
      show(d, { hash: u.hash, y: push ? 0 : (history.state && history.state.y) || 0 });
    }, function () {
      if (my === seq) location.assign(u.href);
    });
  };
  /* 미리 읽기: 링크에 올리면 (누를 때 기다리지 않게) */
  DS.prefetch = function (href) { if (DS.canRoute(href)) DS.fetchPage(DS.pageOf(href)).catch(function () {}); };

  /* 링크 누름: 새 창 · 수정키 · 받기 · 같은 쪽 #이동은 브라우저에 맡긴다 */
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    var u = new URL(a.href, location.href);
    if (u.origin === location.origin && u.pathname === location.pathname && u.search === location.search) {
      if (!u.hash && DS.canRoute(u.href)) { e.preventDefault(); window.scrollTo(0, 0); }   /* 지금 쪽 다시 누름 = 맨 위로 (다시 읽지 않는다) */
      return;   /* #이동은 브라우저가 */
    }
    if (!DS.canRoute(u.href)) return;
    e.preventDefault();
    DS.go(u.href);
  });
  var hoverT = 0;
  document.addEventListener("mouseover", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    clearTimeout(hoverT);
    hoverT = setTimeout(function () { DS.prefetch(a.href); }, 80);
  });
  window.addEventListener("popstate", function () {
    if (DS.canRoute(location.href)) DS.go(location.href, false);
  });
  /* 떠날 때 · 스크롤을 멈출 때 지금 위치를 기록 (뒤로 가기로 돌아오면 그 자리) */
  var st = 0;
  window.addEventListener("scroll", function () { clearTimeout(st); st = setTimeout(remember, 150); }, { passive: true });
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
})();
/* ── 12-data.js ── */
/* 프로젝트 사이트 데이터: 빌드 DB(assets/site-db.json, 모두 같은 데이터) · 연결 상태(로컬 kedovi 서버인지) · 개인 저장(이 브라우저만).
   킷 문서 사이트(project 아님)는 DB 를 읽지 않는다. 개인 저장은 localStorage (막혀 있어도 화면은 그대로), 내보내기 · 가져오기 = JSON 파일 하나 */
(function () {
  "use strict";
  var DS = window.DS, H = DS.hooks;
  var NAV = window.DS_NAV || {};
  DS.project = !!NAV.project;

  /* ── 개인 저장 ── 키: last(지난 방문) · seen{쪽: 확인한 때} · star[쪽] · recent[쪽] · views[{name, p}] · memo{쪽: 글} · read{멘션: 1} · notice{글: 1} · me · token{gitlab, github} */
  var NS = "kedovi-site:" + (NAV.key || "") + ":";
  var KEYS = ["last", "seen", "star", "recent", "views", "memo", "read", "notice", "me", "token"];
  DS.my = {
    get: function (k, d) { return DS.load(NS + k, d); },
    set: function (k, v) { DS.keep(NS + k, v); DS.emit("my", k); },
    dump: function () { var o = {}; KEYS.forEach(function (k) { var v = DS.load(NS + k, null); if (v != null && k !== "token") o[k] = v; }); return { kedoviSite: NAV.key || "", at: new Date().toISOString(), data: o }; },
    restore: function (j) {
      if (!j || typeof j.data !== "object") throw new Error("kedovi 사이트 내보내기 파일이 아닙니다");
      KEYS.forEach(function (k) { if (k !== "token" && k in j.data) DS.keep(NS + k, j.data[k]); });
      DS.emit("my", "*");
    }
  };
  /* 개인 값 하나를 쓰는 화면: 바뀌면 다시 그린다 */
  DS.useMy = function (k, d) {
    var s = H.useState(0), bump = s[1];
    H.useEffect(function () {
      var f = function (x) { if (x === k || x === "*") bump(function (n) { return n + 1; }); };
      DS.on("my", f);
      return function () { DS.off("my", f); };
    }, [k]);
    return DS.my.get(k, d);
  };

  /* 지난 방문 이후: 이 탭(세션)이 시작될 때의 지난 방문 시각. 처음 온 사람은 비교하지 않는다 (모두 「새로」 가 되지 않게) */
  DS.since = (function () {
    var s = null;
    try { s = sessionStorage.getItem(NS + "since"); } catch (e) { /* 막힘 */ }
    if (s == null) {
      var last = DS.my.get("last", null);
      s = last || "";
      try { sessionStorage.setItem(NS + "since", s); } catch (e) { /* 막힘 */ }
    }
    if (DS.project) DS.keep(NS + "last", new Date().toISOString());
    return s || null;
  })();
  /* 지난 방문 이후 바뀐 쪽인가 (확인함을 누른 쪽은 그때보다 뒤에 바뀐 것만) */
  DS.isNew = function (page, at) {
    if (!DS.since || !at || at <= DS.since) return false;
    var seen = DS.my.get("seen", {})[page];
    return !(seen && at <= seen);
  };
  DS.markSeen = function (page, at) { var s = DS.my.get("seen", {}); s[page] = at || new Date().toISOString(); DS.my.set("seen", s); };

  /* ── 빌드 DB ── */
  DS.db = null;   /* null = 읽는 중 · false = 없음 · 객체 */
  var dbSeq = 0;
  DS.dbLoad = function () {
    if (!DS.project) { DS.db = false; return Promise.resolve(false); }
    var my = ++dbSeq;
    var src = DS.url("assets/site-db.json") + "?t=" + Date.now();
    var p = window.fetch ? fetch(src, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }) : Promise.reject(new Error("fetch 없음"));
    return p.then(function (j) { if (my === dbSeq) { DS.db = j && j.version >= 2 ? j : false; DS.emit("db", DS.db); } return DS.db; },
      function () { if (my === dbSeq && DS.db == null) { DS.db = false; DS.emit("db", false); } return DS.db; });
  };
  DS.useDb = function () {
    var s = H.useState(DS.db), set = s[1];
    H.useEffect(function () { var f = function (d) { set(d); }; DS.on("db", f); set(DS.db); return function () { DS.off("db", f); }; }, []);
    return s[0];
  };

  /* ── 연결 상태 ── local = kedovi 로컬 서버(/_api/whoami 가 답함) · pages = 정적 사이트 · file = 이 PC 파일 */
  DS.conn = { mode: DS.file ? "file" : null, who: null };
  DS.connLoad = function () {
    /* 로컬 서버는 이 PC 주소에서만 뜬다: 다른 주소(Pages)에서는 묻지 않는다 (콘솔에 404 가 남지 않게) */
    var localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (!DS.project || DS.file || !window.fetch || !localHost) { DS.conn = { mode: DS.file ? "file" : "pages", who: null }; DS.emit("conn", DS.conn); return Promise.resolve(DS.conn); }
    return fetch(DS.url("_api/whoami"), { cache: "no-store" }).then(function (r) {
      if (!r.ok || !/json/.test(r.headers.get("content-type") || "")) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      DS.conn = j && j.ok ? { mode: "local", who: j } : { mode: "pages", who: null };
    }, function () { DS.conn = { mode: "pages", who: null }; }).then(function () { DS.emit("conn", DS.conn); return DS.conn; });
  };
  DS.useConn = function () {
    var s = H.useState(DS.conn), set = s[1];
    H.useEffect(function () { var f = function (c) { set(c); }; DS.on("conn", f); set(DS.conn); return function () { DS.off("conn", f); }; }, []);
    return s[0];
  };
  /* 보는 사람 아이디: 로컬 서버면 이 PC 의 아이디, 아니면 이 브라우저에서 고른 값 */
  DS.meId = function () {
    var w = DS.conn.who;
    if (w && w.me && w.me.id) return w.me.id;
    return DS.my.get("me", "") || "";
  };
  DS.member = function (db, id) { return ((db && db.team && db.team.members) || []).find(function (m) { return m.id === id; }) || null; };

  /* ── DB 도우미 ── */
  DS.featureOf = function (db, page) { return db ? (db.features || []).find(function (f) { return f.page === page; }) || null : null; };
  DS.stageIdx = function (db, f) { var st = (db && db.stages) || []; return st.indexOf(f.stage); };
  /* 단계 칸 상태: 끝난 단계 · 지금 단계 · 남은 단계. 마지막 단계(배포)에 이르면 모두 끝남 */
  DS.stageState = function (db, f, i) {
    var st = (db && db.stages) || [], k = st.indexOf(f.stage);
    if (k < 0) return "wait";
    if (k === st.length - 1) return "done";
    return i < k ? "done" : i === k ? "cur" : "wait";
  };
  DS.featDone = function (db, f) { var st = (db && db.stages) || []; return st.length && f.stage === st[st.length - 1]; };
  /* 관계 칸: 웹 기본 + 프로필(분야)이 더한 밸런스 표 · 인터페이스 · 보드 판 · 위험 */
  DS.REL_KEYS = ["req", "api", "scr", "tables", "ac", "dec", "issues", "bal", "ifs", "hw", "risks"];
  /* 프로필 (빌드 DB profile, 없으면 null = 지금 화면 그대로) */
  DS.profileOf = function (db) { var p = db && db.profile; return p && typeof p === "object" ? p : null; };
  /* 검증 단계 결과 한 칸 → 끝남 · 실패 · 지금 · 남음 */
  DS.tierKind = function (t) { return t && t.result ? DS.resultKind(t.result) : "wait"; };
  /* 기능 하나의 검증 단계 줄: 프로필 단계 순서대로 + 기능에만 있는 단계 */
  DS.tierRows = function (db, f) {
    var p = DS.profileOf(db), have = (f && f.tiers) || [], out = [];
    ((p && p.tiers) || []).forEach(function (name) { out.push(have.find(function (t) { return t.tier === name; }) || { tier: name, result: "", where: "" }); });
    have.forEach(function (t) { if (!out.some(function (o) { return o.tier === t.tier; })) out.push(t); });
    return out;
  };
  /* ID → 그 ID 가 이어진 기능 ID 들 (FN 이면 자기, 아니면 관계에서 거꾸로) */
  DS.fnsOf = function (db, id) {
    var rel = (db && db.relations) || {};
    if (rel[id]) return [id];
    return Object.keys(rel).filter(function (fn) {
      var r = rel[fn];
      return DS.REL_KEYS.some(function (k) { return (r[k] || []).indexOf(id) >= 0; });
    });
  };
  DS.fnFeature = function (db, fn) { return (db.features || []).find(function (f) { return (f.fn || []).some(function (x) { return x.id === fn; }); }) || null; };
  /* ID 의 바로가기 주소: 테이블 → 테이블 화면, 화면 → 화면 상세, 이슈 → 원격, 그 밖 → 정의 쪽#ID */
  DS.idHref = function (db, id) {
    var x = db && db.ids && db.ids[id];
    if (x && x.kind === "TABLE") return DS.url("_/table.html") + "?id=" + encodeURIComponent(id);
    if (x && x.kind === "SCR") return DS.url("_/screen.html") + "?id=" + encodeURIComponent(id);
    if (x && x.kind === "ISSUE") { var it = ((db.issues || {}).items || []).find(function (i) { return i.id === id; }); return it && it.url ? it.url : null; }
    if (x && x.page) return DS.url(x.page) + "#" + encodeURIComponent(id);
    return null;
  };
  /* 쪽 경로 → 사람이 읽는 이름 (메뉴 · DB 문서 · 기능) */
  DS.titleOf = function (page) {
    var hit = null, qi = String(page).indexOf("?");
    if (qi >= 0) { var id = null; try { id = new URLSearchParams(page.slice(qi)).get("id"); } catch (e) { /* 그대로 */ } return DS.titleOf(page.slice(0, qi)) + (id ? " · " + id : ""); }
    (function walk(items) { (items || []).forEach(function (x) { if (hit) return; if (x.items) walk(x.items); else if (x.p === page) hit = x.t; }); })((NAV.groups || []).reduce(function (a, g) { return a.concat(g.items); }, []).concat(NAV.me || []));
    if (hit) return hit;
    var d = DS.db && (DS.db.docs || []).find(function (x) { return x.page === page; });
    return d ? d.title : page.replace(/\.html$/, "");
  };
  /* 멘션: 의견 · 게시판 글 · 댓글 가운데 「@아이디」 가 든 것 */
  DS.mentionsOf = function (db, me) {
    if (!db || !me) return [];
    var at = new RegExp("@" + me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w.-])"), out = [];
    Object.keys(db.comments || {}).forEach(function (p) {
      (db.comments[p] || []).forEach(function (c) { if (at.test(c.text || "")) out.push({ key: p + "|" + (c.id || c.at), who: c.who, at: c.at, quote: c.quote, text: c.text, page: p, href: DS.url(p) }); });
    });
    (db.board || []).forEach(function (b) {
      var href = DS.url("_/board/post.html") + "?id=" + encodeURIComponent(b.id);
      if (at.test(b.body || "")) out.push({ key: "board|" + b.id, who: b.author, at: b.at, text: b.body, title: b.title, href: href });
      (b.comments || []).forEach(function (c, i) { if (at.test(c.text || "")) out.push({ key: "board|" + b.id + "|" + i, who: c.who, at: c.at, text: c.text, title: b.title, href: href }); });
    });
    return out.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  };

  if (DS.project) { DS.dbLoad(); DS.connLoad(); }
})();
/* ── 16-write.js ── */
/* 쓰기 경로 (의견 · 게시판 글 · 이슈). 연결 상태마다 다르다:
   local = kedovi 로컬 서버가 대신 쓴다 (POST /_api/*, 원격이 있으면 원격에, 없으면 파일 + git 커밋, 뒤에 사이트를 다시 만든다)
   api   = 정적 사이트(Pages) + 이 브라우저에 넣은 토큰: GitLab · GitHub API 를 바로 부른다
   open  = 토큰이 없으면 원격의 그 이슈 · 새 이슈 화면을 새 창으로 연다
   none  = 원격도 로컬 서버도 없으면 쓰기 단추 없이 안내 한 줄 */
(function () {
  "use strict";
  var DS = window.DS;

  function remoteOf(db) { var r = db && db.remote; return r && r.kind && r.web ? r : null; }
  DS.token = function (db) { var r = remoteOf(db); return r ? (DS.my.get("token", {}) || {})[r.kind] || "" : ""; };
  DS.writeMode = function (db) {
    if (DS.conn.mode === "local" && (!DS.conn.who || DS.conn.who.canWrite !== false)) return "local";
    var r = remoteOf(db);
    if (!r) return "none";
    return DS.token(db) && r.api ? "api" : "open";
  };
  DS.remoteName = function (db) { var r = remoteOf(db); return r ? (r.kind === "github" ? "GitHub" : "GitLab") : ""; };
  /* 쓰기 방식 설명 한 줄 */
  DS.writeNote = function (db, what) {
    var m = DS.writeMode(db), rn = DS.remoteName(db);
    if (m === "local") return "이 PC 의 kedovi 서버가 저장합니다" + (DS.conn.who && DS.conn.who.where === "remote" ? " (" + (rn || "원격") + " " + what + ")" : " (파일 · git 커밋)") + ". 저장 뒤 사이트를 다시 만듭니다";
    if (m === "api") return rn + " " + what + "로 바로 저장합니다. 사이트에는 다음 빌드에 보입니다";
    if (m === "open") return rn + " 화면이 새 창으로 열립니다. 나 › 알림 · 보기 설정에서 토큰을 넣으면 여기서 바로 씁니다";
    return "원격을 붙이면(kedovi remote add) 여기서 쓸 수 있습니다. 로컬 사이트(kedovi docs serve)에서는 바로 씁니다";
  };

  function api(db, method, path, body) {
    var r = remoteOf(db), tok = DS.token(db);
    var h = { "content-type": "application/json" };
    if (r.kind === "github") { h.authorization = "Bearer " + tok; h.accept = "application/vnd.github+json"; }
    else h["private-token"] = tok;
    return fetch(String(r.api).replace(/\/+$/, "") + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new Error((r.kind === "github" ? "GitHub" : "GitLab") + " " + res.status + (j && j.message ? ": " + (typeof j.message === "string" ? j.message : JSON.stringify(j.message)) : ""));
        return j;
      });
    });
  }
  function proj(db) { var r = remoteOf(db); return r.kind === "github" ? "/repos/" + r.project : "/projects/" + encodeURIComponent(r.project); }
  /* 새 이슈 만들기 → { url, n } */
  function newIssue(db, title, body, labels) {
    var r = remoteOf(db);
    if (r.kind === "github") return api(db, "POST", proj(db) + "/issues", { title: title, body: body, labels: labels }).then(function (j) { return { url: j.html_url, n: j.number }; });
    return api(db, "POST", proj(db) + "/issues", { title: title, description: body, labels: labels.join(",") }).then(function (j) { return { url: j.web_url, n: j.iid }; });
  }
  function note(db, n, body) {
    var r = remoteOf(db);
    if (r.kind === "github") return api(db, "POST", proj(db) + "/issues/" + n + "/comments", { body: body }).then(function (j) { return j.html_url; });
    return api(db, "POST", proj(db) + "/issues/" + n + "/notes", { body: body }).then(function (j) { return r.web + "/-/issues/" + n + "#note_" + j.id; });
  }
  /* 원격 새 이슈 화면 주소 (제목 · 본문 · 라벨을 채워서) */
  function newIssueUrl(db, title, body, labels) {
    var r = remoteOf(db), e = encodeURIComponent;
    if (r.kind === "github") return r.web + "/issues/new?title=" + e(title) + "&body=" + e(body) + (labels.length ? "&labels=" + e(labels.join(",")) : "");
    return r.web + "/-/issues/new?issue[title]=" + e(title) + "&issue[description]=" + e(body + (labels.length ? "\n\n/label " + labels.map(function (l) { return "~\"" + l + "\""; }).join(" ") : ""));
  }
  var quoted = function (q, text) { return (q ? "> 「" + q + "」\n\n" : "") + text; };

  /**
   * kind: comment {page, title, quote, text} · board {title, body, pinned} · issue {title, body, ids}
   * → Promise<{ ok, url?, where, opened?, error? }>
   */
  DS.write = function (db, kind, x) {
    var m = DS.writeMode(db);
    if (m === "local") {
      var body = kind === "comment" ? { page: x.page, quote: x.quote || "", text: x.text } : kind === "board" ? { title: x.title, body: x.body, pinned: !!x.pinned } : { title: x.title, body: x.body, ids: x.ids || [] };
      return fetch(DS.url("_api/" + kind), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return { ok: false, error: "응답 " + r.status }; }); })
        .then(function (j) { if (j && j.ok) setTimeout(DS.dbLoad, 2500); return j || { ok: false }; }, function (e) { return { ok: false, error: e.message }; });
    }
    if (m === "none") return Promise.resolve({ ok: false, error: DS.writeNote(db) });
    var r = remoteOf(db);
    var pageUrl = x.page ? (r.pages ? String(r.pages).replace(/\/?$/, "/") + x.page : DS.url(x.page)) : "";
    var labels = kind === "comment" ? ["의견"] : kind === "board" ? (x.pinned ? ["게시판", "공지"] : ["게시판"]) : [];
    if (m === "open") {
      var url = kind === "comment" && (r.commentIssues || {})[x.page] ? r.commentIssues[x.page]
        : kind === "comment" ? newIssueUrl(db, "의견: " + (x.title || x.page), pageUrl + "\n\n" + quoted(x.quote, x.text), labels)
        : newIssueUrl(db, x.title, x.body + (x.ids && x.ids.length ? "\n\n관련: " + x.ids.join(" · ") : ""), labels);
      window.open(url, "_blank", "noopener");
      return Promise.resolve({ ok: false, opened: true, url: url, where: "remote" });
    }
    var p;
    if (kind === "comment") {
      var known = (r.commentIssues || {})[x.page], n = known && (/\/(?:issues|work_items)\/(\d+)/.exec(known) || [])[1];
      p = (n ? Promise.resolve({ n: n }) : newIssue(db, "의견: " + (x.title || x.page), pageUrl, labels)).then(function (iss) { return note(db, iss.n, quoted(x.quote, x.text)); });
    } else p = newIssue(db, x.title, x.body + (x.ids && x.ids.length ? "\n\n관련: " + x.ids.join(" · ") : ""), labels).then(function (iss) { return iss.url; });
    return p.then(function (url) { return { ok: true, url: url, where: "remote" }; }, function (e) { return { ok: false, error: e.message }; });
  };
})();
/* ── 20-nav.js ── */
/* 메뉴: docs-site.json 묶음 하나 = 상단 탭 하나, 왼쪽 메뉴 = 지금 탭의 문서 (+ 프로젝트 사이트의 가상 화면).
   프로젝트 사이트의 「기능」 탭은 빌드 DB 의 마일스톤별 묶음으로 (마일스톤 제목 오른쪽 끝에 바로가기), 「나」 는 머리 줄 이름 단추의 공간.
   폴더 접기는 사이트별로 기억 (지금 쪽이 든 폴더는 편다). 좁은 화면에서는 메뉴 단추로 여는 서랍 (탭 목록이 서랍 맨 위로) */
(function () {
  "use strict";
  var DS = window.DS, html = DS.html, H = DS.hooks;
  var NAV = window.DS_NAV || { groups: [] };
  var KEY = "kedovi-docs-nav:" + (NAV.key || "");

  function has(items, page) {
    return (items || []).some(function (x) { return x.items ? has(x.items, page) : x.p === page; });
  }
  function firstLeaf(items) {
    for (var i = 0; i < (items || []).length; i++) {
      var x = items[i];
      if (x.hide) continue;
      if (x.items) { var f = firstLeaf(x.items); if (f) return f; } else return x.p;
    }
    return null;
  }
  /* 쪽 → 탭 이름 (「나」 화면이면 「나」, 어느 탭에도 없으면 null) */
  DS.tabOf = function (page) {
    if ((NAV.me || []).some(function (x) { return x.p === page; })) return "나";
    var g = (NAV.groups || []).find(function (x) { return has(x.items, page); });
    return g ? g.group : null;
  };
  DS.tabs = function () { return (NAV.groups || []).map(function (g) { return { t: g.group, l: DS.tabLabel(g.group), p: firstLeaf(g.items) }; }).filter(function (x) { return x.p; }); };
  /* 탭 표시 이름: docs-site.json 묶음의 label, 없으면 빌드 DB 프로필(profile.labels), 그것도 없으면 묶음 이름. 경로 · 판단은 늘 묶음 이름으로 */
  DS.tabLabel = function (group) {
    var g = (NAV.groups || []).find(function (x) { return x.group === group; });
    var pl = DS.db && DS.db.profile && DS.db.profile.labels;
    return (g && g.label) || (pl && pl[group]) || group;
  };
  /* 이 유형의 중심 탭 (빌드 DB profile.mainTab) */
  DS.mainTab = function () { return (DS.db && DS.db.profile && DS.db.profile.mainTab) || null; };
  /* 메뉴 글자 바꾸기: 인터페이스 명세가 있으면 API 보기 화면 이름을 「인터페이스 명세」 로 (주소는 그대로) */
  DS.navTitle = function (x, db) { return x.v === "api" && db && (db.interfaces || []).length ? "인터페이스 명세" : x.t; };

  /* 이 쪽이 든 폴더 키들 */
  function pathTo(items, page) {
    var out = [];
    (function walk(list, keys) {
      return list.some(function (x) {
        if (x.items && x.dir) return walk(x.items, keys.concat(x.k));
        if (x.items) return walk(x.items, keys);
        if (x.p === page) { out = keys; return true; }
        return false;
      });
    })(items || [], []);
    return out;
  }
  function dirKeys(items) {
    var out = [];
    (function walk(list) { list.forEach(function (x) { if (x.items) { if (x.dir) out.push(x.k); walk(x.items); } }); })(items || []);
    return out;
  }

  var Chev = function () { return html`<svg class="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>`; };
  var NewB = function () { return html`<span class="newb">새로</span>`; };

  function Items(props) {
    return props.items.filter(function (x) { return !x.hide; }).map(function (x) {
      if (x.sec) return html`<div class="nav-sec-wrap" key=${x.k}><div class="nav-sec">${x.sec}</div><${Items} items=${x.items} isOpen=${props.isOpen} toggle=${props.toggle} cur=${props.cur} isNew=${props.isNew} db=${props.db} /></div>`;
      if (x.items) return html`<details class="nav-dir" key=${x.k} open=${props.isOpen(x.k)} onToggle=${props.toggle(x.k)}><summary><${Chev} />${x.dir}</summary><${Items} items=${x.items} isOpen=${props.isOpen} toggle=${props.toggle} cur=${props.cur} isNew=${props.isNew} db=${props.db} /></details>`;
      var on = x.p === props.cur;
      return html`<a key=${x.p} class=${"nav-link" + (on ? " on" : "")} href=${DS.url(x.p)} aria-current=${on ? "page" : undefined}><span class="nav-t">${DS.navTitle(x, props.db)}</span>${props.isNew(x.p) ? html`<${NewB} />` : null}</a>`;
    });
  }

  /* 기능 탭: 마일스톤별 묶음 (빌드 DB). 지금 기능은 아래에 명세 · 설계 · 검증 절 */
  function Features(props) {
    var db = props.db, cur = props.cur;
    var feats = db.features || [];
    var order = (db.milestones || []).map(function (m) { return m.name; });
    feats.forEach(function (f) { var m = f.milestone || ""; if (order.indexOf(m) < 0) order.push(m); });
    var other = (props.items || []).filter(function (x) { return !x.items && !feats.some(function (f) { return f.page === x.p; }); });
    return html`${other.length ? html`<div class="nav-sec-wrap"><${Items} items=${other} isOpen=${function () { return true; }} toggle=${function () { return function () {}; }} cur=${cur} isNew=${props.isNew} /></div>` : null}
      ${order.filter(function (m) { return feats.some(function (f) { return (f.milestone || "") === m; }); }).map(function (m) {
        return html`<div class="nav-sec-wrap" key=${m}><div class="nav-sec nav-ms"><span>${m || "마일스톤 정하지 않음"}</span>${m ? html`<${DS.Go} href=${DS.url("_/milestones.html") + "#ms-" + encodeURIComponent(m)} label="마일스톤 열기" />` : null}</div>
          ${feats.filter(function (f) { return (f.milestone || "") === m; }).map(function (f) {
            var on = f.page === cur, st = DS.featDone(db, f) ? "done" : DS.stageIdx(db, f) <= 0 ? "wait" : "cur";
            return html`<a key=${f.page} class=${"nav-link feat" + (on ? " on" : "")} href=${DS.url(f.page)} aria-current=${on ? "page" : undefined}><span class="num">${f.no}</span><span class="nav-t">${f.name || f.title}</span>${props.isNew(f.page) ? html`<${NewB} />` : null}<span class=${"dot " + st} title=${f.stage || "단계 없음"}></span></a>
              ${on && props.secs.length ? html`<div class="nav-sub">${props.secs.map(function (s) { return html`<a key=${s.sid} class="nav-link sub" href=${"#" + s.sid}>${s.text}</a>`; })}</div>` : null}`;
          })}
        </div>`;
      })}`;
  }

  DS.Nav = function Nav(props) {
    var cur = props.page, tab = props.tab, db = props.db;
    DS.useMy("seen", {});
    var g = tab === "나" ? { group: "나", items: (NAV.me || []).reduce(function (a, x) {
      if (!x.sec) a.push(x); else { var s = a.find(function (y) { return y.sec === x.sec; }); if (!s) { s = { k: "나/" + x.sec, sec: x.sec, items: [] }; a.push(s); } s.items.push({ p: x.p, t: x.t, v: x.v }); }
      return a;
    }, []), acts: [] } : (NAV.groups || []).find(function (x) { return x.group === tab; }) || (NAV.groups || [])[0] || { group: "", items: [], acts: [] };
    var s = H.useState(function () { return DS.load(KEY, {}) || {}; }), st = s[0], setSt = s[1];
    var ref = H.useRef(null);
    H.useEffect(function () {
      var need = pathTo(g.items, cur).filter(function (k) { return st[k] === false; });
      if (need.length) { var n = Object.assign({}, st); need.forEach(function (k) { n[k] = true; }); setSt(n); DS.keep(KEY, n); }
      var on = ref.current && ref.current.querySelector(".nav-link.on");
      if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
    }, [cur]);
    function isOpen(k) { return Object.prototype.hasOwnProperty.call(st, k) ? !!st[k] : pathTo(g.items, cur).indexOf(k) >= 0; }
    function toggle(k) {
      return function (e) {
        var o = e.currentTarget.open;
        if (isOpen(k) === o) return;
        var n = Object.assign({}, st); n[k] = o; setSt(n); DS.keep(KEY, n);
      };
    }
    var dirs = dirKeys(g.items);
    function all(on) { var n = Object.assign({}, st), keep = pathTo(g.items, cur); dirs.forEach(function (k) { n[k] = on || keep.indexOf(k) >= 0; }); setSt(n); DS.keep(KEY, n); }
    var isNew = function (p) {
      if (!db) return false;
      var d = (db.docs || []).find(function (x) { return x.page === p; }) || (db.features || []).find(function (x) { return x.page === p; });
      return !!d && DS.isNew(p, d.updatedAt);
    };
    var feats = db && tab === "기능" && (db.features || []).length;
    var secs = (props.toc || []).filter(function (x) { return x.lvl === 2; });
    return html`<nav class="side" id="side-nav" ref=${ref} onClick=${function (e) { if (e.target.closest && e.target.closest("a")) props.onPick(); }}>
      ${props.narrow ? html`<div class="nav-tabs">${DS.tabs().map(function (t) { return html`<a key=${t.t} class=${"nav-tab" + (t.t === tab ? " on" : "")} href=${DS.url(t.p)}>${t.l}${t.t === DS.mainTab() ? html`<${MainDot} />` : null}</a>`; })}</div>` : null}
      ${dirs.length ? html`<${window.SideHead} label=${tab === "나" ? g.group : DS.tabLabel(g.group)} anyOpen=${dirs.some(function (k) { return isOpen(k) && pathTo(g.items, cur).indexOf(k) < 0; })} onToggle=${all} />` : html`<div class="side-head"><span class="side-head-title">${tab === "나" ? g.group : DS.tabLabel(g.group)}</span></div>`}
      ${(g.acts || []).length ? html`<div class="nav-acts">${g.acts.map(function (a) { return html`<a class="nav-act" key=${a.label} href=${DS.url(a.p) + (a.h ? "#" + a.h : "")} title=${a.label} aria-label=${a.label}><span>${a.label}</span><${DS.Icon} paths=${DS.ICON.go} size=${14} /></a>`; })}</div>` : null}
      ${feats ? html`<${Features} db=${db} cur=${cur} items=${g.items} isNew=${isNew} secs=${secs} />` : html`<${Items} items=${g.items} isOpen=${isOpen} toggle=${toggle} cur=${cur} isNew=${isNew} db=${db} />`}
    </nav>`;
  };

  /* 중심 탭 표시: 이 유형에서 가장 많이 여는 탭 옆 작은 점 */
  var MainDot = function () { return html`<span class="main-dot" title="이 유형의 중심 메뉴" aria-label="중심 메뉴"></span>`; };
  /* 상단 탭 (선택 = 밑줄). 글자 = 표시 이름(label), 중심 탭에 점 */
  DS.Tabs = function Tabs(props) {
    DS.useDb();
    var main = DS.mainTab();
    return html`<nav class="tabs" aria-label="상단 메뉴">${DS.tabs().map(function (t) {
      var on = t.t === props.tab;
      return html`<a key=${t.t} class=${"tab" + (on ? " on" : "")} href=${DS.url(t.p)} aria-current=${on ? "true" : undefined} data-group=${t.t}>${t.l}${t.t === main ? html`<${MainDot} />` : null}</a>`;
    })}</nav>`;
  };

  /* 좁은 화면인가 (761px 미만) */
  DS.useNarrow = function () {
    var mq = window.matchMedia && window.matchMedia("(max-width: 760px)");
    var s = H.useState(!!(mq && mq.matches));
    H.useEffect(function () {
      if (!mq) return;
      var f = function (e) { s[1](e.matches); };
      if (mq.addEventListener) mq.addEventListener("change", f); else mq.addListener(f);
      return function () { if (mq.removeEventListener) mq.removeEventListener("change", f); else mq.removeListener(f); };
    }, []);
    return s[0];
  };
})();
/* ── 30-search.js ── */
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
  var KIND_OF = { FN: "명세", REQ: "명세", DEC: "명세", POL: "명세", Q: "명세", BR: "명세", API: "API", SCR: "화면", AC: "테스트", TC: "테스트", TS: "테스트", ISSUE: "이슈", TABLE: "데이터", IF: "API", BAL: "명세", HW: "명세", HAZ: "명세", RC: "명세" };
  function idKind(id, db) {
    var x = db && db.ids && db.ids[id];
    var k = x ? x.kind : String(id).split("-")[0];
    return DS.project ? KIND_OF[k] || "명세" : "ID";
  }
  /* 위치 줄: 탭 › 기능 › 문서 */
  function crumbOf(page, db, extra) {
    var tab = DS.tabOf(page) || "", f = DS.featureOf(db, page);
    if (tab && tab !== "나") tab = DS.tabLabel(tab);
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
/* ── 40-body.js ── */
/* 본문 동작: 코드 복사 · #ID 로 열 때 펼치고 강조 · mermaid 그림(테마를 바꾸면 다시) · 그림 확대 · 새 창 · 오른쪽 목차 따라가기 */
(function () {
  "use strict";
  var DS = window.DS, html = DS.html, H = DS.hooks;
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* 코드 복사 */
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button.copy");
    if (!b || !navigator.clipboard) return;
    navigator.clipboard.writeText(b.nextElementSibling.textContent).then(function () { b.textContent = "복사됨"; setTimeout(function () { b.textContent = "복사"; }, 1200); });
  });

  /* #ID: 접힌 곳(결정 카드 · 더 보기 · 메뉴 아닌 details)을 펼치고 그 위치로 가서 강조 */
  DS.reveal = function (hash, scroll) {
    if (!hash || hash === "#") return false;
    var id;
    try { id = decodeURIComponent(hash.slice(1)); } catch (e) { return false; }
    var t = document.getElementById(id);
    if (!t) return false;
    for (var p = t; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
    var row = (t.closest && t.closest("tr")) || t;
    $$(".ds-hit").forEach(function (x) { x.classList.remove("ds-hit"); });
    if (!/^H[1-6]$/.test(row.tagName)) row.classList.add("ds-hit");
    if (scroll) row.scrollIntoView({ block: "start" });
    return true;
  };
  window.addEventListener("hashchange", function () { DS.reveal(location.hash, true); });

  /* mermaid: 사이트에 넣은 파일(assets/mermaid/mermaid.min.js, 버전 고정)을 그림이 있는 쪽에서만 읽는다. 문법 오류면 그 자리에 오류 문구와 원문 */
  var mmSeq = 0;
  DS.drawDiagrams = function (root) {
    var list = $$("pre.mermaid", root);
    if (!list.length) return Promise.resolve();
    list.forEach(function (n) { if (n.dataset.src == null) n.dataset.src = n.textContent; });
    return DS.script("assets/mermaid/mermaid.min.js", function () { return !!window.mermaid; }).then(function () {
      var m = window.mermaid, dark = document.documentElement.dataset.theme === "dark";
      m.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict", suppressErrorRendering: true, flowchart: { htmlLabels: true } });
      var chain = Promise.resolve();
      list.forEach(function (n) {
        chain = chain.then(function () {
          if (!n.isConnected) return;
          var id = "mm-" + (++mmSeq);
          return m.render(id, n.dataset.src).then(function (r) {
            n.innerHTML = r.svg; n.classList.remove("mm-bad"); n.closest(".diagram").classList.remove("bad");
          }, function (e) {
            var stray = document.getElementById("d" + id); if (stray) stray.remove();
            n.classList.add("mm-bad"); n.closest(".diagram").classList.add("bad");
            n.innerHTML = '<div class="mm-err">그림을 그리지 못했습니다: ' + DS.esc(String((e && e.message) || e).split("\n").slice(0, 3).join(" ")) + "</div>" + DS.esc(n.dataset.src);
          });
        });
      });
      return chain;
    }, function (e) {
      list.forEach(function (n) { n.closest(".diagram").classList.add("bad"); n.innerHTML = '<div class="mm-err">' + DS.esc(e.message) + "</div>" + DS.esc(n.dataset.src); });
    });
  };

  /* 그림 확대: 화면 위에 크게 (더하기 · 빼기 · 맞춤 · Ctrl/⌘ 휠 · Esc 닫기) */
  function svgSize(svg) { var v = svg.viewBox && svg.viewBox.baseVal; return v && v.width ? { w: v.width, h: v.height } : { w: svg.getBoundingClientRect().width, h: svg.getBoundingClientRect().height }; }
  function Zoom(props) {
    var size = svgSize(props.svg), stage = H.useRef(null), k = H.useState(1), setK = function (v) { k[1](Math.max(0.1, Math.min(8, v))); };
    var copy = H.useMemo(function () { var c = props.svg.cloneNode(true); c.removeAttribute("style"); c.removeAttribute("width"); c.removeAttribute("height"); return c; }, [props.svg]);
    function fit() { var s = stage.current; if (s) setK(Math.min((s.clientWidth - 32) / size.w, (s.clientHeight - 32) / size.h, 2)); }
    H.useEffect(function () {
      stage.current.appendChild(copy); fit();
      function key(e) { if (e.key === "Escape") props.onClose(); }
      function wheel(e) { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); k[1](function (v) { return Math.max(0.1, Math.min(8, v * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); }); }
      document.addEventListener("keydown", key);
      stage.current.addEventListener("wheel", wheel, { passive: false });
      return function () { document.removeEventListener("keydown", key); copy.remove(); };
    }, []);
    copy.style.width = size.w * k[0] + "px"; copy.style.height = size.h * k[0] + "px";
    return html`<div class="mm-overlay">
      <div class="mm-bar"><button type="button" title="크게" onClick=${function () { setK(k[0] * 1.25); }}>+</button><button type="button" title="작게" onClick=${function () { setK(k[0] / 1.25); }}>−</button><button type="button" title="화면에 맞춤" onClick=${fit}>맞춤</button><span class="mm-k">${Math.round(k[0] * 100)}%</span><button type="button" data-z="close" title="닫기 (Esc)" onClick=${props.onClose}>닫기</button></div>
      <div class="mm-stage" ref=${stage} onClick=${function (e) { if (e.target === stage.current) props.onClose(); }}></div>
    </div>`;
  }
  DS.Zoom = Zoom;
  function openWindow(svg) {
    var w = window.open("", "_blank");
    if (!w) return;
    var dark = document.documentElement.dataset.theme === "dark";
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + DS.esc(document.title) + ' · 그림</title><style>body{margin:0;padding:24px;background:' + (dark ? "#0d1117" : "#fff") + '}svg{max-width:none!important;height:auto}</style></head><body>' + svg.outerHTML + "</body></html>");
    w.document.close();
  }
  /* 확대 · 새 창 단추: 앱이 확대 창을 연다 (DS.emit("zoom", svg)) */
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button.mm-zoom, button.mm-open");
    if (!b) return;
    var d = b.closest(".diagram"), svg = d && !d.classList.contains("bad") ? d.querySelector("pre.mermaid svg") : null;
    if (!svg) return;
    if (b.classList.contains("mm-zoom")) DS.emit("zoom", svg); else openWindow(svg);
  });

  /* 오른쪽 목차: 읽는 위치를 따라 강조할 절 id */
  DS.useSpy = function (toc, key) {
    var s = H.useState(toc[0] ? toc[0].sid : null);
    H.useEffect(function () {
      var raf = 0;
      function spy() {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function () {
          var on = toc[0] ? toc[0].sid : null;
          for (var i = 0; i < toc.length; i++) { var h = document.getElementById(toc[i].sid); if (h && h.getBoundingClientRect().top < 120) on = toc[i].sid; }
          s[1](on);
        });
      }
      spy();
      window.addEventListener("scroll", spy, { passive: true });
      return function () { window.removeEventListener("scroll", spy); cancelAnimationFrame(raf); };
    }, [key]);
    return s[0];
  };
})();
/* ── 45-viewer.js ── */
/* 보는 사람 기능 (프로젝트 사이트): 문서 오른쪽 위 의견 · 별 · 메모, 지난 방문 이후 바뀐 문서 띠와 바뀐 줄 강조(확인함),
   기능 문서 머리(단계 줄 · 마일스톤 칩 · 명세/설계/검증 절 이동), ID 칩 → 오른쪽 관계 서랍, 의견 서랍(@멘션 입력),
   의견 있는 글자 밑줄, 글자를 끌어 고르면 「의견 달기」, 머리 줄 멘션 알림함. 서랍은 앱이 하나만 연다 (DS.emit("drawer", …)) */
(function () {
  "use strict";
  var DS = window.DS, html = DS.html, H = DS.hooks;
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* 상태 글자 (의미 색만: 끝남 · 지금 · 남음 · 실패) */
  DS.State = function (props) { return html`<span class=${"state " + (props.k || "wait")}>${props.children}</span>`; };
  DS.resultKind = function (t) { t = String(t || ""); return /통과|pass|성공|완료/i.test(t) ? "done" : /실패|fail|오류/i.test(t) ? "bad" : /중|진행|run/i.test(t) ? "cur" : "wait"; };
  /* ID 칩: 고정폭. 누르면 관계 서랍 */
  DS.IdChip = function (props) {
    return html`<button type="button" class="idc" data-id=${props.id} onClick=${function (e) { e.preventDefault(); DS.emit("drawer", { kind: "rel", id: props.id }); }}>${props.id}</button>`;
  };
  var Av = function (props) { return html`<span class=${"avatar" + (props.lg ? " lg" : "")} aria-hidden="true">${String(props.id || "?").slice(0, 1)}</span>`; };
  DS.Avatar = Av;
  /* 글 속 @아이디 강조 */
  DS.atText = function (t) {
    return String(t || "").split(/(@[A-Za-z0-9_.-]+)/).map(function (x, i) { return i % 2 ? html`<span class="at">${x}</span>` : x; });
  };

  /* ── 문서 오른쪽 위: 의견(수) · 별 · 메모 ── */
  DS.DocTools = function DocTools(props) {
    var db = props.db, page = props.page;
    var stars = DS.useMy("star", []);
    var on = stars.indexOf(page) >= 0;
    var n = ((db && db.comments && db.comments[page]) || []).length + (DS.pending[page] || []).length;
    return html`<div class="doc-tools">
      ${props.comments ? html`<button type="button" class="dt-btn cmt-btn" title="의견" aria-label=${"의견 " + n} onClick=${function () { DS.emit("drawer", { kind: "cmt", page: page }); }}><${DS.Icon} paths=${DS.ICON.chat} size=${16} />${n ? html`<span>${n}</span>` : null}</button>` : null}
      <button type="button" class=${"dt-btn star-btn" + (on ? " on" : "")} title="즐겨찾기" aria-label="즐겨찾기" aria-pressed=${on} onClick=${function () { DS.my.set("star", on ? stars.filter(function (p) { return p !== page; }) : [page].concat(stars)); }}><${DS.Icon} paths=${DS.ICON.star} size=${16} /></button>
      <button type="button" class=${"dt-btn memo-btn" + (props.memo ? " on" : "")} title="내 메모 (나만 보임)" aria-label="내 메모" aria-pressed=${!!props.memo} onClick=${props.onMemo}><${DS.Icon} paths=${DS.ICON.note} size=${16} /></button>
    </div>`;
  };

  /* ── 내 메모 (나만 보임) · 이슈로 올리기 ── */
  DS.Memo = function Memo(props) {
    var db = props.db, key = props.k;
    var memos = DS.useMy("memo", {});
    var es = H.useState(!memos[key]), edit = es[0], setEdit = es[1];
    var ts = H.useState(memos[key] || ""), text = ts[0], setText = ts[1];
    var ms = H.useState(""), msg = ms[0], setMsg = ms[1];
    function save() { var m = Object.assign({}, DS.my.get("memo", {})); if (text.trim()) m[key] = text.trim(); else delete m[key]; DS.my.set("memo", m); setEdit(false); }
    function up() {
      setMsg("올리는 중…");
      DS.write(db, "issue", { title: "메모: " + DS.titleOf(key), body: (memos[key] || text) + "\n\n문서: " + key, ids: [] }).then(function (r) {
        setMsg(r.ok ? "이슈로 올렸습니다" : r.opened ? "새 창에서 이슈를 마무리하세요" : r.error || "올리지 못했습니다");
      });
    }
    var mode = DS.writeMode(db);
    return html`<div class="memo"><div class="memo-h"><span>내 메모 · 나만 보임</span>${props.onClose ? html`<button type="button" class="lbtn" onClick=${props.onClose}>닫기</button>` : null}</div>
      ${edit ? html`<textarea class="tin" rows="3" value=${text} placeholder="이 문서에 남길 메모" onInput=${function (e) { setText(e.currentTarget.value); }}></textarea>` : html`<div class="memo-t">${memos[key]}</div>`}
      <div class="acts">${edit ? html`<button type="button" class="abtn pri" onClick=${save}>저장</button>` : html`<button type="button" class="abtn" onClick=${function () { setText(memos[key] || ""); setEdit(true); }}>고치기</button>`}
        ${!edit && mode !== "none" ? html`<button type="button" class="abtn" onClick=${up}>이슈로 올리기</button>` : null}
        ${msg ? html`<span class="muted-s">${msg}</span>` : null}</div>
    </div>`;
  };

  /* ── 지난 방문 이후 바뀐 문서: 띠 · 바뀐 줄 강조 · 확인함 ── */
  DS.changesOf = function (db, page) { return ((db && db.changes) || []).filter(function (c) { return c.page === page && DS.since && c.at > DS.since; }); };
  /* 바뀐 줄 강조: 이번 바뀜에 든 ID 의 정의 행 (확인함을 누르면 지운다) */
  DS.markChanges = function (el, db, page) {
    if (!el) return;
    $$(".ds-chg", el).forEach(function (x) { x.classList.remove("ds-chg"); });
    var d = db && ((db.docs || []).find(function (x) { return x.page === page; }) || (db.features || []).find(function (x) { return x.page === page; }));
    if (!d || !DS.isNew(page, d.updatedAt)) return;
    DS.changesOf(db, page).forEach(function (c) {
      (c.ids || []).forEach(function (id) {
        var t = document.getElementById(id);
        var row = t && el.contains(t) ? (t.closest("tr") || t) : $$("tr", el).find(function (tr) { return tr.cells[0] && tr.cells[0].textContent.trim() === id; });
        if (row) row.classList.add("ds-chg");
      });
    });
  };
  DS.ChangeBar = function ChangeBar(props) {
    var db = props.db, page = props.page;
    DS.useMy("seen", {});
    var d = db && ((db.docs || []).find(function (x) { return x.page === page; }) || (db.features || []).find(function (x) { return x.page === page; }));
    var isNew = !!d && DS.isNew(page, d.updatedAt);
    if (!isNew) return null;
    var by = DS.changesOf(db, page)[0];
    return html`<div class="chgbar" role="status"><span>지난 방문(${DS.mdhm(DS.since)}) 이후 바뀐 문서입니다${by ? " · " + DS.mdhm(by.at) + " " + (by.by || "") : ""}. 바뀐 줄을 표시했습니다</span><span class="acts">${DS.hasHist(db) ? html`<button type="button" class="abtn chg-diff" onClick=${function () { DS.emit("drawer", { kind: "diff", page: page }); }}>바뀐 점 보기</button>` : null}<button type="button" class="abtn chg-ok" onClick=${function () { DS.markSeen(page, d.updatedAt); }}>확인함</button></span></div>`;
  };

  /* ── 기능 문서 머리: 단계 줄 · 마일스톤 칩(날짜) · 절 이동 ── */
  DS.FeatHead = function FeatHead(props) {
    var db = props.db, f = props.f, st = db.stages || [];
    var ms = (db.milestones || []).find(function (m) { return m.name === f.milestone; });
    var secs = (props.toc || []).filter(function (x) { return x.lvl === 2 && /^(명세|설계|검증)/.test(x.text); });
    return html`<div class="feat-head">
      <div class="feat-row"><div class="track" aria-label="단계">${st.map(function (s, i) { return html`<span key=${s} class=${"step " + DS.stageState(db, f, i)}>${s}</span>`; })}</div>
        ${f.milestone ? html`<span class="mschip">마일스톤 · ${f.milestone}${ms && ms.due ? " · " + DS.kday(ms.due) : ""}<${DS.Go} href=${DS.url("_/milestones.html") + "#ms-" + encodeURIComponent(f.milestone)} label="마일스톤 열기" /></span>` : null}</div>
      <${FeatLinks} db=${db} f=${f} />
      ${secs.length ? html`<div class="subtabs">${secs.map(function (s) { return html`<a key=${s.sid} href=${"#" + s.sid}>${s.text}</a>`; })}</div>` : null}
    </div>`;
  };
  /* 프로필(분야)이 더한 이음: 보드 판 · 위험 · 인터페이스 (장치 · IoT), 밸런스 표 (게임). ID 칩 = 관계 서랍, 밸런스 표는 정의(표 문서)로 가는 화살표도 */
  DS.REL_LABEL = { bal: "밸런스 표", ifs: "인터페이스", hw: "보드 판", risks: "위험 · 대책" };
  function FeatLinks(props) {
    var db = props.db, f = props.f;
    var rows = ["hw", "risks", "ifs", "bal"].filter(function (k) { return (f[k] || []).length; });
    if (!rows.length) return null;
    return html`<div class="feat-links">${rows.map(function (k) {
      return html`<div class=${"fl-row fl-" + k} key=${k}><span class="fl-l">${DS.REL_LABEL[k]}</span><span class="ids">${f[k].map(function (id) {
        var href = k === "bal" ? DS.idHref(db, id) : null;
        return html`<span class="rel-i" key=${id}><${DS.IdChip} id=${id} />${href ? html`<${DS.Go} href=${href} label=${id + " 표 열기"} />` : null}</span>`;
      })}</span></div>`;
    })}</div>`;
  }

  /* 정의 행의 ID 글자 → 관계 서랍을 여는 ID 칩 (DB 에 있는 ID 만). 기능 문서 머리 줄 인용(번호 · 단계)은 머리의 단계 줄이 대신한다 */
  DS.enhanceDoc = function (el, db, feat) {
    if (!el || !db) return;
    $$("tr[id]", el).forEach(function (tr) {
      var id = tr.id, td = tr.cells[0];
      if (!td || td.querySelector(".ds-def") || td.textContent.trim() !== id || !((db.ids || {})[id] || DS.fnsOf(db, id).length)) return;
      td.textContent = "";
      var b = document.createElement("button"); b.type = "button"; b.className = "idc ds-def"; b.textContent = id; b.title = "관계 보기";
      td.appendChild(b);
    });
    if (feat) { var q = el.querySelector("blockquote"); if (q && /번호\s*[:：]/.test(q.textContent) && /단계\s*[:：]/.test(q.textContent)) q.hidden = true; }
    if (feat) tierTable(el, db, feat);
  };

  /* 검증 절의 단계별 결과 표 (단계 · 결과 · 어디서). 문서에 그 표가 있으면 결과 칸에 상태 색만 입히고,
     없으면 빌드 DB 의 기능 tiers(+ 프로필 단계)로 절 맨 앞에 그린다. 장치 · IoT 는 결과가 없어도 단계 줄을 보인다 */
  function hwChips(td, text, db) {
    String(text || "").split(/(HW-[A-Za-z0-9_.-]+)/).forEach(function (part, i) {
      if (i % 2 && (db.ids || {})[part]) { var b = document.createElement("button"); b.type = "button"; b.className = "idc ds-def"; b.textContent = part; b.title = "관계 보기"; td.appendChild(b); }
      else if (part) td.appendChild(document.createTextNode(part));
    });
  }
  var KIND_WORD = { done: "통과", bad: "실패", cur: "진행 중", wait: "시험 전" };
  var heads = function (t) { return $$("th", t).map(function (th) { return th.textContent.trim(); }); };
  function tierTable(el, db, f) {
    var h = $$("h2", el).find(function (x) { return /^검증/.test(x.textContent.trim()); });
    if (!h) return;
    var tables = [], n = h.nextElementSibling;
    while (n && n.tagName !== "H2") { if (n.tagName === "TABLE") tables.push(n); else $$("table", n).forEach(function (t) { tables.push(t); }); n = n.nextElementSibling; }
    var own = tables.find(function (t) { var hs = heads(t); return hs[0] === "단계" && hs.indexOf("결과") > 0; });
    if (own) {
      var ri = heads(own).indexOf("결과");
      own.classList.add("ds-tiers");
      $$("tbody tr", own).forEach(function (tr) {
        var td = tr.cells[ri];
        if (!td || td.querySelector(".state")) return;
        var t = td.textContent.trim(), sp = document.createElement("span");
        sp.className = "state " + (t ? DS.resultKind(t) : "wait"); sp.textContent = t || KIND_WORD.wait;
        td.textContent = ""; td.appendChild(sp);
      });
      return;
    }
    var dom = (DS.profileOf(db) || {}).domain || "";
    if (!(f.tiers || []).length && !/^(device|iot)$/.test(dom)) return;
    var rows = DS.tierRows(db, f);
    if (!rows.length || el.querySelector(".ds-tiers")) return;
    var box = document.createElement("div"); box.className = "table ds-tiers-box";
    var tb = document.createElement("table"); tb.className = "ds-tiers";
    tb.innerHTML = "<thead><tr><th>단계</th><th>결과</th><th>어디서</th></tr></thead><tbody></tbody>";
    rows.forEach(function (t) {
      var tr = document.createElement("tr"), k = DS.tierKind(t);
      var a = document.createElement("td"); a.textContent = t.tier;
      var b = document.createElement("td"), sp = document.createElement("span"); sp.className = "state " + k; sp.textContent = t.result || KIND_WORD[k]; b.appendChild(sp);
      var c = document.createElement("td"); hwChips(c, t.where, db);
      tr.appendChild(a); tr.appendChild(b); tr.appendChild(c); tb.tBodies[0].appendChild(tr);
    });
    box.appendChild(tb);
    var cap = document.createElement("p"); cap.className = "muted-s ds-tiers-cap"; cap.textContent = "검증 단계별 결과 (기능 문서 · 빌드 DB). 어디서 = 돌린 곳 · 보드 판";
    h.parentNode.insertBefore(cap, h.nextSibling);
    h.parentNode.insertBefore(box, cap.nextSibling);
  }

  /* 의견 있는 글자에 밑줄 (본문 글자 노드에서 처음 나온 곳) */
  DS.markQuotes = function (el, list) {
    if (!el) return;
    $$("mark.cmark", el).forEach(function (m) { m.replaceWith(document.createTextNode(m.textContent)); });
    el.normalize();
    (list || []).forEach(function (c) {
      var q = String(c.quote || "").trim();
      if (!q || q.length < 2) return;
      var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) {
        if (n.parentElement && n.parentElement.closest("mark.cmark, pre.mermaid, script")) continue;
        var i = n.nodeValue.indexOf(q);
        if (i < 0) continue;
        var r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + q.length);
        var m = document.createElement("mark"); m.className = "cmark"; m.title = "의견 있음"; m.dataset.cid = c.id || "";
        r.surroundContents(m);
        break;
      }
    });
  };

  /* ── 오른쪽 서랍: 관계 ── */
  function RelDrawer(props) {
    var db = props.db, id = props.id;
    var x = (db.ids || {})[id];
    var fns = DS.fnsOf(db, id);
    var chip = function (y) { var href = DS.idHref(db, y), ext = /^https?:/.test(href || "") && href.indexOf(DS.root) !== 0; return html`<span class=${"rel-i" + (y === id ? " me" : "")} key=${y}><span class="idc">${y}</span>${href ? html`<${DS.Go} href=${href} ext=${ext} />` : null}</span>`; };
    var row = function (label, list) { return html`<div class="rel-row"><div class="rel-l">${label}</div><div class="rel-v">${list.length ? list.map(chip) : html`<span class="muted-s">없음</span>`}</div></div>`; };
    var def = DS.idHref(db, id);
    /* 프로필이 더한 칸: 이 분야가 쓰는 ID 종류(profile.ids)거나 값이 있을 때만 줄을 보인다 */
    var KIND = { bal: "BAL", ifs: "IF", hw: "HW", risks: "HAZ" }, extra = ["bal", "ifs", "hw", "risks"];
    var kinds = ((DS.profileOf(db) || {}).ids) || [];
    return html`<div class="rel-h"><span class="idc">${id}</span>${def ? html`<${DS.Go} href=${def} label="정의로 가기" ext=${/^https?:/.test(def) && def.indexOf(DS.root) !== 0} />` : null}<button type="button" class="lbtn rel-x" onClick=${props.onClose}>닫기</button></div>
      ${x && x.title && x.title !== id ? html`<div class="rel-t">${x.title}</div>` : null}
      ${fns.length ? fns.map(function (fn) {
        var r = db.relations[fn] || {}, f = DS.fnFeature(db, fn);
        return html`<div class="rel-block" key=${fn}>
          ${f ? html`<div class="muted-s">${f.no} ${f.name || f.title}${f.milestone ? " · 마일스톤 " + f.milestone : ""}${f.stage ? " · " + f.stage : ""}</div>` : null}
          <div class="rel-chain">${row("요구사항", r.req || [])}${row("기능", [fn])}${row("API", r.api || [])}${row("화면", r.scr || [])}${row("테이블", r.tables || [])}${row("시험", r.ac || [])}${row("결정", r.dec || [])}${row("이슈", r.issues || [])}${extra.filter(function (k) { return (r[k] || []).length || kinds.indexOf(KIND[k]) >= 0; }).map(function (k) { return row(DS.REL_LABEL[k], r[k] || []); })}</div>
        </div>`;
      }) : html`<div class="kempty">이 ID 에 이어진 기능이 아직 없습니다</div>`}
      <p class="muted-s">이것을 바꾸면 위 줄들을 함께 봅니다. 빌드 때 만든 DB 에서 ID 끼리 이어 찾습니다</p>`;
  }

  /* 쓴 뒤 다음 빌드 전까지 이 화면에만 보이는 의견 */
  DS.pending = {};

  /* @멘션 입력: @ 뒤 글자로 팀원을 거르고, 누르면 넣는다 */
  DS.MentionInput = function MentionInput(props) {
    var db = props.db, ref = H.useRef(null);
    var qs = H.useState(null), q = qs[0], setQ = qs[1];
    var members = ((db && db.team && db.team.members) || []);
    function check(el) { var m = /(?:^|\s)@([A-Za-z0-9_.-]*)$/.exec(el.value.slice(0, el.selectionStart)); setQ(m ? m[1] : null); }
    function put(id) {
      var el = ref.current, v = el.value, at = el.selectionStart, pre = v.slice(0, at).replace(/@([A-Za-z0-9_.-]*)$/, "@" + id + " ");
      props.onInput(pre + v.slice(at)); setQ(null);
      setTimeout(function () { el.focus(); el.selectionStart = el.selectionEnd = pre.length; }, 0);
    }
    var list = q == null ? [] : members.filter(function (m) { return (m.id + " " + (m.name || "")).toLowerCase().indexOf(q.toLowerCase()) >= 0; });
    return html`<div class="mention-in">
      <textarea class="tin" ref=${ref} rows=${props.rows || 3} value=${props.value} placeholder=${props.placeholder || "의견 쓰기 · @ 로 사람 부르기"} aria-label=${props.label || "의견"}
        onInput=${function (e) { props.onInput(e.currentTarget.value); check(e.currentTarget); }} onKeyUp=${function (e) { check(e.currentTarget); }}
        onKeyDown=${function (e) { if (list.length && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); put(list[0].id); } else if (e.key === "Escape" && q != null) { e.stopPropagation(); setQ(null); } }}></textarea>
      ${list.length ? html`<div class="atlist" role="listbox" aria-label="사람 부르기">${list.map(function (m) { return html`<button type="button" key=${m.id} class="at-opt" onMouseDown=${function (e) { e.preventDefault(); put(m.id); }}><${Av} id=${m.id} /><b>@${m.id}</b><span class="muted-s">${m.name || ""}${m.role ? " · " + m.role : ""}</span></button>`; })}</div>` : null}
    </div>`;
  };

  /* ── 오른쪽 서랍: 의견 ── */
  function CmtDrawer(props) {
    var db = props.db, page = props.page;
    var ts = H.useState(""), text = ts[0], setText = ts[1];
    var qs = H.useState(props.quote || ""), quote = qs[0], setQuote = qs[1];
    var ms = H.useState(""), msg = ms[0], setMsg = ms[1];
    var bs = H.useState(false), busy = bs[0], setBusy = bs[1];
    H.useEffect(function () { setQuote(props.quote || ""); }, [props.quote, page]);
    var list = ((db.comments || {})[page] || []).concat(DS.pending[page] || []);
    var mode = DS.writeMode(db), rn = DS.remoteName(db);
    function send() {
      if (!text.trim() || busy) return;
      setBusy(true); setMsg("");
      DS.write(db, "comment", { page: page, title: DS.titleOf(page), quote: quote, text: text.trim() }).then(function (r) {
        setBusy(false);
        if (r.ok) {
          (DS.pending[page] = DS.pending[page] || []).push({ id: "p" + Date.now(), who: DS.meId() || "나", at: new Date().toISOString(), quote: quote, text: text.trim(), url: r.url, pending: true });
          setText(""); setQuote(""); setMsg("올렸습니다. 사이트를 다시 만들면 모두에게 보입니다"); DS.emit("comments", page);
        } else if (r.opened) setMsg(rn + " 화면을 새 창으로 열었습니다");
        else setMsg(r.error || "올리지 못했습니다");
      });
    }
    return html`<div class="rel-h"><b>의견 ${list.length}</b><button type="button" class="lbtn rel-x" onClick=${props.onClose}>닫기</button></div>
      <div class="muted-s">${DS.titleOf(page)} · 이 사이트를 보는 사람은 모두 봅니다</div>
      <div class="cm-list">${list.length ? list.map(function (c) {
        return html`<div class=${"cm" + (c.pending ? " pend" : "")} key=${c.id || c.at}>${c.quote ? html`<div class="cq">${c.quote}</div>` : null}<div class="cw"><${Av} id=${c.who} /><b>${c.who}</b><span class="muted-s">${DS.mdhm(c.at)}${c.pending ? " · 다음 빌드에 반영" : ""}</span>${c.url ? html`<${DS.Go} href=${c.url} ext=${true} label="원격에서 보기" />` : null}</div><div class="cm-t">${DS.atText(c.text)}</div></div>`;
      }) : html`<div class="kempty">아직 의견이 없습니다</div>`}</div>
      <div class="cbox">
        ${quote ? html`<div class="cq">${quote}<button type="button" class="lbtn" onClick=${function () { setQuote(""); }}>빼기</button></div>` : null}
        ${mode === "none" ? null : html`<${DS.MentionInput} db=${db} value=${text} onInput=${setText} />`}
        <div class="board-top"><span class="muted-s">${DS.writeNote(db, "이슈 댓글")}</span>${mode === "none" ? null : html`<button type="button" class="abtn pri" disabled=${busy || (!text.trim() && mode !== "open")} onClick=${mode === "open" && !text.trim() ? function () { DS.write(db, "comment", { page: page, title: DS.titleOf(page), quote: quote, text: "" }); } : send}>${mode === "open" ? rn + " 에서 쓰기" : "올리기"}</button>`}</div>
        ${msg ? html`<div class="muted-s" role="status">${msg}</div>` : null}
      </div>`;
  }

  DS.Drawer = function Drawer(props) {
    var d = props.d, db = props.db;
    H.useLayoutEffect(function () {
      function key(e) { if (e.key === "Escape") props.onClose(); }
      document.addEventListener("keydown", key);
      return function () { document.removeEventListener("keydown", key); };
    }, []);
    if (!d || !db) return null;
    if (d.kind === "diff") return html`<aside class="drawer wide" role="complementary" aria-label="바뀐 점"><${DS.DiffDrawer} db=${db} page=${d.page} onClose=${props.onClose} /></aside>`;
    return html`<aside class="drawer" role="complementary" aria-label=${d.kind === "rel" ? "관계" : "의견"}>
      ${d.kind === "rel" ? html`<${RelDrawer} db=${db} id=${d.id} onClose=${props.onClose} />` : html`<${CmtDrawer} db=${db} page=${d.page} quote=${d.quote} onClose=${props.onClose} />`}
    </aside>`;
  };

  /* ── 글자를 끌어 고르면 「의견 달기」 ── */
  DS.SelButton = function SelButton(props) {
    var s = H.useState(null), at = s[0], setAt = s[1];
    H.useEffect(function () {
      function up(e) {
        if (e.target.closest && e.target.closest(".selbtn")) return;
        setTimeout(function () {
          var sel = window.getSelection(), t = String(sel || "").trim(), el = props.el;
          if (!t || t.length > 200 || !el || !sel.rangeCount || !el.contains(sel.anchorNode) || document.documentElement.classList.contains("ink-on")) { setAt(null); return; }
          var r = sel.getRangeAt(0).getBoundingClientRect();
          setAt({ x: r.left + r.width / 2 + window.scrollX, y: r.top + window.scrollY - 40, q: t.replace(/\s+/g, " ") });
        }, 0);
      }
      document.addEventListener("mouseup", up);
      document.addEventListener("keyup", up);
      return function () { document.removeEventListener("mouseup", up); document.removeEventListener("keyup", up); };
    }, [props.el]);
    if (!at) return null;
    return html`<button type="button" class="selbtn" style=${{ left: at.x + "px", top: at.y + "px" }} onClick=${function () { DS.emit("drawer", { kind: "cmt", page: props.page, quote: at.q }); setAt(null); window.getSelection().removeAllRanges(); }}><${DS.Icon} paths=${DS.ICON.chat} size=${14} />의견 달기</button>`;
  };

  /* ── 머리 줄: 나 단추 · 멘션 알림함 ── */
  DS.MeButton = function MeButton(props) {
    var me = DS.meId();
    DS.useMy("me", "");
    return html`<a class=${"hbtn me-btn" + (props.on ? " on" : "")} id="me-btn" href=${DS.url("_/me.html")} title="나" aria-current=${props.on ? "true" : undefined}><${Av} id=${me || "?"} /><span class="me-id">${me || "나"}</span></a>`;
  };
  DS.Inbox = function Inbox(props) {
    var db = props.db, me = DS.meId();
    var read = DS.useMy("read", {});
    var os = H.useState(false), open = os[0], setOpen = os[1];
    var box = H.useRef(null);
    var list = DS.mentionsOf(db, me);
    var unread = list.filter(function (m) { return !read[m.key]; }).length;
    H.useEffect(function () {
      if (!open) return;
      function out(e) { if (box.current && !box.current.contains(e.target)) setOpen(false); }
      function key(e) { if (e.key === "Escape") setOpen(false); }
      document.addEventListener("mousedown", out); document.addEventListener("keydown", key);
      return function () { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", key); };
    }, [open]);
    function mark(k) { var r = Object.assign({}, DS.my.get("read", {})); r[k] = 1; DS.my.set("read", r); }
    return html`<div class="inbox-wrap" ref=${box}>
      <button type="button" class="hbtn" id="inbox-btn" title="나를 부른 의견" aria-label=${"나를 부른 의견" + (unread ? " 안 읽음 " + unread : "")} aria-expanded=${open} onClick=${function () { setOpen(!open); }}><${DS.Icon} paths=${DS.ICON.chat} size=${16} />${unread ? html`<span class="ibn" id="inbox-n">${unread}</span>` : null}</button>
      ${open ? html`<div class="inbox" role="dialog" aria-label="나를 부른 의견">
        <div class="ib-h"><b>나를 부른 의견</b><span>${unread ? html`<button type="button" class="lbtn" onClick=${function () { var r = Object.assign({}, read); list.forEach(function (m) { r[m.key] = 1; }); DS.my.set("read", r); }}>모두 읽음</button>` : null}<a class="lbtn" href=${DS.url("_/me/mentions.html")} onClick=${function () { setOpen(false); }}>전체 보기</a></span></div>
        ${!me ? html`<div class="kempty">나 › 프로필에서 내 아이디를 고르면 나를 부른 의견이 모입니다</div>` : list.length ? list.slice(0, 12).map(function (m) {
          return html`<div class=${"ib-i" + (read[m.key] ? "" : " new")} key=${m.key}><div class="cw"><${Av} id=${m.who} /><b>${m.who}</b><span class="muted-s">${DS.mdhm(m.at)} · ${m.title || DS.titleOf(m.page)}</span><${DS.Go} href=${m.href} onClick=${function () { mark(m.key); setOpen(false); }} /></div>${m.quote ? html`<div class="cq">${m.quote}</div>` : null}<div class="cm-t">${DS.atText(m.text)}</div></div>`;
        }) : html`<div class="kempty">나를 부른 의견이 없습니다</div>`}
      </div>` : null}
    </div>`;
  };

  /* 최근 본 문서 기록 (나 화면 · 인쇄는 빼고) */
  DS.on("page", function (x) {
    if (!DS.project || !x.meta || x.meta.kind === "print" || DS.tabOf(x.meta.page) === "나") return;
    var p = x.meta.page + (x.meta.kind === "virtual" ? location.search : "");
    var r = (DS.my.get("recent", []) || []).filter(function (y) { return y !== p; });
    r.unshift(p); DS.my.set("recent", r.slice(0, 20));
  });
})();
/* ── 47-diff.js ── */
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
/* ── 50-print.js ── */
/* 인쇄: 머리 줄 인쇄 단추 → 이 문서 · 전체 문서. 인쇄 때는 접힌 곳을 모두 편다 (Ctrl+P 도).
   전체 문서 인쇄 쪽(print-all.html): 메뉴 순서의 문서를 모두 읽어 본문을 이어 붙이고 그림을 그린 뒤 인쇄 창을 연다 */
(function () {
  "use strict";
  var DS = window.DS, html = DS.html, H = DS.hooks;
  window.addEventListener("beforeprint", function () { Array.prototype.forEach.call(document.querySelectorAll("details"), function (d) { d.open = true; }); });

  DS.PrintButton = function PrintButton(props) {
    var o = H.useState(false), open = o[0], setOpen = o[1];
    H.useEffect(function () {
      if (!open) return;
      function close() { setOpen(false); }
      function key(e) { if (e.key === "Escape") setOpen(false); }
      document.addEventListener("click", close);
      document.addEventListener("keydown", key);
      return function () { document.removeEventListener("click", close); document.removeEventListener("keydown", key); };
    }, [open]);
    return html`<button id="print" type="button" title="인쇄 (이 문서 · 전체 문서)" aria-label="인쇄" aria-haspopup="true" aria-expanded=${open} onClick=${function (e) { e.stopPropagation(); setOpen(!open); }}><${DS.Icon} paths=${DS.ICON.print} /></button>
      <div class="print-menu" hidden=${!open}>
        <button type="button" onClick=${function () { setOpen(false); props.ready().then(function () { window.print(); }); }}>이 문서 인쇄</button>
        <button type="button" onClick=${function () { setOpen(false); DS.go(DS.url("print-all.html")); }}>전체 문서 인쇄</button>
      </div>`;
  };

  /* 다른 쪽 본문의 상대 주소를 그 쪽 기준 절대 주소로 */
  function rebase(body, page) {
    var box = document.createElement("div"), base = DS.url(page);
    box.innerHTML = body;
    Array.prototype.forEach.call(box.querySelectorAll("[href],[src]"), function (n) {
      ["href", "src"].forEach(function (k) {
        var v = n.getAttribute(k);
        if (v && !/^(#|[a-z][a-z0-9+.-]*:)/i.test(v)) { try { n.setAttribute(k, new URL(v, base).href); } catch (e) { /* 그대로 */ } }
      });
    });
    return box.innerHTML;
  }

  DS.PrintAll = function PrintAll(props) {
    var s = H.useState({ docs: [], done: 0, total: 0, msg: "문서를 불러오는 중…", ready: false }), st = s[0], set = s[1];
    var box = H.useRef(null);
    H.useEffect(function () {
      if (DS.file) { set({ docs: [], msg: "전체 인쇄는 웹 주소(Pages 등)로 열었을 때만 됩니다. 이 PC 파일로 보고 있으면 kedovi docs serve 로 여세요. 이 문서 인쇄는 그대로 됩니다." }); return; }
      var list = ((window.DS_SEARCH || {}).pages || []).map(function (p) { return p.u; }).filter(function (u, i, a) { return a.indexOf(u) === i && u !== "print-all.html"; });
      var out = [], next = 0, done = 0, alive = true;
      function one() {
        if (next >= list.length) return Promise.resolve();
        var i = next++;
        return DS.fetchPage(list[i]).then(function (d) { out[i] = { page: list[i], h1: d.meta.h1, body: rebase(d.body, list[i]) }; },
          function () { out[i] = { page: list[i], h1: DS.esc(list[i]), body: '<p class="mm-err">불러오지 못했습니다</p>' }; })
          .then(function () { done++; if (alive) set({ docs: [], done: done, total: list.length, msg: "문서를 불러오는 중 " + done + " / " + list.length }); return one(); });
      }
      var workers = [];
      for (var w = 0; w < 6; w++) workers.push(one());
      Promise.all(workers).then(function () {
        if (!alive) return;
        set({ docs: out, ready: true, msg: props.meta.autoPrint ? list.length + "개 문서. 인쇄 창을 엽니다 (다시 열기: 위 인쇄 단추 → 이 문서 인쇄)" : list.length + "개 문서를 모두 불러왔습니다. 위 인쇄 단추 → 이 문서 인쇄 (또는 Ctrl+P · ⌘P)" });
      });
      return function () { alive = false; };
    }, []);
    H.useEffect(function () {
      if (!st.ready || !box.current) return;
      DS.drawDiagrams(box.current).then(function () {
        Array.prototype.forEach.call(box.current.querySelectorAll("details"), function (d) { d.open = true; });
        if (props.meta.autoPrint) setTimeout(function () { window.print(); }, 300);
      });
    }, [st.ready]);
    return html`<div id="print-all" ref=${box}><p class="print-status">${st.msg}</p>
      ${st.docs.map(function (d) { return html`<section class="print-doc" key=${d.page}><h1 dangerouslySetInnerHTML=${{ __html: d.h1 }}></h1><div dangerouslySetInnerHTML=${{ __html: d.body }}></div></section>`; })}
    </div>`;
  };
})();
/* ── 60-ink.js ── */
/* 펜 필기: 머리 줄 펜 단추로 켜고 끈다 (쪽을 옮겨도 켜진 채). 펜 · 형광펜 · 지우개(획 지우기, 범위 원), 도구마다 색 5 · 크기 4단계,
   자(곧은 선), 되돌리기, 모두 지우기, PNG 받기. 선은 perfect-freehand 로 필압 · 속도에 따라 굵기가 바뀌는 채운 모양으로 그린다
   (펜이 아니면 속도로 필압을 흉내 낸다). 획은 본문(article) 기준 좌표로 이 기기에 쪽마다 저장하고(localStorage), SVG 층이라 인쇄에도 나온다.
   입력: 펜(Apple Pencil · S Pen)이 한 번이라도 닿았으면 펜 = 필기, 손가락 = 브라우저 스크롤 (확대는 막는다).
   펜이 없으면 한 손가락 = 필기, 두 손가락 = 화면 이동. 마우스 = 필기, 휠 = 그 자리 스크롤 */
(function () {
  "use strict";
  var DS = window.DS, html = DS.html, H = DS.hooks;
  var NS = "http://www.w3.org/2000/svg", root = document.documentElement;
  var PREF = "kedovi-docs-ink-prefs";
  var TOOLS = {
    pen: { colors: ["var(--fg)", "#cf222e", "#0969da", "#1a7f37", "#bf5af2"], sizes: [2, 3.2, 5, 8] },
    hl: { colors: ["#ffd60a", "#7ee08a", "#7cc4ff", "#ff9ec7", "#ffb35c"], sizes: [10, 16, 22, 30] },
    er: { sizes: [6, 12, 22, 36] }
  };
  var ICO = {
    pen: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    hl: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    er: '<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.828 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>',
    ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    clear: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    png: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
  };
  var r1 = function (v) { return Math.round(v * 10) / 10; };

  /* 획 { t: pen|hl, c: 색, s: 크기, w: 그릴 때 본문 폭, p: [x, y, 필압, …], q: 펜 필압인가 }. 옛 획(d: [x, y, …])은 필압 0.5 로 읽는다 */
  function points(s) {
    if (s.p) { var o = []; for (var i = 0; i < s.p.length; i += 3) o.push([s.p[i], s.p[i + 1], s.p[i + 2]]); return o; }
    var d = s.d || [], out = [];
    for (var j = 0; j < d.length; j += 2) out.push([d[j], d[j + 1], 0.5]);
    return out;
  }
  function outline(s, done) {
    var pts = points(s), hl = s.t === "hl";
    return window.PerfectFreehand.getStroke(pts, {
      size: s.s, thinning: hl ? 0 : 0.55, smoothing: 0.5, streamline: s.r ? 0 : 0.45, simulatePressure: !s.q && !hl, last: done !== false,
      start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }
    });
  }
  /* 테두리 점 → SVG 경로 (중간점 2차 곡선) */
  function pathOf(o) {
    if (!o.length) return "";
    if (o.length < 3) return "M" + r1(o[0][0]) + " " + r1(o[0][1]) + "Z";
    var d = "M" + r1(o[0][0]) + " " + r1(o[0][1]) + " Q";
    for (var i = 0; i < o.length; i++) { var a = o[i], b = o[(i + 1) % o.length]; d += r1(a[0]) + " " + r1(a[1]) + " " + r1((a[0] + b[0]) / 2) + " " + r1((a[1] + b[1]) / 2) + " "; }
    return d + "Z";
  }

  DS.Ink = function Ink(props) {
    /* props: on, setOn, el(본문 article), page(쪽 경로: 저장 키) */
    var pref = H.useMemo(function () { return DS.load(PREF, {}) || {}; }, []);
    var ts = H.useState(TOOLS[pref.tool] ? pref.tool : "pen"), tool = ts[0], setTool = ts[1];
    var cs = H.useState(pref.color || {}), color = cs[0], setColor = cs[1];
    var ss = H.useState(pref.size || {}), size = ss[0], setSize = ss[1];
    var rs = H.useState(!!pref.ruler), ruler = rs[0], setRuler = rs[1];
    var ver = H.useState(0), bump = function () { ver[1](function (n) { return n + 1; }); };
    var layer = H.useRef(null), ring = H.useRef(null);
    var S = H.useRef({ strokes: [], hist: [], key: "" }).current;   /* 그리는 중 상태는 다시 그리지 않으려 ref 에 */
    S.tool = tool; S.ruler = ruler;
    S.sizeOf = function () { return TOOLS[S.tool].sizes[size[S.tool] == null ? 1 : size[S.tool]]; };
    S.colorOf = function () { return TOOLS[S.tool].colors[color[S.tool] || 0]; };
    var penSeen = H.useRef(!!pref.pen);
    function savePref(extra) { DS.keep(PREF, Object.assign({ tool: tool, color: color, size: size, ruler: ruler, pen: penSeen.current || undefined }, extra || {})); }

    /* 필기 층: 본문(article) 끝에 SVG 하나 (앱이 그리는 본문과 따로, 쪽을 옮겨도 그대로) */
    H.useLayoutEffect(function () {
      if (!props.el) return;
      var L = document.createElementNS(NS, "svg");
      L.setAttribute("class", "ink-layer");
      L.setAttribute("aria-hidden", "true");
      props.el.appendChild(L);
      layer.current = L;
      return function () { L.remove(); layer.current = null; };
    }, [props.el]);
    /* 쪽이 바뀌면 그 쪽 획을 읽는다 (새 본문과 같은 화면에: 앞 쪽 획이 잠깐 보이지 않게) */
    H.useLayoutEffect(function () {
      S.key = "kedovi-docs-ink:" + new URL(DS.url(props.page)).pathname;
      var v = DS.load(S.key, []);
      S.strokes = Array.isArray(v) ? v : [];
      S.hist = [];
      S.render();
      bump();
    }, [props.page]);
    H.useLayoutEffect(function () { root.classList.toggle("ink-on", props.on); if (props.on) S.render(); else if (ring.current) ring.current.classList.remove("on"); }, [props.on]);
    H.useLayoutEffect(function () { root.classList.toggle("ink-erase", tool === "er"); }, [tool]);
    H.useEffect(function () { if (penSeen.current) root.classList.add("ink-pen"); }, []);

    var W = function () { return (props.el && props.el.offsetWidth) || 1; };
    function el(s, done) {
      var e = document.createElementNS(NS, "path");
      e.setAttribute("d", pathOf(outline(s, done)));
      if (s.t === "hl") e.setAttribute("class", "hl");
      e.style.fill = s.c;
      var k = W() / (s.w || W());
      if (Math.abs(k - 1) > 0.001) e.setAttribute("transform", "scale(" + k + ")");
      return e;
    }
    S.render = function () {
      var L = layer.current, page = props.el;
      if (!L || !page) return;
      // 높이는 층을 뺀 본문으로 잰다 (층이 들어간 채 재면 긴 쪽에서 짧은 쪽으로 옮겨도 줄지 않고 아래에 빈 공간이 남는다)
      L.style.display = "none";
      var h = Math.max(page.scrollHeight, page.offsetHeight);
      L.style.display = "";
      L.setAttribute("width", W());
      L.setAttribute("height", h);
      while (L.firstChild) L.removeChild(L.firstChild);
      S.strokes.forEach(function (s) { L.appendChild(el(s)); });
      if (S.curEl) L.appendChild(S.curEl);
    };
    S.save = function () { DS.keep(S.key, S.strokes.length ? S.strokes : null); bump(); };
    S.snap = function () { S.hist.push(JSON.stringify(S.strokes)); if (S.hist.length > 50) S.hist.shift(); };
    function undo() { if (!S.hist.length) return; S.strokes = JSON.parse(S.hist.pop()); S.render(); S.save(); }

    /* 본문 크기가 바뀌면(창 · 펼침 · 그림 · 인쇄) 다시 그린다 */
    H.useEffect(function () {
      if (!props.el) return;
      var again = function () { requestAnimationFrame(S.render); };
      var ro = window.ResizeObserver ? new ResizeObserver(again) : null;
      if (ro) ro.observe(props.el); else window.addEventListener("resize", again);
      window.addEventListener("beforeprint", S.render);
      window.addEventListener("afterprint", again);
      return function () { if (ro) ro.disconnect(); else window.removeEventListener("resize", again); window.removeEventListener("beforeprint", S.render); window.removeEventListener("afterprint", again); };
    }, [props.el]);

    /* Esc = 끝내기 · ⌘Z = 되돌리기 (잡기 단계: 다른 스크립트가 막아도 듣는다). 한 번만 걸고 지금 값은 ref 로 */
    var live = H.useRef(props);
    live.current = props;
    H.useEffect(function () {
      function key(e) {
        if (!root.classList.contains("ink-on")) return;
        if (e.key === "Escape" || e.key === "Esc" || e.keyCode === 27) { e.preventDefault(); live.current.setOn(false); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
        else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      }
      window.addEventListener("keydown", key, true);
      return function () { window.removeEventListener("keydown", key, true); };
    }, []);

    /* 입력 (필기를 켠 동안). 층에 한 번만 건다 */
    H.useEffect(function () {
      var L = layer.current;
      if (!L) return;
      var cur = null, curId = null, curTouch = false, erased = false, erLast = null, penDown = false;
      var fingers = {}, pan = null, vel = [0, 0], lastT = 0, fling = 0, glideAt = [0, 0];
      var on = function () { return root.classList.contains("ink-on"); };
      function markPen() { if (!penSeen.current) { penSeen.current = true; root.classList.add("ink-pen"); var p = DS.load(PREF, {}) || {}; p.pen = true; DS.keep(PREF, p); } }
      /* iPad Safari 는 SVG 의 touch-action 을 다 따르지 않아 막을 터치는 터치 이벤트에서 직접 막는다 */
      function block(e) {
        if (!on()) return;
        var stylus = false;
        for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].touchType === "stylus") { stylus = true; markPen(); }
        if (penSeen.current && !stylus && !penDown) return;
        if (e.cancelable) e.preventDefault();
      }
      var nFingers = function () { return Object.keys(fingers).length; };
      function centroid() { var x = 0, y = 0, n = 0; for (var k in fingers) { x += fingers[k][0]; y += fingers[k][1]; n++; } return [x / n, y / n]; }
      function at(e) { var r = props.el.getBoundingClientRect(); return [r1(e.clientX - r.left), r1(e.clientY - r.top)]; }
      function pressure(e) { return e.pointerType === "pen" && e.pressure > 0 ? Math.round(e.pressure * 100) / 100 : 0.5; }
      function segDist(px, py, ax, ay, bx, by) {
        var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
        return Math.hypot(px - ax - t * dx, py - ay - t * dy);
      }
      function eraseAt(x, y) {
        var r = S.sizeOf(), w = W(), before = S.strokes.length;
        S.strokes = S.strokes.filter(function (s) {
          var k = w / (s.w || w), p = points(s), lim = r + (s.s * k) / 2;
          if (p.length < 2) return !p.length || Math.hypot(x - p[0][0] * k, y - p[0][1] * k) > lim;
          for (var i = 0; i < p.length - 1; i++) if (segDist(x, y, p[i][0] * k, p[i][1] * k, p[i + 1][0] * k, p[i + 1][1] * k) <= lim) return false;
          return true;
        });
        if (S.strokes.length !== before) { if (!erased) { S.hist.push(JSON.stringify(cur)); erased = true; } S.render(); }
      }
      function eraseTo(x, y) {   /* 지우개가 지난 길 전체 (빠르게 움직여도 사이의 획을 놓치지 않는다) */
        if (erLast) { var dx = x - erLast[0], dy = y - erLast[1], n = Math.ceil(Math.hypot(dx, dy) / Math.max(2, S.sizeOf() / 2));
          for (var i = 1; i < n; i++) eraseAt(erLast[0] + dx * i / n, erLast[1] + dy * i / n); }
        eraseAt(x, y); erLast = [x, y];
      }
      function showRing(e) {
        if (S.tool !== "er" || !ring.current) return;
        var d = S.sizeOf() * 2, g = ring.current;
        g.style.width = g.style.height = d + "px";
        g.style.left = e.clientX + "px"; g.style.top = e.clientY + "px";
        g.classList.add("on");
      }
      /* 자: 시작점에서 지금 점까지 곧은 선. 가로 · 세로 · 45° 근처(6° 안)면 그 각으로 붙인다 */
      function straight(p, pr) {
        var x0 = cur.p[0], y0 = cur.p[1], dx = p[0] - x0, dy = p[1] - y0, len = Math.hypot(dx, dy);
        if (len) { var ang = Math.atan2(dy, dx), step = Math.PI / 4, near = Math.round(ang / step) * step;
          if (Math.abs(ang - near) < Math.PI / 30) { dx = len * Math.cos(near); dy = len * Math.sin(near); } }
        return [x0, y0, cur.p[2], r1(x0 + dx), r1(y0 + dy), pr];
      }
      function start(e) {
        try { L.setPointerCapture(e.pointerId); } catch (x) { /* 없음 */ }
        curId = e.pointerId; curTouch = e.pointerType === "touch";
        var p = at(e);
        if (S.tool === "er") { cur = S.strokes.slice(); erased = false; erLast = null; eraseTo(p[0], p[1]); showRing(e); return; }
        cur = { t: S.tool, c: S.colorOf(), s: S.sizeOf(), w: W(), q: e.pointerType === "pen" || undefined, p: [p[0], p[1], pressure(e)] };
        S.curEl = el(cur, false);
        L.appendChild(S.curEl);
      }
      function drop() {   /* 두 번째 손가락: 첫 손가락이 긋던 획 · 지우던 것을 되돌린다 */
        if (!cur) return;
        if (S.tool === "er") { if (erased) { S.strokes = cur; S.hist.pop(); S.render(); } }
        else if (S.curEl) S.curEl.remove();
        cur = null; S.curEl = null; curId = null; erased = false;
      }
      /* 스크롤은 손가락 · 펜 · 마우스가 있는 자리의 요소로: 필기 층 아래에서 위로 올라가며 그 방향으로 더 움직일 수 있는 첫 스크롤 상자, 없으면 창 */
      function under(x, y) {
        var list = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
        for (var i = 0; i < list.length; i++) if (list[i] !== L && !L.contains(list[i])) return list[i];
        return null;
      }
      function canScroll(n, ax, d) {
        var o = getComputedStyle(n)[ax === "x" ? "overflowX" : "overflowY"];
        if (!/auto|scroll|overlay/.test(o)) return false;
        if (ax === "x") return d > 0 ? n.scrollLeft + n.clientWidth < n.scrollWidth - 1 : n.scrollLeft > 0;
        return d > 0 ? n.scrollTop + n.clientHeight < n.scrollHeight - 1 : n.scrollTop > 0;
      }
      function scrollAt(x, y, dx, dy) {
        var t = under(x, y);
        [["x", dx], ["y", dy]].forEach(function (a) {
          var ax = a[0], d = a[1];
          if (!d) return;
          for (var n = t; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
            if (canScroll(n, ax, d)) { if (ax === "x") n.scrollLeft += d; else n.scrollTop += d; return; }
          }
          window.scrollBy(ax === "x" ? d : 0, ax === "y" ? d : 0);
        });
      }
      function wheel(e) {
        if (!on() || e.ctrlKey) return;
        var k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1, dx = e.deltaX * k, dy = e.deltaY * k;
        if (e.shiftKey && !dx) { dx = dy; dy = 0; }
        e.preventDefault();
        scrollAt(e.clientX, e.clientY, dx, dy);
      }
      function glide() {
        cancelAnimationFrame(fling);
        var step = function () {
          vel = [vel[0] * 0.92, vel[1] * 0.92];
          if (Math.abs(vel[0]) < 0.02 && Math.abs(vel[1]) < 0.02) return;
          scrollAt(glideAt[0], glideAt[1], -vel[0] * 16, -vel[1] * 16);
          fling = requestAnimationFrame(step);
        };
        fling = requestAnimationFrame(step);
      }
      function down(e) {
        e.preventDefault();
        cancelAnimationFrame(fling);
        if (e.pointerType === "pen") { markPen(); penDown = true; if (!cur) start(e); return; }
        if (e.pointerType === "mouse") { if (e.button === 0 && !cur) start(e); return; }
        if (penSeen.current) return;   /* 손가락 = 브라우저 기본 스크롤 */
        fingers[e.pointerId] = [e.clientX, e.clientY];
        try { L.setPointerCapture(e.pointerId); } catch (x) { /* 없음 */ }
        if (nFingers() >= 2) { if (cur && curTouch) drop(); pan = centroid(); vel = [0, 0]; lastT = e.timeStamp; return; }
        if (!cur) start(e);
      }
      function move(e) {
        if (e.pointerType === "touch" && fingers[e.pointerId]) {
          var o = fingers[e.pointerId], n = Math.min(2, nFingers());
          fingers[e.pointerId] = [e.clientX, e.clientY];
          if (pan && n >= 2) {
            /* 움직인 손가락 하나의 이동 / 2 = 가운데 점의 이동 (손가락이 닿고 떨어져도 튀지 않는다) */
            var dx = (e.clientX - o[0]) / n, dy = (e.clientY - o[1]) / n, dt = e.timeStamp - lastT;
            pan = centroid();
            if (!dx && !dy) return;
            scrollAt(pan[0], pan[1], -dx, -dy);
            if (dt > 0) { var a = Math.min(1, dt / 50), cap = function (v) { return Math.max(-3, Math.min(3, v)); };
              vel = [vel[0] + (cap(dx * n / Math.max(dt, 8)) - vel[0]) * a, vel[1] + (cap(dy * n / Math.max(dt, 8)) - vel[1]) * a]; lastT = e.timeStamp; }
            return;
          }
        }
        if (e.pointerType !== "touch") showRing(e);
        if (!cur || e.pointerId !== curId) return;
        var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        if (!evs.length) evs = [e];
        if (S.tool === "er") { evs.forEach(function (ev) { var p = at(ev); eraseTo(p[0], p[1]); }); return; }
        if (S.ruler || e.shiftKey) { var last = evs[evs.length - 1]; cur.p = straight(at(last), pressure(last)); cur.r = 1; }
        else evs.forEach(function (ev) {
          var p = at(ev), d = cur.p, lx = d[d.length - 3], ly = d[d.length - 2];
          if (Math.hypot(p[0] - lx, p[1] - ly) >= 1) d.push(p[0], p[1], pressure(ev));
        });
        if (S.curEl) S.curEl.setAttribute("d", pathOf(outline(cur, false)));
      }
      function end(e) {
        if (e.pointerType === "pen") penDown = false;
        if (e.pointerType === "touch" && fingers[e.pointerId]) {
          delete fingers[e.pointerId];
          if (pan && nFingers() < 2) { glideAt = pan; pan = null; if (e.timeStamp - lastT < 80) glide(); }
        }
        if (!cur || e.pointerId !== curId) return;
        if (S.tool === "er") { if (erased) S.save(); }
        else { S.snap(); if (cur.r) delete cur.r; S.strokes.push(cur); S.curEl = null; S.render(); S.save(); }
        cur = null; S.curEl = null; curId = null; erased = false;
      }
      function leave() { if (ring.current) ring.current.classList.remove("on"); }
      L.addEventListener("touchstart", block, { passive: false });
      L.addEventListener("touchmove", block, { passive: false });
      L.addEventListener("wheel", wheel, { passive: false });
      L.addEventListener("pointerdown", down);
      L.addEventListener("pointermove", move);
      L.addEventListener("pointerup", end);
      L.addEventListener("pointercancel", end);
      L.addEventListener("pointerleave", leave);
      return function () {
        L.removeEventListener("touchstart", block); L.removeEventListener("touchmove", block); L.removeEventListener("wheel", wheel);
        L.removeEventListener("pointerdown", down); L.removeEventListener("pointermove", move); L.removeEventListener("pointerup", end);
        L.removeEventListener("pointercancel", end); L.removeEventListener("pointerleave", leave);
        cancelAnimationFrame(fling);
      };
    }, [props.el]);

    /* PNG: 필기 층만 본문 크기 그대로 (배경 = 지금 테마 색). 큰 쪽은 브라우저 한도 안으로 줄인다 */
    function png() {
      var page = props.el, L = layer.current, w = W(), h = Number(L.getAttribute("height")) || page.offsetHeight, cs = getComputedStyle(document.body);
      var k = Math.min(2, 16384 / w, 16384 / h, Math.sqrt(16e6 / (w * h)));
      var copy = L.cloneNode(true), fg = getComputedStyle(root).getPropertyValue("--fg").trim() || "#1f2328";
      copy.setAttribute("xmlns", NS);
      copy.setAttribute("viewBox", "0 0 " + w + " " + h);
      copy.removeAttribute("class");
      Array.prototype.forEach.call(copy.querySelectorAll("path"), function (n) {
        if (n.style.fill.indexOf("var(") >= 0) n.style.fill = fg;
        if (n.getAttribute("class") === "hl") n.style.opacity = ".5";
      });
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        var g = c.getContext("2d");
        g.fillStyle = cs.backgroundColor || "#fff"; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) {
          if (!b) return;
          var a = document.createElement("a");
          a.href = URL.createObjectURL(b);
          var h1 = page.querySelector("h1");
          a.download = ((h1 && h1.textContent) || document.title).trim().replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80) + " 필기.png";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        }, "image/png");
      };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(copy));
    }

    var t = TOOLS[tool];
    var pick = function (fn) { return function () { fn(); }; };
    H.useEffect(function () { savePref(); }, [tool, color, size, ruler]);
    var bar = html`<div class="ink-bar" role="toolbar" aria-label="펜 필기 도구">
      ${["pen", "hl", "er"].map(function (k) { return html`<button type="button" key=${k} class=${k === tool ? "on" : ""} title=${{ pen: "펜", hl: "형광펜", er: "지우개" }[k]} aria-pressed=${k === tool} onClick=${pick(function () { setTool(k); })}><${DS.Icon} paths=${ICO[k]} /></button>`; })}
      ${t.colors ? html`<span class="ink-sep"></span>${t.colors.map(function (c, i) {
        return html`<button type="button" key=${"c" + i} class=${"ink-c" + (i === (color[tool] || 0) ? " on" : "")} title=${"색 " + (i + 1)} style=${"--c:" + c} onClick=${pick(function () { var n = Object.assign({}, color); n[tool] = i; setColor(n); })}><i></i></button>`;
      })}` : null}
      <span class="ink-sep"></span>
      ${t.sizes.map(function (v, i) {
        var dot = Math.round(4 + i * 3.5);
        return html`<button type="button" key=${"s" + i} class=${"ink-s" + (i === (size[tool] == null ? 1 : size[tool]) ? " on" : "")} title=${"크기 " + (i + 1)} onClick=${pick(function () { var n = Object.assign({}, size); n[tool] = i; setSize(n); })}><i style=${{ width: dot + "px", height: dot + "px" }}></i></button>`;
      })}
      <span class="ink-sep"></span>
      <button type="button" class=${ruler ? "on" : ""} aria-pressed=${ruler} title="자: 곧은 선 (가로 · 세로 · 45° 에 붙음. 마우스는 Shift 를 누른 동안도)" onClick=${pick(function () { setRuler(!ruler); })}><${DS.Icon} paths=${ICO.ruler} /></button>
      <button type="button" title="되돌리기 (⌘Z · Ctrl+Z)" disabled=${!S.hist.length} onClick=${undo}><${DS.Icon} paths=${ICO.undo} /></button>
      <button type="button" title="이 쪽 필기 모두 지우기 (되돌리기로 살린다)" disabled=${!S.strokes.length} onClick=${function () { S.snap(); S.strokes = []; S.render(); S.save(); }}><${DS.Icon} paths=${ICO.clear} /></button>
      <button type="button" title="필기 PNG 받기" disabled=${!S.strokes.length} onClick=${png}><${DS.Icon} paths=${ICO.png} /></button>
      <button type="button" title="필기 끝내기 (Esc)" onClick=${function () { props.setOn(false); }}><${DS.Icon} paths=${ICO.close} /></button>
    </div>`;
    /* 막대 · 지우개 원은 화면에 고정 */
    return html`<div class="ink-eraser" ref=${ring}></div>${bar}`;
  };
})();
/* ── 70-views.js ── */
/* 가상 화면 (프로젝트 사이트): 빌드 DB(assets/site-db.json)로 그리는 쪽. 쪽 정보 view 로 고른다 (DS.VIEWS[view]).
   없는 데이터는 빈 칸 대신 「아직 없음」 상태 화면. 목록 행 · 카드 전체를 링크로 만들지 않고 오른쪽 끝 화살표(DS.Go)로 간다 */
(function () {
  "use strict";
  var DS = window.DS, html = DS.html, H = DS.hooks;
  var V = DS.VIEWS = DS.VIEWS || {};
  var U = function (p, q) { return DS.url(p) + (q ? "?" + q : ""); };
  var enc = encodeURIComponent;
  var isOpen = function (s) { return !/닫|closed|done|끝|merged/i.test(String(s || "")); };
  var dayMs = 86400000;
  var today = function () { var d = new Date(); d.setHours(0, 0, 0, 0); return d; };

  /* ── 공통 부품 ── */
  var Card = function (props) {
    return html`<section class=${"dcard" + (props.wide ? " wide" : "")}><div class="dh"><span>${props.title}</span>${props.link ? html`<a class="ilink" href=${props.link}>${props.linkText}</a>` : null}</div>${props.children}</section>`;
  };
  var Empty = function (props) { return html`<div class="kempty">${props.children}</div>`; };
  var Note = function (props) { return html`<p class="vnote">${props.children}</p>`; };
  var Tbl = function (props) {
    return html`<div class="table"><table class="vt"><thead><tr>${props.head.map(function (h, i) { return html`<th key=${i}>${h}</th>`; })}</tr></thead><tbody>${props.children}</tbody></table></div>`;
  };
  var Ids = function (props) { return html`<span class="ids">${(props.ids || []).map(function (x) { return html`<${DS.IdChip} key=${x} id=${x} />`; })}</span>`; };
  var Feat = function (props) { var f = props.f; return f ? html`<a class="ilink" href=${DS.url(f.page)}>${f.no} ${f.name || f.title}</a>` : html`<span class="muted-s">없음</span>`; };
  var Head = function (props) { return html`<div class="vhead"><h1>${props.title}</h1>${props.sub ? html`<span class="muted-s">${props.sub}</span>` : null}${props.acts ? html`<div class="acts">${props.acts}</div>` : null}</div>`; };
  DS.V = { Card: Card, Empty: Empty, Note: Note, Tbl: Tbl, Ids: Ids, Feat: Feat, Head: Head, U: U, isOpen: isOpen };

  var featByNo = function (db, no) { return (db.features || []).find(function (f) { return f.no === no; }) || null; };
  var featOfId = function (db, id, key) { return (db.features || []).find(function (f) { return (f[key] || []).indexOf(id) >= 0; }) || null; };
  var idTitle = function (db, id) { var x = (db.ids || {})[id]; return x && x.title && x.title !== id ? x.title : ""; };
  var stateLabel = function (db, f) { return DS.featDone(db, f) ? "배포됨" : f.stage || "단계 없음"; };
  var stateKind = function (db, f) { return DS.featDone(db, f) ? "done" : DS.stageIdx(db, f) <= 0 ? "wait" : "cur"; };

  /* 기능 × 단계 진행 보드 */
  function FeatBoard(props) {
    var db = props.db, st = db.stages || [], fs = db.features || [];
    if (!fs.length) return html`<${Empty}>기능 문서가 아직 없습니다. docs-site/기능/ 에 기능마다 한 파일을 만들면 여기에 줄이 생깁니다<//>`;
    return html`<div class="board" style=${{ gridTemplateColumns: "minmax(140px, 1.4fr) repeat(" + st.length + ", minmax(0, 1fr))" }}>
      <div class="h">기능</div>${st.map(function (s) { return html`<div class="h" key=${s}>${s}</div>`; })}
      ${fs.map(function (f) {
        return [html`<div class="feat" key=${f.page}><span class="num">${f.no}</span><span class="dt">${f.name || f.title}</span><${DS.Go} href=${DS.url(f.page)} /></div>`,
          st.map(function (s, i) { return html`<div key=${f.page + s}><span class=${"cell " + DS.stageState(db, f, i)} title=${s + " · " + (DS.stageState(db, f, i) === "done" ? "끝남" : DS.stageState(db, f, i) === "cur" ? "지금" : "남음")}></span></div>`; })];
      })}
    </div>`;
  }
  DS.FeatBoard = FeatBoard;

  /* 내 일: 작업 항목 · 이슈 · 나를 부른 의견 */
  DS.myWork = function (db, me) {
    if (!db || !me) return [];
    var out = [];
    (db.workItems || []).filter(function (w) { return w.assignee === me && isOpen(w.state); }).forEach(function (w) { out.push({ k: "작업", t: (w.id ? w.id + " " : "") + w.title, m: w.due ? "마감 " + DS.md(w.due) : w.state || "", href: w.url, ext: true, at: w.due || "" }); });
    ((db.issues || {}).items || []).filter(function (i) { return i.assignee === me && isOpen(i.state); }).forEach(function (i) { out.push({ k: "이슈", t: i.id + " " + i.title, m: i.stage || i.state || "", href: i.url, ext: true, at: i.updated || "" }); });
    var read = DS.my.get("read", {});
    DS.mentionsOf(db, me).filter(function (m) { return !read[m.key]; }).forEach(function (m) { out.push({ k: "언급", t: m.who + ": " + String(m.text).slice(0, 60), m: DS.md(m.at), href: m.href, key: m.key }); });
    return out;
  };
  var WorkRows = function (props) {
    return props.list.length ? props.list.map(function (w, i) {
      return html`<div class="dl" key=${i}><span class="kind">${w.k}</span><span class="dt">${w.t}</span><span class="dm">${w.m}</span><${DS.Go} href=${w.href} ext=${w.ext} onClick=${w.key ? function () { var r = Object.assign({}, DS.my.get("read", {})); r[w.key] = 1; DS.my.set("read", r); } : undefined} /></div>`;
    }) : html`<${Empty}>${props.me ? "맡은 일이 없습니다" : "나 › 프로필에서 내 아이디를 고르면 내 일이 모입니다"}<//>`;
  };
  DS.WorkRows = WorkRows;

  /* 지난 방문 이후 바뀐 문서 */
  var newDocs = function (db) {
    return (db.docs || []).concat((db.features || []).filter(function (f) { return !(db.docs || []).some(function (d) { return d.page === f.page; }); }))
      .filter(function (d) { return DS.isNew(d.page, d.updatedAt); }).sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
  };

  /* ── 프로필 (유형 · 분야) ── */
  var TYPE_NAME = { "new": "신규 구축", enhancement: "운영 · 유지보수", modernization: "차세대", consulting: "분석 · 설계" };
  var DOMAIN_NAME = { web: "웹 · 앱", game: "게임", device: "웨어러블 · 장치", iot: "IoT · 임베디드" };
  var DAY_KEYS = { daysToMilestone: 1, daysToCutover: 1, avgLeadDays: 1 };
  var METRIC_HREF = {
    daysToMilestone: "_/milestones.html", daysToCutover: "_/milestones.html", featureProgress: "_/progress.html", parityDone: "_/progress.html", deliverableProgress: "_/progress.html",
    openIssues: "_/issues.html", openDefects: "_/issues.html", overdue: "_/issues.html", openDiffs: "_/issues.html", avgLeadDays: "_/issues/board.html", releasedThisWeek: "_/issues.html?state=" + enc("닫힘"),
    dueThisWeek: "_/workitems.html", migrationRehearsal: "_/tests.html", confirmedReqs: "_/trace.html", reviewComments: "_/me/mentions.html"
  };
  var METRIC_HINT = {
    openDefects: "결함 이슈가 모이면 셉니다", avgLeadDays: "닫힌 이슈가 생기면 접수부터 닫힘까지 평균을 냅니다", releasedThisWeek: "운영 반영 기록이 생기면 셉니다", overdue: "처리 기한이 있는 이슈가 생기면 셉니다",
    daysToCutover: "전환 마일스톤에 날짜를 정하면 남은 날을 셉니다", parityDone: "정합표에 같음 확인이 쌓이면 셉니다", migrationRehearsal: "이관 리허설 기록이 생기면 보입니다", openDiffs: "정합 검증에서 다름이 나오면 셉니다",
    deliverableProgress: "산출물 문서에 단계를 적으면 셉니다", confirmedReqs: "요구사항에 확정 표시가 생기면 셉니다", pendingDecisions: "대기 중인 결정 문서가 생기면 셉니다", reviewComments: "산출물에 검토 의견이 달리면 셉니다"
  };
  var fmtMetric = function (key, v) { return typeof v === "number" && DAY_KEYS[key] ? v + "일" : v; };
  /* 분야 기본 마일스톤 이름 (원격 · docs-site.json 마일스톤이 없을 때 안내 글에) */
  var msNames = function (db) { var p = DS.profileOf(db), m = (p && p.milestones) || []; return m.length ? "(" + m.join(" → ") + ")" : ""; };
  DS.msNames = msNames;
  /* 검증 단계 줄: 프로필 단계마다 기능들의 결과를 모아 끝남 · 지금 · 남음 (실패가 있으면 실패) */
  function TierStrip(props) {
    var db = props.db, p = DS.profileOf(db), tiers = p.tiers || [];
    var fws = (db.features || []).filter(function (f) { return (f.tiers || []).length; });
    var ms = p.milestones || [];
    var dom = p.domain || "";
    return html`<section class="dcard tier-card"><div class="dh"><span>검증 단계${ms.length > 1 ? " · " + ms[0] + " → " + ms[ms.length - 1] : ""}</span><a class="ilink" href=${U("_/tests.html")}>시나리오</a></div>
      <div class="track tier-track" aria-label="검증 단계">${tiers.map(function (t, i) {
        var res = fws.map(function (f) { var x = f.tiers.find(function (y) { return y.tier === t; }); return x ? DS.tierKind(x) : "wait"; });
        var pass = res.filter(function (k) { return k === "done"; }).length;
        var k = !fws.length ? "wait" : res.some(function (r) { return r === "bad"; }) ? "bad" : pass === fws.length ? "done" : res.some(function (r) { return r !== "wait"; }) ? "cur" : "wait";
        return html`${i ? html`<span class="tier-arrow" aria-hidden="true">→</span>` : null}<span key=${t} class=${"step " + k} title=${t + " · " + (fws.length ? "통과 " + pass + " / " + fws.length : "결과 없음")}>${t}${fws.length ? html`<span class="tier-n">${pass} / ${fws.length}</span>` : null}</span>`;
      })}</div>
      <p class="muted-s tier-note">${fws.length ? "기능마다 검증 절에 남긴 단계별 결과를 모은 것" + (/^(device|iot)$/.test(dom) ? " (어디서 = 보드 판)" : "") : "검증 단계별 결과를 적은 기능이 아직 없습니다. 기능 문서 검증 절에 단계 · 결과 · 어디서를 적으면 모입니다"}</p>
    </section>`;
  }

  /* ── 개요 ── */
  V.dashboard = function (props) {
    var db = props.db, me = DS.meId();
    DS.useMy("notice", {}); DS.useMy("seen", {}); DS.useMy("read", {});
    var ms = (db.milestones || []).filter(function (m) { return m.due; }).sort(function (a, b) { return a.due.localeCompare(b.due); });
    var t0 = today(), next = ms.find(function (m) { return DS.date(m.due) >= t0; }) || null;
    var fs = db.features || [], done = fs.filter(function (f) { return DS.featDone(db, f); }).length;
    var waitN = fs.filter(function (f) { return DS.stageIdx(db, f) <= 0 && !DS.featDone(db, f); }).length;
    var issues = ((db.issues || {}).items || []).filter(function (i) { return isOpen(i.state); });
    var week = (db.workItems || []).filter(function (w) { var d = DS.date(w.due); return d && isOpen(w.state) && d >= t0 && d - t0 < 7 * dayMs; });
    var notices = (db.board || []).slice().sort(function (a, b) { return (b.pinned - a.pinned) || String(b.at).localeCompare(String(a.at)); });
    var noticeRead = DS.my.get("notice", {});
    var unreadN = notices.filter(function (b) { return b.pinned && !noticeRead[b.id]; }).length;
    var team = ((db.team || {}).members || []).length;
    var stat = function (label, href, v, sub, none) { return html`<div class=${"stat" + (none ? " none" : "")}><span class="sl">${label}<${DS.Go} href=${href} /></span><span class="sv">${v}</span><span class="sc">${sub}</span></div>`; };
    var nd = newDocs(db);
    /* 지금(신규 구축) 네 칸: 빌드 DB 로 화면이 센다 */
    var own = {
      daysToMilestone: function (l) { return next ? stat(next.name + "까지", U("_/milestones.html") + "#ms-" + enc(next.name), Math.max(0, Math.ceil((DS.date(next.due) - t0) / dayMs)) + "일", DS.kday(next.due) + (next.progress ? " · 기능 " + next.progress.done + " / " + next.progress.total : ""))
        : stat(l || "마일스톤", U("_/milestones.html"), ms.length ? "끝남" : "없음", ms.length ? "남은 마일스톤 없음" : "마일스톤" + msNames(db) + "을 정하면 남은 날을 셉니다"); },
      featureProgress: function (l) { return stat(l || "기능", U("_/progress.html"), done + " / " + fs.length, "배포 " + done + " · 진행 " + (fs.length - done - waitN) + " · 대기 " + waitN); },
      openIssues: function (l) { return stat(l || "열린 이슈", U("_/issues.html"), issues.length, issues.length ? Object.entries(issues.reduce(function (a, i) { a[i.stage || i.state] = (a[i.stage || i.state] || 0) + 1; return a; }, {})).map(function (x) { return x[0] + " " + x[1]; }).join(" · ") : "열린 이슈 없음"); },
      dueThisWeek: function (l) { return stat(l || "이번 주 마감 작업", U("_/workitems.html"), week.length, week.length ? week.slice(0, 3).map(function (w) { return (w.id || "") + " " + DS.md(w.due); }).join(" · ") : "7일 안 마감 없음"); }
    };
    var prof = DS.profileOf(db), met = db.metrics || {};
    /* 프로필 네 칸: 이름 = profile.dashboard, 값 = 빌드가 센 metrics. 못 구한 값(null)은 무엇이 생기면 세는지 알린다 */
    var cells = prof && (prof.dashboard || []).length ? prof.dashboard.slice(0, 4).map(function (d) {
      var m = met[d.key];
      if (m && m.value != null && m.value !== "") return stat(d.label, METRIC_HREF[d.key] ? U(METRIC_HREF[d.key]) : null, fmtMetric(d.key, m.value), m.sub || "");
      if (own[d.key]) return own[d.key](d.label);
      return stat(d.label, METRIC_HREF[d.key] ? U(METRIC_HREF[d.key]) : null, "아직 없음", METRIC_HINT[d.key] || "빌드가 이 값을 모으면 보입니다", true);
    }) : [own.daysToMilestone(), own.featureProgress(), own.openIssues(), own.dueThisWeek()];
    return html`<div class="view dash">
      <${Head} title=${((db.project || {}).title || db.title || "프로젝트") + " · 대시보드"} sub=${html`${DS.kday(new Date().toISOString())} 기준${db.builtAt ? " · 빌드 " + DS.mdhm(db.builtAt) : ""}${team ? html` · <a class="ilink" href=${U("_/team.html")}>팀 ${team}명 · AI 구성</a>` : null}`} />
      <div class="stats">${cells}</div>
      ${prof && (prof.tiers || []).length ? html`<${TierStrip} db=${db} />` : null}
      <div class="dash-grid">
        <${Card} wide=${true} title="기능 진행" link=${U("_/progress.html")} linkText="진행 현황"><${FeatBoard} db=${db} /><//>
        <${Card} title=${html`공지 · 게시판${unreadN ? html` <span class="unread">안 읽음 ${unreadN}</span>` : null}`} link=${U("_/board.html")} linkText="게시판">
          ${notices.length ? notices.slice(0, 4).map(function (b) {
            return html`<div class="dl" key=${b.id}>${b.pinned && !noticeRead[b.id] ? html`<span class="udot" title="안 읽음"></span>` : null}${b.pinned ? html`<span class="pin">공지</span>` : null}<span class="dt">${b.title}</span><span class="dm">${DS.md(b.at)}</span><${DS.Go} href=${U("_/board/post.html", "id=" + enc(b.id))} /></div>`;
          }) : html`<${Empty}>올라온 글이 없습니다<//>`}
        <//>
      </div>
      <div class="dash-grid three">
        <${Card} title=${"내 일" + (me ? " · " + me : "")} link=${U("_/me/work.html")} linkText="내 일 전체"><${WorkRows} list=${DS.myWork(db, me).slice(0, 5)} me=${me} /><//>
        <${Card} title="열린 이슈" link=${U("_/issues/board.html")} linkText="처리 보드">
          ${issues.length ? issues.slice(0, 5).map(function (i) { return html`<div class="dl" key=${i.id}><span class="idc">${i.id}</span><span class="dt">${i.title}</span><${DS.State} k=${/검증/.test(i.stage) ? "done" : /접수/.test(i.stage) ? "wait" : "cur"}>${i.stage || i.state}<//><${DS.Go} href=${i.url} ext=${true} /></div>`; }) : html`<${Empty}>열린 이슈가 없습니다<//>`}
        <//>
        <${Card} title=${html`지난 방문 이후${DS.since ? html` <span class="muted-s">${DS.mdhm(DS.since)}</span>` : null}`} link=${U("_/recent.html")} linkText="전체">
          ${!DS.since ? html`<${Empty}>다음 방문부터 그 사이에 바뀐 문서를 모아 보입니다<//>` : nd.length ? nd.slice(0, 6).map(function (d) { return html`<div class="dl" key=${d.page}><span class="dt">${d.title}</span><span class="dm">${DS.mdhm(d.updatedAt)}</span><${DS.DiffGo} page=${d.page} /><${DS.Go} href=${DS.url(d.page)} /></div>`; }) : html`<${Empty}>새로 바뀐 문서가 없습니다<//>`}
        <//>
      </div>
    </div>`;
  };

  V.progress = function (props) {
    var db = props.db;
    var feats = (db.features || []).map(function (f) { return f.page; });
    var ch = (db.changes || []).filter(function (c) { return feats.indexOf(c.page) >= 0; });
    return html`<div class="view">
      <${Head} title="진행 현황" sub="기능마다 명세 → 설계 → 구현 → 검증 → 배포" />
      <${FeatBoard} db=${db} />
      ${(db.milestones || []).length ? html`<h2>마일스톤</h2>${(db.milestones || []).map(function (m) { var p = m.progress || { done: 0, total: 0 }; return html`<div class="dl" key=${m.name}><span class="dt">${m.name}</span><span class="dm">${m.due ? DS.md(m.due) + " 까지" : ""}</span><span class="pbar" title=${p.done + " / " + p.total}><i style=${{ width: (p.total ? Math.round(p.done * 100 / p.total) : 0) + "%" }}></i></span><span class="dm">${p.done} / ${p.total}</span><${DS.Go} href=${U("_/milestones.html") + "#ms-" + enc(m.name)} /></div>`; })}` : null}
      <h2>최근 기능 문서 변경</h2>
      ${ch.length ? html`<${Tbl} head=${["때", "기능", "바꾼 이", "무엇", ""]}>${ch.map(function (c, i) { var f = DS.featureOf(db, c.page); return html`<tr key=${i}><td>${DS.mdhm(c.at)}</td><td><${Feat} f=${f} /></td><td>${c.by}</td><td>${c.summary}</td><td class="go-td"><${DS.Go} href=${DS.url(c.page)} /></td></tr>`; })}<//>` : html`<${Empty}>기능 문서 변경 기록이 아직 없습니다<//>`}
    </div>`;
  };

  V.recent = function (props) {
    var db = props.db;
    DS.useMy("seen", {});
    var docs = (db.docs || []).slice().sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); }).slice(0, 40);
    return html`<div class="view">
      <${Head} title="최근 바뀐 문서" sub=${DS.since ? "지난 방문 " + DS.mdhm(DS.since) + " 이후 바뀐 것은 새로 표시" : ""} acts=${newDocs(db).length ? html`<button type="button" class="abtn" onClick=${function () { newDocs(db).forEach(function (d) { DS.markSeen(d.page, d.updatedAt); }); }}>모두 확인함</button>` : null} />
      <h2>바뀐 내용</h2>
      ${(db.changes || []).length ? html`<${Tbl} head=${["때", "문서", "바꾼 이", "무엇", "ID", ""]}>${db.changes.map(function (c, i) {
        return html`<tr key=${i} class=${DS.isNew(c.page, c.at) ? "chg" : ""}><td>${DS.mdhm(c.at)}</td><td>${DS.titleOf(c.page)}${DS.isNew(c.page, c.at) ? html`<span class="newb">새로</span>` : null}</td><td>${c.by}</td><td>${c.summary}</td><td><${Ids} ids=${c.ids} /></td><td class="go-td"><${DS.DiffGo} page=${c.page} /><${DS.Go} href=${DS.url(c.page)} /></td></tr>`;
      })}<//>` : html`<${Empty}>git 기록이 아직 없습니다<//>`}
      <h2>문서</h2>
      ${docs.length ? html`<${Tbl} head=${["문서", "탭", "바뀐 때", "바꾼 이", ""]}>${docs.map(function (d) {
        return html`<tr key=${d.page}><td>${d.title}${DS.isNew(d.page, d.updatedAt) ? html`<span class="newb">새로</span>` : null}</td><td>${d.group || ""}</td><td>${DS.mdhm(d.updatedAt)}</td><td>${d.updatedBy || ""}</td><td class="go-td"><${DS.DiffGo} page=${d.page} /><${DS.Go} href=${DS.url(d.page)} /></td></tr>`;
      })}<//>` : html`<${Empty}>문서가 아직 없습니다<//>`}
    </div>`;
  };

  /* 팀 · 설정: 빌드가 허용 목록으로 내보낸 칸만 그린다 */
  V.team = function (props) {
    var t = props.db.team || {}, ai = t.ai || {}, kit = t.kit || {}, prof = DS.profileOf(props.db);
    var LV = { block: "막음", warn: "알림", off: "끔", on: "켬" };
    var kv = function (rows) { rows = rows.filter(function (r) { return r[1] != null && r[1] !== ""; }); return rows.length ? html`<div class="kv">${rows.map(function (r) { return html`<div key=${r[0]}><span>${r[0]}</span><div>${r[1]}</div></div>`; })}</div>` : null; };
    return html`<div class="view">
      <${Head} title="팀 · 설정" sub="workspace.json 의 팀 · AI 구성 · 프로젝트 설정. 바꾸려면 채팅에서 말하거나 kedovi 명령으로 고치고 커밋합니다" />
      ${prof ? html`<h2>유형 · 분야</h2>${kv([["유형", TYPE_NAME[prof.type] || prof.type], ["분야", DOMAIN_NAME[prof.domain] || prof.domain], ["진행 방식", prof.approach], ["사람 관문", (prof.gates || []).join(" · ")], ["에이전트 도구 추천", (prof.tools || []).join(" · ")]])}` : null}
      ${(t.members || []).length ? html`<h2>참여 인원</h2><${Tbl} head=${["아이디", "이름", "역할", "담당 repo"]}>${t.members.map(function (m) { return html`<tr key=${m.id}><td><span class="who"><${DS.Avatar} id=${m.id} />${m.id}</span></td><td>${m.name || ""}</td><td>${m.role ? html`<span class="pin">${m.role}</span>` : ""}</td><td>${(m.repos || []).join(" · ") || "전체"}</td></tr>`; })}<//>` : null}
      ${ai.tool || ai.mainModel || ai.teamMode ? html`<h2>AI 구성</h2>${kv([["쓰는 AI", ai.tool], ["메인 모델", ai.mainModel], ["팀 모드", ai.teamMode]])}` : null}
      ${(ai.roles || []).length ? html`<${Tbl} head=${["역할", "모델", "하는 일"]}>${ai.roles.map(function (r) { return html`<tr key=${r.role}><td>${r.role}</td><td><code>${r.model}</code></td><td>${r.desc || ""}</td></tr>`; })}<//>` : null}
      ${(ai.enforce || []).length ? html`<h2>지키는 장치</h2><${Tbl} head=${["장치", "수준"]}>${ai.enforce.map(function (e) { return html`<tr key=${e.name}><td>${e.name}</td><td><${DS.State} k=${e.level === "block" ? "cur" : "wait"}>${LV[e.level] || e.level}<//></td></tr>`; })}<//>` : null}
      ${kit.version || (kit.packs || []).length || (t.repos || []).length ? html`<h2>프로젝트 설정</h2>${kv([["킷 판", kit.version], ["팩", (kit.packs || []).join(" · ")], ["repo", (t.repos || []).map(function (r) { return r.name + (r.kind || r.stack ? " (" + [r.kind === "code" ? "코드" : r.kind === "ref" ? "참고" : r.kind, r.stack].filter(Boolean).join(", ") + ")" : ""); }).join(" · ")]])}` : null}
      ${!prof && !(t.members || []).length && !ai.tool && !kit.version ? html`<${Empty}>팀 · 설정 정보가 아직 없습니다<//>` : null}
    </div>`;
  };

  /* ── 설계 ── */
  function Frame(props) {
    return html`<div class="vframe"><iframe src=${props.src} title=${props.title} loading="lazy"></iframe></div>`;
  }
  function pick(list, key) { var q = DS.param(key); return list.find(function (x) { return x.p === q; }) || list[0]; }
  V.erd = function (props) {
    var list = props.meta.erds || [], cur = pick(list, "p");
    return html`<div class="view full">
      <${Head} title="ERD" sub=${cur ? cur.t : ""} acts=${cur ? html`${list.length > 1 ? list.map(function (e) { return html`<a key=${e.p} class=${"vchip" + (e === cur ? " on" : "")} href=${U("_/erd.html", "p=" + enc(e.p))}>${e.t}</a>`; }) : null}<a class="abtn" href=${DS.url(cur.p)} target="_blank" rel="noopener">새 창<${DS.Icon} paths=${DS.ICON.ext} size=${14} /></a>` : null} />
      ${cur ? html`<${Frame} src=${DS.url(cur.p)} title="ERD" />` : html`<${Empty}>테이블 정의 md 를 docs-site/데이터/ 에 쓰면 ERD 가 생깁니다 (datamodel 팩)<//>`}
    </div>`;
  };
  V.storyboard = function (props) {
    var list = props.meta.sheets || [], cur = pick(list, "p");
    return html`<div class="view full">
      <${Head} title="화면설계서" sub=${cur ? cur.t : ""} acts=${cur ? html`${list.length > 1 ? list.map(function (e) { return html`<a key=${e.p} class=${"vchip" + (e === cur ? " on" : "")} href=${U("_/storyboard.html", "p=" + enc(e.p))}>${e.t}</a>`; }) : null}<a class="abtn" href=${DS.url(cur.p)} target="_blank" rel="noopener">새 창<${DS.Icon} paths=${DS.ICON.ext} size=${14} /></a>` : null} />
      ${cur ? html`<${Frame} src=${DS.url(cur.p)} title="화면설계서" />` : html`<${Empty}>화면설계서 장(html)을 docs-site/화면/ 에 두면 여기에서 봅니다 (screens 팩)<//>`}
    </div>`;
  };

  /* 테이블: 정의 문서의 그 절(### 스키마.테이블)을 읽어 컬럼 표를 보인다 */
  V.table = function (props) {
    var db = props.db, id = DS.param("id") || "";
    var x = (db.ids || {})[id];
    var s = H.useState(null), sec = s[0], setSec = s[1];
    H.useEffect(function () {
      setSec(null);
      if (!x || !x.page) return;
      DS.fetchPage(x.page).then(function (d) {
        var box = document.createElement("div"); box.innerHTML = d.body;
        var h = Array.prototype.find.call(box.querySelectorAll("h2, h3, h4"), function (e) { return new RegExp("(^|[\\s.])" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)").test(e.textContent.replace(/#\s*$/, "").trim()); });
        if (!h) { setSec(""); return; }
        var out = [], n = h.nextElementSibling;
        while (n && !/^H[1-4]$/.test(n.tagName)) { out.push(n.outerHTML); n = n.nextElementSibling; }
        setSec(out.join(""));
      }, function () { setSec(""); });
    }, [id]);
    var users = (db.features || []).filter(function (f) { return (f.tables || []).indexOf(id) >= 0; });
    var erd = (props.meta.erds || [])[0];
    if (!x) return html`<div class="view"><${Head} title="테이블" /><${Empty}>${id ? id + " 테이블을 찾지 못했습니다" : "테이블을 고르세요"}<//></div>`;
    return html`<div class="view">
      <${Head} title=${html`<code>${id}</code>`} sub=${x.title && x.title !== id ? x.title : ""} acts=${html`${erd ? html`<a class="abtn" href=${U("_/erd.html")}>ERD 에서 보기</a>` : null}<a class="abtn" href=${DS.url(x.page) + "#" + enc(id)}>정의 문서</a>`} />
      <div class="kv"><div><span>쓰는 기능</span><div>${users.length ? users.map(function (f, i) { return html`${i ? " · " : ""}<${Feat} f=${f} />`; }) : "없음"}</div></div><div><span>관계</span><div><${DS.IdChip} id=${id} /></div></div></div>
      ${sec == null ? html`<p class="muted-s">불러오는 중…</p>` : sec ? html`<div class="ds-body tbl-sec" dangerouslySetInnerHTML=${{ __html: sec }}></div>` : html`<${Empty}>정의 문서에서 이 테이블의 컬럼 표를 찾지 못했습니다<//>`}
    </div>`;
  };

  /* 화면 상세: 정본(화면설계서 장) · 구현 비교 · 체크리스트 */
  V.screen = function (props) {
    var db = props.db, id = DS.param("id") || "";
    var ts = H.useState("정본"), tab = ts[0], setTab = ts[1];
    var f = featOfId(db, id, "scr");
    var sheet = (props.meta.sheets || []).find(function (s) { return (s.ids || []).indexOf(id) >= 0; });
    if (!id || !(db.ids || {})[id] && !f) return html`<div class="view"><${Head} title="화면 상세" /><${Empty}>${id ? id + " 화면을 찾지 못했습니다" : "화면을 고르세요"}<//></div>`;
    return html`<div class="view">
      <${Head} title=${html`<span class="idc big">${id}</span> ${idTitle(db, id)}`} acts=${html`${sheet ? html`<a class="abtn" href=${U("_/storyboard.html", "p=" + enc(sheet.p))}>설계서에서 보기</a>` : null}<a class="abtn" href=${U("_/all/screen.html")}>화면 전체</a>`} />
      <div class="kv"><div><span>기능</span><div><${Feat} f=${f} /></div></div><div><span>API</span><div><${Ids} ids=${f ? f.api : []} /></div></div><div><span>테이블</span><div><${Ids} ids=${f ? f.tables : []} /></div></div></div>
      <div class="subtabs" role="tablist">${["정본", "구현 비교", "체크리스트"].map(function (t) { return html`<button type="button" role="tab" key=${t} class=${t === tab ? "on" : ""} aria-selected=${t === tab} onClick=${function () { setTab(t); }}>${t}</button>`; })}</div>
      ${tab === "정본" ? (sheet ? html`<${Frame} src=${DS.url(sheet.p) + "#" + enc(id)} title="화면설계서" />` : html`<${Empty}>화면설계서에 이 화면 장이 아직 없습니다. 프로토타입이 화면 정본입니다 (screens 팩)<//>`)
        : tab === "구현 비교" ? html`<${Empty}>구현 화면과 정본을 찍어 비교한 기록이 아직 없습니다 (kedovi screens compare)<//>`
        : html`<${Empty}>화면 요소 체크리스트는 구현에 착수할 때 만듭니다 (kedovi screens checklist)<//>`}
    </div>`;
  };

  /* API: 코드 repo 의 openapi 파일을 Scalar 로 (이 화면에서만 jsDelivr 에서 읽는다, 판 고정). 없으면 기능 문서의 API 표 */
  var SCALAR = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.40.0/dist/browser/standalone.js";
  function ApiTable(props) {
    var db = props.db, rows = [];
    (db.features || []).forEach(function (f) { (f.api || []).forEach(function (a) { rows.push({ id: a, f: f }); }); });
    return rows.length ? html`<${Tbl} head=${["ID", "설명", "기능"]}>${rows.map(function (r) { return html`<tr key=${r.id}><td><${DS.IdChip} id=${r.id} /></td><td>${idTitle(db, r.id)}</td><td><${Feat} f=${r.f} /></td></tr>`; })}<//>` : html`<${Empty}>기능 문서의 설계 절에 API ID 를 쓰거나 코드 repo 에 openapi.json 을 두면 여기에 보입니다<//>`;
  }
  /* AsyncAPI: 서버 없이 빌드가 풀어 둔 channels 를 표로 (채널 · 동작 · 메시지 · 필드) */
  var ACT = { send: "보냄", publish: "보냄", receive: "받음", subscribe: "받음" };
  function AsyncTable(props) {
    var rows = [];
    (props.spec.channels || []).forEach(function (c) {
      var ms = (c.messages || []).length ? c.messages : [{ name: "", fields: [] }];
      ms.forEach(function (m, i) { rows.push({ c: c, m: m, first: i === 0, n: ms.length }); });
    });
    return html`<${Tbl} head=${["채널", "동작", "메시지", "필드"]}>${rows.map(function (r, i) {
      return html`<tr key=${i}>${r.first ? html`<td rowspan=${r.n}><code>${r.c.name}</code></td><td rowspan=${r.n}>${ACT[r.c.action] || r.c.action || ""}</td>` : null}<td>${r.m.name ? html`<code>${r.m.name}</code>` : html`<span class="muted-s">메시지 없음</span>`}</td><td>${(r.m.fields || []).length ? html`<span class="ifields">${r.m.fields.map(function (f) { return html`<code key=${f}>${f}</code>`; })}</span>` : ""}</td></tr>`;
    })}<//>`;
  }
  var kindName = function (a) { return a.kind === "asyncapi" ? "AsyncAPI" : "OpenAPI"; };
  /* 명세 화면: interfaces(OpenAPI · AsyncAPI) 가 있으면 「인터페이스 명세」, 없으면 지금처럼 apis(OpenAPI) 로 「API 명세」. 주소는 그대로 _/api.html */
  V.api = function (props) {
    var db = props.db, ifs = db.interfaces || [], isIf = ifs.length > 0;
    var list = isIf ? ifs : (db.apis || []).map(function (a) { return Object.assign({ kind: "openapi" }, a); });
    var q = DS.param("repo"), qk = DS.param("kind");
    var cur = list.find(function (a) { return a.repo === q && (!qk || a.kind === qk); }) || list.find(function (a) { return a.repo === q; }) || list[0];
    var title = isIf ? "인터페이스 명세" : "API 명세";
    var many = function (a) { return list.filter(function (x) { return x.repo === a.repo; }).length > 1; };
    var chips = list.length > 1 ? list.map(function (a, i) { return html`<a key=${i} class=${"vchip" + (a === cur ? " on" : "")} href=${U("_/api.html", "repo=" + enc(a.repo) + (many(a) ? "&kind=" + enc(a.kind) : ""))}>${a.repo}${isIf ? " · " + kindName(a) : ""}</a>`; }) : null;
    if (cur && cur.kind === "asyncapi") {
      var yaml = !(cur.channels || []).length;
      return html`<div class="view">
        <${Head} title=${title} sub=${(cur.title || cur.repo) + " · " + cur.repo + " · AsyncAPI"} acts=${chips} />
        ${yaml ? html`<${Empty}>이 AsyncAPI 명세는 YAML 이라 표로 풀지 않았습니다. <a class="ilink" href=${DS.url(cur.file)} target="_blank" rel="noopener">명세 파일</a>을 열어 봅니다<//>`
          : html`<${AsyncTable} spec=${cur} /><${Note}>채널 · 메시지 표는 빌드가 명세 JSON 을 풀어 그린 것입니다. 원본은 <a class="ilink" href=${DS.url(cur.file)} target="_blank" rel="noopener">명세 파일</a><//>`}
      </div>`;
    }
    var dark = document.documentElement.dataset.theme === "dark";
    var useSpec = cur && !DS.file;
    var doc = useSpec ? '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style></head><body><div id="app"></div><script src="' + SCALAR + '"></script><script>Scalar.createApiReference("#app",{url:' + JSON.stringify(DS.url(cur.file)) + ',darkMode:' + dark + ',hideClientButton:false,withDefaultFonts:false})</script></body></html>' : "";
    return html`<div class="view full">
      <${Head} title=${title} sub=${cur ? cur.title + " · " + cur.repo + (isIf ? " · OpenAPI" : "") : "기능 문서의 API 표"} acts=${chips} />
      ${useSpec ? html`<div class="vframe api"><iframe key=${cur.repo + dark} srcdoc=${doc} title=${title} sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe></div><${Note}>Scalar ${"1.40.0"} 로 그립니다. 인터넷이 막힌 곳이면 <a class="ilink" href=${DS.url(cur.file)}>명세 파일</a>을 받아 봅니다<//>`
        : html`${cur && DS.file ? html`<${Note}>이 PC 파일로 열면 명세 화면을 띄우지 않습니다. kedovi docs serve 로 여세요<//>` : null}<${ApiTable} db=${db} />`}
    </div>`;
  };

  V["all-fn"] = function (props) {
    var db = props.db, fs = (db.features || []).filter(function (f) { return (f.fn || []).length; });
    return html`<div class="view"><${Head} title="기능 명세 전체" sub="기능 문서의 명세 절을 모은 것. 고치는 곳은 각 기능 문서" />
      ${fs.length ? fs.map(function (f) { return html`<section key=${f.page}><h2><${Feat} f=${f} /></h2><${Tbl} head=${["ID", "기능"]}>${f.fn.map(function (x) { return html`<tr key=${x.id}><td><${DS.IdChip} id=${x.id} /></td><td>${x.text}</td></tr>`; })}<//></section>`; }) : html`<${Empty}>기능 ID(FN-)를 쓴 기능 문서가 아직 없습니다<//>`}</div>`;
  };
  V["all-api"] = function (props) {
    return html`<div class="view"><${Head} title="API 전체" sub="기능 문서의 설계 절에 쓴 API ID" /><${ApiTable} db=${props.db} />${(props.db.apis || []).length || (props.db.interfaces || []).length ? html`<${Note}>명세 화면은 <a class="ilink" href=${U("_/api.html")}>${(props.db.interfaces || []).length ? "인터페이스 명세" : "API"}</a> 에서 봅니다<//>` : null}</div>`;
  };
  V["all-screen"] = function (props) {
    var db = props.db, rows = [];
    (db.features || []).forEach(function (f) { (f.scr || []).forEach(function (s) { rows.push({ id: s, f: f }); }); });
    return html`<div class="view"><${Head} title="화면 전체" sub="기능 문서의 설계 절에 쓴 화면 ID" />
      ${rows.length ? html`<${Tbl} head=${["ID", "화면", "기능", ""]}>${rows.map(function (r) { return html`<tr key=${r.id}><td><${DS.IdChip} id=${r.id} /></td><td>${idTitle(db, r.id)}</td><td><${Feat} f=${r.f} /></td><td class="go-td"><${DS.Go} href=${U("_/screen.html", "id=" + enc(r.id))} /></td></tr>`; })}<//>` : html`<${Empty}>화면 ID(SCR-)를 쓴 기능 문서가 아직 없습니다<//>`}</div>`;
  };

  /* ── 테스트 ── */
  V.tests = function (props) {
    var db = props.db, fs = (db.features || []).filter(function (f) { return (f.ac || []).length; });
    var all = fs.reduce(function (a, f) { return a.concat(f.ac); }, []);
    var cnt = function (k) { return all.filter(function (a) { return DS.resultKind(a.result) === k; }).length; };
    return html`<div class="view"><${Head} title="시나리오" sub=${all.length ? "수용 기준 " + all.length + " · 통과 " + cnt("done") + " · 실패 " + cnt("bad") + " · 남음 " + (all.length - cnt("done") - cnt("bad")) : "기능 문서의 검증 절을 모은 것"} />
      ${fs.length ? fs.map(function (f) { return html`<section key=${f.page}><h2><${Feat} f=${f} /></h2><${Tbl} head=${["ID", "수용 기준", "결과"]}>${f.ac.map(function (a) { return html`<tr key=${a.id}><td><${DS.IdChip} id=${a.id} /></td><td>${a.text}</td><td><${DS.State} k=${DS.resultKind(a.result)}>${a.result || "시험 전"}<//></td></tr>`; })}<//></section>`; }) : html`<${Empty}>수용 기준(AC-)을 쓴 기능 문서가 아직 없습니다<//>`}</div>`;
  };
  V.trace = function (props) {
    var db = props.db, rel = db.relations || {};
    var reqs = Object.keys(db.ids || {}).filter(function (k) { return db.ids[k].kind === "REQ"; }).sort();
    var acRes = {};
    (db.features || []).forEach(function (f) { (f.ac || []).forEach(function (a) { acRes[a.id] = a.result; }); });
    var rows = [];
    reqs.forEach(function (r) {
      var fns = Object.keys(rel).filter(function (fn) { return (rel[fn].req || []).indexOf(r) >= 0; });
      if (!fns.length) rows.push({ req: r, fn: null });
      fns.forEach(function (fn) { rows.push({ req: r, fn: fn }); });
    });
    Object.keys(rel).forEach(function (fn) { if (!(rel[fn].req || []).length) rows.push({ req: null, fn: fn }); });
    var none = html`<span class="state wait">없음</span>`;
    return html`<div class="view"><${Head} title="추적표" sub="요구사항에서 시험까지 ID 로 이어진 줄. 없음 = 아직 이어지지 않은 칸" />
      ${rows.length ? html`<${Tbl} head=${["요구사항", "기능", "API · 화면", "시험", "결과"]}>${rows.map(function (x, i) {
        var r = x.fn ? rel[x.fn] : {}, acs = r.ac || [];
        var res = acs.map(function (a) { return acRes[a]; });
        var k = !acs.length ? null : res.every(function (v) { return DS.resultKind(v) === "done"; }) ? "done" : res.some(function (v) { return DS.resultKind(v) === "bad"; }) ? "bad" : "wait";
        return html`<tr key=${i}><td>${x.req ? html`<${DS.IdChip} id=${x.req} />` : none}</td><td>${x.fn ? html`<${DS.IdChip} id=${x.fn} />` : none}</td><td>${(r.api || []).concat(r.scr || []).length ? html`<${Ids} ids=${(r.api || []).concat(r.scr || [])} />` : none}</td><td>${acs.length ? html`<${Ids} ids=${acs} />` : none}</td><td>${k ? html`<${DS.State} k=${k}>${k === "done" ? "통과" : k === "bad" ? "실패 있음" : "시험 전"}<//>` : "-"}</td></tr>`;
      })}<//>` : html`<${Empty}>요구사항(REQ-)과 기능(FN-) ID 가 이어지면 추적표가 생깁니다<//>`}</div>`;
  };

  /* ── 일정 ── */
  V.milestones = function (props) {
    var db = props.db, ms = db.milestones || [];
    H.useEffect(function () { if (location.hash) DS.reveal(location.hash, true); }, []);
    return html`<div class="view"><${Head} title="마일스톤" sub="언제까지 무엇이 되어야 하나. 기능마다 들어갈 마일스톤 하나를 정합니다" />
      ${ms.length ? ms.map(function (m) {
        var p = m.progress || { done: 0, total: 0 }, fs = (m.features || []).map(function (no) { return featByNo(db, no); }).filter(Boolean);
        return html`<section class="msbox" key=${m.name} id=${"ms-" + m.name}>
          <div class="ms-h"><b>${m.name}</b><span class="muted-s">${m.start ? DS.md(m.start) + " ~ " : ""}${m.due ? DS.md(m.due) : "날짜 없음"} · 기능 ${p.done} / ${p.total}</span><span class="pbar"><i style=${{ width: (p.total ? Math.round(p.done * 100 / p.total) : 0) + "%" }}></i></span>${m.url ? html`<${DS.Go} href=${m.url} ext=${true} label="원격에서 보기" />` : null}</div>
          ${fs.length ? fs.map(function (f) { return html`<div class="dl" key=${f.page}><span class="num-s">${f.no}</span><span class="dt">${f.name || f.title}</span><${DS.State} k=${stateKind(db, f)}>${stateLabel(db, f)}<//><${DS.Go} href=${DS.url(f.page)} /></div>`; }) : html`<${Empty}>이 마일스톤에 든 기능이 없습니다<//>`}
        </section>`;
      }) : html`<${Empty}>마일스톤${msNames(db)}이 아직 없습니다. 기능 문서 머리 줄에 마일스톤을 적거나 원격(GitLab · GitHub) 마일스톤을 쓰면 여기에 모입니다<//>`}</div>`;
  };
  V.workitems = function (props) {
    var db = props.db, ws = db.workItems || [], rn = DS.remoteName(db);
    return html`<div class="view"><${Head} title=${(rn ? rn + " " : "") + "작업 항목"} sub=${db.builtAt ? "빌드 " + DS.mdhm(db.builtAt) + " 기준" : ""} />
      ${ws.length ? html`<${Tbl} head=${["#", "작업", "기능", "마일스톤", "담당", "시작", "마감", "상태", ""]}>${ws.map(function (w, i) {
        return html`<tr key=${w.id || i}><td><span class="idc">${w.id}</span></td><td>${w.title}</td><td><${Feat} f=${featByNo(db, w.feature)} /></td><td>${w.milestone || ""}</td><td>${w.assignee || ""}</td><td>${DS.md(w.start)}</td><td>${DS.md(w.due)}</td><td><${DS.State} k=${isOpen(w.state) ? "cur" : "done"}>${w.state}<//></td><td class="go-td"><${DS.Go} href=${w.url} ext=${true} /></td></tr>`;
      })}<//>` : html`<${Empty}>작업 항목이 아직 없습니다. 원격을 붙이면(kedovi remote add) GitLab 작업 항목 · GitHub 이슈를 가져옵니다<//>`}</div>`;
  };

  /* 화면 품질: 화면마다 품질 점검표(kedovi screens quality)의 필수 통과 · 실패 · 판정 없음. 원본은 handoffs/<사람>/screens/<화면 ID>.quality.md */
  V.quality = function (props) {
    var db = props.db, q = db.screenQuality || [];
    var done = q.filter(function (x) { return !x.fail && !x.open && x.measured; }).length;
    return html`<div class="view"><${Head} title="화면 품질" sub=${q.length ? "레이아웃 · 입력 · 목록 · 상태 · 상호작용 · 호환성 · 접근성 · 사용성 · 완료 " + done + "/" + q.length + "개 화면" : ""} />
      ${q.length ? html`<${Tbl} head=${["화면", "수준", "필수 통과", "실패", "판정 없음", "권장", "자동 측정", "담당"]}>${q.map(function (x) {
        var k = x.fail ? "fail" : x.open || !x.measured ? "cur" : "done";
        return html`<tr key=${x.id + x.who}><td><span class="idc">${x.id}</span></td><td>${x.level}</td><td><${DS.State} k=${k}>${x.reqOk}/${x.req}<//></td><td class="num">${x.fail || ""}</td><td class="num">${x.open || ""}</td><td>${x.recOk}/${x.rec}</td><td>${x.measured ? DS.md(x.at) : "안 함"}</td><td>${x.who}</td></tr>`;
      })}<//>` : html`<${Empty}>화면 품질 점검이 아직 없습니다. 화면마다 kedovi screens quality, 전체는 kedovi screens audit<//>`}</div>`;
  };

  /* 백로그: handoffs/PLAN.md 의 「백로그」(이슈형은 「개선 후보」) 절. 정본은 PLAN.md, 여기서는 읽기만 */
  V.backlog = function (props) {
    var db = props.db, b = db.backlog || null, items = (b && b.items) || [], name = (b && b.label) || "백로그";
    return html`<div class="view"><${Head} title=${name} sub=${items.length ? "로드맵(handoffs/PLAN.md)의 「" + name + "」 절 · " + items.length + "개" : ""} />
      ${items.length ? html`<${Tbl} head=${["#", "항목", "추가한 날"]}>${items.map(function (x, i) {
        return html`<tr key=${i}><td class="num">${i + 1}</td><td>${x.text}</td><td>${x.added ? DS.md(x.added) : ""}</td></tr>`;
      })}<//>` : html`<${Empty}>백로그 없음. 로드맵(handoffs/PLAN.md)의 「${name}」 절에 한 줄씩 적으면 여기에 보입니다<//>`}</div>`;
  };

  /* 간트: frappe-gantt (assets/vendor/, 이 화면에서만 읽는다). 줄 = 기능(작업 항목 날짜, 없으면 마일스톤 기간), 마일스톤 = 하루짜리 표시 막대 */
  V.gantt = function (props) {
    var db = props.db, box = H.useRef(null);
    var es = H.useState(""), err = es[0], setErr = es[1];
    var tasks = H.useMemo(function () {
      var out = [], msOf = {};
      (db.milestones || []).forEach(function (m) { msOf[m.name] = m; });
      (db.features || []).forEach(function (f) {
        var wi = (db.workItems || []).filter(function (w) { return w.feature === f.no && (w.start || w.due); });
        var m = msOf[f.milestone] || {};
        var s = wi.map(function (w) { return w.start || w.due; }).concat(wi.length ? [] : [m.start]).filter(Boolean).sort()[0];
        var e = wi.map(function (w) { return w.due || w.start; }).concat(wi.length ? [] : [m.due]).filter(Boolean).sort().pop();
        if (!s || !e) return;
        var n = (db.stages || []).length, k = DS.stageIdx(db, f);
        out.push({ id: "f" + f.no, name: f.no + " " + (f.name || f.title), start: s, end: e, progress: DS.featDone(db, f) ? 100 : k < 0 ? 0 : Math.round(k * 100 / n), custom_class: "g-" + stateKind(db, f), page: f.page });
      });
      (db.milestones || []).forEach(function (m) { if (m.due) out.push({ id: "m-" + m.name, name: "◇ " + m.name, start: m.due, end: m.due, progress: 0, custom_class: "g-ms" }); });
      return out;
    }, [db]);
    H.useEffect(function () {
      if (!tasks.length || !box.current) return;
      var css = "assets/vendor/frappe-gantt.css";
      if (!document.querySelector('link[data-g="1"]')) { var l = document.createElement("link"); l.rel = "stylesheet"; l.href = DS.url(css); l.dataset.g = "1"; document.head.appendChild(l); }
      DS.script("assets/vendor/frappe-gantt.js", function () { return !!window.Gantt; }).then(function () {
        if (!box.current) return;
        box.current.innerHTML = "";
        new window.Gantt(box.current, tasks.map(function (t) { return Object.assign({}, t); }), {
          view_mode: "Week", language: "ko", readonly: true, today_button: false, view_mode_select: false, popup_on: "hover", bar_height: 22, padding: 16, lines: "vertical", scroll_to: "today", infinite_padding: false,
          on_click: function (t) { var x = tasks.find(function (y) { return y.id === t.id; }); if (x && x.page) DS.go(DS.url(x.page)); }
        });
      }, function (e) { setErr(e.message); });
    }, [tasks]);
    return html`<div class="view full"><${Head} title="간트" sub="줄 = 기능 (작업 항목 날짜, 없으면 마일스톤 기간) · ◇ = 마일스톤 마감" />
      ${tasks.length ? html`<div class="gantt-box" ref=${box}></div>${err ? html`<${Empty}>간트를 그리지 못했습니다: ${err}<//>` : null}` : html`<${Empty}>날짜가 있는 마일스톤이나 작업 항목이 생기면 간트를 그립니다<//>`}
    </div>`;
  };

  /* ── 이슈 ── */
  var STAGE_COLS = ["접수", "분석", "수정", "검증"];
  function filterIssues(items, f, me) {
    return items.filter(function (i) {
      if (f.state === "열림" && !isOpen(i.state)) return false;
      if (f.state === "닫힘" && isOpen(i.state)) return false;
      if (f.mine && i.assignee !== me) return false;
      if (f.ms && i.milestone !== f.ms) return false;
      return true;
    });
  }
  /* 저장한 보기: 지금 주소(거르기 포함)에 이름을 붙여 둔다 */
  DS.SaveView = function SaveView(props) {
    var views = DS.useMy("views", []);
    var here = props.page + location.search;
    var mine = views.filter(function (v) { return v.p.split("?")[0] === props.page; });
    return html`<div class="views"><span class="muted-s">저장한 보기</span>${mine.map(function (v) { return html`<a key=${v.name} class=${"vchip" + (v.p === here ? " on" : "")} href=${DS.url(v.p.split("?")[0]) + (v.p.indexOf("?") >= 0 ? v.p.slice(v.p.indexOf("?")) : "")}>${v.name}</a>`; })}
      <button type="button" class="vchip add" onClick=${function () { var n = window.prompt("이 보기 이름", props.suggest || ""); if (!n) return; DS.my.set("views", views.filter(function (v) { return v.name !== n; }).concat([{ name: n, p: here }])); }}>이 보기 저장</button></div>`;
  };
  function NewIssue(props) {
    var db = props.db;
    var os = H.useState(false), open = os[0], setOpen = os[1];
    var ts = H.useState(""), title = ts[0], setTitle = ts[1];
    var bs = H.useState(""), body = bs[0], setBody = bs[1];
    var ms = H.useState(""), msg = ms[0], setMsg = ms[1];
    var mode = DS.writeMode(db);
    if (mode === "none") return html`<${Note}>${DS.writeNote(db)}<//>`;
    if (!open) return html`<button type="button" class="abtn" onClick=${function () { setOpen(true); }}><${DS.Icon} paths=${DS.ICON.plus} size=${14} />새 이슈</button>`;
    function send() {
      if (!title.trim()) return;
      setMsg("올리는 중…");
      var ids = (body.match(/(?<![\w-])[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+(?![\w-])/g) || []);
      DS.write(db, "issue", { title: title.trim(), body: body, ids: ids }).then(function (r) { setMsg(r.ok ? "올렸습니다. 다음 빌드에 목록에 보입니다" : r.opened ? "새 창에서 마무리하세요" : r.error || "올리지 못했습니다"); if (r.ok) { setTitle(""); setBody(""); } });
    }
    return html`<div class="form"><label>제목<input class="tin" value=${title} onInput=${function (e) { setTitle(e.currentTarget.value); }} /></label>
      <label>내용<${DS.MentionInput} db=${db} value=${body} onInput=${setBody} rows=${4} placeholder="무엇이 어떻게 되나 · 관련 ID · @ 로 사람 부르기" label="내용" /></label>
      <div class="board-top"><span class="muted-s">${DS.writeNote(db, "이슈")}</span><span class="acts"><button type="button" class="abtn" onClick=${function () { setOpen(false); }}>취소</button><button type="button" class="abtn pri" disabled=${!title.trim()} onClick=${send}>${mode === "open" ? DS.remoteName(db) + " 에서 쓰기" : "올리기"}</button></span></div>${msg ? html`<div class="muted-s" role="status">${msg}</div>` : null}</div>`;
  }
  V.issues = function (props) {
    var db = props.db, me = DS.meId(), iss = db.issues || {}, items = iss.items || [];
    var f = { state: DS.param("state") || "열림", mine: DS.param("mine") === "1", ms: DS.param("ms") || "" };
    var list = filterIssues(items, f, me);
    var q = function (o) { var x = Object.assign({}, f, o), p = []; if (x.state !== "열림") p.push("state=" + enc(x.state)); if (x.mine) p.push("mine=1"); if (x.ms) p.push("ms=" + enc(x.ms)); return U("_/issues.html", p.join("&")); };
    var mss = [...new Set(items.map(function (i) { return i.milestone; }).filter(Boolean))];
    return html`<div class="view"><${Head} title=${"이슈 " + list.length} sub=${iss.source ? (iss.source === "local" ? "issues/ 폴더의 md" : DS.remoteName(db) + " 이슈") + (db.builtAt ? " · 빌드 " + DS.mdhm(db.builtAt) : "") : ""} acts=${html`<${NewIssue} db=${db} />${iss.url ? html`<a class="abtn" href=${iss.url} target="_blank" rel="noopener">원격에서 보기<${DS.Icon} paths=${DS.ICON.ext} size=${14} /></a>` : null}`} />
      <div class="views">${["열림", "닫힘", "전체"].map(function (s) { return html`<a key=${s} class=${"vchip" + (f.state === s ? " on" : "")} href=${q({ state: s })}>${s}</a>`; })}
        ${me ? html`<a class=${"vchip" + (f.mine ? " on" : "")} href=${q({ mine: !f.mine })}>내 담당</a>` : null}
        ${mss.map(function (m) { return html`<a key=${m} class=${"vchip" + (f.ms === m ? " on" : "")} href=${q({ ms: f.ms === m ? "" : m })}>${m}</a>`; })}</div>
      <${DS.SaveView} page=${props.meta.page} suggest=${[f.ms, f.mine ? "내 담당" : "", f.state].filter(Boolean).join(" · ")} />
      ${list.length ? html`<${Tbl} head=${["번호", "제목", "관련", "단계", "담당", "바뀐 때", ""]}>${list.map(function (i) {
        return html`<tr key=${i.id}><td><span class="idc">${i.id}</span></td><td>${i.title}${(i.labels || []).map(function (l) { return html`<span class="tag" key=${l}>${l}</span>`; })}</td><td><${Ids} ids=${i.ids} /></td><td><${DS.State} k=${isOpen(i.state) ? (/접수/.test(i.stage) ? "wait" : "cur") : "done"}>${i.stage || i.state}<//></td><td>${i.assignee || ""}</td><td>${DS.md(i.updated)}</td><td class="go-td"><${DS.Go} href=${i.url} ext=${!!i.url && /^https?:/.test(i.url)} /></td></tr>`;
      })}<//>` : html`<${Empty}>${items.length ? "이 거르기에 맞는 이슈가 없습니다" : "이슈가 아직 없습니다. 원격이 없으면 issues/ 폴더의 md 를, 있으면 GitLab · GitHub 이슈를 보여 줍니다"}<//>`}
    </div>`;
  };
  V["issues-board"] = function (props) {
    var db = props.db, items = (db.issues || {}).items || [];
    var cols = STAGE_COLS.concat([...new Set(items.map(function (i) { return i.stage; }).filter(function (s) { return s && STAGE_COLS.indexOf(s) < 0; }))]);
    return html`<div class="view"><${Head} title="처리 보드" sub="운영 중 결함 · 요청이 접수 → 분석 → 수정 → 검증으로 흐릅니다" />
      ${items.length ? html`<div class="kanban" style=${{ gridTemplateColumns: "repeat(" + cols.length + ", minmax(160px, 1fr))" }}>${cols.map(function (c) {
        var xs = items.filter(function (i) { return (i.stage || "접수") === c; });
        return html`<div class="kcol" key=${c}><div class="kh">${c} <span>${xs.length}</span></div>${xs.length ? xs.map(function (i) { return html`<div class=${"kcard" + (isOpen(i.state) ? "" : " closed")} key=${i.id}><div class="kt"><span class="idc">${i.id}</span><${DS.Go} href=${i.url} ext=${!!i.url} /></div><div>${i.title}</div>${i.assignee ? html`<span class="muted-s">${i.assignee}${isOpen(i.state) ? "" : " · 닫힘"}</span>` : null}</div>`; }) : html`<${Empty}>없음<//>`}</div>`;
      })}</div>` : html`<${Empty}>이슈가 아직 없습니다<//>`}
    </div>`;
  };
  V["issues-setup"] = function (props) {
    var db = props.db, r = db.remote || {}, iss = db.issues || {}, rn = DS.remoteName(db);
    return html`<div class="view"><${Head} title="연계 설정" />
      <div class="kv"><div><span>원격</span><div>${r.kind ? html`${rn} · <a class="ilink" href=${r.web} target="_blank" rel="noopener">${r.project || r.web}</a>` : "없음"}</div></div>
        <div><span>이슈 출처</span><div>${iss.source === "local" || !iss.source ? "issues/ 폴더의 md" : rn + " 이슈 · 작업 항목"}</div></div>
        ${r.pages ? html`<div><span>팀 공용 사이트</span><div><a class="ilink" href=${r.pages} target="_blank" rel="noopener">${r.pages}</a></div></div>` : null}
        <div><span>마지막 빌드</span><div>${db.builtAt ? DS.mdhm(db.builtAt) : "-"}</div></div></div>
      <h2>새 이슈가 사이트에 뜨는 방식</h2>
      <${Tbl} head=${["방식", "언제 보이나", "설정"]}>
        <tr><td>이슈 · 작업 항목 이벤트로 다시 빌드</td><td>등록 · 수정 1~2분 뒤 모두에게</td><td>GitLab: 프로젝트 웹훅(작업 항목 이벤트)이 파이프라인 트리거를 부름 · GitHub: Actions 의 issues 이벤트</td></tr>
        <tr><td>정해진 시각마다 다시 빌드</td><td>예약 주기만큼 늦게</td><td>웹훅을 못 쓰는 곳의 대비책 (예약 파이프라인)</td></tr>
        <tr><td>로컬 사이트</td><td>저장 바로 뒤</td><td>kedovi start · kedovi docs serve 로 띄운 사이트는 이 PC 의 인증으로 읽고 씁니다</td></tr>
      <//>
      ${r.kind ? null : html`<${Note}>원격이 없으면 issues/ 폴더의 md 를 씁니다. <code>${"kedovi remote add <주소>"}</code> 로 원격을 붙이면 위 설정을 킷이 만들거나 방법을 알려 줍니다<//>`}
    </div>`;
  };

  /* ── 자료실 ── */
  var size = function (n) { return n == null ? "" : n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : n >= 1024 ? Math.round(n / 1024) + "KB" : n + "B"; };
  V.files = function (props) {
    var fs = props.db.files || [];
    return html`<div class="view"><${Head} title="참고 문서" sub="docs-site/자료실/ 에 넣고 커밋하면 목록이 생깁니다" />
      ${fs.length ? html`<${Tbl} head=${["이름", "종류", "올린 이", "때", "크기", ""]}>${fs.map(function (f) { return html`<tr key=${f.path}><td>${f.name}</td><td>${String(f.kind || "").toUpperCase()}</td><td>${f.by || ""}</td><td>${DS.md(f.at)}</td><td class="num-td">${size(f.size)}</td><td class="go-td"><a class="go" href=${DS.url(f.path)} target="_blank" rel="noopener" title="열기" aria-label="열기"><${DS.Icon} paths=${/pdf|png|jpe?g|gif|svg|webp/i.test(f.kind) ? DS.ICON.ext : DS.ICON.download} size=${14} /></a></td></tr>`; })}<//>` : html`<${Empty}>참고 파일이 아직 없습니다<//>`}
      <${Note}>PDF · 그림은 바로 보고, 엑셀 · 발표 파일은 내려받습니다. 수십 MB 넘는 파일은 git LFS 나 외부 드라이브 주소로 둡니다<//>
    </div>`;
  };
  V.board = function (props) {
    var db = props.db, bs = (db.board || []).slice().sort(function (a, b) { return (b.pinned - a.pinned) || String(b.at).localeCompare(String(a.at)); });
    var read = DS.useMy("notice", {});
    return html`<div class="view"><${Head} title="게시판" sub=${"공지 " + bs.filter(function (b) { return b.pinned; }).length + " · 글 " + bs.length} acts=${DS.writeMode(db) !== "none" ? html`<a class="abtn pri" href=${U("_/board/new.html")}>글쓰기</a>` : null} />
      ${bs.length ? html`<${Tbl} head=${["", "제목", "쓴 이", "때", "댓글", ""]}>${bs.map(function (b) { return html`<tr key=${b.id}><td>${b.pinned ? html`<span class="pin">공지</span>` : null}${b.pinned && !read[b.id] ? html`<span class="udot" title="안 읽음"></span>` : null}</td><td>${b.title}</td><td>${b.author}</td><td>${DS.md(b.at)}</td><td class="num-td">${(b.comments || []).length}</td><td class="go-td"><${DS.Go} href=${U("_/board/post.html", "id=" + enc(b.id))} /></td></tr>`; })}<//>` : html`<${Empty}>올라온 글이 없습니다<//>`}
      ${DS.writeMode(db) === "none" ? html`<${Note}>${DS.writeNote(db)}<//>` : null}
    </div>`;
  };
  V.post = function (props) {
    var db = props.db, id = DS.param("id"), b = (db.board || []).find(function (x) { return x.id === id; });
    H.useEffect(function () { if (b && b.pinned) { var r = Object.assign({}, DS.my.get("notice", {})); if (!r[b.id]) { r[b.id] = 1; DS.my.set("notice", r); } } }, [id]);
    if (!b) return html`<div class="view"><${Head} title="게시판 글" /><${Empty}>글을 찾지 못했습니다<//></div>`;
    return html`<div class="view"><${Head} title=${b.title} sub=${html`${b.author} · ${DS.mdhm(b.at)}${b.pinned ? html` · <span class="pin">공지</span>` : null}`} acts=${html`<a class="abtn" href=${U("_/board.html")}>목록</a>${b.url ? html`<a class="abtn" href=${b.url} target="_blank" rel="noopener">원격에서 댓글 달기<${DS.Icon} paths=${DS.ICON.ext} size=${14} /></a>` : null}`} />
      <div class="post-body">${String(b.body || "").split("\n").map(function (l, i) { return html`<p key=${i}>${DS.atText(l)}</p>`; })}</div>
      <h2>댓글 ${(b.comments || []).length}</h2>
      ${(b.comments || []).length ? b.comments.map(function (c, i) { return html`<div class="cm" key=${i}><div class="cw"><${DS.Avatar} id=${c.who} /><b>${c.who}</b><span class="muted-s">${DS.mdhm(c.at)}</span></div><div class="cm-t">${DS.atText(c.text)}</div></div>`; }) : html`<${Empty}>댓글이 없습니다<//>`}
      <${DS.Memo} db=${db} k=${"_/board/post.html?id=" + b.id} />
    </div>`;
  };
  V.write = function (props) {
    var db = props.db;
    var ts = H.useState(""), title = ts[0], setTitle = ts[1];
    var bs = H.useState(""), body = bs[0], setBody = bs[1];
    var ps = H.useState(false), pin = ps[0], setPin = ps[1];
    var ms = H.useState(""), msg = ms[0], setMsg = ms[1];
    var mode = DS.writeMode(db);
    function send() {
      if (!title.trim()) return;
      setMsg("올리는 중…");
      DS.write(db, "board", { title: title.trim(), body: body, pinned: pin }).then(function (r) { setMsg(r.ok ? "올렸습니다. 사이트를 다시 만들면 목록에 보입니다" : r.opened ? "새 창에서 마무리하세요" : r.error || "올리지 못했습니다"); if (r.ok) { setTitle(""); setBody(""); } });
    }
    return html`<div class="view"><${Head} title="글쓰기" acts=${html`<a class="abtn" href=${U("_/board.html")}>목록</a>`} />
      ${mode === "none" ? html`<${Note}>${DS.writeNote(db)}<//>` : html`<div class="form">
        <label>제목<input class="tin" value=${title} onInput=${function (e) { setTitle(e.currentTarget.value); }} /></label>
        <label>내용<${DS.MentionInput} db=${db} value=${body} onInput=${setBody} rows=${8} placeholder="내용 · @ 로 사람 부르기" label="내용" /></label>
        <label class="chk"><input type="checkbox" checked=${pin} onChange=${function (e) { setPin(e.currentTarget.checked); }} />공지로 올리기</label>
        <div class="board-top"><span class="muted-s">${DS.writeNote(db, "이슈")}</span><button type="button" class="abtn pri" disabled=${!title.trim()} onClick=${send}>${mode === "open" ? DS.remoteName(db) + " 에서 쓰기" : "올리기"}</button></div>
        ${msg ? html`<div class="muted-s" role="status">${msg}</div>` : null}
      </div>`}
    </div>`;
  };
})();
/* ── 72-me.js ── */
/* 「나」 공간 (머리 줄 이름 단추): 프로필 · 내 일 · 나를 부른 의견 · 내가 쓴 의견 · 즐겨찾기 · 최근 본 · 저장한 보기 · 내 메모 · 알림 · 보기 설정.
   개인 것은 이 브라우저에만 있다 (DS.my). 보는 사람 아이디는 로컬 서버면 이 PC 의 아이디, 정적 사이트면 여기서 고른다 */
(function () {
  "use strict";
  var DS = window.DS, html = DS.html, H = DS.hooks, V = DS.VIEWS, C = DS.V;
  var Card = C.Card, Empty = C.Empty, Note = C.Note, Tbl = C.Tbl, Head = C.Head, U = C.U;

  /* 보는 사람 고르기 (로컬 서버가 아닐 때) */
  function WhoPicker(props) {
    var db = props.db, me = DS.meId(), members = ((db.team || {}).members || []);
    if (DS.conn.mode === "local" && DS.conn.who && DS.conn.who.me) return html`<p class="muted-s">이 PC 의 kedovi 아이디 <b>${DS.conn.who.me.id}</b> 로 봅니다</p>`;
    return html`<label class="who-pick">보는 사람<select class="tin" value=${me} onChange=${function (e) { DS.my.set("me", e.currentTarget.value); }}>
      <option value="">고르기</option>${members.map(function (m) { return html`<option key=${m.id} value=${m.id}>${m.id}${m.name ? " · " + m.name : ""}</option>`; })}
    </select><span class="muted-s">이 브라우저에만 저장. 내 일 · 나를 부른 의견을 모을 때 씁니다</span></label>`;
  }

  var myComments = function (db, me) {
    var out = [];
    Object.keys(db.comments || {}).forEach(function (p) { (db.comments[p] || []).forEach(function (c) { if (c.who === me) out.push(Object.assign({ page: p }, c)); }); });
    Object.keys(DS.pending).forEach(function (p) { DS.pending[p].forEach(function (c) { out.push(Object.assign({ page: p }, c)); }); });
    return out.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  };

  V.me = function (props) {
    var db = props.db;
    DS.useMy("me", ""); DS.useMy("read", {}); DS.useMy("star", []);
    var me = DS.meId(), m = DS.member(db, me) || {};
    var read = DS.my.get("read", {}), ms = DS.mentionsOf(db, me);
    var stat = function (label, href, v, sub) { return html`<div class="stat"><span class="sl">${label}<${DS.Go} href=${href} /></span><span class="sv">${v}</span><span class="sc">${sub}</span></div>`; };
    var mine = (db.changes || []).filter(function (c) { return me && c.by === me; });
    return html`<div class="view">
      <div class="prof"><${DS.Avatar} id=${me || "?"} lg=${true} /><div><h1>${me || "보는 사람을 고르세요"}</h1><div class="muted-s">${[m.name, m.role, (m.repos || []).length ? "담당 repo " + m.repos.join(" · ") : ""].filter(Boolean).join(" · ")}</div></div></div>
      <${WhoPicker} db=${db} />
      <div class="stats">
        ${stat("내 일", U("_/me/work.html"), DS.myWork(db, me).length, "작업 · 이슈 · 언급")}
        ${stat("나를 부른 의견", U("_/me/mentions.html"), ms.length, "안 읽음 " + ms.filter(function (x) { return !read[x.key]; }).length)}
        ${stat("내가 쓴 의견", U("_/me/comments.html"), me ? myComments(db, me).length : 0, "문서 의견")}
        ${stat("즐겨찾기", U("_/me/saved.html"), DS.my.get("star", []).length, "최근 본 " + DS.my.get("recent", []).length)}
      </div>
      <${Card} title="내가 바꾼 문서">${mine.length ? mine.slice(0, 8).map(function (c, i) { return html`<div class="dl" key=${i}><span class="dm">${DS.mdhm(c.at)}</span><span class="dt">${DS.titleOf(c.page)} · ${c.summary}</span><${DS.Go} href=${DS.url(c.page)} /></div>`; }) : html`<${Empty}>최근 git 기록에 내가 바꾼 문서가 없습니다<//>`}<//>
      <${Note}>이 공간은 보는 사람 한 명의 것입니다. 즐겨찾기 · 메모 · 읽음 표시는 이 브라우저에만 있습니다<//>
    </div>`;
  };
  V["me-work"] = function (props) {
    var db = props.db, me = DS.meId();
    DS.useMy("read", {});
    var list = DS.myWork(db, me);
    return html`<div class="view"><${Head} title="내 일" sub=${me ? me + " 에게 맡겨진 작업 · 이슈 · 아직 안 읽은 언급" : ""} />
      ${!me ? html`<${WhoPicker} db=${db} />` : null}
      ${list.length ? html`<${Tbl} head=${["종류", "무엇", "때 · 상태", ""]}>${list.map(function (w, i) { return html`<tr key=${i}><td><span class="kind">${w.k}</span></td><td>${w.t}</td><td>${w.m}</td><td class="go-td"><${DS.Go} href=${w.href} ext=${w.ext} onClick=${w.key ? function () { var r = Object.assign({}, DS.my.get("read", {})); r[w.key] = 1; DS.my.set("read", r); } : undefined} /></td></tr>`; })}<//>` : html`<${Empty}>${me ? "맡은 일이 없습니다" : "보는 사람을 고르면 내 일이 모입니다"}<//>`}
    </div>`;
  };
  V["me-mentions"] = function (props) {
    var db = props.db, me = DS.meId();
    var read = DS.useMy("read", {});
    var list = DS.mentionsOf(db, me);
    var mark = function (k) { var r = Object.assign({}, DS.my.get("read", {})); r[k] = 1; DS.my.set("read", r); };
    return html`<div class="view"><${Head} title="나를 부른 의견" sub="의견 · 게시판에서 @아이디 로 부른 것. 화살표로 가면 읽음이 됩니다" acts=${list.some(function (m) { return !read[m.key]; }) ? html`<button type="button" class="abtn" onClick=${function () { var r = Object.assign({}, read); list.forEach(function (m) { r[m.key] = 1; }); DS.my.set("read", r); }}>모두 읽음</button>` : null} />
      ${!me ? html`<${WhoPicker} db=${db} />` : null}
      ${list.length ? list.map(function (m) { return html`<div class=${"cm" + (read[m.key] ? "" : " unr")} key=${m.key}><div class="cw"><${DS.Avatar} id=${m.who} /><b>${m.who}</b><span class="muted-s">${DS.mdhm(m.at)} · ${m.title || DS.titleOf(m.page)}</span><${DS.Go} href=${m.href} onClick=${function () { mark(m.key); }} /></div>${m.quote ? html`<div class="cq">${m.quote}</div>` : null}<div class="cm-t">${DS.atText(m.text)}</div></div>`; }) : html`<${Empty}>나를 부른 의견이 없습니다<//>`}
    </div>`;
  };
  V["me-comments"] = function (props) {
    var db = props.db, me = DS.meId(), list = me ? myComments(db, me) : [];
    return html`<div class="view"><${Head} title="내가 쓴 의견" />
      ${list.length ? list.map(function (c, i) { return html`<div class="cm" key=${i}><div class="cw"><span class="muted-s">${DS.mdhm(c.at)} · ${DS.titleOf(c.page)}${c.pending ? " · 다음 빌드에 반영" : ""}</span><${DS.Go} href=${DS.url(c.page)} /></div>${c.quote ? html`<div class="cq">${c.quote}</div>` : null}<div class="cm-t">${DS.atText(c.text)}</div></div>`; }) : html`<${Empty}>${me ? "쓴 의견이 없습니다" : "보는 사람을 고르면 내가 쓴 의견이 모입니다"}<//>`}
    </div>`;
  };
  var href = function (p) { var i = p.indexOf("?"); return i < 0 ? DS.url(p) : DS.url(p.slice(0, i)) + p.slice(i); };
  V["me-saved"] = function () {
    var stars = DS.useMy("star", []), recent = DS.useMy("recent", []);
    return html`<div class="view"><${Head} title="즐겨찾기 · 최근 본" />
      <div class="dash-grid two">
        <${Card} title="즐겨찾기">${stars.length ? stars.map(function (p) { return html`<div class="dl" key=${p}><span class="dt">${DS.titleOf(p)}</span><button type="button" class="lbtn" onClick=${function () { DS.my.set("star", stars.filter(function (x) { return x !== p; })); }}>빼기</button><${DS.Go} href=${href(p)} /></div>`; }) : html`<${Empty}>문서 오른쪽 위 별을 누르면 여기에 모입니다<//>`}<//>
        <${Card} title="최근 본 문서">${recent.length ? recent.slice(0, 12).map(function (p) { return html`<div class="dl" key=${p}><span class="dt">${DS.titleOf(p)}</span><${DS.Go} href=${href(p)} /></div>`; }) : html`<${Empty}>아직 없습니다<//>`}<//>
      </div></div>`;
  };
  V["me-views"] = function () {
    var views = DS.useMy("views", []);
    return html`<div class="view"><${Head} title="저장한 보기" sub="이슈 화면 등에서 거르기를 이름 붙여 저장한 것" />
      ${views.length ? html`<${Tbl} head=${["이름", "어디", "", ""]}>${views.map(function (v) { return html`<tr key=${v.name}><td>${v.name}</td><td>${DS.titleOf(v.p.split("?")[0])}</td><td><button type="button" class="lbtn" onClick=${function () { DS.my.set("views", views.filter(function (x) { return x !== v; })); }}>지우기</button></td><td class="go-td"><${DS.Go} href=${href(v.p)} /></td></tr>`; })}<//>` : html`<${Empty}>저장한 보기가 없습니다. 이슈 화면에서 「이 보기 저장」 을 누르면 여기에 모입니다<//>`}
    </div>`;
  };
  V["me-memos"] = function (props) {
    var memos = DS.useMy("memo", {});
    var keys = Object.keys(memos);
    return html`<div class="view"><${Head} title="내 메모" sub="나만 보입니다. 팀과 나눌 것은 「이슈로 올리기」" />
      ${keys.length ? keys.map(function (k) { return html`<div class="memo-wrap" key=${k}><div class="cw"><span class="mh">${DS.titleOf(k)}</span><${DS.Go} href=${href(k)} /></div><${DS.Memo} db=${props.db} k=${k} /></div>`; }) : html`<${Empty}>메모가 없습니다. 문서 오른쪽 위 메모 단추로 남깁니다<//>`}
    </div>`;
  };
  V["me-settings"] = function (props) {
    var db = props.db, conn = DS.useConn(), r = db.remote || {}, rn = DS.remoteName(db);
    var tok = DS.useMy("token", {});
    var ts = H.useState(""), t = ts[0], setT = ts[1];
    var ms = H.useState(""), msg = ms[0], setMsg = ms[1];
    DS.useMy("seen", {});
    var where = conn.mode === "local" ? "로컬 사이트 (이 PC 의 kedovi 서버)" : conn.mode === "file" ? "이 PC 파일 (쓰기 · 일부 화면 없음, kedovi docs serve 로 여세요)" : "정적 사이트" + (r.pages ? " (" + r.pages + ")" : "");
    var mode = DS.writeMode(db);
    function exp() {
      var b = new Blob([JSON.stringify(DS.my.dump(), null, 1)], { type: "application/json" });
      var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "kedovi-site-" + (db.title || "my") + ".json"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }
    function imp(e) {
      var f = e.currentTarget.files[0]; if (!f) return;
      f.text().then(function (s) { DS.my.restore(JSON.parse(s)); setMsg("가져왔습니다"); }).catch(function (x) { setMsg("가져오지 못했습니다: " + x.message); });
    }
    return html`<div class="view"><${Head} title="알림 · 보기 설정" />
      <h2>지금 연결</h2>
      <div class="kv conn">
        <div><span>보는 곳</span><div>${where}</div></div>
        <div><span>원격</span><div>${r.kind ? html`${rn} · <a class="ilink" href=${r.web} target="_blank" rel="noopener">${r.project || r.web}</a>` : "없음"}</div></div>
        <div><span>쓰기</span><div>${mode === "local" ? "kedovi 서버가 대신 씁니다" + (conn.who && conn.who.where === "remote" ? " (원격 이슈 · 댓글)" : " (파일 · git 커밋)") : mode === "api" ? rn + " 토큰으로 바로 씁니다" : mode === "open" ? "「쓰기」 가 " + rn + " 화면을 새 창으로 엽니다" : "쓰기 없음 (원격을 붙이거나 로컬 사이트로)"}</div></div>
      </div>
      ${r.kind && conn.mode !== "local" ? html`<h2>${rn} 토큰</h2>
        <p class="muted-s">이 브라우저에만 저장하고 사이트에 올리지 않습니다. 의견 · 글 · 이슈를 여기서 바로 쓸 때 씁니다 (권한: ${r.kind === "github" ? "Issues 읽기 · 쓰기" : "api"})</p>
        ${tok[r.kind] ? html`<div class="acts"><span class="state done">넣음</span><button type="button" class="abtn" onClick=${function () { var x = Object.assign({}, tok); delete x[r.kind]; DS.my.set("token", x); }}>지우기</button></div>`
          : html`<div class="acts"><input class="tin" type="password" autocomplete="off" placeholder=${rn + " 접근 토큰"} value=${t} onInput=${function (e) { setT(e.currentTarget.value); }} aria-label="토큰" /><button type="button" class="abtn pri" disabled=${!t.trim()} onClick=${function () { var x = Object.assign({}, tok); x[r.kind] = t.trim(); DS.my.set("token", x); setT(""); }}>저장</button></div>`}` : null}
      <h2>보는 사람</h2><${WhoPicker} db=${db} />
      <h2>알림 · 보기</h2>
      <div class="kv">
        <div><span>멘션 알림</span><div>머리 줄 말풍선에 안 읽은 수. 메일 알림은 ${rn || "원격"} 설정을 따릅니다</div></div>
        <div><span>「새로」 표시</span><div>${DS.since ? "지난 방문 " + DS.mdhm(DS.since) + " 이후 바뀐 문서" : "다음 방문부터"} ${DS.since ? html`<button type="button" class="abtn" onClick=${function () { (db.docs || []).concat(db.features || []).forEach(function (d) { if (DS.isNew(d.page, d.updatedAt)) DS.markSeen(d.page, d.updatedAt); }); setMsg("모두 확인함으로 표시했습니다"); }}>지금 모두 확인함</button>` : null}</div></div>
        <div><span>테마</span><div>머리 줄 테마 단추로 바꿉니다</div></div>
      </div>
      <h2>내 데이터</h2>
      <p class="muted-s">즐겨찾기 · 최근 본 · 저장한 보기 · 메모 · 읽음 표시는 이 브라우저에만 있습니다. PC 를 바꿀 때 파일 하나로 옮깁니다 (토큰은 넣지 않습니다)</p>
      <div class="acts"><button type="button" class="abtn" onClick=${exp}><${DS.Icon} paths=${DS.ICON.download} size=${14} />내보내기</button><label class="abtn"><${DS.Icon} paths=${DS.ICON.upload} size=${14} />가져오기<input type="file" accept="application/json,.json" hidden onChange=${imp} /></label></div>
      ${msg ? html`<p class="muted-s" role="status">${msg}</p>` : null}
    </div>`;
  };
})();
/* ── 90-app.js ── */
/* 앱: 머리 줄(로고 · 상단 탭 · 나 · 멘션 · 검색 · 필기 · 인쇄 · 테마) · 왼쪽 메뉴(지금 탭) · 본문 · 오른쪽 목차 · 이전/다음 · 서랍 · 검색 창.
   쪽 정보(meta)로 그리고 본문(.ds-body)은 그 쪽의 HTML 그대로. 가상 화면(meta.kind = virtual)은 빌드 DB 로 그린다. 근거 패널(iframe) 안이면 본문만 */
(function () {
  "use strict";
  var DS = window.DS, html = DS.html, H = DS.hooks;
  var mount = document.getElementById("ds-app");
  var first = DS.readDoc(document);
  if (!mount || !first) return;   /* 쪽 정보가 없는 옛 쪽: 정적 HTML 그대로 */
  var mac = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);

  function Head(props) {
    var m = props.meta;
    return html`<div class="page-head"><div>
        <div class="crumb">${DS.tabLabel(m.crumb)}${m.status ? html` <span class="ds-badge" data-status=${m.status}>${m.status}</span>` : null}</div>
        <h1 dangerouslySetInnerHTML=${{ __html: m.h1 }}></h1>
        ${m.lead ? html`<p class="lead" dangerouslySetInnerHTML=${{ __html: m.lead }}></p>` : null}
      </div><div class="head-r">${props.tools}${m.src ? html`<a class="src" href=${m.src.href} title="원본 md">원본 ${m.src.name}</a>` : null}</div></div>`;
  }

  function Toc(props) {
    var toc = props.meta.toc || [], on = DS.useSpy(toc, props.meta.page);
    return html`<aside class="toc"><div class="toc-title">이 페이지</div><div id="toc">
      ${toc.length ? toc.map(function (x) { return html`<a key=${x.sid} class=${"l" + x.lvl + (x.sid === on ? " on" : "")} href=${"#" + x.sid}>${x.text}</a>`; }) : html`<div class="empty">${props.meta.title}</div>`}
    </div></aside>`;
  }

  function Pager(props) {
    var m = props.meta;
    if (!m.prev && !m.next) return null;
    var one = function (d, cls, label) { return d ? html`<a class=${cls} href=${DS.url(d.p)}><small>${label} · ${DS.tabLabel(d.g)}</small>${d.t}</a>` : html`<span></span>`; };
    return html`<div class="pager">${one(m.prev, "prev", "이전")}${one(m.next, "next", "다음")}</div>`;
  }

  /* 가상 화면: DB 를 읽는 동안 · 없을 때 */
  function Virtual(props) {
    var db = props.db, V = (DS.VIEWS || {})[props.meta.view];
    if (db == null) return html`<div class="view"><p class="muted-s">불러오는 중…</p></div>`;
    if (db === false) return html`<div class="view"><div class="kempty">빌드 DB(assets/site-db.json)를 읽지 못했습니다. ${DS.file ? "이 PC 파일로 열면 읽지 못합니다. kedovi docs serve 로 여세요" : "kedovi docs build 로 사이트를 다시 만듭니다"}</div></div>`;
    if (!V) return html`<div class="view"><div class="kempty">이 화면은 이 판의 사이트에 없습니다</div></div>`;
    return html`<${V} db=${db} meta=${props.meta} key=${props.meta.page + location.search} />`;
  }

  function App() {
    var ps = H.useState({ d: first, hash: location.hash, y: (history.state && history.state.y) || 0, n: 0 }), cur = ps[0], setCur = ps[1];
    var meta = cur.d.meta, site = meta.site || {};
    var db = DS.useDb();
    DS.useConn();
    var seen = DS.useMy("seen", {});
    var ns = H.useState(false), navOpen = ns[0], setNav = ns[1];
    var narrow = DS.useNarrow();
    var ts = H.useState(document.documentElement.dataset.theme || "light"), theme = ts[0], setTheme = ts[1];
    var is = H.useState(false), ink = is[0], setInk = is[1];
    var zs = H.useState(null), zoom = zs[0], setZoom = zs[1];
    var ss = H.useState(false), search = ss[0], setSearch = ss[1];
    var ds = H.useState(null), drawer = ds[0], setDrawer = ds[1];
    var mm = H.useState(false), memo = mm[0], setMemo = mm[1];
    var cb = H.useState(0), cbump = cb[1];
    var art = H.useRef(null), bodyEl = H.useRef(null);
    var as = H.useState(null), artEl = as[0], setArtEl = as[1];
    var ready = H.useRef(Promise.resolve());
    var project = DS.project;

    H.useEffect(function () {
      DS.onRoute(function (d, opt) { setNav(false); setDrawer(null); setMemo(false); setCur({ d: d, hash: opt.hash, y: opt.y, n: Math.random() }); });
      DS.on("zoom", function (svg) { setZoom(svg); });
      DS.on("drawer", function (d) { setDrawer(d); });
      DS.on("comments", function () { cbump(function (n) { return n + 1; }); });
      setArtEl(art.current);
      function key(e) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearch(function (o) { return !o; }); }
      }
      document.addEventListener("keydown", key);
      /* 본문의 ID 링크 · 의견 밑줄: 프로젝트 사이트에서는 오른쪽 서랍 (수정키를 누르면 링크 그대로) */
      function click(e) {
        if (!project || !DS.db || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !e.target.closest) return;
        var mk = e.target.closest("mark.cmark");
        if (mk) { e.preventDefault(); setDrawer({ kind: "cmt", page: DS.curPage }); return; }
        var a = e.target.closest("a.ds-id, button.ds-def");
        if (!a) return;
        var id = a.textContent.trim();
        if (!(DS.db.ids || {})[id] && !DS.fnsOf(DS.db, id).length) return;
        e.preventDefault();
        setDrawer({ kind: "rel", id: id });
      }
      document.addEventListener("click", click, true);
      return function () { document.removeEventListener("keydown", key); document.removeEventListener("click", click, true); };
    }, []);
    DS.curPage = meta.page;
    /* 새 쪽을 그린 뒤: 제목 · 위치(#ID 는 펼쳐서 · 뒤로 가기는 그 자리) · 그림 · 덧붙임 스크립트 */
    H.useLayoutEffect(function () {
      document.title = meta.head || meta.title;
      if (!(cur.hash && DS.reveal(cur.hash, true))) window.scrollTo(0, cur.y || 0);
      ready.current = DS.drawDiagrams(bodyEl.current);
      DS.emit("page", { el: art.current, meta: meta });
    }, [cur]);
    /* 본문 손질 (그린 바로 뒤, 화면에 보이기 전): 정의 ID 칩 · 바뀐 줄 강조 · 의견 있는 글자에 밑줄 */
    H.useLayoutEffect(function () {
      if (!project || !db || meta.kind !== "doc") return;
      DS.enhanceDoc(bodyEl.current, db, DS.featureOf(db, meta.page));
      DS.markChanges(bodyEl.current, db, meta.page);
      DS.markQuotes(bodyEl.current, ((db.comments || {})[meta.page] || []).concat(DS.pending[meta.page] || []));
    }, [cur, db, cb[0], JSON.stringify(seen)]);
    /* 테마: 기본 라이트, 바꾼 값만 기억 (ERD 뷰어와 같은 키). 그림은 새 색으로 다시 */
    H.useEffect(function () {
      if (document.documentElement.dataset.theme === theme) return;
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem("kedovi-docs-theme", theme); } catch (e) { /* 저장 못 함 */ }
      ready.current = DS.drawDiagrams(bodyEl.current);
      DS.emit("theme", theme);
    }, [theme]);
    /* 좁은 화면 서랍: 본문 스크롤 잠금은 html 에 (body 에 걸면 고정 머리 띠가 밀려난다) */
    H.useEffect(function () {
      document.body.classList.toggle("nav-open", navOpen);
      document.documentElement.classList.toggle("nav-open", navOpen);
      if (!navOpen) return;
      var key = function (e) { if (e.key === "Escape") setNav(false); };
      document.addEventListener("keydown", key);
      return function () { document.removeEventListener("keydown", key); };
    }, [navOpen]);
    H.useEffect(function () { if (!narrow) setNav(false); }, [narrow]);

    var isPrint = meta.kind === "print", isVirtual = meta.kind === "virtual";
    var tab = DS.tabOf(meta.page);
    var feat = project && db ? DS.featureOf(db, meta.page) : null;
    var docExtras = project && db && meta.kind === "doc";
    var body = isPrint ? html`<div class="ds-body" ref=${bodyEl}><${DS.PrintAll} key=${cur.n} meta=${meta} /></div>`
      : isVirtual ? html`<div class="ds-body ds-view" ref=${bodyEl}><${Virtual} db=${db} meta=${meta} /></div>`
      : html`<div class="ds-body" ref=${bodyEl} dangerouslySetInnerHTML=${{ __html: cur.d.body }}></div>`;
    var tools = docExtras ? html`<${DS.DocTools} db=${db} page=${meta.page} comments=${true} memo=${memo} onMemo=${function () { setMemo(!memo); }} />` : null;
    var head = isPrint ? null : isVirtual ? html`<div class="crumb vcrumb">${[tab && tab !== "나" ? DS.tabLabel(tab) : tab, meta.view === "api" && db && (db.interfaces || []).length ? "인터페이스 명세" : meta.title].filter(Boolean).join(" › ")}</div>` : html`<${Head} meta=${meta} tools=${tools} />`;
    var article = html`<main id="main"><article class="page" ref=${art}>${head}
      ${docExtras ? html`<${DS.ChangeBar} db=${db} page=${meta.page} />` : null}
      ${feat ? html`<${DS.FeatHead} db=${db} f=${feat} toc=${meta.toc} />` : null}
      ${docExtras && (memo || DS.my.get("memo", {})[meta.page]) ? html`<${DS.Memo} key=${meta.page} db=${db} k=${meta.page} onClose=${memo ? function () { setMemo(false); } : null} />` : null}
      ${body}</article>${DS.embedded || isPrint || isVirtual ? null : html`<${Pager} meta=${meta} />`}</main>`;
    if (DS.embedded) return html`<div class="layout">${article}</div>`;
    var wide = isVirtual || tab === "나";
    return html`<header>
        <div class="left"><button class="menu-btn" id="menu" type="button" aria-label="메뉴" aria-expanded=${navOpen} aria-controls="side-nav" onClick=${function () { setNav(!navOpen); }}><${DS.Icon} paths=${navOpen ? DS.ICON.close : DS.ICON.menu} /></button><a class="brand" href=${DS.url((window.DS_NAV || {}).home || "index.html")}><span class="logo">${site.logo}</span><span class="brand-t">${site.title}</span></a></div>
        ${narrow ? html`<span></span>` : html`<${DS.Tabs} tab=${tab} />`}
        <div class="tools">${site.version && !project ? html`<span class="ver">${site.version}</span>` : null}
          ${project ? html`<${DS.MeButton} on=${tab === "나"} /><${DS.Inbox} db=${db} />` : null}
          <button id="search-btn" class="search-btn" type="button" title=${"검색 (" + (mac ? "⌘" : "Ctrl+") + "K)"} aria-label="검색" aria-haspopup="dialog" onClick=${function () { setSearch(true); }}><${DS.Icon} paths=${DS.ICON.search} size=${16} /><kbd>${mac ? "⌘K" : "Ctrl K"}</kbd></button>
          ${site.ink && !isPrint && !isVirtual ? html`<button id="ink" type="button" title="펜 필기 (끝내기: Esc)" aria-label="펜 필기" aria-pressed=${ink} onClick=${function () { setInk(!ink); }}><${DS.Icon} paths=${DS.ICON.ink} size=${16} /></button>` : null}
          <${DS.PrintButton} ready=${function () { return ready.current; }} />
          <button id="theme" type="button" title="테마" aria-label="테마" onClick=${function () { setTheme(theme === "dark" ? "light" : "dark"); }}><${DS.Icon} paths=${DS.ICON.theme} size=${16} /></button>
        </div>
      </header>
      <div class=${"layout" + (wide ? " no-toc" : "")}>
        <${DS.Nav} page=${meta.page} tab=${tab} db=${db} toc=${meta.toc} narrow=${narrow} onPick=${function () { setNav(false); }} />
        <div class="nav-backdrop" id="nav-backdrop" onClick=${function () { setNav(false); }}></div>
        ${article}
        ${wide ? null : html`<${Toc} meta=${meta} />`}
      </div>
      ${project && db && drawer ? html`<${DS.Drawer} db=${db} d=${drawer} onClose=${function () { setDrawer(null); }} />` : null}
      ${docExtras && artEl ? html`<${DS.SelButton} el=${bodyEl.current} page=${meta.page} />` : null}
      ${search ? html`<${DS.SearchDialog} db=${db} onClose=${function () { setSearch(false); }} />` : null}
      ${site.ink && artEl && !isPrint && !isVirtual ? html`<${DS.Ink} on=${ink} setOn=${setInk} el=${artEl} page=${meta.page} />` : null}
      ${zoom ? html`<${DS.Zoom} svg=${zoom} onClose=${function () { setZoom(null); }} />` : null}`;
  }

  mount.textContent = "";
  DS.render(html`<${App} />`, mount);
  document.documentElement.classList.add("ds-app");   /* 앱이 그림 (시험 · 덧붙임 스크립트가 기다릴 표시) */
})();
