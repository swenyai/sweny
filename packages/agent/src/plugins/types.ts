import type { tool } from "@anthropic-ai/claude-code";
import type { UserIdentity } from "../auth/types.js";
import type { MemoryStore } from "../storage/memory/types.js";
import type { WorkspaceStore } from "../storage/workspace/types.js";
import type { Logger } from "../logger.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SdkTool = ReturnType<typeof tool<any>>;

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
  createTools(ctx: PluginContext): SdkTool[] | Promise<SdkTool[]>;
  systemPromptSection?(ctx: PluginContext): string;
  destroy?(): Promise<void>;
}

export type ToolPluginFn = (ctx: PluginContext) => SdkTool[] | Promise<SdkTool[]>;
