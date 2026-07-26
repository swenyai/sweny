---
"@sweny-ai/core": minor
---

Add opt-in run reporting via `SWENY_CLOUD_TOKEN`. When set, run summaries
(status, duration, findings, PR/issue URLs) are sent to the configured
reporting endpoint using a project-scoped Bearer token. Without the token, the
CLI makes zero network calls to sweny.ai. No anonymous telemetry, no
phone-home. Token minting is not currently exposed, so this path is dormant by
default; the hosted service is in active development.

**Breaking (security):** The CLI no longer forwards `GITHUB_TOKEN` to the
reporting endpoint for authentication. The only auth paths are
`SWENY_CLOUD_TOKEN` and GitHub App installation. The deprecated
`Authorization: token <github-token>` path on the `/api/report` endpoint has
been removed.

New config: `SWENY_CLOUD_TOKEN` env var or `cloud-token` in `.sweny.yml`.
