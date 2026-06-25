#!/usr/bin/env bash
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${REPO_ROOT}/plugins/compaction-watch/bin"

pass=0
fail=0

ok() { printf 'ok   - %s\n' "$1"; pass=$((pass + 1)); }
no() { printf 'FAIL - %s\n' "$1"; printf '       %s\n' "$2"; fail=$((fail + 1)); }

assert_eq() {
  if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "expected [$3] got [$2]"; fi
}
assert_contains() {
  case "$2" in *"$3"*) ok "$1" ;; *) no "$1" "[$2] does not contain [$3]" ;; esac
}
assert_not_contains() {
  case "$2" in *"$3"*) no "$1" "[$2] unexpectedly contains [$3]" ;; *) ok "$1" ;; esac
}

new_home() {
  local d
  d="$(mktemp -d "${TMPDIR:-/tmp}/cw-test.XXXXXX")"
  printf '%s' "$d"
}

run_count() {
  local home="$1" json="$2"; shift 2
  printf '%s' "$json" | env HOME="$home" "$@" bash "${BIN}/count.sh"
}
run_statusline() {
  local home="$1" json="$2"; shift 2
  printf '%s' "$json" | env HOME="$home" "$@" bash "${BIN}/statusline.sh"
}

state_dir() { printf '%s/.claude/state/compaction-watch' "$1"; }

# ---------------------------------------------------------------------------
# count.sh
# ---------------------------------------------------------------------------
H="$(new_home)"
run_count "$H" '{"session_id":"sess-A","trigger":"auto"}' >/dev/null
assert_eq "count.sh: first compaction writes 1" \
  "$(cat "$(state_dir "$H")/sess-A.count" 2>/dev/null)" "1"

run_count "$H" '{"session_id":"sess-A","trigger":"auto"}' >/dev/null
run_count "$H" '{"session_id":"sess-A","trigger":"manual"}' >/dev/null
assert_eq "count.sh: increments on each compaction" \
  "$(cat "$(state_dir "$H")/sess-A.count" 2>/dev/null)" "3"

run_count "$H" '{"session_id":"sess-B","trigger":"auto"}' >/dev/null
assert_eq "count.sh: separate sessions have separate counters" \
  "$(cat "$(state_dir "$H")/sess-B.count" 2>/dev/null)" "1"
assert_eq "count.sh: sess-A unaffected by sess-B" \
  "$(cat "$(state_dir "$H")/sess-A.count" 2>/dev/null)" "3"

H="$(new_home)"
run_count "$H" '{"trigger":"auto"}' >/dev/null
assert_eq "count.sh: missing session_id falls back to unknown" \
  "$(cat "$(state_dir "$H")/unknown.count" 2>/dev/null)" "1"

H="$(new_home)"
run_count "$H" '{"session_id":"sess-C","trigger":"manual"}' COMPACTION_WATCH_AUTO_ONLY=1 >/dev/null
assert_eq "count.sh: AUTO_ONLY ignores manual trigger" \
  "$(cat "$(state_dir "$H")/sess-C.count" 2>/dev/null || echo MISSING)" "MISSING"

run_count "$H" '{"session_id":"sess-C","trigger":"auto"}' COMPACTION_WATCH_AUTO_ONLY=1 >/dev/null
assert_eq "count.sh: AUTO_ONLY still counts auto trigger" \
  "$(cat "$(state_dir "$H")/sess-C.count" 2>/dev/null)" "1"

H="$(new_home)"
mkdir -p "$(state_dir "$H")"
printf 'garbage\n' > "$(state_dir "$H")/sess-D.count"
run_count "$H" '{"session_id":"sess-D","trigger":"auto"}' >/dev/null
assert_eq "count.sh: corrupt counter resets to 1" \
  "$(cat "$(state_dir "$H")/sess-D.count" 2>/dev/null)" "1"

H="$(new_home)"
printf '%s' '{"session_id":"sess-E","trigger":"auto"}' | env HOME="$H" bash "${BIN}/count.sh" >/dev/null
assert_eq "count.sh: exits 0" "$?" "0"

H="$(new_home)"
run_count "$H" '{"session_id":"sess-F","trigger":"auto"}' COMPACTION_WATCH_DEBUG=1 >/dev/null
assert_contains "count.sh: DEBUG dumps raw stdin to raw.log" \
  "$(cat "$(state_dir "$H")/raw.log" 2>/dev/null)" "sess-F"

H="$(new_home)"
run_count "$H" '{"session_id":"sess-G","trigger":"auto"}' >/dev/null
assert_eq "count.sh: no raw.log without DEBUG" \
  "$(cat "$(state_dir "$H")/raw.log" 2>/dev/null || echo MISSING)" "MISSING"

