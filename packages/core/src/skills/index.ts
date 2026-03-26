/**
 * Skill Registry
 *
 * All built-in skills + helper to build a skill map from config.
 */

import type { Skill } from "../types.js";

import { github } from "./github.js";
import { linear } from "./linear.js";
import { slack } from "./slack.js";
import { sentry } from "./sentry.js";
import { datadog } from "./datadog.js";
import { notification } from "./notification.js";

// ─── Built-in skill catalog ─────────────────────────────────────

export const builtinSkills: Skill[] = [github, linear, slack, sentry, datadog, notification];

export { github, linear, slack, sentry, datadog, notification };

// ─── Registry helper ─────────────────────────────────────────────

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
