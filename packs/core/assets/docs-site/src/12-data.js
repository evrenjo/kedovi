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
