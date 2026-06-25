#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_BIN="${REPO_ROOT}/plugins/compaction-watch/bin"

SCRIPTS_DIR="${HOME}/.claude/scripts/compaction-watch"
STATE_DIR="${HOME}/.claude/state/compaction-watch"
SETTINGS="${HOME}/.claude/settings.json"

COUNT="${SCRIPTS_DIR}/count.sh"
STATUSLINE="${SCRIPTS_DIR}/statusline.sh"
PRUNE="${SCRIPTS_DIR}/prune.sh"

mkdir -p "$SCRIPTS_DIR" "$STATE_DIR" "$(dirname "$SETTINGS")"

cp -f "${SRC_BIN}/count.sh" "$COUNT"
cp -f "${SRC_BIN}/statusline.sh" "$STATUSLINE"
cp -f "${SRC_BIN}/prune.sh" "$PRUNE"
chmod +x "$COUNT" "$STATUSLINE" "$PRUNE"

printf 'Scripts copied to: %s\n' "$SCRIPTS_DIR"

print_manual_block() {
  cat <<EOF

jq is not available. Add the following content manually to ${SETTINGS}
(merge it with what you already have; do not replace the whole file):

{
  "statusLine": {
    "type": "command",
    "command": "${STATUSLINE}"
  },
  "hooks": {
    "PreCompact": [
      { "matcher": "", "hooks": [ { "type": "command", "command": "${COUNT}" } ] }
    ],
    "SessionStart": [
      { "matcher": "", "hooks": [ { "type": "command", "command": "${PRUNE}" } ] }
    ]
  }
}

If you already have a statusLine, do NOT overwrite it: keep yours and export
COMPACTION_WATCH_BASE_STATUSLINE pointing at it to chain it.
EOF
}

if ! command -v jq >/dev/null 2>&1; then
  print_manual_block
  exit 0
fi

if [ ! -f "$SETTINGS" ]; then
  printf '{}\n' > "$SETTINGS"
fi

if ! jq -e . "$SETTINGS" >/dev/null 2>&1; then
  printf 'WARNING: %s is not valid JSON. It was not modified.\n' "$SETTINGS"
  print_manual_block
  exit 0
fi

prev_statusline="$(jq -r '.statusLine.command // ""' "$SETTINGS")"

tmp="$(mktemp "${TMPDIR:-/tmp}/cw-settings.XXXXXX")"
jq \
  --arg count "$COUNT" \
  --arg prune "$PRUNE" \
  --arg statusline "$STATUSLINE" \
  '
  .hooks = (.hooks // {})
  | .hooks.PreCompact = (
      ((.hooks.PreCompact // []) | map(select((any(.hooks[]?; .command == $count)) | not)))
      + [ { matcher: "", hooks: [ { type: "command", command: $count } ] } ]
    )
  | .hooks.SessionStart = (
      ((.hooks.SessionStart // []) | map(select((any(.hooks[]?; .command == $prune)) | not)))
      + [ { matcher: "", hooks: [ { type: "command", command: $prune } ] } ]
    )
  | (if (.statusLine != null) and ((.statusLine.command // "") != $statusline)
     then .
     else .statusLine = { type: "command", command: $statusline }
     end)
  ' "$SETTINGS" > "$tmp"

cp -f "$SETTINGS" "${SETTINGS}.bak"
mv -f "$tmp" "$SETTINGS"

printf 'settings.json updated (previous copy at %s.bak).\n' "$SETTINGS"
printf '  hook PreCompact   -> %s\n' "$COUNT"
printf '  hook SessionStart -> %s\n' "$PRUNE"

if [ -n "$prev_statusline" ] && [ "$prev_statusline" != "$STATUSLINE" ]; then
  cat <<EOF

NOTE: you already had a statusLine configured and it was PRESERVED:
  ${prev_statusline}

To chain it with the compaction warning, edit the statusLine to point at
compaction-watch and export your previous statusLine as the base:

  "statusLine": { "type": "command", "command": "${STATUSLINE}" }
  "env": { "COMPACTION_WATCH_BASE_STATUSLINE": "${prev_statusline}" }
EOF
else
  printf '  statusLine        -> %s\n' "$STATUSLINE"
fi

printf '\nDone. Open a fresh session so the hooks and statusline load.\n'
exit 0
