import { describe, it, expect } from "vitest";
import { z } from "zod";
import { agentTool } from "../src/agent-tool/factory.js";
import type { AgentTool, ToolResult } from "../src/agent-tool/types.js";

describe("agentTool factory", () => {
  it("creates an AgentTool with name, description, schema, and execute", () => {
    const tool = agentTool(
      "test_tool",
      "A test tool",
      { input: z.string() },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    expect(tool.name).toBe("test_tool");
    expect(tool.description).toBe("A test tool");
    expect(tool.schema).toHaveProperty("input");
    expect(typeof tool.execute).toBe("function");
  });

  it("executes the handler and returns ToolResult", async () => {
    const tool = agentTool(
      "echo",
      "Echoes input",
      { text: z.string() },
      async (args) => ({
        content: [{ type: "text" as const, text: `Echo: ${args.text}` }],
      }),
    );

    const result = await tool.execute({ text: "hello" });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe("Echo: hello");
    expect(result.isError).toBeUndefined();
  });

  it("supports isError in ToolResult", async () => {
    const tool = agentTool(
      "fail",
      "Always fails",
      {},
      async () => ({
        content: [{ type: "text" as const, text: "Something went wrong" }],
        isError: true,
      }),
    );

    const result = await tool.execute({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Something went wrong");
  });

  it("works with empty schema", () => {
    const tool = agentTool(
      "no_args",
      "Takes no arguments",
      {},
      async () => ({ content: [{ type: "text", text: "done" }] }),
    );

    expect(tool.schema).toEqual({});
  });

  it("works with complex schema", () => {
    const tool = agentTool(
      "complex",
      "Complex tool",
      {
        name: z.string().describe("User name"),
        age: z.number().optional().describe("User age"),
        tags: z.array(z.string()).default([]),
      },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );

    expect(tool.schema).toHaveProperty("name");
    expect(tool.schema).toHaveProperty("age");
    expect(tool.schema).toHaveProperty("tags");
  });

  it("satisfies the AgentTool interface", () => {
    const tool: AgentTool = agentTool(
      "typed",
      "Typed tool",
      { value: z.string() },
      async (args) => ({
        content: [{ type: "text" as const, text: String(args.value) }],
      }),
    );

    // Type assertion passes at compile time
    expect(tool).toBeDefined();
  });

  it("handler receives Record<string, unknown> args", async () => {
    let receivedArgs: Record<string, unknown> = {};

    const tool = agentTool(
      "capture",
      "Captures args",
      { a: z.string(), b: z.number() },
      async (args) => {
        receivedArgs = args;
        return { content: [{ type: "text", text: "ok" }] };
      },
    );

    await tool.execute({ a: "hello", b: 42 });

    expect(receivedArgs).toEqual({ a: "hello", b: 42 });
  });
});
