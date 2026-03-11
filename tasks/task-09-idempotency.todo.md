# Task 09: Deterministic Idempotency / Novelty Gate

## Problem

The triage recipe's dedup is currently:
1. Semantic — Claude looks at 30-day label history and decides if the issue is novel
2. Title search fallback — `searchIssues` by title before `createIssue`

This is insufficient for exact idempotency. If the same webhook fires twice in rapid
succession (e.g. GitHub retries, duplicate alert), both runs may pass the novelty gate
before either has created an issue.

`FingerprintCapable` / `searchByFingerprint` was designed to solve this but was never
wired into any engine step — it was dead code and was removed in Task 03.

## Design Decision

Fingerprinting belongs at the **engine level**, not buried in provider capability checks.
Rationale: it's orchestration logic (content hash → dedup store → skip-or-proceed),
not provider API knowledge.

## What to Build

### 1. `packages/engine/src/lib/fingerprint.ts`

```typescript
import { createHash } from "node:crypto";

/**
 * Deterministic content hash for a triage/implement event.
 * Stable across runs given the same source content.
 */
export function fingerprintEvent(fields: Record<string, string | undefined>): string {
  const stable = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k] ?? ""}`)
    .join("\n");
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}
```

### 2. `packages/engine/src/lib/dedup-store.ts`

In-memory dedup store (sufficient for single-process; swap for Redis/DB in cloud).

```typescript
export interface DedupStore {
  has(fingerprint: string): Promise<boolean>;
  add(fingerprint: string, ttlMs?: number): Promise<void>;
}

/** Default TTL: 24 hours */
const DEFAULT_TTL = 24 * 60 * 60 * 1000;

export function inMemoryDedupStore(): DedupStore {
  const store = new Map<string, number>();
  return {
    async has(fp) {
      const exp = store.get(fp);
      if (exp === undefined) return false;
      if (Date.now() > exp) { store.delete(fp); return false; }
      return true;
    },
    async add(fp, ttlMs = DEFAULT_TTL) {
      store.set(fp, Date.now() + ttlMs);
    },
  };
}
```

### 3. `TriageConfig` — add optional `dedupStore`

In `packages/engine/src/recipes/triage/config.ts` (or wherever TriageConfig is defined):

```typescript
import type { DedupStore } from "../../lib/dedup-store.js";

export interface TriageConfig {
  // ... existing fields ...
  /**
   * Optional dedup store. If provided, triage skips processing events
   * whose fingerprint was already seen within the TTL window.
   */
  dedupStore?: DedupStore;
}
```

### 4. `packages/engine/src/recipes/triage/steps/novelty-gate.ts`

Add a fingerprint check at the top of the step (or as a new preceding step):

```typescript
import { fingerprintEvent } from "../../../lib/fingerprint.js";

// Inside the step, before any LLM call:
if (config.dedupStore) {
  const fp = fingerprintEvent({
    source: ctx.issueSource ?? "",      // e.g. "github-issues"
    externalId: ctx.externalId ?? "",   // e.g. issue number or alert ID
    title: ctx.issueTitle ?? "",
  });
  if (await config.dedupStore.has(fp)) {
    logger.info(`Dedup: skipping duplicate event (fingerprint ${fp})`);
    return { recommendation: "duplicate", fingerprint: fp };
  }
  await config.dedupStore.add(fp);
}
```

Alternatively, implement as its own `dedup-check` step early in the DAG before `investigate`.

### 5. Tests

- `packages/engine/src/lib/fingerprint.test.ts` — same input → same hash; different input → different hash; field order irrelevant
- `packages/engine/src/lib/dedup-store.test.ts` — has() returns false initially, true after add(), false after TTL expires (use fake timers)
- Update `packages/engine/src/recipes/triage/steps/novelty-gate.test.ts` (or new step test) — with dedupStore: skips on second call; without dedupStore: proceeds normally

## Files to Create/Modify

- `packages/engine/src/lib/fingerprint.ts` (new)
- `packages/engine/src/lib/dedup-store.ts` (new)
- `packages/engine/src/lib/fingerprint.test.ts` (new)
- `packages/engine/src/lib/dedup-store.test.ts` (new)
- `packages/engine/src/recipes/triage/config.ts` — add `dedupStore?` field
- `packages/engine/src/recipes/triage/steps/novelty-gate.ts` (or new `dedup-check.ts` step) — wire dedup check
- `packages/engine/src/recipes/triage/index.ts` — export `inMemoryDedupStore` and `DedupStore` type if not re-exported from engine index
- `packages/engine/src/index.ts` — export `inMemoryDedupStore`, `DedupStore`, `fingerprintEvent`

## Changeset

```md
---
"@sweny-ai/engine": minor
---

Add deterministic idempotency to triage recipe via content fingerprinting.
`TriageConfig.dedupStore` accepts a `DedupStore` (default: in-memory with 24h TTL).
Duplicate events with the same fingerprint are short-circuited before LLM invocation.
Exports: `inMemoryDedupStore`, `DedupStore`, `fingerprintEvent`.
```

## Verification

```bash
cd packages/engine
npm run typecheck
npm test
# All new tests pass; existing triage integration test still passes (dedupStore is optional)
```

## Commit Message

```
feat(engine): add deterministic idempotency via content fingerprinting

- fingerprintEvent() — sha256 hash of stable event fields
- inMemoryDedupStore() — Map-backed store with configurable TTL (default 24h)
- TriageConfig.dedupStore — optional; skips LLM when fingerprint already seen
- Solves exact-duplicate webhook/alert replay without relying on LLM semantic dedup
```
