import { ActionConfig } from "../config.js";
import { ObservabilityProvider } from "./observability/types.js";
import { IssueTrackerProvider } from "./issue-tracker/types.js";
import { NotificationProvider } from "./notification/types.js";
import { DatadogProvider } from "./observability/datadog.js";
import { LinearProvider } from "./issue-tracker/linear.js";
import { GitHubSummaryProvider } from "./notification/github-summary.js";

export interface Providers {
  observability: ObservabilityProvider;
  issueTracker: IssueTrackerProvider;
  notification: NotificationProvider;
}

export function createProviders(config: ActionConfig): Providers {
  // Observability
  let observability: ObservabilityProvider;
  switch (config.observabilityProvider) {
    case "datadog":
      observability = new DatadogProvider({
        apiKey: config.ddApiKey,
        appKey: config.ddAppKey,
        site: config.ddSite,
      });
      break;
    default:
      throw new Error(
        `Unsupported observability provider: ${config.observabilityProvider}`,
      );
  }

  // Issue tracker
  let issueTracker: IssueTrackerProvider;
  switch (config.issueTrackerProvider) {
    case "linear":
      issueTracker = new LinearProvider({ apiKey: config.linearApiKey });
      break;
    default:
      throw new Error(
        `Unsupported issue tracker provider: ${config.issueTrackerProvider}`,
      );
  }

  return {
    observability,
    issueTracker,
    notification: new GitHubSummaryProvider(),
  };
}

// Re-export types
export type { ObservabilityProvider } from "./observability/types.js";
export type {
  LogEntry,
  AggregateResult,
  QueryOptions,
} from "./observability/types.js";
export type { IssueTrackerProvider } from "./issue-tracker/types.js";
export type {
  Issue,
  IssueCreateOptions,
  IssueSearchOptions,
  TriageHistoryEntry,
} from "./issue-tracker/types.js";
export type { NotificationProvider } from "./notification/types.js";
