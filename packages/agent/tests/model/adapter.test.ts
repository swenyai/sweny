import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { AgentTool } from "@sweny-ai/providers/agent-tool";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: vi.fn((name: string, desc: string, schema: unknown, exec: unknown) => ({
    name,
    description: desc,
    schema,
    execute: exec,
  })),
}));

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { toSdkTool, toSdkTools } from "../../src/model/adapter.js";

function fakeAgentTool(name: string): AgentTool {
  return {
    name,
    description: `${name} description`,
    schema: { input: z.string() },
    execute: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
  };
}

describe("toSdkTool", () => {
  it("passes all 4 fields to SDK tool()", () => {
    const agentTool = fakeAgentTool("my-tool");

    toSdkTool(agentTool);

    expect(tool).toHaveBeenCalledWith(agentTool.name, agentTool.description, agentTool.schema, agentTool.execute);
  });

  it("returns a valid SDK tool object", () => {
    const agentTool = fakeAgentTool("sdk-tool");

    const sdkTool = toSdkTool(agentTool);

    expect(sdkTool).toHaveProperty("name", "sdk-tool");
    expect(sdkTool).toHaveProperty("description", "sdk-tool description");
    expect(sdkTool).toHaveProperty("schema");
    expect(sdkTool).toHaveProperty("execute");
  });
});

describe("toSdkTools", () => {
  it("converts empty array", () => {
    const result = toSdkTools([]);

    expect(result).toEqual([]);
  });

  it("converts multiple tools", () => {
    const tools = [fakeAgentTool("a"), fakeAgentTool("b"), fakeAgentTool("c")];

    const result = toSdkTools(tools);

    expect(result).toHaveLength(3);
  });

  it("preserves order", () => {
    const tools = [fakeAgentTool("first"), fakeAgentTool("second"), fakeAgentTool("third")];

    const result = toSdkTools(tools);

    expect(result[0]).toHaveProperty("name", "first");
    expect(result[1]).toHaveProperty("name", "second");
    expect(result[2]).toHaveProperty("name", "third");
  });
});
