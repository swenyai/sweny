/**
 * Core job execution for the open-source SWEny worker.
 *
 * Supports both "triage" and "implement" job types from WorkerJobPayload.
 * Adapted from the cloud worker's runner/triage.ts and runner/implement.ts.
 *
 * Key differences from the cloud worker:
 *   - Uses WorkerJobPayload instead of TriageJobPayload
 *   - No Redis event streaming (cloud-only feature)
 *   - Uses jobType field instead of type field
 *   - implement issueIdentifier comes from payload.config.issueIdentifier
 *   - No Sentry integration
 */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { runWorkflow, triageWorkflow, implementWorkflow } from "@sweny-ai/engine";
import type { TriageConfig, WorkflowResult } from "@sweny-ai/engine";
import type { ImplementConfig } from "@sweny-ai/engine";
import type { MCPServerConfig } from "@sweny-ai/providers";
import type { WorkerJobPayload } from "@sweny-ai/shared";
import { decryptBundle } from "./crypto.js";
import { hydrateProviders, buildAgentEnv, buildMcpServers } from "./providers.js";
import { logger as rootLogger } from "./logger.js";

const exec = promisify(execFile);

/**
 * Tracks workDirs that have been created but not yet cleaned up.
 * Exported so the entry point can log these on uncaught exceptions.
 */
export const pendingWorkDirs = new Set<string>();

export interface JobOutcome {
  jobStatus: "completed" | "failed";
  issuesFound: boolean;
  recommendation: "implement" | "escalate" | "skip";
  issueUrl?: string;
  prUrl?: string;
  issueIdentifier?: string;
}

// ---------------------------------------------------------------------------
// Internal API helpers
// ---------------------------------------------------------------------------

