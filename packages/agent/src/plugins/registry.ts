import type { AgentTool } from "@sweny-ai/providers/agent-tool";
import type { ToolPlugin, PluginContext } from "./types.js";

export class PluginRegistry {
  constructor(private plugins: ToolPlugin[]) {}

  async buildToolsForSession(ctx: PluginContext): Promise<AgentTool[]> {
    const tools: AgentTool[] = [];
    for (const plugin of this.plugins) {
      const pluginTools = await plugin.createTools(ctx);
      tools.push(...pluginTools);
    }
    return tools;
  }

  buildSystemPromptSections(ctx: PluginContext): string {
    return this.plugins
      .map((p) => p.systemPromptSection?.(ctx))
      .filter(Boolean)
      .join("\n\n");
  }

  async destroy(): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.destroy?.();
    }
  }
}
