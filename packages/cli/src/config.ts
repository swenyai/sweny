import { execSync } from "node:child_process";
import * as fs from "node:fs";
import type { Command } from "commander";
import type { MCPServerConfig } from "@sweny-ai/providers";

export interface CliConfig {
  // Coding agent
  codingAgentProvider: string;

  // Authentication
  anthropicApiKey: string;
  claudeOauthToken: string;
  openaiApiKey: string;
  geminiApiKey: string;

  // Observability
  observabilityProvider: string;
  observabilityCredentials: Record<string, string>;

  // Issue tracker
  issueTrackerProvider: string;
  linearApiKey: string;
  linearTeamId: string;
  linearBugLabelId: string;
  linearTriageLabelId: string;
  linearStateBacklog: string;
  linearStateInProgress: string;
  linearStatePeerReview: string;

  // Investigation params
  timeRange: string;
  severityFocus: string;
  serviceFilter: string;
  investigationDepth: string;
  maxInvestigateTurns: number;
  maxImplementTurns: number;

  // PR / branch settings
  baseBranch: string;
  prLabels: string[];
  issueLabels: string[];

  // Behavior
  dryRun: boolean;
  reviewMode: "auto" | "review";
  noveltyMode: boolean;
  issueOverride: string;
  additionalInstructions: string;
  serviceMapPath: string;
  githubToken: string;
  botToken: string;

  // Source control
  sourceControlProvider: string;

  // Jira credentials
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;

  // GitLab credentials
  gitlabToken: string;
  gitlabProjectId: string;
  gitlabBaseUrl: string;

  // Notification
  notificationProvider: string;
  notificationWebhookUrl: string;
  sendgridApiKey: string;
  emailFrom: string;
  emailTo: string;
  webhookSigningSecret: string;
  // Runtime context
  repository: string;
  repositoryOwner: string;

  // CLI-specific
  json: boolean;
  bell: boolean;

  // Cache
  cacheDir: string;
  cacheTtl: number;
  noCache: boolean;

  // Output (file providers)
  outputDir: string;

  // MCP servers for agent tool access
  mcpServers: Record<string, MCPServerConfig>;

  // Workspace tool integrations — explicit opt-in for Category B MCP servers.
  // Credential env vars must also be present for injection to occur.
  // Supported: slack, notion, pagerduty, monday
  workspaceTools: string[];
}

