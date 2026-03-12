import { describe, it, expect, vi, beforeEach } from "vitest";
import { claudeCode } from "../src/coding-agent/claude-code.js";
import type { CodingAgent } from "../src/coding-agent/types.js";
import { execCommand, isCliInstalled, writeMcpConfig } from "../src/coding-agent/shared.js";

// vi.hoisted ensures this runs before vi.mock factories (which are hoisted to top of file)
const mockMcpCleanup = vi.hoisted(() => vi.fn());

// Mock the shared module that contains execCommand, isCliInstalled, and writeMcpConfig
vi.mock("../src/coding-agent/shared.js", () => ({
  execCommand: vi.fn().mockResolvedValue(0),
  spawnLines: vi.fn().mockResolvedValue(0),
  isCliInstalled: vi.fn().mockReturnValue(false),
  writeMcpConfig: vi.fn().mockReturnValue({ path: "/tmp/sweny-mcp-test.json", cleanup: mockMcpCleanup }),
}));

describe("claudeCode coding agent", () => {
  let agent: CodingAgent;
  let mockExecCommand: ReturnType<typeof vi.fn>;
  let mockIsCliInstalled: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpCleanup.mockReset();
    // Get the mocked functions from the module
    mockExecCommand = vi.mocked(execCommand);
    mockIsCliInstalled = vi.mocked(isCliInstalled);
    agent = claudeCode();
  });

  describe("factory", () => {
    it("returns an object implementing CodingAgent", () => {
      expect(typeof agent.install).toBe("function");
      expect(typeof agent.run).toBe("function");
    });
  });

  describe("install", () => {
    it("installs claude-code CLI via npm", async () => {
      mockIsCliInstalled.mockReturnValue(false);
      await agent.install();

      expect(mockExecCommand).toHaveBeenCalledWith(
        "npm",
        ["install", "-g", "@anthropic-ai/claude-code"],
        expect.any(Object),
      );
    });
  });

  describe("run", () => {
    it("executes claude with prompt and max turns", async () => {
      const exitCode = await agent.run({
        prompt: "Fix the bug",
        maxTurns: 10,
      });

      expect(exitCode).toBe(0);
      expect(mockExecCommand).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining(["-p", "Fix the bug", "--max-turns", "10"]),
        expect.objectContaining({
          ignoreReturnCode: true,
        }),
      );
    });

    it("passes environment variables", async () => {
      await agent.run({
        prompt: "Test",
        maxTurns: 5,
        env: { MY_KEY: "my-value" },
      });

      const callArgs = mockExecCommand.mock.calls[0];
      expect(callArgs[2].env).toEqual(expect.objectContaining({ MY_KEY: "my-value" }));
    });

    it("includes default CLI flags", async () => {
      await agent.run({ prompt: "Test", maxTurns: 5 });

      const args = mockExecCommand.mock.calls[0][1];
      expect(args).toContain("--allowedTools");
      expect(args).toContain("*");
      expect(args).toContain("--dangerously-skip-permissions");
    });

    it("appends custom CLI flags from config", async () => {
      const customAgent = claudeCode({ cliFlags: ["--verbose"] });
      await customAgent.run({ prompt: "Test", maxTurns: 5 });

      const args = mockExecCommand.mock.calls[0][1];
      expect(args).toContain("--verbose");
    });

    it("returns exit code from exec", async () => {
      mockExecCommand.mockResolvedValueOnce(1);

      const exitCode = await agent.run({ prompt: "Fail", maxTurns: 1 });
      expect(exitCode).toBe(1);
    });

    it("passes --mcp-config when mcpServers provided", async () => {
      await agent.run({
        prompt: "Test",
        maxTurns: 5,
        mcpServers: {
          datadog: { type: "http", url: "https://mcp.datadoghq.com/mcp", headers: { DD_API_KEY: "key" } },
        },
      });

      expect(vi.mocked(writeMcpConfig)).toHaveBeenCalledOnce();
      const args = mockExecCommand.mock.calls[0][1] as string[];
      expect(args).toContain("--mcp-config");
      expect(args[args.indexOf("--mcp-config") + 1]).toBe("/tmp/sweny-mcp-test.json");
    });

    it("calls cleanup after run completes", async () => {
      await agent.run({
        prompt: "Test",
        maxTurns: 5,
        mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
      });

      expect(mockMcpCleanup).toHaveBeenCalledOnce();
    });

    it("calls cleanup even when exec throws", async () => {
      mockExecCommand.mockRejectedValueOnce(new Error("agent crashed"));

      await expect(
        agent.run({
          prompt: "Test",
          maxTurns: 5,
          mcpServers: { linear: { type: "http", url: "https://mcp.linear.app/mcp" } },
        }),
      ).rejects.toThrow("agent crashed");

      expect(mockMcpCleanup).toHaveBeenCalledOnce();
    });

    it("skips --mcp-config when mcpServers is empty", async () => {
      await agent.run({ prompt: "Test", maxTurns: 5, mcpServers: {} });

      expect(vi.mocked(writeMcpConfig)).not.toHaveBeenCalled();
      const args = mockExecCommand.mock.calls[0][1] as string[];
      expect(args).not.toContain("--mcp-config");
    });

    it("skips --mcp-config when mcpServers is omitted", async () => {
      await agent.run({ prompt: "Test", maxTurns: 5 });

      expect(vi.mocked(writeMcpConfig)).not.toHaveBeenCalled();
      const args = mockExecCommand.mock.calls[0][1] as string[];
      expect(args).not.toContain("--mcp-config");
    });
  });
});
