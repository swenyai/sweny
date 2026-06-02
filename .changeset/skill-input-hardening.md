---
"@sweny-ai/core": patch
---

Per-skill input hardening for LLM-controlled tool arguments (#226).

- **GitHub**: `github_get_file` now percent-encodes the model-chosen `path` (and `ref`), and rejects `.`/`..` segments, so a crafted path can no longer inject query parameters or escape the contents endpoint.
- **BetterStack**: `table` is validated as a bare ClickHouse identifier before it reaches `DESCRIBE TABLE remote(...)`. The read-only query guard now accepts `WITH` CTEs, rejects multi-statement input, ignores keywords inside string literals when deciding whether to append the `LIMIT` cap, and is documented as best-effort UX — use a read-only ClickHouse role as the actual security boundary.
- **Supabase**: table and function names are validated as identifiers, PostgREST filter values are URL-encoded so a single filter cannot smuggle extra query parameters, and the new optional `SUPABASE_ALLOWED_TABLES` / `SUPABASE_ALLOWED_FUNCTIONS` config bounds what the agent can touch. The service-role blast radius is now documented on the skill and in the docs.
