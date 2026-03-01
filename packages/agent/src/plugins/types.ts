import type { AgentTool } from "@swenyai/providers/agent-tool";
import type { UserIdentity } from "../auth/types.js";
import type { MemoryStore } from "../storage/memory/types.js";
import type { WorkspaceStore } from "../storage/workspace/types.js";
import type { Logger } from "../logger.js";

export type { AgentTool } from "@swenyai/providers/agent-tool";

export interface PluginContext {
  user: UserIdentity;
  storage: {
    memory: MemoryStore;
    workspace: WorkspaceStore;
  };
  config: Record<string, unknown>;
  logger: Logger;
}

export interface ToolPlugin {
  name: string;
  description?: string;
  createTools(ctx: PluginContext): AgentTool[] | Promise<AgentTool[]>;
  systemPromptSection?(ctx: PluginContext): string;
  destroy?(): Promise<void>;
}

export type ToolPluginFn = (ctx: PluginContext) => AgentTool[] | Promise<AgentTool[]>;
