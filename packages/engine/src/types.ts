import type { Logger } from "@sweny-ai/providers";
import type { ProviderConfigSchema } from "@sweny-ai/providers";

/** The three phases of every workflow. */
export type WorkflowPhase = "learn" | "act" | "report";

/** Result returned by a node after execution. */
export interface StepResult {
  /** Whether the node succeeded, was skipped, or failed. */
  status: "success" | "skipped" | "failed";
  /**
   * Arbitrary output data — downstream nodes read this via ctx.results.
   * Set data.outcome (string) to drive on: routing in the runner.
   */
  data?: Record<string, unknown>;
  /** Human-readable reason (especially useful for skipped/failed). */
  reason?: string;
  /** True when this result was replayed from cache rather than freshly executed. */
  cached?: boolean;
}

/** Mutable context threaded through every node in a workflow run. */
export interface WorkflowContext<TConfig = unknown> {
  /** Workflow-specific configuration. */
  config: TConfig;
  /** Logger for structured output. */
  logger: Logger;
  /** Accumulated results from completed nodes, keyed by node id. */
  results: Map<string, StepResult>;
  /** Instantiated providers, keyed by role ("observability", "issueTracker", etc.). */
  providers: ProviderRegistry;
}

/** Type-safe provider bag. */
export interface ProviderRegistry {
  /** Get a provider by role key. Throws if not found. */
  get<T>(key: string): T;
  /** Check if a provider is registered under this key. */
  has(key: string): boolean;
  /** Register a provider under a role key. */
  set(key: string, provider: unknown): void;
}

/** Overall result of running a workflow. */
export interface WorkflowResult {
  /** completed = all nodes finished, failed = critical node failed, partial = non-critical failure. */
  status: "completed" | "failed" | "partial";
  /** Every node that was attempted, in execution order. */
  steps: Array<{ name: string; phase: WorkflowPhase; result: StepResult }>;
  /** Total wall-clock milliseconds. */
  duration: number;
}

/** Minimal node identity passed to beforeStep / afterStep hooks. */
export interface StepMeta {
  /** The node's unique id within the workflow. */
  id: string;
  /** The phase this node belongs to. */
  phase: WorkflowPhase;
}

/** Options for runWorkflow. */
export interface RunOptions {
  /** Logger instance. Falls back to console. */
  logger?: Logger;
  /**
   * Called before each node executes.
   * Return false to skip the node (it will be recorded as "skipped" and routing continues normally).
   */
  beforeStep?(step: StepMeta, ctx: WorkflowContext): Promise<boolean | void>;
  /** Called after each node completes (including skipped and cached). */
  afterStep?(step: StepMeta, result: StepResult, ctx: WorkflowContext): Promise<void>;
  /** Step-level cache. When provided, successful results are stored and replayed on re-run. */
  cache?: import("./cache.js").StepCache;
  /** Optional observer for real-time execution events. */
  observer?: RunObserver;
}

// ---------------------------------------------------------------------------
// Execution observer protocol
// ---------------------------------------------------------------------------

/**
 * A discrete, serializable event emitted at each lifecycle point of a workflow run.
 *
 * Events are JSON-serializable so they can be forwarded over WebSocket, SSE,
 * or any other transport without transformation.
 */
export type ExecutionEvent =
  | {
      type: "workflow:start";
      workflowId: string;
      workflowName: string;
      timestamp: number;
    }
  | {
      type: "step:enter";
      stepId: string;
      phase: WorkflowPhase;
      timestamp: number;
    }
  | {
      type: "step:exit";
      stepId: string;
      phase: WorkflowPhase;
      result: StepResult;
      /** True when replayed from cache, not freshly executed. */
      cached: boolean;
      timestamp: number;
    }
  | {
      type: "workflow:end";
      status: WorkflowResult["status"];
      duration: number;
      timestamp: number;
    };

/**
 * Observer that receives ExecutionEvents in real-time during a workflow run.
 *
 * Implementations:
 *  - In-memory (for local simulation and testing)
 *  - WebSocket (broadcast to connected studio clients)
 *  - SSE (stream to browser over HTTP)
 *
 * The runner awaits each onEvent call. Keep implementations fast; defer heavy
 * work (e.g. DB writes) asynchronously so they don't block the runner.
 *
 * Errors thrown by onEvent are caught and logged — they do NOT abort the workflow.
 */
