---
"@sweny-ai/core": minor
---

Multi-model cost tiering plus gateway/multi-auth support.

- **Per-node execution model.** New optional `model` field on `Node` and
  `Workflow`, resolved `node.model ?? workflow.model ?? client default`. Put a
  cheap model on grunt nodes and a strong one on reasoning nodes. Free-text
  passthrough (no registry), consistent with `judge_model`.
- **Explicit auth precedence.** New `SWENY_AUTH` env var (`auto` | `api-key` |
  `oauth`). Default `auto` is byte-for-byte the previous behavior (strip
  `ANTHROPIC_API_KEY` when an OAuth token is present). `api-key` preserves the
  key and bearer for gateway auth even when an OAuth token is also present.
  Adds `ANTHROPIC_AUTH_TOKEN` (bearer) handling, which most LiteLLM setups
  need. Base-URL presence deliberately does not change auth precedence.
- **Gateway support.** `ANTHROPIC_BASE_URL` is documented; `sweny check` is now
  gateway-aware (probes the gateway, not real Anthropic, and reports the
  resolved auth mode with the URL redacted to scheme+host). New action inputs
  `anthropic-base-url`, `anthropic-auth-token`, and `sweny-auth`.
