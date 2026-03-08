# Task: DAG Runner — RecipeStep + runRecipe state machine

## Goal
Add a `Recipe` type and `runRecipe()` state machine executor to the engine.
This is the foundation for composable recipes. Keep `runWorkflow()` working.

## Why
The current runner executes steps in a fixed array order. Conditional routing
(e.g. novelty-gate deciding to skip to notify vs proceed to create-issue) is
implemented as a `ctx.skipPhase()` side effect hack. We want explicit on:
```
novelty-gate → { skip: "notify", "+1": "notify", implement: "create-issue" }
```

## Files to change

### 1. `packages/engine/src/types.ts` — add to bottom of file

```typescript
// ---------------------------------------------------------------------------
// DAG types — composable recipe nodes with explicit on
// ---------------------------------------------------------------------------

/**
 * A single node in a recipe DAG.
 * Nodes are atomic, reusable units that run and return a StepResult.
 * Routing to the next node is determined by the outcome (see on).
 */
export interface RecipeStep<TConfig = unknown> {
  /** Unique id within the DAG (used as key in results map and transition targets). */
  id: string;
  /** Phase for logging and failure semantics (learn failure = abort). */
  phase: WorkflowPhase;
  /** Execute the node. Throw to fail. */
  run: (ctx: WorkflowContext<TConfig>) => Promise<StepResult>;
  /**
   * Outcome → next node id.
   *
   * Outcome is resolved in order:
   *   1. result.data?.outcome (string) — explicit outcome returned by the node
   *   2. result.status ("success" | "skipped" | "failed")
   *
   * Special target id "end" stops the DAG.
   * If the outcome has no matching transition, the runner continues to the
   * next node in declaration order (for "success") or stops (for "failed").
   */
  on?: Record<string, string>;
  /**
   * If true, a failure aborts the entire DAG immediately (same semantics as
   * learn phase in the sequential runner). Default: false.
   */
  critical?: boolean;
}

/** A complete recipe as a directed acyclic graph of nodes. */
export interface Recipe<TConfig = unknown> {
  name: string;
  description?: string;
  /** Id of the first node to execute. */
  start: string;
  /** All nodes in declaration order. Used for default sequencing when no transition matches. */
  nodes: RecipeStep<TConfig>[];
}
```

### 2. Create `packages/engine/src/runner-recipe.ts` (new file)

