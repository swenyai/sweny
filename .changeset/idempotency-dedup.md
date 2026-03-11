---
"@sweny-ai/engine": minor
---

Add deterministic idempotency to triage recipe via content fingerprinting.

- `fingerprintEvent()` — SHA-256 content hash of stable event fields (16-char hex)
- `inMemoryDedupStore()` — Map-backed store with configurable TTL (default 24h)
- `TriageConfig.dedupStore` — optional; new `dedup-check` DAG step short-circuits
  to notify before any LLM or provider calls when fingerprint already seen
- Exports `DedupStore`, `inMemoryDedupStore`, `fingerprintEvent` from engine index
