import type { WorkflowDefinitionError, WorkflowDefinition } from "./types.js";

/**
 * Validate a WorkflowDefinition for structural correctness.
 * Returns an array of errors (empty array = valid).
 * Does NOT check implementations (use createWorkflow for that).
 *
 * Pure function — no Node.js dependencies, safe for browser use.
 */
export function validateWorkflow(def: WorkflowDefinition): WorkflowDefinitionError[] {
  const errors: WorkflowDefinitionError[] = [];
  const stepIds = new Set(Object.keys(def.steps));

  // initial must exist
  if (!stepIds.has(def.initial)) {
    errors.push({
      code: "MISSING_INITIAL",
      message: `initial step "${def.initial}" does not exist in steps`,
    });
  }

  // all on/next targets must be valid step ids or "end"
  for (const [stepId, step] of Object.entries(def.steps)) {
    if (step.next && step.next !== "end" && !stepIds.has(step.next)) {
      errors.push({
        code: "UNKNOWN_TARGET",
        message: `step "${stepId}" next target "${step.next}" does not exist`,
        stateId: stepId,
        targetId: step.next,
      });
    }
    for (const [outcome, target] of Object.entries(step.on ?? {})) {
      if (target !== "end" && !stepIds.has(target)) {
        errors.push({
          code: "UNKNOWN_TARGET",
          message: `step "${stepId}" on["${outcome}"] target "${target}" does not exist`,
          stateId: stepId,
          targetId: target,
        });
      }
    }
  }

  // Reachability check — only run when there are no structural errors, because
  // unknown targets would produce false-positive unreachable reports.
  if (errors.length === 0) {
    const visited = new Set<string>();
    const queue: string[] = [def.initial];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (visited.has(id)) continue;
      visited.add(id);
      const step = def.steps[id];
      if (!step) continue;
      if (step.next && step.next !== "end") queue.push(step.next);
      for (const target of Object.values(step.on ?? {})) {
        if (target !== "end") queue.push(target);
      }
    }
    for (const stepId of Object.keys(def.steps)) {
      if (!visited.has(stepId)) {
        errors.push({
          code: "UNREACHABLE_STEP",
          message: `step "${stepId}" is unreachable from initial step "${def.initial}"`,
          stateId: stepId,
        });
      }
    }
  }

  return errors;
}
