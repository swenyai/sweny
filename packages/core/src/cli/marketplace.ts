// packages/core/src/cli/marketplace.ts
/**
 * Marketplace install — fetch workflows from swenyai/workflows and
 * adapt them to the user's .sweny.yml providers.
 *
 * Pure functions for fetch/mismatch/adapt; file writes delegate to
 * helpers in ./new.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as p from "@clack/prompts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Skill, SkillCategory, Workflow, Claude, Logger } from "../types.js";
import type { FileConfig } from "./config-file.js";
import { refineWorkflow } from "../workflow-builder.js";
import { DagRenderer } from "./renderer.js";
import { workflowZ, validateWorkflow } from "../schema.js";
import { loadConfigFile } from "./config-file.js";
import {
  extractSkillsFromYaml,
  collectCredentialsForSkills,
  writeSwenyYmlIfMissing,
  appendMissingEnvKeys,
  writeWorkflowFile,
  type Credential,
} from "./new.js";

export const MARKETPLACE_REPO = "swenyai/workflows";
export const MARKETPLACE_RAW_BASE = `https://raw.githubusercontent.com/${MARKETPLACE_REPO}/main`;

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  skills: string[];
}

export interface FetchError extends Error {
  kind: "not-found" | "rate-limit" | "network" | "bad-yaml" | "unknown";
  retryAfter?: number; // unix seconds, for rate-limit
}

export interface FetchedWorkflow {
  id: string;
  yaml: string;
}

export async function fetchMarketplaceWorkflow(id: string): Promise<FetchedWorkflow> {
  const url = `${MARKETPLACE_RAW_BASE}/workflows/${id}.yml`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    const err = new Error(`Could not reach github.com — check your connection`) as FetchError;
    err.kind = "network";
    throw err;
  }

  if (res.status === 404) {
    const err = new Error(
      `Workflow "${id}" not found in ${MARKETPLACE_REPO}. See https://marketplace.sweny.ai for available workflows.`,
    ) as FetchError;
    err.kind = "not-found";
    throw err;
  }

  if (res.status === 403 && res.headers.get("X-RateLimit-Remaining") === "0") {
    const reset = res.headers.get("X-RateLimit-Reset");
    const err = new Error(`GitHub rate limit hit. Set GITHUB_TOKEN to raise the limit, or retry later.`) as FetchError;
    err.kind = "rate-limit";
    if (reset) err.retryAfter = parseInt(reset, 10);
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`Fetch failed with status ${res.status}`) as FetchError;
    err.kind = "unknown";
    throw err;
  }

  return { id, yaml: await res.text() };
}

export async function fetchMarketplaceIndex(): Promise<MarketplaceEntry[]> {
  const url = `${MARKETPLACE_RAW_BASE}/index.json`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    const err = new Error(`Could not reach github.com`) as FetchError;
    err.kind = "network";
    throw err;
  }

  if (res.status === 404) {
    const err = new Error(`Marketplace index not found`) as FetchError;
    err.kind = "not-found";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Fetch failed with status ${res.status}`) as FetchError;
    err.kind = "unknown";
    throw err;
  }

  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) {
    const err = new Error(`Marketplace index is not an array`) as FetchError;
    err.kind = "bad-yaml";
    throw err;
  }

  return raw as MarketplaceEntry[];
}

export interface ProviderMismatch {
  category: SkillCategory;
  configKey: string;
  workflowSkill: string;
  userProvider: string;
}

const CATEGORY_TO_CONFIG_KEY: Partial<Record<SkillCategory, string>> = {
  git: "source-control-provider",
  tasks: "issue-tracker-provider",
  observability: "observability-provider",
  notification: "notification-provider",
};

export function computeProviderMismatch(
  workflowSkills: string[],
  fileConfig: FileConfig,
  availableSkills: Skill[],
): ProviderMismatch[] {
  const skillMap = new Map(availableSkills.map((s) => [s.id, s]));
  const out: ProviderMismatch[] = [];

  for (const skillId of workflowSkills) {
    const skill = skillMap.get(skillId);
    if (!skill) continue;

    const configKey = CATEGORY_TO_CONFIG_KEY[skill.category];
    if (!configKey) continue;

    const userProvider = fileConfig[configKey];
    if (typeof userProvider !== "string") continue;
    if (userProvider === skillId) continue;

    out.push({
      category: skill.category,
      configKey,
      workflowSkill: skillId,
      userProvider,
    });
  }

  return out;
}

export function buildAdaptPrompt(mismatches: ProviderMismatch[]): string {
  const swaps = mismatches
    .map(
      (m) =>
        `- Replace the \`${m.workflowSkill}\` skill (${m.configKey}) with \`${m.userProvider}\`, preserving the intent of each node.`,
    )
    .join("\n");
  return [
    `The target project's .sweny.yml declares different providers than this workflow uses.`,
    `Rewrite the workflow so every node uses the target project's providers:`,
    "",
    swaps,
    "",
    `Keep node IDs, edge structure, and instruction intent. Only change skill references and any node instructions that name the old provider by name.`,
  ].join("\n");
}

export interface AdaptOptions {
  claude: Claude;
  skills: Skill[];
  logger: Logger;
  /** Optional pre-filled first refinement (e.g. buildAdaptPrompt output). */
  initialRefinement?: string;
}

