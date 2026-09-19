/* TSG Football Pool — scoring, standings and the top-8 simulation.
 *
 * Pure functions, no DOM: app.js renders what these return, and
 * tools/check.mjs runs the same code under node against the data files.
 *
 * Rules (confirmed against Mike's week 1 results email):
 *   - correct pick earns its confidence points, wrong pick earns 0
 *   - weekly rank by total points; ties broken by closeness to the actual
 *     total points of the tiebreaker game (Monday night; latest kickoff)
 *   - top 8 get paid
 * Assumed: a tied NFL game pays nobody.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Pool = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TOP_N = 8;

  // ---------- small helpers ----------
  function gameKey(g) {
    // results and picks are matched by ESPN id, falling back to the team pair
    if (g.espn_id) return "id:" + g.espn_id;
    return "t:" + [g.away, g.home].filter(Boolean).sort().join("-");
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- build the week model ----------
  function buildWeek(weekDoc, resultsDoc) {
    var results = {};
    var byTeam = {};
    ((resultsDoc && resultsDoc.games) || []).forEach(function (r) {
      results[gameKey(r)] = r;
      if (r.away) byTeam[r.away] = r;
      if (r.home) byTeam[r.home] = r;
    });

    var entries = weekDoc.entries || [];
    var n = entries.length;

    var games = (weekDoc.games || []).map(function (g, idx) {
      var r = results[gameKey(g)] || byTeam[g.away] || byTeam[g.home] || null;
      var away = (r && r.away) || g.away, home = (r && r.home) || g.home;
      var status = r ? (r.status || "pre") : "unknown";
      var completed = !!(r && r.completed);
      var as = r ? r.away_score : null, hs = r ? r.home_score : null;
      var leader = null;
      if (as != null && hs != null && (status === "in" || completed)) {
        leader = hs > as ? home : as > hs ? away : null;
      }
      var winner = completed ? (r.winner || null) : null;
      var pHome = r && r.home_win_prob != null ? r.home_win_prob : null;

      // pool consensus for this game
      var side = {};
      side[away] = { team: away, count: 0, pts: 0 };
      side[home] = { team: home, count: 0, pts: 0 };
      entries.forEach(function (e) {
        var pick = e.picks[idx], pts = e.points[idx];
        if (!pick) return;
        if (!side[pick]) side[pick] = { team: pick, count: 0, pts: 0 };
        side[pick].count += 1;
        side[pick].pts += pts || 0;
      });
      Object.keys(side).forEach(function (k) {
        var s = side[k];
        s.pct = n ? s.count / n : 0;
        s.avg = s.count ? s.pts / s.count : 0;
      });

      return {
        idx: idx,
        key: gameKey(g),
        espn_id: (r && r.espn_id) || g.espn_id || null,
        away: away, home: home,
        away_name: (r && r.away_name) || g.away_name || away,
        home_name: (r && r.home_name) || g.home_name || home,
        kickoff: (r && r.kickoff) || g.kickoff || null,
        status: status,                    // pre | in | post | unknown
        completed: completed,
        detail: r ? (r.short_detail || r.detail || "") : "",
        away_score: as, home_score: hs,
        leader: leader,
        winner: winner,                    // abbr | "TIE" | null
        home_win_prob: pHome,
        prob_source: r ? r.prob_source : null,
        odds: r ? r.odds : null,
        pool: { away: side[away], home: side[home], other: Object.keys(side).filter(function (k) { return k !== away && k !== home; }).map(function (k) { return side[k]; }) },
        warning: g.warning || null
      };
    });

    // tiebreaker game = latest kickoff (Monday night; later one if two)
    var tbId = resultsDoc && resultsDoc.tiebreaker_espn_id;
    var tb = null;
    games.forEach(function (g) {
      if (tbId && g.espn_id === tbId) tb = g;
    });
    if (!tb) {
      games.forEach(function (g) {
        if (!tb || (g.kickoff || "") > (tb.kickoff || "")) tb = g;
      });
    }
    var tbTotal = tb && tb.away_score != null && tb.home_score != null && (tb.status === "in" || tb.completed)
      ? tb.away_score + tb.home_score : null;

    var scored = entries.map(function (e) {
      var banked = 0, live = 0, max = 0, remaining = 0, correct = 0, wrong = 0;
      var cells = e.picks.map(function (pick, i) {
        var g = games[i], pts = e.points[i] || 0, state;
        if (!g) return { pick: pick, pts: pts, state: "pending" };
        if (g.completed) {
          if (g.winner === "TIE") { state = "tie"; wrong += 1; }
          else if (g.winner && g.winner === pick) { state = "win"; banked += pts; live += pts; correct += 1; }
          else { state = "loss"; wrong += 1; }
        } else {
          max += pts; remaining += 1;
          if (g.status === "in") {
            if (g.leader === pick) { state = "leading"; live += pts; }
            else if (g.leader) state = "trailing";
            else state = "even";
          } else state = "pending";
        }
        return { pick: pick, pts: pts, state: state };
      });
      var diff = e.mnf_total != null && tbTotal != null ? Math.abs(e.mnf_total - tbTotal) : null;
      return {
        name: e.name,
        picks: e.picks, points: e.points, mnf_total: e.mnf_total,
        warnings: e.warnings || [],
        cells: cells,
        banked: banked, live: live, max: banked + max,
        remaining: remaining, correct: correct, wrong: wrong,
        mnf_diff: diff
      };
    });

    var standings = rankEntries(scored, tbTotal != null);

    return {
      season: weekDoc.season, week: weekDoc.week,
      games: games,
      entries: scored,
      standings: standings,
      tiebreaker: tb ? { game: tb, total: tbTotal, final: tb.completed } : null,
      n_final: games.filter(function (g) { return g.completed; }).length,
      n_live: games.filter(function (g) { return g.status === "in"; }).length,
      n_games: games.length,
      all_final: games.length > 0 && games.every(function (g) { return g.completed; }),
      fetched_at: resultsDoc ? resultsDoc.fetched_at : null
    };
  }

  // Sort by live points, then the tiebreaker once it is meaningful, then name.
  // Rank is "competition" style: tied entries share a rank and the next rank skips.
  function rankEntries(entries, useTiebreak) {
    var sorted = entries.slice().sort(function (a, b) {
      if (b.live !== a.live) return b.live - a.live;
      if (useTiebreak && a.mnf_diff != null && b.mnf_diff != null && a.mnf_diff !== b.mnf_diff) return a.mnf_diff - b.mnf_diff;
      return a.name.localeCompare(b.name);
    });
    var rank = 0;
    sorted.forEach(function (e, i) {
      var prev = sorted[i - 1];
      var tied = prev && prev.live === e.live && !(useTiebreak && prev.mnf_diff != null && e.mnf_diff != null && prev.mnf_diff !== e.mnf_diff);
      if (!tied) rank = i + 1;
      e.rank = rank;
      e.tied = false;
    });
    sorted.forEach(function (e, i) {
      var nb = sorted[i - 1], nx = sorted[i + 1];
      e.tied = (nb && nb.rank === e.rank) || (nx && nx.rank === e.rank) || false;
    });
    return sorted;
  }

  // ---------- Monte Carlo: chance of finishing in the money ----------
  // Unfinished games are drawn from ESPN's win probability (live model during
  // the game, de-vigged moneyline before it) or 50/50 when there is none.
  // Ties for a paid spot share it: (spots left) / (entries tied).
  function simulate(model, opts) {
    opts = opts || {};
    var sims = opts.sims || 5000, topN = opts.topN || TOP_N;
    var rand = mulberry32(opts.seed || 20260918);
    var entries = model.entries, n = entries.length;
    var open = model.games.filter(function (g) { return !g.completed; });
    var m = open.length;

    var pHome = new Float64Array(m);
    open.forEach(function (g, j) { pHome[j] = g.home_win_prob == null ? 0.5 : g.home_win_prob; });

    // per entry: list of (open-game index, points, picked home?) — skip unknown picks
    var stake = entries.map(function (e) {
      var s = [];
      open.forEach(function (g, j) {
        var pick = e.picks[g.idx], pts = e.points[g.idx] || 0;
        if (pick === g.home) s.push([j, pts, 1]);
        else if (pick === g.away) s.push([j, pts, 0]);
      });
      return s;
    });

    var maxTotal = 0;
    entries.forEach(function (e) { if (e.max > maxTotal) maxTotal = e.max; });
    var counts = new Int32Array(maxTotal + 2), aboveAt = new Int32Array(maxTotal + 2);
    var totals = new Int32Array(n);
    var outcome = new Uint8Array(m);
    var top = new Float64Array(n), rankSum = new Float64Array(n), win = new Float64Array(n);

    for (var s = 0; s < sims; s++) {
      for (var j = 0; j < m; j++) outcome[j] = rand() < pHome[j] ? 1 : 0;
      counts.fill(0);
      for (var i = 0; i < n; i++) {
        var t = entries[i].banked, st = stake[i];
        for (var k = 0; k < st.length; k++) if (outcome[st[k][0]] === st[k][2]) t += st[k][1];
        totals[i] = t; counts[t] += 1;
      }
      // above[t] = number of entries strictly above total t
      var above = 0;
      for (var v = maxTotal; v >= 0; v--) { aboveAt[v] = above; above += counts[v]; }
      for (i = 0; i < n; i++) {
        var a = aboveAt[totals[i]], tied = counts[totals[i]];
        if (a < topN) top[i] += Math.min(1, (topN - a) / tied);
        if (a === 0) win[i] += 1 / tied;
        rankSum[i] += a + 1 + (tied - 1) / 2;
      }
    }

    var out = {};
    entries.forEach(function (e, i) {
      out[e.name] = { top: top[i] / sims, win: win[i] / sims, exp_rank: rankSum[i] / sims };
    });
    return { sims: sims, topN: topN, open: m, by_name: out };
  }

  // Everyone is settled once nothing is open: top-8 is 1 or 0 (ties share).
  function settle(model, topN) {
    topN = topN || TOP_N;
    var out = {};
    var st = model.standings;
    st.forEach(function (e) {
      var above = st.filter(function (o) { return o.rank < e.rank; }).length;
      var tied = st.filter(function (o) { return o.rank === e.rank; }).length;
      out[e.name] = { top: above < topN ? Math.min(1, (topN - above) / tied) : 0, win: e.rank === 1 ? 1 / tied : 0, exp_rank: e.rank + (tied - 1) / 2 };
    });
    return { sims: 0, topN: topN, open: 0, by_name: out };
  }

  // ---------- season to date ----------
  // Pay line confirmed by Mike's week 1 results email: places 1..8.
  var PAYOUTS = [130, 110, 90, 65, 40, 30, 25, 20];

  // Money for one finished week, by name. Entries that share a rank split the
  // pooled money for the places they cover: two tied for 7th get (25 + 20) / 2.
  function payouts(standings, payline) {
    payline = payline || PAYOUTS;
    var groups = {};
    standings.forEach(function (e) { (groups[e.rank] = groups[e.rank] || []).push(e); });
    var out = {};
    Object.keys(groups).forEach(function (r) {
      var g = groups[r], first = parseInt(r, 10) - 1, pool = 0;
      for (var i = 0; i < g.length; i++) pool += payline[first + i] || 0;
      g.forEach(function (e) { out[e.name] = pool / g.length; });
    });
    return out;
  }

  // Fold weekly models (from buildWeek) into season standings. A finished week
  // is final and pays; an unfinished week counts its live points, but top-8
  // finishes, wins and money only accrue once the week is final. Entries
  // missing from a week's sheet simply don't accrue that week.
  // Season rank = total points, then top-8 finishes, then best week (assumed:
  // the pool's official prize is weekly).
  function buildSeason(models, opts) {
    opts = opts || {};
    var topN = opts.topN || TOP_N;
    var weeks = models.slice().sort(function (a, b) { return a.week - b.week; });
    var by = {};
    weeks.forEach(function (m) {
      var money = m.all_final ? payouts(m.standings, opts.payline) : {};
      m.standings.forEach(function (e) {
        var s = by[e.name];
        if (!s) s = by[e.name] = { name: e.name, weeks: {}, total: 0, live_pts: 0, played: 0, top8: 0, wins: 0, best: null, best_week: null, rank_sum: 0, money: 0 };
        var top = e.rank <= topN;
        var w = { week: m.week, pts: e.live, rank: e.rank, tied: e.tied, top8: top, final: m.all_final, money: money[e.name] || 0 };
        s.weeks[m.week] = w;
        s.total += e.live; s.played += 1; s.rank_sum += e.rank;
        if (m.all_final) {
          if (top) s.top8 += 1;
          if (e.rank === 1) s.wins += 1;
          s.money += w.money;
        } else s.live_pts += e.live;
        if (s.best == null || e.live > s.best) { s.best = e.live; s.best_week = m.week; }
      });
    });
    var entries = Object.keys(by).map(function (k) {
      var s = by[k];
      s.avg_finish = s.played ? s.rank_sum / s.played : null;
      s.per_week = weeks.map(function (m) { return s.weeks[m.week] || null; });
      return s;
    });
    var standings = entries.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      if (b.top8 !== a.top8) return b.top8 - a.top8;
      if ((b.best || 0) !== (a.best || 0)) return (b.best || 0) - (a.best || 0);
      return a.name.localeCompare(b.name);
    });
    var same = function (a, b) { return a.total === b.total && a.top8 === b.top8 && (a.best || 0) === (b.best || 0); };
    var rank = 0;
    standings.forEach(function (s, i) {
      if (!(i > 0 && same(standings[i - 1], s))) rank = i + 1;
      s.rank = rank;
    });
    standings.forEach(function (s, i) {
      var nb = standings[i - 1], nx = standings[i + 1];
      s.tied = (nb && nb.rank === s.rank) || (nx && nx.rank === s.rank) || false;
    });
    return {
      season: weeks.length ? weeks[0].season : null,
      weeks: weeks.map(function (m) {
        return { week: m.week, final: m.all_final, n_final: m.n_final, n_live: m.n_live, n_games: m.n_games, entries: m.entries.length, fetched_at: m.fetched_at };
      }),
      standings: standings,
      n_final_weeks: weeks.filter(function (m) { return m.all_final; }).length,
      in_progress: weeks.filter(function (m) { return !m.all_final; }).map(function (m) { return m.week; })
    };
  }

  return { TOP_N: TOP_N, PAYOUTS: PAYOUTS, buildWeek: buildWeek, simulate: simulate, settle: settle, gameKey: gameKey, payouts: payouts, buildSeason: buildSeason };
});
