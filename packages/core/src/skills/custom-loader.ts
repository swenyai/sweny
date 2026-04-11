/**
 * Custom skill discovery — Node-only.
 *
 * Scans multiple skill directories (multi-harness) for SKILL.md files,
 * captures the markdown body as `instruction`, and parses optional `mcp`
 * from frontmatter.
 *
 * Discovery priority (higher number wins on ID collision):
 *   .gemini/skills/ < .agents/skills/ < .claude/skills/ < .sweny/skills/
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

import type { Skill, SkillCategory, McpServerConfig } from "../types.js";
import { builtinSkills, isSkillConfigured } from "./index.js";

/** Directories to scan, in ascending priority order. Last match wins. */
const SKILL_DIRS = [".gemini/skills", ".agents/skills", ".claude/skills", ".sweny/skills"];

/**
 * Discover custom skills from all known harness directories.
 */
export function discoverSkills(cwd: string = process.cwd()): Skill[] {
  const skillMap = new Map<string, Skill>();

  for (const relDir of SKILL_DIRS) {
    const skillsDir = join(cwd, relDir);
    if (!existsSync(skillsDir)) continue;

    let entries: string[];
    try {
      entries = readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }

    for (const dirName of entries) {
      const skillFile = join(skillsDir, dirName, "SKILL.md");
      if (!existsSync(skillFile)) continue;

      try {
        const content = readFileSync(skillFile, "utf-8");
        const parsed = parseSkillMd(content);
        if (!parsed) continue;

        skillMap.set(parsed.id, parsed);
      } catch {
        // Skip malformed skill files
      }
    }
  }

  return [...skillMap.values()];
}

/**
 * Parse a SKILL.md file into a Skill object.
 */
function parseSkillMd(content: string): Skill | null {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter?.name) return null;

  const instruction = extractBody(content);

  let mcp: McpServerConfig | undefined;
  if (frontmatter.mcp && typeof frontmatter.mcp === "object") {
    const m = frontmatter.mcp;
    if (m.command || m.url) {
      mcp = {
        type: m.type ?? (m.command ? "stdio" : "http"),
        ...(m.command ? { command: m.command } : {}),
        ...(m.args ? { args: m.args } : {}),
        ...(m.url ? { url: m.url } : {}),
        ...(m.headers ? { headers: m.headers } : {}),
        ...(m.env ? { env: m.env } : {}),
      };
    }
  }

  return {
    id: frontmatter.name,
    name: frontmatter.name,
    description: frontmatter.description ?? `Custom skill: ${frontmatter.name}`,
    category: "general" as SkillCategory,
    config: {},
    tools: [],
    instruction: instruction || undefined,
    mcp,
  };
}

/** Extract YAML frontmatter from a markdown file (between --- delimiters). */
function parseFrontmatter(content: string): Record<string, any> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return YAML.parse(match[1]);
  } catch {
    return null;
  }
}

/** Extract the markdown body (everything after closing ---). */
function extractBody(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)/);
  if (!match) return "";
  return match[1].trim();
}

/**
 * Legacy API — load custom skills from `.claude/skills/` only.
 * @deprecated Use `discoverSkills` for multi-directory support.
 */
export function loadCustomSkills(cwd: string = process.cwd()): Skill[] {
  return discoverSkills(cwd);
}

/**
 * From all builtins + custom repo skills, return only the skills that are usable.
 */
export function configuredSkills(env: Record<string, string | undefined> = process.env, cwd?: string): Skill[] {
  const configured = builtinSkills.filter((s) => isSkillConfigured(s, env));
  const custom = discoverSkills(cwd);

  // Custom skills can override built-in IDs. When overriding, merge:
  // keep the built-in's tools and config, add the custom instruction/mcp.
  const configuredMap = new Map(configured.map((s) => [s.id, s]));

  for (const skill of custom) {
    const existing = configuredMap.get(skill.id);
    if (existing) {
      // Merge: built-in tools + custom instruction/mcp
      configuredMap.set(skill.id, {
        ...existing,
        instruction: skill.instruction ?? existing.instruction,
        mcp: skill.mcp ?? existing.mcp,
      });
    } else {
      configuredMap.set(skill.id, skill);
    }
  }

  return [...configuredMap.values()];
}
