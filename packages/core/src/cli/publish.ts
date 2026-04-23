/**
 * sweny publish — Interactive CLI for publishing workflows and skills to the marketplace.
 *
 * Supports:
 * - Workflow YAML files → marketplace community submission
 * - Skill directories (SKILL.md) → marketplace skill submission
 * - Three output modes: GitHub PR (via `gh`), copy to clipboard, save locally
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import type { Command } from "commander";
import { parseWorkflow, validateWorkflow } from "../schema.js";
import { builtinSkills } from "../skills/index.js";
import { discoverSkillsWithDiagnostics } from "../skills/custom-loader.js";

// ── Types ──────────────────────────────────────────────────────────────

const VALID_CATEGORIES = ["triage", "security", "devops", "code-review", "testing", "content", "ops"] as const;

const VALID_SKILL_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export interface PublishResult {
  type: "workflow" | "skill";
  id: string;
  name: string;
  outputPath?: string;
  prUrl?: string;
}

// ── Validation helpers ─────────────────────────────────────────────────

export function validateWorkflowFile(filePath: string): {
  valid: boolean;
  id?: string;
  name?: string;
  nodeCount?: number;
  edgeCount?: number;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!fs.existsSync(filePath)) {
    return { valid: false, errors: ["File not found"], warnings };
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    return { valid: false, errors: [`Invalid YAML: ${e instanceof Error ? e.message : e}`], warnings };
  }

  try {
    const workflow = parseWorkflow(parsed);

    // Build known skill IDs from builtins + custom + inline workflow skills.
    // Surface skill-loader diagnostics (malformed frontmatter, invalid ids,
    // duplicate overrides) so publishers don't ship broken dependencies.
    const { skills: customSkills, warnings: skillWarnings } = discoverSkillsWithDiagnostics();
    for (const w of skillWarnings) warnings.push(w.message);
    const allSkillIds = new Set([...builtinSkills.map((s) => s.id), ...customSkills.map((s) => s.id)]);

    // Inline skills defined in the workflow's skills block (a Record<id, def>) are also valid
    if (workflow.skills) {
      for (const skillId of Object.keys(workflow.skills)) {
        allSkillIds.add(skillId);
      }
    }

    const schemaErrors = validateWorkflow(workflow, allSkillIds);
    if (schemaErrors.length > 0) {
      return {
        valid: false,
        id: workflow.id,
        name: workflow.name,
        errors: schemaErrors.map((e) => e.message),
        warnings,
      };
    }

    // Config completeness warnings
    const allSkills = [...builtinSkills, ...customSkills];
    const skillMap = new Map(allSkills.map((s) => [s.id, s]));
    const referencedSkillIds = new Set<string>();
    for (const node of Object.values(workflow.nodes)) {
      for (const id of node.skills) referencedSkillIds.add(id);
    }
    for (const id of referencedSkillIds) {
      const skill = skillMap.get(id);
      if (!skill) continue;
      const requiredEnvs = Object.entries(skill.config)
        .filter(([, f]) => f.required && f.env)
        .map(([, f]) => f.env!);
      if (requiredEnvs.length > 0) {
        warnings.push(`Skill "${id}" requires: ${requiredEnvs.join(", ")}`);
      }
    }

    return {
      valid: true,
      id: workflow.id,
      name: workflow.name,
      nodeCount: Object.keys(workflow.nodes).length,
      edgeCount: workflow.edges.length,
      errors: [],
      warnings,
    };
  } catch (e) {
    return { valid: false, errors: [`Schema error: ${e instanceof Error ? e.message : e}`], warnings };
  }
}

export function validateSkillDir(dirPath: string): {
  valid: boolean;
  id?: string;
  name?: string;
  hasInstruction: boolean;
  hasMcp: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const skillMdPath = path.join(dirPath, "SKILL.md");

  if (!fs.existsSync(skillMdPath)) {
    return { valid: false, hasInstruction: false, hasMcp: false, errors: ["SKILL.md not found in directory"] };
  }

  const content = fs.readFileSync(skillMdPath, "utf-8");

  // Parse frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    return { valid: false, hasInstruction: false, hasMcp: false, errors: ["No YAML frontmatter found"] };
  }

  let fm: Record<string, unknown>;
  try {
    fm = parseYaml(fmMatch[1]) as Record<string, unknown>;
  } catch (e) {
    return {
      valid: false,
      hasInstruction: false,
      hasMcp: false,
      errors: [`Invalid frontmatter YAML: ${e instanceof Error ? e.message : e}`],
    };
  }

  const id = String(fm.name ?? "");
  if (!id) {
    errors.push("Missing 'name' field in frontmatter");
  } else if (!VALID_SKILL_ID.test(id) || id.includes("--") || id.length > 64) {
    errors.push(`Invalid skill ID: "${id}" — must be lowercase, hyphens, no consecutive hyphens, max 64 chars`);
  }

  // Check directory name matches skill name
  const dirName = path.basename(dirPath);
  if (id && dirName !== id) {
    errors.push(`Directory name "${dirName}" doesn't match skill name "${id}"`);
  }

  const body = content.slice(fmMatch[0].length).trim();
  const hasInstruction = body.length > 0;
  const hasMcp = fm.mcp != null;

  if (!hasInstruction && !hasMcp) {
    errors.push("Skill must have an instruction body or an mcp config");
  }

  return {
    valid: errors.length === 0,
    id,
    name: id,
    hasInstruction,
    hasMcp,
    errors,
  };
}

// ── GitHub PR helpers ──────────────────────────────────────────────────

function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function ghAuthenticated(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ── Cancel helper ──────────────────────────────────────────────────────

function cancel(): never {
  p.cancel("Publish cancelled.");
  process.exit(0);
}

// ── Main flow ──────────────────────────────────────────────────────────

export async function runPublish(): Promise<PublishResult | null> {
  p.intro("Publish to the SWEny Marketplace");

  // Step 1: What to publish
  const contentType = await p.select({
    message: "What would you like to publish?",
    options: [
      { value: "workflow", label: "Workflow", hint: ".yml file" },
      { value: "skill", label: "Skill", hint: "SKILL.md directory" },
    ],
  });
  if (p.isCancel(contentType)) cancel();

  if ((contentType as string) === "workflow") {
    return await publishWorkflow();
  } else {
    return await publishSkill();
  }
}

async function publishWorkflow(): Promise<PublishResult | null> {
  // Step 2: Path to workflow
  const filePath = await p.text({
    message: "Path to workflow YAML file",
    placeholder: ".sweny/workflows/my-workflow.yml",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "Path is required";
      if (!fs.existsSync(v.trim())) return "File not found";
      return undefined;
    },
  });
  if (p.isCancel(filePath)) cancel();

  const absPath = path.resolve((filePath as string).trim());
  const validation = validateWorkflowFile(absPath);

  if (!validation.valid) {
    p.log.error(`Validation failed:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`);
    return null;
  }

  p.log.success(
    `Validated: ${chalk.cyan(validation.name)} — ${validation.nodeCount} nodes, ${validation.edgeCount} edges`,
  );

  if (validation.warnings.length > 0) {
    for (const warn of validation.warnings) {
      p.log.warn(warn);
    }
  }

  // Step 3: Metadata
  const raw = parseYaml(fs.readFileSync(absPath, "utf-8")) as Record<string, unknown>;

  let author = raw.author as string | undefined;
  if (!author) {
    const authorInput = await p.text({
      message: "Author name",
      placeholder: "your-username",
      validate: (v) => (!v || v.trim().length === 0 ? "Author is required" : undefined),
    });
    if (p.isCancel(authorInput)) cancel();
    author = (authorInput as string).trim();
  } else {
    p.log.info(`Author: ${chalk.cyan(author)}`);
  }

  let category = raw.category as string | undefined;
  if (!category || !VALID_CATEGORIES.includes(category as (typeof VALID_CATEGORIES)[number])) {
    const catInput = await p.select({
      message: "Category",
      options: VALID_CATEGORIES.map((c) => ({ value: c, label: c })),
    });
    if (p.isCancel(catInput)) cancel();
    category = catInput as string;
  } else {
    p.log.info(`Category: ${chalk.cyan(category)}`);
  }

  let tags = raw.tags as string[] | undefined;
  if (!tags || !Array.isArray(tags) || tags.length === 0) {
    const tagsInput = await p.text({
      message: "Tags (comma-separated)",
      placeholder: "automation, testing, ci",
    });
    if (p.isCancel(tagsInput)) cancel();
    tags = (tagsInput as string)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  } else {
    p.log.info(`Tags: ${chalk.cyan(tags.join(", "))}`);
  }

  // Step 4: Output mode
  return await selectOutputMode("workflow", validation.id!, absPath, {
    author,
    category,
    tags,
  });
}

async function publishSkill(): Promise<PublishResult | null> {
  // Step 2: Path to skill directory
  const dirPath = await p.text({
    message: "Path to skill directory (containing SKILL.md)",
    placeholder: ".sweny/skills/my-skill/",
    validate: (v) => {
      if (!v || v.trim().length === 0) return "Path is required";
      const resolved = path.resolve(v.trim());
      if (!fs.existsSync(resolved)) return "Directory not found";
      if (!fs.statSync(resolved).isDirectory()) return "Path must be a directory";
      if (!fs.existsSync(path.join(resolved, "SKILL.md"))) return "SKILL.md not found in directory";
      return undefined;
    },
  });
  if (p.isCancel(dirPath)) cancel();

  const absDir = path.resolve((dirPath as string).trim());
  const validation = validateSkillDir(absDir);

  if (!validation.valid) {
    p.log.error(`Validation failed:\n${validation.errors.map((e) => `  - ${e}`).join("\n")}`);
    return null;
  }

  const badges: string[] = [];
  if (validation.hasInstruction) badges.push("instruction");
  if (validation.hasMcp) badges.push("MCP");
  p.log.success(`Validated: ${chalk.cyan(validation.id)} [${badges.join(" + ")}]`);

  return await selectOutputMode("skill", validation.id!, absDir, {});
}

async function selectOutputMode(
  type: "workflow" | "skill",
  id: string,
  sourcePath: string,
  meta: { author?: string; category?: string; tags?: string[] },
): Promise<PublishResult | null> {
  const hasGh = ghAvailable();

  const options = [
    ...(hasGh
      ? [{ value: "pr", label: "Open GitHub PR", hint: "recommended — forks marketplace repo and opens a PR" }]
      : []),
    { value: "save", label: "Save submission file", hint: "saves to ./sweny-publish/" },
  ];

  const mode = await p.select({
    message: "How would you like to publish?",
    options,
  });
  if (p.isCancel(mode)) cancel();

  if ((mode as string) === "pr") {
    return await openGitHubPR(type, id, sourcePath, meta);
  } else {
    return await saveLocally(type, id, sourcePath);
  }
}

async function openGitHubPR(
  type: "workflow" | "skill",
  id: string,
  sourcePath: string,
  meta: { author?: string; category?: string; tags?: string[] },
): Promise<PublishResult | null> {
  if (!ghAuthenticated()) {
    p.log.error("Not authenticated with GitHub. Run: gh auth login");
    return null;
  }

  const s = p.spinner();
  s.start("Forking marketplace repository...");

  try {
    // Fork the marketplace repo (idempotent — if already forked, just continues)
    execFileSync("gh", ["repo", "fork", "swenyai/marketplace", "--clone=false"], { stdio: "pipe" });

    // Get the fork name
    const forkInfo = execFileSync("gh", ["api", "user"], { stdio: "pipe", encoding: "utf-8" });
    const username = JSON.parse(forkInfo).login;
    const forkRepo = `${username}/marketplace`;

    s.message("Creating branch...");
    const branchName = `publish/${type}/${id}`;

    // Clone to temp, create branch, add file, push, create PR
    const tmpDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "sweny-publish-"));
    execFileSync("gh", ["repo", "clone", forkRepo, tmpDir, "--", "--depth", "1"], { stdio: "pipe" });

    execFileSync("git", ["-C", tmpDir, "checkout", "-b", branchName], { stdio: "pipe" });

    if (type === "workflow") {
      const dest = path.join(tmpDir, "workflows", "community", `${id}.yml`);
      fs.copyFileSync(sourcePath, dest);
      execFileSync("git", ["-C", tmpDir, "add", `workflows/community/${id}.yml`], { stdio: "pipe" });
    } else {
      const destDir = path.join(tmpDir, "skills", "community", id);
      copySkillDir(sourcePath, destDir);
      execFileSync("git", ["-C", tmpDir, "add", `skills/community/${id}`], { stdio: "pipe" });
    }

    s.message("Pushing...");
    const commitMsg = type === "workflow" ? `feat: add ${id} workflow` : `feat: add ${id} skill`;

    execFileSync("git", ["-C", tmpDir, "commit", "-m", commitMsg], { stdio: "pipe" });
    execFileSync("git", ["-C", tmpDir, "push", "origin", branchName], { stdio: "pipe" });

    s.message("Creating pull request...");
    const prBody =
      type === "workflow"
        ? `## New Workflow: ${id}\n\n**Author:** ${meta.author}\n**Category:** ${meta.category}\n**Tags:** ${meta.tags?.join(", ")}\n\nSubmitted via \`sweny publish\`.`
        : `## New Skill: ${id}\n\nSubmitted via \`sweny publish\`.`;

    const prResult = execFileSync(
      "gh",
      [
        "pr",
        "create",
        "--repo",
        "swenyai/marketplace",
        "--head",
        `${username}:${branchName}`,
        "--title",
        `feat: add ${type} ${id}`,
        "--body",
        prBody,
      ],
      { stdio: "pipe", encoding: "utf-8" },
    );

    const prUrl = prResult.trim();

    // Cleanup temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });

    s.stop(`PR created: ${chalk.cyan(prUrl)}`);

    return { type, id, name: id, prUrl };
  } catch (e) {
    s.stop("Failed to create PR");
    p.log.error(`GitHub error: ${e instanceof Error ? e.message : e}`);
    p.log.info("Falling back to save locally...");
    return await saveLocally(type, id, sourcePath);
  }
}

async function saveLocally(type: "workflow" | "skill", id: string, sourcePath: string): Promise<PublishResult> {
  const outputDir = path.resolve("sweny-publish");
  fs.mkdirSync(outputDir, { recursive: true });

  if (type === "workflow") {
    const dest = path.join(outputDir, `${id}.yml`);
    fs.copyFileSync(sourcePath, dest);
    p.log.success(`Saved to ${chalk.cyan(dest)}`);
    p.log.info(`Submit manually: copy to workflows/community/ in a fork of swenyai/marketplace`);
    return { type, id, name: id, outputPath: dest };
  } else {
    const destDir = path.join(outputDir, id);
    copySkillDir(sourcePath, destDir);
    p.log.success(`Saved to ${chalk.cyan(destDir)}`);
    p.log.info(`Submit manually: copy to skills/community/ in a fork of swenyai/marketplace`);
    return { type, id, name: id, outputPath: destDir };
  }
}

/**
 * Recursively copy a skill source directory to its destination (Fix #17).
 *
 * Previously a flat `fs.readdirSync` + `fs.copyFileSync` loop: skills with
 * nested directories (scripts/, references/, assets/) either silently
 * shipped incomplete or — more often — threw EISDIR on the first subdir.
 *
 * Exported for tests; node:fs cp's recursive mode preserves structure.
 */
export function copySkillDir(sourceDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(sourceDir, destDir, { recursive: true });
}

// ── Command registration ───────────────────────────────────────────────

export function registerPublishCommand(program: Command): void {
  program
    .command("publish")
    .description("Publish a workflow or skill to the SWEny Marketplace")
    .action(async () => {
      await runPublish();
    });
}
