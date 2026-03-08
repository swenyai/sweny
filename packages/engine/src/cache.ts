import type { StepResult } from "./types.js";

/** A cached node result with metadata for replay. */
export interface CacheEntry {
  /** The node's result, exactly as returned from node.run(). */
  result: StepResult;
  /** Unix ms timestamp when this entry was written. */
  createdAt: number;
}

/** Storage contract for node-level caching. */
export interface StepCache {
  /** Retrieve a non-expired entry, or undefined on miss/expiry. */
  get(nodeId: string): Promise<CacheEntry | undefined>;
  /** Persist a successful node result. */
  set(nodeId: string, entry: CacheEntry): Promise<void>;
}
