import type { CodingAgent, CodingAgentRunOptions } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";

export interface ClaudeCodeConfig {
  cliFlags?: string[];
  logger?: Logger;
}

export function claudeCode(config?: ClaudeCodeConfig): CodingAgent {
  const log = config?.logger ?? consoleLogger;
  const extraFlags = config?.cliFlags ?? [];

  // Lazy-load @actions/exec — optional peer dep, only available in GitHub Actions
  async function exec(
    cmd: string,
    args: string[],
    opts?: { env?: Record<string, string>; ignoreReturnCode?: boolean },
  ): Promise<number> {
    const actionsExec = await import("@actions/exec");
    return actionsExec.exec(cmd, args, {
      env: opts?.env,
      ignoreReturnCode: opts?.ignoreReturnCode,
    });
  }

  return {
    async install(): Promise<void> {
      log.info("Installing Claude Code CLI...");
      await exec("npm", ["install", "-g", "@anthropic-ai/claude-code"]);
      log.info("Claude Code CLI installed");
    },

    async run(opts: CodingAgentRunOptions): Promise<number> {
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

      return exec("claude", args, {
        env: { ...process.env, ...opts.env } as Record<string, string>,
        ignoreReturnCode: true,
      });
    },
  };
}
