import { z } from "zod";
import type { ChatMessage, MessagingProvider } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";

export const slackMessagingConfigSchema = z.object({
  token: z.string().min(1, "Slack bot token is required"),
  logger: z.custom<Logger>().optional(),
});

export type SlackMessagingConfig = z.infer<typeof slackMessagingConfigSchema>;

export function slack(config: SlackMessagingConfig): MessagingProvider {
  const parsed = slackMessagingConfigSchema.parse(config);
  const log = parsed.logger ?? consoleLogger;

  // Lazy-load @slack/web-api to keep it optional
  let clientPromise: Promise<InstanceType<typeof import("@slack/web-api").WebClient>> | null = null;

  async function getClient() {
    if (!clientPromise) {
      clientPromise = import("@slack/web-api").then((mod) => new mod.WebClient(parsed.token));
    }
    return clientPromise;
  }

  return {
    async sendMessage(msg: ChatMessage): Promise<{ messageId: string }> {
      const client = await getClient();
      const result = await client.chat.postMessage({
        channel: msg.channelId,
        text: msg.text,
        ...(msg.threadId ? { thread_ts: msg.threadId } : {}),
        ...(msg.format === "markdown" ? { mrkdwn: true } : {}),
      });
      log.debug(`Sent message to ${msg.channelId}`);
      return { messageId: result.ts ?? "" };
    },

    async updateMessage(channelId: string, messageId: string, text: string): Promise<void> {
      const client = await getClient();
      await client.chat.update({
        channel: channelId,
        ts: messageId,
        text,
      });
      log.debug(`Updated message ${messageId} in ${channelId}`);
    },
  };
}
