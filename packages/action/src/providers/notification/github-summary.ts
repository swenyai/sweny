import * as core from "@actions/core";
import { NotificationProvider } from "./types";

export class GitHubSummaryProvider implements NotificationProvider {
  async writeSummary(content: string): Promise<void> {
    await core.summary.addRaw(content).write();
  }
}
