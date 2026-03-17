import type { WorkflowDefinition, StepResult } from "@sweny-ai/engine";

/**
 * Build a createWorkflow-compatible impl map that stubs every step as success.
 * Used by the SimulationPanel "Auto-run" mode to visualize execution flow
 * without requiring manual stepping through each step.
 */
export function buildStubImplementations(definition: WorkflowDefinition): Record<string, () => Promise<StepResult>> {
  return Object.fromEntries(
    Object.keys(definition.steps).map((id) => [id, async (): Promise<StepResult> => ({ status: "success" })]),
  );
}
