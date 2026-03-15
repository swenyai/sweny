import type { WorkflowContext, StepResult, WorkflowDefinition, StepImplementations, Workflow } from "./types.js";
import { createWorkflow } from "./runner-recipe.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStepImpl = (ctx: WorkflowContext<any>) => Promise<StepResult>;

export interface StepType {
  /** Identifier used in YAML, e.g. "sweny/fetch-issue" */
  type: string;
  /** Human-readable description shown in Studio and CLI help */
  description: string;
  /** The implementation */
  impl: AnyStepImpl;
}

/** Global registry of built-in step types */
export const builtinStepRegistry: Map<string, StepType> = new Map();

export function registerStepType(entry: StepType): void {
  builtinStepRegistry.set(entry.type, entry);
}

/**
 * Resolve a WorkflowDefinition into a runnable Workflow by looking up
 * each step's `type` field in the built-in step registry.
 *
 * Steps without a `type` field will throw. For custom implementations,
 * use createWorkflow() directly.
 */
export function resolveWorkflow<TConfig>(definition: WorkflowDefinition): Workflow<TConfig> {
  const implementations: StepImplementations<TConfig> = {};

  for (const [stepId, step] of Object.entries(definition.steps)) {
    if (!step.type) {
      throw new Error(
        `Step "${stepId}" has no type — set step.type to a built-in type (e.g. "sweny/fetch-issue") or use createWorkflow() with custom implementations`,
      );
    }
    const entry = builtinStepRegistry.get(step.type);
    if (!entry) {
      const available = [...builtinStepRegistry.keys()].join(", ");
      throw new Error(
        `Unknown step type "${step.type}" in step "${stepId}". Available types: ${available || "(none registered)"}`,
      );
    }
    implementations[stepId] = entry.impl as (ctx: WorkflowContext<TConfig>) => Promise<StepResult>;
  }

  return createWorkflow(definition, implementations);
}
