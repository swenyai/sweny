import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listWorkflows } from "./handlers/list-workflows.js";
import { runWorkflow } from "./handlers/run-workflow.js";

export function registerTools(server: McpServer): void {
  server.tool(
    "sweny_list_workflows",
    "List available SWEny workflows in the current project. Returns built-in workflows (triage, implement, seed-content) and any custom workflows from .sweny/workflows/. Note: only triage and implement are runnable via sweny_run_workflow.",
    {
      cwd: z.string().optional().describe("Working directory to search for workflows. Defaults to process.cwd()."),
    },
    async ({ cwd }) => {
      const results = await listWorkflows(cwd ?? process.cwd());
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    "sweny_run_workflow",
    "Execute a SWEny workflow. Triage discovers and investigates alerts, then creates issues/PRs. Implement takes an issue ID and writes a fix. Requires .sweny.yml config and credentials in env. Can take several minutes — progress updates are streamed as the workflow runs.",
    {
      workflow: z.enum(["triage", "implement"]).describe("Which workflow to run"),
      input: z
        .string()
        .optional()
        .describe(
          "For implement: issue ID or URL (required). For triage: not needed (discovers alerts automatically).",
        ),
      cwd: z.string().optional().describe("Working directory (must contain .sweny.yml). Defaults to process.cwd()."),
      dryRun: z
        .boolean()
        .optional()
        .describe("If true, run in dry-run mode — investigate but skip creating issues/PRs"),
    },
    async ({ workflow, input, cwd, dryRun }) => {
      const result = await runWorkflow({
        workflow,
        input,
        cwd,
        dryRun,
        onProgress: (event) => {
          let message: string | undefined;
          switch (event.type) {
            case "node:enter":
              message = `Starting: ${event.node}`;
              break;
            case "node:exit": {
              const status = (event.result as Record<string, unknown>)?.status ?? "unknown";
              message = `Done: ${event.node} (${status})`;
              break;
            }
            case "node:progress":
              message = String(event.message);
              break;
          }
          if (message) {
            server.sendLoggingMessage({ level: "info", data: message, logger: "sweny" });
          }
        },
      });
      return {
        content: [
          {
            type: "text" as const,
            text: result.success ? result.output : `Workflow failed:\n${result.error}\n\n${result.output}`,
          },
        ],
        isError: !result.success,
      };
    },
  );
}
