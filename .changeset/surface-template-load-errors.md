---
"@sweny-ai/core": patch
---

Surface configured template/context load failures instead of silently using the default. `loadTemplate` and `loadAdditionalContext` now throw when a CONFIGURED source fails to resolve (404, 403, SSRF block, read error), matching the executor's per-node Source handling. A typo'd or unauthorized template URL is a misconfiguration, not a no-op. The default is still returned only for an empty/unset source or a URL source intentionally skipped under `--offline`.
