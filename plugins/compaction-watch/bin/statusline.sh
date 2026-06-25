#!/usr/bin/env bash
set -euo pipefail

input=$(cat)
session_id=$(printf '%s' "$input" | jq -r '.session_id // "unknown"' 2>/dev/null || printf 'unknown')

state_dir="${HOME}/.claude/state/compaction-watch"

if [ "${COMPACTION_WATCH_DEBUG:-0}" = "1" ]; then
  mkdir -p "$state_dir"
  printf '%s\n' "$input" >> "${state_dir}/raw.log"
fi

counter="${state_dir}/${session_id}.count"
count=$(cat "$counter" 2>/dev/null || echo 0)
case "$count" in *[!0-9]*) count=0 ;; '') count=0 ;; esac

threshold="${COMPACTION_WATCH_THRESHOLD:-10}"
case "$threshold" in *[!0-9]*) threshold=10 ;; '') threshold=10 ;; esac

if [ -n "${COMPACTION_WATCH_BASE_STATUSLINE:-}" ]; then
  base=$(printf '%s' "$input" | "${COMPACTION_WATCH_BASE_STATUSLINE}" 2>/dev/null || true)
else
  model=$(printf '%s' "$input" | jq -r '.model.display_name // ""' 2>/dev/null || printf '')
  dir=$(printf '%s' "$input" | jq -r '.workspace.current_dir // .cwd // ""' 2>/dev/null || printf '')
  base="${model} ${dir##*/}"
fi

base=${base%$'\n'}

if [ "$count" -ge "$threshold" ]; then
  printf '%s  ⚠️ %s compactions · new session recommended\n' "$base" "$count"
elif [ "$count" -gt 0 ]; then
  printf '%s  ⟳%s\n' "$base" "$count"
else
  printf '%s\n' "$base"
fi