async function callInternal(
  internalApiUrl: string,
  path: string,
  method: "GET" | "POST",
  jobToken: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${internalApiUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Job-Token": jobToken,
    },
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "(unreadable)");
    throw new Error(`Internal API ${method} ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Main job runner
// ---------------------------------------------------------------------------

/**
 * Run a triage or implement job from a WorkerJobPayload.
 *
 * Flow:
 *   1. POST /internal/jobs/:jobId/start
 *   2. GET  /internal/jobs/:jobId/secrets → fetch BEK, decrypt bundle
 *   3. Clone repo to temp dir via git credential-store (keeps token out of argv)
 *   4. process.chdir(workDir) — safe because concurrency === 1
 *   5. Hydrate providers, build config, run triageWorkflow or implementWorkflow
 *   6. POST /internal/jobs/:jobId/result
 *   7. finally: clean up workDir
 */
export async function runJob(
  payload: WorkerJobPayload,
  internalApiUrl: string,
  codingAgent: "claude" | "codex" | "gemini",
): Promise<JobOutcome> {
  const { jobId, jobToken, orgId } = payload;
  const jobLogger = rootLogger.child({ jobId, orgId });

  // Step 1: Signal job start to the internal API
  await callInternal(internalApiUrl, `/internal/jobs/${jobId}/start`, "POST", jobToken);

  // Step 2: Fetch the Bundle Encryption Key (BEK) and decrypt the credential bundle.
  // The BEK is single-use — the API deletes it after first fetch (replay protection).
  const secretsResp = (await callInternal(internalApiUrl, `/internal/jobs/${jobId}/secrets`, "GET", jobToken)) as {
    bek: string;
  };

  const credentials = decryptBundle(payload.encryptedBundle, secretsResp.bek);

  jobLogger.info(
    {
      event: "credentials_decrypted",
      credentialCount: Object.keys(credentials).length,
      credentialKeys: Object.keys(credentials),
    },
    "Credentials decrypted",
  );

  let workDir: string | undefined;
  const prevDir = process.cwd();

  try {
    // Step 3: Create isolated temp dir for this job
    const prefix = payload.jobType === "implement" ? "sweny-implement-" : "sweny-triage-";
    workDir = await mkdtemp(join(tmpdir(), prefix));

    // Defense-in-depth: ensure workDir is inside the system temp directory.
    // Guards against path traversal if tmpdir() or mkdtemp ever behaves unexpectedly.
    const tmp = tmpdir();
    if (!workDir.startsWith(tmp)) {
      throw new Error(`Refusing to use workDir ${workDir} — not inside tmpdir (${tmp})`);
    }

    pendingWorkDirs.add(workDir);

    await cloneRepo(workDir, payload, credentials, jobLogger);

    // Step 4: chdir — safe because concurrency === 1
    process.chdir(workDir);

    // Step 5: Hydrate providers and run the recipe
    const providers = hydrateProviders(credentials, payload, jobLogger, codingAgent);
    const agentEnv = buildAgentEnv(credentials);
    const providerMcpServers = buildMcpServers(credentials);

    let result: WorkflowResult;

    if (payload.jobType === "implement") {
      const cfg = payload.config;
      const issueIdentifier = cfg["issueIdentifier"];
      if (typeof issueIdentifier !== "string" || !issueIdentifier) {
        throw new Error("issueIdentifier is required in payload.config for implement jobs");
      }

      const implementConfig: ImplementConfig = {
        issueIdentifier,
        repository: `${payload.repoOwner}/${payload.repoName}`,
        dryRun: (cfg["dryRun"] as boolean | undefined) ?? false,
        maxImplementTurns: (cfg["maxImplementTurns"] as number | undefined) ?? 40,
        agentEnv,
        projectId: credentials["LINEAR_TEAM_ID"] ?? credentials["JIRA_PROJECT_KEY"] ?? "",
        stateInProgress: "",
        statePeerReview: "",
        mcpServers: {
          ...providerMcpServers,
          ...(cfg["mcpServers"] as Record<string, MCPServerConfig> | undefined),
        },
      };

      jobLogger.info(`Running implement recipe for issue ${issueIdentifier}`);
      result = await runWorkflow(implementWorkflow, implementConfig, providers, { logger: jobLogger });
    } else {
      // Triage job (default)
      const cfg = payload.config;
      const triageConfig: TriageConfig = {
        timeRange: (cfg["timeRange"] as string | undefined) ?? "24h",
        severityFocus: (cfg["severityFocus"] as string | undefined) ?? "errors",
        serviceFilter: (cfg["serviceFilter"] as string | undefined) ?? "*",
        investigationDepth: (cfg["investigationDepth"] as string | undefined) ?? "standard",
        maxInvestigateTurns: (cfg["maxInvestigateTurns"] as number | undefined) ?? 50,
        maxImplementTurns: (cfg["maxImplementTurns"] as number | undefined) ?? 30,
        serviceMapPath: "",
        projectId: credentials["LINEAR_TEAM_ID"] ?? "",
        bugLabelId: credentials["LINEAR_BUG_LABEL_ID"] ?? "",
        triageLabelId: credentials["LINEAR_TRIAGE_LABEL_ID"] ?? "",
        stateBacklog: "",
        stateInProgress: "",
        statePeerReview: "",
        repository: `${payload.repoOwner}/${payload.repoName}`,
        dryRun: (cfg["dryRun"] as boolean | undefined) ?? false,
        noveltyMode: (cfg["noveltyMode"] as boolean | undefined) ?? true,
        issueOverride: "",
        additionalInstructions: (cfg["additionalInstructions"] as string | undefined) ?? "",
        agentEnv,
        mcpServers: {
          ...providerMcpServers,
          ...(cfg["mcpServers"] as Record<string, MCPServerConfig> | undefined),
        },
      };

      jobLogger.info("Running triage recipe");
      result = await runWorkflow(triageWorkflow, triageConfig, providers, { logger: jobLogger });
    }

    const outcome = mapToJobOutcome(result, payload);

    // Step 6: Submit outcome to the internal API
    await callInternal(internalApiUrl, `/internal/jobs/${jobId}/result`, "POST", jobToken, {
      jobStatus: outcome.jobStatus,
      issuesFound: outcome.issuesFound,
      recommendation: outcome.recommendation,
      issueUrl: outcome.issueUrl,
      prUrl: outcome.prUrl,
      issueIdentifier: outcome.issueIdentifier,
      stepsCompleted: result.steps.map((s) => s.name),
    });

    jobLogger.info({ recommendation: outcome.recommendation }, "Job completed");
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobLogger.error({ err: message }, "Job failed");

    // Best-effort failure report — don't let API errors mask the original error
    await callInternal(internalApiUrl, `/internal/jobs/${jobId}/result`, "POST", jobToken, {
      jobStatus: "failed",
      issuesFound: false,
      recommendation: "skip",
      stepsCompleted: [],
    }).catch((apiErr: unknown) => {
      const apiMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      jobLogger.error({ err: apiMsg }, "Failed to report job failure to API");
    });

    throw err;
  } finally {
    // Step 7: Always restore cwd and clean up the temp dir
    process.chdir(prevDir);
    if (workDir) {
      pendingWorkDirs.delete(workDir);
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Git clone
// ---------------------------------------------------------------------------

async function cloneRepo(
  workDir: string,
  payload: WorkerJobPayload,
  credentials: Record<string, string>,
  jobLogger: ReturnType<typeof rootLogger.child>,
): Promise<void> {
  const githubToken = credentials["GITHUB_TOKEN"] ?? "";

  // Write token to a credential store file (mode 0o600 — readable only by this process).
  // This keeps the token out of git clone argv, which is visible in `ps aux`.
  // The credFile lives inside workDir and is removed when workDir is cleaned up.
  const credFile = join(workDir, ".git-credentials");
  await writeFile(credFile, `https://x-access-token:${githubToken}@github.com\n`, { mode: 0o600 });

  const cloneUrl = `https://github.com/${payload.repoOwner}/${payload.repoName}.git`;

  // SAFETY: args array, not shell string — repoOwner/repoName are passed as separate
  // elements to execFile, so they cannot inject shell commands.
  await exec(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      payload.defaultBranch,
      "--config",
      `credential.helper=store --file=${credFile}`,
      cloneUrl,
      workDir,
    ],
    { timeout: 60_000 },
  );

  jobLogger.info(`Cloned ${payload.repoOwner}/${payload.repoName} to ${workDir}`);
}

