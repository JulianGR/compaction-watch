# compaction-watch

Claude Code hooks plugin that **counts the compactions of the current
session** and, once a threshold is exceeded, shows a warning in the
**statusline** to remind you to open a fresh session before the loss
accumulated by compactions degrades quality.

Each compaction summarizes and discards part of the history: it is a lossy
operation and it chains. Several compactions amount to a "summary of a
summary". `compaction-watch` does not try to measure quality or recover what
was lost; it uses an honest, deterministic proxy: **the number of accumulated
compactions**.

No network, no telemetry, no daemon. All state is small files under
`~/.claude/state/compaction-watch/`.

## What it looks like

The base statusline (your own, or a minimal one of model + folder) with a suffix:

```
Opus  my-project                                         (0 compactions)
Opus  my-project  ⟳3                                     (below the threshold)
Opus  my-project  ⚠️ 10 compactions · new session recommended
```

- `⟳N` appears from the first compaction (ambient reminder).
- `⚠️ ...` is the strong warning when the threshold is reached (default 10).

## In-chat notifications

The statusline is a terminal feature and does not render in the Claude Code
desktop GUI. So compaction-watch also delivers the warning **as a chat message**,
which works everywhere hooks run (including the desktop app).

A `UserPromptSubmit` hook (`notify.sh`) checks the counter on each message you
send. When the count crosses the **pre-warning** (default 5) or **full** (default
10) threshold, it prints a short note that the assistant relays to you in chat,
and then repeats it every `COMPACTION_WATCH_REMIND_EVERY` messages (default 5)
while you remain above that threshold. Each threshold also fires immediately the
first time it is crossed.

This is best-effort by timing: the note appears on your **next message** after the
threshold is crossed, not at the exact moment of compaction. Dedup state lives in
`<session_id>.notified` and the per-session message tally in `<session_id>.msgcount`.

## Installation

There are two methods. The statusline **always** requires a `statusLine` entry in
`~/.claude/settings.json` (a Claude Code plugin cannot declare it by itself).
That is why `statusline.sh` is copied to a stable path
(`~/.claude/scripts/compaction-watch/`) and `settings.json` references it with an
absolute path. The copy is remade by the `SessionStart` hook on every startup, so
the stable path always has the current version even if you update the plugin.

### Method A — `install.sh` (recommended, all in one)

```bash
./install.sh
```

It is **additive and idempotent**: it copies the scripts to the stable path and
merges the `PreCompact` and `SessionStart` hooks and the `statusLine` into
`~/.claude/settings.json`. It does not replace the file and does not duplicate
hooks if you run it several times. If you already had a `statusLine`, it **keeps
it** and prints how to chain it with `COMPACTION_WATCH_BASE_STATUSLINE`. If there
is no `jq`, it prints the exact block to paste by hand.

### Method B — plugin via marketplace

Add the marketplace and enable the plugin (registers the `PreCompact` and
`SessionStart` hooks):

```
/plugin marketplace add JulianGR/compaction-watch
/plugin install compaction-watch@compaction-watch
```

Then, **once only**, add the statusLine to `~/.claude/settings.json`
(use your real, already-expanded HOME path):

```json
{
  "statusLine": {
    "type": "command",
    "command": "/Users/your-user/.claude/scripts/compaction-watch/statusline.sh"
  }
}
```

The script will already be at that path because `prune.sh` (the `SessionStart`
hook) copies it on every startup.

## Configuration

Environment variables (set them in the `env` block of `~/.claude/settings.json`):

