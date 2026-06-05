#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { terminateActiveWorkflows } from "./handlers/run-workflow.js";

const _require = createRequire(import.meta.url);
const { version } = _require("../package.json") as { version: string };

async function main() {
  const server = new McpServer({
    name: "sweny",
    version,
  });

  registerTools(server);

  // Deterministic shutdown. Otherwise the process relies on the event loop
  // happening to drain after stdin closes, and a client that exits or is killed
  // mid-run leaves this server (and any in-flight `sweny` workflow subprocess)
  // orphaned. We make shutdown explicit and idempotent, and always terminate
  // active workflow children first so nothing keeps running past the client.
  let shuttingDown = false;
  const shutdown = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    terminateActiveWorkflows();
    try {
      await server.close();
    } catch {
      // Already closing/closed — fall through to exit.
    }
    process.exit(code);
  };

  // Transport close fires on stdin EOF, i.e. when the client disconnects or is
  // force-killed and the stdio pipe breaks. This is the primary exit signal for
  // a stdio MCP server.
  server.server.onclose = () => void shutdown(0);
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
