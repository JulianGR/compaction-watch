#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL="${REPO_ROOT}/install.sh"

pass=0
fail=0
ok() { printf 'ok   - %s\n' "$1"; pass=$((pass + 1)); }
no() { printf 'FAIL - %s\n' "$1"; printf '       %s\n' "$2"; fail=$((fail + 1)); }
assert_eq() { if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "expected [$3] got [$2]"; fi; }

new_home() { mktemp -d "${TMPDIR:-/tmp}/cw-inst.XXXXXX"; }
settings() { printf '%s/.claude/settings.json' "$1"; }
run_install() { env HOME="$1" bash "$INSTALL" >/dev/null 2>&1; }

SL="\$HOME/.claude/scripts/compaction-watch/statusline.sh"

# fresh install
H="$(new_home)"
run_install "$H"
S="$(settings "$H")"
assert_eq "install: PreCompact has exactly 1 group" \
  "$(jq '.hooks.PreCompact | length' "$S")" "1"
assert_eq "install: PreCompact command is absolute under HOME" \
  "$(jq -r '.hooks.PreCompact[0].hooks[0].command' "$S" | sed "s#$H#\$HOME#")" \
  "\$HOME/.claude/scripts/compaction-watch/count.sh"
assert_eq "install: count.sh command basename" \
  "$(jq -r '.hooks.PreCompact[0].hooks[0].command' "$S" | sed 's#.*/##')" "count.sh"
assert_eq "install: SessionStart points at prune.sh" \
  "$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$S" | sed 's#.*/##')" "prune.sh"
assert_eq "install: statusLine set to statusline.sh" \
  "$(jq -r '.statusLine.command' "$S" | sed 's#.*/##')" "statusline.sh"
[ -x "$H/.claude/scripts/compaction-watch/count.sh" ] && ok "install: count.sh executable" || no "install: count.sh executable" "not +x"

# idempotency
run_install "$H"
run_install "$H"
assert_eq "install: PreCompact still 1 group after 3 runs" \
  "$(jq '.hooks.PreCompact | length' "$S")" "1"
assert_eq "install: SessionStart still 1 group after 3 runs" \
  "$(jq '.hooks.SessionStart | length' "$S")" "1"

# preserve pre-existing statusLine
H="$(new_home)"
mkdir -p "$(dirname "$(settings "$H")")"
S="$(settings "$H")"
printf '%s\n' '{"statusLine":{"type":"command","command":"/usr/local/bin/my-statusline"}}' > "$S"
run_install "$H"
assert_eq "install: preserves pre-existing statusLine" \
  "$(jq -r '.statusLine.command' "$S")" "/usr/local/bin/my-statusline"
assert_eq "install: still adds PreCompact when statusLine preserved" \
  "$(jq '.hooks.PreCompact | length' "$S")" "1"

# preserve unrelated SessionStart hook, append ours
H="$(new_home)"
mkdir -p "$(dirname "$(settings "$H")")"
S="$(settings "$H")"
printf '%s\n' '{"hooks":{"SessionStart":[{"matcher":"","hooks":[{"type":"command","command":"/other/tool.sh"}]}]}}' > "$S"
run_install "$H"
assert_eq "install: keeps unrelated SessionStart hook" \
  "$(jq '[.hooks.SessionStart[].hooks[].command] | map(select(. == "/other/tool.sh")) | length' "$S")" "1"
assert_eq "install: appends our prune.sh alongside" \
  "$(jq '[.hooks.SessionStart[].hooks[].command] | map(select(endswith("prune.sh"))) | length' "$S")" "1"

# valid JSON preserved
assert_eq "install: result is valid JSON" \
  "$(jq -e . "$S" >/dev/null 2>&1 && echo valid || echo invalid)" "valid"

echo "-----------------------------------------"
printf 'passed: %s  failed: %s\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
