import { execSync } from "node:child_process";
import type { Command } from "commander";

export interface CliConfig {
  // Claude authentication
  anthropicApiKey: string;
  claudeOauthToken: string;

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

  // Behavior
  dryRun: boolean;
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
}

export function registerTriageCommand(program: Command): Command {
  return program
    .command("triage")
    .description("Run the SWEny triage workflow")
    .option("--observability-provider <provider>", "Observability provider", "datadog")
    .option("--issue-tracker-provider <provider>", "Issue tracker provider", "github-issues")
    .option("--source-control-provider <provider>", "Source control provider", "github")
    .option("--notification-provider <provider>", "Notification provider", "console")
    .option("--time-range <range>", "Time range to analyze", "24h")
    .option("--severity-focus <focus>", "Severity level focus", "errors")
    .option("--service-filter <filter>", "Service filter pattern", "*")
    .option("--investigation-depth <depth>", "Investigation depth", "standard")
    .option("--max-investigate-turns <n>", "Max Claude turns for investigation", "50")
    .option("--max-implement-turns <n>", "Max Claude turns for implementation", "30")
    .option("--base-branch <branch>", "Base branch for PRs", "main")
    .option("--pr-labels <labels>", "Comma-separated PR labels", "agent,triage,needs-review")
    .option("--dry-run", "Analyze only, do not create issues or PRs", false)
    .option("--no-novelty-mode", "Disable novelty mode (allow +1 on existing issues)")
    .option("--issue-override <issue>", "Work on a specific existing issue")
    .option("--additional-instructions <text>", "Extra instructions for the Claude agent")
    .option("--service-map-path <path>", "Path to service map YAML", ".github/service-map.yml")
    .option("--repository <owner/repo>", "Repository (auto-detected from git remote)")
    .option("--linear-team-id <id>", "Linear team ID")
    .option("--linear-bug-label-id <id>", "Linear bug label ID")
    .option("--linear-triage-label-id <id>", "Linear triage label ID")
    .option("--linear-state-backlog <name>", "Linear backlog state name")
    .option("--linear-state-in-progress <name>", "Linear in-progress state name")
    .option("--linear-state-peer-review <name>", "Linear peer-review state name")
    .option("--log-file <path>", "Path to JSON log file (use with --observability-provider file)")
    .option("--dd-site <site>", "Datadog site", "datadoghq.com")
    .option("--sentry-org <org>", "Sentry organization slug")
    .option("--sentry-project <project>", "Sentry project slug")
    .option("--sentry-base-url <url>", "Sentry base URL", "https://sentry.io")
    .option("--cloudwatch-region <region>", "AWS CloudWatch region", "us-east-1")
    .option("--cloudwatch-log-group-prefix <prefix>", "CloudWatch log group prefix")
    .option("--splunk-index <index>", "Splunk index", "main")
    .option("--elastic-index <index>", "Elasticsearch index", "logs-*")
    .option("--newrelic-region <region>", "New Relic region", "us")
    .option("--gitlab-base-url <url>", "GitLab base URL", "https://gitlab.com")
    .option("--json", "Output results as JSON", false);
}

export function parseCliInputs(options: Record<string, unknown>): CliConfig {
  const env = process.env;
  const obsProvider = (options.observabilityProvider as string) || "datadog";

  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY || "",
    claudeOauthToken: env.CLAUDE_CODE_OAUTH_TOKEN || "",

    observabilityProvider: obsProvider,
    observabilityCredentials: parseObservabilityCredentials(obsProvider, options),

    issueTrackerProvider: (options.issueTrackerProvider as string) || "github-issues",
    linearApiKey: env.LINEAR_API_KEY || "",
    linearTeamId: (options.linearTeamId as string) || env.LINEAR_TEAM_ID || "",
    linearBugLabelId: (options.linearBugLabelId as string) || env.LINEAR_BUG_LABEL_ID || "",
    linearTriageLabelId: (options.linearTriageLabelId as string) || env.LINEAR_TRIAGE_LABEL_ID || "",
    linearStateBacklog: (options.linearStateBacklog as string) || env.LINEAR_STATE_BACKLOG || "",
    linearStateInProgress: (options.linearStateInProgress as string) || env.LINEAR_STATE_IN_PROGRESS || "",
    linearStatePeerReview: (options.linearStatePeerReview as string) || env.LINEAR_STATE_PEER_REVIEW || "",

    timeRange: (options.timeRange as string) || "24h",
    severityFocus: (options.severityFocus as string) || "errors",
    serviceFilter: (options.serviceFilter as string) || "*",
    investigationDepth: (options.investigationDepth as string) || "standard",
    maxInvestigateTurns: parseInt(String(options.maxInvestigateTurns || "50"), 10),
    maxImplementTurns: parseInt(String(options.maxImplementTurns || "30"), 10),

    baseBranch: (options.baseBranch as string) || "main",
    prLabels: ((options.prLabels as string) || "agent,triage,needs-review").split(",").map((l) => l.trim()),

    dryRun: Boolean(options.dryRun),
    noveltyMode: options.noveltyMode !== false,
    issueOverride: (options.issueOverride as string) || "",
    additionalInstructions: (options.additionalInstructions as string) || "",
    serviceMapPath: (options.serviceMapPath as string) || ".github/service-map.yml",
    githubToken: env.GITHUB_TOKEN || "",
    botToken: env.BOT_TOKEN || "",

    sourceControlProvider: (options.sourceControlProvider as string) || "github",

    jiraBaseUrl: env.JIRA_BASE_URL || "",
    jiraEmail: env.JIRA_EMAIL || "",
    jiraApiToken: env.JIRA_API_TOKEN || "",

    gitlabToken: env.GITLAB_TOKEN || "",
    gitlabProjectId: env.GITLAB_PROJECT_ID || "",
    gitlabBaseUrl: (options.gitlabBaseUrl as string) || env.GITLAB_BASE_URL || "https://gitlab.com",

    notificationProvider: (options.notificationProvider as string) || "console",
    notificationWebhookUrl: env.NOTIFICATION_WEBHOOK_URL || "",
    sendgridApiKey: env.SENDGRID_API_KEY || "",
    emailFrom: env.EMAIL_FROM || "",
    emailTo: env.EMAIL_TO || "",
    webhookSigningSecret: env.WEBHOOK_SIGNING_SECRET || "",

    repository: (options.repository as string) || env.GITHUB_REPOSITORY || detectRepository(),
    repositoryOwner: env.GITHUB_REPOSITORY_OWNER || "",

    json: Boolean(options.json),
  };
}