export interface RunObserver {
  onEvent(event: ExecutionEvent): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Workflow Spec v2 — steps{} map, pure serializable definition
// ---------------------------------------------------------------------------

/**
 * A pure-data workflow definition. Fully serializable — no functions.
 * Can be stored in JSON, versioned, and rendered as a visual graph.
 * Implementations are injected separately via createWorkflow().
 */
export interface WorkflowDefinition {
  /** Unique machine-readable identifier (for persistence and import/export). */
  id: string;
  /** Semver string, e.g. "1.0.0". Increment when the shape changes. */
  version: string;
  /** Human-readable name used in logs. */
  name: string;
  /** Optional description of what this workflow does. */
  description?: string;
  /** Id of the first step to execute. Must be a key in `steps`. */
  initial: string;
  /**
   * All steps keyed by their unique id.
   * Order is irrelevant — all routing is explicit via `on` and `next`.
   */
  steps: Record<string, StepDefinition>;
}

export interface StepDefinition {
  /** Phase for swimlane grouping and failure semantics. */
  phase: WorkflowPhase;
  /** Human-readable description (shown in visual editor, not executed). */
  description?: string;
  /**
   * If true, any failure immediately aborts the entire workflow (status: "failed").
   * Use for steps whose output is required by everything downstream.
   */
  critical?: boolean;
  /**
   * Explicit default successor step (for linear chains).
   * Used when no `on` key matches the resolved outcome.
   * Shorthand for `on: { success: "...", skipped: "..." }`.
   */
  next?: string;
  /**
   * Outcome-based transition map.
   *
   * Key resolution order:
   *   1. result.data?.outcome (string)  — explicit outcome set by implementation
   *   2. result.status                  — "success" | "skipped" | "failed"
   *   3. "*"                            — wildcard default
   *
   * After `on` is exhausted, falls back to `next` (success/skipped only).
   *
   * Reserved target value: "end" — stops the workflow successfully.
   */
  on?: Record<string, string>;
  /**
   * Provider roles this step depends on (e.g. ["observability", "sourceControl"]).
   * Used by the engine for pre-flight config validation.
   * Each role is looked up in the ProviderRegistry; if the provider has a configSchema,
   * all required fields are validated before the workflow starts.
   *
   * Pure metadata — no runtime routing effect.
   */
  uses?: string[];
}

/**
 * Implementation functions keyed by step id.
 * Every step id in WorkflowDefinition.steps must have an entry here.
 */
export type StepImplementations<TConfig> = Record<string, (ctx: WorkflowContext<TConfig>) => Promise<StepResult>>;

/**
 * A complete wired workflow ready to run.
 * Definition is pure data; implementations are the actual async functions.
 */
export interface Workflow<TConfig = unknown> {
  definition: WorkflowDefinition;
  implementations: StepImplementations<TConfig>;
}

/** Validation error describing a structural problem with a WorkflowDefinition. */
export interface WorkflowDefinitionError {
  code:
    | "MISSING_INITIAL" // initial does not exist in steps
    | "UNKNOWN_TARGET" // an on/next target does not exist in steps and isn't "end"
    | "MISSING_IMPLEMENTATION"; // a step id has no implementation (checked by createWorkflow)
  message: string;
  stateId?: string;
  targetId?: string;
}

/**
 * Thrown by runWorkflow() when required provider environment variables are missing.
 * Reports all missing vars at once — never fails on first missing var.
 */
export class WorkflowConfigError extends Error {
  constructor(
    workflowName: string,
    issues: Array<{ stepId: string; providerName: string; missingEnvVars: string[] }>,
  ) {
    const lines = issues.map(
      ({ stepId, providerName, missingEnvVars }) =>
        `  step "${stepId}" (${providerName}): ${missingEnvVars.join(", ")}`,
    );
    super(
      `Missing required configuration for workflow "${workflowName}":\n${lines.join("\n")}\n\nSet the missing environment variables and re-run.`,
    );
    this.name = "WorkflowConfigError";
  }
}

// Re-export ProviderConfigSchema so engine consumers can import it from engine
export type { ProviderConfigSchema };
