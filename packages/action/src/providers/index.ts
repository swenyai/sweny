import { ActionConfig } from "../config";
import { ObservabilityProvider } from "./observability/types";
import { IssueTrackerProvider } from "./issue-tracker/types";
import { NotificationProvider } from "./notification/types";
import { DatadogProvider } from "./observability/datadog";
import { LinearProvider } from "./issue-tracker/linear";
import { GitHubSummaryProvider } from "./notification/github-summary";

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
export type { ObservabilityProvider } from "./observability/types";
export type {
  LogEntry,
  AggregateResult,
  QueryOptions,
} from "./observability/types";
export type { IssueTrackerProvider } from "./issue-tracker/types";
export type {
  Issue,
  IssueCreateOptions,
  IssueSearchOptions,
  TriageHistoryEntry,
} from "./issue-tracker/types";
export type { NotificationProvider } from "./notification/types";
