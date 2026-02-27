import { App } from "@slack/bolt";
import type { AuthProvider } from "../auth/types.js";
import type {
  Channel,
  ChannelCommand,
  ConversationRef,
  IncomingMessage,
  SentMessage,
} from "./types.js";
import { formatForSlack } from "./slack-formatter.js";
import { registerLoginModal } from "./slack-login.js";

export interface SlackChannelConfig {
  appToken: string;
  botToken: string;
  signingSecret: string;
}

/**
 * Create a Slack channel adapter that implements the Channel interface.
 *
 * Wraps @slack/bolt. The adapter handles Slack I/O only -- orchestration
 * logic (auth, rate-limiting, Claude invocation) lives in the Orchestrator.
 */
export function slackChannel(config: SlackChannelConfig): Channel {
  const app = new App({
    token: config.botToken,
    appToken: config.appToken,
    signingSecret: config.signingSecret,
    socketMode: true,
  });

  let commands: ChannelCommand[] = [];

  const channel: Channel = {
    name: "slack",
    formatHint: "slack-mrkdwn",

    formatResponse(text: string): string[] {
      return formatForSlack(text);
    },

    async sendMessage(
      conversation: ConversationRef,
      text: string,
    ): Promise<SentMessage> {
      const result = await app.client.chat.postMessage({
        channel: conversation.conversationId,
        thread_ts: conversation.messageId,
        text,
      });

      return {
        ref: conversation,
        platformMessageId: result.ts ?? "",
      };
    },

    async editMessage(message: SentMessage, text: string): Promise<void> {
      await app.client.chat.update({
        channel: message.ref.conversationId,
        ts: message.platformMessageId,
        text,
      });
    },

    async start(
      onMessage: (msg: IncomingMessage) => Promise<void>,
    ): Promise<() => Promise<void>> {
      // Register direct messages
      app.message(async ({ message }) => {
        if (message.subtype) return;
        if (!("text" in message) || !message.text) return;
        if (!("user" in message) || !message.user) return;

        const threadTs =
          ("thread_ts" in message ? message.thread_ts : message.ts) ??
          message.ts;

        const msg: IncomingMessage = {
          userId: message.user,
          text: message.text,
          conversation: {
            conversationId: message.channel,
            messageId: threadTs,
          },
        };

        await onMessage(msg);
      });

      // Register @mentions
      app.event("app_mention", async ({ event }) => {
        if (!event.text || !event.user) return;

        const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
        if (!text) return;

        const threadTs = event.thread_ts ?? event.ts;

        const msg: IncomingMessage = {
          userId: event.user,
          text,
          conversation: {
            conversationId: event.channel,
            messageId: threadTs,
          },
        };

        await onMessage(msg);
      });

      await app.start();

      // Teardown
      return async () => {
        await app.stop();
      };
    },

    registerLoginUI(authProvider: AuthProvider): void {
      registerLoginModal(app, authProvider);
    },

    registerCommands(cmds: ChannelCommand[]): void {
      commands = cmds;

      for (const cmd of commands) {
        app.command(`/${cmd.name}`, async ({ ack, respond, body }) => {
          await ack();

          const conversation: ConversationRef = {
            conversationId: body.channel_id,
            messageId: body.trigger_id,
          };

          await cmd.execute({
            userId: body.user_id,
            text: body.text,
            conversation,
            respond: async (text: string) => {
              await respond({
                response_type: "ephemeral",
                text,
              });
            },
          });
        });
      }
    },
  };

  return channel;
}
