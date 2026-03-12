/**
 * Simple dedup store for preventing duplicate event processing.
 *
 * The in-memory implementation is sufficient for single-process deployments
 * (CLI, self-hosted). For multi-process deployments (cloud worker pool), swap
 * in a Redis-backed implementation that satisfies the same interface.
 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
/**
 * In-memory DedupStore backed by a Map with TTL expiry.
 *
 * Safe for single-process use. Not shared across processes or restarts.
 */
export function inMemoryDedupStore() {
    const store = new Map(); // fingerprint → expiry timestamp
    return {
        async has(fingerprint) {
            const expiry = store.get(fingerprint);
            if (expiry === undefined)
                return false;
            if (Date.now() > expiry) {
                store.delete(fingerprint);
                return false;
            }
            return true;
        },
        async add(fingerprint, ttlMs = DEFAULT_TTL_MS) {
            store.set(fingerprint, Date.now() + ttlMs);
        },
    };
}
//# sourceMappingURL=dedup-store.js.map