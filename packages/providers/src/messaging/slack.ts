import type { ChatMessage, MessagingProvider } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";

export interface SlackMessagingConfig {
  token: string;
  logger?: Logger;
}

export function slack(config: SlackMessagingConfig): MessagingProvider {
  const log = config.logger ?? consoleLogger;

  // Lazy-load @slack/web-api to keep it optional
  let clientPromise: Promise<InstanceType<typeof import("@slack/web-api").WebClient>> | null = null;

  async function getClient() {
    if (!clientPromise) {
      clientPromise = import("@slack/web-api").then((mod) => new mod.WebClient(config.token));
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
