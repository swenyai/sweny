/**
 * Browser-safe runner utilities.
 *
 * Re-implements createProviderRegistry and a minimal runRecipe/createRecipe
 * without importing @sweny-ai/providers (which pulls in Node.js-only code).
 *
 * This module is only used by the browser entry point (browser.ts).
 */

import { validateDefinition } from "./validate.js";
import type {
  DefinitionError,
  ExecutionEvent,
  ProviderRegistry,
  Recipe,
  RecipeDefinition,
  RunObserver,
  RunOptions,
  StateDefinition,
  StateImplementations,
  StepMeta,
  StepResult,
  WorkflowContext,
  WorkflowResult,
} from "./types.js";

// Minimal console-based logger — avoids importing @sweny-ai/providers
/* eslint-disable no-console */
const browserLogger = {
  info: (msg: string, ...args: unknown[]) => console.log(msg, ...args),
  debug: (msg: string, ...args: unknown[]) => console.debug(msg, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(msg, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(msg, ...args),
};
/* eslint-enable no-console */

/** Create an empty provider registry. */
export function createProviderRegistry(): ProviderRegistry {
  const store = new Map<string, unknown>();

  return {
    get<T>(key: string): T {
      if (!store.has(key)) {
        throw new Error(`Provider "${key}" is not registered`);
      }
      return store.get(key) as T;
    },

    has(key: string): boolean {
      return store.has(key);
    },

    set(key: string, provider: unknown): void {
      store.set(key, provider);
    },
  };
}

/** Calls observer.onEvent safely — errors are logged, not thrown. */
async function emit(observer: RunObserver | undefined, event: ExecutionEvent): Promise<void> {
  if (!observer) return;
  try {
    await observer.onEvent(event);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    browserLogger.warn(`[observer] onEvent threw for "${event.type}": ${msg}`);
  }
}

/**
 * Create a Recipe by combining a definition with implementations.
 * Validates the definition and that all state ids have implementations.
 * Throws a descriptive Error if validation fails.
 */
export function createRecipe<TConfig>(
  definition: RecipeDefinition,
  implementations: StateImplementations<TConfig>,
): Recipe<TConfig> {
  const defErrors = validateDefinition(definition);
  if (defErrors.length > 0) {
    throw new Error(
      `Invalid recipe definition "${definition.id}":\n` + defErrors.map((e) => `  [${e.code}] ${e.message}`).join("\n"),
    );
  }

  const implErrors: DefinitionError[] = [];
  for (const stateId of Object.keys(definition.states)) {
    if (!implementations[stateId]) {
      implErrors.push({
        code: "MISSING_IMPLEMENTATION",
        message: `state "${stateId}" has no implementation`,
        stateId,
      });
    }
  }
  if (implErrors.length > 0) {
    throw new Error(
      `Missing implementations for recipe "${definition.id}":\n` +
        implErrors.map((e) => `  [${e.code}] ${e.message}`).join("\n"),
    );
  }

  return { definition, implementations };
}

/**
 * Execute a Recipe as a state machine (browser-safe version).
 *
 * Starts at recipe.definition.initial, executes each state, then follows
 * on: transitions to determine the next state.
 */
export async function runRecipe<TConfig>(
  recipe: Recipe<TConfig>,
  config: TConfig,
  providers: ProviderRegistry,
  options?: RunOptions,
): Promise<WorkflowResult> {
  const logger = options?.logger ?? browserLogger;
  const start = Date.now();
  const { definition, implementations } = recipe;

  const results = new Map<string, StepResult>();
  const completedSteps: WorkflowResult["steps"] = [];

  const ctx: WorkflowContext<TConfig> = { config, logger, results, providers };

  await emit(options?.observer, {
    type: "recipe:start",
    recipeId: definition.id,
    recipeName: definition.name,
    timestamp: Date.now(),
  });

  let currentId: string | undefined = definition.initial;
  let hasFailed = false;
  let aborted = false;
  const visited = new Set<string>();

  while (currentId && currentId !== "end") {
    const state = definition.states[currentId];
    if (!state) {
      logger.error(`[${definition.name}] Unknown state id: "${currentId}" — aborting`);
      aborted = true;
      break;
    }

    if (visited.has(currentId)) {
      logger.error(`[${definition.name}] Cycle detected at node "${currentId}" — aborting`);
      aborted = true;
      break;
    }
    visited.add(currentId);

    const stateId = currentId;
    const meta: StepMeta = { id: stateId, phase: state.phase };

    await emit(options?.observer, {
      type: "state:enter",
      stateId,
      phase: state.phase,
      timestamp: Date.now(),
    });

    // beforeStep hook — return false to skip this state
    if (options?.beforeStep) {
      const proceed = await options.beforeStep(meta, ctx);
      if (proceed === false) {
        const result: StepResult = { status: "skipped", reason: "Skipped by beforeStep hook" };
        results.set(stateId, result);
        completedSteps.push({ name: stateId, phase: state.phase, result });
        await emit(options?.observer, {
          type: "state:exit",
          stateId,
          phase: state.phase,
          result: { status: "skipped", reason: "Skipped by beforeStep hook" },
          cached: false,
          timestamp: Date.now(),
        });
        if (options.afterStep) await options.afterStep(meta, result, ctx);
        currentId = resolveNext(state, result);
        continue;
      }
    }

    // Execute the state
    let result: StepResult;
    try {
      logger.info(`[${definition.name}] ${state.phase}/${stateId}: starting`);
      result = await implementations[stateId](ctx);
      logger.info(`[${definition.name}] ${state.phase}/${stateId}: ${result.status}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[${definition.name}] ${state.phase}/${stateId}: failed — ${message}`);
      result = { status: "failed", reason: message };
    }

    results.set(stateId, result);
    completedSteps.push({ name: stateId, phase: state.phase, result });

    await emit(options?.observer, {
      type: "state:exit",
      stateId,
      phase: state.phase,
      result,
      cached: result.cached ?? false,
      timestamp: Date.now(),
    });

    if (result.status === "failed") {
      hasFailed = true;
      if (state.critical) {
        aborted = true;
        break;
      }
    }

    if (options?.afterStep) await options.afterStep(meta, result, ctx);

    currentId = resolveNext(state, result);
  }

  const status = aborted ? "failed" : hasFailed ? "partial" : "completed";

  await emit(options?.observer, {
    type: "recipe:end",
    status,
    duration: Date.now() - start,
    timestamp: Date.now(),
  });

  return { status, steps: completedSteps, duration: Date.now() - start };
}

/**
 * Resolve the id of the next state to execute.
 */
function resolveNext(state: StateDefinition, result: StepResult): string | undefined {
  const outcome = typeof result.data?.outcome === "string" ? result.data.outcome : undefined;

  if (state.on) {
    if (outcome && outcome in state.on) return state.on[outcome];
    if (result.status in state.on) return state.on[result.status];
    if ("*" in state.on) return state.on["*"];
  }

  if (result.status !== "failed" && state.next) return state.next;

  return undefined;
}
