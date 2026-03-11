import { createProviderRegistry } from "@sweny-ai/engine";
import type { ProviderRegistry } from "@sweny-ai/engine";
import type { CliConfig } from "../config.js";
import { createObservabilityProvider, createCodingAgentProvider } from "@sweny-ai/providers";
import { linear, jira, githubIssues, fileIssueTracking, linearMCP } from "@sweny-ai/providers/issue-tracking";
import { github, gitlab, fileSourceControl } from "@sweny-ai/providers/source-control";
import {
  slackWebhook,
  teamsWebhook,
  discordWebhook,
  email,
  webhook,
  fileNotification,
  slackMCP,
} from "@sweny-ai/providers/notification";

export interface CliLogger {
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createProviders(config: CliConfig, logger: CliLogger): ProviderRegistry {
  const registry = createProviderRegistry();

  // Observability
  registry.set(
    "observability",
    createObservabilityProvider(config.observabilityProvider, config.observabilityCredentials, logger),
  );

  // Source control
  const scToken = config.botToken || config.githubToken;
  const [scOwner = "", scRepo = ""] = config.repository.split("/");

  switch (config.sourceControlProvider) {
    case "github":
      registry.set("sourceControl", github({ token: scToken, owner: scOwner, repo: scRepo, logger }));
      break;
    case "gitlab":
      registry.set(
        "sourceControl",
        gitlab({
          token: config.gitlabToken,
          projectId: config.gitlabProjectId,
          baseUrl: config.gitlabBaseUrl,
          baseBranch: config.baseBranch,
          logger,
        }),
      );
      break;
    case "file":
      registry.set(
        "sourceControl",
        fileSourceControl({
          outputDir: config.outputDir,
          baseBranch: config.baseBranch,
          logger,
        }),
      );
      break;
    default:
      throw new Error(`Unsupported source control provider: ${config.sourceControlProvider}`);
  }

  // Issue tracker
  switch (config.issueTrackerProvider) {
    case "linear":
      registry.set("issueTracker", linear({ apiKey: config.linearApiKey, logger }));
      break;
    case "linear-mcp":
      registry.set("issueTracker", linearMCP({ apiKey: config.linearApiKey, logger }));
      break;
    case "jira":
      registry.set(
        "issueTracker",
        jira({
          baseUrl: config.jiraBaseUrl,
          email: config.jiraEmail,
          apiToken: config.jiraApiToken,
          logger,
        }),
      );
      break;
    case "github-issues":
      registry.set(
        "issueTracker",
        githubIssues({
          token: config.githubToken,
          owner: scOwner,
          repo: scRepo,
          logger,
        }),
      );
      break;
    case "file":
      registry.set(
        "issueTracker",
        fileIssueTracking({
          outputDir: config.outputDir,
          logger,
        }),
      );
      break;
    default:
      throw new Error(`Unsupported issue tracker provider: ${config.issueTrackerProvider}`);
  }

  // Notification
  switch (config.notificationProvider) {
    case "slack":
      registry.set("notification", slackWebhook({ webhookUrl: config.notificationWebhookUrl, logger }));
      break;
    case "teams":
      registry.set("notification", teamsWebhook({ webhookUrl: config.notificationWebhookUrl, logger }));
      break;
    case "discord":
      registry.set("notification", discordWebhook({ webhookUrl: config.notificationWebhookUrl, logger }));
      break;
    case "email":
      registry.set(
        "notification",
        email({
          apiKey: config.sendgridApiKey,
          from: config.emailFrom,
          to: config.emailTo.split(",").map((e) => e.trim()),
          logger,
        }),
      );
      break;
    case "webhook":
      registry.set(
        "notification",
        webhook({
          url: config.notificationWebhookUrl,
          signingSecret: config.webhookSigningSecret || undefined,
          logger,
        }),
      );
      break;
    case "slack-mcp":
      registry.set(
        "notification",
        slackMCP({
          botToken: config.slackBotToken,
          teamId: config.slackTeamId,
          channel: config.slackChannel,
          logger,
        }),
      );
      break;
    case "file":
      registry.set(
        "notification",
        fileNotification({
          outputDir: config.outputDir,
          logger,
        }),
      );
      break;
    case "console":
    default:
      // Console notification — print to stdout instead of GitHub summary
      registry.set("notification", {
        async send(payload: { title?: string; body: string }): Promise<void> {
          if (payload.title) logger.info(`\n${payload.title}`);
          logger.info(payload.body);
        },
      });
      break;
  }

  // Coding agent — quiet mode suppresses agent stdout in CLI
  registry.set("codingAgent", createCodingAgentProvider(config.codingAgentProvider, logger, { quiet: true }));

  return registry;
}

/**
 * Create providers for the implement workflow.
 * Only issueTracker, sourceControl, and codingAgent are needed — no observability.
 */
export function createImplementProviders(config: CliConfig, logger: CliLogger): ProviderRegistry {
  const registry = createProviderRegistry();
  const [implOwner = "", implRepo = ""] = config.repository.split("/");

  // Issue tracker
  switch (config.issueTrackerProvider) {
    case "linear":
      registry.set("issueTracker", linear({ apiKey: config.linearApiKey, logger }));
      break;
    case "linear-mcp":
      registry.set("issueTracker", linearMCP({ apiKey: config.linearApiKey, logger }));
      break;
    case "jira":
      registry.set(
        "issueTracker",
        jira({ baseUrl: config.jiraBaseUrl, email: config.jiraEmail, apiToken: config.jiraApiToken, logger }),
      );
      break;
    case "github-issues":
      registry.set(
        "issueTracker",
        githubIssues({ token: config.githubToken || config.botToken, owner: implOwner, repo: implRepo, logger }),
      );
      break;
    case "file":
    default:
      registry.set("issueTracker", fileIssueTracking({ outputDir: config.outputDir, logger }));
      break;
  }

  // Source control
  switch (config.sourceControlProvider) {
    case "gitlab":
      registry.set(
        "sourceControl",
        gitlab({
          token: config.gitlabToken,
          projectId: config.gitlabProjectId,
          baseUrl: config.gitlabBaseUrl,
          baseBranch: config.baseBranch,
          logger,
        }),
      );
      break;
    case "file":
      registry.set(
        "sourceControl",
        fileSourceControl({ outputDir: config.outputDir, baseBranch: config.baseBranch, logger }),
      );
      break;
    case "github":
    default:
      registry.set(
        "sourceControl",
        github({ token: config.githubToken || config.botToken, owner: implOwner, repo: implRepo, logger }),
      );
      break;
  }

  // Coding agent
  registry.set("codingAgent", createCodingAgentProvider(config.codingAgentProvider, logger, { quiet: true }));

  return registry;
}
