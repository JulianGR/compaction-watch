#!/usr/bin/env bash
set -euo pipefail

input=$(cat)
session_id=$(printf '%s' "$input" | jq -r '.session_id // "unknown"' 2>/dev/null || printf 'unknown')

state_dir="${HOME}/.claude/state/compaction-watch"
mkdir -p "$state_dir"

if [ "${COMPACTION_WATCH_DEBUG:-0}" = "1" ]; then
  printf '%s\n' "$input" >> "${state_dir}/raw.log"
fi

count=$(cat "${state_dir}/${session_id}.count" 2>/dev/null || echo 0)
case "$count" in *[!0-9]*) count=0 ;; '') count=0 ;; esac

full="${COMPACTION_WATCH_THRESHOLD:-10}"
case "$full" in *[!0-9]*) full=10 ;; '') full=10 ;; esac

pre="${COMPACTION_WATCH_PREWARN_THRESHOLD:-5}"
case "$pre" in *[!0-9]*) pre=5 ;; '') pre=5 ;; esac

remind="${COMPACTION_WATCH_REMIND_EVERY:-5}"
case "$remind" in *[!0-9]*) remind=5 ;; '') remind=5 ;; esac
if [ "$remind" -lt 1 ]; then remind=1; fi

msgfile="${state_dir}/${session_id}.msgcount"
msg=$(cat "$msgfile" 2>/dev/null || echo 0)
case "$msg" in *[!0-9]*) msg=0 ;; '') msg=0 ;; esac
msg=$((msg + 1))
printf '%s\n' "$msg" > "$msgfile"

level=none
if [ "$count" -ge "$full" ]; then
  level=full
elif [ "$count" -ge "$pre" ]; then
  level=pre
fi

notified="${state_dir}/${session_id}.notified"
prev=$(cat "$notified" 2>/dev/null || echo "none 0")
prev_level=${prev%% *}
prev_msg=${prev##* }
case "$prev_level" in '') prev_level=none ;; esac
case "$prev_msg" in *[!0-9]*) prev_msg=0 ;; '') prev_msg=0 ;; esac

fire=0
if [ "$level" != none ]; then
  if [ "$level" != "$prev_level" ]; then
    fire=1
  elif [ "$((msg - prev_msg))" -ge "$remind" ]; then
    fire=1
  fi
fi

if [ "$fire" -eq 1 ]; then
  printf '%s %s\n' "$level" "$msg" > "$notified"
  if [ "$level" = full ]; then
    body="⚠️ compaction-watch: ${count} compactions reached (threshold ${full}). Starting a fresh session is recommended."
  else
    body="⟳ compaction-watch: ${count} compactions reached (pre-warning, threshold ${pre}). Consider wrapping up this session soon."
  fi
  printf '[compaction-watch] Tell the user now, briefly and in their language: %s\n' "$body"
fi

exit 0
