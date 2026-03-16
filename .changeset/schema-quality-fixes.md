---
"@sweny-ai/engine": patch
"@sweny-ai/cli": patch
"@sweny-ai/studio": patch
---

Fix schema publication, semver validation, and shared schema header constant.

- `schema/` directory now included in engine package `files` so `@sweny-ai/engine/schema`
  actually ships to npm consumers (was silently missing before)
- JSON Schema semver regex now anchored with `$` — previously allowed trailing
  garbage like `"1.0.0-junk!!!"` to pass validation
- `WORKFLOW_YAML_SCHEMA_HEADER` exported from `@sweny-ai/engine` so CLI and Studio
  import a single source of truth instead of duplicating the URL string
- Added schema tests: pre-release labels, build metadata, `type` field acceptance,
  unknown extra property rejection, end-anchor semver check
