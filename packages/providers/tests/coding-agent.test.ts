import { describe, it, expect, vi, beforeEach } from "vitest";
import { claudeCode } from "../src/coding-agent/claude-code.js";
import type { CodingAgent } from "../src/coding-agent/types.js";

// Mock @actions/exec — lazy-loaded by claudeCode
vi.mock("@actions/exec", () => ({
  exec: vi.fn().mockResolvedValue(0),
}));

describe("claudeCode coding agent", () => {
  let agent: CodingAgent;
  let mockExec: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const actionsExec = await import("@actions/exec");
    mockExec = vi.mocked(actionsExec.exec);
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
      await agent.install();

      expect(mockExec).toHaveBeenCalledWith(
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
      expect(mockExec).toHaveBeenCalledWith(
        "claude",
        expect.arrayContaining([
          "-p",
          "Fix the bug",
          "--max-turns",
          "10",
        ]),
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

      const callArgs = mockExec.mock.calls[0];
      expect(callArgs[2].env).toEqual(
        expect.objectContaining({ MY_KEY: "my-value" }),
      );
    });

    it("includes default CLI flags", async () => {
      await agent.run({ prompt: "Test", maxTurns: 5 });

      const args = mockExec.mock.calls[0][1];
      expect(args).toContain("--allowedTools");
      expect(args).toContain("*");
      expect(args).toContain("--dangerously-skip-permissions");
    });

    it("appends custom CLI flags from config", async () => {
      const customAgent = claudeCode({ cliFlags: ["--verbose"] });
      await customAgent.run({ prompt: "Test", maxTurns: 5 });

      const args = mockExec.mock.calls[0][1];
      expect(args).toContain("--verbose");
    });

    it("returns exit code from exec", async () => {
      mockExec.mockResolvedValueOnce(1);

      const exitCode = await agent.run({ prompt: "Fail", maxTurns: 1 });
      expect(exitCode).toBe(1);
    });
  });
});
