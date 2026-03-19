---
"@sweny-ai/cli": patch
---

Expose `--additional-instructions` on `sweny implement`. The flag was wired into the engine config but never registered on the CLI subcommand, so it was silently ignored. Also fixes the CLI examples doc which incorrectly used a non-existent `--issue-identifier` flag instead of the positional `<issueId>` argument.