# ---------------------------------------------------------------------------
# statusline.sh
# ---------------------------------------------------------------------------
SL_JSON='{"session_id":"sess-A","model":{"display_name":"Opus"},"workspace":{"current_dir":"/home/u/proj"}}'

H="$(new_home)"
out="$(run_statusline "$H" "$SL_JSON")"
assert_not_contains "statusline.sh: count 0 shows no compaction suffix" "$out" "⟳"
assert_not_contains "statusline.sh: count 0 shows no warning" "$out" "⚠️"
assert_contains "statusline.sh: minimal base shows model" "$out" "Opus"
assert_contains "statusline.sh: minimal base shows dir basename" "$out" "proj"
assert_not_contains "statusline.sh: minimal base shows only basename not full path" "$out" "/home/u"

H="$(new_home)"
mkdir -p "$(state_dir "$H")"
printf '3\n' > "$(state_dir "$H")/sess-A.count"
out="$(run_statusline "$H" "$SL_JSON")"
assert_contains "statusline.sh: below threshold shows counter" "$out" "⟳3"
assert_not_contains "statusline.sh: below threshold shows no warning" "$out" "⚠️"

printf '10\n' > "$(state_dir "$H")/sess-A.count"
out="$(run_statusline "$H" "$SL_JSON")"
assert_contains "statusline.sh: at default threshold shows warning" "$out" "⚠️"
assert_contains "statusline.sh: warning includes count" "$out" "10"
assert_contains "statusline.sh: warning includes recommendation" "$out" "nueva sesión recomendada"

printf '2\n' > "$(state_dir "$H")/sess-A.count"
out="$(run_statusline "$H" "$SL_JSON" COMPACTION_WATCH_THRESHOLD=2)"
assert_contains "statusline.sh: custom threshold triggers warning" "$out" "⚠️"

out="$(run_statusline "$H" "$SL_JSON" COMPACTION_WATCH_THRESHOLD=2)"
nlines="$(printf '%s' "$out" | wc -l | tr -d ' ')"
assert_eq "statusline.sh: output is a single line" "$nlines" "0"

CHAIN="$(new_home)/base.sh"
printf '#!/usr/bin/env bash\nprintf "MYBASE"\n' > "$CHAIN"
chmod +x "$CHAIN"
H="$(new_home)"
mkdir -p "$(state_dir "$H")"
printf '4\n' > "$(state_dir "$H")/sess-A.count"
out="$(run_statusline "$H" "$SL_JSON" COMPACTION_WATCH_BASE_STATUSLINE="$CHAIN")"
assert_contains "statusline.sh: chains custom base statusline" "$out" "MYBASE"
assert_contains "statusline.sh: chained base still appends counter" "$out" "⟳4"

H="$(new_home)"
printf '%s' "$SL_JSON" | env HOME="$H" bash "${BIN}/statusline.sh" >/dev/null
assert_eq "statusline.sh: exits 0" "$?" "0"

# ---------------------------------------------------------------------------
# prune.sh
# ---------------------------------------------------------------------------
H="$(new_home)"
PLUGIN_ROOT="${REPO_ROOT}/plugins/compaction-watch"
env HOME="$H" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "${BIN}/prune.sh"
assert_eq "prune.sh: exits 0" "$?" "0"
stable="$H/.claude/scripts/compaction-watch/statusline.sh"
if [ -f "$stable" ]; then ok "prune.sh: copies statusline.sh to stable path"; else no "prune.sh: copies statusline.sh to stable path" "missing $stable"; fi
if [ -x "$stable" ]; then ok "prune.sh: stable statusline.sh is executable"; else no "prune.sh: stable statusline.sh is executable" "not +x"; fi

H="$(new_home)"
sd="$(state_dir "$H")"
mkdir -p "$sd"
printf '1\n' > "$sd/old.count"
touch -t 200001010000 "$sd/old.count"
printf '1\n' > "$sd/new.count"
env HOME="$H" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "${BIN}/prune.sh"
if [ -f "$sd/old.count" ]; then no "prune.sh: deletes stale counters" "old.count survived"; else ok "prune.sh: deletes stale counters"; fi
if [ -f "$sd/new.count" ]; then ok "prune.sh: keeps recent counters"; else no "prune.sh: keeps recent counters" "new.count deleted"; fi

H="$(new_home)"
env HOME="$H" bash "${BIN}/prune.sh"
assert_eq "prune.sh: exits 0 without CLAUDE_PLUGIN_ROOT" "$?" "0"

# ---------------------------------------------------------------------------
echo "-----------------------------------------"
printf 'passed: %s  failed: %s\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
