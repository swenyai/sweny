---
"create-sweny": patch
"@sweny-ai/core": patch
---

Update `create-sweny` to invoke `sweny new` (was `sweny init`). Plugin skill
`init` renamed to `new`; `e2e-init` and `workflow-create` skills removed in
favor of the unified `new` skill. README, CLAUDE.md, CLI docs, and the MCP
plugin doc updated to recommend `sweny new`.
