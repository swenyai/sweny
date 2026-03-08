import { consoleLogger } from "@sweny-ai/providers";
import { createProviderRegistry } from "./registry.js";
import type { CacheEntry } from "./cache.js";
import type {
  ProviderRegistry,
  RecipeDAG,
  RecipeNode,
  RunOptions,
  StepResult,
  WorkflowContext,
  WorkflowPhase,
  WorkflowResult,
} from "./types.js";

/**
 * Execute a RecipeDAG as a state machine.
 *
 * Starts at dag.start, executes each node, then follows transitions to
 * determine the next node. Stops when a transition resolves to "end",
 * there is no next node, or a critical node fails.
 *
 * Outcome resolution order for transitions:
 *   1. result.data?.outcome (string) — explicit from the node
 *   2. result.status ("success" | "skipped" | "failed")
 */
export async function runDAG<TConfig>(
  dag: RecipeDAG<TConfig>,
  config: TConfig,
  providers: ProviderRegistry,
  options?: RunOptions,
): Promise<WorkflowResult> {
  const logger = options?.logger ?? consoleLogger;
  const start = Date.now();

  const results = new Map<string, StepResult>();
  const completedSteps: WorkflowResult["steps"] = [];

  // Build lookup map
  const nodeMap = new Map<string, RecipeNode<TConfig>>();
  const nodeOrder: string[] = [];
  for (const node of dag.nodes) {
    nodeMap.set(node.id, node);
    nodeOrder.push(node.id);
  }

  // Context (no skipPhase needed — routing is explicit via transitions)
  const ctx: WorkflowContext<TConfig> = {
    config,
    logger,
    results,
    providers,
    skipPhase(_phase: WorkflowPhase, _reason: string) {
      // No-op in DAG mode — use node transitions instead
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

/** Resolve the next node id from transitions or default sequencing. */
function resolveNext<TConfig>(
  node: RecipeNode<TConfig>,
  result: StepResult,
  nodeOrder: string[],
): string | undefined {
  // Determine outcome key (explicit outcome first, then status)
  const outcome =
    typeof result.data?.outcome === "string" ? result.data.outcome : result.status;

  // Check explicit transitions
  if (node.transitions) {
    if (outcome in node.transitions) return node.transitions[outcome] || undefined;
    // Fall back to status if outcome didn't match
    if (result.status in node.transitions) return node.transitions[result.status] || undefined;
  }

  // Default: next node in declaration order (for success/skipped), stop for failed
  if (result.status === "failed") return undefined;

  const idx = nodeOrder.indexOf(node.id);
  return idx >= 0 && idx + 1 < nodeOrder.length ? nodeOrder[idx + 1] : undefined;
}

export { createProviderRegistry };