export function registerTriageCommand(program: Command): Command {
  // NOTE: File-eligible options omit Commander defaults so parseCliInputs() can
  // distinguish "user passed flag" from "not passed" and fall through to .sweny.yml.
  return program
    .command("triage")
    .description("Run the SWEny triage workflow")
    .option("--agent <provider>", "Coding agent: claude (default), codex, gemini")
    .option("--coding-agent-provider <provider>", "Coding agent provider (alias for --agent)")
    .option("--observability-provider <provider>", "Observability provider (default: datadog)")
    .option("--issue-tracker-provider <provider>", "Issue tracker provider (default: github-issues)")
    .option("--source-control-provider <provider>", "Source control provider (default: github)")
    .option("--notification-provider <provider>", "Notification provider (default: console)")
    .option("--time-range <range>", "Time range to analyze (default: 24h)")
    .option("--severity-focus <focus>", "Severity level focus (default: errors)")
    .option("--service-filter <filter>", "Service filter pattern (default: *)")
    .option("--investigation-depth <depth>", "Investigation depth (default: standard)")
    .option("--max-investigate-turns <n>", "Max Claude turns for investigation (default: 50)")
    .option("--max-implement-turns <n>", "Max Claude turns for implementation (default: 30)")
    .option("--base-branch <branch>", "Base branch for PRs (default: main)")
    .option("--pr-labels <labels>", "Comma-separated PR labels (default: agent,triage,needs-review)")
    .option("--dry-run", "Analyze only, do not create issues or PRs", false)
    .option(
      "--review-mode <mode>",
      "PR merge behavior: auto (merge when CI passes) | review (human approval, default)",
      "review",
    )
    .option("--no-novelty-mode", "Disable novelty mode (allow +1 on existing issues)")
    .option("--issue-override <issue>", "Work on a specific existing issue")
    .option("--additional-instructions <text>", "Extra instructions for the Claude agent")
    .option("--service-map-path <path>", "Path to service map YAML (default: .github/service-map.yml)")
    .option("--repository <owner/repo>", "Repository (auto-detected from git remote)")
    .option("--linear-team-id <id>", "Linear team ID")
    .option("--linear-bug-label-id <id>", "Linear bug label ID")
    .option("--linear-triage-label-id <id>", "Linear triage label ID")
    .option(
      "--issue-labels <labels>",
      "Comma-separated extra labels applied to every agent-created issue (e.g. agent UUID for Linear, 'agent' for GitHub Issues)",
    )
    .option("--linear-state-backlog <name>", "Linear backlog state name")
    .option("--linear-state-in-progress <name>", "Linear in-progress state name")
    .option("--linear-state-peer-review <name>", "Linear peer-review state name")
    .option("--log-file <path>", "Path to JSON log file (use with --observability-provider file)")
    .option("--dd-site <site>", "Datadog site (default: datadoghq.com)")
    .option("--sentry-org <org>", "Sentry organization slug")
    .option("--sentry-project <project>", "Sentry project slug")
    .option("--sentry-base-url <url>", "Sentry base URL (default: https://sentry.io)")
    .option("--cloudwatch-region <region>", "AWS CloudWatch region (default: us-east-1)")
    .option("--cloudwatch-log-group-prefix <prefix>", "CloudWatch log group prefix")
    .option("--splunk-index <index>", "Splunk index (default: main)")
    .option("--elastic-index <index>", "Elasticsearch index (default: logs-*)")
    .option("--newrelic-region <region>", "New Relic region (default: us)")
    .option("--prometheus-url <url>", "Prometheus base URL (required for prometheus provider)")
    .option("--prometheus-token <token>", "Prometheus bearer token (optional)")
    .option("--heroku-app-name <name>", "Heroku application name (required for heroku provider)")
    .option("--opsgenie-region <region>", "OpsGenie region (default: us)")
    .option("--honeycomb-dataset <name>", "Honeycomb dataset name (required for honeycomb provider)")
    .option("--axiom-dataset <name>", "Axiom dataset name (required for axiom provider)")
    .option("--axiom-org-id <id>", "Axiom org ID (required for multi-org Axiom accounts)")
    .option("--betterstack-source-id <id>", "Better Stack log source ID (used to auto-discover ClickHouse table)")
    .option("--betterstack-table-name <name>", 'Better Stack ClickHouse table name, e.g. "t273774.my_source"')
    .option("--gitlab-base-url <url>", "GitLab base URL (default: https://gitlab.com)")
    .option("--json", "Output results as JSON", false)
    .option("--bell", "Ring terminal bell on completion", false)
    .option("--cache-dir <path>", "Step cache directory (default: .sweny/cache)")
    .option("--cache-ttl <seconds>", "Cache TTL in seconds, 0 = infinite (default: 86400)")
    .option("--no-cache", "Disable step cache")
    .option("--output-dir <path>", "Output directory for file providers (default: .sweny/output)")
    .option(
      "--workspace-tools <tools>",
      "Comma-separated workspace tool integrations to enable (slack, notion, pagerduty, monday)",
    );
}

