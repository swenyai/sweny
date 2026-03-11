---
"@sweny-ai/providers": minor
---

Add `GitProvider` (local git operations) and `RepoProvider` (remote API operations) interfaces.
`SourceControlProvider` is now a type alias for `GitProvider & RepoProvider` — fully backward compatible.
Enables partial implementations for contexts without a local checkout (cloud workers, MCP servers).
