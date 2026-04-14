// packages/core/src/cli/marketplace.ts
/**
 * Marketplace install — fetch workflows from swenyai/workflows and
 * adapt them to the user's .sweny.yml providers.
 *
 * Pure functions for fetch/mismatch/adapt; file writes delegate to
 * helpers in ./new.ts.
 */

export const MARKETPLACE_REPO = "swenyai/workflows";
export const MARKETPLACE_RAW_BASE = `https://raw.githubusercontent.com/${MARKETPLACE_REPO}/main`;

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  skills: string[];
}

export interface FetchError extends Error {
  kind: "not-found" | "rate-limit" | "network" | "bad-yaml" | "unknown";
  retryAfter?: number; // unix seconds, for rate-limit
}

export interface FetchedWorkflow {
  id: string;
  yaml: string;
}

export async function fetchMarketplaceWorkflow(id: string): Promise<FetchedWorkflow> {
  const url = `${MARKETPLACE_RAW_BASE}/workflows/${id}.yml`;
  const res = await fetch(url);
  if (!res.ok) {
    throw makeFetchError(res, id);
  }
  const yaml = await res.text();
  return { id, yaml };
}

function makeFetchError(res: Response, id: string): FetchError {
  const err = new Error(`Fetch failed: ${res.status}`) as FetchError;
  err.kind = "unknown";
  return err;
}
