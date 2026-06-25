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

printf 'Scripts copiados en: %s\n' "$SCRIPTS_DIR"

print_manual_block() {
  cat <<EOF

jq no esta disponible. Anade manualmente este contenido a ${SETTINGS}
(fusionalo con lo que ya tengas; no reemplaces el fichero entero):

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

Si ya tienes un statusLine, NO lo sobrescribas: conserva el tuyo y exporta
COMPACTION_WATCH_BASE_STATUSLINE apuntando a el para encadenarlo.
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
  printf 'AVISO: %s no es JSON valido. No se ha modificado.\n' "$SETTINGS"
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

printf 'settings.json actualizado (copia previa en %s.bak).\n' "$SETTINGS"
printf '  hook PreCompact   -> %s\n' "$COUNT"
printf '  hook SessionStart -> %s\n' "$PRUNE"

if [ -n "$prev_statusline" ] && [ "$prev_statusline" != "$STATUSLINE" ]; then
  cat <<EOF

NOTA: ya tenias un statusLine configurado y se ha CONSERVADO:
  ${prev_statusline}

Para encadenarlo con el aviso de compactaciones, edita el statusLine para que
apunte a compaction-watch y exporta tu statusLine previo como base:

  "statusLine": { "type": "command", "command": "${STATUSLINE}" }
  "env": { "COMPACTION_WATCH_BASE_STATUSLINE": "${prev_statusline}" }
EOF
else
  printf '  statusLine        -> %s\n' "$STATUSLINE"
fi

printf '\nListo. Abre una sesion nueva para que los hooks y el statusline carguen.\n'
exit 0
