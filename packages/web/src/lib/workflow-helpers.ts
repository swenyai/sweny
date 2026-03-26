/**
 * Pure helper functions for the WorkflowExplorer component.
 *
 * Extracted to a separate module for testability — no React dependency.
 */

import type { Workflow, Skill } from "@sweny-ai/core/browser";

export interface EnvVarEntry {
  key: string;
  description: string;
  required: boolean;
  skillId: string;
  skillName: string;
}

/** All unique skill IDs used across a workflow's nodes, sorted. */
export function usedSkillIds(workflow: Workflow): string[] {
  const seen = new Set<string>();
  for (const node of Object.values(workflow.nodes)) {
    for (const sid of node.skills) seen.add(sid);
  }
  return [...seen].sort();
}

/** Which node IDs use a given skill. */
export function nodesUsingSkill(workflow: Workflow, skillId: string): string[] {
  return Object.entries(workflow.nodes)
    .filter(([, node]) => node.skills.includes(skillId))
    .map(([id]) => id);
}

/** Collect all env vars needed for a workflow's skills, deduped by key. */
export function collectSkillEnvVars(workflow: Workflow, skillMap: Map<string, Skill>): EnvVarEntry[] {
  const seen = new Set<string>();
  const result: EnvVarEntry[] = [];

  for (const sid of usedSkillIds(workflow)) {
    const skill = skillMap.get(sid);
    if (!skill) continue;
    for (const [key, field] of Object.entries(skill.config)) {
      if (!seen.has(key)) {
        seen.add(key);
        result.push({
          key,
          description: field.description,
          required: field.required ?? false,
          skillId: sid,
          skillName: skill.name,
        });
      }
    }
  }
  return result;
}

/** Generate .env template for a workflow's skills. */
export function generateEnvTemplate(workflow: Workflow, skillMap: Map<string, Skill>): string {
  const envVars = collectSkillEnvVars(workflow, skillMap);
  if (envVars.length === 0) return "# No environment variables required.";

  const bySkill: Record<string, EnvVarEntry[]> = {};
  for (const v of envVars) {
    bySkill[v.skillId] = bySkill[v.skillId] ?? [];
    bySkill[v.skillId].push(v);
  }

  const lines: string[] = [
    "# Environment variables for this workflow",
    "# Required vars are marked with (required)",
    "",
  ];
  for (const [, entries] of Object.entries(bySkill)) {
    lines.push(`# ${entries[0].skillName}`);
    for (const e of entries) {
      lines.push(`${e.key}=${e.required ? "" : "  # optional"}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** Generate TypeScript setup code. */
export function generateCodeSnippet(workflow: Workflow): string {
  const skillIds = usedSkillIds(workflow);
  const skillImports = skillIds.join(", ");

  const builtinVar =
    workflow.id === "triage" ? "triageWorkflow" : workflow.id === "implement" ? "implementWorkflow" : null;

  const importLines = builtinVar
    ? `import { execute, createSkillMap, ClaudeClient, ${skillImports} } from "@sweny-ai/core";
import { ${builtinVar} } from "@sweny-ai/core/workflows";`
    : `import { execute, createSkillMap, ClaudeClient, ${skillImports} } from "@sweny-ai/core";
import type { Workflow } from "@sweny-ai/core";`;

  const workflowRef = builtinVar ?? "myWorkflow";
  const workflowComment = builtinVar
    ? ""
    : "\n// Define or import your workflow\n// const myWorkflow: Workflow = { ... };\n";

  return `${importLines}
${workflowComment}
const skills = createSkillMap([${skillImports}]);
const claude = new ClaudeClient({ apiKey: process.env.ANTHROPIC_API_KEY! });

const results = await execute(${workflowRef}, {
  input: "your alert or issue description here",
  skills,
  claude,
});

console.log(results); // Record<string, NodeResult>`;
}
