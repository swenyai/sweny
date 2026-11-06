// packages/core/src/cli/marketplace.ts
/**
 * Marketplace install — fetch workflows from swenyai/marketplace and
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
import { validateParsed } from "../loader.js";
import { loadConfigFile } from "./config-file.js";
import {
  extractSkillsFromYaml,
  collectCredentialsForSkills,
  writeSwenyYmlIfMissing,
  appendMissingEnvKeys,
  writeWorkflowFile,
  type Credential,
} from "./new.js";

export const MARKETPLACE_REPO = "swenyai/marketplace";
export const MARKETPLACE_BRANCH = "main";
export const MARKETPLACE_RAW_BASE = `https://raw.githubusercontent.com/${MARKETPLACE_REPO}/${MARKETPLACE_BRANCH}`;
/** One recursive tree call lists every workflow file; the marketplace publishes no index of its own. */
export const MARKETPLACE_TREE_URL = `https://api.github.com/repos/${MARKETPLACE_REPO}/git/trees/${MARKETPLACE_BRANCH}?recursive=1`;
/** Directories under `workflows/` in the marketplace repo, in lookup order (official wins on an id clash). */
export const MARKETPLACE_SOURCES = ["official", "community"] as const;
type MarketplaceSource = (typeof MARKETPLACE_SOURCES)[number];

const WORKFLOW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const WORKFLOW_PATH_RE = new RegExp(`^workflows/(${MARKETPLACE_SOURCES.join("|")})/([A-Za-z0-9][A-Za-z0-9_-]*)\\.yml$`);

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

function fetchError(kind: FetchError["kind"], message: string): FetchError {
  const err = new Error(message) as FetchError;
  err.kind = kind;
  return err;
}

/** Throw a typed FetchError for any non-OK response (404 is left to the caller). */
function assertOk(res: Response): void {
  if (res.ok) return;
  if (res.status === 403 && res.headers.get("X-RateLimit-Remaining") === "0") {
    const err = fetchError("rate-limit", `GitHub rate limit hit. Set GITHUB_TOKEN to raise the limit, or retry later.`);
    const reset = res.headers.get("X-RateLimit-Reset");
    if (reset) err.retryAfter = parseInt(reset, 10);
    throw err;
  }
  throw fetchError("unknown", `Fetch failed with status ${res.status}`);
}

async function httpGet(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await (init ? fetch(url, init) : fetch(url));
  } catch {
    throw fetchError("network", `Could not reach github.com - check your connection`);
  }
}

/** Fetch `workflows/official/<id>.yml`, then `workflows/community/<id>.yml`, from swenyai/marketplace. */
export async function fetchMarketplaceWorkflow(id: string): Promise<FetchedWorkflow> {
  if (!WORKFLOW_ID_RE.test(id)) {
    throw fetchError("not-found", `Workflow "${id}" not found in ${MARKETPLACE_REPO}.`);
  }
  for (const source of MARKETPLACE_SOURCES) {
    const res = await httpGet(`${MARKETPLACE_RAW_BASE}/workflows/${source}/${id}.yml`);
    if (res.status === 404) continue;
    assertOk(res);
    return { id, yaml: await res.text() };
  }
  throw fetchError("not-found", `Workflow "${id}" not found in ${MARKETPLACE_REPO}.`);
}

/**
 * Build the browse list from the marketplace repo itself: one GitHub tree call
 * to list `workflows/{official,community}/*.yml`, then each file's name,
 * description and skills. Files that fail to fetch or parse are skipped.
 */
