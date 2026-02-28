import { z } from "zod";
import { agentTool } from "@sweny/providers/agent-tool";
import type { AgentTool } from "@sweny/providers/agent-tool";
import type { ToolPlugin, PluginContext } from "../types.js";

export function memoryPlugin(): ToolPlugin {
  return {
    name: "memory",
    description: "Persistent memory tools — save, list, and remove notes across sessions.",

    createTools(ctx: PluginContext): AgentTool[] {
      const store = ctx.storage.memory;
      const userId = ctx.user.userId;

      return [
        agentTool(
          "memory_save",
          "Save a note that persists across sessions. Use this to remember user preferences, frequently-referenced IDs, investigation context, or anything useful for future conversations.",
          {
            text: z.string().describe("The text to save as a memory note"),
          },
          async (args) => {
            try {
              const entry = await store.addEntry(userId, args.text as string);
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Memory saved (id: ${entry.id}): ${entry.text}`,
                  },
                ],
              };
            } catch (err) {
              return {
                content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
                isError: true,
              };
            }
          },
        ),

        agentTool(
          "memory_list",
          "List all saved memory notes for the current user. These persist across sessions.",
          {},
          async () => {
            try {
              const memory = await store.getMemories(userId);
              if (memory.entries.length === 0) {
                return {
                  content: [{ type: "text" as const, text: "No memories saved." }],
                };
              }
              const lines = memory.entries.map((e) => `- [${e.id}] ${e.text} (saved ${e.createdAt})`);
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `**Saved memories (${memory.entries.length}):**\n${lines.join("\n")}`,
                  },
                ],
              };
            } catch (err) {
              return {
                content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
                isError: true,
              };
            }
          },
        ),

        agentTool(
          "memory_remove",
          "Remove a saved memory note by its ID.",
          {
            entryId: z.string().describe("The ID of the memory entry to remove"),
          },
          async (args) => {
            try {
              const removed = await store.removeEntry(userId, args.entryId as string);
              if (!removed) {
                return {
                  content: [{ type: "text" as const, text: `Memory not found: ${args.entryId}` }],
                  isError: true,
                };
              }
              return {
                content: [{ type: "text" as const, text: `Memory removed: ${args.entryId}` }],
              };
            } catch (err) {
              return {
                content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
                isError: true,
              };
            }
          },
        ),
      ];
    },

    systemPromptSection(): string {
      return [
        "## Memory",
        "You have access to persistent memory tools. Use `memory_save` to remember important context,",
        "preferences, or frequently-used information across sessions.",
        "Use `memory_list` to recall saved notes and `memory_remove` to clean up stale entries.",
      ].join("\n");
    },
  };
}
