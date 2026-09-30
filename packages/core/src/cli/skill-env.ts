/**
 * Missing-credential reporting for skills.
 *
 * A built-in skill whose required env var is unset is NOT an unknown skill.
 * These helpers turn that state into one actionable line per skill
 * (`skill "github" needs GITHUB_TOKEN (set it in .env)`), shared by
 * `workflow run` (hard fail) and `workflow validate` (warning).
 */

import { builtinSkills, isSkillConfigured } from "../skills/index.js";
import type { SkillValidationResult } from "../skills/index.js";
import type { Skill } from "../types.js";

export interface SkillEnvGap {
  id: string;
  missingEnv: string[];
}

/**
 * Built-in skills referenced by a workflow that are not usable because a
 * required env var is unset. `availableIds` is the configured skill set;
 * inline and unknown ids never produce a gap.
 */
export function findSkillEnvGaps(
  skillIds: Iterable<string>,
  availableIds: ReadonlySet<string>,
  inlineIds: ReadonlySet<string> = new Set(),
): SkillEnvGap[] {
  const gaps: SkillEnvGap[] = [];
  const seen = new Set<string>();
  for (const id of skillIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (availableIds.has(id) || inlineIds.has(id)) continue;
    const builtin = builtinSkills.find((s) => s.id === id);
    if (!builtin) continue;
    const fields = Object.values(builtin.config).filter((f) => f.env);
    const required = fields.filter((f) => f.required).map((f) => f.env!);
    const missingEnv = required.length > 0 ? required : fields.map((f) => f.env!);
    if (missingEnv.length === 0) continue;
    gaps.push({ id, missingEnv });
  }
  return gaps;
}

export function formatSkillEnvGap(gap: SkillEnvGap): string {
  return `skill "${gap.id}" needs ${gap.missingEnv.join(", ")} (set it in .env)`;
}

/**
 * Lines to print for a failed `validateWorkflowSkills`: one env line per
 * built-in skill with missing env, plus node-level errors that carry extra
 * information (alternatives among several skills, or unknown ids).
 */
export function formatMissingSkillLines(validation: SkillValidationResult): string[] {
  const lines: string[] = [];
  const envGaps = validation.missing.filter((m) => m.category !== "unknown" && m.missingEnv.length > 0);
  const unknownIds = validation.missing.filter((m) => m.category === "unknown").map((m) => m.id);
  for (const m of envGaps) lines.push(formatSkillEnvGap({ id: m.id, missingEnv: m.missingEnv }));
  for (const err of validation.errors) {
    const listed = /needs one of: (.+)\)$/.exec(err)?.[1]?.split(", ") ?? [];
    const involvesUnknown = listed.some((id) => unknownIds.includes(id));
    if (involvesUnknown || listed.length > 1) lines.push(err);
  }
  return lines;
}

/** Warnings for `workflow validate`: referenced skills whose env is missing. */
export function skillEnvWarnings(
  workflow: { nodes: Record<string, { skills: string[] }>; skills?: Record<string, unknown> },
  env: Record<string, string | undefined>,
  available: Skill[],
): string[] {
  const availableIds = new Set(available.filter((s) => isSkillConfigured(s, env)).map((s) => s.id));
  const ids = Object.values(workflow.nodes).flatMap((n) => n.skills);
  const inline = new Set(Object.keys(workflow.skills ?? {}));
  return findSkillEnvGaps(ids, availableIds, inline).map(formatSkillEnvGap);
}
