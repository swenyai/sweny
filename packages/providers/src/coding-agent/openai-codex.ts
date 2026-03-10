import type { CodingAgent, CodingAgentRunOptions, AgentEventHandler } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { execCommand, spawnLines, isCliInstalled } from "./shared.js";

export interface OpenAICodexConfig {
  cliFlags?: string[];
  logger?: Logger;
  /** Suppress agent stdout; forward stderr through logger. */
  quiet?: boolean;
  /**
   * Receive events during run(). Codex CLI does not emit structured JSON, so
   * each stdout line is forwarded as `{ type: "text", text: line }`.
   */
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
        return spawnLines("codex", args, {
          env: opts.env,
          timeoutMs: opts.timeoutMs,
          logger: log,
          onLine: (line) => onEvent({ type: "text", text: line }),
        });
      }

      return execCommand("codex", args, {
        env: { ...process.env, ...opts.env } as Record<string, string>,
        ignoreReturnCode: true,
        quiet,
        timeoutMs: opts.timeoutMs,
        onStderr: quiet ? (line) => log.debug(line) : undefined,
      });
    },
  };
}
