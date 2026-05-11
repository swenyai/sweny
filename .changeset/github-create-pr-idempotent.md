---
"@sweny-ai/core": patch
---

`github_create_pr` is now idempotent. When GitHub responds 422 "A pull request
already exists for {owner}:{branch}" (typical when a prior node or run already
opened a PR for the same head branch), the tool now looks up that PR via
`GET /pulls?head={owner}:{branch}` and returns it as the result, with an extra
`reused: true` field, instead of throwing.

Fixes the self-close-and-recreate workaround observed in production: the
`create_pr` node's eval (`github_create_pr` must succeed) could not pass on a
re-run, so the agent posted "Closing to recreate via the correct PR creation
flow." on the existing PR and reopened a new one against the same branch. With
this change, `github_create_pr` returns the existing PR and the eval passes.

Also tightens the `triage` and `implement` workflow instructions so the
`implement` node stops after the commit and lets `create_pr` push and open the
PR, and the `create_pr` node treats `reused: true` as success.
