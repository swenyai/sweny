import { createRequire } from "node:module";
import type { NodeResult } from "../types.js";
import type { CliConfig } from "./config.js";
import { c } from "./output.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../../package.json") as { version: string };

// ── Cloud reporting ────────────────────────────────────────────────
const CLOUD_URL_DEFAULT = "https://cloud.sweny.ai";

/**
 * Opt-in run reporting to SWEny Cloud.
 *
 * Fires only when `config.cloudToken` (from SWENY_CLOUD_TOKEN or .sweny.yml)
 * is set. Authenticates using the user's cloud token — the user's GITHUB_TOKEN
 * is never forwarded to sweny.ai.
 *
 * Failure is silent; reporting never blocks a workflow run.
 */
export async function reportToCloud(
  results: Map<string, NodeResult>,
  durationMs: number,
  config: CliConfig,
  workflow: string,
): Promise<void> {
  const cloudToken = config.cloudToken;
  if (!cloudToken) return;

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

  const cloudUrl = process.env.SWENY_CLOUD_URL || CLOUD_URL_DEFAULT;

  try {
    const res = await fetch(`${cloudUrl}/api/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cloudToken}`,
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
