import * as core from "@actions/core";
import { createProviderRegistry } from "@sweny/engine";
import type { ProviderRegistry } from "@sweny/engine";
import { ActionConfig } from "../config.js";
import { datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki } from "@sweny/providers/observability";
import type { ObservabilityProvider } from "@sweny/providers/observability";
import { linear, jira, githubIssues } from "@sweny/providers/issue-tracking";
import { github, gitlab } from "@sweny/providers/source-control";
import { githubSummary } from "@sweny/providers/notification";
import { claudeCode } from "@sweny/providers/coding-agent";

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
          baseBranch: "main",
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
  registry.set("notification", githubSummary({ logger: actionsLogger }));

  // Coding agent
  registry.set("codingAgent", claudeCode({ logger: actionsLogger }));

  return registry;
}
