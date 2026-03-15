// Core types
export type {
  WorkflowPhase,
  StepResult,
  StepMeta,
  WorkflowContext,
  ProviderRegistry,
  WorkflowResult,
  RunOptions,
  Workflow,
  WorkflowDefinition,
  StepDefinition,
  StepImplementations,
  WorkflowDefinitionError,
  ExecutionEvent,
  RunObserver,
  ProviderConfigSchema,
} from "./types.js";

// WorkflowConfigError is a class, not just a type
export { WorkflowConfigError } from "./types.js";

// Cache
export type { CacheEntry, StepCache } from "./cache.js";

// Runner
export { runWorkflow, createProviderRegistry, validateWorkflow, createWorkflow } from "./runner-recipe.js";

// Observer utilities
export { CollectingObserver, CallbackObserver, composeObservers } from "./observer.js";

// Built-in workflows
export { triageWorkflow, triageDefinition } from "./recipes/triage/index.js";
export { implementWorkflow, implementDefinition } from "./recipes/implement/index.js";

// Workflow configs and types
export type { ImplementConfig } from "./recipes/implement/index.js";
export type {
  TriageConfig,
  InvestigationResult,
  ImplementResult,
  BuildContextData,
  IssueData,
  ImplementFixData,
  PrData,
  CrossRepoData,
  TriageStepDataMap,
} from "./recipes/triage/index.js";
export { getStepData } from "./recipes/triage/index.js";

// Idempotency utilities
export type { DedupStore } from "./lib/dedup-store.js";
export { inMemoryDedupStore } from "./lib/dedup-store.js";
export { fingerprintEvent } from "./lib/fingerprint.js";
