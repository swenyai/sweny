---
"@sweny-ai/core": patch
---

CLI hardening: add a 5s timeout to every `sweny check` provider fetch (a hung connect now reports "timed out" instead of hanging), validate `DD_SITE` against a hostname allowlist before URL interpolation, give `sweny implement` credential + integer validation parity with triage (curated "Missing: ..." error, safe `parsePositiveInt` for `--max-implement-turns`), bound-check `--cache-ttl` in `validateInputs`, and warn (naming the file) when a malformed `.sweny.yml` is dropped instead of silently falling back to defaults.
