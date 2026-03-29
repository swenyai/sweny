import * as core from "@actions/core";
/**
 * Creates a cloud streaming reporter that sends execution events to the
 * SWEny Cloud dashboard for live DAG visualization.
 *
 * Events are fire-and-forget — failures never block workflow execution.
 */
export function createCloudStreamReporter(config) {
    let runId = null;
    const pending = [];
    function getAuthHeaders() {
        if (config.projectToken)
            return { Authorization: `Bearer ${config.projectToken}` };
        if (config.installationId)
            return { "X-GitHub-Installation-Id": config.installationId };
        return {};
    }
    async function send(body) {
        try {
            const res = await fetch(`${config.cloudUrl}/api/report/stream`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                body: JSON.stringify(body),
            });
            return res.ok ? (await res.json()) : null;
        }
        catch {
            return null;
        }
    }
    function enqueue(fn) {
        const p = fn().catch(() => { });
        pending.push(p);
    }
    return {
        onEvent(event) {
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
                            runId = data.run_id;
                            core.info(`☁ Live DAG: streaming to cloud (run ${runId})`);
                        }
                    });
                    break;
                }
                case "node:enter": {
                    enqueue(async () => {
                        if (!runId)
                            return;
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
                        if (!runId)
                            return;
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
        getRunId() {
            return runId;
        },
        /** Wait for all pending events to flush */
        async flush() {
            await Promise.allSettled(pending);
        },
    };
}
//# sourceMappingURL=cloud-stream.js.map