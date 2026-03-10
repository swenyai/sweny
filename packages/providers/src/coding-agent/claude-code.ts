import { spawn } from "node:child_process";
import type { CodingAgent, CodingAgentRunOptions, AgentEvent, AgentEventHandler } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { execCommand, isCliInstalled } from "./shared.js";

export interface ClaudeCodeConfig {
  cliFlags?: string[];
  logger?: Logger;
  /** Suppress agent stdout; forward stderr through logger */
  quiet?: boolean;
  onEvent?: AgentEventHandler;
}

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
        return new Promise((resolve, reject) => {
          const child = spawn("claude", args, {
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
              try {
                const evt = JSON.parse(line);
                const mapped = mapClaudeEvent(evt);
                if (mapped) Promise.resolve(onEvent(mapped)).catch(() => {});
              } catch {
                /* skip malformed lines */
              }
            }
          });
          child.on("error", reject);
          child.on("close", (code) => resolve(code ?? 0));
        });
      }

      // No onEvent — use shared execCommand (stdio: inherit)
      return execCommand("claude", args, {
        env: { ...process.env, ...opts.env } as Record<string, string>,
        ignoreReturnCode: true,
        quiet,
        onStderr: quiet ? (line) => log.debug(line) : undefined,
      });
    },
  };
}
