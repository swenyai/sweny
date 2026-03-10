import { spawn } from "node:child_process";
import type { CodingAgent, CodingAgentRunOptions, AgentEventHandler } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { execCommand, isCliInstalled } from "./shared.js";

export interface GoogleGeminiConfig {
  cliFlags?: string[];
  logger?: Logger;
  /** Suppress agent stdout; forward stderr through logger */
  quiet?: boolean;
  onEvent?: AgentEventHandler;
}

export function googleGemini(config?: GoogleGeminiConfig): CodingAgent {
  const log = config?.logger ?? consoleLogger;
  const extraFlags = config?.cliFlags ?? [];
  const quiet = config?.quiet ?? false;
  const onEvent = config?.onEvent;

  return {
    async install(): Promise<void> {
      if (isCliInstalled("gemini")) {
        log.info("Google Gemini CLI already installed, skipping");
        return;
      }
      log.info("Installing Google Gemini CLI...");
      await execCommand("npm", ["install", "-g", "@google/gemini-cli"], { quiet });
      log.info("Google Gemini CLI installed");
    },

    async run(opts: CodingAgentRunOptions): Promise<number> {
      log.info("Running Google Gemini agent...");

      const args = ["-y", "-p", opts.prompt, ...extraFlags];

      if (onEvent) {
        return new Promise((resolve, reject) => {
          const child = spawn("gemini", args, {
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

      return execCommand("gemini", args, {
        env: { ...process.env, ...opts.env } as Record<string, string>,
        ignoreReturnCode: true,
        quiet,
        onStderr: quiet ? (line) => log.debug(line) : undefined,
      });
    },
  };
}
