import type { Session } from "../session/manager.js";
import type { UserIdentity } from "../auth/types.js";
import type { PluginContext } from "../plugins/types.js";
import type { MemoryEntry } from "../storage/memory/types.js";
import type { MemoryStore } from "../storage/memory/types.js";
import type { WorkspaceStore } from "../storage/workspace/types.js";
import type { ModelRunner, RunResult, ToolCall } from "../model/types.js";
import { PluginRegistry } from "../plugins/registry.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { DENIED_TOOLS } from "./tool-guard.js";
import { createLogger } from "../logger.js";

export type { RunResult, ToolCall } from "../model/types.js";

export interface RunnerConfig {
  name: string;
  basePrompt?: string;
  maxTurns: number;
  model: {
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
  private modelRunner: ModelRunner;

  constructor(config: RunnerConfig, resources: RunnerResources, modelRunner: ModelRunner) {
    this.config = config;
    this.resources = resources;
    this.modelRunner = modelRunner;
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

    // Build tools from plugin registry
    const tools = await this.resources.registry.buildToolsForSession(pluginCtx);

    // Delegate to model runner
    return this.modelRunner.run({
      prompt: opts.prompt,
      systemPrompt,
      tools,
      maxTurns: this.config.maxTurns,
      sessionId: opts.session.agentSessionId,
      disallowedTools: DENIED_TOOLS,
      name: this.config.name,
    });
  }
}