export function validateInputs(config: CliConfig): string[] {
  const errors: string[] = [];

  // Auth: at least one required
  if (!config.anthropicApiKey && !config.claudeOauthToken) {
    errors.push("Missing: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN must be set");
  }

  // Repository required
  if (!config.repository) {
    errors.push("Missing: --repository <owner/repo> or GITHUB_REPOSITORY (could not auto-detect from git remote)");
  }

  // Observability credentials by provider
  switch (config.observabilityProvider) {
    case "datadog":
      if (!config.observabilityCredentials.apiKey) errors.push("Missing: DD_API_KEY is required for datadog provider");
      if (!config.observabilityCredentials.appKey) errors.push("Missing: DD_APP_KEY is required for datadog provider");
      break;
    case "sentry":
      if (!config.observabilityCredentials.authToken)
        errors.push("Missing: SENTRY_AUTH_TOKEN is required for sentry provider");
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
  }

  // Issue tracker credentials by provider
  switch (config.issueTrackerProvider) {
    case "linear":
      if (!config.linearApiKey) errors.push("Missing: LINEAR_API_KEY is required for linear issue tracker");
      if (!config.linearTeamId)
        errors.push("Missing: LINEAR_TEAM_ID or --linear-team-id is required for linear issue tracker");
      break;
    case "jira":
      if (!config.jiraBaseUrl) errors.push("Missing: JIRA_BASE_URL is required for jira issue tracker");
      if (!config.jiraEmail) errors.push("Missing: JIRA_EMAIL is required for jira issue tracker");
      if (!config.jiraApiToken) errors.push("Missing: JIRA_API_TOKEN is required for jira issue tracker");
      break;
  }

  // Source control credentials by provider
  switch (config.sourceControlProvider) {
    case "github":
      if (!config.githubToken && !config.botToken) errors.push("Missing: GITHUB_TOKEN is required for github provider");
      break;
    case "gitlab":
      if (!config.gitlabToken) errors.push("Missing: GITLAB_TOKEN is required for gitlab provider");
      if (!config.gitlabProjectId) errors.push("Missing: GITLAB_PROJECT_ID is required for gitlab provider");
      break;
  }

  // Notification credentials by provider
  switch (config.notificationProvider) {
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

function parseObservabilityCredentials(provider: string, options: Record<string, unknown>): Record<string, string> {
  const env = process.env;
  switch (provider) {
    case "datadog":
      return {
        apiKey: env.DD_API_KEY || "",
        appKey: env.DD_APP_KEY || "",
        site: (options.ddSite as string) || env.DD_SITE || "datadoghq.com",
      };
    case "sentry":
      return {
        authToken: env.SENTRY_AUTH_TOKEN || "",
        organization: (options.sentryOrg as string) || env.SENTRY_ORG || "",
        project: (options.sentryProject as string) || env.SENTRY_PROJECT || "",
        baseUrl: (options.sentryBaseUrl as string) || env.SENTRY_BASE_URL || "https://sentry.io",
      };
    case "cloudwatch":
      return {
        region: (options.cloudwatchRegion as string) || env.AWS_REGION || "us-east-1",
        logGroupPrefix: (options.cloudwatchLogGroupPrefix as string) || env.CLOUDWATCH_LOG_GROUP_PREFIX || "",
      };
    case "splunk":
      return {
        baseUrl: env.SPLUNK_URL || "",
        token: env.SPLUNK_TOKEN || "",
        index: (options.splunkIndex as string) || env.SPLUNK_INDEX || "main",
      };
    case "elastic":
      return {
        baseUrl: env.ELASTIC_URL || "",
        apiKey: env.ELASTIC_API_KEY || "",
        index: (options.elasticIndex as string) || env.ELASTIC_INDEX || "logs-*",
      };
    case "newrelic":
      return {
        apiKey: env.NR_API_KEY || "",
        accountId: env.NR_ACCOUNT_ID || "",
        region: (options.newrelicRegion as string) || env.NR_REGION || "us",
      };
    case "loki":
      return {
        baseUrl: env.LOKI_URL || "",
        apiKey: env.LOKI_API_KEY || "",
        orgId: env.LOKI_ORG_ID || "",
      };
    case "file":
      return {
        path: (options.logFile as string) || env.SWENY_LOG_FILE || "",
      };
    default:
      return {};
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
