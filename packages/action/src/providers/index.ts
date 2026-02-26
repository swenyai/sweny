import * as core from "@actions/core";
import { ActionConfig } from "../config.js";
import { datadog } from "@sweny/providers/observability";
import { linear } from "@sweny/providers/issue-tracking";
import { github } from "@sweny/providers/source-control";
import type { ObservabilityProvider } from "@sweny/providers/observability";
import type {
  IssueTrackingProvider,
  PrLinkCapable,
  TriageHistoryCapable,
} from "@sweny/providers/issue-tracking";
import type { SourceControlProvider } from "@sweny/providers/source-control";

const actionsLogger = { info: core.info, debug: core.debug, warn: core.warning };

type ActionIssueTracker = IssueTrackingProvider & PrLinkCapable & TriageHistoryCapable;

export interface Providers {
  observability: ObservabilityProvider;
  issueTracker: ActionIssueTracker;
  sourceControl: SourceControlProvider;
}

export function createProviders(config: ActionConfig): Providers {
  // Observability
  let observability: ObservabilityProvider;
  switch (config.observabilityProvider) {
    case "datadog":
      observability = datadog({
        apiKey: config.ddApiKey,
        appKey: config.ddAppKey,
        site: config.ddSite,
        logger: actionsLogger,
      });
      break;
    default:
      throw new Error(
        `Unsupported observability provider: ${config.observabilityProvider}`,
      );
  }

  // Issue tracker
  let issueTracker: ActionIssueTracker;
  switch (config.issueTrackerProvider) {
    case "linear":
      issueTracker = linear({ apiKey: config.linearApiKey, logger: actionsLogger });
      break;
    default:
      throw new Error(
        `Unsupported issue tracker provider: ${config.issueTrackerProvider}`,
      );
  }

  // Source control
  const scToken = config.botToken || config.githubToken;
  const [scOwner = "", scRepo = ""] = config.repository.split("/");
  const sourceControl = github({
    token: scToken,
    owner: scOwner,
    repo: scRepo,
    logger: actionsLogger,
  });

  return {
    observability,
    issueTracker,
    sourceControl,
  };
}
