import type { App } from "@slack/bolt";
import type { SessionManager } from "../session/manager.js";
import type { MemoryStore } from "../storage/memory/types.js";

export function registerCommands(app: App, sessionManager: SessionManager, memoryStore: MemoryStore): void {
  app.command("/new", async ({ ack, respond, body }) => {
    await ack();
    sessionManager.clearAllForUser(body.user_id);
    await respond({
      response_type: "ephemeral",
      text: "Session cleared. Your next message will start a fresh conversation.",
    });
  });

  app.command("/memory", async ({ ack, respond, body }) => {
    await ack();

    const args = body.text.trim();
    const spaceIdx = args.indexOf(" ");
    const subcommand = spaceIdx === -1 ? args : args.slice(0, spaceIdx);
    const rest = spaceIdx === -1 ? "" : args.slice(spaceIdx + 1).trim();

    switch (subcommand) {
      case "add": {
        if (!rest) {
          await respond({ response_type: "ephemeral", text: "Usage: `/memory add <text>`" });
          return;
        }
        const entry = await memoryStore.addEntry(body.user_id, rest);
        await respond({
          response_type: "ephemeral",
          text: `Memory saved (id: \`${entry.id}\`): ${entry.text}`,
        });
        break;
      }

      case "list": {
        const memories = await memoryStore.getMemories(body.user_id);
        if (memories.entries.length === 0) {
          await respond({ response_type: "ephemeral", text: "No memories saved. Use `/memory add <text>` to save one." });
          return;
        }
        const lines = memories.entries.map((e, i) => `${i + 1}. \`${e.id}\` — ${e.text}`);
        await respond({
          response_type: "ephemeral",
          text: `*Your memories:*\n${lines.join("\n")}`,
        });
        break;
      }

      case "remove": {
        if (!rest) {
          await respond({ response_type: "ephemeral", text: "Usage: `/memory remove <id>`" });
          return;
        }
        const removed = await memoryStore.removeEntry(body.user_id, rest);
        await respond({
          response_type: "ephemeral",
          text: removed ? `Memory \`${rest}\` removed.` : `Memory \`${rest}\` not found.`,
        });
        break;
      }

      case "clear": {
        await memoryStore.clearMemories(body.user_id);
        await respond({ response_type: "ephemeral", text: "All memories cleared." });
        break;
      }

      default: {
        await respond({
          response_type: "ephemeral",
          text: "*Memory commands:*\n`/memory add <text>` — save a memory\n`/memory list` — list all memories\n`/memory remove <id>` — remove a memory\n`/memory clear` — clear all memories",
        });
      }
    }
  });
}
