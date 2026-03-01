import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryPlugin } from "../../src/plugins/memory/index.js";
import type { PluginContext } from "../../src/plugins/types.js";
import type { AgentTool } from "@swenyai/providers/agent-tool";

function makeFakeContext(): PluginContext {
  return {
    user: { userId: "user-1", displayName: "Test", roles: [], metadata: {} },
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

function findTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  return tool;
}

describe("memoryPlugin", () => {
  let ctx: PluginContext;
  let tools: AgentTool[];

  beforeEach(() => {
    ctx = makeFakeContext();
    const plugin = memoryPlugin();
    tools = plugin.createTools(ctx) as AgentTool[];
  });

  it("returns plugin with name 'memory'", () => {
    const plugin = memoryPlugin();
    expect(plugin.name).toBe("memory");
  });

  it("createTools() returns 3 tools", () => {
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["memory_save", "memory_list", "memory_remove"]));
  });

  describe("memory_save", () => {
    it("calls store.addEntry() with userId and text, returns success message", async () => {
      const store = ctx.storage.memory;
      (store.addEntry as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "entry-1",
        text: "remember this",
        createdAt: "2025-01-01T00:00:00Z",
      });

      const tool = findTool(tools, "memory_save");
      const result = await tool.execute({ text: "remember this" });

      expect(store.addEntry).toHaveBeenCalledWith("user-1", "remember this");
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Memory saved");
      expect(result.content[0].text).toContain("entry-1");
      expect(result.content[0].text).toContain("remember this");
    });

    it("returns isError: true when store throws", async () => {
      const store = ctx.storage.memory;
      (store.addEntry as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("disk full"));

      const tool = findTool(tools, "memory_save");
      const result = await tool.execute({ text: "fail" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("disk full");
    });
  });

  describe("memory_list", () => {
    it("returns formatted list when entries exist", async () => {
      const store = ctx.storage.memory;
      (store.getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({
        entries: [
          { id: "m1", text: "first note", createdAt: "2025-01-01T00:00:00Z" },
          { id: "m2", text: "second note", createdAt: "2025-01-02T00:00:00Z" },
        ],
      });

      const tool = findTool(tools, "memory_list");
      const result = await tool.execute({});

      expect(store.getMemories).toHaveBeenCalledWith("user-1");
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Saved memories (2)");
      expect(result.content[0].text).toContain("[m1] first note");
      expect(result.content[0].text).toContain("[m2] second note");
    });

    it("returns 'No memories saved' when empty", async () => {
      const store = ctx.storage.memory;
      (store.getMemories as ReturnType<typeof vi.fn>).mockResolvedValue({
        entries: [],
      });

      const tool = findTool(tools, "memory_list");
      const result = await tool.execute({});

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe("No memories saved.");
    });

    it("returns isError: true when store throws", async () => {
      const store = ctx.storage.memory;
      (store.getMemories as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection refused"));

      const tool = findTool(tools, "memory_list");
      const result = await tool.execute({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("connection refused");
    });
  });

  describe("memory_remove", () => {
    it("calls store.removeEntry(), returns success", async () => {
      const store = ctx.storage.memory;
      (store.removeEntry as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const tool = findTool(tools, "memory_remove");
      const result = await tool.execute({ entryId: "m1" });

      expect(store.removeEntry).toHaveBeenCalledWith("user-1", "m1");
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Memory removed: m1");
    });

    it("returns isError: true when entry not found (removeEntry returns false)", async () => {
      const store = ctx.storage.memory;
      (store.removeEntry as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const tool = findTool(tools, "memory_remove");
      const result = await tool.execute({ entryId: "nonexistent" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Memory not found: nonexistent");
    });

    it("returns isError: true when store throws", async () => {
      const store = ctx.storage.memory;
      (store.removeEntry as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("timeout"));

      const tool = findTool(tools, "memory_remove");
      const result = await tool.execute({ entryId: "m1" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("timeout");
    });
  });

  describe("systemPromptSection", () => {
    it("returns non-empty string containing 'memory'", () => {
      const plugin = memoryPlugin();
      const section = plugin.systemPromptSection!(ctx);

      expect(section.length).toBeGreaterThan(0);
      expect(section.toLowerCase()).toContain("memory");
    });
  });
});
