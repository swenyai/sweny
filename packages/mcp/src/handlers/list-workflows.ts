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
  /**
   * Whether this workflow can be executed via sweny_run_workflow. triage and
   * implement run through their dedicated CLI subcommands; custom workflows run
   * through `sweny workflow run <file>`. seed-content is a built-in with no CLI
   * file or run path, so it is listed but not runnable.
   */
  runnable: boolean;
}

function toInfo(
  w: { id: string; name: string; description: string; nodes: Record<string, unknown> },
  source: "builtin" | "custom",
  runnable: boolean,
): WorkflowInfo {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    nodeCount: Object.keys(w.nodes).length,
    source,
    runnable,
  };
}

/** Built-in workflow ids that run via dedicated CLI subcommands (triage/implement). */
export const RUNNABLE_BUILTIN_IDS = new Set([triageWorkflow.id, implementWorkflow.id]);

export async function listWorkflows(cwd: string): Promise<WorkflowInfo[]> {
  const results: WorkflowInfo[] = [
    toInfo(triageWorkflow, "builtin", true),
    toInfo(implementWorkflow, "builtin", true),
    // seed-content has no `sweny <name>` subcommand and no file on disk, so the
    // MCP cannot dispatch it. Listed for visibility, flagged not-runnable.
    toInfo(seedContentWorkflow, "builtin", false),
  ];

  // Scan .sweny/workflows/*.yml for custom workflows. Each is runnable via the
  // file-run path (`sweny workflow run <file>`).
  const workflowDir = path.join(cwd, ".sweny", "workflows");
  try {
    const entries = await fs.promises.readdir(workflowDir);
    for (const entry of entries) {
      if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
      try {
        const content = await fs.promises.readFile(path.join(workflowDir, entry), "utf-8");
        const raw = parseYaml(content);
        const workflow = parseWorkflow(raw);
        results.push(toInfo(workflow, "custom", true));
      } catch {
        // Skip invalid workflow files
      }
    }
  } catch {
    // No .sweny/workflows/ directory — that's fine
  }

  return results;
}

/**
 * Resolve a custom workflow id to its absolute file path under
 * `.sweny/workflows/`, or null if no parseable workflow with that id exists.
 *
 * Resolution is by parsed workflow `id` (not file name) because the list tool
 * advertises the YAML `id`, which may differ from the file name. The returned
 * path is always inside `cwd/.sweny/workflows/`, which keeps the run-workflow
 * spawn surface constrained to that directory rather than arbitrary paths.
 */
export async function resolveCustomWorkflowFile(cwd: string, id: string): Promise<string | null> {
  const workflowDir = path.resolve(cwd, ".sweny", "workflows");
  let entries: string[];
  try {
    entries = await fs.promises.readdir(workflowDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) continue;
    const filePath = path.join(workflowDir, entry);
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      const workflow = parseWorkflow(parseYaml(content));
      if (workflow.id === id) {
        // Defense-in-depth: confirm the resolved path is inside the workflow dir.
        const resolved = path.resolve(filePath);
        if (resolved === path.join(workflowDir, entry) && resolved.startsWith(workflowDir + path.sep)) {
          return resolved;
        }
      }
    } catch {
      // Skip invalid / unparseable files
    }
  }
  return null;
}
