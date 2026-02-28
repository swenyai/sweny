/** A chat message to send via a messaging provider. */
export interface ChatMessage {
  /** Target channel identifier. */
  channelId: string;
  /** Thread identifier for threaded replies (omit for top-level messages). */
  threadId?: string;
  /** Message text content. */
  text: string;
  /** Text format (defaults to provider-specific default). */
  format?: "markdown" | "text";
}

/** Provider interface for sending and updating chat messages. */
export interface MessagingProvider {
  /**
   * Send a message to a channel.
   * @param msg - The chat message to send.
   * @returns An object containing the provider-assigned message ID.
   */
  sendMessage(msg: ChatMessage): Promise<{ messageId: string }>;

  /**
   * Update an existing message.
   * @param channelId - Channel containing the message.
   * @param messageId - ID of the message to update.
   * @param text - New message text content.
   */
  updateMessage(channelId: string, messageId: string, text: string): Promise<void>;
}
