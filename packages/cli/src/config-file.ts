import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Auto-load a `.env` file from the given directory.
 * Sets `process.env[KEY]` only if not already defined (real env vars win).
 */
export function loadDotenv(cwd: string = process.cwd()): void {
  const envPath = path.join(cwd, ".env");
  let content: string;
  try {
    content = fs.readFileSync(envPath, "utf-8");
  } catch {
    return; // no .env — silently skip
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Search upward from `cwd` for `.sweny.yml` and parse it into flat key-value pairs.
 * Returns empty object if no config file is found.
 */
export function loadConfigFile(cwd: string = process.cwd()): Record<string, string> {
  const filePath = findConfigFile(cwd);
  if (!filePath) return {};

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return {};
  }

  const config: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let value = trimmed.slice(colonIndex + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && value !== "") {
      config[key] = value;
    }
  }

  return config;
}

function findConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const { root } = path.parse(dir);

  while (true) {
    const candidate = path.join(dir, ".sweny.yml");
    try {
      fs.accessSync(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      // not found — walk up
    }

    const parent = path.dirname(dir);
    if (parent === dir || dir === root) return null;
    dir = parent;
  }
}

/** Starter config written by `sweny init`. */
export const STARTER_CONFIG = `# .sweny.yml — SWEny project configuration
# Commit this file. Secrets (API keys, tokens) go in .env (gitignored).
#
# Every key matches a CLI flag: "time-range: 4h" is the same as "--time-range 4h".
# CLI flags override this file; env vars override this file; this file overrides defaults.

# ── Providers ────────────────────────────────────────────────────────
# observability-provider: datadog        # datadog | sentry | cloudwatch | splunk | elastic | newrelic | loki | prometheus | pagerduty | heroku | opsgenie | vercel | supabase | netlify | fly | render | file
# issue-tracker-provider: github-issues  # github-issues | linear | jira
# source-control-provider: github        # github | gitlab
# coding-agent-provider: claude          # claude | codex | gemini
# notification-provider: console         # console | slack | teams | discord | email | webhook

# ── Investigation ────────────────────────────────────────────────────
# time-range: 24h
# severity-focus: errors
# service-filter: "*"
# investigation-depth: standard          # quick | standard | thorough

# ── PR / branch ──────────────────────────────────────────────────────
# base-branch: main
# pr-labels: agent,triage,needs-review

# ── Paths ─────────────────────────────────────────────────────────────
# service-map-path: .github/service-map.yml
# log-file: ./logs/errors.json           # required when observability-provider is "file"

# ── Cache ─────────────────────────────────────────────────────────────
# cache-dir: .sweny/cache
# cache-ttl: 86400

# ── MCP servers ───────────────────────────────────────────────────────
# Extend the coding agent with additional tools via MCP.
# Value is a JSON object — each key is a server name you choose.
# See docs/mcp-servers.md for a full catalog with copy-paste configs.
#
# Example: GitHub MCP server (query PRs, issues, CI run logs)
# mcp-servers-json: '{"github":{"type":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github@latest"],"env":{"GITHUB_PERSONAL_ACCESS_TOKEN":"ghp_..."}}}'

# ── Local-only quick start ───────────────────────────────────────────
# Uncomment to run without any external services (just an LLM API key):
# observability-provider: file
# log-file: ./sample-errors.json
# issue-tracker-provider: file
# source-control-provider: file
# notification-provider: file
# output-dir: .sweny/output

# ── Credentials (.env) ───────────────────────────────────────────────
# Copy the relevant block into your .env file and fill in the values.
#
# Claude (coding agent) — https://console.anthropic.com/settings/api-keys
#   ANTHROPIC_API_KEY=sk-ant-...
#
# GitHub (source control + issue tracker)
#   GITHUB_TOKEN=ghp_...        # https://github.com/settings/tokens (repo + issues scopes)
#
# Datadog (observability) — https://app.datadoghq.com/organization-settings
#   DD_API_KEY=...              # Organization Settings > API Keys
#   DD_APP_KEY=...              # Organization Settings > Application Keys
#   DD_SITE=datadoghq.com       # or datadoghq.eu, us3.datadoghq.com, etc.
#
# Sentry (observability) — https://sentry.io/settings/auth-tokens/
#   SENTRY_AUTH_TOKEN=sntrys_...
#   SENTRY_ORG=your-org-slug    # from sentry.io/organizations/<slug>/
#   SENTRY_PROJECT=your-project # Project Settings > General > Project Slug
#
# Linear (issue tracker) — https://linear.app/settings/api
#   LINEAR_API_KEY=lin_api_...
#   LINEAR_TEAM_ID=...          # Settings > Workspace > Teams > [team] > copy ID from URL
#   LINEAR_BUG_LABEL_ID=...     # Settings > Labels > [label] > copy ID from URL
#
# Jira (issue tracker) — https://your-org.atlassian.net
#   JIRA_BASE_URL=https://your-org.atlassian.net
#   JIRA_EMAIL=you@company.com  # your Atlassian account email
#   JIRA_API_TOKEN=...          # https://id.atlassian.com/manage-profile/security/api-tokens
#
# Vercel (observability) — https://vercel.com/account/tokens
#   VERCEL_TOKEN=...
#   VERCEL_PROJECT_ID=prj_...      # Project Settings > General > Project ID
#   VERCEL_TEAM_ID=team_...        # optional, for team-owned projects
#
# Supabase (observability) — https://supabase.com/dashboard/account/tokens
#   SUPABASE_MANAGEMENT_KEY=...
#   SUPABASE_PROJECT_REF=...       # Project Settings > General > Reference ID
#
# Netlify (observability) — https://app.netlify.com/user/applications#personal-access-tokens
#   NETLIFY_TOKEN=...
#   NETLIFY_SITE_ID=...         # Site Settings > General > Site ID
#
# Fly.io (observability) — https://fly.io/user/personal_access_tokens
#   FLY_TOKEN=...
#   FLY_APP_NAME=...             # the name of your Fly.io application
#
# Render (observability) — https://dashboard.render.com/u/settings
#   RENDER_API_KEY=...
#   RENDER_SERVICE_ID=srv-...    # from your service's Settings page
#
# Prometheus (observability) — self-hosted or Grafana Cloud
#   PROMETHEUS_URL=http://prometheus.internal:9090
#   PROMETHEUS_TOKEN=...         # optional, for secured instances
#
# PagerDuty (observability) — https://your-account.pagerduty.com/api_keys
#   PAGERDUTY_API_KEY=...
#
# Heroku (observability) — https://devcenter.heroku.com/articles/platform-api-reference
#   HEROKU_API_KEY=...           # https://dashboard.heroku.com/account
#   HEROKU_APP_NAME=...          # the name of your Heroku application
#
# OpsGenie (observability) — https://support.atlassian.com/opsgenie/docs/api-key-management/
#   OPSGENIE_API_KEY=...
#   OPSGENIE_REGION=us           # or eu for EU-hosted accounts
#
# Slack (notifications) — https://api.slack.com/apps
#   NOTIFICATION_WEBHOOK_URL=https://hooks.slack.com/services/...
#   # or use a bot token: SLACK_BOT_TOKEN=xoxb-...
`;
