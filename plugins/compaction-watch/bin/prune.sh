#!/usr/bin/env bash
set -euo pipefail

state_dir="${HOME}/.claude/state/compaction-watch"
mkdir -p "$state_dir"
find "$state_dir" -type f -mtime +"${COMPACTION_WATCH_RETENTION_DAYS:-7}" -delete 2>/dev/null || true

scripts_dir="${HOME}/.claude/scripts/compaction-watch"
mkdir -p "$scripts_dir"
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/bin/statusline.sh" ]; then
  cp -f "${CLAUDE_PLUGIN_ROOT}/bin/statusline.sh" "${scripts_dir}/statusline.sh"
  chmod +x "${scripts_dir}/statusline.sh"
fi
exit 0
