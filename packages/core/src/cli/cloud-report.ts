import { createRequire } from "node:module";
import type { NodeResult } from "../types.js";
import type { CliConfig } from "./config.js";
import { c } from "./output.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../../package.json") as { version: string };

// ── Cloud reporting ────────────────────────────────────────────────
const CLOUD_URL_DEFAULT = "https://cloud.sweny.ai";

/**
 * The raw finding shape emitted by the triage `investigate` node. The
 * `title`, `root_cause`, and `fix_approach` fields are free LLM prose about
 * the customer's private bug — they are read here only so `shapeFinding` can
 * DROP them. They must never be forwarded to cloud.
 */
interface RawFinding {
  title?: string;
  root_cause?: string;
  fix_approach?: string;
  severity?: string;
  is_duplicate?: boolean;
  duplicate_of?: string;
  fix_complexity?: string;
  affected_services?: string[];
}

/** Shape-only finding: classification metadata, no prose. See {@link shapeFinding}. */
interface ShapedFinding {
  severity?: string;
  is_duplicate: boolean;
  fix_complexity?: string;
  affected_services_count?: number;
}

/**
 * Reduce a raw finding to its shape-only classification. Keeps severity,
 * novel-vs-duplicate, fix complexity, and affected-service COUNT. Drops
 * `title`, `root_cause`, `fix_approach`, and `duplicate_of` — the fields that
 * would leak the customer's private bug description, the raw root-cause
 * analysis, the proposed fix prose, or a linkable existing-issue id.
 */
function shapeFinding(f: RawFinding): ShapedFinding {
  const shaped: ShapedFinding = {
    severity: typeof f.severity === "string" ? f.severity : undefined,
    is_duplicate: f.is_duplicate === true,
  };
  if (typeof f.fix_complexity === "string") shaped.fix_complexity = f.fix_complexity;
  // COUNT only. Service names are LLM-written strings; never ship them.
  if (Array.isArray(f.affected_services)) {
    shaped.affected_services_count = f.affected_services.filter((s) => typeof s === "string").length;
  }
  return shaped;
}

const RECOMMENDATIONS = ["implement", "escalate", "skip"] as const;

/** Clamp free LLM text to a closed enum so no prose can ride in `recommendation`. */
function toRecommendationEnum(v: unknown): "implement" | "escalate" | "skip" | "other" {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (RECOMMENDATIONS as readonly string[]).includes(t) ? (t as (typeof RECOMMENDATIONS)[number]) : "other";
}

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

  const rawFindings = (investigateData?.findings as RawFinding[]) ?? [];
  // SHAPE-ONLY findings. The raw finding carries `title`, `root_cause`, and
  // `fix_approach` — free LLM prose about the customer's private bug and the
  // proposed fix. That MUST NEVER leave the host (product rule: show don't
  // store code). We ship only the classification metadata: severity, novel vs
  // duplicate, fix complexity, and affected-service count. Mirrors the
  // `inputs_shape` precedent in cloud-lifecycle.ts (key shape, never values).
  const findings = rawFindings.map(shapeFinding);
  const hasFailed = [...results.values()].some((r) => r.status === "failed");

  // Severity histogram — counts only, derived from the shape-only findings.
  const severityCounts: Record<string, number> = {};
  for (const f of findings) {
    if (f.severity) severityCounts[f.severity] = (severityCounts[f.severity] ?? 0) + 1;
  }
  const duplicateCount = findings.filter((f) => f.is_duplicate).length;

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
    recommendation:
      investigateData?.recommendation === undefined ? undefined : toRecommendationEnum(investigateData.recommendation),
    findings,
    findings_count: findings.length,
    duplicate_count: duplicateCount,
    severity_counts: severityCounts,
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
