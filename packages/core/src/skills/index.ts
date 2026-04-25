/**
 * Skill Registry
 *
 * All built-in skills + helpers to build a skill map from config.
 *
 * This module is browser-safe — no `node:fs`, no `node:path`, no `process`.
 * Custom skill discovery (filesystem-based) lives in `./custom-loader.js`,
 * which is Node-only and re-exported from `@sweny-ai/core` (the Node entry).
 */

import type { Logger, Skill, SkillCategory } from "../types.js";

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

/**
 * Minimal shape we need off an inline skill definition. Matches
 * `SkillDefinition` from types.ts (kept loose here to avoid a cross-import
 * that drags the full type graph into skill-index consumers).
 */
type InlineSkillDef = {
  name?: string;
  description?: string;
  instruction?: string;
  mcp?: unknown;
  category?: SkillCategory;
};

export function validateWorkflowSkills(
  workflow: { nodes: Record<string, { skills: string[] }> },
  available: Map<string, Skill>,
  inlineSkills?: Record<string, InlineSkillDef>,
): SkillValidationResult {
  const configured: Skill[] = [];
  const configuredIds = new Set<string>();
  const missing: SkillValidationResult["missing"] = [];
  const missingIds = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Inline workflow.skills are first-class at runtime (the executor merges
  // them into the skill map via mergeInlineSkills). Treat them as present
  // for validation so spec-valid workflows don't fail CLI pre-flight.
  const inlineIds = new Set(inlineSkills ? Object.keys(inlineSkills) : []);
  const inlineCategory = (id: string): SkillCategory => inlineSkills?.[id]?.category ?? "general";

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
    } else if (inlineIds.has(id)) {
      // Inline skills need no env vars and are auto-configured by the executor.
      continue;
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
      const cat = skill?.category ?? builtin?.category ?? (inlineIds.has(id) ? inlineCategory(id) : "unknown");
      if (!categoriesNeeded.has(cat)) categoriesNeeded.set(cat, []);
      categoriesNeeded.get(cat)!.push(id);
    }

    // Check each category has at least one configured skill
    for (const [cat, skillIds] of categoriesNeeded) {
      const hasAny = skillIds.some((id) => available.has(id) || inlineIds.has(id));
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

/**
 * Build a symmetric tool-name alias table from the loaded skills.
 *
 * Each skill declares its own `mcpAliases` (canonical name → list of
 * equivalent MCP tool names). This function:
 *
 *   1. Collects every alias pair declared by every loaded skill.
 *   2. Flattens each pair into one equivalence group (symmetric closure).
 *   3. Drops any MCP name claimed by more than one skill (ambiguous).
 *
 * Core stays vendor-neutral: nothing here knows Linear or GitHub by name.
 * Skills own their own naming, and ambiguity is detected at map-build
 * time so a call to one provider's `get_issue` can never spuriously
 * satisfy another provider's `any_tool_called` verify rule.
 *
 * @returns a map from every participating name to the full set of names
 *   that count as equivalent to it (including itself). Names that do not
 *   participate in any alias are absent — callers should fall back to
 *   name-equality when a lookup returns `undefined`.
 */
export function buildToolAliases(skills: Iterable<Skill>, logger?: Logger): ReadonlyMap<string, ReadonlySet<string>> {
  // First pass: record which skill(s) claim each MCP alias name.
  const mcpClaims = new Map<string, string[]>(); // mcp name → skill ids that declared it
  const pairs: Array<[string, string]> = []; // [canonical, mcpAlias]

  for (const skill of skills) {
    if (!skill.mcpAliases) continue;
    for (const [canonical, aliases] of Object.entries(skill.mcpAliases)) {
      for (const alias of aliases) {
        if (canonical === alias) continue;
        pairs.push([canonical, alias]);
        const claimers = mcpClaims.get(alias);
        if (claimers) {
          if (!claimers.includes(skill.id)) claimers.push(skill.id);
        } else {
          mcpClaims.set(alias, [skill.id]);
        }
      }
    }
  }

  // Drop ambiguous MCP names (claimed by >1 skill) and log once.
  const ambiguous = new Set<string>();
  for (const [name, claimers] of mcpClaims) {
    if (claimers.length > 1) {
      ambiguous.add(name);
      logger?.warn(
        `Tool alias "${name}" is declared by multiple skills (${claimers.join(", ")}); dropping from eval alias table to avoid cross-provider false positives.`,
      );
    }
  }

  // Second pass: union-find over the remaining pairs.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let cur = parent.get(x) ?? x;
    while (cur !== (parent.get(cur) ?? cur)) cur = parent.get(cur) ?? cur;
    parent.set(x, cur);
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // `find` registers previously-unseen nodes via `parent.get(x) ?? x` and
  // writes them back, so `union` handles first-contact pairs on its own.
  for (const [canonical, alias] of pairs) {
    if (ambiguous.has(alias)) continue;
    union(canonical, alias);
  }

  // Build the result: each name → its full equivalence set.
  const groups = new Map<string, Set<string>>();
  for (const name of parent.keys()) {
    const root = find(name);
    let group = groups.get(root);
    if (!group) {
      group = new Set<string>();
      groups.set(root, group);
    }
    group.add(name);
  }

  const result = new Map<string, ReadonlySet<string>>();
  for (const group of groups.values()) {
    for (const name of group) result.set(name, group);
  }
  return result;
}