```typescript
import { consoleLogger } from "@sweny-ai/providers";
import { createProviderRegistry } from "./registry.js";
import type { CacheEntry } from "./cache.js";
import type {
  ProviderRegistry,
  Recipe,
  RecipeStep,
  RunOptions,
  StepResult,
  WorkflowContext,
  WorkflowPhase,
  WorkflowResult,
} from "./types.js";

/**
 * Execute a Recipe as a state machine.
 *
 * Starts at dag.start, executes each node, then follows on to
 * determine the next node. Stops when a transition resolves to "end",
 * there is no next node, or a critical node fails.
 *
 * Outcome resolution order for on:
 *   1. result.data?.outcome (string) — explicit from the node
 *   2. result.status ("success" | "skipped" | "failed")
 */
export async function runRecipe<TConfig>(
  dag: Recipe<TConfig>,
  config: TConfig,
  providers: ProviderRegistry,
  options?: RunOptions,
): Promise<WorkflowResult> {
  const logger = options?.logger ?? consoleLogger;
  const start = Date.now();

  const results = new Map<string, StepResult>();
  const completedSteps: WorkflowResult["steps"] = [];

  // Build lookup map
  const nodeMap = new Map<string, RecipeStep<TConfig>>();
  const nodeOrder: string[] = [];
  for (const node of dag.nodes) {
    nodeMap.set(node.id, node);
    nodeOrder.push(node.id);
  }

  // Context (no skipPhase needed — routing is explicit via on)
  const ctx: WorkflowContext<TConfig> = {
    config,
    logger,
    results,
    providers,
    skipPhase(_phase: WorkflowPhase, _reason: string) {
      // No-op in DAG mode — use node on instead
    },
    isPhaseSkipped(_phase: WorkflowPhase): boolean {
      return false;
    },
  };

  let currentId: string | undefined = dag.start;
  let hasFailed = false;
  let aborted = false;

  while (currentId && currentId !== "end") {
    const node = nodeMap.get(currentId);
    if (!node) {
      logger.error(`[${dag.name}] Unknown node id: "${currentId}" — stopping`);
      aborted = true;
      break;
    }

    // beforeStep hook
    if (options?.beforeStep) {
      const stepShim = { name: node.id, phase: node.phase, run: node.run };
      const proceed = await options.beforeStep(stepShim, ctx);
      if (proceed === false) {
        const result: StepResult = { status: "skipped", reason: "Skipped by beforeStep hook" };
        results.set(node.id, result);
        completedSteps.push({ name: node.id, phase: node.phase, result });
        currentId = resolveNext(node, result, nodeOrder);
        continue;
      }
    }

    // Cache check
    if (options?.cache) {
      const entry = await options.cache.get(node.id);
      if (entry) {
        const result: StepResult = { ...entry.result, cached: true };
        results.set(node.id, result);
        completedSteps.push({ name: node.id, phase: node.phase, result });

        if (options.afterStep) {
          const stepShim = { name: node.id, phase: node.phase, run: node.run };
          await options.afterStep(stepShim, result, ctx);
        }

        currentId = resolveNext(node, result, nodeOrder);
        continue;
      }
    }

    // Execute
    let result: StepResult;
    try {
      logger.info(`[${dag.name}] ${node.phase}/${node.id}: starting`);
      result = await node.run(ctx);
      logger.info(`[${dag.name}] ${node.phase}/${node.id}: ${result.status}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[${dag.name}] ${node.phase}/${node.id}: failed — ${message}`);
      result = { status: "failed", reason: message };
      hasFailed = true;

      if (node.critical) {
        results.set(node.id, result);
        completedSteps.push({ name: node.id, phase: node.phase, result });
        aborted = true;
        break;
      }
    }

    results.set(node.id, result);
    completedSteps.push({ name: node.id, phase: node.phase, result });

    if (result.status === "failed" && node.critical) {
      aborted = true;
      break;
    }

    // Cache successful results
    if (result.status === "success" && options?.cache) {
      await options.cache
        .set(node.id, { result, skippedPhases: [], createdAt: Date.now() } satisfies CacheEntry)
        .catch(() => {});
    }

    // afterStep hook
    if (options?.afterStep) {
      const stepShim = { name: node.id, phase: node.phase, run: node.run };
      await options.afterStep(stepShim, result, ctx);
    }

    currentId = resolveNext(node, result, nodeOrder);
  }

  const status = aborted ? "failed" : hasFailed ? "partial" : "completed";
  return { status, steps: completedSteps, duration: Date.now() - start };
}

/** Resolve the next node id from on or default sequencing. */
function resolveNext<TConfig>(
  node: RecipeStep<TConfig>,
  result: StepResult,
  nodeOrder: string[],
): string | undefined {
  // Determine outcome key (explicit outcome first, then status)
  const outcome =
    typeof result.data?.outcome === "string" ? result.data.outcome : result.status;

  // Check explicit on
  if (node.on) {
    if (outcome in node.on) return node.on[outcome] || undefined;
    // Fall back to status if outcome didn't match
    if (result.status in node.on) return node.on[result.status] || undefined;
  }

  // Default: next node in declaration order (for success/skipped), stop for failed
  if (result.status === "failed") return undefined;

  const idx = nodeOrder.indexOf(node.id);
  return idx >= 0 && idx + 1 < nodeOrder.length ? nodeOrder[idx + 1] : undefined;
}

export { createProviderRegistry };
```

### 3. `packages/engine/src/index.ts` — add exports

Add these exports alongside the existing ones:
```typescript
export { runRecipe } from "./runner-recipe.js";
export type { Recipe, RecipeStep } from "./types.js";
```

## Verification

```bash
cd packages/engine
npm run build        # must compile with 0 errors
npm run typecheck    # must pass
npx vitest run       # existing tests must still pass (runWorkflow unchanged)
```

## Notes
- Do NOT remove or modify `runWorkflow()` or the sequential runner — it is still used.
- The `skipPhase` in the DAG context is a no-op stub — callers of `runRecipe` use on.
- `WorkflowContext` is shared between both runners — no changes to that interface needed.
- Commit message: `feat(engine): add Recipe types and runRecipe state machine runner`
