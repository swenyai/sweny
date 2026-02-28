# Create @sweny/engine Package

## Context
SWEny is transitioning from a triage-specific tool to a generic **Learn → Act → Report** platform. The engine package provides the workflow abstraction that sits between `@sweny/providers` (external service interfaces) and entry points (`@sweny/action`, `@sweny/agent`, cloud worker).

Currently `@sweny/action` hardcodes the three-phase triage flow. The engine extracts this into a generic workflow runner that any "recipe" (triage, security audit, dependency update, etc.) can use.

```
@sweny/providers  (interfaces + implementations)
       ↑
@sweny/engine     (workflow types + runner)  ← THIS TASK
       ↑
@sweny/action     (GitHub Action entry, triage recipe)
@sweny/agent      (Slack/CLI entry, interactive)
cloud/worker      (hosted entry)
```

## Files to Create

### `packages/engine/package.json`
- Name: `@sweny/engine`
- Version: `0.1.0`
- Type: `module`
- Dependency on `@sweny/providers` (workspace)
- Exports: `"."` → `./dist/index.js` (types + runner)
- Dev deps: `vitest`, `typescript`
- Scripts: `build`, `test`, `typecheck`

### `packages/engine/tsconfig.json`
Follow the same pattern as other packages (extends root, composite, etc.)

### `packages/engine/src/types.ts`
Core workflow abstractions:

```typescript
import type { Logger } from "@sweny/providers";

/** The three phases of every workflow. */
export type WorkflowPhase = "learn" | "act" | "report";

/** Result of executing a single step. */
export interface StepResult {
  status: "success" | "skipped" | "failed";
  /** Arbitrary output data — downstream steps read this via context.results */
  data?: Record<string, unknown>;
  /** Human-readable reason (especially for skipped/failed). */
  reason?: string;
}

/** A single step in a workflow. */
export interface WorkflowStep<TConfig = unknown> {
  /** Unique name within the workflow (used as key in context.results). */
  name: string;
  /** Which phase this step belongs to. */
  phase: WorkflowPhase;
  /** Execute the step. Return result. Throw to fail. */
  run(ctx: WorkflowContext<TConfig>): Promise<StepResult>;
}

/** Mutable context threaded through all steps in a run. */
export interface WorkflowContext<TConfig = unknown> {
  /** Recipe-specific configuration. */
  config: TConfig;
  /** Logger for structured output. */
  logger: Logger;
  /** Accumulated results from completed steps, keyed by step name. */
  results: Map<string, StepResult>;
  /** Bag of instantiated providers keyed by role (e.g., "observability", "issueTracker"). */
  providers: ProviderRegistry;
  /** Signal to short-circuit remaining steps in a phase. */
  skipPhase(phase: WorkflowPhase, reason: string): void;
  /** Check if a phase has been skipped. */
  isPhaseSkipped(phase: WorkflowPhase): boolean;
}

/** Type-safe provider bag. */
export interface ProviderRegistry {
  get<T>(key: string): T;
  has(key: string): boolean;
  set(key: string, provider: unknown): void;
}

/** A complete workflow definition — an ordered list of steps grouped by phase. */
export interface Workflow<TConfig = unknown> {
  name: string;
  description?: string;
  steps: WorkflowStep<TConfig>[];
}

/** Overall result of running a workflow. */
export interface WorkflowResult {
  status: "completed" | "failed" | "partial";
  steps: Array<{ name: string; phase: WorkflowPhase; result: StepResult }>;
  /** Total wall-clock ms. */
  duration: number;
}

/** Options for the workflow runner. */
export interface RunOptions {
  /** Logger instance. */
  logger?: Logger;
  /** Called before each step. Return false to skip. */
  beforeStep?(step: WorkflowStep, ctx: WorkflowContext): Promise<boolean | void>;
  /** Called after each step. */
  afterStep?(step: WorkflowStep, result: StepResult, ctx: WorkflowContext): Promise<void>;
}
```

### `packages/engine/src/registry.ts`
Simple ProviderRegistry implementation (a typed Map wrapper).

### `packages/engine/src/runner.ts`
The workflow runner:

```typescript
export async function runWorkflow<TConfig>(
  workflow: Workflow<TConfig>,
  config: TConfig,
  providers: ProviderRegistry,
  options?: RunOptions,
): Promise<WorkflowResult>;
```

Logic:
1. Create `WorkflowContext` with config, providers, empty results map
2. Group steps by phase, execute in order: learn → act → report
3. For each step:
   - Check `isPhaseSkipped()` — if so, record as skipped
   - Call `beforeStep` hook if provided
   - Execute `step.run(ctx)`
   - Store result in `ctx.results`
   - Call `afterStep` hook
   - If step throws, catch and record as failed
4. Determine overall status:
   - `completed` if no failures
   - `failed` if a learn step fails (can't proceed without data)
   - `partial` if act/report steps fail but learn succeeded
5. Return `WorkflowResult` with timing

### `packages/engine/src/index.ts`
Barrel export: all types + `runWorkflow` + `createProviderRegistry`

### `packages/engine/tests/runner.test.ts`
Tests:
- Runs steps in phase order (learn before act before report)
- Passes results between steps via context
- Handles step failure (records as failed, determines overall status)
- Respects `skipPhase` (skips remaining steps in a phase)
- Calls beforeStep/afterStep hooks
- Provider registry get/set/has works

## Update Root

### `packages/engine` added to `sweny/package.json` workspaces
The root `package.json` workspaces array should include `packages/engine` (it already uses `packages/*` glob so this may already work — verify).

## Verification
- `npm run build --workspace=packages/engine` passes
- `npm run test --workspace=packages/engine` passes
- `npm run typecheck --workspace=packages/engine` passes
- No changes to any existing package (purely additive)
