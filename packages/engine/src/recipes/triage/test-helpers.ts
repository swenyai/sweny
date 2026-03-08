import { vi } from "vitest";
import type { WorkflowContext, StepResult } from "../../types.js";
import { createProviderRegistry } from "../../runner-recipe.js";
import type { TriageConfig } from "./types.js";

export const silentLogger = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

export const defaultConfig: TriageConfig = {
  timeRange: "1h",
  severityFocus: "error",
  serviceFilter: "api-*",
  investigationDepth: "normal",
  maxInvestigateTurns: 10,
  maxImplementTurns: 20,
  serviceMapPath: "",
  projectId: "proj-1",
  bugLabelId: "label-bug",
  triageLabelId: "label-triage",
  stateBacklog: "state-backlog",
  stateInProgress: "state-progress",
  statePeerReview: "state-review",
  repository: "org/repo",
  dryRun: false,
  noveltyMode: false,
  issueOverride: "",
  additionalInstructions: "",
  agentEnv: {},
};

/** Create a mock WorkflowContext with sensible defaults. Override anything via params. */
export function createCtx(overrides?: {
  config?: Partial<TriageConfig>;
  results?: Map<string, StepResult>;
  providers?: ReturnType<typeof createProviderRegistry>;
}): WorkflowContext<TriageConfig> {
  return {
    config: { ...defaultConfig, ...overrides?.config },
    logger: silentLogger,
    results: overrides?.results ?? new Map(),
    providers: overrides?.providers ?? createProviderRegistry(),
  };
}
