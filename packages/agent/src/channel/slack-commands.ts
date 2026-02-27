import type { SessionManager } from "../session/manager.js";
import type { MemoryStore } from "../storage/memory/types.js";
import type { ChannelCommand } from "./types.js";

/**
 * Create the standard set of channel commands (/new, /memory).
 * These are channel-agnostic — they work with any Channel adapter.
 */
export function createStandardCommands(
  sessionManager: SessionManager,
  memoryStore?: MemoryStore,
): ChannelCommand[] {
  const commands: ChannelCommand[] = [];

  // /new — clear current session
  commands.push({
    name: "new",
    description: "Clear your current session and start fresh.",
    execute: async ({ userId, respond }) => {
      sessionManager.clearAllForUser(userId);
      await respond("Session cleared. Your next message will start a fresh conversation.");
    },
  });

  // /memory — manage user memories (only if memoryStore is available)
  if (memoryStore) {
    commands.push({
      name: "memory",
      description: "Manage your saved memories (add, list, remove, clear).",
      execute: async ({ userId, text, respond }) => {
        const args = text.trim();
        const spaceIdx = args.indexOf(" ");
        const subcommand = spaceIdx === -1 ? args : args.slice(0, spaceIdx);
        const rest = spaceIdx === -1 ? "" : args.slice(spaceIdx + 1).trim();

        switch (subcommand) {
          case "add": {
            if (!rest) {
              await respond("Usage: `/memory add <text>`");
              return;
            }
            const entry = await memoryStore.addEntry(userId, rest);
            await respond(`Memory saved (id: \`${entry.id}\`): ${entry.text}`);
            break;
          }

          case "list": {
            const memories = await memoryStore.getMemories(userId);
            if (memories.entries.length === 0) {
              await respond("No memories saved. Use `/memory add <text>` to save one.");
              return;
            }
            const lines = memories.entries.map((e, i) => `${i + 1}. \`${e.id}\` — ${e.text}`);
            await respond(`*Your memories:*\n${lines.join("\n")}`);
            break;
          }

          case "remove": {
            if (!rest) {
              await respond("Usage: `/memory remove <id>`");
              return;
            }
            const removed = await memoryStore.removeEntry(userId, rest);
            await respond(removed ? `Memory \`${rest}\` removed.` : `Memory \`${rest}\` not found.`);
            break;
          }

          case "clear": {
            await memoryStore.clearMemories(userId);
            await respond("All memories cleared.");
            break;
          }

          default: {
            await respond(
              "*Memory commands:*\n" +
                "`/memory add <text>` — save a memory\n" +
                "`/memory list` — list all memories\n" +
                "`/memory remove <id>` — remove a memory\n" +
                "`/memory clear` — clear all memories",
            );
          }
        }
      },
    });
  }

  return commands;
}
