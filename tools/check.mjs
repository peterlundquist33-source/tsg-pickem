// Node sanity check: score a week with the site's own logic and print standings.
//   node tools/check.mjs 2026 2            one week: standings + top-8 odds
//   node tools/check.mjs --season 2026     season to date: Crew table + whole-pool top 12
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Pool = require("../js/pool.js");

const SIX = ["Peter Lundquist", "Christian Massett", "Mitch Max", "Noah Thesing", "Logan Rezac", "Sam DuBois", "CJ Woda", "Logan Gacke"];

function readWeek(season, week) {
  const nn = String(week).padStart(2, "0");
  const weekDoc = JSON.parse(readFileSync(new URL(`../data/${season}/week-${nn}.json`, import.meta.url)));
  let resultsDoc = null;
  try { resultsDoc = JSON.parse(readFileSync(new URL(`../data/${season}/results/week-${nn}.json`, import.meta.url))); } catch {}
  return { weekDoc, resultsDoc };
}

function checkWeek(season, week) {
  const { weekDoc, resultsDoc } = readWeek(season, week);
  const model = Pool.buildWeek(weekDoc, resultsDoc);
  const t0 = Date.now();
  const sim = model.all_final ? Pool.settle(model) : Pool.simulate(model, { sims: 5000 });
  const ms = Date.now() - t0;

  console.log(`${season} week ${week}: ${model.entries.length} entries, ${model.n_games} games, ${model.n_final} final, ${model.n_live} live, sim ${sim.sims}x in ${ms}ms`);
  if (model.tiebreaker) console.log(`tiebreaker: ${model.tiebreaker.game.away} @ ${model.tiebreaker.game.home} total=${model.tiebreaker.total}`);
  const fmt = (e) => {
    const s = sim.by_name[e.name];
    return `${String(e.rank).padStart(3)}  ${e.name.padEnd(20)} pts ${String(e.live).padStart(3)} (banked ${String(e.banked).padStart(3)}) max ${String(e.max).padStart(3)} left ${String(e.remaining).padStart(2)} mnf ${String(e.mnf_total).padStart(3)}${e.mnf_diff != null ? ` (±${e.mnf_diff})` : ""}  top8 ${(s.top * 100).toFixed(1).padStart(5)}%  expRank ${s.exp_rank.toFixed(1)}`;
  };
  console.log("--- top 12");
  model.standings.slice(0, 12).forEach((e) => console.log(fmt(e)));
  console.log("--- the six");
  model.standings.filter((e) => SIX.includes(e.name)).forEach((e) => console.log(fmt(e)));
  const sumTop = Object.values(sim.by_name).reduce((a, b) => a + b.top, 0);
  console.log(`sum of top-8 probabilities = ${sumTop.toFixed(3)} (should be ${Math.min(8, model.entries.length)})`);
}

