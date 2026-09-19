# TSG Football Pool — pick'em tracker

Live standings for the TSG Football Pool (Mike DuBois' office confidence pick'em, ~81 entries), with a spotlight on The Crew: Peter, Christian, Mitch, Noah, Logan Rezac, Sam, CJ, Logan Gacke.

**Site:** https://peterlundquist33-source.github.io/tsg-pickem/

Static HTML/CSS/JS on GitHub Pages, no framework, no build step. Python tools in `tools/`, data committed as JSON under `data/`. Same shape as `players-league`.

## What the page shows

- **The Crew** — side-by-side picks grid (pick + confidence points, green/red as games finish, dashed while in progress), points, max possible, rank, projected finish, and chance of finishing top 8.
- **Games** — each matchup's score/status/kickoff, how much of the pool is on each side with their average confidence, and ESPN's line or live win probability.
- **Standings** — everyone: rank, points, max, picks left, MNF tiebreaker, top-8 %. Sortable, searchable, gold line under the pay spots.
- **Season tab** (header toggle, remembered in localStorage) — season-to-date for the whole pool: total points, weeks played, top-8 finishes, weekly wins, best week, average finish, money. The Crew get tiles plus a week-by-week strip (points · finish per week, gold when top-8, dashed while the week is in progress). Every ingested week is loaded and scored with the same `Pool` code as the weekly view; the week open in the Week tab feeds in its live points. Season rank is by total points (tiebreak: top-8 finishes, then best week) — that's our leaderboard, not the pool's; Mike pays weekly. Money uses the confirmed pay line, finished weeks only, ties split the pooled money for the places they cover.
- **Race to last** (Season tab; there's a punishment) — the Crew bottom-up with gap to the next person and **Last %**, plus a `Last %` column for the whole pool. Client-side Monte Carlo, 3,000 runs: finished-week points + the open week played out from ESPN win probabilities (same draw as the weekly sim) + one bootstrapped score per remaining week through week 18, sampled from every entry's score in every finished week (everyone pooled = equal skill assumed; sharpens as weeks pile up). Ties for last split.

**Top 8 %** is a client-side Monte Carlo (5,000 runs) over the unfinished games. Each game is drawn from ESPN's win probability — the live model during a game, the de-vigged DraftKings moneyline before it, 50/50 if neither exists. Ties for a paid spot share it.

The page reads committed JSON, then tries `cdn.espn.com` directly (it sends `Access-Control-Allow-Origin: *`) so scores update in-browser every ~45 s during games without waiting on Actions. If that fetch fails it falls back to the committed results.

## Scoring rules

| Rule | Status |
| --- | --- |
| Correct pick earns its confidence points (1..N, each used once); wrong pick earns 0 | **Confirmed** — Mike's 2026 kickoff email; week 1 standings reproduce his results email exactly |
| Weekly rank by total points; top 8 get paid | **Confirmed** — week 1 results email lists 8 payouts |
| Tiebreaker: closest to the total points of the Monday night game (later one if two; last Sunday game when there is no MNF) | **Confirmed** — kickoff email; week 1's 7th/8th were settled this way |
| Ties in the NFL pay nobody | **Assumed** — no tied game yet to check against |
| Tiebreaker game = the week's latest kickoff | **Assumed** implementation of the rule above |

Payouts (week 1): $130 / $110 / $90 / $65 / $40 / $30 / $25 / $20.

## Data

```
data/index.json                    seasons + latest week (the page's entry point)
data/2026/index.json               weeks ingested this season
data/2026/week-NN.json             games + every entry's picks/points/MNF total
data/2026/results/week-NN.json     ESPN scoreboard: status, scores, winner, win prob, odds, kickoff
```

Names appear exactly as in Mike's workbook (everyone in the pool gets it). No emails anywhere.

## Tools

**`tools/ingest.py <xlsx> --season 2026 --week N`** — parses the workbook (sheet `Picks`: column pairs of *name, Points*; one game per row as the picked team's full name; `MNF Pts.` row for the tiebreaker). Normalises team names (handles "Alanta Falcons", "Washington Team"), matches each row to an ESPN event **by team** (the sheet doesn't list opponents), validates that every entry uses 1..N once each — bad entries are kept and flagged in `warnings`, never dropped. Also writes the results file and updates both indexes. Needs `openpyxl`; `uv run tools/ingest.py …` installs it on the fly (PEP 723 header).

**`tools/scores.py --season 2026 --week N|latest`** — fetches the ESPN scoreboard and writes the results file. No dependencies. Only rewrites when the games payload changed, so quiet runs leave git clean.

**`tools/check.mjs 2026 N`** — runs the site's own `js/pool.js` under node and prints standings + top-8 odds. Quick sanity check after ingesting. **`tools/check.mjs --season 2026`** prints the season table (Crew rows, whole-pool top 12, money by week, a total-paid check) and the race to last (Crew P(last) within the Crew and in the pool, pool bottom 5, and a probabilities-sum-to-100% check).

**`tools/publish.sh <xlsx> <week>`** — ingest + commit + push in one go.

## The Thursday routine

Mike's site locks 5 min before kickoff and emails `weekN.xlsx` ("TSG Football Pool", from mdubois@tsg-usa.com) right after — Thursday ~7:15 PM CT.

1. Red (on the VPS) saves the attachment and runs:
   ```
   cd ~/repos/tsg-pickem && tools/publish.sh /path/to/weekN.xlsx N
   ```
2. GitHub Actions (`.github/workflows/scores.yml`) refreshes `data/2026/results/` every 10 minutes during game windows (Thu/Sun/Mon nights and Sunday afternoon, US time, Sep–Jan), hourly otherwise, and commits only when something changed. `gh workflow run scores.yml -f week=N` forces a run.
3. The page picks up the new week automatically (it defaults to the latest week in `data/index.json`).

If Mike re-sends a corrected workbook (happened week 1), just run the same command again — ingest overwrites the week.

## Local dev

```
python3 -m http.server 8000     # then open http://localhost:8000
node tools/check.mjs 2026 2
node tools/check.mjs --season 2026
```
