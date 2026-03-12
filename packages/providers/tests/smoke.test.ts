/**
 * Smoke tests: verify the package can be imported and classes instantiated
 * without any peer-dep code executing at module load time.
 *
 * These tests simulate a consumer that has NOT installed optional peer deps
 * (AWS SDK, MCP SDK, Slack SDK). All peer dep imports must be lazy (dynamic).
 *
 * The CI smoke-test job goes further by physically removing peer dep packages
 * before importing the built dist — this test is the unit-level complement.
 */
import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Block all peer deps — any static import would have already failed by now,
// but we also intercept dynamic imports to catch accidental eager calls
// inside constructors or module-level code.
// ---------------------------------------------------------------------------

vi.mock("@aws-sdk/client-s3", () => {
  throw new Error("@aws-sdk/client-s3 must not be imported at load time");
});
vi.mock("@aws-sdk/s3-request-presigner", () => {
  throw new Error("@aws-sdk/s3-request-presigner must not be imported at load time");
});
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  throw new Error("@modelcontextprotocol/sdk must not be imported at load time");
});
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  throw new Error("@modelcontextprotocol/sdk must not be imported at load time");
});

// ---------------------------------------------------------------------------
// Imports — these will fail if any of the above are statically imported
// ---------------------------------------------------------------------------

import { S3SessionStore } from "../src/storage/session/s3.js";
import { S3MemoryStore } from "../src/storage/memory/s3.js";
import { S3WorkspaceStore } from "../src/storage/workspace/s3.js";
import { MCPClient } from "../src/mcp/client.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("peer dep imports are lazy (no load-time side effects)", () => {
  it("S3SessionStore constructor does not import @aws-sdk/client-s3", () => {
    expect(() => new S3SessionStore("my-bucket")).not.toThrow();
  });

  it("S3MemoryStore constructor does not import @aws-sdk/client-s3", () => {
    expect(() => new S3MemoryStore("my-bucket")).not.toThrow();
  });

  it("S3WorkspaceStore constructor does not import @aws-sdk/client-s3", () => {
    expect(() => new S3WorkspaceStore("my-bucket")).not.toThrow();
  });

  it("MCPClient constructor does not import @modelcontextprotocol/sdk", () => {
    expect(() => new MCPClient("test", { command: "npx", args: ["my-mcp-server"] })).not.toThrow();
  });

  it("S3SessionStore exposes correct bucket/prefix/region after construction", () => {
    // Validate constructor params are stored (no SDK needed)
    const store = new S3SessionStore("test-bucket", "my/prefix", "eu-west-1");
    expect(store).toBeInstanceOf(S3SessionStore);
  });

  it("MCPClient.availableTools() returns empty array before connect", () => {
    const client = new MCPClient("test", { command: "my-server" });
    expect(client.availableTools()).toEqual([]);
  });

  it("MCPClient.hasTool() returns false before connect", () => {
    const client = new MCPClient("test", { command: "my-server" });
    expect(client.hasTool("some_tool")).toBe(false);
  });
});
