import type { ToolPlugin, PluginContext, SdkTool } from "./types.js";

export class PluginRegistry {
  constructor(private plugins: ToolPlugin[]) {}

  async buildToolsForSession(ctx: PluginContext): Promise<SdkTool[]> {
    const tools: SdkTool[] = [];
    for (const plugin of this.plugins) {
      const pluginTools = await plugin.createTools(ctx);
      tools.push(...pluginTools);
    }
    return tools;
  }

  buildSystemPromptSections(ctx: PluginContext): string {
    return this.plugins
      .map(p => p.systemPromptSection?.(ctx))
      .filter(Boolean)
      .join("\n\n");
  }

  async destroy(): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.destroy?.();
    }
  }
}
