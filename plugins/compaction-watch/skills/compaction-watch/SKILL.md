---
name: compaction-watch
description: Use when the user asks about compaction-watch — how many compactions the current session has had, resetting the compaction counter, or changing the warning threshold. Reads/writes only the state under ~/.claude/state/compaction-watch/ and the env block of ~/.claude/settings.json.
---

# compaction-watch management

This skill manages the `compaction-watch` plugin: a per-session counter of Claude
Code compactions that warns in the statusline past a threshold (default 10).

State lives in `~/.claude/state/compaction-watch/`:
- `<session_id>.count` — the integer count for that session.
- `<session_id>.log` — optional `epoch trigger` lines, one per compaction.
- `raw.log` — only present when `COMPACTION_WATCH_DEBUG=1`.

Only touch the files above and the `env` block of `~/.claude/settings.json`.
Never write `CLAUDE.md`, `memory/`, or anything else.

## How many compactions in this session

The current session id is in the hook/statusline JSON, but from a chat turn you
usually do not have it directly. Show the most recently updated counter (the
active session) and, if useful, all of them:

```bash
ls -t ~/.claude/state/compaction-watch/*.count 2>/dev/null | head -1 | xargs -I{} sh -c 'echo "$(cat {}) compactions -> {}"'
```

To list every session counter:

```bash
for f in ~/.claude/state/compaction-watch/*.count; do [ -e "$f" ] && echo "$(cat "$f")  $(basename "$f" .count)"; done
```

## Reset the counter

To reset the active session (most recently updated counter):

```bash
f=$(ls -t ~/.claude/state/compaction-watch/*.count 2>/dev/null | head -1); [ -n "$f" ] && printf '0\n' > "$f" && echo "reset $f"
```

Prefer writing `0` over deleting, so a stale path is not recreated unexpectedly.
To reset everything, write `0` to each `*.count` (or remove the files). Note that
a brand-new session always starts at 0 automatically; resetting only matters
within the current session.

## Change the warning threshold

The threshold is the env var `COMPACTION_WATCH_THRESHOLD` (default 10). Set it in
the `env` block of `~/.claude/settings.json`. Use `jq` to merge without
clobbering the file:

```bash
S=~/.claude/settings.json; [ -f "$S" ] || echo '{}' > "$S"
tmp=$(mktemp); jq --arg v "15" '.env = (.env // {}) | .env.COMPACTION_WATCH_THRESHOLD = $v' "$S" > "$tmp" && mv "$tmp" "$S"
```

Recommended range is 8-15; do not exceed 20 (past that the warning is symbolic).
Changes to `settings.json` take effect in a new session.

## Related env vars

`COMPACTION_WATCH_AUTO_ONLY` (count only auto compactions),
`COMPACTION_WATCH_BASE_STATUSLINE` (chain a prior statusline),
`COMPACTION_WATCH_RETENTION_DAYS` (how long old counters are kept),
`COMPACTION_WATCH_DEBUG` (dump raw hook stdin to `raw.log`). Set them the same way
as the threshold, in the `env` block.
