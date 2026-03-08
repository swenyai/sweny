import { consoleLogger } from "@sweny-ai/providers";
import { createProviderRegistry } from "./registry.js";
import type {
  ProviderRegistry,
  Recipe,
  RecipeStep,
  RunOptions,
  StepMeta,
  StepResult,
  WorkflowContext,
  WorkflowResult,
} from "./types.js";

/**
 * Execute a Recipe as a state machine.
 *
 * Starts at recipe.start, executes each node, then follows on: transitions to
 * determine the next node. Stops when a transition resolves to "end", there is
 * no next node, or a critical node fails.
 *
 * Outcome resolution order (for on: routing):
 *   1. result.data?.outcome (string) — explicit outcome set by the node
 *   2. result.status        ("success" | "skipped" | "failed")
 */
export async function runRecipe<TConfig>(
  recipe: Recipe<TConfig>,
  config: TConfig,
  providers: ProviderRegistry,
  options?: RunOptions,
): Promise<WorkflowResult> {
  const logger = options?.logger ?? consoleLogger;
  const start = Date.now();

  const results = new Map<string, StepResult>();
  const completedSteps: WorkflowResult["steps"] = [];

  // Build id → node lookup and preserve declaration order for default routing
  const nodeMap = new Map<string, RecipeStep<TConfig>>();
  const nodeOrder: string[] = [];
  for (const node of recipe.nodes) {
    nodeMap.set(node.id, node);
    nodeOrder.push(node.id);
  }

  const ctx: WorkflowContext<TConfig> = { config, logger, results, providers };

  let currentId: string | undefined = recipe.start;
  let hasFailed = false;
  let aborted = false;
  const visited = new Set<string>();

  while (currentId && currentId !== "end") {
    const node = nodeMap.get(currentId);
    if (!node) {
      logger.error(`[${recipe.name}] Unknown node id: "${currentId}" — aborting`);
      aborted = true;
      break;
    }

    if (visited.has(currentId)) {
      logger.error(`[${recipe.name}] Cycle detected at node "${currentId}" — aborting`);
      aborted = true;
      break;
    }
    visited.add(currentId);

    const meta: StepMeta = { id: node.id, phase: node.phase };

    // beforeStep hook — return false to skip this node
    if (options?.beforeStep) {
      const proceed = await options.beforeStep(meta, ctx);
      if (proceed === false) {
        const result: StepResult = { status: "skipped", reason: "Skipped by beforeStep hook" };
        results.set(node.id, result);
        completedSteps.push({ name: node.id, phase: node.phase, result });
        if (options.afterStep) await options.afterStep(meta, result, ctx);
        currentId = resolveNext(node, result, nodeOrder);
        continue;
      }
    }

    // Cache check — replay a previously cached result if available
    if (options?.cache) {
      const entry = await options.cache.get(node.id);
      if (entry) {
        const result: StepResult = { ...entry.result, cached: true };
        results.set(node.id, result);
        completedSteps.push({ name: node.id, phase: node.phase, result });
        if (options.afterStep) await options.afterStep(meta, result, ctx);
        currentId = resolveNext(node, result, nodeOrder);
        continue;
      }
    }

    // Execute the node
    let result: StepResult;
    try {
      logger.info(`[${recipe.name}] ${node.phase}/${node.id}: starting`);
      result = await node.run(ctx);
      logger.info(`[${recipe.name}] ${node.phase}/${node.id}: ${result.status}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[${recipe.name}] ${node.phase}/${node.id}: failed — ${message}`);
      result = { status: "failed", reason: message };
      hasFailed = true;

      if (node.critical) {
        results.set(node.id, result);
        completedSteps.push({ name: node.id, phase: node.phase, result });
        aborted = true;
        break;
      }
    }

    results.set(node.id, result!);
    completedSteps.push({ name: node.id, phase: node.phase, result: result! });

    if (result!.status === "failed" && node.critical) {
      aborted = true;
      break;
    }

    // Persist successful results to cache
    if (result!.status === "success" && options?.cache) {
      await options.cache
        .set(node.id, { result: result!, createdAt: Date.now() })
        .catch(() => {}); // cache failures are non-fatal
    }

    if (options?.afterStep) await options.afterStep(meta, result!, ctx);

    currentId = resolveNext(node, result!, nodeOrder);
  }

  const status = aborted ? "failed" : hasFailed ? "partial" : "completed";
  return { status, steps: completedSteps, duration: Date.now() - start };
}

/**
 * Resolve the id of the next node to execute.
 *
 * Priority:
 *   1. Explicit on: match for result.data?.outcome
 *   2. Explicit on: match for result.status
 *   3. Next node in declaration order (success/skipped only)
 *   4. undefined — stop the recipe
 */
function resolveNext<TConfig>(
  node: RecipeStep<TConfig>,
  result: StepResult,
  nodeOrder: string[],
): string | undefined {
  const outcome =
    typeof result.data?.outcome === "string" ? result.data.outcome : result.status;

  if (node.on) {
    if (outcome in node.on && node.on[outcome]) return node.on[outcome];
    if (result.status in node.on && node.on[result.status]) return node.on[result.status];
  }

  if (result.status === "failed") return undefined;

  const idx = nodeOrder.indexOf(node.id);
  return idx >= 0 && idx + 1 < nodeOrder.length ? nodeOrder[idx + 1] : undefined;
}

export { createProviderRegistry };
