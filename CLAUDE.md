# compaction-watch

Claude Code hooks plugin that counts per-session compactions and warns in the
statusline past a threshold (default 10), to nudge starting a fresh session
before accumulated lossy-compaction degrades quality. Pure shell, no network, no
telemetry. All state is small files under `~/.claude/state/compaction-watch/`.

## Layout

- `plugins/compaction-watch/bin/count.sh` — `PreCompact` hook; increments
  `<session_id>.count`.
- `plugins/compaction-watch/bin/statusline.sh` — statusLine command; prints base
  line + suffix (`⟳N` below threshold, `⚠️ ... new session recommended` at/above).
- `plugins/compaction-watch/bin/prune.sh` — `SessionStart` hook; copies
  statusline.sh to the stable path `~/.claude/scripts/compaction-watch/` and
  purges old counters.
- `plugins/compaction-watch/bin/notify.sh` — `UserPromptSubmit` hook; prints an
  in-chat reminder (to stdout, injected as context) when the count crosses the
  pre-warn (5) or full (10) threshold, repeating every `REMIND_EVERY` messages.
  Dedup state in `<session_id>.notified`, message tally in `<session_id>.msgcount`.
- `plugins/compaction-watch/hooks/hooks.json` — registers PreCompact + SessionStart
  + UserPromptSubmit.
- `plugins/compaction-watch/.claude-plugin/plugin.json` — plugin manifest.
- `plugins/compaction-watch/skills/compaction-watch/SKILL.md` — management skill.
- `.claude-plugin/marketplace.json` — marketplace manifest.
- `install.sh` — additive, idempotent installer (merges settings.json via jq).
- `tests/run.sh`, `tests/install_test.sh` — dependency-free bash tests.

## Test

```bash
bash tests/run.sh
bash tests/install_test.sh
```

Tests isolate state by overriding `HOME` to a temp dir, then drive each script
with simulated hook JSON on stdin.

## Conventions (do not break)

- Shell: `bash`, `set -euo pipefail`, no comments in scripts.
- Every script exits 0 always — a failing hook must never block compaction or the
  statusline render.
- The `⚠️` / `⟳` characters appear only as statusline output data, never as code
  decoration.
- statusLine output is a single line.
- No network, no telemetry. `grep -rIn "curl\|wget\|http" plugins/.../bin/` must be empty.
- The statusLine entry cannot be declared by the plugin manifest — it must live in
  `~/.claude/settings.json` pointing at the stable-path copy that `prune.sh` keeps
  fresh on every SessionStart.
- Verify hook/statusline JSON field names per Claude Code version before trusting
  the `jq` parse: set `COMPACTION_WATCH_DEBUG=1` and inspect `raw.log`.

## Env vars

`COMPACTION_WATCH_THRESHOLD` (10), `COMPACTION_WATCH_PREWARN_THRESHOLD` (5),
`COMPACTION_WATCH_REMIND_EVERY` (5), `COMPACTION_WATCH_AUTO_ONLY` (0),
`COMPACTION_WATCH_BASE_STATUSLINE` (empty), `COMPACTION_WATCH_RETENTION_DAYS` (7),
`COMPACTION_WATCH_DEBUG` (0).
