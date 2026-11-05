#!/usr/bin/env bash
# Fails if a tracked source file is longer than MAX_LINES (default 300).
set -euo pipefail

MAX_LINES="${MAX_LINES:-300}"
status=0

while IFS= read -r file; do
  lines=$(wc -l < "$file" | tr -d ' ')
  if (( lines > MAX_LINES )); then
    echo "::error file=$file::$file has $lines lines (max $MAX_LINES). Split it up."
    status=1
  fi
done < <(git ls-files \
  | grep -Ev '(^|/)(pnpm-lock\.yaml|next-env\.d\.ts|LICENSE)$' \
  | grep -Ev '/drizzle/meta/[0-9]+_snapshot\.json$' \
  | grep -Ev '\.(png|jpg|jpeg|gif|ico|svg|woff2?)$')

exit "$status"
