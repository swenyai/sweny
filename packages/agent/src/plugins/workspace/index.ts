import { z } from "zod";
import { agentTool } from "@sweny-ai/providers/agent-tool";
import type { AgentTool } from "@sweny-ai/providers/agent-tool";
import type { ToolPlugin, PluginContext } from "../types.js";

export function workspacePlugin(): ToolPlugin {
  return {
    name: "workspace",
    description: "File workspace tools — read, write, list, and manage files in a per-user workspace.",

    createTools(ctx: PluginContext): AgentTool[] {
      const store = ctx.storage.workspace;
      const userId = ctx.user.userId;

      return [
        agentTool(
          "workspace_list",
          "List all files in your workspace. Returns the full manifest with paths, sizes, and descriptions.",
          {},
          async () => {
            try {
              const manifest = await store.getManifest(userId);
              return { content: [{ type: "text" as const, text: JSON.stringify(manifest, null, 2) }] };
            } catch (err) {
              return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
            }
          },
        ),

        agentTool(
          "workspace_read",
          "Read the content of a file in your workspace by path.",
          {
            path: z.string().describe("File path in workspace (e.g. 'logs/error.log')"),
          },
          async (args) => {
            try {
              const content = await store.readFile(userId, args.path as string);
              return { content: [{ type: "text" as const, text: content }] };
            } catch (err) {
              return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
            }
          },
        ),

        agentTool(
          "workspace_write",
          "Write a file to your workspace. REQUIRES confirm=true to execute. Without confirm, returns a preview.",
          {
            path: z.string().describe("File path in workspace (e.g. 'logs/error.log')"),
            content: z.string().describe("File content (text)"),
            description: z.string().optional().describe("Description of what this file contains"),
            confirm: z.boolean().default(false).describe("Set to true to actually write. False returns a preview."),
          },
          async (args) => {
            try {
              if (!args.confirm) {
                const size = Buffer.byteLength(args.content as string, "utf-8");
                return {
                  content: [
                    {
                      type: "text" as const,
                      text:
                        `**Preview \u2014 workspace_write**\n` +
                        `Path: ${args.path}\n` +
                        `Size: ${size} bytes\n` +
                        `Description: ${args.description ?? "(none)"}\n\n` +
                        `Call again with confirm=true to write this file.`,
                    },
                  ],
                };
              }

              const file = await store.writeFile(
                userId,
                args.path as string,
                args.content as string,
                args.description as string | undefined,
              );
              return { content: [{ type: "text" as const, text: `Written: ${file.path} (${file.size} bytes)` }] };
            } catch (err) {
              return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
            }
          },
        ),

        agentTool(
          "workspace_delete",
          "Delete a file from your workspace. REQUIRES confirm=true to execute.",
          {
            path: z.string().describe("File path to delete"),
            confirm: z.boolean().default(false).describe("Set to true to actually delete. False returns a preview."),
          },
          async (args) => {
            try {
              if (!args.confirm) {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: `**Preview \u2014 workspace_delete**\nWill delete: ${args.path}\n\nCall again with confirm=true to delete.`,
                    },
                  ],
                };
              }

              const deleted = await store.deleteFile(userId, args.path as string);
              if (!deleted) {
                return { content: [{ type: "text" as const, text: `File not found: ${args.path}` }], isError: true };
              }
              return { content: [{ type: "text" as const, text: `Deleted: ${args.path}` }] };
            } catch (err) {
              return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
            }
          },
        ),

        agentTool(
          "workspace_reset",
          "Clear your entire workspace. REQUIRES confirm=true to execute.",
          {
            confirm: z.boolean().default(false).describe("Set to true to actually reset. False returns a preview."),
          },
          async (args) => {
            try {
              if (!args.confirm) {
                const manifest = await store.getManifest(userId);
                return {
                  content: [
                    {
                      type: "text" as const,
                      text:
                        `**Preview \u2014 workspace_reset**\n` +
                        `Will delete ${manifest.files.length} files (${manifest.totalBytes} bytes).\n\n` +
                        `Call again with confirm=true to clear the workspace.`,
                    },
                  ],
                };
              }

              await store.reset(userId);
              return { content: [{ type: "text" as const, text: "Workspace cleared." }] };
            } catch (err) {
              return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
            }
          },
        ),

        agentTool(
          "workspace_download_url",
          "Get a pre-signed download URL for a workspace file (valid for 1 hour).",
          {
            path: z.string().describe("File path in workspace"),
          },
          async (args) => {
            try {
              const url = await store.getDownloadUrl(userId, args.path as string);
              return { content: [{ type: "text" as const, text: url }] };
            } catch (err) {
              return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
            }
          },
        ),
      ];
    },

    systemPromptSection(): string {
      return [
        "## Workspace",
        "You have a per-user file workspace. Use workspace tools to save investigation results,",
        "generated reports, code snippets, or any artifacts the user might want to download or reference later.",
        "Always use confirm=true for write/delete/reset operations after previewing.",
      ].join("\n");
    },
  };
}
