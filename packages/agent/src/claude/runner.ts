import { query, createSdkMcpServer, type SDKAssistantMessage, type SDKResultMessage } from "@anthropic-ai/claude-code";
import type { Session } from "../session/manager.js";
import type { UserIdentity } from "../auth/types.js";
import type { PluginContext } from "../plugins/types.js";
import type { MemoryEntry } from "../storage/memory/types.js";
import type { MemoryStore } from "../storage/memory/types.js";
import type { WorkspaceStore } from "../storage/workspace/types.js";
import { PluginRegistry } from "../plugins/registry.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { DENIED_TOOLS } from "./tool-guard.js";
import { createLogger } from "../logger.js";
import { toSdkTools } from "../model/adapter.js";

export interface ToolCall {
  toolName: string;
  toolInput: Record<string, unknown>;
  executedAt: string;
}

export interface RunResult {
  response: string;
  sessionId: string | null;
  toolCalls: ToolCall[];
}

export interface RunnerConfig {
  name: string;
  basePrompt?: string;
  maxTurns: number;
  claude: {
    apiKey?: string;
    oauthToken?: string;
  };
}

export interface RunnerResources {
  registry: PluginRegistry;
  memoryStore: MemoryStore;
  workspaceStore: WorkspaceStore;
}

export class ClaudeRunner {
  private config: RunnerConfig;
  private resources: RunnerResources;

  constructor(config: RunnerConfig, resources: RunnerResources) {
    this.config = config;
    this.resources = resources;
  }

  async run(opts: {
    prompt: string;
    session: Session;
    user: UserIdentity;
    memories: MemoryEntry[];
  }): Promise<RunResult> {
    const logger = createLogger(this.config.name);

    // Build PluginContext from user identity + storage stores
    const pluginCtx: PluginContext = {
      user: opts.user,
      storage: {
        memory: this.resources.memoryStore,
        workspace: this.resources.workspaceStore,
      },
      config: {},
      logger,
    };

    // Build plugin system prompt sections
    const pluginSections = this.resources.registry.buildSystemPromptSections(pluginCtx);

    // Build full system prompt
    const systemPrompt = buildSystemPrompt({
      name: this.config.name,
      basePrompt: this.config.basePrompt,
      pluginSections,
      memories: opts.memories,
    });

    // Build tools from plugin registry and convert to SDK format
    const agentTools = await this.resources.registry.buildToolsForSession(pluginCtx);
    const sdkTools = toSdkTools(agentTools);

    // Create in-process MCP server with session-specific tools
    const mcpServer = createSdkMcpServer({
      name: this.config.name,
      tools: sdkTools,
    });

    const toolCalls: ToolCall[] = [];
    let sessionId: string | null = null;
    let response = "";

    // Pass Claude credentials to the SDK subprocess.
    // The SDK replaces the entire env when `env` is provided, so we
    // must spread process.env to preserve PATH, HOME, etc.
    const env: Record<string, string> = {
      ...(Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] != null),
      )),
    };
    if (this.config.claude.oauthToken) {
      env.CLAUDE_CODE_OAUTH_TOKEN = this.config.claude.oauthToken;
    }
    if (this.config.claude.apiKey) {
      env.ANTHROPIC_API_KEY = this.config.claude.apiKey;
    }

    const stream = query({
      prompt: opts.prompt,
      options: {
        maxTurns: this.config.maxTurns,
        customSystemPrompt: systemPrompt,
        cwd: "/tmp",
        env,
        permissionMode: "bypassPermissions",
        mcpServers: {
          [this.config.name]: mcpServer,
        },
        disallowedTools: DENIED_TOOLS,
        ...(opts.session.claudeSessionId ? { resume: opts.session.claudeSessionId } : {}),
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
          response = (response || "") + "\n\n_Reached maximum number of turns. Please continue in a follow-up message._";
        }
      }
    }

    return { response: response || "No response generated.", sessionId, toolCalls };
  }
}
