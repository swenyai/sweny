import { fingerprintEvent } from "../../../lib/fingerprint.js";
import type { StepResult, WorkflowContext } from "../../../types.js";
import type { TriageConfig } from "../types.js";

/**
 * Deterministic dedup check — short-circuits the recipe before any LLM or
 * provider calls if this event has already been processed within the TTL window.
 *
 * Only active when `config.dedupStore` is provided. Safe to omit for one-off
 * runs or when the caller guarantees uniqueness upstream.
 */
export async function dedupCheck(ctx: WorkflowContext<TriageConfig>): Promise<StepResult> {
  const { config, logger } = ctx;

  if (!config.dedupStore) {
    return { status: "success" };
  }

  const fp = fingerprintEvent({
    repository: config.repository,
    serviceFilter: config.serviceFilter,
    timeRange: config.timeRange,
    issueOverride: config.issueOverride,
  });

  if (await config.dedupStore.has(fp)) {
    logger.info(`Dedup: skipping duplicate event (fingerprint ${fp})`);
    return { status: "success", data: { outcome: "duplicate", duplicate: true, fingerprint: fp } };
  }

  await config.dedupStore.add(fp);
  logger.info(`Dedup: new event (fingerprint ${fp})`);
  return { status: "success" };
}
