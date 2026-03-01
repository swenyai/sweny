import { describe, it, expect, vi } from "vitest";
import { PluginRegistry } from "../../src/plugins/registry.js";
import type { AgentTool } from "@swenyai/providers/agent-tool";
import type { ToolPlugin, PluginContext } from "../../src/plugins/types.js";

/** Create a minimal PluginContext stub for testing. */
function makeFakeContext(): PluginContext {
  return {
    user: { userId: "test-user", displayName: "Test", roles: [], metadata: {} },
    storage: {
      memory: {
        getMemories: vi.fn(),
        addEntry: vi.fn(),
        removeEntry: vi.fn(),
        clearMemories: vi.fn(),
      },
      workspace: {
        getManifest: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        deleteFile: vi.fn(),
        reset: vi.fn(),
        getDownloadUrl: vi.fn(),
      },
    },
    config: {},
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
}

/** Create a fake AgentTool object for testing. */
function fakeTool(name: string): AgentTool {
  return { name, description: "", schema: {}, execute: async () => ({ content: [] }) } as AgentTool;
}

function makePlugin(overrides: Partial<ToolPlugin> & { name: string }): ToolPlugin {
  return {
    createTools: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

describe("PluginRegistry", () => {
  it("builds tools from registered plugins", async () => {
    const toolA = fakeTool("tool-a");
    const toolB = fakeTool("tool-b");

    const plugin = makePlugin({
      name: "test-plugin",
      createTools: vi.fn().mockReturnValue([toolA, toolB]),
    });

    const registry = new PluginRegistry([plugin]);
    const ctx = makeFakeContext();

    const tools = await registry.buildToolsForSession(ctx);

    expect(tools).toHaveLength(2);
    expect(tools).toContain(toolA);
    expect(tools).toContain(toolB);
    expect(plugin.createTools).toHaveBeenCalledWith(ctx);
  });

  it("collects system prompt sections from plugins", () => {
    const plugin1 = makePlugin({
      name: "plugin-1",
      systemPromptSection: () => "Section from plugin 1",
    });
    const plugin2 = makePlugin({
      name: "plugin-2",
      systemPromptSection: () => "Section from plugin 2",
    });

    const registry = new PluginRegistry([plugin1, plugin2]);
    const ctx = makeFakeContext();

    const result = registry.buildSystemPromptSections(ctx);

    expect(result).toContain("Section from plugin 1");
    expect(result).toContain("Section from plugin 2");
  });

  it("handles plugins without systemPromptSection", () => {
    const pluginWithSection = makePlugin({
      name: "with-section",
      systemPromptSection: () => "Has a section",
    });
    const pluginWithout = makePlugin({
      name: "without-section",
      // no systemPromptSection
    });

    const registry = new PluginRegistry([pluginWithSection, pluginWithout]);
    const ctx = makeFakeContext();

    const result = registry.buildSystemPromptSections(ctx);
    expect(result).toBe("Has a section");
  });

  it("calls destroy on plugins during cleanup", async () => {
    const destroyFn = vi.fn().mockResolvedValue(undefined);

    const plugin = makePlugin({
      name: "destroyable",
      destroy: destroyFn,
    });

    const registry = new PluginRegistry([plugin]);
    await registry.destroy();

    expect(destroyFn).toHaveBeenCalledOnce();
  });

  it("handles plugins without destroy method", async () => {
    const plugin = makePlugin({
      name: "no-destroy",
      // no destroy method
    });

    const registry = new PluginRegistry([plugin]);

    // Should not throw
    await expect(registry.destroy()).resolves.toBeUndefined();
  });

  it("multiple plugins contribute tools", async () => {
    const tool1 = fakeTool("tool-1");
    const tool2 = fakeTool("tool-2");
    const tool3 = fakeTool("tool-3");

    const pluginA = makePlugin({
      name: "plugin-a",
      createTools: vi.fn().mockReturnValue([tool1]),
    });
    const pluginB = makePlugin({
      name: "plugin-b",
      createTools: vi.fn().mockReturnValue([tool2, tool3]),
    });

    const registry = new PluginRegistry([pluginA, pluginB]);
    const ctx = makeFakeContext();

    const tools = await registry.buildToolsForSession(ctx);

    expect(tools).toHaveLength(3);
    expect(tools).toContain(tool1);
    expect(tools).toContain(tool2);
    expect(tools).toContain(tool3);
  });

  it("returns empty string when no plugins have system prompt sections", () => {
    const plugin = makePlugin({ name: "bare" });

    const registry = new PluginRegistry([plugin]);
    const ctx = makeFakeContext();

    const result = registry.buildSystemPromptSections(ctx);
    expect(result).toBe("");
  });

  it("returns empty tools array when no plugins are registered", async () => {
    const registry = new PluginRegistry([]);
    const ctx = makeFakeContext();

    const tools = await registry.buildToolsForSession(ctx);
    expect(tools).toHaveLength(0);
  });
});
