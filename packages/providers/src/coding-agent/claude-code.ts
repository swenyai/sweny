import { spawn } from "node:child_process";
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

  function execCommand(
    cmd: string,
    args: string[],
    opts?: { env?: Record<string, string>; ignoreReturnCode?: boolean },
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        env: opts?.env ?? process.env,
        stdio: ["ignore", "inherit", "inherit"],
      });

      child.on("error", (err) => reject(err));
      child.on("close", (code) => {
        if (code !== 0 && !opts?.ignoreReturnCode) {
          reject(new Error(`${cmd} exited with code ${code}`));
        } else {
          resolve(code ?? 0);
        }
      });
    });
  }

  return {
    async install(): Promise<void> {
      log.info("Installing Claude Code CLI...");
      await execCommand("npm", ["install", "-g", "@anthropic-ai/claude-code"]);
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

      return execCommand("claude", args, {
        env: { ...process.env, ...opts.env } as Record<string, string>,
        ignoreReturnCode: true,
      });
    },
  };
}
