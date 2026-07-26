---
name: compaction-watch
description: Use when the user asks about automatic context compactions, compaction-watch status, alert thresholds, or starting a fresh session.
---

# compaction-watch

`compaction-watch` tracks automatic compactions for the active host and session. It stores local event files only and sends no telemetry.

It raises a best-effort OS alert immediately at 5 and 10 automatic compactions. The next user prompt gets an in-chat reminder, then repeats every 5 prompts by default. A fresh session has separate state. Session history is intentionally retained for correctness.

Supported hosts are Codex Desktop, Claude Desktop and Claude Code, and Kimi CLI. Kimi VS Code support is experimental. ChatGPT Web is out of scope.

Run this diagnostic from the plugin root with the active host name:

`node bin/compaction-watch.mjs status --host <host>`

Use 5 as the soft threshold and 10 as the strong threshold unless the user has a clear reason to change them. Automatic compactions are counted by default. `COMPACTION_WATCH_INCLUDE_MANUAL=1` also includes manual compactions.
