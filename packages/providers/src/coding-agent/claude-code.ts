import type { CodingAgent, CodingAgentRunOptions } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { execCommand, isCliInstalled } from "./shared.js";

export interface ClaudeCodeConfig {
  cliFlags?: string[];
  logger?: Logger;
}

export function claudeCode(config?: ClaudeCodeConfig): CodingAgent {
  const log = config?.logger ?? consoleLogger;
  const extraFlags = config?.cliFlags ?? [];

  return {
    async install(): Promise<void> {
      if (isCliInstalled("claude")) {
        log.info("Claude Code CLI already installed, skipping");
        return;
      }
      log.info("Installing Claude Code CLI...");
      await execCommand("npm", ["install", "-g", "@anthropic-ai/claude-code"]);
      log.info("Claude Code CLI installed");
    },

    async run(opts: CodingAgentRunOptions): Promise<number> {
      log.info("Running Claude Code agent...");

      const args = [
        "-p",
        opts.prompt,
        "--allowedTools",
        "*",
        "--dangerously-skip-permissions",
        "--max-turns",
        String(opts.maxTurns),
        ...extraFlags,
      ];

      return execCommand("claude", args, {
        env: { ...process.env, ...opts.env } as Record<string, string>,
        ignoreReturnCode: true,
      });
    },
  };
}
