import * as core from "@actions/core";
import type { ExecutionEvent } from "@sweny-ai/core";

interface CloudStreamConfig {
  cloudUrl: string;
  projectToken?: string;
  installationId?: string;
  owner: string;
  repo: string;
}

/**
 * Creates a cloud streaming reporter that sends execution events to the
 * SWEny Cloud dashboard for live DAG visualization.
 *
 * Events are fire-and-forget — failures never block workflow execution.
 */
export function createCloudStreamReporter(config: CloudStreamConfig) {
  let runId: string | null = null;
  const pending: Promise<void>[] = [];

  function getAuthHeaders(): Record<string, string> {
    if (config.projectToken) return { Authorization: `Bearer ${config.projectToken}` };
    if (config.installationId) return { "X-GitHub-Installation-Id": config.installationId };
    return {};
  }

  async function send(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${config.cloudUrl}/api/report/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  function enqueue(fn: () => Promise<void>): void {
    const p = fn().catch(() => {});
    pending.push(p);
  }

  return {
    onEvent(event: ExecutionEvent): void {
      switch (event.type) {
        case "workflow:start": {
          // Start is special — we need the run_id before proceeding
          enqueue(async () => {
            const data = await send({
              event: "start",
              owner: config.owner,
              repo: config.repo,
              workflow: event.workflow,
              trigger: process.env.GITHUB_EVENT_NAME,
              branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME,
              commit_sha: process.env.GITHUB_SHA,
              action_version: "4",
              runner_os: process.env.RUNNER_OS,
            });
            if (data?.run_id) {
              runId = data.run_id as string;
              core.info(`☁ Live DAG: streaming to cloud (run ${runId})`);
            }
          });
          break;
        }

        case "node:enter": {
          enqueue(async () => {
            if (!runId) return;
            await send({
              event: "node",
              run_id: runId,
              node_id: event.node,
              name: event.node,
              status: "running",
            });
          });
          break;
        }

        case "node:exit": {
          enqueue(async () => {
            if (!runId) return;
            await send({
              event: "node",
              run_id: runId,
              node_id: event.node,
              name: event.node,
              status: event.result.status,
            });
          });
          break;
        }
      }
    },

    getRunId(): string | null {
      return runId;
    },

    /** Wait for all pending events to flush */
    async flush(): Promise<void> {
      await Promise.allSettled(pending);
    },
  };
}
