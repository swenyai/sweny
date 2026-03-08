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
  const visitedInRun: string[] = [];

  while (currentId && currentId !== "end") {
    const node = nodeMap.get(currentId);
    if (!node) {
      logger.error(`[${dag.name}] Unknown node id: "${currentId}" — stopping`);
      aborted = true;
      break;
    }

    if (visitedInRun.includes(currentId)) {
      logger.error(`[${dag.name}] Cycle detected at node "${currentId}" — stopping`);
      aborted = true;
      break;
    }
    visitedInRun.push(currentId);

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
function resolveNext<TConfig>(node: RecipeStep<TConfig>, result: StepResult, nodeOrder: string[]): string | undefined {
  // Determine outcome key (explicit outcome first, then status)
  const outcome = typeof result.data?.outcome === "string" ? result.data.outcome : result.status;

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
