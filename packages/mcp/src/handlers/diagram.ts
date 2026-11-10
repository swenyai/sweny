import { loadAndValidateWorkflow, toMermaid, toMermaidBlock, type Workflow } from "@sweny-ai/core";
import { implementWorkflow, seedContentWorkflow, triageWorkflow } from "@sweny-ai/core/workflows";
import { cleanErrors } from "./validate.js";
import { confineWorkflowFile, oneLine, sanitizeLines } from "./workspace.js";
import { fail, type ToolOutput } from "./result.js";

export interface DiagramInput {
  /** A built-in name (triage, implement, seed-content) or a workflow file inside the workspace root. */
  file: string;
  direction?: "TB" | "LR";
  title?: string;
  /** Wrap the diagram in a ```mermaid fence. */
  block?: boolean;
  root: string;
}

const BUILTINS: Record<string, Workflow> = {
  triage: triageWorkflow,
  implement: implementWorkflow,
  "seed-content": seedContentWorkflow,
};

/**
 * `sweny workflow diagram` over MCP: the same Mermaid renderer, with the
 * diagram returned instead of written (this tool never writes a file).
 */
export function diagramWorkflow(input: DiagramInput): ToolOutput {
  let workflow: Workflow;
  if (Object.hasOwn(BUILTINS, input.file)) {
    workflow = BUILTINS[input.file];
  } else {
    const confined = confineWorkflowFile(input.root, input.file);
    if (!confined.ok) return fail(confined.error);
    const loaded = loadAndValidateWorkflow(confined.file);
    if (!loaded.ok) {
      const errors = cleanErrors(loaded.errors);
      return fail(
        `${oneLine(input.file, 120)} does not validate, so it cannot be drawn: ${errors.map((e) => e.message).join("; ")}`,
        { errors },
      );
    }
    workflow = loaded.workflow;
  }

  const direction = input.direction === "LR" ? "LR" : "TB";
  const opts: { direction: "TB" | "LR"; title?: string } = { direction };
  if (input.title) opts.title = input.title;
  // Node names and edge conditions come from a workspace file: strip terminal escapes, keep the layout.
  const mermaid = sanitizeLines((input.block ? toMermaidBlock : toMermaid)(workflow, opts));

  const nodes = Object.keys(workflow.nodes).length;
  const edges = workflow.edges.length;
  const id = oneLine(workflow.id, 64);
  return {
    isError: false,
    summary: `Mermaid diagram of ${id} (${direction}): ${nodes} nodes, ${edges} edges`,
    data: { workflow: { id, name: oneLine(workflow.name, 120) }, direction, nodes, edges, mermaid },
  };
}
