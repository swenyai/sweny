import { consoleLogger } from "@sweny/providers";
import { createProviderRegistry } from "./registry.js";
import type {
  ProviderRegistry,
  RunOptions,
  StepResult,
  Workflow,
  WorkflowContext,
  WorkflowPhase,
  WorkflowResult,
} from "./types.js";

/** Phase execution order. */
const PHASE_ORDER: WorkflowPhase[] = ["learn", "act", "report"];

/**
 * Run a workflow end-to-end: learn → act → report.
 *
 * Steps execute in array order within their phase.
 * If a learn step fails, the workflow is aborted (status: "failed").
 * If an act or report step fails, remaining steps continue (status: "partial").
 */
export async function runWorkflow<TConfig>(
  workflow: Workflow<TConfig>,
  config: TConfig,
  providers: ProviderRegistry,
  options?: RunOptions,
): Promise<WorkflowResult> {
  const logger = options?.logger ?? consoleLogger;
  const start = Date.now();

  const skippedPhases = new Map<WorkflowPhase, string>();
  const results = new Map<string, StepResult>();
  const completedSteps: WorkflowResult["steps"] = [];

  const ctx: WorkflowContext<TConfig> = {
    config,
    logger,
    results,
    providers,
    skipPhase(phase: WorkflowPhase, reason: string) {
      skippedPhases.set(phase, reason);
    },
    isPhaseSkipped(phase: WorkflowPhase): boolean {
      return skippedPhases.has(phase);
    },
  };

  // Group steps by phase
  const stepsByPhase = new Map<WorkflowPhase, Workflow<TConfig>["steps"]>();
  for (const phase of PHASE_ORDER) {
    stepsByPhase.set(
      phase,
      workflow.steps.filter((s) => s.phase === phase),
    );
  }

  let hasFailed = false;
  let failedInLearn = false;

  for (const phase of PHASE_ORDER) {
    // If a learn step failed, abort entirely
    if (failedInLearn) break;

    const steps = stepsByPhase.get(phase) ?? [];

    for (const step of steps) {
      // Check if this phase was skipped
      if (skippedPhases.has(phase)) {
        const result: StepResult = {
          status: "skipped",
          reason: skippedPhases.get(phase),
        };
        results.set(step.name, result);
        completedSteps.push({ name: step.name, phase, result });
        continue;
      }

      // beforeStep hook — return false to skip
      if (options?.beforeStep) {
        const proceed = await options.beforeStep(step, ctx);
        if (proceed === false) {
          const result: StepResult = { status: "skipped", reason: "Skipped by beforeStep hook" };
          results.set(step.name, result);
          completedSteps.push({ name: step.name, phase, result });
          continue;
        }
      }

      let result: StepResult;
      try {
        logger.info(`[${workflow.name}] ${phase}/${step.name}: starting`);
        result = await step.run(ctx);
        logger.info(`[${workflow.name}] ${phase}/${step.name}: ${result.status}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[${workflow.name}] ${phase}/${step.name}: failed — ${message}`);
        result = { status: "failed", reason: message };
        hasFailed = true;

        if (phase === "learn") {
          failedInLearn = true;
        }
      }

      results.set(step.name, result);
      completedSteps.push({ name: step.name, phase, result });

      // afterStep hook
      if (options?.afterStep) {
        await options.afterStep(step, result, ctx);
      }

      // Abort remaining steps if learn phase failed
      if (failedInLearn) break;
    }
  }

  const status = failedInLearn ? "failed" : hasFailed ? "partial" : "completed";

  return {
    status,
    steps: completedSteps,
    duration: Date.now() - start,
  };
}

/** Re-export for convenience. */
export { createProviderRegistry };
