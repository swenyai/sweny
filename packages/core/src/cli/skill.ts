/**
 * `sweny skill` command group — discover, list, and scaffold skills.
 *
 * Skills are the unit of capability a workflow node names in its `skills`
 * array. Sweny ships built-ins (github, linear, slack, ...) and discovers
 * custom skills from `.{gemini,agents,claude,sweny}/skills/<id>/SKILL.md`.
 *
 * This module owns the *authoring* side of that loop:
 *
 *   sweny skill new <id>     scaffold a SKILL.md template
 *   sweny skill list         list built-in + custom skills together
 *
 * Discovery and validation already live in `../skills/custom-loader.js`
 * and `../skills/index.js`; this CLI is a thin authoring shell over them.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";

import { builtinSkills } from "../skills/index.js";
import { configuredSkillsWithDiagnostics, discoverSkillsWithDiagnostics } from "../skills/custom-loader.js";
import { SKILL_CATEGORIES, type SkillCategory } from "../types.js";

// Mirror of the loader's regex so authoring-side validation matches discovery.
const VALID_SKILL_ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

const HARNESS_DIRS = {
  claude: ".claude/skills",
  sweny: ".sweny/skills",
  agents: ".agents/skills",
  gemini: ".gemini/skills",
} as const;
type HarnessKey = keyof typeof HARNESS_DIRS;

/** Build the SKILL.md body for a fresh scaffold. Exported for tests. */
export function renderSkillTemplate(opts: { id: string; description: string; category: SkillCategory }): string {
  const { id, description, category } = opts;
  const lines: string[] = [];
  lines.push("---");
  lines.push(`name: ${id}`);
  lines.push(`description: ${description}`);
  lines.push(`category: ${category}`);
  lines.push("# config:");
  lines.push("#   EXAMPLE_ENV_VAR:");
  lines.push("#     description: Human-readable description shown by `sweny check`");
  lines.push("#     required: true");
  lines.push("# mcp:");
  lines.push("#   command: npx");
  lines.push('#   args: ["-y", "@your-org/your-mcp-server"]');
  lines.push("#   env:");
  lines.push("#     SOMETHING: ${SOMETHING}");
  lines.push("---");
  lines.push("");
  lines.push(`# ${id}`);
  lines.push("");
  lines.push(description);
  lines.push("");
  lines.push("## When to use");
  lines.push("");
  lines.push(`Reference this skill from a workflow node when the node needs ${description.toLowerCase()}.`);
  lines.push("");
  lines.push("```yaml");
  lines.push("nodes:");
  lines.push("  my_node:");
  lines.push("    name: My Node");
  lines.push(`    instruction: >-`);
  lines.push(`      Use the ${id} capability described in this skill.`);
  lines.push(`    skills: [${id}]`);
  lines.push("```");
  lines.push("");
  lines.push("## What this skill provides");
  lines.push("");
  lines.push(
    "Describe the contract this skill exposes. Custom skills are *instruction-only* by default — the markdown body becomes guidance the LLM sees when the node runs. Add an `mcp:` block in the frontmatter above to wire in tool execution via an MCP server.",
  );
  lines.push("");
  lines.push("Concrete things to document here:");
  lines.push("");
  lines.push("- Required environment variables (also declare in `config:` above so `sweny check` validates them).");
  lines.push("- The exact commands or tool calls the node should make.");
  lines.push("- Common failure modes and how to recover.");
  lines.push("- Any preconditions the workflow must satisfy before invoking this skill.");
  lines.push("");
  lines.push("## Example invocation");
  lines.push("");
  lines.push(
    "Replace this section with a concrete usage example, including the exact bash, MCP tool call, or LLM prompt the node should produce.",
  );
  lines.push("");
  return lines.join("\n");
}

interface NewOptions {
  description?: string;
  category?: string;
  harness?: HarnessKey;
  force?: boolean;
}

/**
 * Action handler for `sweny skill new`. Exported for unit tests; production
 * code goes through `registerSkillCommand`. `cwd` defaults to `process.cwd()`
 * so the CLI works as expected; tests pass a tmp dir for isolation.
 */
