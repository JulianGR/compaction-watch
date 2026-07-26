# compaction-watch

This repository root is the plugin root for Claude, Codex, and Kimi. The runtime is Node 20+ in `bin/compaction-watch.mjs` and `lib/compaction-watch.mjs`.

- Claude hooks are declared inline in `.claude-plugin/plugin.json` with `--host claude`.
- Codex discovers `hooks/hooks.json` and uses `--host codex`.
- Kimi declares hooks in `kimi.plugin.json` and uses `--host kimi`.
- `PreCompact` records automatic compactions, `PostCompact` sends the immediate alert, `UserPromptSubmit` emits paced in-chat reminders, and `SessionStart` calls the non-destructive `prune()`.

Keep host adapters separate. Do not add shell scripts, statuslines, jq installers, or a `hooks` field to `.codex-plugin/plugin.json`. Keep output plain injected context for Claude and Kimi, and Codex system-message JSON. The Node core owns native OS notifications.

Run `npm test` and, when available, the Codex plugin validator supplied by installed plugin developer tooling before changing plugin packaging. Session history is intentionally retained for correctness.
