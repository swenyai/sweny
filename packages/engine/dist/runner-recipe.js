import { consoleLogger } from "@sweny-ai/providers";
import { createProviderRegistry } from "./registry.js";
import { validateDefinition } from "./validate.js";
/** Calls observer.onEvent safely — errors are logged, not thrown. */
async function emit(observer, event, logger) {
    if (!observer)
        return;
    try {
        await observer.onEvent(event);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[observer] onEvent threw for "${event.type}": ${msg}`);
    }
}
// Re-export validateDefinition so existing imports from runner-recipe are not broken
export { validateDefinition };
/**
 * Create a Recipe by combining a definition with implementations.
 * Validates the definition and that all state ids have implementations.
 * Throws a descriptive Error if validation fails.
 */
export function createRecipe(definition, implementations) {
    const defErrors = validateDefinition(definition);
    if (defErrors.length > 0) {
        throw new Error(`Invalid recipe definition "${definition.id}":\n` + defErrors.map((e) => `  [${e.code}] ${e.message}`).join("\n"));
    }
    const implErrors = [];
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
        throw new Error(`Missing implementations for recipe "${definition.id}":\n` +
            implErrors.map((e) => `  [${e.code}] ${e.message}`).join("\n"));
    }
    return { definition, implementations };
}
/**
 * Execute a Recipe as a state machine.
 *
 * Starts at recipe.definition.initial, executes each state, then follows
 * on: transitions to determine the next state. Stops when a transition
 * resolves to "end", there is no next state, or a critical state fails.
 *
 * Outcome resolution order (for on: routing):
 *   1. result.data?.outcome (string) — explicit outcome set by the implementation
 *   2. result.status        ("success" | "skipped" | "failed")
 *   3. "*"                  — wildcard default
 *   4. next                 — fallback for success/skipped
 */
export async function runRecipe(recipe, config, providers, options) {
    const logger = options?.logger ?? consoleLogger;
    const start = Date.now();
    const { definition, implementations } = recipe;
    const results = new Map();
    const completedSteps = [];
    const ctx = { config, logger, results, providers };
    await emit(options?.observer, {
        type: "recipe:start",
        recipeId: definition.id,
        recipeName: definition.name,
        timestamp: Date.now(),
    }, logger);
    let currentId = definition.initial;
    let hasFailed = false;
    let aborted = false;
    const visited = new Set();
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
        const meta = { id: stateId, phase: state.phase };
        await emit(options?.observer, {
            type: "state:enter",
            stateId,
            phase: state.phase,
            timestamp: Date.now(),
        }, logger);
        // beforeStep hook — return false to skip this state
        if (options?.beforeStep) {
            const proceed = await options.beforeStep(meta, ctx);
            if (proceed === false) {
                const result = { status: "skipped", reason: "Skipped by beforeStep hook" };
                results.set(stateId, result);
                completedSteps.push({ name: stateId, phase: state.phase, result });
                await emit(options?.observer, {
                    type: "state:exit",
                    stateId,
                    phase: state.phase,
                    result: { status: "skipped", reason: "Skipped by beforeStep hook" },
                    cached: false,
                    timestamp: Date.now(),
                }, logger);
                if (options.afterStep)
                    await options.afterStep(meta, result, ctx);
                currentId = resolveNext(stateId, state, result);
                continue;
            }
        }
        // Cache check — replay a previously cached result if available
        if (options?.cache) {
            const entry = await options.cache.get(stateId);
            if (entry) {
                const result = { ...entry.result, cached: true };
                results.set(stateId, result);
                completedSteps.push({ name: stateId, phase: state.phase, result });
                await emit(options?.observer, {
                    type: "state:exit",
                    stateId,
                    phase: state.phase,
                    result,
                    cached: true,
                    timestamp: Date.now(),
                }, logger);
                if (options.afterStep)
                    await options.afterStep(meta, result, ctx);
                currentId = resolveNext(stateId, state, result);
                continue;
            }
        }
        // Execute the state — result is always assigned (either from run or catch)
        let result;
        try {
            logger.info(`[${definition.name}] ${state.phase}/${stateId}: starting`);
            result = await implementations[stateId](ctx);
            logger.info(`[${definition.name}] ${state.phase}/${stateId}: ${result.status}`);
        }
        catch (err) {
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
        }, logger);
        if (result.status === "failed") {
            hasFailed = true;
            if (state.critical) {
                aborted = true;
                break;
            }
        }
        // Persist successful results to cache
        if (result.status === "success" && options?.cache) {
            await options.cache.set(stateId, { result, createdAt: Date.now() }).catch(() => { }); // cache failures are non-fatal
        }
        if (options?.afterStep)
            await options.afterStep(meta, result, ctx);
        currentId = resolveNext(stateId, state, result);
    }
    const status = aborted ? "failed" : hasFailed ? "partial" : "completed";
    await emit(options?.observer, {
        type: "recipe:end",
        status,
        duration: Date.now() - start,
        timestamp: Date.now(),
    }, logger);
    return { status, steps: completedSteps, duration: Date.now() - start };
}
/**
 * Resolve the id of the next state to execute.
 *
 * Priority:
 *   1. Explicit on: match for result.data?.outcome
 *   2. Explicit on: match for result.status
 *   3. Wildcard on["*"]
 *   4. next (success/skipped only)
 *   5. undefined — stop the recipe
 */
function resolveNext(stateId, state, result) {
    const outcome = typeof result.data?.outcome === "string" ? result.data.outcome : undefined;
    if (state.on) {
        // 1. explicit outcome
        if (outcome && outcome in state.on)
            return state.on[outcome];
        // 2. status
        if (result.status in state.on)
            return state.on[result.status];
        // 3. wildcard
        if ("*" in state.on)
            return state.on["*"];
    }
    // 4. next (only for non-failure)
    if (result.status !== "failed" && state.next)
        return state.next;
    // 5. stop
    return undefined;
}
export { createProviderRegistry };
//# sourceMappingURL=runner-recipe.js.map