export interface ChatMessage {
  channelId: string;
  threadId?: string;
  text: string;
  format?: "markdown" | "text";
}

export interface MessagingProvider {
  sendMessage(msg: ChatMessage): Promise<{ messageId: string }>;
  updateMessage(channelId: string, messageId: string, text: string): Promise<void>;
}
