#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
const _require = createRequire(import.meta.url);
const { version } = _require("../package.json");
async function main() {
    const server = new McpServer({
        name: "sweny",
        version,
    });
    registerTools(server);
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch(console.error);
