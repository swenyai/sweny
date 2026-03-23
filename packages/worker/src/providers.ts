/**
 * Provider hydration for the open-source SWEny worker.
 *
 * Builds a ProviderRegistry from a decrypted credential map and job payload.
 * Adapted from the cloud worker's runner/providers.ts and runner/triage.ts.
 *
 * Priority rules:
 *   Observability: Datadog > Sentry > CloudWatch > Splunk > Elastic > New Relic >
 *                  Loki > Better Stack > Vercel > Supabase
 *   Issue tracker: Linear > Jira > GitHub Issues (fallback)
 *   Source control: GitLab (if creds present) > GitHub (fallback)
 *   Notification:  no-op (results go to the API, not chat/email)
 */

import {
  datadog,
  sentry,
  cloudwatch,
  splunk,
  elastic,
  newrelic,
  loki,
  betterstack,
  vercel,
  supabase,
} from "@sweny-ai/providers/observability";
import { linear, jira, githubIssues } from "@sweny-ai/providers/issue-tracking";
import { github, gitlab } from "@sweny-ai/providers/source-control";
import { claudeCode, googleGemini, openaiCodex } from "@sweny-ai/providers/coding-agent";
import { createProviderRegistry } from "@sweny-ai/engine";
import type { ProviderRegistry } from "@sweny-ai/engine";
import type { WorkerJobPayload } from "@sweny-ai/shared";
import type { Logger } from "./logger.js";

/**
 * Hydrate all providers from a decrypted credential map and return a populated
 * ProviderRegistry ready for use with runWorkflow.
 */
