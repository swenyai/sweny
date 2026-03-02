import type { CodingAgent, CodingAgentRunOptions } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { execCommand, isCliInstalled } from "./shared.js";

export interface GoogleGeminiConfig {
  cliFlags?: string[];
  logger?: Logger;
}

export function googleGemini(config?: GoogleGeminiConfig): CodingAgent {
  const log = config?.logger ?? consoleLogger;
  const extraFlags = config?.cliFlags ?? [];

  return {
    async install(): Promise<void> {
      if (isCliInstalled("gemini")) {
        log.info("Google Gemini CLI already installed, skipping");
        return;
      }
      log.info("Installing Google Gemini CLI...");
      await execCommand("npm", ["install", "-g", "@google/gemini-cli"]);
      log.info("Google Gemini CLI installed");
    },

    async run(opts: CodingAgentRunOptions): Promise<number> {
      log.info("Running Google Gemini agent...");

      const args = ["-y", "-p", opts.prompt, ...extraFlags];

      return execCommand("gemini", args, {
        env: { ...process.env, ...opts.env } as Record<string, string>,
        ignoreReturnCode: true,
      });
    },
  };
}