export function parseCliInputs(options: Record<string, unknown>, fileConfig: Record<string, string> = {}): CliConfig {
  const env = process.env;
  // Config file lookup helper: CLI flag > env var > file > default
  const f = (key: string): string | undefined => fileConfig[key] || undefined;

  const obsProvider = (options.observabilityProvider as string) || f("observability-provider") || "datadog";

  return {
    codingAgentProvider:
      (options.agent as string) || (options.codingAgentProvider as string) || f("coding-agent-provider") || "claude",

    // Secrets: env only — never from config file
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    claudeOauthToken: env.CLAUDE_CODE_OAUTH_TOKEN || "",
    openaiApiKey: env.OPENAI_API_KEY || "",
    geminiApiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "",

    observabilityProvider: obsProvider,
    observabilityCredentials: parseObservabilityCredentials(obsProvider, options, fileConfig),

    issueTrackerProvider: (options.issueTrackerProvider as string) || f("issue-tracker-provider") || "github-issues",
    linearApiKey: env.LINEAR_API_KEY || "",
    linearTeamId: (options.linearTeamId as string) || env.LINEAR_TEAM_ID || f("linear-team-id") || "",
    linearBugLabelId: (options.linearBugLabelId as string) || env.LINEAR_BUG_LABEL_ID || f("linear-bug-label-id") || "",
    linearTriageLabelId:
      (options.linearTriageLabelId as string) || env.LINEAR_TRIAGE_LABEL_ID || f("linear-triage-label-id") || "",

    linearStateBacklog:
      (options.linearStateBacklog as string) || env.LINEAR_STATE_BACKLOG || f("linear-state-backlog") || "",
    linearStateInProgress:
      (options.linearStateInProgress as string) || env.LINEAR_STATE_IN_PROGRESS || f("linear-state-in-progress") || "",
    linearStatePeerReview:
      (options.linearStatePeerReview as string) || env.LINEAR_STATE_PEER_REVIEW || f("linear-state-peer-review") || "",

    timeRange: (options.timeRange as string) || f("time-range") || "24h",
    severityFocus: (options.severityFocus as string) || f("severity-focus") || "errors",
    serviceFilter: (options.serviceFilter as string) || f("service-filter") || "*",
    investigationDepth: (options.investigationDepth as string) || f("investigation-depth") || "standard",
    maxInvestigateTurns: parseInt(String(options.maxInvestigateTurns || f("max-investigate-turns") || "50"), 10),
    maxImplementTurns: parseInt(String(options.maxImplementTurns || f("max-implement-turns") || "30"), 10),

    baseBranch: (options.baseBranch as string) || f("base-branch") || "main",
    prLabels: ((options.prLabels as string) || f("pr-labels") || "agent,triage,needs-review")
      .split(",")
      .map((l) => l.trim()),
    issueLabels: ((options.issueLabels as string) || env.SWENY_ISSUE_LABELS || f("issue-labels") || "")
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),

    // Per-invocation flags: CLI only — never from config file
    dryRun: Boolean(options.dryRun),
    reviewMode: (options.reviewMode || f("review-mode") || "review") as "auto" | "review",
    noveltyMode: options.noveltyMode !== false,
    issueOverride: (options.issueOverride as string) || "",
    additionalInstructions: (options.additionalInstructions as string) || "",

    serviceMapPath: (options.serviceMapPath as string) || f("service-map-path") || ".github/service-map.yml",
    githubToken: env.GITHUB_TOKEN || "",
    botToken: env.BOT_TOKEN || "",

    sourceControlProvider: (options.sourceControlProvider as string) || f("source-control-provider") || "github",

    // Secrets: env only
    jiraBaseUrl: env.JIRA_BASE_URL || "",
    jiraEmail: env.JIRA_EMAIL || "",
    jiraApiToken: env.JIRA_API_TOKEN || "",

    gitlabToken: env.GITLAB_TOKEN || "",
    gitlabProjectId: env.GITLAB_PROJECT_ID || "",
    gitlabBaseUrl:
      (options.gitlabBaseUrl as string) || env.GITLAB_BASE_URL || f("gitlab-base-url") || "https://gitlab.com",

    notificationProvider: (options.notificationProvider as string) || f("notification-provider") || "console",
    // Secrets: env only
    notificationWebhookUrl: env.NOTIFICATION_WEBHOOK_URL || "",
    sendgridApiKey: env.SENDGRID_API_KEY || "",
    emailFrom: env.EMAIL_FROM || "",
    emailTo: env.EMAIL_TO || "",
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET || "",

    repository: (options.repository as string) || env.GITHUB_REPOSITORY || detectRepository(),
    repositoryOwner: env.GITHUB_REPOSITORY_OWNER || "",

    // Per-invocation flags: CLI only
    json: Boolean(options.json),
    bell: Boolean(options.bell),

    cacheDir: (options.cacheDir as string) || env.SWENY_CACHE_DIR || f("cache-dir") || ".sweny/cache",
    cacheTtl: parseInt(String(options.cacheTtl || f("cache-ttl") || "86400"), 10),
    noCache: options.cache === false,

    outputDir: (options.outputDir as string) || env.SWENY_OUTPUT_DIR || f("output-dir") || ".sweny/output",

    mcpServers: parseMcpServers(env.SWENY_MCP_SERVERS || f("mcp-servers-json") || ""),

    workspaceTools: ((options.workspaceTools as string) || env.SWENY_WORKSPACE_TOOLS || f("workspace-tools") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/**
 * All recognized workspace tool names. Update here when adding a new Category B MCP server.
 *
 * Requirements to add a tool:
 *   - Must have an HTTP transport endpoint (preferred) OR a stable pre-installed binary path
 *   - npx -y is intentionally NOT used — runtime package downloads bypass lockfiles
 *   - Asana is intentionally absent: no stable HTTP MCP endpoint as of current release
 */
export const SUPPORTED_WORKSPACE_TOOLS = new Set(["slack", "notion", "pagerduty", "monday"]);

export function validateInputs(config: CliConfig): string[] {
  const errors: string[] = [];

  // Auth: validate per coding agent
  switch (config.codingAgentProvider) {
    case "claude":
      if (!config.anthropicApiKey && !config.claudeOauthToken) {
        errors.push(
          "Missing: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN — get a key at https://console.anthropic.com",
        );
      }
      break;
    case "codex":
      if (!config.openaiApiKey) {
        errors.push("Missing: OPENAI_API_KEY — get a key at https://platform.openai.com/api-keys");
      }
      break;
    case "gemini":
      if (!config.geminiApiKey) {
        errors.push("Missing: GEMINI_API_KEY or GOOGLE_API_KEY — get a key at https://aistudio.google.com/app/apikey");
      }
      break;
    default:
      errors.push(`Unsupported coding agent provider: ${config.codingAgentProvider} (use claude, codex, or gemini)`);
  }

  // Repository required unless all providers are file-based
  const allLocal = config.issueTrackerProvider === "file" && config.sourceControlProvider === "file";
  if (!config.repository && !allLocal) {
    errors.push("Missing: --repository <owner/repo> or GITHUB_REPOSITORY (could not auto-detect from git remote)");
  }

  // Observability credentials by provider
  switch (config.observabilityProvider) {
    case "datadog":
      if (!config.observabilityCredentials.apiKey)
        errors.push("Missing: DD_API_KEY — find API keys at https://app.datadoghq.com/organization-settings/api-keys");
      if (!config.observabilityCredentials.appKey)
        errors.push(
          "Missing: DD_APP_KEY — find application keys at https://app.datadoghq.com/organization-settings/application-keys",
        );
      break;
    case "sentry":
      if (!config.observabilityCredentials.authToken)
        errors.push("Missing: SENTRY_AUTH_TOKEN — create a token at https://sentry.io/settings/auth-tokens/");
      if (!config.observabilityCredentials.organization)
        errors.push("Missing: --sentry-org is required for sentry provider");
      if (!config.observabilityCredentials.project)
        errors.push("Missing: --sentry-project is required for sentry provider");
      break;
    case "cloudwatch":
      if (!config.observabilityCredentials.logGroupPrefix)
        errors.push("Missing: --cloudwatch-log-group-prefix is required for cloudwatch provider");
      break;
    case "splunk":
      if (!config.observabilityCredentials.baseUrl) errors.push("Missing: SPLUNK_URL is required for splunk provider");
      if (!config.observabilityCredentials.token) errors.push("Missing: SPLUNK_TOKEN is required for splunk provider");
      break;
    case "elastic":
      if (!config.observabilityCredentials.baseUrl)
        errors.push("Missing: ELASTIC_URL is required for elastic provider");
      if (!config.observabilityCredentials.apiKey)
        errors.push("Missing: ELASTIC_API_KEY is required for elastic provider");
      break;
    case "newrelic":
      if (!config.observabilityCredentials.apiKey) errors.push("Missing: NR_API_KEY is required for newrelic provider");
      if (!config.observabilityCredentials.accountId)
        errors.push("Missing: NR_ACCOUNT_ID is required for newrelic provider");
      break;
    case "loki":
      if (!config.observabilityCredentials.baseUrl) errors.push("Missing: LOKI_URL is required for loki provider");
      break;
    case "file":
      if (!config.observabilityCredentials.path)
        errors.push("Missing: --log-file <path> is required for file provider");
      break;
    case "prometheus":
      if (!config.observabilityCredentials.url)
        errors.push("Missing: PROMETHEUS_URL or --prometheus-url is required for prometheus provider");
      break;
    case "pagerduty":
      if (!config.observabilityCredentials.apiKey)
        errors.push("Missing: PAGERDUTY_API_KEY is required for pagerduty provider");
      break;
    case "heroku":
      if (!config.observabilityCredentials.apiKey)
        errors.push("Missing: HEROKU_API_KEY is required for heroku provider");
      if (!config.observabilityCredentials.appName)
        errors.push("Missing: HEROKU_APP_NAME or --heroku-app-name is required for heroku provider");
      break;
    case "opsgenie":
      if (!config.observabilityCredentials.apiKey)
        errors.push("Missing: OPSGENIE_API_KEY is required for opsgenie provider");
      break;
    case "honeycomb":
      if (!config.observabilityCredentials.apiKey)
        errors.push("Missing: HONEYCOMB_API_KEY is required for honeycomb provider");
      if (!config.observabilityCredentials.dataset)
        errors.push("Missing: HONEYCOMB_DATASET is required for honeycomb provider");
      break;
    case "axiom":
      if (!config.observabilityCredentials.apiToken) errors.push("Missing: AXIOM_TOKEN is required for axiom provider");
      if (!config.observabilityCredentials.dataset)
        errors.push("Missing: AXIOM_DATASET or --axiom-dataset is required for axiom provider");
      break;
    case "betterstack":
      if (!config.observabilityCredentials.apiToken)
        errors.push("Missing: BETTERSTACK_API_TOKEN is required for betterstack provider");
      if (!config.observabilityCredentials.sourceId && !config.observabilityCredentials.tableName)
        errors.push(
          "Missing: either BETTERSTACK_SOURCE_ID (--betterstack-source-id) or BETTERSTACK_TABLE_NAME (--betterstack-table-name) is required for betterstack provider",
        );
      break;
    case "vercel":
      if (!config.observabilityCredentials.token)
        errors.push("Missing: VERCEL_TOKEN — create a token at https://vercel.com/account/tokens");
      if (!config.observabilityCredentials.projectId)
        errors.push("Missing: VERCEL_PROJECT_ID — find it in your Vercel project settings");
      break;
    case "supabase":
      if (!config.observabilityCredentials.managementApiKey)
        errors.push(
          "Missing: SUPABASE_MANAGEMENT_KEY — create a token at https://supabase.com/dashboard/account/tokens",
        );
      if (!config.observabilityCredentials.projectRef)
        errors.push("Missing: SUPABASE_PROJECT_REF — find it in your Supabase project settings > General");
      break;
    case "netlify":
      if (!config.observabilityCredentials.token)
        errors.push(
          "Missing: NETLIFY_TOKEN — create a token at https://app.netlify.com/user/applications#personal-access-tokens",
        );
      if (!config.observabilityCredentials.siteId)
        errors.push("Missing: NETLIFY_SITE_ID — find it in Site Settings > General > Site details");
      break;
    case "fly":
      if (!config.observabilityCredentials.token)
        errors.push("Missing: FLY_TOKEN — create a token at https://fly.io/user/personal_access_tokens");
      if (!config.observabilityCredentials.appName)
        errors.push("Missing: FLY_APP_NAME — the name of your Fly.io application");
      break;
    case "render":
      if (!config.observabilityCredentials.apiKey)
        errors.push("Missing: RENDER_API_KEY — create an API key at https://dashboard.render.com/u/settings");
      if (!config.observabilityCredentials.serviceId)
        errors.push("Missing: RENDER_SERVICE_ID — find it in your service's Settings page (srv-...)");
      break;
    default:
      errors.push(
        `Unknown --observability-provider "${config.observabilityProvider}". Valid values: datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki, prometheus, pagerduty, honeycomb, heroku, opsgenie, axiom, betterstack, vercel, supabase, netlify, fly, render, file`,
      );
  }

  // Issue tracker credentials by provider
  switch (config.issueTrackerProvider) {
    case "linear":
      if (!config.linearApiKey)
        errors.push("Missing: LINEAR_API_KEY — find API keys at https://linear.app/settings/api");
      if (!config.linearTeamId)
        errors.push(
          "Missing: LINEAR_TEAM_ID — find it in Linear > Settings > Workspace > Teams > [your team] > copy the ID from the URL",
        );
      break;
    case "jira":
      if (!config.jiraBaseUrl)
        errors.push("Missing: JIRA_BASE_URL — set to your Atlassian domain, e.g. https://your-org.atlassian.net");
      if (!config.jiraEmail) errors.push("Missing: JIRA_EMAIL — your Atlassian account email address");
      if (!config.jiraApiToken)
        errors.push(
          "Missing: JIRA_API_TOKEN — create a token at https://id.atlassian.com/manage-profile/security/api-tokens",
        );
      break;
    case "github-issues":
    case "file":
      // No external credentials needed
      break;
    default:
      errors.push(
        `Unknown --issue-tracker-provider "${config.issueTrackerProvider}". Valid values: linear, jira, github-issues, file`,
      );
  }

  // Source control credentials by provider
  switch (config.sourceControlProvider) {
    case "github":
      if (!config.githubToken && !config.botToken)
        errors.push("Missing: GITHUB_TOKEN — create a Personal Access Token at https://github.com/settings/tokens");
      break;
    case "gitlab":
      if (!config.gitlabToken)
        errors.push(
          "Missing: GITLAB_TOKEN — create a Personal Access Token at https://gitlab.com/-/user_settings/personal_access_tokens (api + read_repository + write_repository scopes)",
        );
      if (!config.gitlabProjectId)
        errors.push(
          "Missing: GITLAB_PROJECT_ID — find it in GitLab > [your project] > Settings > General (numeric ID at the top)",
        );
      break;
    case "file":
      // No external credentials needed
      break;
    default:
      errors.push(
        `Unknown --source-control-provider "${config.sourceControlProvider}". Valid values: github, gitlab, file`,
      );
  }

  // Notification credentials by provider
  switch (config.notificationProvider) {
    case "console":
      // No credentials needed
      break;
    case "slack":
    case "teams":
    case "discord":
    case "webhook":
      if (!config.notificationWebhookUrl)
        errors.push(`Missing: NOTIFICATION_WEBHOOK_URL is required for ${config.notificationProvider} notifications`);
      break;
    case "email":
      if (!config.sendgridApiKey) errors.push("Missing: SENDGRID_API_KEY is required for email notifications");
      if (!config.emailFrom) errors.push("Missing: EMAIL_FROM is required for email notifications");
      if (!config.emailTo) errors.push("Missing: EMAIL_TO is required for email notifications");
      break;
    case "file":
      // No external credentials needed
      break;
    default:
      errors.push(
        `Unknown --notification-provider "${config.notificationProvider}". Valid values: console, slack, teams, discord, webhook, email, file`,
      );
  }

  // Workspace tools: reject unknown names early
  for (const tool of config.workspaceTools) {
    if (!SUPPORTED_WORKSPACE_TOOLS.has(tool)) {
      errors.push(`Unknown workspace tool: "${tool}". Supported values: ${[...SUPPORTED_WORKSPACE_TOOLS].join(", ")}`);
    }
  }

  // Enum validation
  if (!["auto", "review"].includes(config.reviewMode)) {
    errors.push("--review-mode must be one of: auto, review");
  }

  // Integer bounds
  if (config.maxInvestigateTurns < 1 || config.maxInvestigateTurns > 500) {
    errors.push("--max-investigate-turns must be between 1 and 500");
  }
  if (config.maxImplementTurns < 1 || config.maxImplementTurns > 500) {
    errors.push("--max-implement-turns must be between 1 and 500");
  }

  return errors;
}

const DEFAULT_SERVICE_MAP_PATH = ".github/service-map.yml";

/**
 * Returns non-fatal warnings about the configuration.
 * These are surfaced before the spinner starts but do not abort the run.
 */
export function validateWarnings(config: Pick<CliConfig, "serviceMapPath">): string[] {
  const warnings: string[] = [];

  // Warn when an explicitly configured serviceMapPath doesn't exist on disk.
  // We skip the default path to avoid noise for users who never set it up.
  if (config.serviceMapPath && config.serviceMapPath !== DEFAULT_SERVICE_MAP_PATH) {
    if (!fs.existsSync(config.serviceMapPath)) {
      warnings.push(`Service map file not found: "${config.serviceMapPath}". Cross-repo routing will be disabled.`);
    }
  }

  return warnings;
}

function parseObservabilityCredentials(
  provider: string,
  options: Record<string, unknown>,
  fileConfig: Record<string, string> = {},
): Record<string, string> {
  const env = process.env;
  const f = (key: string): string | undefined => fileConfig[key] || undefined;

  switch (provider) {
    case "datadog":
      return {
        apiKey: env.DD_API_KEY || "",
        appKey: env.DD_APP_KEY || "",
        site: (options.ddSite as string) || env.DD_SITE || f("dd-site") || "datadoghq.com",
      };
    case "sentry":
      return {
        authToken: env.SENTRY_AUTH_TOKEN || "",
        organization: (options.sentryOrg as string) || env.SENTRY_ORG || f("sentry-org") || "",
        project: (options.sentryProject as string) || env.SENTRY_PROJECT || f("sentry-project") || "",
        baseUrl:
          (options.sentryBaseUrl as string) || env.SENTRY_BASE_URL || f("sentry-base-url") || "https://sentry.io",
      };
    case "cloudwatch":
      return {
        region: (options.cloudwatchRegion as string) || env.AWS_REGION || f("cloudwatch-region") || "us-east-1",
        logGroupPrefix:
          (options.cloudwatchLogGroupPrefix as string) ||
          env.CLOUDWATCH_LOG_GROUP_PREFIX ||
          f("cloudwatch-log-group-prefix") ||
          "",
      };
    case "splunk":
      return {
        baseUrl: env.SPLUNK_URL || "",
        token: env.SPLUNK_TOKEN || "",
        index: (options.splunkIndex as string) || env.SPLUNK_INDEX || f("splunk-index") || "main",
      };
    case "elastic":
      return {
        baseUrl: env.ELASTIC_URL || "",
        apiKey: env.ELASTIC_API_KEY || "",
        index: (options.elasticIndex as string) || env.ELASTIC_INDEX || f("elastic-index") || "logs-*",
      };
    case "newrelic":
      return {
        apiKey: env.NR_API_KEY || "",
        accountId: env.NR_ACCOUNT_ID || "",
        region: (options.newrelicRegion as string) || env.NR_REGION || f("newrelic-region") || "us",
      };
    case "loki":
      return {
        baseUrl: env.LOKI_URL || "",
        apiKey: env.LOKI_API_KEY || "",
        orgId: env.LOKI_ORG_ID || "",
      };
    case "file":
      return {
        path: (options.logFile as string) || env.SWENY_LOG_FILE || f("log-file") || "",
      };
    case "prometheus":
      return {
        url: (options.prometheusUrl as string) || env.PROMETHEUS_URL || f("prometheus-url") || "",
        token: (options.prometheusToken as string) || env.PROMETHEUS_TOKEN || f("prometheus-token") || "",
      };
    case "pagerduty":
      return {
        apiKey: env.PAGERDUTY_API_KEY || "",
      };
    case "heroku":
      return {
        apiKey: env.HEROKU_API_KEY || "",
        appName: (options.herokuAppName as string) || env.HEROKU_APP_NAME || f("heroku-app-name") || "",
      };
    case "opsgenie":
      return {
        apiKey: env.OPSGENIE_API_KEY || "",
        region: (options.opsgenieRegion as string) || env.OPSGENIE_REGION || f("opsgenie-region") || "us",
      };
    case "honeycomb":
      return {
        apiKey: env.HONEYCOMB_API_KEY || "",
        dataset: (options.honeycombDataset as string) || env.HONEYCOMB_DATASET || f("honeycomb-dataset") || "",
      };
    case "axiom":
      return {
        apiToken: env.AXIOM_TOKEN || "",
        dataset: (options.axiomDataset as string) || env.AXIOM_DATASET || f("axiom-dataset") || "",
        orgId: (options.axiomOrgId as string) || env.AXIOM_ORG_ID || f("axiom-org-id") || "",
      };
    case "betterstack":
      return {
        apiToken: env.BETTERSTACK_API_TOKEN || "",
        sourceId:
          (options.betterstackSourceId as string) || env.BETTERSTACK_SOURCE_ID || f("betterstack-source-id") || "",
        tableName:
          (options.betterstackTableName as string) || env.BETTERSTACK_TABLE_NAME || f("betterstack-table-name") || "",
      };
    case "vercel":
      return {
        token: env.VERCEL_TOKEN || "",
        projectId: env.VERCEL_PROJECT_ID || f("vercel-project-id") || "",
        teamId: env.VERCEL_TEAM_ID || f("vercel-team-id") || "",
      };
    case "supabase":
      return {
        managementApiKey: env.SUPABASE_MANAGEMENT_KEY || "",
        projectRef: env.SUPABASE_PROJECT_REF || f("supabase-project-ref") || "",
      };
    case "netlify":
      return {
        token: env.NETLIFY_TOKEN || "",
        siteId: env.NETLIFY_SITE_ID || f("netlify-site-id") || "",
      };
    case "fly":
      return {
        token: env.FLY_TOKEN || "",
        appName: env.FLY_APP_NAME || f("fly-app-name") || "",
      };
    case "render":
      return {
        apiKey: env.RENDER_API_KEY || "",
        serviceId: env.RENDER_SERVICE_ID || f("render-service-id") || "",
      };
    default:
      return {};
  }
}

export function registerImplementCommand(program: Command): Command {
  return program
    .command("implement <issueId>")
    .description("Implement a fix for a specific issue and open a PR")
    .option("--agent <provider>", "Coding agent: claude (default), codex, gemini")
    .option("--coding-agent-provider <provider>", "Coding agent provider (alias for --agent)")
    .option("--issue-tracker-provider <provider>", "Issue tracker (linear|jira|github-issues|file)")
    .option("--source-control-provider <provider>", "Source control (github|gitlab|file)")
    .option("--dry-run", "Skip creating PR — report only", false)
    .option("--max-implement-turns <n>", "Max coding agent turns (default: 40)")
    .option("--base-branch <branch>", "Base branch for PRs (default: main)")
    .option("--repository <owner/repo>", "Repository (auto-detected from git remote)")
    .option("--linear-team-id <id>", "Linear team ID")
    .option("--linear-state-in-progress <name>", "Linear in-progress state name")
    .option("--linear-state-peer-review <name>", "Linear peer-review state name")
    .option("--output-dir <path>", "Output directory for file providers (default: .sweny/output)")
    .option(
      "--workspace-tools <tools>",
      "Comma-separated workspace tool integrations to enable (slack, notion, pagerduty, monday)",
    )
    .option(
      "--review-mode <mode>",
      "PR merge behavior: auto (GitHub auto-merge when CI passes) | review (human approval, default)",
      "review",
    )
    .option("--additional-instructions <text>", "Extra instructions for the coding agent");
}

/**
 * Parse a JSON string into MCP server configs.
 * Returns empty object on blank input; throws on malformed JSON.
 *
 * Expected format (JSON):
 *   {"datadog":{"type":"http","url":"https://...","headers":{"DD_API_KEY":"..."}}}
 *
 * In .sweny.yml, set as a single-line JSON value:
 *   mcp-servers-json: '{"datadog":{"type":"http","url":"..."}}'
 *
 * Or via env var:
 *   SWENY_MCP_SERVERS='{"datadog":{"type":"http","url":"..."}}'
 */
function parseMcpServers(json: string): Record<string, MCPServerConfig> {
  if (!json.trim()) return {};
  try {
    return JSON.parse(json) as Record<string, MCPServerConfig>;
  } catch {
    throw new Error(
      `Invalid mcp-servers-json: expected a JSON object mapping server names to MCPServerConfig.\n  Got: ${json.slice(0, 120)}`,
    );
  }
}

function detectRepository(): string {
  try {
    const remote = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    const match = remote.match(/[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}
