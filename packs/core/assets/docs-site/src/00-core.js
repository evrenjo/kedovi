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
