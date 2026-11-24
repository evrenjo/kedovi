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
