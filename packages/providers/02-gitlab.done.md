# GitLab Source Control Provider

Add `gitlab` provider to `source-control/` implementing `SourceControlProvider`.

- GitLab REST API v4
- Config: `token`, `projectId`, `baseUrl` (defaults to gitlab.com)
- Git operations via local git commands (same pattern as GitHub provider)
- MR creation via API
