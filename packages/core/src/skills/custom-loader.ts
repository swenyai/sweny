/**
 * Custom skill discovery — Node-only.
 *
 * Lives outside `skills/index.ts` so the registry stays browser-safe. Anything
 * that needs `node:fs` / `node:path` / `process.cwd()` belongs here.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

import type { Skill, SkillCategory } from "../types.js";
import { builtinSkills, isSkillConfigured } from "./index.js";

/**
 * Load custom skills from a `.claude/skills/` directory.
 *
 * Custom skills are instruction-only (no tools or config) — they provide
 * guidance documents that the coding agent reads from the filesystem.
 * Registering them here ensures workflow validation recognises the skill IDs
 * so nodes referencing them don't produce spurious warnings.
 */
export function loadCustomSkills(cwd: string = process.cwd()): Skill[] {
  const skillsDir = join(cwd, ".claude", "skills");
  if (!existsSync(skillsDir)) return [];

  const skills: Skill[] = [];

  let entries: string[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  for (const dirName of entries) {
    const skillFile = join(skillsDir, dirName, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    try {
      const content = readFileSync(skillFile, "utf-8");
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter?.name) continue;

      skills.push({
        id: frontmatter.name,
        name: frontmatter.name,
        description: frontmatter.description ?? `Custom skill: ${frontmatter.name}`,
        category: "general" as SkillCategory,
        config: {},
        tools: [],
      });
    } catch {
      // Skip malformed skill files
    }
  }

  return skills;
}

/** Extract YAML frontmatter from a markdown file (between --- delimiters). */
function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return YAML.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * From all builtins + custom repo skills, return only the skills that are usable.
 * Built-in skills are filtered by env vars; custom skills are always included.
 *
 * Node-only: reads `.claude/skills/` from disk. Browser code should call
 * `configuredBuiltinSkills` from `@sweny-ai/core/browser` instead.
 */
export function configuredSkills(env: Record<string, string | undefined> = process.env, cwd?: string): Skill[] {
  const configured = builtinSkills.filter((s) => isSkillConfigured(s, env));
  const custom = loadCustomSkills(cwd);

  // Deduplicate: built-in skills take precedence over custom skills with the same ID
  const ids = new Set(configured.map((s) => s.id));
  for (const skill of custom) {
    if (!ids.has(skill.id)) {
      configured.push(skill);
      ids.add(skill.id);
    }
  }

  return configured;
}
