import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools } from "../tools.js";

/**
 * Integration test: creates a real MCP server + in-memory client,
 * verifies tool registration and end-to-end tool invocation.
 */
describe("MCP server integration", () => {
  async function createTestClient() {
    const server = new McpServer({ name: "sweny-test", version: "0.0.0" });
    registerTools(server);

    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return { client, server };
  }

  it("registers both tools", async () => {
    const { client } = await createTestClient();
    const { tools } = await client.listTools();

    const names = tools.map((t) => t.name);
    expect(names).toContain("sweny_list_workflows");
    expect(names).toContain("sweny_run_workflow");
    expect(tools).toHaveLength(2);
  });

  it("sweny_list_workflows has correct schema", async () => {
    const { client } = await createTestClient();
    const { tools } = await client.listTools();

    const listTool = tools.find((t) => t.name === "sweny_list_workflows")!;
    expect(listTool.description).toContain("List available SWEny workflows");
    expect(listTool.inputSchema.properties).toHaveProperty("cwd");
  });

  it("sweny_run_workflow has correct schema", async () => {
    const { client } = await createTestClient();
    const { tools } = await client.listTools();

    const runTool = tools.find((t) => t.name === "sweny_run_workflow")!;
    expect(runTool.description).toContain("Execute a SWEny workflow");

    const props = runTool.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props).toHaveProperty("workflow");
    expect(props).toHaveProperty("input");
    expect(props).toHaveProperty("cwd");
    expect(props).toHaveProperty("dryRun");
    expect(props.workflow.enum).toEqual(["triage", "implement"]);
  });

  it("sweny_run_workflow returns error for implement without input", async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({
      name: "sweny_run_workflow",
      arguments: { workflow: "implement" },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("implement workflow requires an issue ID");
  });

  it("sweny_list_workflows returns built-in workflows via MCP call", async () => {
    const { client } = await createTestClient();
    const result = await client.callTool({ name: "sweny_list_workflows", arguments: {} });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);

    const text = content[0].text;
    const workflows = JSON.parse(text);

    expect(Array.isArray(workflows)).toBe(true);
    const ids = workflows.map((w: { id: string }) => w.id);
    expect(ids).toContain("triage");
    expect(ids).toContain("implement");

    for (const wf of workflows) {
      expect(wf).toHaveProperty("id");
      expect(wf).toHaveProperty("name");
      expect(wf).toHaveProperty("description");
      expect(wf).toHaveProperty("nodeCount");
      expect(wf).toHaveProperty("source");
      expect(typeof wf.nodeCount).toBe("number");
      expect(wf.nodeCount).toBeGreaterThan(0);
    }
  });
});
