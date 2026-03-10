import type { CodingAgent, CodingAgentRunOptions, AgentEvent, AgentEventHandler } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { execCommand, spawnLines, isCliInstalled } from "./shared.js";

export interface ClaudeCodeConfig {
  cliFlags?: string[];
  logger?: Logger;
  /**
   * Suppress agent stdout; forward stderr through logger.
   * Ignored when onEvent is set (event mode always captures stdout).
   */
  quiet?: boolean;
  /**
   * Receive structured events during run(). When provided, Claude is invoked
   * with `--output-format stream-json` and each event is parsed and forwarded.
   * Omit to use the default passthrough (stdout → terminal).
   */
  onEvent?: AgentEventHandler;
}

/**
 * Maps a raw Claude stream-json event object to an AgentEvent.
 * Returns null for event types we do not expose (e.g. system, result).
 */
function mapClaudeEvent(raw: unknown): AgentEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (r["type"] === "assistant") {
    const message = r["message"] as Record<string, unknown> | undefined;
    const content = message?.["content"];
    if (!Array.isArray(content)) return null;
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;
      if (b["type"] === "text" && typeof b["text"] === "string") {
        return { type: "text", text: b["text"] };
      }
      if (b["type"] === "tool_use" && typeof b["name"] === "string") {
        return { type: "tool_call", tool: b["name"], input: b["input"] };
      }
      if (b["type"] === "thinking" && typeof b["thinking"] === "string") {
        return { type: "thinking", text: b["thinking"] };
      }
    }
    return null;
  }

  if (r["type"] === "tool") {
    const toolUseId = typeof r["tool_use_id"] === "string" ? r["tool_use_id"] : "unknown";
    const content = r["content"];
    let output = "";
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === "object" && block !== null) {
          const b = block as Record<string, unknown>;
          if (b["type"] === "text" && typeof b["text"] === "string") {
            output = b["text"];
            break;
          }
        }
      }
    }
    return { type: "tool_result", tool: toolUseId, success: true, output };
  }

  return null;
}

export function claudeCode(config?: ClaudeCodeConfig): CodingAgent {
  const log = config?.logger ?? consoleLogger;
  const extraFlags = config?.cliFlags ?? [];
  const quiet = config?.quiet ?? false;
  const onEvent = config?.onEvent;

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

      if (onEvent) {
        args.push("--output-format", "stream-json");
        return spawnLines("claude", args, {
          env: opts.env,
          timeoutMs: opts.timeoutMs,
          logger: log,
          onLine(line) {
            try {
              const evt = JSON.parse(line);
              const mapped = mapClaudeEvent(evt);
              if (mapped) return onEvent(mapped);
            } catch {
              /* skip malformed JSON lines */
            }
          },
        });
      }

      return execCommand("claude", args, {
        env: { ...process.env, ...opts.env } as Record<string, string>,
        ignoreReturnCode: true,
        quiet,
        timeoutMs: opts.timeoutMs,
        onStderr: quiet ? (line) => log.debug(line) : undefined,
      });
    },
  };
}
