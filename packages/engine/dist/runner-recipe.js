import { consoleLogger } from "@sweny-ai/providers";
import { createProviderRegistry } from "./registry.js";
import { validateWorkflow } from "./validate.js";
import { WorkflowConfigError } from "./types.js";
// Re-export WorkflowConfigError class
export { WorkflowConfigError };
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
// Re-export validateWorkflow so existing imports from runner-recipe are not broken
export { validateWorkflow };
/**
 * Pre-flight validation: check all required provider config for all steps.
 * Collects ALL issues before returning — never fails on first missing var.
 */
function validateWorkflowConfig(definition, providers) {
    const issues = [];
    for (const [stepId, step] of Object.entries(definition.steps)) {
        if (!step.uses)
            continue;
        for (const role of step.uses) {
            if (!providers.has(role))
                continue; // provider not registered → skip (different error path)
            const provider = providers.get(role);
            if (!provider.configSchema)
                continue; // provider has no schema → nothing to validate
            const missing = provider.configSchema.fields
                .filter((f) => f.required !== false && !process.env[f.envVar])
                .map((f) => f.envVar);
            if (missing.length > 0) {
                issues.push({ stepId, providerName: provider.configSchema.name, missingEnvVars: missing });
            }
        }
    }
    return issues;
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
 * Execute a Workflow as a state machine.
 *
 * Starts at workflow.definition.initial, executes each step, then follows
 * on: transitions to determine the next step. Stops when a transition
 * resolves to "end", there is no next step, or a critical step fails.
 *
 * Runs pre-flight config validation before any steps execute.
 * Throws WorkflowConfigError if any required provider env vars are missing.
 *
 * Outcome resolution order (for on: routing):
 *   1. result.data?.outcome (string) — explicit outcome set by the implementation
 *   2. result.status        ("success" | "skipped" | "failed")
 *   3. "*"                  — wildcard default
 *   4. next                 — fallback for success/skipped
 */
export async function runWorkflow(workflow, config, providers, options) {
    const logger = options?.logger ?? consoleLogger;
    const start = Date.now();
    const { definition, implementations } = workflow;
    // Pre-flight: validate all required provider config across all steps
    const preflight = validateWorkflowConfig(definition, providers);
    if (preflight.length > 0) {
        throw new WorkflowConfigError(definition.name, preflight);
    }
    const results = new Map();
    const completedSteps = [];
    const ctx = { config, logger, results, providers };
    await emit(options?.observer, {
        type: "workflow:start",
        workflowId: definition.id,
        workflowName: definition.name,
        timestamp: Date.now(),
    }, logger);
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
        }, logger);
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
                    result: { status: "skipped", reason: "Skipped by beforeStep hook" },
                    cached: false,
                    timestamp: Date.now(),
                }, logger);
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
                }, logger);
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
        }, logger);
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
    }, logger);
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
export { createProviderRegistry };
//# sourceMappingURL=runner-recipe.js.map