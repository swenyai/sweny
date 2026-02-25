export interface NotificationProvider {
  writeSummary(content: string): Promise<void>;
}
