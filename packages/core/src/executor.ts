/**
 * DAG Workflow Executor — simplified
 */

import type { Workflow, Skill, Tool, Claude, Observer, NodeResult, Logger, ToolContext } from "./types.js";
import { consoleLogger } from "./types.js";

export interface ExecuteOptions {
  skills: Map<string, Skill>;
  config?: Record<string, string>;
  claude: Claude;
  observer?: Observer;
  logger?: Logger;
}

export async function execute(
  workflow: Workflow,
  input: unknown,
  options: ExecuteOptions,
): Promise<Map<string, NodeResult>> {
  const { skills, claude, observer } = options;
  const config = options.config ?? {};
  const results = new Map<string, NodeResult>();

  let currentId: string | null = workflow.entry;

  while (currentId) {
    const node = workflow.nodes[currentId];

    const tools = node.skills
      .map((id) => skills.get(id))
      .filter(Boolean)
      .flatMap((s: any) => s.tools);

    const context: Record<string, unknown> = { input };

    const result = await claude.run({
      instruction: node.instruction,
      context,
      tools,
      outputSchema: node.output,
    });

    results.set(currentId, result);

    // Just follow first edge
    const edge = workflow.edges.find((e) => e.from === currentId);
    currentId = edge ? edge.to : null;
  }

  return results;
}
