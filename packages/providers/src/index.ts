// Errors
export { ProviderError, ProviderAuthError, ProviderApiError, ProviderConfigError } from "./errors.js";

export type { Logger } from "./logger.js";
export { consoleLogger } from "./logger.js";

// Observability
export type { ObservabilityProvider, LogEntry, AggregateResult, LogQueryOptions } from "./observability/index.js";
export { datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki } from "./observability/index.js";

// Issue Tracking
export type {
  IssueTrackingProvider,
  Issue,
  IssueCreateOptions,
  IssueUpdateOptions,
  IssueSearchOptions,
  TriageHistoryEntry,
  PrLinkCapable,
  FingerprintCapable,
  TriageHistoryCapable,
} from "./issue-tracking/index.js";
export {
  canLinkPr,
  canSearchByFingerprint,
  canListTriageHistory,
  linear,
  githubIssues,
  jira,
} from "./issue-tracking/index.js";

// Notification
export type { NotificationProvider, NotificationPayload } from "./notification/index.js";
export { githubSummary, slackWebhook, teamsWebhook, discordWebhook, email } from "./notification/index.js";

// Source Control
export type {
  SourceControlProvider,
  PullRequest,
  PrCreateOptions,
  PrListOptions,
  DispatchWorkflowOptions,
  GitHubSourceControlConfig,
  GitLabSourceControlConfig,
} from "./source-control/index.js";
export { github, gitlab } from "./source-control/index.js";

// Incident Management
export type { IncidentProvider, Incident, IncidentCreateOptions, OnCallEntry } from "./incident/index.js";
export { pagerduty, opsgenie } from "./incident/index.js";

// Messaging
export type { MessagingProvider, ChatMessage, SlackMessagingConfig, TeamsMessagingConfig } from "./messaging/index.js";
export { slack, teams } from "./messaging/index.js";

// Auth
export type { AuthProvider, UserIdentity, LoginField } from "./auth/index.js";
export { noAuth, apiKeyAuth } from "./auth/index.js";

// Access
export type { AccessGuard, RoleMapping } from "./access/index.js";
export { AccessLevel, AccessDeniedError, allowAllGuard, roleBasedGuard } from "./access/index.js";

// Storage
export type {
  StorageProvider,
  SessionStore,
  PersistedSession,
  TranscriptEntry,
  MemoryStore,
  MemoryEntry,
  UserMemory,
  WorkspaceStore,
  WorkspaceFile,
  WorkspaceManifest,
  CsiStorageConfig,
} from "./storage/index.js";
export { WORKSPACE_LIMITS, csiStorage } from "./storage/index.js";

// Coding Agent
export type { CodingAgent, CodingAgentRunOptions, ClaudeCodeConfig } from "./coding-agent/index.js";
export { claudeCode } from "./coding-agent/index.js";

// Agent Tool
export type { AgentTool, ToolResult } from "./agent-tool/index.js";
export { agentTool } from "./agent-tool/index.js";

// Credential Vault
export type { CredentialVaultProvider, EnvVaultConfig, AwsSecretsManagerConfig } from "./credential-vault/index.js";
export { envVault, awsSecretsManager } from "./credential-vault/index.js";
