/**
 * Tests for writeMcpConfig() — the helper that serializes mcpServers to a
 * temp JSON file for passing to agent CLIs via --mcp-config.
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { writeMcpConfig } from "../src/coding-agent/shared.js";

const filesToCleanup: string[] = [];

afterEach(() => {
  for (const f of filesToCleanup.splice(0)) {
    try {
      unlinkSync(f);
    } catch {
      // already cleaned up
    }
  }
});

describe("writeMcpConfig", () => {
  it("writes a valid JSON file to tmp dir", () => {
    const { path, cleanup } = writeMcpConfig({
      datadog: { type: "http", url: "https://mcp.datadoghq.com/mcp", headers: { DD_API_KEY: "key" } },
    });
    filesToCleanup.push(path);

    expect(existsSync(path)).toBe(true);
    const json = JSON.parse(readFileSync(path, "utf8")) as unknown;
    expect(json).toMatchObject({ mcpServers: { datadog: { type: "http" } } });
    cleanup();
  });

  it("serializes HTTP server with url and headers", () => {
    const { path, cleanup } = writeMcpConfig({
      linear: {
        type: "http",
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: "Bearer tok" },
      },
    });
    filesToCleanup.push(path);

    const { mcpServers } = JSON.parse(readFileSync(path, "utf8")) as { mcpServers: Record<string, unknown> };
    expect(mcpServers["linear"]).toEqual({
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: "Bearer tok" },
    });
    cleanup();
  });

  it("serializes stdio server with command, args, env", () => {
    const { path, cleanup } = writeMcpConfig({
      github: {
        type: "stdio",
        command: "/usr/local/bin/github-mcp",
        args: ["--port", "3000"],
        env: { GITHUB_TOKEN: "ghp_tok" },
      },
    });
    filesToCleanup.push(path);

    const { mcpServers } = JSON.parse(readFileSync(path, "utf8")) as { mcpServers: Record<string, unknown> };
    expect(mcpServers["github"]).toEqual({
      type: "stdio",
      command: "/usr/local/bin/github-mcp",
      args: ["--port", "3000"],
      env: { GITHUB_TOKEN: "ghp_tok" },
    });
    cleanup();
  });

  it("infers type=http when url set and type omitted", () => {
    const { path, cleanup } = writeMcpConfig({
      sentry: { url: "https://mcp.sentry.io/mcp" },
    });
    filesToCleanup.push(path);

    const { mcpServers } = JSON.parse(readFileSync(path, "utf8")) as { mcpServers: Record<string, unknown> };
    expect((mcpServers["sentry"] as Record<string, unknown>)["type"]).toBe("http");
    cleanup();
  });

  it("infers type=stdio when command set and type omitted", () => {
    const { path, cleanup } = writeMcpConfig({
      local: { command: "/usr/bin/my-mcp" },
    });
    filesToCleanup.push(path);

    const { mcpServers } = JSON.parse(readFileSync(path, "utf8")) as { mcpServers: Record<string, unknown> };
    expect((mcpServers["local"] as Record<string, unknown>)["type"]).toBe("stdio");
    cleanup();
  });

  it("defaults args and env to empty for stdio servers", () => {
    const { path, cleanup } = writeMcpConfig({
      minimal: { type: "stdio", command: "/bin/mcp" },
    });
    filesToCleanup.push(path);

    const { mcpServers } = JSON.parse(readFileSync(path, "utf8")) as { mcpServers: Record<string, unknown> };
    expect((mcpServers["minimal"] as Record<string, unknown>)["args"]).toEqual([]);
    expect((mcpServers["minimal"] as Record<string, unknown>)["env"]).toEqual({});
    cleanup();
  });

  it("defaults headers to empty for HTTP servers", () => {
    const { path, cleanup } = writeMcpConfig({
      noauth: { type: "http", url: "https://example.com/mcp" },
    });
    filesToCleanup.push(path);

    const { mcpServers } = JSON.parse(readFileSync(path, "utf8")) as { mcpServers: Record<string, unknown> };
    expect((mcpServers["noauth"] as Record<string, unknown>)["headers"]).toEqual({});
    cleanup();
  });

  it("serializes multiple servers", () => {
    const { path, cleanup } = writeMcpConfig({
      a: { type: "http", url: "https://a.example/mcp" },
      b: { type: "stdio", command: "/bin/b-mcp" },
    });
    filesToCleanup.push(path);

    const { mcpServers } = JSON.parse(readFileSync(path, "utf8")) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(mcpServers)).toEqual(["a", "b"]);
    cleanup();
  });

  it("cleanup() deletes the file", () => {
    const { path, cleanup } = writeMcpConfig({
      tmp: { type: "http", url: "https://tmp.example/mcp" },
    });
    expect(existsSync(path)).toBe(true);
    cleanup();
    expect(existsSync(path)).toBe(false);
  });

  it("cleanup() is idempotent — safe to call multiple times", () => {
    const { path, cleanup } = writeMcpConfig({
      tmp: { type: "http", url: "https://tmp.example/mcp" },
    });
    cleanup();
    expect(() => cleanup()).not.toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it("each call writes a distinct file (unique path per invocation)", () => {
    const a = writeMcpConfig({ s: { type: "http", url: "https://a.example/mcp" } });
    const b = writeMcpConfig({ s: { type: "http", url: "https://b.example/mcp" } });
    filesToCleanup.push(a.path, b.path);

    expect(a.path).not.toBe(b.path);
    a.cleanup();
    b.cleanup();
  });

  it("throws for stdio server missing command", () => {
    expect(() => writeMcpConfig({ bad: { type: "stdio" } })).toThrow(
      'MCP server "bad": stdio transport requires a command.',
    );
  });

  it("throws for HTTP server missing url", () => {
    expect(() => writeMcpConfig({ bad: { type: "http" } })).toThrow('MCP server "bad": HTTP transport requires a url.');
  });
});
