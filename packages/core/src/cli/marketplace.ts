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
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    const err = new Error(`Could not reach github.com — check your connection`) as FetchError;
    err.kind = "network";
    throw err;
  }

  if (res.status === 404) {
    const err = new Error(
      `Workflow "${id}" not found in ${MARKETPLACE_REPO}. See https://marketplace.sweny.ai for available workflows.`,
    ) as FetchError;
    err.kind = "not-found";
    throw err;
  }

  if (res.status === 403 && res.headers.get("X-RateLimit-Remaining") === "0") {
    const reset = res.headers.get("X-RateLimit-Reset");
    const err = new Error(`GitHub rate limit hit. Set GITHUB_TOKEN to raise the limit, or retry later.`) as FetchError;
    err.kind = "rate-limit";
    if (reset) err.retryAfter = parseInt(reset, 10);
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`Fetch failed with status ${res.status}`) as FetchError;
    err.kind = "unknown";
    throw err;
  }

  return { id, yaml: await res.text() };
}
