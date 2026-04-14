// packages/core/src/cli/marketplace.ts
/**
 * Marketplace install — fetch workflows from swenyai/workflows and
 * adapt them to the user's .sweny.yml providers.
 *
 * Pure functions for fetch/mismatch/adapt; file writes delegate to
 * helpers in ./new.ts.
 */

import * as p from "@clack/prompts";
import type { Skill, SkillCategory, Workflow, Claude, Logger } from "../types.js";
import type { FileConfig } from "./config-file.js";
import { refineWorkflow } from "../workflow-builder.js";
import { DagRenderer } from "./renderer.js";

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
