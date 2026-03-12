import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @modelcontextprotocol/sdk
// ---------------------------------------------------------------------------

const mockConnect = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();
const mockClose = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = mockConnect;
    listTools = mockListTools;
    callTool = mockCallTool;
    close = mockClose;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor(public opts: unknown) {}
  },
}));

import { MCPClient } from "../src/mcp/client.js";
import { ProviderError } from "../src/errors.js";

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockListTools.mockResolvedValue({ tools: [] });
  mockConnect.mockResolvedValue(undefined);
  mockClose.mockResolvedValue(undefined);
});

describe("MCPClient — connect", () => {
  it("connect() spawns a StdioClientTransport with the configured command", async () => {
    const client = new MCPClient("github", { command: "/usr/local/bin/github-mcp", args: ["--verbose"] });
    await client.connect();
    expect(mockConnect).toHaveBeenCalledOnce();
  });

  it("concurrent connect() calls share the same in-flight promise", async () => {
    const client = new MCPClient("github", { command: "my-server" });
    await Promise.all([client.connect(), client.connect(), client.connect()]);
    expect(mockConnect).toHaveBeenCalledOnce();
  });

  it("second connect() after success is a no-op", async () => {
    const client = new MCPClient("github", { command: "my-server" });
    await client.connect();
    await client.connect();
    expect(mockConnect).toHaveBeenCalledOnce();
  });

  it("connect() populates availableTools() from listTools response", async () => {
    mockListTools.mockResolvedValue({ tools: [{ name: "search_code" }, { name: "create_pr" }] });
    const client = new MCPClient("github", { command: "my-server" });
    await client.connect();
    expect(client.availableTools()).toEqual(["search_code", "create_pr"]);
  });

  it("throws ProviderError for HTTP transport (not supported in MCPClient)", async () => {
    const client = new MCPClient("datadog", { type: "http", url: "https://mcp.datadoghq.com" });
    await expect(client.connect()).rejects.toBeInstanceOf(ProviderError);
  });

  it("throws ProviderError when command is missing for stdio transport", async () => {
    const client = new MCPClient("bad", {});
    await expect(client.connect()).rejects.toBeInstanceOf(ProviderError);
  });

  it("clears connectPromise on failure so caller can retry", async () => {
    mockConnect.mockRejectedValueOnce(new Error("spawn failed")).mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({ tools: [] });

    const client = new MCPClient("flaky", { command: "my-server" });
    await expect(client.connect()).rejects.toThrow("spawn failed");
    // Second attempt should succeed
    await client.connect();
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });
});

describe("MCPClient — hasTool / availableTools", () => {
  it("hasTool returns false before connect", () => {
    const client = new MCPClient("test", { command: "my-server" });
    expect(client.hasTool("search_code")).toBe(false);
  });

  it("hasTool returns true for a tool returned by listTools", async () => {
    mockListTools.mockResolvedValue({ tools: [{ name: "search_code" }] });
    const client = new MCPClient("test", { command: "my-server" });
    await client.connect();
    expect(client.hasTool("search_code")).toBe(true);
    expect(client.hasTool("missing_tool")).toBe(false);
  });
});

describe("MCPClient — call", () => {
  it("auto-connects before calling if not yet connected", async () => {
    mockListTools.mockResolvedValue({ tools: [{ name: "search" }] });
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: '{"results":[]}' }] });

    const client = new MCPClient("test", { command: "my-server" });
    await client.call("search", { query: "foo" });
    expect(mockConnect).toHaveBeenCalledOnce();
    expect(mockCallTool).toHaveBeenCalledWith({ name: "search", arguments: { query: "foo" } });
  });

  it("parses JSON text content", async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: '{"count":42}' }] });
    const client = new MCPClient("test", { command: "my-server" });
    await client.connect();
    const result = await client.call<{ count: number }>("count_issues", {});
    expect(result).toEqual({ count: 42 });
  });

  it("returns raw string when text content is not valid JSON", async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "plain text result" }] });
    const client = new MCPClient("test", { command: "my-server" });
    await client.connect();
    const result = await client.call<string>("describe", {});
    expect(result).toBe("plain text result");
  });

  it("throws ProviderError when tool returns isError=true", async () => {
    mockCallTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "not found" }] });
    const client = new MCPClient("test", { command: "my-server" });
    await client.connect();
    await expect(client.call("bad_tool", {})).rejects.toBeInstanceOf(ProviderError);
  });

  it("returns content array when there is no text block", async () => {
    const binaryContent = [{ type: "image", data: "base64..." }];
    mockCallTool.mockResolvedValue({ content: binaryContent });
    const client = new MCPClient("test", { command: "my-server" });
    await client.connect();
    const result = await client.call("get_image", {});
    expect(result).toEqual(binaryContent);
  });
});

describe("MCPClient — disconnect", () => {
  it("calls client.close() and resets state", async () => {
    const client = new MCPClient("test", { command: "my-server" });
    await client.connect();
    await client.disconnect();
    expect(mockClose).toHaveBeenCalledOnce();
    // Should be able to reconnect after disconnect
    await client.connect();
    expect(mockConnect).toHaveBeenCalledTimes(2);
  });

  it("disconnect() is a no-op when not connected", async () => {
    const client = new MCPClient("test", { command: "my-server" });
    await expect(client.disconnect()).resolves.toBeUndefined();
    expect(mockClose).not.toHaveBeenCalled();
  });
});
