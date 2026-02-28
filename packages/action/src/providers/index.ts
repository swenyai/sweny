import * as core from "@actions/core";
import { createProviderRegistry } from "@sweny/engine";
import type { ProviderRegistry } from "@sweny/engine";
import { ActionConfig } from "../config.js";
import { datadog, sentry, cloudwatch } from "@sweny/providers/observability";
import type { ObservabilityProvider } from "@sweny/providers/observability";
import { linear } from "@sweny/providers/issue-tracking";
import { github } from "@sweny/providers/source-control";
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
    default:
      throw new Error(`Unsupported observability provider: ${config.observabilityProvider}`);
  }
  registry.set("observability", observability);

  // Issue tracker
  switch (config.issueTrackerProvider) {
    case "linear":
      registry.set("issueTracker", linear({ apiKey: config.linearApiKey, logger: actionsLogger }));
      break;
    default:
      throw new Error(`Unsupported issue tracker provider: ${config.issueTrackerProvider}`);
  }

  // Source control
  const scToken = config.botToken || config.githubToken;
  const [scOwner = "", scRepo = ""] = config.repository.split("/");
  registry.set(
    "sourceControl",
    github({
      token: scToken,
      owner: scOwner,
      repo: scRepo,
      logger: actionsLogger,
    }),
  );

  // Notification
  registry.set("notification", githubSummary({ logger: actionsLogger }));

  // Coding agent
  registry.set("codingAgent", claudeCode({ logger: actionsLogger }));

  return registry;
}
