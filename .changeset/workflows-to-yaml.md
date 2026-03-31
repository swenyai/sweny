---
"@sweny-ai/core": minor
---

Move built-in workflows (triage, implement, seed-content) from TypeScript objects to YAML files. The YAML format is the same one users create with `sweny workflow create` — dog-fooding the format. A browser-safe JS bundle is generated at build time for Studio and docs.
