/**
 * Browser-side workflow builder client.
 *
 * Calls the Vite dev server's AI middleware endpoints, which proxy
 * requests through Claude Code (headless). No API key needed in the
 * browser — auth is handled server-side.
 */

import type { Workflow } from "@sweny-ai/core";
import { post } from "./api-client.js";

/**
 * Generate a complete workflow from a natural language description.
 * Calls the local dev server which runs Claude Code server-side.
 */
export async function buildWorkflowBrowser(description: string): Promise<Workflow> {
  const { workflow } = await post<{ workflow: Workflow }>("/api/generate-workflow", { description });
  return workflow;
}

/**
 * Refine an existing workflow based on a natural language instruction.
 * Calls the local dev server which runs Claude Code server-side.
 */
export async function refineWorkflowBrowser(workflow: Workflow, instruction: string): Promise<Workflow> {
  const { workflow: refined } = await post<{ workflow: Workflow }>("/api/refine-workflow", {
    workflow,
    instruction,
  });
  return refined;
}
