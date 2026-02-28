import { query, createSdkMcpServer, type SDKAssistantMessage, type SDKResultMessage } from "@anthropic-ai/claude-code";
import type { ModelRunner, ModelRunOptions, RunResult, ToolCall } from "./types.js";
import { toSdkTools } from "./adapter.js";

export interface ClaudeCodeRunnerConfig {
  apiKey?: string;
  oauthToken?: string;
}

export class ClaudeCodeRunner implements ModelRunner {
  private config: ClaudeCodeRunnerConfig;

  constructor(config: ClaudeCodeRunnerConfig = {}) {
    this.config = config;
  }

  async run(opts: ModelRunOptions): Promise<RunResult> {
    // Convert AgentTools to SDK format
    const sdkTools = toSdkTools(opts.tools);

    // Create in-process MCP server with session-specific tools
    const mcpServer = createSdkMcpServer({
      name: opts.name ?? "sweny",
      tools: sdkTools,
    });

    const toolCalls: ToolCall[] = [];
    let sessionId: string | null = null;
    let response = "";

    // Build env — SDK replaces entire env when `env` is provided,
    // so spread process.env to preserve PATH, HOME, etc.
    const env: Record<string, string> = {
      ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] != null)),
      ...opts.env,
    };
    if (this.config.oauthToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = this.config.oauthToken;
    }
    if (this.config.apiKey) {
      env.ANTHROPIC_API_KEY = this.config.apiKey;
    }

    const stream = query({
      prompt: opts.prompt,
      options: {
        maxTurns: opts.maxTurns,
        customSystemPrompt: opts.systemPrompt,
        cwd: opts.cwd ?? "/tmp",
        env,
        permissionMode: "bypassPermissions",
        mcpServers: {
          [opts.name ?? "sweny"]: mcpServer,
        },
        disallowedTools: opts.disallowedTools ?? [],
        ...(opts.sessionId ? { resume: opts.sessionId } : {}),
      },
    });

    for await (const message of stream) {
      if (message.type === "system") {
        sessionId = message.session_id;
      }

      if (message.type === "assistant") {
        const assistantMsg = message as SDKAssistantMessage;
        for (const block of assistantMsg.message.content) {
          if (block.type === "tool_use") {
            toolCalls.push({
              toolName: block.name,
              toolInput: (block.input ?? {}) as Record<string, unknown>,
              executedAt: new Date().toISOString(),
            });
          }
        }
      }

      if (message.type === "result") {
        const resultMsg = message as SDKResultMessage;
        if (resultMsg.subtype === "success" && "result" in resultMsg) {
          response = resultMsg.result;
        } else if (resultMsg.subtype === "error_max_turns") {
          response =
            (response || "") + "\n\n_Reached maximum number of turns. Please continue in a follow-up message._";
        }
      }
    }

    return { response: response || "No response generated.", sessionId, toolCalls };
  }
}