| Variable | Default | Effect |
| --- | --- | --- |
| `COMPACTION_WATCH_THRESHOLD` | `10` | Number of compactions from which the ⚠️ (full) warning is shown, in the statusline and in chat. Sensible range 8-15; do not go past 20. |
| `COMPACTION_WATCH_PREWARN_THRESHOLD` | `5` | Compactions at which the in-chat **pre-warning** fires. |
| `COMPACTION_WATCH_REMIND_EVERY` | `5` | While at/above a threshold, the in-chat reminder repeats every N of your messages. |
| `COMPACTION_WATCH_AUTO_ONLY` | `0` | If `1`, ignores manual `/compact` calls and only counts automatic ones. |
| `COMPACTION_WATCH_BASE_STATUSLINE` | (empty) | Path to a prior statusline to chain. If empty, a minimal one is used (model + folder). |
| `COMPACTION_WATCH_RETENTION_DAYS` | `7` | Days that the counters of old sessions are kept before purging them. |
| `COMPACTION_WATCH_DEBUG` | `0` | If `1`, dumps the raw stdin of each hook to `~/.claude/state/compaction-watch/raw.log` to verify the JSON field names. |

Example:

```json
{ "env": { "COMPACTION_WATCH_THRESHOLD": "10" } }
```

### Why 10 by default

Compaction is lossy and chained: old content survives as many rounds of
summarization as there are compactions. At ~10 compactions the early context is
practically nonexistent, so 10 works as an "emergency stop". In terms of
frequency, ~10 compactions amount to several hours of continuous intense session,
a reasonable point to suggest a refresh. Since your durable state is already
externalized to `CLAUDE.md`/`memory/`, you can tolerate a slightly higher
threshold (raise it to 15 if the warning bothers you by appearing too soon).

**Heuristic limit:** counting compactions is not measuring real quality. A
session may compact little and be damaged, or compact a lot in linear work and be
fine. That error is accepted in exchange for simplicity and determinism.

## How it works

```
PreCompact (each compaction)    -> bin/count.sh
    increments ~/.claude/state/compaction-watch/<session_id>.count

Statusline (each render)        -> ~/.claude/scripts/compaction-watch/statusline.sh
    reads the session_id counter and composes base + suffix

SessionStart (each startup)     -> bin/prune.sh
    copies statusline.sh to the stable path and purges old counters

UserPromptSubmit (each message) -> bin/notify.sh
    when the count crosses 5 (pre) or 10 (full), prints a reminder the assistant
    relays to you in chat; repeats every REMIND_EVERY messages
```

- **Free reset per new session.** The `session_id` is stable within a session
  (including compaction) and changes when you open a new one: new session =
  counter at 0, no intervention.
- **`--resume` / `--continue`** reuse the `session_id`, so the counter persists
  (you are still in the degraded session, which is correct).
- **Multi-project / parallel sessions:** each `session_id` has its own counter;
  they do not mix.

## Verify the JSON field names

The schemas of the hook/statusline JSON may vary by Claude Code version. Before
trusting the parsing blindly, set `COMPACTION_WATCH_DEBUG=1`, trigger a
compaction and a render, and check
`~/.claude/state/compaction-watch/raw.log` to confirm `session_id`, `trigger`,
`model.display_name` and `workspace.current_dir`. Remove the variable when you
are done.

## Management (skill)

The plugin includes a `compaction-watch` skill for requests like "how many
compactions have I had", "change the threshold to 15" or "reset the counter". It
only reads/writes the state under `~/.claude/state/compaction-watch/` and the
`env` block of your `settings.json`.

## Tests

```bash
bash tests/run.sh
bash tests/install_test.sh
```

They cover the counter increment, `AUTO_ONLY`, corrupt counters, the three
statusline states, configurable threshold, statusline chaining, the copy to the
stable path, purging by age, and the idempotency / preservation of a pre-existing
`statusLine` in `install.sh`.

## Security / privacy

- All state is local. No data leaves the machine. Zero network, zero
  telemetry.
- `COMPACTION_WATCH_BASE_STATUSLINE` runs a command defined by you:
  treat it as user trust.
- Every script always exits with code 0: a failing hook never blocks
  the compaction or the statusline render.

## No-goals

It does not measure real quality, does not write `CLAUDE.md` or `memory/`, does
not inject messages to the LLM, does not detect the live context % (impossible
today with hooks), does not bring up servers and does not try to recover what was
lost in a compaction.

## License

MIT. See [LICENSE](LICENSE).
