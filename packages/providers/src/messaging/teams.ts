import type { ChatMessage, MessagingProvider } from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";

export interface TeamsMessagingConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  logger?: Logger;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export function teams(config: TeamsMessagingConfig): MessagingProvider {
  const log = config.logger ?? consoleLogger;

  let tokenCache: TokenCache | null = null;

  async function getAccessToken(): Promise<string> {
    if (tokenCache && Date.now() < tokenCache.expiresAt) {
      return tokenCache.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to acquire access token: ${response.status} ${text}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };

    // Cache the token with a 5-minute safety margin
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000,
    };

    log.debug("Acquired new Microsoft Graph access token");
    return tokenCache.accessToken;
  }

  function parseChannelId(channelId: string): { teamId: string; channelId: string } {
    const separatorIndex = channelId.indexOf("/");
    if (separatorIndex === -1) {
      throw new Error(`Invalid channelId format: expected "teamId/channelId", got "${channelId}"`);
    }
    return {
      teamId: channelId.slice(0, separatorIndex),
      channelId: channelId.slice(separatorIndex + 1),
    };
  }

  return {
    async sendMessage(msg: ChatMessage): Promise<{ messageId: string }> {
      const token = await getAccessToken();
      const { teamId, channelId } = parseChannelId(msg.channelId);

      const url = `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages`;

      const contentType = msg.format === "markdown" ? "html" : "text";

      const payload: Record<string, unknown> = {
        body: {
          contentType,
          content: msg.text,
        },
      };

      if (msg.threadId) {
        // Reply to an existing message thread
        const replyUrl = `${url}/${msg.threadId}/replies`;
        const response = await fetch(replyUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Failed to send reply to Teams: ${response.status} ${text}`);
        }

        const data = (await response.json()) as { id: string };
        log.debug(`Sent reply to ${msg.channelId} in thread ${msg.threadId}`);
        return { messageId: data.id };
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to send message to Teams: ${response.status} ${text}`);
      }

      const data = (await response.json()) as { id: string };
      log.debug(`Sent message to ${msg.channelId}`);
      return { messageId: data.id };
    },

    async updateMessage(channelId: string, messageId: string, text: string): Promise<void> {
      const token = await getAccessToken();
      const { teamId, channelId: channelPart } = parseChannelId(channelId);

      const url = `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelPart}/messages/${messageId}`;

      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: {
            contentType: "text",
            content: text,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to update Teams message: ${response.status} ${text}`);
      }

      log.debug(`Updated message ${messageId} in ${channelId}`);
    },
  };
}
