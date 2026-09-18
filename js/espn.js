/* Browser-side ESPN scoreboard client — the same shape tools/scores.py writes,
 * so the page can overlay live scores between Actions runs.
 * cdn.espn.com sends Access-Control-Allow-Origin: * (checked 2026-09-18);
 * if that ever stops, everything falls back to the committed results JSON.
 */
(function (root) {
  "use strict";

  var URL = "https://cdn.espn.com/core/nfl/scoreboard?xhr=1&seasontype=2&week={week}&year={season}";

  // ESPN abbreviations are already what the data files use; guard the odd one.
  var ALIAS = { WAS: "WSH", JAC: "JAX", LA: "LAR" };
  function abbr(c) {
    var a = ((c && c.team) || {}).abbreviation || "";
    a = a.toUpperCase();
    return ALIAS[a] || a || null;
  }
  function num(v) { var n = parseInt(v, 10); return isNaN(n) ? null : n; }
  function american(o) {
    var v = parseFloat(String(o == null ? "" : o).replace("+", ""));
    if (!v) return null;
    return v < 0 ? (-v) / (-v + 100) : 100 / (v + 100);
  }
  function erf(x) { // Abramowitz-Stegun 7.1.26, plenty for a spread model
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function spreadProb(spreadHome) { return 0.5 * (1 + erf((-spreadHome) / (13.86 * Math.SQRT2))); }

  function homeWinProb(comp, homeAbbr) {
    var sit = comp.situation || {}, prob = (sit.lastPlay || {}).probability || {};
    var state = ((comp.status || {}).type || {}).state;
    if (state === "in" && prob.homeWinPercentage != null) return [prob.homeWinPercentage, "live"];
    var odds = (comp.odds || [])[0] || {};
    var ml = odds.moneyline || {};
    var h = american(((ml.home || {}).close || {}).odds), a = american(((ml.away || {}).close || {}).odds);
    if (h && a) return [h / (h + a), "moneyline"];
    var spread = odds.spread;
    if (spread == null && odds.details) {
      var d = String(odds.details).split(" ");
      if (d.length === 2 && !isNaN(parseFloat(d[1]))) spread = d[0] === homeAbbr ? parseFloat(d[1]) : -parseFloat(d[1]);
    }
    if (spread != null) return [spreadProb(parseFloat(spread)), "spread"];
    return [null, null];
  }

  function parseEvent(ev) {
    var comp = ev.competitions[0];
    var home = comp.competitors.filter(function (c) { return c.homeAway === "home"; })[0];
    var away = comp.competitors.filter(function (c) { return c.homeAway === "away"; })[0];
    var st = comp.status || ev.status || {}, type = st.type || {};
    var ha = abbr(home), aa = abbr(away);
    var hs = num(home.score), as = num(away.score);
    var completed = !!type.completed, winner = null;
    if (completed) {
      if (home.winner) winner = ha; else if (away.winner) winner = aa;
      else if (hs != null && as != null) winner = hs > as ? ha : as > hs ? aa : "TIE";
    }
    var p = homeWinProb(comp, ha);
    var odds = (comp.odds || [])[0] || null, ml = (odds && odds.moneyline) || {};
    return {
      espn_id: String(ev.id), name: ev.name, short_name: ev.shortName,
      away: aa, home: ha,
      away_name: (away.team || {}).displayName, home_name: (home.team || {}).displayName,
      kickoff: ev.date, neutral_site: !!comp.neutralSite,
      status: type.state, completed: completed,
      detail: type.detail, short_detail: type.shortDetail,
      period: st.period, clock: st.displayClock,
      away_score: as, home_score: hs, winner: winner,
      home_win_prob: p[0] == null ? null : Math.round(p[0] * 1e4) / 1e4, prob_source: p[1],
      odds: odds ? {
        details: odds.details, spread_home: odds.spread, over_under: odds.overUnder,
        moneyline_home: ((ml.home || {}).close || {}).odds, moneyline_away: ((ml.away || {}).close || {}).odds,
        provider: (odds.provider || {}).name
      } : null
    };
  }

  function parseScoreboard(data, season, week) {
    var events = (((data || {}).content || {}).sbData || {}).events || [];
    var games = events.map(parseEvent).sort(function (a, b) {
      return (a.kickoff || "") < (b.kickoff || "") ? -1 : (a.kickoff || "") > (b.kickoff || "") ? 1 : a.espn_id.localeCompare(b.espn_id);
    });
    var tb = null;
    games.forEach(function (g) { if (!tb || (g.kickoff || "") > (tb.kickoff || "")) tb = g; });
    return {
      season: season, week: week,
      fetched_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      source: "cdn.espn.com (live)",
      tiebreaker_espn_id: tb ? tb.espn_id : null,
      games: games
    };
  }

  function fetchLive(season, week, timeoutMs) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000);
    var url = URL.replace("{week}", week).replace("{season}", season);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("ESPN " + r.status); return r.json(); })
      .then(function (d) {
        var doc = parseScoreboard(d, season, week);
        if (!doc.games.length) throw new Error("ESPN returned no games");
        return doc;
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  root.ESPN = { fetchLive: fetchLive, parseScoreboard: parseScoreboard, parseEvent: parseEvent };
})(typeof self !== "undefined" ? self : this);
