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
    var stat = function (label, href, v, sub) { return html`<div class="stat"><span class="sl">${label}<${DS.Go} href=${href} /></span><span class="sv">${v}</span><span class="sc">${sub}</span></div>`; };
    var nd = newDocs(db);
    return html`<div class="view dash">
      <${Head} title=${((db.project || {}).title || db.title || "프로젝트") + " · 대시보드"} sub=${html`${DS.kday(new Date().toISOString())} 기준${db.builtAt ? " · 빌드 " + DS.mdhm(db.builtAt) : ""}${team ? html` · <a class="ilink" href=${U("_/team.html")}>팀 ${team}명 · AI 구성</a>` : null}`} />
      <div class="stats">
        ${next ? stat(next.name + "까지", U("_/milestones.html") + "#ms-" + enc(next.name), Math.max(0, Math.ceil((DS.date(next.due) - t0) / dayMs)) + "일", DS.kday(next.due) + (next.progress ? " · 기능 " + next.progress.done + " / " + next.progress.total : ""))
          : stat("마일스톤", U("_/milestones.html"), ms.length ? "끝남" : "없음", ms.length ? "남은 마일스톤 없음" : "마일스톤을 정하면 남은 날을 셉니다")}
        ${stat("기능", U("_/progress.html"), done + " / " + fs.length, "배포 " + done + " · 진행 " + (fs.length - done - waitN) + " · 대기 " + waitN)}
        ${stat("열린 이슈", U("_/issues.html"), issues.length, issues.length ? Object.entries(issues.reduce(function (a, i) { a[i.stage || i.state] = (a[i.stage || i.state] || 0) + 1; return a; }, {})).map(function (x) { return x[0] + " " + x[1]; }).join(" · ") : "열린 이슈 없음")}
        ${stat("이번 주 마감 작업", U("_/workitems.html"), week.length, week.length ? week.slice(0, 3).map(function (w) { return (w.id || "") + " " + DS.md(w.due); }).join(" · ") : "7일 안 마감 없음")}
      </div>
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
          ${!DS.since ? html`<${Empty}>다음 방문부터 그 사이에 바뀐 문서를 모아 보입니다<//>` : nd.length ? nd.slice(0, 6).map(function (d) { return html`<div class="dl" key=${d.page}><span class="dt">${d.title}</span><span class="dm">${DS.mdhm(d.updatedAt)}</span><${DS.Go} href=${DS.url(d.page)} /></div>`; }) : html`<${Empty}>새로 바뀐 문서가 없습니다<//>`}
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
        return html`<tr key=${i} class=${DS.isNew(c.page, c.at) ? "chg" : ""}><td>${DS.mdhm(c.at)}</td><td>${DS.titleOf(c.page)}${DS.isNew(c.page, c.at) ? html`<span class="newb">새로</span>` : null}</td><td>${c.by}</td><td>${c.summary}</td><td><${Ids} ids=${c.ids} /></td><td class="go-td"><${DS.Go} href=${DS.url(c.page)} /></td></tr>`;
      })}<//>` : html`<${Empty}>git 기록이 아직 없습니다<//>`}
      <h2>문서</h2>
      ${docs.length ? html`<${Tbl} head=${["문서", "탭", "바뀐 때", "바꾼 이", ""]}>${docs.map(function (d) {
        return html`<tr key=${d.page}><td>${d.title}${DS.isNew(d.page, d.updatedAt) ? html`<span class="newb">새로</span>` : null}</td><td>${d.group || ""}</td><td>${DS.mdhm(d.updatedAt)}</td><td>${d.updatedBy || ""}</td><td class="go-td"><${DS.Go} href=${DS.url(d.page)} /></td></tr>`;
      })}<//>` : html`<${Empty}>문서가 아직 없습니다<//>`}
    </div>`;
  };

  /* 팀 · 설정: 빌드가 허용 목록으로 내보낸 칸만 그린다 */
  V.team = function (props) {
    var t = props.db.team || {}, ai = t.ai || {}, kit = t.kit || {};
    var LV = { block: "막음", warn: "알림", off: "끔", on: "켬" };
    var kv = function (rows) { rows = rows.filter(function (r) { return r[1] != null && r[1] !== ""; }); return rows.length ? html`<div class="kv">${rows.map(function (r) { return html`<div key=${r[0]}><span>${r[0]}</span><div>${r[1]}</div></div>`; })}</div>` : null; };
    return html`<div class="view">
      <${Head} title="팀 · 설정" sub="workspace.json 의 팀 · AI 구성 · 프로젝트 설정. 바꾸려면 채팅에서 말하거나 kedovi 명령으로 고치고 커밋합니다" />
      ${(t.members || []).length ? html`<h2>참여 인원</h2><${Tbl} head=${["아이디", "이름", "역할", "담당 repo"]}>${t.members.map(function (m) { return html`<tr key=${m.id}><td><span class="who"><${DS.Avatar} id=${m.id} />${m.id}</span></td><td>${m.name || ""}</td><td>${m.role ? html`<span class="pin">${m.role}</span>` : ""}</td><td>${(m.repos || []).join(" · ") || "전체"}</td></tr>`; })}<//>` : null}
      ${ai.tool || ai.mainModel || ai.teamMode ? html`<h2>AI 구성</h2>${kv([["쓰는 AI", ai.tool], ["메인 모델", ai.mainModel], ["팀 모드", ai.teamMode]])}` : null}
      ${(ai.roles || []).length ? html`<${Tbl} head=${["역할", "모델", "하는 일"]}>${ai.roles.map(function (r) { return html`<tr key=${r.role}><td>${r.role}</td><td><code>${r.model}</code></td><td>${r.desc || ""}</td></tr>`; })}<//>` : null}
      ${(ai.enforce || []).length ? html`<h2>지키는 장치</h2><${Tbl} head=${["장치", "수준"]}>${ai.enforce.map(function (e) { return html`<tr key=${e.name}><td>${e.name}</td><td><${DS.State} k=${e.level === "block" ? "cur" : "wait"}>${LV[e.level] || e.level}<//></td></tr>`; })}<//>` : null}
      ${kit.version || (kit.packs || []).length || (t.repos || []).length ? html`<h2>프로젝트 설정</h2>${kv([["킷 판", kit.version], ["팩", (kit.packs || []).join(" · ")], ["repo", (t.repos || []).map(function (r) { return r.name + (r.kind || r.stack ? " (" + [r.kind === "code" ? "코드" : r.kind === "ref" ? "참고" : r.kind, r.stack].filter(Boolean).join(", ") + ")" : ""); }).join(" · ")]])}` : null}
      ${!(t.members || []).length && !ai.tool && !kit.version ? html`<${Empty}>팀 · 설정 정보가 아직 없습니다<//>` : null}
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
  V.api = function (props) {
    var db = props.db, list = db.apis || [];
    var q = DS.param("repo"), cur = list.find(function (a) { return a.repo === q; }) || list[0];
    var dark = document.documentElement.dataset.theme === "dark";
    var useSpec = cur && !DS.file;
    var doc = useSpec ? '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style></head><body><div id="app"></div><script src="' + SCALAR + '"></script><script>Scalar.createApiReference("#app",{url:' + JSON.stringify(DS.url(cur.file)) + ',darkMode:' + dark + ',hideClientButton:false,withDefaultFonts:false})</script></body></html>' : "";
    return html`<div class="view full">
      <${Head} title="API 명세" sub=${cur ? cur.title + " · " + cur.repo : "기능 문서의 API 표"} acts=${list.length > 1 ? list.map(function (a) { return html`<a key=${a.repo} class=${"vchip" + (a === cur ? " on" : "")} href=${U("_/api.html", "repo=" + enc(a.repo))}>${a.repo}</a>`; }) : null} />
      ${useSpec ? html`<div class="vframe api"><iframe key=${cur.repo + dark} srcdoc=${doc} title="API 명세" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe></div><${Note}>Scalar ${"1.40.0"} 로 그립니다. 인터넷이 막힌 곳이면 <a class="ilink" href=${DS.url(cur.file)}>명세 파일</a>을 받아 봅니다<//>`
        : html`${cur && DS.file ? html`<${Note}>이 PC 파일로 열면 명세 화면을 띄우지 않습니다. kedovi docs serve 로 여세요<//>` : null}<${ApiTable} db=${db} />`}
    </div>`;
  };

  V["all-fn"] = function (props) {
    var db = props.db, fs = (db.features || []).filter(function (f) { return (f.fn || []).length; });
    return html`<div class="view"><${Head} title="기능 명세 전체" sub="기능 문서의 명세 절을 모은 것. 고치는 곳은 각 기능 문서" />
      ${fs.length ? fs.map(function (f) { return html`<section key=${f.page}><h2><${Feat} f=${f} /></h2><${Tbl} head=${["ID", "기능"]}>${f.fn.map(function (x) { return html`<tr key=${x.id}><td><${DS.IdChip} id=${x.id} /></td><td>${x.text}</td></tr>`; })}<//></section>`; }) : html`<${Empty}>기능 ID(FN-)를 쓴 기능 문서가 아직 없습니다<//>`}</div>`;
  };
  V["all-api"] = function (props) {
    return html`<div class="view"><${Head} title="API 전체" sub="기능 문서의 설계 절에 쓴 API ID" /><${ApiTable} db=${props.db} />${(props.db.apis || []).length ? html`<${Note}>명세 화면은 <a class="ilink" href=${U("_/api.html")}>API</a> 에서 봅니다<//>` : null}</div>`;
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
      }) : html`<${Empty}>마일스톤이 아직 없습니다. 기능 문서 머리 줄에 마일스톤을 적거나 원격(GitLab · GitHub) 마일스톤을 쓰면 여기에 모입니다<//>`}</div>`;
  };
  V.workitems = function (props) {
    var db = props.db, ws = db.workItems || [], rn = DS.remoteName(db);
    return html`<div class="view"><${Head} title=${(rn ? rn + " " : "") + "작업 항목"} sub=${db.builtAt ? "빌드 " + DS.mdhm(db.builtAt) + " 기준" : ""} />
      ${ws.length ? html`<${Tbl} head=${["#", "작업", "기능", "마일스톤", "담당", "시작", "마감", "상태", ""]}>${ws.map(function (w, i) {
        return html`<tr key=${w.id || i}><td><span class="idc">${w.id}</span></td><td>${w.title}</td><td><${Feat} f=${featByNo(db, w.feature)} /></td><td>${w.milestone || ""}</td><td>${w.assignee || ""}</td><td>${DS.md(w.start)}</td><td>${DS.md(w.due)}</td><td><${DS.State} k=${isOpen(w.state) ? "cur" : "done"}>${w.state}<//></td><td class="go-td"><${DS.Go} href=${w.url} ext=${true} /></td></tr>`;
      })}<//>` : html`<${Empty}>작업 항목이 아직 없습니다. 원격을 붙이면(kedovi remote add) GitLab 작업 항목 · GitHub 이슈를 가져옵니다<//>`}</div>`;
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
