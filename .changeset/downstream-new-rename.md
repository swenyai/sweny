---
"create-sweny": patch
"@sweny-ai/core": patch
---

Update `create-sweny` to invoke `sweny new`. Remove `sweny init` command and
`./init` package export — clean upgrade, no deprecation shim. Plugin skill
`init` renamed to `new`; `e2e-init` skill removed in favor of the unified
`new` skill. README, CLAUDE.md, CLI docs, and the MCP plugin doc updated.
