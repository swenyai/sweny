import type { CodingAgent, CodingAgentRunOptions, AgentEvent, AgentEventHandler } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { execCommand, spawnLines, isCliInstalled, writeMcpConfig } from "./shared.js";
import type { ProviderConfigSchema } from "../config-schema.js";

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
 * Stateful parser for Claude stream-json NDJSON events.
 *
 * Maintains a tool_use_id → tool_name map so that tool_result events
 * (type === "user") can be emitted with the human-readable tool name
 * rather than the opaque tool_use_id.
 *
 * Verified against Claude Code CLI 2.x stream-json output format:
 *   - assistant events carry content blocks: text | tool_use | thinking
 *   - user events carry tool_result content blocks (one per tool call)
 *   - system / result / rate_limit_event are silently skipped
 *
 * Note: --output-format stream-json requires --verbose (Claude Code CLI
 * returns an error without it). See claudeCode() run() below.
 */
function makeClaudeEventParser() {
  // tool_use_id (e.g. "toolu_01xxx") → tool name (e.g. "Bash")
  const toolNames = new Map<string, string>();

  return function parse(raw: unknown): AgentEvent | null {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;

    if (r["type"] === "assistant") {
      const message = r["message"] as Record<string, unknown> | undefined;
      const content = message?.["content"];
      if (!Array.isArray(content)) return null;

      for (const block of content) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as Record<string, unknown>;

        if (b["type"] === "thinking" && typeof b["thinking"] === "string") {
          return { type: "thinking", text: b["thinking"] };
        }
        if (b["type"] === "text" && typeof b["text"] === "string") {
          return { type: "text", text: b["text"] };
        }
        if (b["type"] === "tool_use" && typeof b["name"] === "string") {
          // Register the id→name mapping so tool_result events can look it up
          if (typeof b["id"] === "string") toolNames.set(b["id"], b["name"]);
          return { type: "tool_call", tool: b["name"], input: b["input"] };
        }
      }
      return null;
    }

    // Tool results arrive as "user" messages with tool_result content blocks.
    // Format confirmed from Claude Code CLI 2.x stream-json output.
    if (r["type"] === "user") {
      const message = r["message"] as Record<string, unknown> | undefined;
      const content = message?.["content"];
      if (!Array.isArray(content)) return null;

      for (const block of content) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as Record<string, unknown>;
        if (b["type"] !== "tool_result") continue;

        const toolUseId = typeof b["tool_use_id"] === "string" ? b["tool_use_id"] : "";
        const toolName = toolNames.get(toolUseId) ?? toolUseId;
        const isError = b["is_error"] === true;
        const output = typeof b["content"] === "string" ? b["content"] : "";
        return { type: "tool_result", tool: toolName, success: !isError, output };
      }
      return null;
    }

    // system, result, rate_limit_event — silently ignored
    return null;
  };
}

export const claudeCodeProviderConfigSchema: ProviderConfigSchema = {
  role: "codingAgent",
  name: "Claude Code",
  fields: [
    {
      key: "anthropicApiKey",
      envVar: "ANTHROPIC_API_KEY",
      required: false,
      description: "Anthropic API key (one of ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is required)",
    },
    {
      key: "claudeCodeOauthToken",
      envVar: "CLAUDE_CODE_OAUTH_TOKEN",
      required: false,
      description: "Claude Code OAuth token (one of ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is required)",
    },
  ],
};

export function claudeCode(config?: ClaudeCodeConfig): CodingAgent & { configSchema: ProviderConfigSchema } {
  const log = config?.logger ?? consoleLogger;
  const extraFlags = config?.cliFlags ?? [];
  const quiet = config?.quiet ?? false;
  const onEvent = config?.onEvent;

  return Object.assign({
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

      const mcpServers = opts.mcpServers;
      const mcpConfig = mcpServers && Object.keys(mcpServers).length > 0 ? writeMcpConfig(mcpServers) : null;

      if (mcpConfig && mcpServers) {
        args.push("--mcp-config", mcpConfig.path);
        log.info(`Injecting ${Object.keys(mcpServers).length} MCP server(s): ${Object.keys(mcpServers).join(", ")}`);
      }

      try {
        if (onEvent) {
          // --output-format stream-json requires --verbose; omitting it causes
          // the CLI to exit with "stream-json requires --verbose" error.
          args.push("--output-format", "stream-json", "--verbose");
          const parse = makeClaudeEventParser();
          return await spawnLines("claude", args, {
            env: opts.env,
            timeoutMs: opts.timeoutMs,
            logger: log,
            onLine(line) {
              try {
                const evt = JSON.parse(line);
                const mapped = parse(evt);
                if (mapped) return onEvent(mapped);
              } catch {
                /* skip malformed JSON lines */
              }
            },
          });
        }

        return await execCommand("claude", args, {
          env: { ...process.env, ...opts.env } as Record<string, string>,
          ignoreReturnCode: true,
          quiet,
          timeoutMs: opts.timeoutMs,
          onStderr: quiet ? (line) => log.debug(line) : undefined,
        });
      } finally {
        mcpConfig?.cleanup();
      }
    },
  }, { configSchema: claudeCodeProviderConfigSchema });
}
