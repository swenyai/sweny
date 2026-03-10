import { spawn } from "node:child_process";
import type { CodingAgent, CodingAgentRunOptions, AgentEventHandler } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { execCommand, isCliInstalled } from "./shared.js";

export interface OpenAICodexConfig {
  cliFlags?: string[];
  logger?: Logger;
  /** Suppress agent stdout; forward stderr through logger */
  quiet?: boolean;
  onEvent?: AgentEventHandler;
}

export function openaiCodex(config?: OpenAICodexConfig): CodingAgent {
  const log = config?.logger ?? consoleLogger;
  const extraFlags = config?.cliFlags ?? [];
  const quiet = config?.quiet ?? false;
  const onEvent = config?.onEvent;

  return {
    async install(): Promise<void> {
      if (isCliInstalled("codex")) {
        log.info("OpenAI Codex CLI already installed, skipping");
        return;
      }
      log.info("Installing OpenAI Codex CLI...");
      await execCommand("npm", ["install", "-g", "@openai/codex"], { quiet });
      log.info("OpenAI Codex CLI installed");
    },

    async run(opts: CodingAgentRunOptions): Promise<number> {
      log.info("Running OpenAI Codex agent...");

      const args = ["exec", "--full-auto", opts.prompt, ...extraFlags];

      if (onEvent) {
        return new Promise((resolve, reject) => {
          const child = spawn("codex", args, {
            env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
            stdio: ["ignore", "pipe", "pipe"],
          });
          let buf = "";
          child.stdout?.on("data", (chunk: Buffer) => {
            buf += chunk.toString();
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.trim()) continue;
              Promise.resolve(onEvent({ type: "text", text: line })).catch(() => {});
            }
          });
          child.on("error", reject);
          child.on("close", (code) => resolve(code ?? 0));
        });
      }

      return execCommand("codex", args, {
        env: { ...process.env, ...opts.env } as Record<string, string>,
        ignoreReturnCode: true,
        quiet,
        onStderr: quiet ? (line) => log.debug(line) : undefined,
      });
    },
  };
}
