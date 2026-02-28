/** Payload for sending a notification. */
export interface NotificationPayload {
  /** Optional notification title. */
  title?: string;
  /** Notification body content. */
  body: string;
  /** Content format (defaults to provider-specific default). */
  format?: "markdown" | "html" | "text";
}

/** Provider interface for sending notifications. */
export interface NotificationProvider {
  /**
   * Send a notification.
   * @param payload - The notification content to send.
   */
  send(payload: NotificationPayload): Promise<void>;
}
