/**
 * Workflow Schema — validation removed, just types
 */

import { z } from "zod";

export const workflowZ = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  nodes: z.record(z.any()),
  edges: z.array(z.any()),
  entry: z.string(),
});

export function parseWorkflow(raw: unknown) {
  return workflowZ.parse(raw);
}

// Removed: validateWorkflow, WorkflowError, all sub-schemas, JSON Schema export
