import type { ExecutionEvent, NodeResult, Observer } from "../types.js";
import type { CliConfig } from "./config.js";
import { hasGitHubOidc, mintGitHubOidcToken } from "./github-oidc.js";
import { c } from "./output.js";

const CLOUD_URL_DEFAULT = "https://cloud.sweny.ai";

interface ObserverOptions {
  workflow: string;
  config: CliConfig;
  startedAt: number;
}

interface NodeTiming {
  startedAt: number;
}

/**
 * Stream every workflow event to the cloud as it happens. Each
 * `ExecutionEvent` is mapped to one POST against `/api/report/stream`,
 * letting the dashboard's `LiveRunViewer` light up the DAG in real time
 * via Supabase Realtime.
 *
 * Auth: OIDC if available, project token otherwise. Returns null when
 * neither is configured — the executor will run with no cloud observer.
 *
 * Failure is silent. Reporting must never block a workflow.
 */
export async function createCloudStreamObserver(opts: ObserverOptions): Promise<Observer | null> {
  const cloudUrl = process.env.SWENY_CLOUD_URL || CLOUD_URL_DEFAULT;
  const authHeader = await resolveAuthHeader(cloudUrl, opts.config.cloudToken);
  if (!authHeader) return null;

  const repo = opts.config.repository || process.env.GITHUB_REPOSITORY || "";
  const [owner, name] = repo.split("/");

  let runId: string | null = null;
  const nodeTimings = new Map<string, NodeTiming>();
  // Serialize POSTs so node events fire after the start response carries run_id.
  let chain: Promise<void> = Promise.resolve();

  const post = (body: Record<string, unknown>): Promise<Response | null> =>
    fetch(`${cloudUrl}/api/report/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null);

  return (event: ExecutionEvent) => {
    chain = chain.then(async () => {
      try {
        switch (event.type) {
          case "workflow:start": {
            const res = await post({
              event: "start",
              owner: owner || undefined,
              repo: name || undefined,
              workflow: opts.workflow,
              trigger: process.env.GITHUB_EVENT_NAME || "manual",
              branch: process.env.GITHUB_REF_NAME || undefined,
              commit_sha: process.env.GITHUB_SHA || undefined,
              runner_os: process.env.RUNNER_OS || undefined,
            });
            if (res?.ok) {
              const data = (await res.json().catch(() => ({}))) as {
                run_id?: string;
              };
              runId = data.run_id ?? null;
              if (runId) {
                console.log(c.subtle(`  cloud: streaming live → ${cloudUrl}`));
              }
            }
            return;
          }

          case "node:enter": {
            if (!runId) return;
            nodeTimings.set(event.node, { startedAt: Date.now() });
            await post({
              event: "node",
              run_id: runId,
              node_id: event.node,
              name: event.node,
              status: "running",
            });
            return;
          }

          case "node:exit": {
            if (!runId) return;
            await post({
              event: "node",
              run_id: runId,
              node_id: event.node,
              name: event.node,
              status: mapNodeStatus(event.result.status),
            });
            return;
          }

          case "workflow:end": {
            if (!runId) return;
            const nodes = [...Object.entries(event.results)].map(([id, result]) => {
              const timing = nodeTimings.get(id);
              return {
                id,
                name: id,
                status: mapNodeStatusFinal(result.status),
                durationMs: timing ? Date.now() - timing.startedAt : undefined,
              };
            });

            const investigateData = event.results["investigate"]?.data as Record<string, unknown> | undefined;
            const createPrData = event.results["create_pr"]?.data as Record<string, unknown> | undefined;
            const createIssueData = (event.results["create_issue"]?.data ?? event.results["create-issue"]?.data) as
              | Record<string, unknown>
              | undefined;
            const findings = (investigateData?.findings as unknown[]) ?? [];
            const hasFailed = Object.values(event.results).some((r: NodeResult) => r.status === "failed");

            await post({
              event: "complete",
              run_id: runId,
              status: hasFailed ? "failed" : "completed",
              duration_ms: Date.now() - opts.startedAt,
              issues_found: findings.length > 0,
              recommendation: investigateData?.recommendation as "implement" | "skip" | "escalate" | undefined,
              issue_url: (createIssueData?.issueUrl ?? createPrData?.issueUrl) as string | undefined,
              pr_url: createPrData?.prUrl as string | undefined,
              issue_identifier: (createIssueData?.issueIdentifier ?? createPrData?.issueIdentifier) as
                | string
                | undefined,
              pr_number: createPrData?.prNumber as number | undefined,
              nodes,
            });
            return;
          }

          // tool:call, tool:result, route, sources:resolved, node:progress
          // are not yet mapped to cloud events. They stream to stdout via
          // the NDJSON observer for local consumers (Studio CLI, AFK, etc).
          default:
            return;
        }
      } catch {
        // Never block the workflow on a reporting failure.
      }
    });
  };
}

function mapNodeStatus(status: NodeResult["status"]): "running" | "success" | "failed" | "skipped" {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
  }
}

function mapNodeStatusFinal(status: NodeResult["status"]): "success" | "failed" | "skipped" {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
  }
}

async function resolveAuthHeader(cloudUrl: string, cloudToken: string | undefined): Promise<string | null> {
  if (hasGitHubOidc()) {
    try {
      const jwt = await mintGitHubOidcToken({ audience: cloudUrl });
      return `Bearer ${jwt}`;
    } catch {
      // fall through to project token
    }
  }
  if (cloudToken) return `Bearer ${cloudToken}`;
  return null;
}
