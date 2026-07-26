# compaction-watch

`compaction-watch` records automatic context compactions locally and alerts you when a session is becoming too long. It supports Codex Desktop, Claude Desktop and Claude Code, and Kimi CLI. Kimi VS Code support is experimental. ChatGPT Web is out of scope.

The `PreCompact` hook counts automatic compactions. At 5 automatic compactions it raises a soft alert. At 10 it raises a strong alert recommending a fresh session. Each threshold attempts an immediate best-effort OS alert. The next user prompt receives an in-chat reminder, which repeats every 5 prompts by default while the threshold remains active. These prompt repeats only read local state: they never increment the compaction count or modify project files.

The Node core counts automatic compactions only by default. Set `COMPACTION_WATCH_INCLUDE_MANUAL=1` to include manual compactions. State is stored only on the local machine under `~/.agent-compaction-watch`; there is no telemetry or network service. Session history is intentionally retained for correctness.

## Install

### Claude Code

Add this repository as a Claude marketplace, then install `compaction-watch`:

```text
/plugin marketplace add JulianGR/compaction-watch
/plugin install compaction-watch@compaction-watch
```

The marketplace entry points to the repository root, so the installed plugin contains `bin/compaction-watch.mjs` and `lib/compaction-watch.mjs`.

### Claude Desktop

Use Claude Desktop's local Code/plugin UI when it is available to add the
`JulianGR/compaction-watch` marketplace and install `compaction-watch`. The
Claude Code slash commands above are for Claude Code sessions, not a claim that
Claude Desktop is a CLI wrapper.

### Codex

```text
codex plugin marketplace add JulianGR/compaction-watch
codex plugin add compaction-watch@compaction-watch
```

Codex discovers its adapters from `hooks/hooks.json`.

### Kimi CLI

```text
/plugins install https://github.com/JulianGR/compaction-watch
/reload
```

Kimi Code VS Code support is experimental and has not been verified.

## Diagnose

From the plugin root, run:

`node bin/compaction-watch.mjs status --host <host>`

Use `claude`, `codex`, or `kimi` for `<host>`. This prints the local status JSON for the supplied hook payload. In a host session the lifecycle adapters provide that payload automatically.

For a useful per-session standalone diagnostic, provide hook JSON on standard input with both `cwd` and `session_id`. Without that payload, `status` uses a synthetic `unknown` session and reports its local count, which is normally zero.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMPACTION_WATCH_SOFT_THRESHOLD` | `5` | Soft warning threshold. |
| `COMPACTION_WATCH_STRONG_THRESHOLD` | `10` | Strong warning threshold. |
| `COMPACTION_WATCH_REMIND_EVERY` | `5` | User prompts between repeated in-chat reminders. |
| `COMPACTION_WATCH_INCLUDE_MANUAL` | unset | Set to `1` to include manual compactions. |

## Development

Run all Node tests with `npm test`. When available, validate the Codex plugin with the validator supplied by installed Codex plugin developer tooling.

## License

MIT. See [LICENSE](LICENSE).