export function runSkillNew(idArg: string, options: NewOptions, cwd: string = process.cwd()): void {
  const id = idArg.toLowerCase();
  if (!VALID_SKILL_ID.test(id) || id.includes("--") || id.length > 64) {
    console.error(
      chalk.red(
        `  Invalid skill id "${idArg}".\n  Skill ids must be lowercase alphanumeric + hyphens (no consecutive hyphens), max 64 chars.`,
      ),
    );
    process.exit(2);
    return;
  }

  const description = (options.description ?? `Custom ${id} skill`).trim();
  const category = (options.category ?? "general") as SkillCategory;
  if (!SKILL_CATEGORIES.includes(category)) {
    console.error(chalk.red(`  Invalid category "${category}".\n  Allowed: ${SKILL_CATEGORIES.join(", ")}`));
    process.exit(2);
    return;
  }

  const harness = options.harness ?? "claude";
  const baseDir = HARNESS_DIRS[harness];
  if (!baseDir) {
    console.error(chalk.red(`  Unknown harness "${harness}". Allowed: ${Object.keys(HARNESS_DIRS).join(", ")}`));
    process.exit(2);
    return;
  }

  const skillDir = path.join(cwd, baseDir, id);
  const skillFile = path.join(skillDir, "SKILL.md");

  if (fs.existsSync(skillFile) && !options.force) {
    console.error(chalk.red(`  ${path.relative(cwd, skillFile)} already exists. Pass --force to overwrite.`));
    process.exit(1);
    return;
  }

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillFile, renderSkillTemplate({ id, description, category }), "utf-8");

  const rel = path.relative(cwd, skillFile);
  console.log(chalk.green(`\n  Created ${rel}\n`));
  console.log(chalk.dim("  Next steps:"));
  console.log(chalk.dim(`    1. Open ${rel} and replace the placeholder sections.`));
  console.log(chalk.dim(`    2. If your skill needs env vars, uncomment the 'config:' block in the frontmatter.`));
  console.log(chalk.dim(`    3. If your skill executes tools via MCP, uncomment the 'mcp:' block.`));
  console.log(chalk.dim(`    4. Reference the skill in a workflow node:  skills: [${id}]`));
  console.log(chalk.dim(`    5. Run \`sweny skill list\` to confirm it discovers correctly.`));
  console.log();
}

interface ListOptions {
  json?: boolean;
}

/**
 * Action handler for `sweny skill list`. Exported for unit tests; production
 * code goes through `registerSkillCommand`. `cwd` and `env` injection lets
 * tests exercise the configured-badge logic without polluting global state.
 */
export function runSkillList(
  options: ListOptions,
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): void {
  // We want the FULL list (built-in + custom) even when env vars aren't set.
  // configuredSkills filters by env, which hides authoring-time skills the
  // user just scaffolded, so combine sources directly.
  const { skills: customSkills, warnings: customWarnings } = discoverSkillsWithDiagnostics(cwd);
  const customIds = new Set(customSkills.map((s) => s.id));
  const builtinList = builtinSkills.filter((s) => !customIds.has(s.id));

  // Configured map drives the "configured?" badge: required env vars present.
  const configuredIds = new Set(configuredSkillsWithDiagnostics(env, cwd).skills.map((s) => s.id));

  if (options.json) {
    const data = [
      ...builtinList.map((s) => ({
        id: s.id,
        kind: "builtin",
        category: s.category,
        description: s.description,
        configured: configuredIds.has(s.id),
      })),
      ...customSkills.map((s) => ({
        id: s.id,
        kind: "custom",
        category: s.category,
        description: s.description,
        configured: configuredIds.has(s.id),
      })),
    ];
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }

  const renderRow = (s: { id: string; category: string; description: string }, kind: "builtin" | "custom") => {
    const tag = kind === "custom" ? chalk.magenta("custom") : chalk.dim("builtin");
    const ok = configuredIds.has(s.id) ? chalk.green("✓") : chalk.yellow("·");
    console.log(`  ${ok} ${chalk.cyan(s.id)} ${chalk.dim(`(${s.category})`)} ${tag}`);
    console.log(chalk.dim(`      ${s.description}`));
  };

  console.log(chalk.bold("\nAvailable skills:\n"));
  console.log(chalk.dim("  ✓ = configured (required env vars present)"));
  console.log(chalk.dim("  · = present but not configured"));
  console.log();
  if (builtinList.length === 0 && customSkills.length === 0) {
    console.log(chalk.dim("  (no skills found)\n"));
  } else {
    for (const s of builtinList) renderRow(s, "builtin");
    for (const s of customSkills) renderRow(s, "custom");
  }

  if (customWarnings.length > 0) {
    console.log();
    console.log(chalk.yellow(`  ${customWarnings.length} skill discovery warning(s):`));
    for (const w of customWarnings) {
      console.log(chalk.yellow(`    ${w.kind}: ${w.message}`));
    }
  }
  console.log();
  console.log(chalk.dim(`  Scaffold a new skill:  sweny skill new <id>`));
  console.log();
}

/** Register the `sweny skill` subcommand group on the parent program. */
export function registerSkillCommand(program: Command): void {
  const skillCmd = program.command("skill").description("Author and inspect skills");

  skillCmd
    .command("new <id>")
    .description("Scaffold a new SKILL.md in .claude/skills/<id>/")
    .option("-d, --description <text>", "One-line description (required field in frontmatter)")
    .option("-c, --category <category>", `Skill category (${SKILL_CATEGORIES.join("|")})`, "general")
    .option("--harness <harness>", `Where to place the skill (${Object.keys(HARNESS_DIRS).join("|")})`, "claude")
    .option("--force", "Overwrite an existing SKILL.md")
    .action((id: string, options: NewOptions) => runSkillNew(id, options));

  skillCmd
    .command("list")
    .description("List built-in and custom skills together with configuration status")
    .option("--json", "Output as JSON array")
    .action((options: ListOptions) => runSkillList(options));
}
