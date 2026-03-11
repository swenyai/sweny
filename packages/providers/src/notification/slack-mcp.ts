/**
 * MCP-backed Slack notification provider adapter.
 *
 * Wraps the `@modelcontextprotocol/server-slack` MCP server and satisfies
 * the standard NotificationProvider interface.
 *
 * REQUIREMENTS:
 *   - `@modelcontextprotocol/sdk` must be installed
 *   - `npx` must be available
 *   - `SLACK_BOT_TOKEN` — OAuth bot token with `chat:write` scope
 *   - `SLACK_TEAM_ID` — Workspace/team ID
 *
 * KNOWN GAPS vs. the native `slackWebhook()` provider:
 *   - Auth model: webhook URL → OAuth bot token. You need a Slack App with
 *     `chat:write` scope installed in the workspace (not just an incoming webhook).
 *   - Formatting: Block Kit is not used. The MCP server sends plain markdown via
 *     `slack_post_message`. Rich fields/sections/links from NotificationPayload
 *     are serialized to markdown text and included in the message body.
 *   - The `status`, `fields`, `links`, and `sections` payload fields are rendered
 *     as formatted markdown text, not native Slack blocks.
 */
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { MCPClient } from "../mcp/client.js";
import type { NotificationProvider, NotificationPayload } from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const slackMCPConfigSchema = z.object({
  botToken: z.string().min(1, "Slack bot token is required"),
  teamId: z.string().min(1, "Slack team ID is required"),
  /**
   * Slack channel ID to post to (e.g. "C123456789").
   * Must be the channel's ID, not its name — the MCP server uses `channel_id`.
   * Find it in Slack: right-click the channel → "Copy link" or check channel details.
   */
  channel: z.string().min(1, "Slack channel ID is required"),
  /** Override MCP tool name if the server version uses a different name. */
  postMessageTool: z.string().default("slack_post_message"),
  logger: z.custom<Logger>().optional(),
});

export type SlackMCPConfig = z.input<typeof slackMCPConfigSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function slackMCP(config: SlackMCPConfig): NotificationProvider {
  const parsed = slackMCPConfigSchema.parse(config);
  const log = parsed.logger ?? consoleLogger;

  const client = new MCPClient("slack-mcp", {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env: {
      SLACK_BOT_TOKEN: parsed.botToken,
      SLACK_TEAM_ID: parsed.teamId,
    },
  });

  return {
    async send(payload: NotificationPayload): Promise<void> {
      const lines: string[] = [];

      if (payload.title) lines.push(`*${payload.title}*`);
      if (payload.status) lines.push(`Status: ${payload.status.toUpperCase()}`);
      if (payload.summary) lines.push(payload.summary);
      lines.push("");
      lines.push(payload.body);

      if (payload.fields && payload.fields.length > 0) {
        lines.push("");
        for (const f of payload.fields) {
          lines.push(`• *${f.label}*: ${f.value}`);
        }
      }

      if (payload.sections && payload.sections.length > 0) {
        for (const s of payload.sections) {
          lines.push("");
          if (s.title) lines.push(`*${s.title}*`);
          lines.push(s.content);
        }
      }

      if (payload.links && payload.links.length > 0) {
        lines.push("");
        for (const l of payload.links) {
          lines.push(`<${l.url}|${l.label}>`);
        }
      }

      const text = lines
        .filter((l) => l !== undefined)
        .join("\n")
        .trim();

      await client.call(parsed.postMessageTool, {
        channel_id: parsed.channel,
        text,
      });

      log.info(`Slack MCP: notification sent to ${parsed.channel}`);
    },
  };
}
