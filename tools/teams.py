"""NFL team name normalisation shared by ingest.py and scores.py.

The pool workbook stores full team names as free text and they are not always
spelled the way ESPN spells them ("Alanta Falcons", "Washington Team"). Every
name goes through `normalize()` and comes out as ESPN's scoreboard abbreviation.
"""
import re

# abbreviation -> (city, nickname)
TEAMS = {
    "ARI": ("Arizona", "Cardinals"),
    "ATL": ("Atlanta", "Falcons"),
    "BAL": ("Baltimore", "Ravens"),
    "BUF": ("Buffalo", "Bills"),
    "CAR": ("Carolina", "Panthers"),
    "CHI": ("Chicago", "Bears"),
    "CIN": ("Cincinnati", "Bengals"),
    "CLE": ("Cleveland", "Browns"),
    "DAL": ("Dallas", "Cowboys"),
    "DEN": ("Denver", "Broncos"),
    "DET": ("Detroit", "Lions"),
    "GB":  ("Green Bay", "Packers"),
    "HOU": ("Houston", "Texans"),
    "IND": ("Indianapolis", "Colts"),
    "JAX": ("Jacksonville", "Jaguars"),
    "KC":  ("Kansas City", "Chiefs"),
    "LAC": ("Los Angeles", "Chargers"),
    "LAR": ("Los Angeles", "Rams"),
    "LV":  ("Las Vegas", "Raiders"),
    "MIA": ("Miami", "Dolphins"),
    "MIN": ("Minnesota", "Vikings"),
    "NE":  ("New England", "Patriots"),
    "NO":  ("New Orleans", "Saints"),
    "NYG": ("New York", "Giants"),
    "NYJ": ("New York", "Jets"),
    "PHI": ("Philadelphia", "Eagles"),
    "PIT": ("Pittsburgh", "Steelers"),
    "SEA": ("Seattle", "Seahawks"),
    "SF":  ("San Francisco", "49ers"),
    "TB":  ("Tampa Bay", "Buccaneers"),
    "TEN": ("Tennessee", "Titans"),
    "WSH": ("Washington", "Commanders"),
}

FULL_NAME = {abbr: f"{city} {nick}" for abbr, (city, nick) in TEAMS.items()}

# Spellings seen in the wild that the generic rules below would miss.
ALIASES = {
    "alanta falcons": "ATL",
    "washington team": "WSH",
    "washington football team": "WSH",
    "washington redskins": "WSH",
    "was": "WSH",
    "jac": "JAX",
    "la rams": "LAR",
    "la chargers": "LAC",
    "oakland raiders": "LV",
    "st louis rams": "LAR",
    "st. louis rams": "LAR",
    "san diego chargers": "LAC",
}

_NICK = {nick.lower(): abbr for abbr, (_, nick) in TEAMS.items()}
_CITY = {}
for abbr, (city, _) in TEAMS.items():
    _CITY.setdefault(city.lower(), []).append(abbr)


def _clean(s):
    s = (s or "").replace("﻿", "")
    s = re.sub(r"[^a-z0-9 ]+", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def normalize(name):
    """Full name / nickname / abbreviation -> ESPN abbreviation, or None."""
    if name is None:
        return None
    raw = str(name).strip().replace("﻿", "")
    if raw.upper() in TEAMS:
        return raw.upper()
    key = _clean(raw)
    if not key:
        return None
    if key in ALIASES:
        return ALIASES[key]
    words = key.split()
    # nickname is the reliable part ("Alanta Falcons" still says Falcons)
    if words[-1] in _NICK:
        return _NICK[words[-1]]
    for w in words:
        if w in _NICK:
            return _NICK[w]
    # city only works when it is unambiguous
    for n in range(len(words), 0, -1):
        city = " ".join(words[:n])
        if city in _CITY and len(_CITY[city]) == 1:
            return _CITY[city][0]
    return None
