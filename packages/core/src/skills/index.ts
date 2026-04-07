/**
 * Skill Registry
 *
 * All built-in skills + helpers to build a skill map from config.
 *
 * This module is browser-safe — no `node:fs`, no `node:path`, no `process`.
 * Custom skill discovery (filesystem-based) lives in `./custom-loader.js`,
 * which is Node-only and re-exported from `@sweny-ai/core` (the Node entry).
 */

import type { Skill, SkillCategory } from "../types.js";

import { github } from "./github.js";
import { linear } from "./linear.js";
import { slack } from "./slack.js";
import { sentry } from "./sentry.js";
import { datadog } from "./datadog.js";
import { betterstack } from "./betterstack.js";
import { notification } from "./notification.js";
import { supabase } from "./supabase.js";

// ─── Built-in skill catalog ─────────────────────────────────────

export const builtinSkills: Skill[] = [github, linear, slack, sentry, datadog, betterstack, notification, supabase];

export { github, linear, slack, sentry, datadog, betterstack, notification, supabase };

// ─── Registry helpers ───────────────────────────────────────────

/**
 * Build a skill map from an array of skills.
 * Pass to `execute()` as the `skills` option.
 *
 * @example
 * ```ts
 * const skills = createSkillMap([github, sentry, slack])
 * await execute(workflow, input, { skills, claude })
 * ```
 */
export function createSkillMap(skills: Skill[]): Map<string, Skill> {
  const map = new Map<string, Skill>();
  for (const skill of skills) {
    if (map.has(skill.id)) {
      throw new Error(`Duplicate skill ID: "${skill.id}"`);
    }
    map.set(skill.id, skill);
  }
  return map;
}

/**
 * Create a skill map from all built-in skills.
 */
export function allSkills(): Map<string, Skill> {
  return createSkillMap(builtinSkills);
}

/**
 * Check if a skill is usable given the available environment.
 *
 * A skill is configured when all its *required* config fields are set.
 * Optional fields are validated by individual tool handlers at call time,
 * so missing optional config never disqualifies the skill.
 */
export function isSkillConfigured(skill: Skill, env: Record<string, string | undefined> = {}): boolean {
  for (const field of Object.values(skill.config)) {
    if (field.required && field.env && !env[field.env]) return false;
  }
  return true;
}

/**
 * Browser-safe variant of `configuredSkills`: returns only the *built-in* skills
 * whose required env vars are present. Does not touch the filesystem.
 *
 * Node callers should use `configuredSkills` from `@sweny-ai/core`, which also
 * loads custom skills from `.claude/skills/`.
 */
export function configuredBuiltinSkills(env: Record<string, string | undefined> = {}): Skill[] {
  return builtinSkills.filter((s) => isSkillConfigured(s, env));
}

/**
 * Validate that a workflow's skill requirements are satisfiable.
 *
 * Groups each node's skills by category and checks that at least one
 * skill per category is available. Returns a report of what's configured,
 * what's missing, and any hard errors (required category with zero providers).
 */
export interface SkillValidationResult {
  /** All skills referenced by the workflow, grouped by availability */
  configured: Skill[];
  missing: { id: string; category: SkillCategory | "unknown"; missingEnv: string[] }[];
  /** Nodes where an entire non-notification category has zero configured skills */
  errors: string[];
  /** Nodes where notification category has zero configured skills (non-fatal) */
  warnings: string[];
}

export function validateWorkflowSkills(
  workflow: { nodes: Record<string, { skills: string[] }> },
  available: Map<string, Skill>,
): SkillValidationResult {
  const configured: Skill[] = [];
  const configuredIds = new Set<string>();
  const missing: SkillValidationResult["missing"] = [];
  const missingIds = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Collect all referenced skill IDs
  const allReferencedIds = new Set<string>();
  for (const node of Object.values(workflow.nodes)) {
    for (const id of node.skills) allReferencedIds.add(id);
  }

  // Classify each referenced skill
  for (const id of allReferencedIds) {
    const skill = available.get(id);
    if (skill) {
      if (!configuredIds.has(id)) {
        configured.push(skill);
        configuredIds.add(id);
      }
    } else {
      if (!missingIds.has(id)) {
        // Try to find it in builtins to get its category and required env vars
        const builtin = builtinSkills.find((s) => s.id === id);
        const category = builtin?.category ?? "unknown";
        // Show required env vars first, then optional ones (for all-optional skills like slack)
        const envFields = builtin ? Object.entries(builtin.config).filter(([, f]) => f.env) : [];
        const requiredEnv = envFields.filter(([, f]) => f.required).map(([, f]) => f.env!);
        const missingEnv = requiredEnv.length > 0 ? requiredEnv : envFields.map(([, f]) => f.env!); // show all options for all-optional skills
        missing.push({ id, category, missingEnv });
        missingIds.add(id);
      }
    }
  }

  // Per-node validation: check that each node has at least one skill per category
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    if (node.skills.length === 0) continue;

    // Group this node's skills by category
    const categoriesNeeded = new Map<SkillCategory | "unknown", string[]>();
    for (const id of node.skills) {
      const skill = available.get(id);
      const builtin = builtinSkills.find((s) => s.id === id);
      const cat = skill?.category ?? builtin?.category ?? "unknown";
      if (!categoriesNeeded.has(cat)) categoriesNeeded.set(cat, []);
      categoriesNeeded.get(cat)!.push(id);
    }

    // Check each category has at least one configured skill
    for (const [cat, skillIds] of categoriesNeeded) {
      const hasAny = skillIds.some((id) => available.has(id));
      if (!hasAny) {
        const msg = `Node "${nodeId}" has no configured ${cat} providers (needs one of: ${skillIds.join(", ")})`;
        if (cat === "notification") {
          warnings.push(msg);
        } else {
          errors.push(msg);
        }
      }
    }
  }

  return { configured, missing, errors, warnings };
}
