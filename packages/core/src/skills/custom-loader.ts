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

import type { Skill, McpServerConfig, ConfigField } from "../types.js";
import { SKILL_CATEGORIES, SKILL_HARNESSES, isValidSkillId, type SkillCategory } from "../types.js";
import { builtinSkills, isSkillConfigured } from "./index.js";

/**
 * Directories to scan, in ascending priority order. Last match wins.
 *
 * Derived from {@link SKILL_HARNESSES} so the loader and the CLI authoring
 * side cannot disagree on what counts as a skill harness directory.
 */
const SKILL_DIRS: readonly string[] = SKILL_HARNESSES.map((h) => h.path);

/**
 * Diagnostic emitted when a SKILL.md file is skipped or overridden during
 * discovery. CLI flows can render these as yellow warnings; library consumers
 * can inspect `kind` to decide whether to surface, ignore, or fail.
 */
export interface SkillDiagnostic {
  kind: "invalid-frontmatter" | "missing-name" | "invalid-id" | "unreadable-file" | "duplicate-id";
  path: string;
  message: string;
}

export interface SkillDiscoveryResult {
  skills: Skill[];
  warnings: SkillDiagnostic[];
}

/**
 * Discover custom skills and surface diagnostics for broken ones.
 *
 * Prefer this over `discoverSkills` for CLI flows that can surface warnings
 * to users. `discoverSkills` stays as a backward-compatible wrapper for
 * callers that only want the happy-path skill list.
 */
export function discoverSkillsWithDiagnostics(cwd: string = process.cwd()): SkillDiscoveryResult {
  const skillMap = new Map<string, Skill>();
  const warnings: SkillDiagnostic[] = [];

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

      let content: string;
      try {
        content = readFileSync(skillFile, "utf-8");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "unknown error";
        warnings.push({
          kind: "unreadable-file",
          path: skillFile,
          message: `Could not read ${skillFile}: ${msg}`,
        });
        continue;
      }

      const parsed = parseSkillMd(content, skillFile);
      if (parsed.kind === "ok") {
        if (skillMap.has(parsed.skill.id)) {
          warnings.push({
            kind: "duplicate-id",
            path: skillFile,
            message: `Skill "${parsed.skill.id}" overrides an earlier definition (last-one-wins)`,
          });
        }
        skillMap.set(parsed.skill.id, parsed.skill);
      } else {
        warnings.push(parsed.diagnostic);
      }
    }
  }

  return { skills: [...skillMap.values()], warnings };
}

/**
 * Discover custom skills from all known harness directories.
 *
 * Backwards-compatible wrapper that drops diagnostics. Use
 * `discoverSkillsWithDiagnostics` when you want to surface warnings.
 */
export function discoverSkills(cwd: string = process.cwd()): Skill[] {
  return discoverSkillsWithDiagnostics(cwd).skills;
}

type ParseResult = { kind: "ok"; skill: Skill } | { kind: "err"; diagnostic: SkillDiagnostic };

function parseSkillMd(content: string, path: string): ParseResult {
  const raw = parseFrontmatter(content);
  if (raw === "invalid") {
    return {
      kind: "err",
      diagnostic: { kind: "invalid-frontmatter", path, message: `Invalid YAML frontmatter in ${path}` },
    };
  }
  if (!raw?.name) {
    return {
      kind: "err",
      diagnostic: { kind: "missing-name", path, message: `SKILL.md at ${path} has no 'name' field in frontmatter` },
    };
  }

  // Narrow the loosely-typed YAML output into the fields we expect
  const fm = raw as {
    name: string;
    description?: string;
    category?: string;
    config?: Record<string, unknown>;
    mcp?: Record<string, unknown>;
  };

  const category: SkillCategory =
    typeof fm.category === "string" && (SKILL_CATEGORIES as readonly string[]).includes(fm.category)
      ? (fm.category as SkillCategory)
      : "general";

  const id = String(fm.name);
  if (!isValidSkillId(id)) {
    return {
      kind: "err",
      diagnostic: {
        kind: "invalid-id",
        path,
        message: `Skill id "${id}" is invalid (lowercase alphanumeric + hyphens only, no consecutive hyphens, max 64 chars)`,
      },
    };
  }

  const instruction = extractBody(content);

  let mcp: McpServerConfig | undefined;
  if (fm.mcp && typeof fm.mcp === "object") {
    const m = fm.mcp as Record<string, any>;
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

  // Parse config fields from frontmatter
  const config: Record<string, ConfigField> = {};
  if (fm.config && typeof fm.config === "object") {
    for (const [key, value] of Object.entries(fm.config)) {
      if (value && typeof value === "object") {
        const v = value as Record<string, unknown>;
        config[key] = {
          description: typeof v.description === "string" ? v.description : key,
          required: v.required === true,
          env: key,
        };
      }
    }
  }

  return {
    kind: "ok",
    skill: {
      id,
      name: id,
      description: typeof fm.description === "string" ? fm.description : `Custom skill: ${id}`,
      category,
      config,
      tools: [],
      instruction: instruction || undefined,
      mcp,
    },
  };
}

/**
 * Extract and parse YAML frontmatter.
 *
 * Returns:
 *   - parsed object when frontmatter is present and valid
 *   - `null` when no frontmatter delimiters found (treat as no-op skip)
 *   - `"invalid"` when delimiters are present but the YAML body is malformed
 *     (distinct from "missing" so diagnostics can differentiate).
 */
function parseFrontmatter(content: string): Record<string, unknown> | null | "invalid" {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    const parsed = YAML.parse(match[1]);
    if (parsed === null || parsed === undefined) return null;
    if (typeof parsed !== "object") return "invalid";
    return parsed as Record<string, unknown>;
  } catch {
    return "invalid";
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
 * From all builtins + custom repo skills, return only the skills that are usable
 * alongside any custom-skill loader diagnostics (warnings for malformed or
 * duplicate SKILL.md files).
 *
 * Most CLI flows should prefer this over `configuredSkills` so they can
 * surface warnings to the user.
 */
export function configuredSkillsWithDiagnostics(
  env: Record<string, string | undefined> = process.env,
  cwd?: string,
): { skills: Skill[]; warnings: SkillDiagnostic[] } {
  const configured = builtinSkills.filter((s) => isSkillConfigured(s, env));
  const { skills: custom, warnings } = discoverSkillsWithDiagnostics(cwd);

  // Custom skills can override built-in IDs. When overriding, merge:
  // keep the built-in's tools and config, add the custom instruction/mcp.
  const configuredMap = new Map(configured.map((s) => [s.id, s]));

  for (const skill of custom) {
    const existing = configuredMap.get(skill.id);
    if (existing) {
      configuredMap.set(skill.id, {
        ...existing,
        config: { ...existing.config, ...skill.config },
        instruction: skill.instruction ?? existing.instruction,
        mcp: skill.mcp ?? existing.mcp,
      });
    } else {
      configuredMap.set(skill.id, skill);
    }
  }

  return { skills: [...configuredMap.values()], warnings };
}

/**
 * From all builtins + custom repo skills, return only the skills that are usable.
 *
 * Backwards-compatible wrapper that drops diagnostics. Prefer
 * `configuredSkillsWithDiagnostics` in CLI flows so broken skill files surface.
 */
export function configuredSkills(env: Record<string, string | undefined> = process.env, cwd?: string): Skill[] {
  return configuredSkillsWithDiagnostics(env, cwd).skills;
}
