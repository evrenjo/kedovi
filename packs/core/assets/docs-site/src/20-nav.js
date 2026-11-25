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
