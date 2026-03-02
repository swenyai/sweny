/** Overall status level for a notification. */
export type NotificationStatus = "success" | "error" | "warning" | "info" | "skipped";

/** A key-value metadata field. */
export interface NotificationField {
  label: string;
  value: string;
  /** Hint to render inline/side-by-side when the channel supports it. */
  short?: boolean;
}

/** A named content section (e.g. investigation log, issues report). */
export interface NotificationSection {
  title?: string;
  content: string;
}

/** An actionable link rendered as a button or hyperlink. */
export interface NotificationLink {
  label: string;
  url: string;
}

/** Payload for sending a notification. */
export interface NotificationPayload {
  /** Optional notification title. */
  title?: string;
  /** Notification body content — flat markdown fallback for all providers. */
  body: string;
  /** Content format (defaults to provider-specific default). */
  format?: "markdown" | "html" | "text";

  // -------------------------------------------------------------------------
  // Rich structured fields — used by channel-native renderers.
  // Providers that support richer layouts (Block Kit, Adaptive Cards, Discord
  // embeds, etc.) use these to build native formats.  Others fall back to body.
  // -------------------------------------------------------------------------

  /** Overall outcome — drives status indicators, colors, and emoji. */
  status?: NotificationStatus;
  /** One-line human-readable status summary (e.g. "Success: PR #42 created"). */
  summary?: string;
  /** Key-value metadata fields (e.g. Service Filter, Time Range). */
  fields?: NotificationField[];
  /** Named content sections appended after the metadata (e.g. investigation log). */
  sections?: NotificationSection[];
  /** Actionable links rendered as buttons or hyperlinks. */
  links?: NotificationLink[];
}

/** Provider interface for sending notifications. */
export interface NotificationProvider {
  /**
   * Send a notification.
   * @param payload - The notification content to send.
   */
  send(payload: NotificationPayload): Promise<void>;
}
