import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStandardCommands } from "../../src/channel/slack-commands.js";
import type { SessionManager } from "../../src/session/manager.js";
import type { MemoryStore } from "../../src/storage/memory/types.js";
import type { ChannelCommand } from "../../src/channel/types.js";

function makeSessionManager(): SessionManager {
  return {
    clearAllForUser: vi.fn(),
  } as unknown as SessionManager;
}

function makeMemoryStore(): MemoryStore {
  return {
    getMemories: vi.fn(),
    addEntry: vi.fn(),
    removeEntry: vi.fn(),
    clearMemories: vi.fn(),
  } as unknown as MemoryStore;
}

const conversation = { conversationId: "ch-1", messageId: "msg-1" };

function findCommand(commands: ChannelCommand[], name: string): ChannelCommand {
  const cmd = commands.find((c) => c.name === name);
  if (!cmd) throw new Error(`Command "${name}" not found`);
  return cmd;
}

describe("createStandardCommands", () => {
  let sessionManager: SessionManager;
  let memoryStore: MemoryStore;

  beforeEach(() => {
    sessionManager = makeSessionManager();
    memoryStore = makeMemoryStore();
  });

  describe("command registration", () => {
    it("returns only /new command when no memoryStore is provided", () => {
      const commands = createStandardCommands(sessionManager);
      expect(commands).toHaveLength(1);
      expect(commands[0]!.name).toBe("new");
    });

    it("returns /new and /memory when memoryStore is provided", () => {
      const commands = createStandardCommands(sessionManager, memoryStore);
      expect(commands).toHaveLength(2);
      expect(commands.map((c) => c.name)).toEqual(["new", "memory"]);
    });
  });

  describe("/new command", () => {
    it("calls sessionManager.clearAllForUser and responds", async () => {
      const commands = createStandardCommands(sessionManager);
      const cmd = findCommand(commands, "new");
      const respond = vi.fn().mockResolvedValue(undefined);

      await cmd.execute({ userId: "U123", text: "", conversation, respond });

      expect(sessionManager.clearAllForUser).toHaveBeenCalledWith("U123");
      expect(respond).toHaveBeenCalledWith(
        "Session cleared. Your next message will start a fresh conversation.",
      );
    });
  });

  describe("/memory command", () => {
    let memoryCmd: ChannelCommand;

    beforeEach(() => {
      const commands = createStandardCommands(sessionManager, memoryStore);
      memoryCmd = findCommand(commands, "memory");
    });

    describe("add", () => {
      it("saves entry and responds with id", async () => {
        vi.mocked(memoryStore.addEntry).mockResolvedValue({
          id: "mem-1",
          text: "Remember this",
          createdAt: "2026-01-01T00:00:00Z",
        });
        const respond = vi.fn().mockResolvedValue(undefined);

        await memoryCmd.execute({
          userId: "U123",
          text: "add Remember this",
          conversation,
          respond,
        });

        expect(memoryStore.addEntry).toHaveBeenCalledWith("U123", "Remember this");
        expect(respond).toHaveBeenCalledWith("Memory saved (id: `mem-1`): Remember this");
      });

      it("shows usage when no text is provided", async () => {
        const respond = vi.fn().mockResolvedValue(undefined);

        await memoryCmd.execute({
          userId: "U123",
          text: "add",
          conversation,
          respond,
        });

        expect(memoryStore.addEntry).not.toHaveBeenCalled();
        expect(respond).toHaveBeenCalledWith("Usage: `/memory add <text>`");
      });
    });

    describe("list", () => {
      it("shows numbered list of memories", async () => {
        vi.mocked(memoryStore.getMemories).mockResolvedValue({
          entries: [
            { id: "mem-1", text: "First", createdAt: "2026-01-01T00:00:00Z" },
            { id: "mem-2", text: "Second", createdAt: "2026-01-02T00:00:00Z" },
          ],
        });
        const respond = vi.fn().mockResolvedValue(undefined);

        await memoryCmd.execute({
          userId: "U123",
          text: "list",
          conversation,
          respond,
        });

        expect(memoryStore.getMemories).toHaveBeenCalledWith("U123");
        expect(respond).toHaveBeenCalledWith(
          "*Your memories:*\n1. `mem-1` — First\n2. `mem-2` — Second",
        );
      });

      it("shows message when no memories exist", async () => {
        vi.mocked(memoryStore.getMemories).mockResolvedValue({ entries: [] });
        const respond = vi.fn().mockResolvedValue(undefined);

        await memoryCmd.execute({
          userId: "U123",
          text: "list",
          conversation,
          respond,
        });

        expect(respond).toHaveBeenCalledWith(
          "No memories saved. Use `/memory add <text>` to save one.",
        );
      });
    });

    describe("remove", () => {
      it("removes entry and confirms", async () => {
        vi.mocked(memoryStore.removeEntry).mockResolvedValue(true);
        const respond = vi.fn().mockResolvedValue(undefined);

        await memoryCmd.execute({
          userId: "U123",
          text: "remove mem-1",
          conversation,
          respond,
        });

        expect(memoryStore.removeEntry).toHaveBeenCalledWith("U123", "mem-1");
        expect(respond).toHaveBeenCalledWith("Memory `mem-1` removed.");
      });

      it('shows "not found" when entry does not exist', async () => {
        vi.mocked(memoryStore.removeEntry).mockResolvedValue(false);
        const respond = vi.fn().mockResolvedValue(undefined);

        await memoryCmd.execute({
          userId: "U123",
          text: "remove nonexistent",
          conversation,
          respond,
        });

        expect(memoryStore.removeEntry).toHaveBeenCalledWith("U123", "nonexistent");
        expect(respond).toHaveBeenCalledWith("Memory `nonexistent` not found.");
      });

      it("shows usage when no id is provided", async () => {
        const respond = vi.fn().mockResolvedValue(undefined);

        await memoryCmd.execute({
          userId: "U123",
          text: "remove",
          conversation,
          respond,
        });

        expect(memoryStore.removeEntry).not.toHaveBeenCalled();
        expect(respond).toHaveBeenCalledWith("Usage: `/memory remove <id>`");
      });
    });

    describe("clear", () => {
      it("clears all memories and confirms", async () => {
        vi.mocked(memoryStore.clearMemories).mockResolvedValue(undefined);
        const respond = vi.fn().mockResolvedValue(undefined);

        await memoryCmd.execute({
          userId: "U123",
          text: "clear",
          conversation,
          respond,
        });

        expect(memoryStore.clearMemories).toHaveBeenCalledWith("U123");
        expect(respond).toHaveBeenCalledWith("All memories cleared.");
      });
    });

    describe("help / unknown subcommand", () => {
      it("shows help text when no subcommand is given", async () => {
        const respond = vi.fn().mockResolvedValue(undefined);

        await memoryCmd.execute({
          userId: "U123",
          text: "",
          conversation,
          respond,
        });

        expect(respond).toHaveBeenCalledWith(
          "*Memory commands:*\n" +
            "`/memory add <text>` — save a memory\n" +
            "`/memory list` — list all memories\n" +
            "`/memory remove <id>` — remove a memory\n" +
            "`/memory clear` — clear all memories",
        );
      });

      it("shows help text for unknown subcommand", async () => {
        const respond = vi.fn().mockResolvedValue(undefined);

        await memoryCmd.execute({
          userId: "U123",
          text: "unknown",
          conversation,
          respond,
        });

        expect(respond).toHaveBeenCalledWith(
          expect.stringContaining("*Memory commands:*"),
        );
      });
    });
  });
});
