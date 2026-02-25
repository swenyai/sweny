import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type { NotificationProvider, NotificationPayload } from "./types.js";

export const githubSummaryConfigSchema = z.object({
  logger: z.custom<Logger>().optional(),
});

export type GitHubSummaryConfig = z.infer<typeof githubSummaryConfigSchema>;

export function githubSummary(config?: GitHubSummaryConfig): NotificationProvider {
  return new GitHubSummaryProvider(config?.logger ?? consoleLogger);
}

class GitHubSummaryProvider implements NotificationProvider {
  private readonly log: Logger;

  constructor(logger: Logger) {
    this.log = logger;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const core = await import("@actions/core");

    const summary = core.summary;
    if (payload.title) {
      summary.addHeading(payload.title, 2);
    }
    summary.addRaw(payload.body);
    await summary.write();

    this.log.info("GitHub Action summary written");
  }
}
