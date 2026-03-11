/**
 * Simple dedup store for preventing duplicate event processing.
 *
 * The in-memory implementation is sufficient for single-process deployments
 * (CLI, self-hosted). For multi-process deployments (cloud worker pool), swap
 * in a Redis-backed implementation that satisfies the same interface.
 */

export interface DedupStore {
  /** Returns true if this fingerprint was seen within its TTL window. */
  has(fingerprint: string): Promise<boolean>;
  /** Record a fingerprint as seen. Expires after `ttlMs` (default: 24 hours). */
  add(fingerprint: string, ttlMs?: number): Promise<void>;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * In-memory DedupStore backed by a Map with TTL expiry.
 *
 * Safe for single-process use. Not shared across processes or restarts.
 */
export function inMemoryDedupStore(): DedupStore {
  const store = new Map<string, number>(); // fingerprint → expiry timestamp

  return {
    async has(fingerprint: string): Promise<boolean> {
      const expiry = store.get(fingerprint);
      if (expiry === undefined) return false;
      if (Date.now() > expiry) {
        store.delete(fingerprint);
        return false;
      }
      return true;
    },

    async add(fingerprint: string, ttlMs: number = DEFAULT_TTL_MS): Promise<void> {
      store.set(fingerprint, Date.now() + ttlMs);
    },
  };
}
