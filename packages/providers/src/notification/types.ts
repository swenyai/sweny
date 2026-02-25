export interface NotificationPayload {
  title?: string;
  body: string;
  format?: "markdown" | "html" | "text";
}

export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<void>;
}
