---
"@sweny-ai/core": patch
---

Harden two agent-tool exfiltration sinks.

- `notify_webhook` no longer POSTs to an arbitrary, model-chosen host. The destination is locked to `NOTIFICATION_WEBHOOK_URL`; a `url` override is only honored when its host matches the configured URL or an entry in the new `NOTIFICATION_WEBHOOK_ALLOWED_HOSTS` allowlist, otherwise it is rejected with a clear error.
- A discovered `SKILL.md` that declares a local stdio `mcp.command` now emits a `stdio-command-declared` diagnostic and is not wired as a launchable server unless `SWENY_ALLOW_SKILL_STDIO_COMMAND=1` is set. HTTP (`mcp.url`) skills and skills without `mcp` are unaffected.
