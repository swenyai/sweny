import * as core from "@actions/core";
import { createProviderRegistry } from "@sweny-ai/engine";
import type { ProviderRegistry } from "@sweny-ai/engine";
import { ActionConfig } from "../config.js";
import { datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki, file } from "@sweny-ai/providers/observability";
import type { ObservabilityProvider } from "@sweny-ai/providers/observability";
import { linear, jira, githubIssues } from "@sweny-ai/providers/issue-tracking";
import { github, gitlab } from "@sweny-ai/providers/source-control";
import {
  githubSummary,
  slackWebhook,
  teamsWebhook,
  discordWebhook,
  email,
  webhook,
} from "@sweny-ai/providers/notification";
import { claudeCode, openaiCodex, googleGemini } from "@sweny-ai/providers/coding-agent";

const actionsLogger = { info: core.info, debug: core.debug, warn: core.warning, error: core.error };

export function createProviders(config: ActionConfig): ProviderRegistry {
  const registry = createProviderRegistry();

  // Observability
  let observability: ObservabilityProvider;
  const obsCreds = config.observabilityCredentials;
  switch (config.observabilityProvider) {
    case "datadog":
      observability = datadog({
        apiKey: obsCreds.apiKey,
        appKey: obsCreds.appKey,
        site: obsCreds.site,
        logger: actionsLogger,
      });
      break;
    case "sentry":
      observability = sentry({
        authToken: obsCreds.authToken,
        organization: obsCreds.organization,
        project: obsCreds.project,
        baseUrl: obsCreds.baseUrl,
        logger: actionsLogger,
      });
      break;
    case "cloudwatch":
      observability = cloudwatch({
        region: obsCreds.region,
        logGroupPrefix: obsCreds.logGroupPrefix,
        logger: actionsLogger,
      });
      break;
    case "splunk":
      observability = splunk({
        baseUrl: obsCreds.baseUrl,
        token: obsCreds.token,
        index: obsCreds.index,
        logger: actionsLogger,
      });
      break;
    case "elastic":
      observability = elastic({
        baseUrl: obsCreds.baseUrl,
        apiKey: obsCreds.apiKey,
        index: obsCreds.index,
        logger: actionsLogger,
      });
      break;
    case "newrelic":
      observability = newrelic({
        apiKey: obsCreds.apiKey,
        accountId: obsCreds.accountId,
        region: obsCreds.region as "us" | "eu",
        logger: actionsLogger,
      });
      break;
    case "loki":
      observability = loki({
        baseUrl: obsCreds.baseUrl,
        apiKey: obsCreds.apiKey,
        orgId: obsCreds.orgId,
        logger: actionsLogger,
      });
      break;
    case "file":
      observability = file({
        path: obsCreds.path,
        logger: actionsLogger,
      });
      break;
    default:
      throw new Error(`Unsupported observability provider: ${config.observabilityProvider}`);
  }
  registry.set("observability", observability);

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
    default:
      throw new Error(`Unsupported source control provider: ${config.sourceControlProvider}`);
  }

  // Issue tracker
  switch (config.issueTrackerProvider) {
    case "linear":
      registry.set("issueTracker", linear({ apiKey: config.linearApiKey, logger: actionsLogger }));
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
    default:
      registry.set("notification", githubSummary({ logger: actionsLogger }));
      break;
  }

  // Coding agent
  switch (config.codingAgentProvider) {
    case "codex":
      registry.set("codingAgent", openaiCodex({ logger: actionsLogger }));
      break;
    case "gemini":
      registry.set("codingAgent", googleGemini({ logger: actionsLogger }));
      break;
    case "claude":
    default:
      registry.set("codingAgent", claudeCode({ logger: actionsLogger }));
      break;
  }

  return registry;
}
