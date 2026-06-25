#!/usr/bin/env bash
set -euo pipefail

input=$(cat)
session_id=$(printf '%s' "$input" | jq -r '.session_id // "unknown"' 2>/dev/null || printf 'unknown')
trigger=$(printf '%s' "$input" | jq -r '.trigger // "auto"' 2>/dev/null || printf 'auto')

if [ "${COMPACTION_WATCH_AUTO_ONLY:-0}" = "1" ] && [ "$trigger" != "auto" ]; then
  exit 0
fi

state_dir="${HOME}/.claude/state/compaction-watch"
mkdir -p "$state_dir"

if [ "${COMPACTION_WATCH_DEBUG:-0}" = "1" ]; then
  printf '%s\n' "$input" >> "${state_dir}/raw.log"
fi

counter="${state_dir}/${session_id}.count"

current=$(cat "$counter" 2>/dev/null || echo 0)
case "$current" in *[!0-9]*) current=0 ;; '') current=0 ;; esac
printf '%s\n' "$((current + 1))" > "$counter"

printf '%s %s\n' "$(date +%s)" "$trigger" >> "${state_dir}/${session_id}.log"
exit 0
