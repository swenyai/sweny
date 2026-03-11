import * as core from "@actions/core";
import { createProviderRegistry } from "@sweny-ai/engine";
import type { ProviderRegistry } from "@sweny-ai/engine";
import { ActionConfig } from "../config.js";
import { createObservabilityProvider, createCodingAgentProvider } from "@sweny-ai/providers";
import { linear, jira, githubIssues, linearMCP, fileIssueTracking } from "@sweny-ai/providers/issue-tracking";
import { github, gitlab, fileSourceControl } from "@sweny-ai/providers/source-control";
import {
  githubSummary,
  slackWebhook,
  teamsWebhook,
  discordWebhook,
  email,
  webhook,
  fileNotification,
  slackMCP,
} from "@sweny-ai/providers/notification";

const actionsLogger = { info: core.info, debug: core.debug, warn: core.warning, error: core.error };

export function createProviders(config: ActionConfig): ProviderRegistry {
  const registry = createProviderRegistry();

  // Observability
  registry.set(
    "observability",
    createObservabilityProvider(config.observabilityProvider, config.observabilityCredentials, actionsLogger),
  );

  // Source control
  const scToken = config.botToken || config.githubToken;
  const [scOwner = "", scRepo = ""] = config.repository.split("/");

  switch (config.sourceControlProvider) {
    case "github":
      registry.set("sourceControl", github({ token: scToken, owner: scOwner, repo: scRepo, logger: actionsLogger }));
      break;
    case "gitlab":
      registry.set(
        "sourceControl",
        gitlab({
          token: config.gitlabToken,
          projectId: config.gitlabProjectId,
          baseUrl: config.gitlabBaseUrl,
          baseBranch: config.baseBranch,
          logger: actionsLogger,
        }),
      );
      break;
    case "file":
      registry.set(
        "sourceControl",
        fileSourceControl({ outputDir: config.outputDir, baseBranch: config.baseBranch, logger: actionsLogger }),
      );
      break;
    default:
      throw new Error(`Unsupported source control provider: ${config.sourceControlProvider}`);
  }

  // Issue tracker
  switch (config.issueTrackerProvider) {
    case "linear":
      registry.set("issueTracker", linear({ apiKey: config.linearApiKey, logger: actionsLogger }));
      break;
    case "linear-mcp":
      registry.set("issueTracker", linearMCP({ apiKey: config.linearApiKey, logger: actionsLogger }));
      break;
    case "jira":
      registry.set(
        "issueTracker",
        jira({
          baseUrl: config.jiraBaseUrl,
          email: config.jiraEmail,
          apiToken: config.jiraApiToken,
          logger: actionsLogger,
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
          logger: actionsLogger,
        }),
      );
      break;
    case "file":
      registry.set("issueTracker", fileIssueTracking({ outputDir: config.outputDir, logger: actionsLogger }));
      break;
    default:
      throw new Error(`Unsupported issue tracker provider: ${config.issueTrackerProvider}`);
  }

  // Notification
  switch (config.notificationProvider) {
    case "slack":
      registry.set("notification", slackWebhook({ webhookUrl: config.notificationWebhookUrl, logger: actionsLogger }));
      break;
    case "teams":
      registry.set("notification", teamsWebhook({ webhookUrl: config.notificationWebhookUrl, logger: actionsLogger }));
      break;
    case "discord":
      registry.set(
        "notification",
        discordWebhook({ webhookUrl: config.notificationWebhookUrl, logger: actionsLogger }),
      );
      break;
    case "email":
      registry.set(
        "notification",
        email({
          apiKey: config.sendgridApiKey,
          from: config.emailFrom,
          to: config.emailTo.split(",").map((e) => e.trim()),
          logger: actionsLogger,
        }),
      );
      break;
    case "webhook":
      registry.set(
        "notification",
        webhook({
          url: config.notificationWebhookUrl,
          signingSecret: config.webhookSigningSecret || undefined,
          logger: actionsLogger,
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
          logger: actionsLogger,
        }),
      );
      break;
    case "file":
      registry.set("notification", fileNotification({ outputDir: config.outputDir, logger: actionsLogger }));
      break;
    default:
      registry.set("notification", githubSummary({ logger: actionsLogger }));
      break;
  }

  // Coding agent
  registry.set("codingAgent", createCodingAgentProvider(config.codingAgentProvider, actionsLogger));

  return registry;
}
