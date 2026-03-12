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
/**
 * In-memory DedupStore backed by a Map with TTL expiry.
 *
 * Safe for single-process use. Not shared across processes or restarts.
 */
export declare function inMemoryDedupStore(): DedupStore;
//# sourceMappingURL=dedup-store.d.ts.map