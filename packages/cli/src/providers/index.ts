import { createProviderRegistry } from "@sweny-ai/engine";
import type { ProviderRegistry } from "@sweny-ai/engine";
import type { CliConfig } from "../config.js";
import { datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki, file } from "@sweny-ai/providers/observability";
import type { ObservabilityProvider } from "@sweny-ai/providers/observability";
import { linear, jira, githubIssues, fileIssueTracking } from "@sweny-ai/providers/issue-tracking";
import { github, gitlab, fileSourceControl } from "@sweny-ai/providers/source-control";
import {
  slackWebhook,
  teamsWebhook,
  discordWebhook,
  email,
  webhook,
  fileNotification,
} from "@sweny-ai/providers/notification";
import { claudeCode, openaiCodex, googleGemini } from "@sweny-ai/providers/coding-agent";

export interface CliLogger {
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createProviders(config: CliConfig, logger: CliLogger): ProviderRegistry {
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
        logger,
      });
      break;
    case "sentry":
      observability = sentry({
        authToken: obsCreds.authToken,
        organization: obsCreds.organization,
        project: obsCreds.project,
        baseUrl: obsCreds.baseUrl,
        logger,
      });
      break;
    case "cloudwatch":
      observability = cloudwatch({
        region: obsCreds.region,
        logGroupPrefix: obsCreds.logGroupPrefix,
        logger,
      });
      break;
    case "splunk":
      observability = splunk({
        baseUrl: obsCreds.baseUrl,
        token: obsCreds.token,
        index: obsCreds.index,
        logger,
      });
      break;
    case "elastic":
      observability = elastic({
        baseUrl: obsCreds.baseUrl,
        apiKey: obsCreds.apiKey,
        index: obsCreds.index,
        logger,
      });
      break;
    case "newrelic":
      observability = newrelic({
        apiKey: obsCreds.apiKey,
        accountId: obsCreds.accountId,
        region: obsCreds.region as "us" | "eu",
        logger,
      });
      break;
    case "loki":
      observability = loki({
        baseUrl: obsCreds.baseUrl,
        apiKey: obsCreds.apiKey,
        orgId: obsCreds.orgId,
        logger,
      });
      break;
    case "file":
      observability = file({
        path: obsCreds.path,
        logger,
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
  switch (config.codingAgentProvider) {
    case "codex":
      registry.set("codingAgent", openaiCodex({ logger, quiet: true }));
      break;
    case "gemini":
      registry.set("codingAgent", googleGemini({ logger, quiet: true }));
      break;
    case "claude":
    default:
      registry.set("codingAgent", claudeCode({ logger, quiet: true }));
      break;
  }

  return registry;
}

/**
 * Create providers for the implement workflow.
 * Only issueTracker, sourceControl, and codingAgent are needed — no observability.
 */
export function createImplementProviders(config: CliConfig, logger: CliLogger): ProviderRegistry {
  const registry = createProviderRegistry();

  // Issue tracker
  switch (config.issueTrackerProvider) {
    case "linear":
      registry.set("issueTracker", linear({ apiKey: config.linearApiKey, logger }));
      break;
    case "jira":
      registry.set(
        "issueTracker",
        jira({ baseUrl: config.jiraBaseUrl, email: config.jiraEmail, apiToken: config.jiraApiToken, logger }),
      );
      break;
    case "github-issues":
      registry.set("issueTracker", githubIssues({ token: config.githubToken || config.botToken, logger }));
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
        gitlab({ token: config.gitlabToken, projectId: config.gitlabProjectId, baseUrl: config.gitlabBaseUrl, logger }),
      );
      break;
    case "file":
      registry.set("sourceControl", fileSourceControl({ outputDir: config.outputDir, logger }));
      break;
    case "github":
    default:
      registry.set("sourceControl", github({ token: config.githubToken || config.botToken, logger }));
      break;
  }

  // Coding agent
  switch (config.codingAgentProvider) {
    case "codex":
      registry.set("codingAgent", openaiCodex({ logger, quiet: true }));
      break;
    case "gemini":
      registry.set("codingAgent", googleGemini({ logger, quiet: true }));
      break;
    case "claude":
    default:
      registry.set("codingAgent", claudeCode({ logger, quiet: true }));
      break;
  }

  return registry;
}