// ---------------------------------------------------------------------------
// Result mapping
// ---------------------------------------------------------------------------

function validateRecommendation(value: unknown): "implement" | "escalate" | "skip" {
  if (value === "implement" || value === "escalate") return value;
  return "skip";
}

function mapToJobOutcome(result: WorkflowResult, payload: WorkerJobPayload): JobOutcome {
  if (payload.jobType === "implement") {
    const prStep = result.steps.find((s) => s.name === "create-pr");
    return {
      jobStatus: result.status === "failed" ? "failed" : "completed",
      issuesFound: true,
      recommendation: "implement",
      prUrl: prStep?.result.data?.["prUrl"] as string | undefined,
      issueUrl: prStep?.result.data?.["issueUrl"] as string | undefined,
      issueIdentifier: payload.config["issueIdentifier"] as string | undefined,
    };
  }

  // Triage result mapping
  const investigateStep = result.steps.find((s) => s.name === "investigate");
  const prStep = result.steps.find((s) => s.name === "create-pr");
  const issueStep = result.steps.find((s) => s.name === "create-issue");

  return {
    jobStatus: result.status === "failed" ? "failed" : "completed",
    issuesFound: (investigateStep?.result.data?.["issuesFound"] as boolean) ?? false,
    recommendation: validateRecommendation(investigateStep?.result.data?.["recommendation"]),
    prUrl: prStep?.result.data?.["prUrl"] as string | undefined,
    issueUrl: (prStep?.result.data?.["issueUrl"] ?? issueStep?.result.data?.["issueUrl"]) as string | undefined,
    issueIdentifier: (issueStep?.result.data?.["issueIdentifier"] ?? prStep?.result.data?.["issueIdentifier"]) as
      | string
      | undefined,
  };
}