export async function fetchMarketplaceIndex(opts: { timeoutMs?: number } = {}): Promise<MarketplaceEntry[]> {
  const signal = opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const treeRes = await httpGet(MARKETPLACE_TREE_URL, { headers, ...(signal ? { signal } : {}) });
  if (treeRes.status === 404) throw fetchError("not-found", `Marketplace repo ${MARKETPLACE_REPO} not found`);
  assertOk(treeRes);

  const body = (await treeRes.json()) as { tree?: Array<{ path?: unknown; type?: unknown }> };
  if (!body || !Array.isArray(body.tree)) {
    throw fetchError("bad-yaml", `Marketplace tree listing is malformed`);
  }

  const found: Array<{ source: string; id: string }> = [];
  const seen = new Set<string>();
  for (const item of body.tree) {
    if (item.type !== "blob" || typeof item.path !== "string") continue;
    const m = WORKFLOW_PATH_RE.exec(item.path);
    if (m) found.push({ source: m[1], id: m[2] });
  }
  // Official first, then community; the first source to claim an id wins.
  found.sort(
    (a, b) =>
      MARKETPLACE_SOURCES.indexOf(a.source as MarketplaceSource) -
      MARKETPLACE_SOURCES.indexOf(b.source as MarketplaceSource),
  );

  const entries = await Promise.all(
    found.map(async ({ source, id }): Promise<MarketplaceEntry | null> => {
      if (seen.has(id)) return null;
      seen.add(id);
      try {
        const res = await fetch(
          `${MARKETPLACE_RAW_BASE}/workflows/${source}/${id}.yml`,
          signal ? { signal } : undefined,
        );
        if (!res.ok) return null;
        const yaml = await res.text();
        const parsed = parseYaml(yaml) as { name?: unknown; description?: unknown } | null;
        if (!parsed || typeof parsed !== "object") return null;
        return {
          id,
          name: typeof parsed.name === "string" && parsed.name ? parsed.name : id,
          description: typeof parsed.description === "string" ? parsed.description : "",
          skills: extractSkillsFromYaml(yaml),
        };
      } catch {
        return null;
      }
    }),
  );
  return entries.filter((e): e is MarketplaceEntry => e !== null);
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
        { value: "accept", label: "Yes - use this workflow" },
        { value: "refine", label: "Refine - describe what to change" },
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
 * Fetch a workflow from swenyai/marketplace, adapt if provider mismatch is detected
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

  // 2. Validate fetched content BEFORE any local side effects (Fix #3).
  // Previously, an invalid workflow could still get written to disk and
  // .sweny.yml / .env polluted with keys inferred from broken content.
  let parsed: Workflow;
  {
    let yamlParsed: unknown;
    try {
      yamlParsed = parseYaml(fetched.yaml);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Marketplace workflow "${id}" is not valid YAML: ${msg}`);
    }
    const validated = validateParsed(yamlParsed);
    if (!validated.ok) {
      throw new Error(
        `Marketplace workflow "${id}" failed validation:\n${validated.errors.map((e) => `  ${e.message}`).join("\n")}`,
      );
    }
    parsed = validated.workflow;
  }

  // 3. Load existing config to detect mismatches
  const fileConfig = loadConfigFile(cwd);
  const workflowSkills = extractSkillsFromYaml(fetched.yaml);
  const mismatches = computeProviderMismatch(workflowSkills, fileConfig, availableSkills);

  // 4. Adapt if needed + possible. Schema was already validated above, so
  // adaptation failure no longer hides a schema failure — it falls back to
  // installing the validated-original.
  let finalYaml = fetched.yaml;
  let adapted = false;
  if (mismatches.length > 0 && claude) {
    try {
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
      // Re-validate the refined output before writing. refineWorkflow runs
      // an LLM that produces a new Workflow object — it could drift away
      // from the upfront-validated parse (renamed required fields, dropped
      // edges). Reparsing the stringified YAML closes that loop so we
      // never write content that hasn't been schema-checked.
      const refinedYaml = stringifyYaml(refined, { indent: 2, lineWidth: 120 });
      const revalidated = validateParsed(parseYaml(refinedYaml));
      if (!revalidated.ok) {
        throw new Error(
          `Adapted workflow failed re-validation:\n${revalidated.errors.map((e) => `  ${e.message}`).join("\n")}`,
        );
      }
      finalYaml = refinedYaml;
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
