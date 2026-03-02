/**
 * Example plugin: HTTP Request Tool
 *
 * Demonstrates how to build a custom plugin for sweny-agent.
 * This plugin adds an HTTP request tool that lets the assistant
 * make outbound HTTP requests.
 *
 * Usage in sweny.config.ts:
 *
 *   import { httpPlugin } from "./src/examples/http-plugin/index.js";
 *
 *   export default defineConfig({
 *     ...
 *     plugins: [memoryPlugin(), workspacePlugin(), httpPlugin({ allowedHosts: ["api.example.com"] })],
 *   });
 */
import { z } from "zod";
import { agentTool } from "@sweny-ai/providers/agent-tool";
import type { AgentTool } from "@sweny-ai/providers/agent-tool";
import type { ToolPlugin, PluginContext } from "../../plugins/types.js";

export interface HttpPluginOpts {
  allowedHosts?: string[];
}

export function httpPlugin(opts: HttpPluginOpts = {}): ToolPlugin {
  return {
    name: "http",
    description: "HTTP request tool for making outbound API calls.",

    createTools(_ctx: PluginContext): AgentTool[] {
      return [
        agentTool(
          "http_request",
          "Make an HTTP request. Returns the status code, headers, and body.",
          {
            method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("HTTP method"),
            url: z.string().url().describe("Full URL to request"),
            headers: z.record(z.string()).optional().describe("Request headers"),
            body: z.string().optional().describe("Request body (for POST/PUT/PATCH)"),
          },
          async (args) => {
            try {
              const urlStr = args.url as string;
              const method = args.method as string;
              const headers = args.headers as Record<string, string> | undefined;
              const body = args.body as string | undefined;

              // Validate allowed hosts
              if (opts.allowedHosts && opts.allowedHosts.length > 0) {
                const url = new URL(urlStr);
                if (!opts.allowedHosts.includes(url.hostname)) {
                  return {
                    content: [
                      {
                        type: "text" as const,
                        text: `Host not allowed: ${url.hostname}. Allowed: ${opts.allowedHosts.join(", ")}`,
                      },
                    ],
                    isError: true,
                  };
                }
              }

              const response = await fetch(urlStr, {
                method,
                headers,
                body,
              });

              const responseBody = await response.text();
              const responseHeaders = Object.fromEntries(response.headers.entries());

              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        status: response.status,
                        statusText: response.statusText,
                        headers: responseHeaders,
                        body:
                          responseBody.length > 10000
                            ? responseBody.slice(0, 10000) + "\n...(truncated)"
                            : responseBody,
                      },
                      null,
                      2,
                    ),
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
      ];
    },

    systemPromptSection(): string {
      const hosts = opts.allowedHosts?.length
        ? `Allowed hosts: ${opts.allowedHosts.join(", ")}`
        : "All hosts are allowed.";
      return `## HTTP\nYou can make outbound HTTP requests using the \`http_request\` tool. ${hosts}`;
    },
  };
}