function checkSeason(season) {
  const idx = JSON.parse(readFileSync(new URL(`../data/${season}/index.json`, import.meta.url)));
  const models = idx.weeks.map((w) => { const d = readWeek(season, w); return Pool.buildWeek(d.weekDoc, d.resultsDoc); });
  const s = Pool.buildSeason(models);
  const ord = (n) => { const v = n % 100, t = ["th", "st", "nd", "rd"]; return n + (t[(v - 20) % 10] || t[v] || t[0]); };
  const money = (x) => "$" + (x % 1 ? x.toFixed(2) : x);
  console.log(`${season} season: ${s.weeks.length} weeks loaded, ${s.n_final_weeks} final${s.in_progress.length ? `, in progress: week ${s.in_progress.join(", ")}` : ""}; ${s.standings.length} entries`);
  s.weeks.forEach((w) => console.log(`  week ${w.week}: ${w.entries} entries, ${w.n_final}/${w.n_games} final${w.n_live ? `, ${w.n_live} live` : ""}${w.final ? "  [final]" : "  [in progress]"}`));
  const head = `  #  ${"name".padEnd(20)} ${"total".padStart(5)} wks top8 wins ${"best".padStart(8)} avgfin ${"money".padStart(8)}  ` + s.weeks.map((w) => `W${w.week}`.padEnd(11)).join("");
  const fmt = (e) =>
    `${String(e.rank).padStart(3)}${e.tied ? "T" : " "} ${e.name.padEnd(20)} ${String(e.total).padStart(5)} ${String(e.played).padStart(3)} ${String(e.top8).padStart(4)} ${String(e.wins).padStart(4)} ${`${e.best} (W${e.best_week})`.padStart(8)} ${e.avg_finish.toFixed(1).padStart(6)} ${money(e.money).padStart(8)}  ` +
    e.per_week.map((w) => (w ? `${w.pts}·${w.tied ? "T" : ""}${ord(w.rank)}${w.final ? "" : "*"}` : "–").padEnd(11)).join("");
  console.log("--- the Crew (season)");
  console.log(head);
  s.standings.filter((e) => SIX.includes(e.name)).forEach((e) => console.log(fmt(e)));
  console.log("--- whole pool, top 12");
  console.log(head);
  s.standings.slice(0, 12).forEach((e) => console.log(fmt(e)));
  console.log("--- money (finished weeks only)");
  s.standings.filter((e) => e.money > 0).forEach((e) => console.log(`  ${e.name.padEnd(20)} ${money(e.money).padStart(8)}  ` + e.per_week.filter((w) => w && w.money).map((w) => `W${w.week} ${ord(w.rank)} ${money(w.money)}`).join(", ")));
  const paid = s.standings.reduce((a, e) => a + e.money, 0);
  console.log(`total paid = ${money(paid)} (should be ${money(Pool.PAYOUTS.reduce((a, b) => a + b, 0) * s.n_final_weeks)} = ${s.n_final_weeks} final week(s) × $${Pool.PAYOUTS.reduce((a, b) => a + b, 0)})`);
  console.log("* = week in progress, live points");

  // race to last: season Monte Carlo
  const t0 = Date.now();
  const sim = Pool.simulateSeason(s, models, { sims: 3000, group: SIX });
  const ms = Date.now() - t0;
  const pc = (p) => (p == null ? "–" : p > 0 && p < 0.005 ? "<1%" : Math.round(p * 100) + "%");
  console.log(`--- race to last: ${sim.sims} sims in ${ms}ms; ${sim.open_weeks} week(s) open, ${sim.future_weeks} future week(s) bootstrapped from ${sim.sample} finished-week scores`);
  const crew = s.standings.filter((e) => SIX.includes(e.name)).sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
  console.log(`  ${"name".padEnd(20)} total   gap  P(last, Crew)  P(last, pool)  exp total`);
  crew.forEach((e, i) => {
    const above = crew[i + 1];
    const b = sim.by_name[e.name];
    console.log(`  ${e.name.padEnd(20)} ${String(e.total).padStart(5)} ${above ? String(above.total - e.total).padStart(5) : "    –"}  ${pc(b.last_group).padStart(13)}  ${pc(b.last).padStart(13)}  ${b.exp_total.toFixed(0).padStart(9)}`);
  });
  const bottom = s.standings.slice().sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
  console.log("--- whole pool, bottom 5");
  bottom.slice(0, 5).forEach((e, i) => console.log(`  ${e.name.padEnd(20)} ${String(e.total).padStart(5)}  wks ${e.played}  P(last) ${pc(sim.by_name[e.name].last)}`));
  const sumCrew = crew.reduce((a, e) => a + sim.by_name[e.name].last_group, 0);
  const sumPool = s.standings.reduce((a, e) => a + sim.by_name[e.name].last, 0);
  console.log(`sum P(last, Crew) = ${(sumCrew * 100).toFixed(1)}% (should be 100%); sum P(last, pool) = ${(sumPool * 100).toFixed(1)}% (should be 100%)`);
}

const args = process.argv.slice(2);
if (args[0] === "--season") checkSeason(args[1] || "2026");
else checkWeek(args[0] || "2026", args[1] || "2");