/**
 * Render the workflow DAG and run an accept/refine/cancel loop.
 * Returns the accepted workflow or null on cancel.
 *
 * Applies `initialRefinement` (if provided) before the first render.
 */
export async function adaptWorkflowInteractive(workflow: Workflow, options: AdaptOptions): Promise<Workflow | null> {
  const { claude, skills, logger, initialRefinement } = options;
  let current = workflow;

  if (initialRefinement) {
    const spinner = p.spinner();
    spinner.start("Adapting workflow to your project…");
    try {
      current = await refineWorkflow(current, initialRefinement, { claude, skills, logger });
      spinner.stop("Adapted");
    } catch (err) {
      spinner.stop("Adaptation failed");
      p.log.error(`  ${err instanceof Error ? err.message : String(err)}`);
      // fall through — user sees the un-adapted workflow
    }
  }

  while (true) {
    console.log("");
    console.log(new DagRenderer(current, { animate: false }).renderToString());
    console.log("");

    const action = await p.select({
      message: "Looks good?",
      options: [
        { value: "accept", label: "Yes — use this workflow" },
        { value: "refine", label: "Refine — describe what to change" },
        { value: "cancel", label: "Cancel" },
      ],
    });
    if (p.isCancel(action) || action === "cancel") return null;

    if (action === "accept") return current;

    if (action === "refine") {
      const refinement = await p.text({
        message: "What would you like to change?",
        validate: (v) => (v && v.trim().length > 0 ? undefined : "Refinement is required"),
      });
      if (p.isCancel(refinement)) return null;

      const rspin = p.spinner();
      rspin.start("Refining…");
      try {
        current = await refineWorkflow(current, refinement as string, { claude, skills, logger });
        rspin.stop("Refined");
      } catch (err) {
        rspin.stop("Failed");
        p.log.error(`  ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

export interface InstallOptions {
  cwd: string;
  availableSkills: Skill[];
  /** Claude client for optional LLM adaptation. If null, we install as-is with a warning on mismatch. */
  claude: Claude | null;
  logger: Logger;
  /**
   * Pre-computed source-control provider (e.g. from git-remote detection).
   * When provided, takes precedence over the skill-based fallback inference.
   */
  inferredSourceControl?: string;
  /**
   * Pre-computed issue-tracker provider.
   * When provided, takes precedence over the skill-based fallback inference.
   */
  inferredIssueTracker?: string;
  /**
   * Pre-computed observability provider (or null if none).
   * When provided, takes precedence over the skill-based fallback inference.
   */
  inferredObservability?: string | null;
  /**
   * Whether to overwrite an existing workflow file.
   * Defaults to false. When false and the file already exists,
   * `installMarketplaceWorkflow` returns `{ installed: false, alreadyExists: true }`.
   */
  overwrite?: boolean;
}

export interface InstallResult {
  installed: boolean;
  adapted: boolean;
  workflowPath: string;
  mismatches: ProviderMismatch[];
  addedEnvKeys: number;
  /**
   * True when `overwrite` was false and a workflow file already existed at the
   * target path. The caller is responsible for prompting the user if desired.
   */
  alreadyExists?: boolean;
}

/**
 * Fetch a workflow from swenyai/workflows, adapt if provider mismatch is detected
 * AND an agent is available, then write files idempotently.
 *
 * When `overwrite` is false (default) and the workflow file already exists,
 * returns `{ installed: false, alreadyExists: true, workflowPath }` without
 * touching the file. The caller (runNew) is responsible for prompting the user.
 *
 * Pre-computed provider fields (`inferredSourceControl`, `inferredIssueTracker`,
 * `inferredObservability`) take precedence over skill-based inference when
 * provided. Omit them to use the original skill-based fallback (backward-compat
 * for direct callers that don't have git-remote information).
 */
export async function installMarketplaceWorkflow(id: string, options: InstallOptions): Promise<InstallResult> {
  const { cwd, availableSkills, claude, logger } = options;
  const overwrite = options.overwrite ?? false;

  // 1. Fetch
  const fetched = await fetchMarketplaceWorkflow(id);

  // 2. Load existing config to detect mismatches
  const fileConfig = loadConfigFile(cwd);
  const workflowSkills = extractSkillsFromYaml(fetched.yaml);
  const mismatches = computeProviderMismatch(workflowSkills, fileConfig, availableSkills);

  // 3. Adapt if needed + possible
  let finalYaml = fetched.yaml;
  let adapted = false;
  if (mismatches.length > 0 && claude) {
    try {
      const parsed = workflowZ.parse(parseYaml(fetched.yaml));
      const errs = validateWorkflow(parsed);
      if (errs.length > 0) {
        throw new Error(`Marketplace workflow has schema errors: ${errs.map((e) => e.message).join("; ")}`);
      }
      const refined = await adaptWorkflowInteractive(parsed, {
        claude,
        skills: availableSkills,
        logger,
        initialRefinement: buildAdaptPrompt(mismatches),
      });
      if (refined === null) {
        // user cancelled — signal no install
        return {
          installed: false,
          adapted: false,
          workflowPath: "",
          mismatches,
          addedEnvKeys: 0,
        };
      }
      finalYaml = stringifyYaml(refined, { indent: 2, lineWidth: 120 });
      adapted = true;
    } catch (err) {
      logger.warn(`Adaptation failed, installing as-is: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (mismatches.length > 0) {
    const swapDesc = mismatches.map((m) => `${m.workflowSkill} → ${m.userProvider}`).join(", ");
    logger.warn(
      `Workflow uses providers different from your .sweny.yml (${swapDesc}). ` +
        `Install as-is and edit manually, or set ANTHROPIC_API_KEY and re-run to adapt automatically.`,
    );
  }

  // 4. Infer providers for fresh-project .sweny.yml.
  // Pre-computed values from the caller (git-remote-based) take precedence;
  // fall back to skill-based inference for backward-compat with direct callers.
  const finalSkills = extractSkillsFromYaml(finalYaml);
  const sourceControl =
    options.inferredSourceControl !== undefined
      ? options.inferredSourceControl
      : finalSkills.includes("gitlab")
        ? "gitlab"
        : "github";
  const issueTracker =
    options.inferredIssueTracker !== undefined
      ? options.inferredIssueTracker
      : finalSkills.includes("linear")
        ? "linear"
        : finalSkills.includes("jira")
          ? "jira"
          : "github-issues";
  const observability =
    options.inferredObservability !== undefined
      ? options.inferredObservability
      : finalSkills.includes("datadog")
        ? "datadog"
        : finalSkills.includes("sentry")
          ? "sentry"
          : finalSkills.includes("betterstack")
            ? "betterstack"
            : finalSkills.includes("newrelic")
              ? "newrelic"
              : null;

  writeSwenyYmlIfMissing(cwd, sourceControl, observability, issueTracker);

  // 5. Credentials
  const creds: Credential[] = collectCredentialsForSkills(finalSkills, availableSkills);
  const addedEnvKeys = appendMissingEnvKeys(cwd, creds);

  // 6. Workflow file — respect the overwrite flag.
  const write = writeWorkflowFile(cwd, id, finalYaml, { overwrite });
  if (!write.written) {
    // File exists and overwrite was false — signal the caller.
    return {
      installed: false,
      adapted,
      workflowPath: write.path,
      mismatches,
      addedEnvKeys,
      alreadyExists: true,
    };
  }

  return {
    installed: true,
    adapted,
    workflowPath: write.path,
    mismatches,
    addedEnvKeys,
  };
}
