import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { StepCache, CacheEntry, TriageConfig } from "@sweny-ai/engine";
import type { CliConfig } from "./config.js";

/**
 * Create a filesystem-backed step cache.
 * Each step result is stored as `<dir>/<stepName>.json`.
 */
export function createFsCache(dir: string, ttlMs: number): StepCache {
  return {
    async get(stepName) {
      const filePath = path.join(dir, `${stepName}.json`);
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const entry: CacheEntry = JSON.parse(raw);
        if (Date.now() - entry.createdAt > ttlMs) return undefined;
        return entry;
      } catch {
        return undefined;
      }
    },

    async set(stepName, entry) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${stepName}.json`), JSON.stringify(entry, null, 2), "utf-8");
    },
  };
}

/**
 * Compute a stable hash of the config fields that affect workflow behavior.
 * Secrets and output-only flags are excluded.
 */
export function hashConfig(triageConfig: TriageConfig, cliConfig: CliConfig): string {
  const key = {
    // Triage behavior
    timeRange: triageConfig.timeRange,
    severityFocus: triageConfig.severityFocus,
    serviceFilter: triageConfig.serviceFilter,
    investigationDepth: triageConfig.investigationDepth,
    maxInvestigateTurns: triageConfig.maxInvestigateTurns,
    maxImplementTurns: triageConfig.maxImplementTurns,
    serviceMapPath: triageConfig.serviceMapPath,
    repository: triageConfig.repository,
    baseBranch: triageConfig.baseBranch,
    prLabels: triageConfig.prLabels,
    dryRun: triageConfig.dryRun,
    noveltyMode: triageConfig.noveltyMode,
    issueOverride: triageConfig.issueOverride,
    additionalInstructions: triageConfig.additionalInstructions,
    projectId: triageConfig.projectId,
    // Provider selections (changing provider changes output)
    observabilityProvider: cliConfig.observabilityProvider,
    issueTrackerProvider: cliConfig.issueTrackerProvider,
    codingAgentProvider: cliConfig.codingAgentProvider,
    sourceControlProvider: cliConfig.sourceControlProvider,
  };

  return crypto.createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 12);
}
