import type { AuthProvider } from "../auth/types.js";

/** Unique identifier for a conversation context (thread, DM, channel, etc.) */
export interface ConversationRef {
  conversationId: string; // generic ID (Slack: channelId, Discord: channelId)
  messageId: string; // generic ID (Slack: threadTs, Discord: messageId)
}

/** A handle to a sent message, for editing later */
export interface SentMessage {
  ref: ConversationRef;
  platformMessageId: string; // platform-specific (Slack: ts, Discord: snowflake)
}

/** Inbound message from user to agent */
export interface IncomingMessage {
  userId: string;
  text: string;
  conversation: ConversationRef;
}

/** A command the channel supports (e.g., /new, /memory) */
export interface ChannelCommand {
  name: string;
  description: string;
  execute: (args: {
    userId: string;
    text: string;
    conversation: ConversationRef;
    respond: (text: string) => Promise<void>;
  }) => Promise<void>;
}

/** The core channel adapter interface */
export interface Channel {
  /** Human-readable name: "slack", "cli", "discord" */
  readonly name: string;

  /** Format hint for system prompt: "slack-mrkdwn", "plaintext", "discord-markdown" */
  readonly formatHint: string;

  /** Split/format response for this channel's constraints (e.g., Slack 3000-char chunks) */
  formatResponse(text: string): string[];

  /** Send a message in the given conversation */
  sendMessage(conversation: ConversationRef, text: string): Promise<SentMessage>;

  /** Edit a previously sent message (optional -- CLI can't do this) */
  editMessage?(message: SentMessage, text: string): Promise<void>;

  /** Start listening. Calls onMessage for each user message. Returns teardown function. */
  start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<() => Promise<void>>;

  /** Optional: register login UI (Slack modals, etc.) */
  registerLoginUI?(authProvider: AuthProvider): void;

  /** Optional: register commands */
  registerCommands?(commands: ChannelCommand[]): void;
}
