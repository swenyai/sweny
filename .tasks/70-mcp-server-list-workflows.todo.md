# MCP server core + `sweny_list_workflows` tool

**Package:** `packages/mcp`
**Depends on:** Task 69 (scaffold)

## Goal

Create a working MCP server over stdio with the first tool: `sweny_list_workflows`. This proves the server framework works end-to-end before adding the more complex `run_workflow` tool.

## Background

The MCP SDK (`@modelcontextprotocol/sdk`) provides:
- `McpServer` — registers tools/resources/prompts
- `StdioServerTransport` — reads JSON-RPC from stdin, writes to stdout

Claude Desktop and Claude Code both connect to MCP servers via stdio. The server must:
1. Create an `McpServer` instance
2. Register tools with `.tool(name, description, schema, handler)`
3. Connect via `StdioServerTransport`

## What to implement

### `packages/mcp/src/index.ts`

Replace the placeholder with a real MCP server:

```ts
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

async function main() {
  const server = new McpServer({
    name: "sweny",
    version: "0.1.0",
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
```

### `packages/mcp/src/tools.ts`

Create this file with the tool registration function and the first tool:

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listWorkflows } from "./handlers/list-workflows.js";

export function registerTools(server: McpServer): void {
  server.tool(
    "sweny_list_workflows",
    "List available SWEny workflows in the current project. Returns built-in workflows (triage, implement) and any custom workflows defined in .sweny.yml or .sweny/workflows/.",
    { cwd: z.string().optional().describe("Working directory to search for workflows. Defaults to process.cwd().") },
    async ({ cwd }) => {
      const results = await listWorkflows(cwd ?? process.cwd());
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );
}
```

### `packages/mcp/src/handlers/list-workflows.ts`

This handler should:

1. **List built-in workflows** — import `triageWorkflow` and `implementWorkflow` from `@sweny-ai/core/workflows` and return their id, name, description, and node count.
2. **Find custom workflows** — look for `.sweny.yml` config file in `cwd`. If it has a `workflows` key pointing to YAML files, parse them with `parseWorkflow` from `@sweny-ai/core/schema`. Also scan `.sweny/workflows/*.yml` for workflow files.
3. **Return a structured list:**

```ts
interface WorkflowInfo {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  source: "builtin" | "custom";
}
```

Key imports from `@sweny-ai/core`:
- `import { triageWorkflow, implementWorkflow } from "@sweny-ai/core/workflows"` — built-in workflow objects
- `import { parseWorkflow } from "@sweny-ai/core/schema"` — parse YAML string → Workflow object

Use `fs.readFile` + `parseWorkflow` for custom workflows. Wrap in try/catch — invalid YAML should be noted in the response, not crash the server.

## Verification

```bash
cd packages/mcp
npm run typecheck
npm run build
# Smoke test — the server should start and respond to MCP initialize:
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | node dist/index.js
```

## Acceptance criteria

- [ ] `packages/mcp/src/index.ts` creates an MCP server with stdio transport
- [ ] `sweny_list_workflows` tool is registered and returns built-in + custom workflows
- [ ] Server starts without errors when invoked via `node dist/index.js`
- [ ] Typecheck passes
