import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { triageWorkflow, implementWorkflow, seedContentWorkflow } from "@sweny-ai/core/workflows";
import { parseWorkflow } from "@sweny-ai/core/schema";

export interface WorkflowInfo {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  source: "builtin" | "custom";
}

function toInfo(
  w: { id: string; name: string; description: string; nodes: Record<string, unknown> },
  source: "builtin" | "custom",
): WorkflowInfo {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    nodeCount: Object.keys(w.nodes).length,
    source,
  };
}

export async function listWorkflows(cwd: string): Promise<WorkflowInfo[]> {
  const results: WorkflowInfo[] = [
    toInfo(triageWorkflow, "builtin"),
    toInfo(implementWorkflow, "builtin"),
    toInfo(seedContentWorkflow, "builtin"),
  ];

  // Scan .sweny/workflows/*.yml for custom workflows
  const workflowDir = path.join(cwd, ".sweny", "workflows");
  try {
    const entries = await fs.promises.readdir(workflowDir);
    for (const entry of entries) {
      if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
      try {
        const content = await fs.promises.readFile(path.join(workflowDir, entry), "utf-8");
        const raw = parseYaml(content);
        const workflow = parseWorkflow(raw);
        results.push(toInfo(workflow, "custom"));
      } catch {
        // Skip invalid workflow files
      }
    }
  } catch {
    // No .sweny/workflows/ directory — that's fine
  }

  return results;
}
