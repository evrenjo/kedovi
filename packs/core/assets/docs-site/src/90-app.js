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
