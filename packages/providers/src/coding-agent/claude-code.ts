import type { CodingAgent, CodingAgentRunOptions } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { execCommand, isCliInstalled } from "./shared.js";

export interface ClaudeCodeConfig {
  cliFlags?: string[];
  logger?: Logger;
  /** Suppress agent stdout; forward stderr through logger */
  quiet?: boolean;
}

export function claudeCode(config?: ClaudeCodeConfig): CodingAgent {
  const log = config?.logger ?? consoleLogger;
  const extraFlags = config?.cliFlags ?? [];
  const quiet = config?.quiet ?? false;

  return {
    async install(): Promise<void> {
      if (isCliInstalled("claude")) {
        log.info("Claude Code CLI already installed, skipping");
        return;
      }
      log.info("Installing Claude Code CLI...");
      await execCommand("npm", ["install", "-g", "@anthropic-ai/claude-code"], { quiet });
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

      return await execCommand("claude", args, {
        env: { ...process.env, ...opts.env } as Record<string, string>,
        ignoreReturnCode: true,
        quiet,
        onStderr: quiet ? (line) => log.debug(line) : undefined,
      });
    },
  };
}
