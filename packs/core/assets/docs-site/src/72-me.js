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
