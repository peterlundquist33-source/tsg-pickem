#!/usr/bin/env python3
"""Fetch a week's NFL scoreboard from ESPN and write data/<season>/results/week-NN.json.

    python3 tools/scores.py --season 2026 --week 2
    python3 tools/scores.py --season 2026 --week latest     # latest ingested week

No third-party deps. Idempotent: the file is only rewritten when the game data
actually changed, so a cron run during a quiet hour leaves git clean.

Endpoint note: site.api.espn.com answers 403 to non-browser clients;
cdn.espn.com/core/nfl/scoreboard (what espn.com itself calls) works and carries
the betting lines for upcoming games plus live win probability during games.
"""
import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from teams import FULL_NAME, normalize  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

URL = ("https://cdn.espn.com/core/nfl/scoreboard"
       "?xhr=1&seasontype=2&week={week}&year={season}")


def fetch_scoreboard(season, week, timeout=30):
    """-> list of raw ESPN event dicts for the week. Raises on failure."""
    req = urllib.request.Request(
        URL.format(week=week, season=season),
        headers={"User-Agent": "Mozilla/5.0 (tsg-pickem)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.load(r)
    return data["content"]["sbData"]["events"]


# ---------- probability helpers ----------

def _american_to_prob(odds):
    """'-148' -> 0.597, '+124' -> 0.446 (raw, includes the vig)."""
    try:
        o = float(str(odds).replace("+", ""))
    except (TypeError, ValueError):
        return None
    if o == 0:
        return None
    return (-o) / (-o + 100) if o < 0 else 100 / (o + 100)


def _spread_to_prob(spread_home):
    """Home win probability from the home spread (negative = home favored).
    Normal model with the classic ~13.9-point NFL margin sigma."""
    return 0.5 * (1 + math.erf((-spread_home) / (13.86 * math.sqrt(2))))


def home_win_prob(comp):
    """-> (prob_home, source) using live model, then moneyline, then spread."""
    sit = comp.get("situation") or {}
    prob = (sit.get("lastPlay") or {}).get("probability") or {}
    state = ((comp.get("status") or {}).get("type") or {}).get("state")
    if state == "in" and prob.get("homeWinPercentage") is not None:
        return float(prob["homeWinPercentage"]), "live"

    odds = (comp.get("odds") or [None])[0] or {}
    ml = odds.get("moneyline") or {}
    h = _american_to_prob(((ml.get("home") or {}).get("close") or {}).get("odds"))
    a = _american_to_prob(((ml.get("away") or {}).get("close") or {}).get("odds"))
    if h and a and h + a > 0:
        return h / (h + a), "moneyline"   # strip the vig

    spread = odds.get("spread")
    if spread is None:
        details = (odds.get("details") or "").split()
        if len(details) == 2:
            try:
                val = float(details[1])
                home_abbr = _abbr(next((c for c in comp["competitors"] if c["homeAway"] == "home"), {}))
                spread = val if details[0] == home_abbr else -val
            except (ValueError, KeyError):
                spread = None
    if spread is not None:
        return _spread_to_prob(float(spread)), "spread"
    return None, None


# ---------- event parsing ----------

def _abbr(competitor):
    team = competitor.get("team") or {}
    return normalize(team.get("abbreviation")) or normalize(team.get("displayName"))


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def parse_event(ev):
    comp = ev["competitions"][0]
    home = next(c for c in comp["competitors"] if c["homeAway"] == "home")
    away = next(c for c in comp["competitors"] if c["homeAway"] == "away")
    st = (comp.get("status") or ev.get("status") or {})
    stype = st.get("type") or {}
    state = stype.get("state")            # pre | in | post
    completed = bool(stype.get("completed"))
    ha, aa = _abbr(home), _abbr(away)
    hs, as_ = _int(home.get("score")), _int(away.get("score"))

    winner = None
    if completed:
        if home.get("winner"):
            winner = ha
        elif away.get("winner"):
            winner = aa
        elif hs is not None and as_ is not None:
            winner = ha if hs > as_ else aa if as_ > hs else "TIE"

    prob, source = home_win_prob(comp)
    odds = (comp.get("odds") or [None])[0] or {}
    ml = odds.get("moneyline") or {}

    return {
        "espn_id": str(ev["id"]),
        "name": ev.get("name"),
        "short_name": ev.get("shortName"),
        "away": aa,
        "home": ha,
        "away_name": FULL_NAME.get(aa, (away.get("team") or {}).get("displayName")),
        "home_name": FULL_NAME.get(ha, (home.get("team") or {}).get("displayName")),
        "kickoff": ev.get("date"),
        "neutral_site": bool(comp.get("neutralSite")),
        "status": state,
        "completed": completed,
        "detail": stype.get("detail"),
        "short_detail": stype.get("shortDetail"),
        "period": st.get("period"),
        "clock": st.get("displayClock"),
        "away_score": as_,
        "home_score": hs,
        "winner": winner,
        "home_win_prob": None if prob is None else round(prob, 4),
        "prob_source": source,
        "odds": {
            "details": odds.get("details"),
            "spread_home": odds.get("spread"),
            "over_under": odds.get("overUnder"),
            "moneyline_home": ((ml.get("home") or {}).get("close") or {}).get("odds"),
            "moneyline_away": ((ml.get("away") or {}).get("close") or {}).get("odds"),
            "provider": (odds.get("provider") or {}).get("name"),
        } if odds else None,
    }


def parse_events(events):
    games = sorted((parse_event(e) for e in events), key=lambda g: (g["kickoff"] or "", g["espn_id"]))
    return games


def tiebreaker_game(games):
    """Pool rule: the Monday night game; if two, the later one; if none, the
    last Sunday game. All of which is 'the latest kickoff of the week'."""
    if not games:
        return None
    return max(games, key=lambda g: (g["kickoff"] or "", g["espn_id"]))["espn_id"]


# ---------- files ----------

def results_path(season, week):
    return os.path.join(DATA, str(season), "results", f"week-{int(week):02d}.json")


def latest_week(season):
    idx = os.path.join(DATA, str(season), "index.json")
    try:
        with open(idx) as f:
            weeks = json.load(f).get("weeks") or []
        return max(int(w) for w in weeks)
    except (OSError, ValueError):
        return None


def write_results(season, week, games, path=None):
    """Write the results file unless the games payload is identical. -> changed?"""
    path = path or results_path(season, week)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        try:
            with open(path) as f:
                old = json.load(f)
            if old.get("games") == games:
                return False
        except (OSError, ValueError):
            pass
    doc = {
        "season": int(season),
        "week": int(week),
        "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "cdn.espn.com/core/nfl/scoreboard",
        "tiebreaker_espn_id": tiebreaker_game(games),
        "games": games,
    }
    with open(path, "w") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--week", default="latest", help="week number or 'latest'")
    args = ap.parse_args()

    week = latest_week(args.season) if args.week == "latest" else int(args.week)
    if week is None:
        sys.exit(f"no ingested weeks for {args.season}; pass --week N")

    try:
        events = fetch_scoreboard(args.season, week)
    except (urllib.error.URLError, urllib.error.HTTPError, KeyError, ValueError, OSError) as e:
        sys.exit(f"could not load scoreboard: {e}")

    games = parse_events(events)
    changed = write_results(args.season, week, games)
    done = sum(1 for g in games if g["completed"])
    live = sum(1 for g in games if g["status"] == "in")
    print(f"{args.season} week {week}: {len(games)} games, {done} final, {live} live"
          f" — {'updated' if changed else 'no change'} {os.path.relpath(results_path(args.season, week), ROOT)}")


if __name__ == "__main__":
    main()
