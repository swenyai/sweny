import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listWorkflows } from "./handlers/list-workflows.js";

export function registerTools(server: McpServer): void {
  server.tool(
    "sweny_list_workflows",
    "List available SWEny workflows in the current project. Returns built-in workflows (triage, implement, seed-content) and any custom workflows from .sweny/workflows/.",
    {
      cwd: z.string().optional().describe("Working directory to search for workflows. Defaults to process.cwd()."),
    },
    async ({ cwd }) => {
      const results = await listWorkflows(cwd ?? process.cwd());
      return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
    },
  );
}
