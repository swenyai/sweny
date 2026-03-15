/**
 * Browser-safe runner utilities.
 *
 * Mirrors runner-recipe.ts but avoids importing @sweny-ai/providers
 * (which pulls in Node.js-only code). Uses a console-based logger instead.
 *
 * This module is only used by the browser entry point (browser.ts).
 */
import { validateWorkflow } from "./validate.js";
import { createProviderRegistry } from "./registry.js";
export { createProviderRegistry };
// Minimal console-based logger — avoids importing @sweny-ai/providers
/* eslint-disable no-console */
const browserLogger = {
    info: (msg, ...args) => console.log(msg, ...args),
    debug: (msg, ...args) => console.debug(msg, ...args),
    warn: (msg, ...args) => console.warn(msg, ...args),
    error: (msg, ...args) => console.error(msg, ...args),
};
/* eslint-enable no-console */
/** Calls observer.onEvent safely — errors are logged, not thrown. */
async function emit(observer, event) {
    if (!observer)
        return;
    try {
        await observer.onEvent(event);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        browserLogger.warn(`[observer] onEvent threw for "${event.type}": ${msg}`);
    }
}
/**
 * Create a Workflow by combining a definition with implementations.
 * Validates the definition and that all step ids have implementations.
 * Throws a descriptive Error if validation fails.
 */
export function createWorkflow(definition, implementations) {
    const defErrors = validateWorkflow(definition);
    if (defErrors.length > 0) {
        throw new Error(`Invalid workflow definition "${definition.id}":\n` +
            defErrors.map((e) => `  [${e.code}] ${e.message}`).join("\n"));
    }
    const implErrors = [];
    for (const stepId of Object.keys(definition.steps)) {
        if (!implementations[stepId]) {
            implErrors.push({
                code: "MISSING_IMPLEMENTATION",
                message: `step "${stepId}" has no implementation`,
                stateId: stepId,
            });
        }
    }
    if (implErrors.length > 0) {
        throw new Error(`Missing implementations for workflow "${definition.id}":\n` +
            implErrors.map((e) => `  [${e.code}] ${e.message}`).join("\n"));
    }
    return { definition, implementations };
}
/**
 * Execute a Workflow as a state machine (browser-safe version).
 *
 * Starts at workflow.definition.initial, executes each step, then follows
 * on: transitions to determine the next step. Stops when a transition
 * resolves to "end", there is no next step, or a critical step fails.
 *
 * Outcome resolution order (for on: routing):
 *   1. result.data?.outcome (string) — explicit outcome set by the implementation
 *   2. result.status        ("success" | "skipped" | "failed")
 *   3. "*"                  — wildcard default
 *   4. next                 — fallback for success/skipped
 */
export async function runWorkflow(workflow, config, providers, options) {
    const logger = options?.logger ?? browserLogger;
    const start = Date.now();
    const { definition, implementations } = workflow;
    const results = new Map();
    const completedSteps = [];
    const ctx = { config, logger, results, providers };
    await emit(options?.observer, {
        type: "workflow:start",
        workflowId: definition.id,
        workflowName: definition.name,
        timestamp: Date.now(),
    });
    let currentId = definition.initial;
    let hasFailed = false;
    let aborted = false;
    const visited = new Set();
    while (currentId && currentId !== "end") {
        const step = definition.steps[currentId];
        if (!step) {
            logger.error(`[${definition.name}] Unknown step id: "${currentId}" — aborting`);
            aborted = true;
            break;
        }
        if (visited.has(currentId)) {
            logger.error(`[${definition.name}] Cycle detected at node "${currentId}" — aborting`);
            aborted = true;
            break;
        }
        visited.add(currentId);
        const stepId = currentId;
        const meta = { id: stepId, phase: step.phase };
        await emit(options?.observer, {
            type: "step:enter",
            stepId,
            phase: step.phase,
            timestamp: Date.now(),
        });
        // beforeStep hook — return false to skip this step
        if (options?.beforeStep) {
            const proceed = await options.beforeStep(meta, ctx);
            if (proceed === false) {
                const result = { status: "skipped", reason: "Skipped by beforeStep hook" };
                results.set(stepId, result);
                completedSteps.push({ name: stepId, phase: step.phase, result });
                await emit(options?.observer, {
                    type: "step:exit",
                    stepId,
                    phase: step.phase,
                    result,
                    cached: false,
                    timestamp: Date.now(),
                });
                if (options.afterStep)
                    await options.afterStep(meta, result, ctx);
                currentId = resolveNext(stepId, step, result);
                continue;
            }
        }
        // Cache check — replay a previously cached result if available
        if (options?.cache) {
            const entry = await options.cache.get(stepId);
            if (entry) {
                const result = { ...entry.result, cached: true };
                results.set(stepId, result);
                completedSteps.push({ name: stepId, phase: step.phase, result });
                await emit(options?.observer, {
                    type: "step:exit",
                    stepId,
                    phase: step.phase,
                    result,
                    cached: true,
                    timestamp: Date.now(),
                });
                if (options.afterStep)
                    await options.afterStep(meta, result, ctx);
                currentId = resolveNext(stepId, step, result);
                continue;
            }
        }
        // Execute the step — result is always assigned (either from run or catch)
        let result;
        try {
            logger.info(`[${definition.name}] ${step.phase}/${stepId}: starting`);
            result = await implementations[stepId](ctx);
            logger.info(`[${definition.name}] ${step.phase}/${stepId}: ${result.status}`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`[${definition.name}] ${step.phase}/${stepId}: failed — ${message}`);
            result = { status: "failed", reason: message };
        }
        results.set(stepId, result);
        completedSteps.push({ name: stepId, phase: step.phase, result });
        await emit(options?.observer, {
            type: "step:exit",
            stepId,
            phase: step.phase,
            result,
            cached: result.cached ?? false,
            timestamp: Date.now(),
        });
        if (result.status === "failed") {
            hasFailed = true;
            if (step.critical) {
                aborted = true;
                break;
            }
        }
        // Persist successful results to cache
        if (result.status === "success" && options?.cache) {
            await options.cache.set(stepId, { result, createdAt: Date.now() }).catch(() => { }); // cache failures are non-fatal
        }
        if (options?.afterStep)
            await options.afterStep(meta, result, ctx);
        currentId = resolveNext(stepId, step, result);
    }
    const status = aborted ? "failed" : hasFailed ? "partial" : "completed";
    await emit(options?.observer, {
        type: "workflow:end",
        status,
        duration: Date.now() - start,
        timestamp: Date.now(),
    });
    return { status, steps: completedSteps, duration: Date.now() - start };
}
/**
 * Resolve the id of the next step to execute.
 *
 * Priority:
 *   1. Explicit on: match for result.data?.outcome
 *   2. Explicit on: match for result.status
 *   3. Wildcard on["*"]
 *   4. next (success/skipped only)
 *   5. undefined — stop the workflow
 */
function resolveNext(stepId, step, result) {
    const outcome = typeof result.data?.outcome === "string" ? result.data.outcome : undefined;
    if (step.on) {
        // 1. explicit outcome
        if (outcome && outcome in step.on)
            return step.on[outcome];
        // 2. status
        if (result.status in step.on)
            return step.on[result.status];
        // 3. wildcard
        if ("*" in step.on)
            return step.on["*"];
    }
    // 4. next (only for non-failure)
    if (result.status !== "failed" && step.next)
        return step.next;
    // 5. stop
    void stepId; // used by callers for logging context
    return undefined;
}
//# sourceMappingURL=browser-runner.js.map