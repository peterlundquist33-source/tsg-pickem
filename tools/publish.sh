#!/usr/bin/env bash
# Thursday routine: ingest Mike's workbook, commit the data, push.
#   tools/publish.sh ~/Downloads/week3.xlsx 3 [2026]
set -euo pipefail
cd "$(dirname "$0")/.."
xlsx="$1"; week="$2"; season="${3:-2026}"

if command -v uv >/dev/null 2>&1; then
  uv run tools/ingest.py "$xlsx" --season "$season" --week "$week"
else
  python3 tools/ingest.py "$xlsx" --season "$season" --week "$week"
fi

git pull --rebase --quiet
git add data
if git diff --cached --quiet; then
  echo "nothing new to publish"
else
  git commit -q -m "week $week picks ($(basename "$xlsx"))"
  git push
  echo "pushed — https://peterlundquist33-source.github.io/tsg-pickem/?season=$season&week=$week"
fi
