/**
 * Browser-side instruction generation client.
 *
 * Calls the Vite dev server's AI middleware, which proxies through
 * Claude Code. No API key needed in the browser.
 */

import { post } from "./api-client.js";

export interface GenerateInstructionOptions {
  nodeName: string;
  nodeId: string;
  skills: string[];
  existingInstruction: string;
  workflowContext: {
    workflowName: string;
    workflowDescription: string;
    nodeNames: string[];
  };
}

export async function generateInstruction(opts: GenerateInstructionOptions): Promise<string> {
  const { instruction } = await post<{ instruction: string }>("/api/generate-instruction", opts);
  return instruction;
}
