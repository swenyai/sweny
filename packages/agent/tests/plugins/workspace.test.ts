import { describe, it, expect, vi, beforeEach } from "vitest";
import { workspacePlugin } from "../../src/plugins/workspace/index.js";
import type { PluginContext } from "../../src/plugins/types.js";
import type { AgentTool } from "@sweny/providers/agent-tool";

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

describe("workspacePlugin", () => {
  let ctx: PluginContext;
  let tools: AgentTool[];

  beforeEach(() => {
    ctx = makeFakeContext();
    const plugin = workspacePlugin();
    tools = plugin.createTools(ctx) as AgentTool[];
  });

  it("returns plugin with name 'workspace'", () => {
    const plugin = workspacePlugin();
    expect(plugin.name).toBe("workspace");
  });

  it("createTools() returns 6 tools", () => {
    expect(tools).toHaveLength(6);
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "workspace_list",
        "workspace_read",
        "workspace_write",
        "workspace_delete",
        "workspace_reset",
        "workspace_download_url",
      ]),
    );
  });

  describe("workspace_list", () => {
    it("returns JSON manifest", async () => {
      const manifest = {
        userId: "user-1",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-02T00:00:00Z",
        totalBytes: 1024,
        files: [
          {
            path: "logs/error.log",
            blobId: "blob-1",
            size: 1024,
            mimeType: "text/plain",
            createdAt: "2025-01-01T00:00:00Z",
          },
        ],
      };
      const store = ctx.storage.workspace;
      (store.getManifest as ReturnType<typeof vi.fn>).mockResolvedValue(manifest);

      const tool = findTool(tools, "workspace_list");
      const result = await tool.execute({});

      expect(store.getManifest).toHaveBeenCalledWith("user-1");
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toEqual(manifest);
    });

    it("returns isError: true when store throws", async () => {
      const store = ctx.storage.workspace;
      (store.getManifest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("storage unavailable"));

      const tool = findTool(tools, "workspace_list");
      const result = await tool.execute({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("storage unavailable");
    });
  });

  describe("workspace_read", () => {
    it("returns file content", async () => {
      const store = ctx.storage.workspace;
      (store.readFile as ReturnType<typeof vi.fn>).mockResolvedValue("file content here");

      const tool = findTool(tools, "workspace_read");
      const result = await tool.execute({ path: "logs/error.log" });

      expect(store.readFile).toHaveBeenCalledWith("user-1", "logs/error.log");
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe("file content here");
    });

    it("returns isError: true when store throws", async () => {
      const store = ctx.storage.workspace;
      (store.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("file not found"));

      const tool = findTool(tools, "workspace_read");
      const result = await tool.execute({ path: "nonexistent.txt" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("file not found");
    });
  });

  describe("workspace_write", () => {
    it("returns preview with path and size when confirm=false, does NOT call store", async () => {
      const store = ctx.storage.workspace;

      const tool = findTool(tools, "workspace_write");
      const result = await tool.execute({
        path: "report.txt",
        content: "Hello, world!",
        description: "A test file",
        confirm: false,
      });

      expect(store.writeFile).not.toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Preview");
      expect(result.content[0].text).toContain("report.txt");
      expect(result.content[0].text).toContain(`${Buffer.byteLength("Hello, world!", "utf-8")} bytes`);
      expect(result.content[0].text).toContain("A test file");
      expect(result.content[0].text).toContain("confirm=true");
    });

    it("calls store.writeFile() and returns success when confirm=true", async () => {
      const store = ctx.storage.workspace;
      (store.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        path: "report.txt",
        blobId: "blob-1",
        size: 13,
        mimeType: "text/plain",
        createdAt: "2025-01-01T00:00:00Z",
        description: "A test file",
      });

      const tool = findTool(tools, "workspace_write");
      const result = await tool.execute({
        path: "report.txt",
        content: "Hello, world!",
        description: "A test file",
        confirm: true,
      });

      expect(store.writeFile).toHaveBeenCalledWith("user-1", "report.txt", "Hello, world!", "A test file");
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Written: report.txt");
      expect(result.content[0].text).toContain("13 bytes");
    });

    it("returns isError: true when store throws on confirmed write", async () => {
      const store = ctx.storage.workspace;
      (store.writeFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("quota exceeded"));

      const tool = findTool(tools, "workspace_write");
      const result = await tool.execute({
        path: "report.txt",
        content: "data",
        confirm: true,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("quota exceeded");
    });
  });

  describe("workspace_delete", () => {
    it("returns preview when confirm=false, does NOT call store", async () => {
      const store = ctx.storage.workspace;

      const tool = findTool(tools, "workspace_delete");
      const result = await tool.execute({ path: "old.txt", confirm: false });

      expect(store.deleteFile).not.toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Preview");
      expect(result.content[0].text).toContain("old.txt");
      expect(result.content[0].text).toContain("confirm=true");
    });

    it("calls store.deleteFile() and returns success when confirm=true", async () => {
      const store = ctx.storage.workspace;
      (store.deleteFile as ReturnType<typeof vi.fn>).mockResolvedValue(true);

      const tool = findTool(tools, "workspace_delete");
      const result = await tool.execute({ path: "old.txt", confirm: true });

      expect(store.deleteFile).toHaveBeenCalledWith("user-1", "old.txt");
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Deleted: old.txt");
    });

    it("returns isError: true when file not found (deleteFile returns false)", async () => {
      const store = ctx.storage.workspace;
      (store.deleteFile as ReturnType<typeof vi.fn>).mockResolvedValue(false);

      const tool = findTool(tools, "workspace_delete");
      const result = await tool.execute({
        path: "nonexistent.txt",
        confirm: true,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("File not found: nonexistent.txt");
    });

    it("returns isError: true when store throws on confirmed delete", async () => {
      const store = ctx.storage.workspace;
      (store.deleteFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("permission denied"));

      const tool = findTool(tools, "workspace_delete");
      const result = await tool.execute({ path: "locked.txt", confirm: true });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("permission denied");
    });
  });

  describe("workspace_reset", () => {
    it("returns preview with file count when confirm=false", async () => {
      const store = ctx.storage.workspace;
      (store.getManifest as ReturnType<typeof vi.fn>).mockResolvedValue({
        userId: "user-1",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-02T00:00:00Z",
        totalBytes: 2048,
        files: [
          { path: "a.txt", blobId: "b1", size: 1024, mimeType: "text/plain", createdAt: "2025-01-01T00:00:00Z" },
          { path: "b.txt", blobId: "b2", size: 1024, mimeType: "text/plain", createdAt: "2025-01-01T00:00:00Z" },
        ],
      });

      const tool = findTool(tools, "workspace_reset");
      const result = await tool.execute({ confirm: false });

      expect(store.getManifest).toHaveBeenCalledWith("user-1");
      expect(store.reset).not.toHaveBeenCalled();
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("2 files");
      expect(result.content[0].text).toContain("2048 bytes");
      expect(result.content[0].text).toContain("confirm=true");
    });

    it("calls store.reset() and returns success when confirm=true", async () => {
      const store = ctx.storage.workspace;

      const tool = findTool(tools, "workspace_reset");
      const result = await tool.execute({ confirm: true });

      expect(store.reset).toHaveBeenCalledWith("user-1");
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain("Workspace cleared");
    });

    it("returns isError: true when store throws on confirmed reset", async () => {
      const store = ctx.storage.workspace;
      (store.reset as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("reset failed"));

      const tool = findTool(tools, "workspace_reset");
      const result = await tool.execute({ confirm: true });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("reset failed");
    });
  });

  describe("workspace_download_url", () => {
    it("returns URL from store", async () => {
      const store = ctx.storage.workspace;
      (store.getDownloadUrl as ReturnType<typeof vi.fn>).mockResolvedValue(
        "https://cdn.example.com/files/report.txt?token=abc",
      );

      const tool = findTool(tools, "workspace_download_url");
      const result = await tool.execute({ path: "report.txt" });

      expect(store.getDownloadUrl).toHaveBeenCalledWith("user-1", "report.txt");
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toBe("https://cdn.example.com/files/report.txt?token=abc");
    });

    it("returns isError: true when store throws", async () => {
      const store = ctx.storage.workspace;
      (store.getDownloadUrl as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("not found"));

      const tool = findTool(tools, "workspace_download_url");
      const result = await tool.execute({ path: "missing.txt" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("not found");
    });
  });

  describe("systemPromptSection", () => {
    it("returns non-empty string containing 'workspace'", () => {
      const plugin = workspacePlugin();
      const section = plugin.systemPromptSection!(ctx);

      expect(section.length).toBeGreaterThan(0);
      expect(section.toLowerCase()).toContain("workspace");
    });
  });
});
