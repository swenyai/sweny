import { createRequire } from "node:module";
import type { NodeResult } from "../types.js";
import type { CliConfig } from "./config.js";
import { c } from "./output.js";
import { hasGitHubOidc, mintGitHubOidcToken } from "./github-oidc.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../../package.json") as { version: string };

// ── Cloud reporting ────────────────────────────────────────────────
const CLOUD_URL_DEFAULT = "https://cloud.sweny.ai";

/**
 * Opt-in run reporting to SWEny Cloud.
 *
 * Authentication is tried in order:
 *   1. GitHub Actions OIDC — when running inside an Action step with
 *      `permissions: { id-token: write }`. Zero-config, preferred.
 *   2. `config.cloudToken` (SWENY_CLOUD_TOKEN or .sweny.yml) — legacy.
 *
 * If neither is available the function is a silent no-op. The user's
 * GITHUB_TOKEN is never forwarded to sweny.ai.
 *
 * Failure is silent; reporting never blocks a workflow run.
 */
export async function reportToCloud(
  results: Map<string, NodeResult>,
  durationMs: number,
  config: CliConfig,
  workflow: string,
): Promise<void> {
  const cloudUrl = process.env.SWENY_CLOUD_URL || CLOUD_URL_DEFAULT;
  const authHeader = await resolveAuthHeader(cloudUrl, config.cloudToken);
  if (!authHeader) return;

  const repo = config.repository || process.env.GITHUB_REPOSITORY || "";
  const [owner, name] = repo.split("/");
  if (!owner || !name) return;

  const investigateData = results.get("investigate")?.data;
  const createPrData = results.get("create_pr")?.data;
  const createIssueData = results.get("create_issue")?.data ?? results.get("create-issue")?.data;

  const findings = (investigateData?.findings as unknown[]) ?? [];
  const hasFailed = [...results.values()].some((r) => r.status === "failed");

  const nodes = [...results.entries()].map(([id, r]) => ({
    id,
    name: id,
    status:
      r.status === "success"
        ? ("success" as const)
        : r.status === "failed"
          ? ("failed" as const)
          : ("skipped" as const),
    durationMs: undefined,
  }));

  const body = {
    owner,
    repo: name,
    status: hasFailed ? "failed" : "completed",
    workflow,
    duration_ms: durationMs,
    recommendation: investigateData?.recommendation as string | undefined,
    findings,
    highest_severity: investigateData?.highest_severity as string | undefined,
    novel_count: investigateData?.novel_count as number | undefined,
    pr_url: createPrData?.prUrl as string | undefined,
    pr_number: createPrData?.prNumber as number | undefined,
    issue_url: (createIssueData?.issueUrl ?? createPrData?.issueUrl) as string | undefined,
    issue_identifier: (createIssueData?.issueIdentifier ?? createPrData?.issueIdentifier) as string | undefined,
    issues_found: findings.length > 0,
    nodes,
    action_version: version,
    runner_os: process.env.RUNNER_OS,
  };

  try {
    const res = await fetch(`${cloudUrl}/api/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { run_url?: string };
      if (data.run_url) {
        console.log(c.subtle(`  cloud: ${data.run_url}`));
      }
    }
  } catch {
    // Never block the workflow on a reporting failure.
  }
}

/**
 * Try OIDC first (if running in Actions with id-token permission); fall back
 * to a project token. Returns `null` when neither is available so the caller
 * can silently skip reporting.
 */
async function resolveAuthHeader(cloudUrl: string, cloudToken: string | undefined): Promise<string | null> {
  if (hasGitHubOidc()) {
    try {
      const jwt = await mintGitHubOidcToken({ audience: cloudUrl });
      return `Bearer ${jwt}`;
    } catch (err) {
      // A visible (but non-fatal) hint so users can debug why OIDC didn't take.
      // We never throw — reporting must never block a workflow.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(c.subtle(`  cloud: OIDC mint failed (${msg}); falling back to project token`));
    }
  }
  if (cloudToken) return `Bearer ${cloudToken}`;
  return null;
}
