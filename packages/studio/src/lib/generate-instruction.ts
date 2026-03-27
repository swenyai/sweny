/**
 * Browser-side instruction generation client.
 *
 * Calls the Vite dev server's AI middleware, which proxies through
 * Claude Code. No API key needed in the browser.
 */

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
  const res = await fetch("/api/generate-instruction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? `Server error ${res.status}`);
  }

  return data.instruction;
}
