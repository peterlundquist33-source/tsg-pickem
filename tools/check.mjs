// Node sanity check: score a week with the site's own logic and print standings.
//   node tools/check.mjs 2026 2
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Pool = require("../js/pool.js");

const [season = "2026", week = "2"] = process.argv.slice(2);
const nn = String(week).padStart(2, "0");
const weekDoc = JSON.parse(readFileSync(new URL(`../data/${season}/week-${nn}.json`, import.meta.url)));
let resultsDoc = null;
try { resultsDoc = JSON.parse(readFileSync(new URL(`../data/${season}/results/week-${nn}.json`, import.meta.url))); } catch {}

const model = Pool.buildWeek(weekDoc, resultsDoc);
const t0 = Date.now();
const sim = model.all_final ? Pool.settle(model) : Pool.simulate(model, { sims: 5000 });
const ms = Date.now() - t0;

console.log(`${season} week ${week}: ${model.entries.length} entries, ${model.n_games} games, ${model.n_final} final, ${model.n_live} live, sim ${sim.sims}x in ${ms}ms`);
if (model.tiebreaker) console.log(`tiebreaker: ${model.tiebreaker.game.away} @ ${model.tiebreaker.game.home} total=${model.tiebreaker.total}`);
const SIX = ["Peter Lundquist", "Christian Massett", "Mitch Max", "Noah Thesing", "Logan Rezac", "Sam DuBois", "CJ Woda", "Logan Gacke"];
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
