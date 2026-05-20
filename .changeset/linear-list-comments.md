---
"@sweny-ai/core": minor
---

Add `linear_list_comments` to the Linear skill. Returns id, body, author, and timestamp for each comment on an issue, given an issue ID or identifier. The skill previously had no way to read an issue's comments, so any workflow needing comment history (for example, an idempotency check that scans for a sentinel comment before posting) had to fall back to the remote Linear MCP. The new tool is aliased to the Linear MCP `list_comments` tool so verify treats the two as equivalent.
