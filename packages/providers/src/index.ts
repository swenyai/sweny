export type { Logger } from "./logger.js";
export { consoleLogger } from "./logger.js";

// Observability
export type { ObservabilityProvider, LogEntry, AggregateResult, LogQueryOptions } from "./observability/index.js";
export { datadog, sentry, cloudwatch } from "./observability/index.js";

// Issue Tracking
export type { IssueTrackingProvider, Issue, IssueCreateOptions, IssueUpdateOptions, IssueSearchOptions, TriageHistoryEntry, PrLinkCapable, FingerprintCapable, TriageHistoryCapable } from "./issue-tracking/index.js";
export { canLinkPr, canSearchByFingerprint, canListTriageHistory, linear, githubIssues } from "./issue-tracking/index.js";

// Notification
export type { NotificationProvider, NotificationPayload } from "./notification/index.js";
export { githubSummary, slackWebhook, teamsWebhook, discordWebhook } from "./notification/index.js";

// Source Control
export type { SourceControlProvider, PullRequest, PrCreateOptions } from "./source-control/index.js";

// Incident Management
export type { IncidentProvider, Incident, IncidentCreateOptions, OnCallEntry } from "./incident/index.js";
export { pagerduty } from "./incident/index.js";

// Messaging
export type { MessagingProvider, ChatMessage } from "./messaging/index.js";

// Auth
export type { AuthProvider, UserIdentity, LoginField } from "./auth/index.js";
export { noAuth, apiKeyAuth } from "./auth/index.js";

// Storage
export type { StorageProvider, SessionStore, PersistedSession, TranscriptEntry, MemoryStore, MemoryEntry, UserMemory, WorkspaceStore, WorkspaceFile, WorkspaceManifest } from "./storage/index.js";
export { WORKSPACE_LIMITS } from "./storage/index.js";
