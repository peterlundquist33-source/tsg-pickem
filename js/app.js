/* TSG Pick'em — page behaviour. Loads the week's picks + results, overlays
 * live ESPN scores when the browser can reach them, and renders the three
 * views: The Six, the game strip, and the full standings. */
(function () {
  "use strict";

  var SIX = ["Peter Lundquist", "Christian Massett", "Mitch Max", "Noah Thesing", "Logan Rezac", "Sam DuBois"];
  var ME = "Peter Lundquist";
  var SIMS = 5000;

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    index: null, season: null, week: null,
    weekDoc: null, resultsDoc: null, liveDoc: null, liveError: null,
    model: null, sim: null,
    sort: { key: "rank", dir: 1 }, filter: "",
    timer: null, loading: false
  };

  // ---------- utils ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pct(x, d) { return x == null ? "–" : (x * 100).toFixed(d == null ? 0 : d) + "%"; }
  function firstName(n) { return String(n).split(" ")[0]; }
  function norm(n) { return String(n || "").toLowerCase().replace(/\s+/g, " ").trim(); }
  function isSix(name) { var k = norm(name); return SIX.some(function (s) { return norm(s) === k; }); }
  function isMe(name) { return norm(name) === norm(ME); }
  function fmtKick(iso) {
    if (!iso) return "TBD";
    var d = new Date(iso);
    if (isNaN(d)) return "TBD";
    return d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var today = new Date();
    var sameDay = d.toDateString() === today.toDateString();
    return d.toLocaleString([], sameDay ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  function gameLabel(g) {
    if (g.completed) return g.detail && /OT/i.test(g.detail) ? "Final/OT" : "Final";
    if (g.status === "in") return g.detail || "Live";
    if (g.status === "pre") return fmtKick(g.kickoff);
    return "No result yet";
  }
  function fetchJSON(url, opts) {
    return fetch(url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now(), opts || { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); });
  }
  function weekFile(season, week) { return "data/" + season + "/week-" + String(week).padStart(2, "0") + ".json"; }
  function resultsFile(season, week) { return "data/" + season + "/results/week-" + String(week).padStart(2, "0") + ".json"; }

  // ---------- data ----------
  function pickResults() {
    // prefer live ESPN when it is newer / available; committed JSON otherwise
    if (state.liveDoc && state.liveDoc.games && state.liveDoc.games.length) return state.liveDoc;
    return state.resultsDoc;
  }

  function compute() {
    if (!state.weekDoc) return;
    var model = Pool.buildWeek(state.weekDoc, pickResults());
    state.model = model;
    state.sim = model.all_final ? Pool.settle(model) : Pool.simulate(model, { sims: SIMS, seed: 20260918 + model.week });
    renderAll();
  }

  function loadWeek(season, week) {
    state.season = season; state.week = week;
    state.loading = true; setSpin(true);
    state.weekDoc = state.resultsDoc = state.liveDoc = state.model = null;
    setStatus("Loading week " + week + "…", null);
    try { history.replaceState(null, "", "?season=" + season + "&week=" + week); } catch (e) { /* file:// */ }

    return Promise.all([
      fetchJSON(weekFile(season, week)),
      fetchJSON(resultsFile(season, week)).catch(function () { return null; })
    ]).then(function (r) {
      state.weekDoc = r[0]; state.resultsDoc = r[1];
      compute();
      return refreshLive();
    }).catch(function (e) {
      setStatus("Could not load week " + week + ": " + e.message, "error");
      $("six-grid").innerHTML = ""; $("six-tiles").innerHTML = ""; $("games").innerHTML = ""; $("standings").innerHTML = "";
    }).finally(function () { state.loading = false; setSpin(false); scheduleRefresh(); });
  }

  function refreshLive() {
    if (!state.weekDoc) return Promise.resolve();
    setSpin(true);
    var season = state.season, week = state.week;
    return ESPN.fetchLive(season, week).then(function (doc) {
      if (season !== state.season || week !== state.week) return;
      state.liveDoc = doc; state.liveError = null;
      compute();
    }).catch(function (e) {
      state.liveError = e && e.message ? e.message : String(e);
      // fall back: re-read the committed results in case Actions pushed
      return fetchJSON(resultsFile(season, week)).then(function (doc) {
        if (season !== state.season || week !== state.week) return;
        state.resultsDoc = doc; state.liveDoc = null;
        compute();
      }).catch(function () { renderStatus(); });
    }).finally(function () { setSpin(false); });
  }

  function scheduleRefresh() {
    clearTimeout(state.timer);
    var m = state.model;
    if (!m || m.all_final) return;
    var soon = m.games.some(function (g) {
      if (g.status !== "pre" || !g.kickoff) return false;
      var dt = new Date(g.kickoff) - Date.now();
      return dt > -3600e3 && dt < 20 * 60e3;
    });
    var ms = (m.n_live > 0 || soon) ? 45e3 : 5 * 60e3;
    state.timer = setTimeout(function () {
      if (document.visibilityState === "visible") refreshLive().then(scheduleRefresh);
      else scheduleRefresh();
    }, ms);
  }

  // ---------- render ----------
  function setSpin(on) { $("refresh").classList.toggle("spin", !!on); }
  function setStatus(text, cls) {
    $("status").innerHTML = '<span class="dot"></span> <span class="' + (cls || "") + '">' + esc(text) + "</span>";
  }

  function renderStatus() {
    var m = state.model; if (!m) return;
    var parts = [];
    var live = m.n_live > 0;
    parts.push('<span class="dot' + (live ? " live" : "") + '"></span>');
    if (m.all_final) parts.push("<b>Final</b> · all " + m.n_games + " games done");
    else parts.push("<b>" + m.n_final + "</b> of " + m.n_games + " final" + (live ? " · <b class='pos'>" + m.n_live + " live</b>" : ""));
    var src = pickResults();
    if (src) {
      var isLive = src === state.liveDoc;
      parts.push('<span class="dim">·</span> ' + (isLive ? '<span class="pill live">ESPN live</span>' : '<span class="pill">scores as of ' + esc(fmtTime(src.fetched_at)) + "</span>"));
      if (!isLive && state.liveError) parts.push('<span class="dim" title="' + esc(state.liveError) + '">(live feed unavailable)</span>');
    } else {
      parts.push('<span class="pill warn">no scores yet</span>');
    }
    if (m.tiebreaker && m.tiebreaker.total != null) {
      parts.push('<span class="dim">·</span> MNF total <b>' + m.tiebreaker.total + "</b>" + (m.tiebreaker.final ? "" : " (live)"));
    }
    $("status").innerHTML = parts.join(" ");
  }

  function renderAll() {
    var m = state.model;
    $("title").textContent = "Week " + m.week + " · " + m.season;
    document.title = "TSG Pool — Week " + m.week;
    renderStatus();
    renderSix();
    renderGames();
    renderStandings();
  }

  function simFor(name) {
    var s = state.sim && state.sim.by_name[name];
    return s || { top: null, win: null, exp_rank: null };
  }

  function renderSix() {
    var m = state.model;
    var byName = {};
    m.standings.forEach(function (e) { byName[norm(e.name)] = e; });
    var six = SIX.map(function (n) { return byName[norm(n)] || null; });
    var present = six.filter(Boolean);
    $("six-sub").textContent = present.length < SIX.length
      ? "Missing from this week's sheet: " + SIX.filter(function (n, i) { return !six[i]; }).join(", ")
      : (m.all_final ? "Final" : "Top-8 chance from " + SIMS.toLocaleString() + " sims");

    // tiles
    $("six-tiles").innerHTML = SIX.map(function (n, i) {
      var e = six[i];
      if (!e) return '<div class="tile"><div class="name">' + esc(n) + '</div><div class="dim">not in sheet</div></div>';
      var s = simFor(e.name);
      var inMoney = e.rank <= Pool.TOP_N;
      return '<div class="tile' + (isMe(e.name) ? " me" : "") + '">' +
        '<div class="name">' + esc(firstName(e.name)) + '</div>' +
        '<div class="big">' + e.live + '<small>/ ' + e.max + '</small></div>' +
        '<div class="row"><span>Rank</span><b' + (inMoney ? ' class="pos"' : "") + ">" + (e.tied ? "T" : "") + e.rank + "</b></div>" +
        '<div class="row"><span>Left</span><b>' + e.remaining + "</b></div>" +
        (s.exp_rank != null && !m.all_final ? '<div class="row"><span>Proj.</span><b>' + Math.round(s.exp_rank) + "</b></div>" : "") +
        '<div class="prob' + (s.top != null && s.top >= 0.25 ? " hot" : "") + '">Top 8 <b>' + pct(s.top, s.top != null && s.top < 0.1 && s.top > 0 ? 1 : 0) + "</b>" +
        '<div class="bar"><i style="width:' + Math.round((s.top || 0) * 100) + '%"></i></div></div>' +
        "</div>";
    }).join("");

    // picks grid
    var games = m.games.slice().sort(function (a, b) {
      return (a.kickoff || "") < (b.kickoff || "") ? -1 : (a.kickoff || "") > (b.kickoff || "") ? 1 : a.idx - b.idx;
    });
    var head = "<thead><tr><th>Game</th>" + SIX.map(function (n, i) {
      return "<th" + (six[i] && isMe(six[i].name) ? ' class="me"' : "") + ">" + esc(firstName(n)) + "</th>";
    }).join("") + "</tr></thead>";
    var body = "<tbody>" + games.map(function (g) {
      var sub;
      if (g.completed || g.status === "in") {
        sub = g.away + " " + (g.away_score == null ? "" : g.away_score) + " · " + g.home + " " + (g.home_score == null ? "" : g.home_score) + " · " + gameLabel(g);
      } else sub = gameLabel(g);
      var cells = six.map(function (e) {
        if (!e) return "<td></td>";
        var c = e.cells[g.idx];
        if (!c || !c.pick) return '<td><span class="cell pending">–</span></td>';
        return '<td><span class="cell ' + c.state + '" title="' + esc(c.state) + '">' + esc(c.pick) + ' <span class="p">' + c.pts + "</span></span></td>";
      }).join("");
      return "<tr><td><span class='g-line'>" + esc(g.away) + " @ " + esc(g.home) + "</span><span class='g-sub" + (g.status === "in" ? " live" : "") + "'>" + esc(sub) + "</span></td>" + cells + "</tr>";
    }).join("") + "</tbody>";
    var foot = "<tfoot>" +
      "<tr><td>Points</td>" + six.map(function (e) { return "<td>" + (e ? e.live : "") + "</td>"; }).join("") + "</tr>" +
      "<tr><td>Max</td>" + six.map(function (e) { return "<td>" + (e ? e.max : "") + "</td>"; }).join("") + "</tr>" +
      "<tr><td>Rank</td>" + six.map(function (e) { return "<td" + (e && e.rank <= Pool.TOP_N ? ' class="hot"' : "") + ">" + (e ? (e.tied ? "T" : "") + e.rank : "") + "</td>"; }).join("") + "</tr>" +
      "<tr><td>MNF</td>" + six.map(function (e) { return "<td>" + (e ? (e.mnf_total == null ? "–" : e.mnf_total) + (e.mnf_diff != null ? ' <span class="dim">±' + e.mnf_diff + "</span>" : "") : "") + "</td>"; }).join("") + "</tr>" +
      "<tr><td>Top 8</td>" + six.map(function (e) { var s = e ? simFor(e.name) : null; return "<td" + (s && s.top >= 0.25 ? ' class="hot"' : "") + ">" + (s ? pct(s.top, s.top < 0.1 && s.top > 0 ? 1 : 0) : "") + "</td>"; }).join("") + "</tr>" +
      "</tfoot>";
    $("six-grid").innerHTML = head + body + foot;
  }

  function renderGames() {
    var m = state.model;
    var games = m.games.slice().sort(function (a, b) {
      return (a.kickoff || "") < (b.kickoff || "") ? -1 : (a.kickoff || "") > (b.kickoff || "") ? 1 : a.idx - b.idx;
    });
    $("games").innerHTML = games.map(function (g) {
      var live = g.status === "in";
      var aw = g.pool.away || { count: 0, pct: 0, avg: 0 }, hm = g.pool.home || { count: 0, pct: 0, avg: 0 };
      var awayCls = g.completed ? (g.winner === g.away ? "winner" : "loser") : "";
      var homeCls = g.completed ? (g.winner === g.home ? "winner" : "loser") : "";
      var wp = "";
      if (!g.completed && g.home_win_prob != null) {
        var fav = g.home_win_prob >= 0.5 ? g.home : g.away, p = g.home_win_prob >= 0.5 ? g.home_win_prob : 1 - g.home_win_prob;
        wp = '<div class="wp">' + (live ? "Win prob" : "Line") + ": <b>" + esc(fav) + " " + pct(p) + "</b>" +
          (!live && g.odds && g.odds.details ? ' <span class="dim">(' + esc(g.odds.details) + (g.odds.over_under ? ", o/u " + g.odds.over_under : "") + ")</span>" : "") + "</div>";
      }
      var showScore = g.completed || live;
      return '<div class="card game' + (live ? " live" : "") + '">' +
        '<div class="hdr"><span class="st ' + (live ? "live" : g.completed ? "final" : "") + '">' + esc(gameLabel(g)) + "</span>" +
        (g.espn_id ? '<a href="https://www.espn.com/nfl/game/_/gameId/' + esc(g.espn_id) + '" target="_blank" rel="noopener" class="dim">ESPN ↗</a>' : "") + "</div>" +
        '<div class="teams">' +
        '<div class="tm ' + awayCls + '"><span class="ab">' + esc(g.away) + '</span><span class="nm">' + esc(g.away_name) + "</span></div>" +
        '<div class="sc">' + (showScore && g.away_score != null ? g.away_score : "") + "</div>" +
        '<div class="tm ' + homeCls + '"><span class="ab">' + esc(g.home) + '</span><span class="nm">' + esc(g.home_name) + "</span></div>" +
        '<div class="sc">' + (showScore && g.home_score != null ? g.home_score : "") + "</div>" +
        "</div>" +
        '<div class="split"><i class="a" style="width:' + Math.round(aw.pct * 100) + '%"></i><i class="h" style="width:' + Math.round(hm.pct * 100) + '%"></i></div>' +
        '<div class="split-lbl"><span><b>' + esc(g.away) + " " + pct(aw.pct) + "</b> · avg " + aw.avg.toFixed(1) + "</span><span>avg " + hm.avg.toFixed(1) + " · <b>" + esc(g.home) + " " + pct(hm.pct) + "</b></span></div>" +
        wp +
        (g.warning ? '<div class="wp neg">' + esc(g.warning) + "</div>" : "") +
        "</div>";
    }).join("");
  }

  var COLS = [
    { key: "rank", label: "#", num: false },
    { key: "name", label: "Name", num: false },
    { key: "live", label: "Pts", num: true, title: "Finished games + games your pick currently leads" },
    { key: "max", label: "Max", num: true, title: "If every remaining pick hits" },
    { key: "remaining", label: "Left", num: true },
    { key: "mnf_total", label: "MNF", num: true, title: "Tiebreaker: predicted Monday night total" },
    { key: "top", label: "Top 8", num: true, title: "Chance of finishing in the money" }
  ];

  function renderStandings() {
    var m = state.model, sim = state.sim;
    var rows = m.standings.map(function (e) {
      var s = simFor(e.name);
      return { e: e, top: s.top, win: s.win };
    });
    var sk = state.sort.key, dir = state.sort.dir;
    rows.sort(function (a, b) {
      var av = sk === "top" ? a.top : sk === "name" ? a.e.name : a.e[sk];
      var bv = sk === "top" ? b.top : sk === "name" ? b.e.name : b.e[sk];
      if (av == null && bv == null) return a.e.rank - b.e.rank;
      if (av == null) return 1; if (bv == null) return -1;
      if (typeof av === "string") return dir * av.localeCompare(bv);
      if (av !== bv) return dir * (av - bv);
      return a.e.rank - b.e.rank;
    });

    var cut = state.sort.key === "rank" && state.sort.dir === 1;
    var lastMoney = -1;
    if (cut) rows.forEach(function (r, i) { if (r.e.rank <= Pool.TOP_N) lastMoney = i; });

    var head = "<thead><tr>" + COLS.map(function (c) {
      var sort = c.key === sk ? (dir === 1 ? "ascending" : "descending") : "none";
      return '<th data-key="' + c.key + '"' + (c.num ? ' class="num"' : "") + ' aria-sort="' + sort + '"' + (c.title ? ' title="' + esc(c.title) + '"' : "") + ">" + esc(c.label) + "</th>";
    }).join("") + "</tr></thead>";

    var f = norm(state.filter);
    var body = "<tbody>" + rows.map(function (r, i) {
      var e = r.e;
      var cls = [];
      if (isSix(e.name)) cls.push("six");
      if (isMe(e.name)) cls.push("me");
      if (e.rank <= Pool.TOP_N) cls.push("money");
      if (cut && i === lastMoney) cls.push("cut");
      if (f && norm(e.name).indexOf(f) < 0) cls.push("hidden");
      var warn = e.warnings.length ? '<span class="warn-ic" title="' + esc(e.warnings.join("\n")) + '">⚠</span>' : "";
      var liveDot = e.live !== e.banked ? '<span class="live-dot" title="includes ' + (e.live - e.banked) + ' pts from games in progress"></span>' : "";
      var mnf = (e.mnf_total == null ? "–" : e.mnf_total) + (e.mnf_diff != null ? ' <span class="dim">±' + e.mnf_diff + "</span>" : "");
      var top = r.top == null ? "–" : pct(r.top, r.top < 0.1 && r.top > 0 ? 1 : 0) + '<span class="mini-bar"><i style="width:' + Math.round(r.top * 100) + '%"></i></span>';
      return '<tr class="' + cls.join(" ") + '">' +
        '<td class="rank' + (e.tied ? " tie" : "") + '">' + e.rank + "</td>" +
        '<td class="name">' + esc(e.name) + warn + "</td>" +
        '<td class="num">' + e.live + liveDot + "</td>" +
        '<td class="num">' + e.max + "</td>" +
        '<td class="num">' + e.remaining + "</td>" +
        '<td class="num">' + mnf + "</td>" +
        '<td class="num">' + top + "</td>" +
        "</tr>";
    }).join("") + "</tbody>";
    $("standings").innerHTML = head + body;
    $("standings-sub").textContent = m.entries.length + " entries" + (sim && sim.open ? " · " + sim.open + " games open" : "");

    Array.prototype.forEach.call($("standings").querySelectorAll("th"), function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-key");
        var def = (key === "rank" || key === "name" || key === "remaining") ? 1 : -1;
        if (state.sort.key === key) state.sort.dir = -state.sort.dir;
        else state.sort = { key: key, dir: def };
        renderStandings();
      });
    });
  }

  // ---------- boot ----------
  function populateWeeks() {
    var idx = state.index, sel = $("week");
    var opts = [];
    Object.keys(idx.seasons).sort().forEach(function (season) {
      idx.seasons[season].forEach(function (w) {
        opts.push({ season: parseInt(season, 10), week: w });
      });
    });
    sel.innerHTML = opts.map(function (o) {
      return '<option value="' + o.season + ":" + o.week + '">' + (Object.keys(idx.seasons).length > 1 ? o.season + " · " : "") + "Week " + o.week + "</option>";
    }).join("");
    return opts;
  }

  function init() {
    var q = new URLSearchParams(location.search);
    fetchJSON("data/index.json").then(function (idx) {
      state.index = idx;
      var opts = populateWeeks();
      if (!opts.length) { setStatus("No weeks ingested yet.", "error"); return; }
      var season = parseInt(q.get("season"), 10) || idx.latest.season;
      var week = parseInt(q.get("week"), 10) || idx.latest.week;
      var ok = opts.some(function (o) { return o.season === season && o.week === week; });
      if (!ok) { season = idx.latest.season; week = idx.latest.week; }
      $("week").value = season + ":" + week;
      loadWeek(season, week);
    }).catch(function (e) { setStatus("Could not load data/index.json: " + e.message, "error"); });

    $("week").addEventListener("change", function () {
      var p = this.value.split(":");
      loadWeek(parseInt(p[0], 10), parseInt(p[1], 10));
    });
    $("refresh").addEventListener("click", function () {
      if (state.loading) return;
      refreshLive().then(scheduleRefresh);
    });
    $("find").addEventListener("input", function () { state.filter = this.value; renderStandings(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && state.model && !state.model.all_final) refreshLive().then(scheduleRefresh);
    });
  }

  init();
})();