export function hydrateProviders(
  credentials: Record<string, string>,
  payload: WorkerJobPayload,
  logger: Logger,
  codingAgent: "claude" | "codex" | "gemini",
): ProviderRegistry {
  const registry = createProviderRegistry();

  // -------------------------------------------------------------------------
  // Observability — pick first provider with valid credentials
  // -------------------------------------------------------------------------

  if (credentials["DATADOG_API_KEY"] && credentials["DATADOG_APP_KEY"]) {
    registry.set(
      "observability",
      datadog({
        apiKey: credentials["DATADOG_API_KEY"],
        appKey: credentials["DATADOG_APP_KEY"],
        site: credentials["DATADOG_SITE"] ?? "datadoghq.com",
        logger,
      }),
    );
  } else if (credentials["SENTRY_AUTH_TOKEN"]) {
    registry.set(
      "observability",
      sentry({
        authToken: credentials["SENTRY_AUTH_TOKEN"],
        organization: credentials["SENTRY_ORGANIZATION"] ?? "",
        project: credentials["SENTRY_PROJECT"] ?? "",
        baseUrl: credentials["SENTRY_BASE_URL"] ?? "https://sentry.io",
        logger,
      }),
    );
  } else if (credentials["CLOUDWATCH_LOG_GROUP_PREFIX"]) {
    registry.set(
      "observability",
      cloudwatch({
        region: credentials["CLOUDWATCH_REGION"] ?? "us-east-1",
        logGroupPrefix: credentials["CLOUDWATCH_LOG_GROUP_PREFIX"],
        logger,
      }),
    );
  } else if (credentials["SPLUNK_URL"] && credentials["SPLUNK_TOKEN"]) {
    registry.set(
      "observability",
      splunk({
        baseUrl: credentials["SPLUNK_URL"],
        token: credentials["SPLUNK_TOKEN"],
        index: credentials["SPLUNK_INDEX"] ?? "main",
        logger,
      }),
    );
  } else if (credentials["ELASTIC_URL"]) {
    registry.set(
      "observability",
      elastic({
        baseUrl: credentials["ELASTIC_URL"],
        apiKey: credentials["ELASTIC_API_KEY"],
        index: credentials["ELASTIC_INDEX"] ?? "logs-*",
        logger,
      }),
    );
  } else if (credentials["NEWRELIC_API_KEY"] && credentials["NEWRELIC_ACCOUNT_ID"]) {
    registry.set(
      "observability",
      newrelic({
        apiKey: credentials["NEWRELIC_API_KEY"],
        accountId: credentials["NEWRELIC_ACCOUNT_ID"],
        region: (credentials["NEWRELIC_REGION"] as "us" | "eu") ?? "us",
        logger,
      }),
    );
  } else if (credentials["LOKI_URL"]) {
    registry.set(
      "observability",
      loki({
        baseUrl: credentials["LOKI_URL"],
        apiKey: credentials["LOKI_API_KEY"],
        orgId: credentials["LOKI_ORG_ID"],
        logger,
      }),
    );
  } else if (credentials["BETTERSTACK_API_TOKEN"] && credentials["BETTERSTACK_SOURCE_ID"]) {
    registry.set(
      "observability",
      betterstack({
        apiToken: credentials["BETTERSTACK_API_TOKEN"],
        sourceId: credentials["BETTERSTACK_SOURCE_ID"],
        tableName: credentials["BETTERSTACK_TABLE_NAME"],
        logger,
      }),
    );
  } else if (credentials["BETTERSTACK_API_TOKEN"] && credentials["BETTERSTACK_TABLE_NAME"]) {
    registry.set(
      "observability",
      betterstack({
        apiToken: credentials["BETTERSTACK_API_TOKEN"],
        tableName: credentials["BETTERSTACK_TABLE_NAME"],
        logger,
      }),
    );
  } else if (credentials["VERCEL_TOKEN"] && credentials["VERCEL_PROJECT_ID"]) {
    registry.set(
      "observability",
      vercel({
        token: credentials["VERCEL_TOKEN"],
        projectId: credentials["VERCEL_PROJECT_ID"],
        teamId: credentials["VERCEL_TEAM_ID"],
        logger,
      }),
    );
  } else if (credentials["SUPABASE_MANAGEMENT_KEY"] && credentials["SUPABASE_PROJECT_REF"]) {
    registry.set(
      "observability",
      supabase({
        managementApiKey: credentials["SUPABASE_MANAGEMENT_KEY"],
        projectRef: credentials["SUPABASE_PROJECT_REF"],
        logger,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Issue tracking — pick first provider with valid credentials
  // -------------------------------------------------------------------------

  if (credentials["LINEAR_API_KEY"]) {
    registry.set("issueTracker", linear({ apiKey: credentials["LINEAR_API_KEY"], logger }));
  } else if (credentials["JIRA_BASE_URL"] && credentials["JIRA_EMAIL"] && credentials["JIRA_API_TOKEN"]) {
    registry.set(
      "issueTracker",
      jira({
        baseUrl: credentials["JIRA_BASE_URL"],
        email: credentials["JIRA_EMAIL"],
        apiToken: credentials["JIRA_API_TOKEN"],
        logger,
      }),
    );
  } else {
    // GitHub Issues fallback
    registry.set(
      "issueTracker",
      githubIssues({
        token: credentials["GITHUB_TOKEN"] ?? "",
        owner: payload.repoOwner,
        repo: payload.repoName,
        logger,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Source control — GitLab if creds present, otherwise GitHub (fallback)
  // -------------------------------------------------------------------------

  if (credentials["GITLAB_TOKEN"] && credentials["GITLAB_PROJECT_ID"]) {
    registry.set(
      "sourceControl",
      gitlab({
        token: credentials["GITLAB_TOKEN"],
        projectId: credentials["GITLAB_PROJECT_ID"],
        baseUrl: credentials["GITLAB_BASE_URL"] ?? "https://gitlab.com",
        baseBranch: payload.defaultBranch ?? "main",
        logger,
      }),
    );
  } else {
    registry.set(
      "sourceControl",
      github({
        token: credentials["GITHUB_TOKEN"] ?? "",
        owner: payload.repoOwner,
        repo: payload.repoName,
        logger,
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Coding agent
  // -------------------------------------------------------------------------

  if (codingAgent === "gemini") {
    registry.set("codingAgent", googleGemini({ logger }));
  } else if (codingAgent === "codex") {
    registry.set("codingAgent", openaiCodex({ logger }));
  } else {
    // Default: claude
    registry.set("codingAgent", claudeCode({ logger }));
  }

  // -------------------------------------------------------------------------
  // Notification — no-op (results go to the API, not chat/email)
  // -------------------------------------------------------------------------

  registry.set("notification", { send: async () => {} });

  return registry;
}

/**
 * Build the agentEnv for passing credentials to the coding agent subprocess.
 *
 * Security note — intentional inclusions:
 *   CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY  — required for Claude Code auth
 *   OPENAI_API_KEY                               — required for Codex
 *   GEMINI_API_KEY                               — required for Gemini
 *   Observability vars (DD_*, SENTRY_*, etc.)   — agent reads logs to investigate
 *   Issue tracking vars (LINEAR_*, JIRA_*)       — agent creates/updates issues
 *   Source control vars (GITLAB_*)               — agent opens PRs on GitLab repos
 *
 * Intentional exclusion:
 *   GITHUB_TOKEN — git auth uses a credential-store file (not an env var) to
 *                  prevent token leakage via child-process environment inspection.
 */
export function buildAgentEnv(credentials: Record<string, string>): Record<string, string> {
  const agentEnv: Record<string, string> = {};

  const envMap: Record<string, string | undefined> = {
    // Coding agent auth
    CLAUDE_CODE_OAUTH_TOKEN: credentials["CLAUDE_CODE_OAUTH_TOKEN"],
    ANTHROPIC_API_KEY: credentials["ANTHROPIC_API_KEY"],
    OPENAI_API_KEY: credentials["OPENAI_API_KEY"],
    GEMINI_API_KEY: credentials["GEMINI_API_KEY"],

    // Observability
    DD_API_KEY: credentials["DATADOG_API_KEY"],
    DD_APP_KEY: credentials["DATADOG_APP_KEY"],
    DD_SITE: credentials["DATADOG_SITE"],
    SENTRY_AUTH_TOKEN: credentials["SENTRY_AUTH_TOKEN"],
    SENTRY_ORGANIZATION: credentials["SENTRY_ORGANIZATION"],
    SENTRY_PROJECT: credentials["SENTRY_PROJECT"],
    AWS_REGION: credentials["CLOUDWATCH_REGION"],
    CW_LOG_GROUP_PREFIX: credentials["CLOUDWATCH_LOG_GROUP_PREFIX"],
    SPLUNK_URL: credentials["SPLUNK_URL"],
    SPLUNK_TOKEN: credentials["SPLUNK_TOKEN"],
    SPLUNK_INDEX: credentials["SPLUNK_INDEX"],
    ELASTIC_URL: credentials["ELASTIC_URL"],
    ELASTIC_API_KEY: credentials["ELASTIC_API_KEY"],
    ELASTIC_INDEX: credentials["ELASTIC_INDEX"],
    NEWRELIC_API_KEY: credentials["NEWRELIC_API_KEY"],
    NEWRELIC_ACCOUNT_ID: credentials["NEWRELIC_ACCOUNT_ID"],
    NEWRELIC_REGION: credentials["NEWRELIC_REGION"],
    LOKI_URL: credentials["LOKI_URL"],
    LOKI_API_KEY: credentials["LOKI_API_KEY"],
    LOKI_ORG_ID: credentials["LOKI_ORG_ID"],
    BETTERSTACK_API_TOKEN: credentials["BETTERSTACK_API_TOKEN"],
    BETTERSTACK_SOURCE_ID: credentials["BETTERSTACK_SOURCE_ID"],
    BETTERSTACK_TABLE_NAME: credentials["BETTERSTACK_TABLE_NAME"],
    VERCEL_TOKEN: credentials["VERCEL_TOKEN"],
    VERCEL_PROJECT_ID: credentials["VERCEL_PROJECT_ID"],
    VERCEL_TEAM_ID: credentials["VERCEL_TEAM_ID"],
    SUPABASE_MANAGEMENT_KEY: credentials["SUPABASE_MANAGEMENT_KEY"],
    SUPABASE_PROJECT_REF: credentials["SUPABASE_PROJECT_REF"],

    // Issue tracking
    LINEAR_API_KEY: credentials["LINEAR_API_KEY"],
    LINEAR_TEAM_ID: credentials["LINEAR_TEAM_ID"],
    JIRA_BASE_URL: credentials["JIRA_BASE_URL"],
    JIRA_EMAIL: credentials["JIRA_EMAIL"],
    JIRA_API_TOKEN: credentials["JIRA_API_TOKEN"],

    // Source control — GitLab only (GITHUB_TOKEN excluded intentionally)
    GITLAB_TOKEN: credentials["GITLAB_TOKEN"],
    GITLAB_PROJECT_ID: credentials["GITLAB_PROJECT_ID"],
    GITLAB_BASE_URL: credentials["GITLAB_BASE_URL"],
  };

  for (const [k, v] of Object.entries(envMap)) {
    if (v) agentEnv[k] = v;
  }

  return agentEnv;
}
