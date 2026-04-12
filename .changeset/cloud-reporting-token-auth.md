---
"@sweny-ai/core": minor
---

Add opt-in cloud reporting via `SWENY_CLOUD_TOKEN`. When set, run summaries
(status, duration, findings, PR/issue URLs) are sent to cloud.sweny.ai using
a project-scoped Bearer token. Without the token, the CLI makes zero network
calls to sweny.ai — no anonymous telemetry, no phone-home.

**Breaking (security):** The CLI no longer forwards `GITHUB_TOKEN` to
cloud.sweny.ai for authentication. The only auth paths are `SWENY_CLOUD_TOKEN`
(project token from cloud.sweny.ai) and GitHub App installation. The deprecated
`Authorization: token <github-token>` path on the cloud `/api/report` endpoint
has been removed.

New config: `SWENY_CLOUD_TOKEN` env var or `cloud-token` in `.sweny.yml`.
