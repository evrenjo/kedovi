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
    return html`<div class="chgbar" role="status"><span>지난 방문(${DS.mdhm(DS.since)}) 이후 바뀐 문서입니다${by ? " · " + DS.mdhm(by.at) + " " + (by.by || "") : ""}. 바뀐 줄을 표시했습니다</span><button type="button" class="abtn" onClick=${function () { DS.markSeen(page, d.updatedAt); }}>확인함</button></div>`;
  };

  /* ── 기능 문서 머리: 단계 줄 · 마일스톤 칩(날짜) · 절 이동 ── */
  DS.FeatHead = function FeatHead(props) {
    var db = props.db, f = props.f, st = db.stages || [];
    var ms = (db.milestones || []).find(function (m) { return m.name === f.milestone; });
    var secs = (props.toc || []).filter(function (x) { return x.lvl === 2 && /^(명세|설계|검증)/.test(x.text); });
    return html`<div class="feat-head">
      <div class="feat-row"><div class="track" aria-label="단계">${st.map(function (s, i) { return html`<span key=${s} class=${"step " + DS.stageState(db, f, i)}>${s}</span>`; })}</div>
        ${f.milestone ? html`<span class="mschip">마일스톤 · ${f.milestone}${ms && ms.due ? " · " + DS.kday(ms.due) : ""}<${DS.Go} href=${DS.url("_/milestones.html") + "#ms-" + encodeURIComponent(f.milestone)} label="마일스톤 열기" /></span>` : null}</div>
      ${secs.length ? html`<div class="subtabs">${secs.map(function (s) { return html`<a key=${s.sid} href=${"#" + s.sid}>${s.text}</a>`; })}</div>` : null}
    </div>`;
  };

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
  };

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
    return html`<div class="rel-h"><span class="idc">${id}</span>${def ? html`<${DS.Go} href=${def} label="정의로 가기" ext=${/^https?:/.test(def) && def.indexOf(DS.root) !== 0} />` : null}<button type="button" class="lbtn rel-x" onClick=${props.onClose}>닫기</button></div>
      ${x && x.title && x.title !== id ? html`<div class="rel-t">${x.title}</div>` : null}
      ${fns.length ? fns.map(function (fn) {
        var r = db.relations[fn] || {}, f = DS.fnFeature(db, fn);
        return html`<div class="rel-block" key=${fn}>
          ${f ? html`<div class="muted-s">${f.no} ${f.name || f.title}${f.milestone ? " · 마일스톤 " + f.milestone : ""}${f.stage ? " · " + f.stage : ""}</div>` : null}
          <div class="rel-chain">${row("요구사항", r.req || [])}${row("기능", [fn])}${row("API", r.api || [])}${row("화면", r.scr || [])}${row("테이블", r.tables || [])}${row("시험", r.ac || [])}${row("결정", r.dec || [])}${row("이슈", r.issues || [])}</div>
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
