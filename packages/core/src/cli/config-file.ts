import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
// Imported for its side effect too: the startup env snapshot is taken before loadDotenv runs.
import { markWorkspaceEnv } from "../startup-env.js";

/**
 * Keys a workspace `.env` may never set. The workspace is agent-writable, and
 * these name runtime or platform state sweny trusts as the operator's: CI and
 * runner identity and the files the runner hands sweny to write
 * (GITHUB_STEP_SUMMARY, GITHUB_OUTPUT, ...), where binaries are found (PATH),
 * how Node and git behave (NODE_*, GIT_*), where traffic goes and which CAs it
 * trusts (proxies, SSL/CA vars), and the home and temp dirs. A `.env` value
 * for one of them is skipped with a warning. GITHUB_TOKEN is a credential the
 * `.env` template documents, not platform state, so it stays allowed.
 */
export const DOTENV_DENIED_KEYS =
  /^(GITHUB_(?!TOKEN$)[A-Za-z0-9_]*|RUNNER_[A-Za-z0-9_]*|ACTIONS_[A-Za-z0-9_]*|CI|PATH|Path|NODE_[A-Za-z0-9_]*|GIT_[A-Za-z0-9_]*|(HTTPS?|ALL|NO|FTP)_PROXY|(https?|all|no|ftp)_proxy|SSL_CERT_FILE|SSL_CERT_DIR|CURL_CA_BUNDLE|REQUESTS_CA_BUNDLE|TMPDIR|TEMP|TMP|HOME|USERPROFILE)$/;

/** True when a workspace `.env` may not set `key` (see {@link DOTENV_DENIED_KEYS}). */
export function isDotenvDenied(key: string): boolean {
  return DOTENV_DENIED_KEYS.test(key);
}

/**
 * Auto-load a `.env` file from the given directory.
 * Sets `process.env[KEY]` only if not already defined (real env vars win),
 * and never a runtime or platform key ({@link DOTENV_DENIED_KEYS}).
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

    if (process.env[key] !== undefined) continue;
    if (isDotenvDenied(key)) {
      process.stderr.write(`  warning: .env sets ${key}, a runtime/platform variable; ignored\n`);
      continue;
    }
    process.env[key] = value;
    markWorkspaceEnv(key);
  }
}

/**
 * `.sweny.yml` keys for the agent execution floor (#360) and the env var each
 * maps to. The runtime (claude.ts / agent-env.ts) reads the env var, so the
 * same knob works for the CLI, the Action and library callers.
 */
const AGENT_FILE_KEYS: ReadonlyArray<readonly [string[], string]> = [
  [["env-passthrough", "env_passthrough"], "SWENY_ENV_PASSTHROUGH"],
  [["env-scope", "env_scope"], "SWENY_ENV_SCOPE"],
  [["sandbox"], "SWENY_SANDBOX"],
  [["sandbox-allowed-domains", "sandbox_allowed_domains"], "SWENY_SANDBOX_ALLOWED_DOMAINS"],
  // The one model provider whose credential a pi run gets (agent-env.ts resolvePiProvider).
  [["pi-provider", "pi_provider"], "SWENY_PI_PROVIDER"],
];

/**
 * Copy agent sandbox / env-passthrough settings from `.sweny.yml` into the
 * environment. Real env vars win (same precedence as {@link loadDotenv}).
 * YAML booleans arrive as "true"/"false", which the sandbox mode parser
 * treats as on/off.
 */
export function applyAgentFileConfig(fileConfig: FileConfig, env: NodeJS.ProcessEnv = process.env): void {
  for (const [keys, envVar] of AGENT_FILE_KEYS) {
    if (env[envVar] !== undefined) continue;
    for (const key of keys) {
      const v = fileConfig[key];
      if (Array.isArray(v) && v.length > 0) {
        env[envVar] = v.join(",");
        break;
      }
      if (typeof v === "string" && v) {
        env[envVar] = v;
        break;
      }
    }
  }
}

/**
 * Operator config for the decision model (#357), one trust domain per
 * credential. `.sweny.yml` is repo content a pull request can change, so:
 *
 *  - SWENY_DECIDER_URL (operator env) may point anywhere public; only then is
 *    SWENY_DECIDER_API_KEY sent, and only SWENY_DECIDER_ALLOW_PRIVATE=true
 *    (env) admits loopback or private addresses.
 *  - A `.sweny.yml` `decider: { url, model }` URL must be loopback (local
 *    Ollama) and never gets a key.
 *
 * `trusted(key)` reads an operator env value; it must not see values a
 * committed `.env` supplied. `noDecider` (`--no-decider`) returns false.
 * Undefined when no URL and model are configured.
 */
export function operatorDeciderConfig(
  fileConfig: FileConfig,
  env: NodeJS.ProcessEnv,
  noDecider: boolean,
  trusted: (key: string) => string | undefined = (key) => env[key],
): { url: string; model: string; apiKey?: string; allowPrivate?: boolean; loopbackOnly?: boolean } | false | undefined {
  if (noDecider) return false;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const model = str(trusted("SWENY_DECIDER_MODEL")) ?? str(env.SWENY_DECIDER_MODEL) ?? str(fileConfig["decider.model"]);
  const envUrl = str(trusted("SWENY_DECIDER_URL"));
  if (envUrl) {
    if (!model) return undefined;
    const apiKey = str(trusted("SWENY_DECIDER_API_KEY"));
    const allowPrivate = ["1", "true"].includes((str(trusted("SWENY_DECIDER_ALLOW_PRIVATE")) ?? "").toLowerCase());
    return { url: envUrl, model, ...(apiKey ? { apiKey } : {}), ...(allowPrivate ? { allowPrivate } : {}) };
  }
  // Repo content: a URL a committed `.env` put in the environment (untrusted),
  // else the `.sweny.yml` one. Loopback only, never a key.
  const repoUrl = str(env.SWENY_DECIDER_URL) ?? str(fileConfig["decider.url"]);
  if (!repoUrl || !model) return undefined;
  return { url: repoUrl, model, loopbackOnly: true };
}

/** Parsed config file — flat strings for scalar fields, arrays for list fields, objects for nested blocks. */
export type FileConfig = Record<string, string | string[] | Record<string, unknown>>;

/**
 * Search upward from `cwd` for `.sweny.yml` and parse it.
 * Scalar values are strings, list values (rules, context) are string arrays.
 * Returns empty object if no config file is found.
 */
export function loadConfigFile(cwd: string = process.cwd()): FileConfig {
  const filePath = findConfigFile(cwd);
  if (!filePath) return {};

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return {};
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    // A malformed config file must not silently fall back to defaults — the
    // user would get unexpected behavior with no clue their file was dropped.
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`⚠  Ignoring malformed config file ${filePath}: ${reason}`);
    return {};
  }

  if (!raw || typeof raw !== "object") return {};

  const config: FileConfig = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      config[key] = value.map(String);
    } else if (value && typeof value === "object") {
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        if (subVal && typeof subVal === "object" && !Array.isArray(subVal)) {
          config[`${key}.${subKey}`] = subVal as Record<string, unknown>;
        } else if (Array.isArray(subVal)) {
          config[`${key}.${subKey}`] = subVal.map(String);
        } else if (subVal != null && subVal !== "") {
          config[`${key}.${subKey}`] = String(subVal);
        }
      }
    } else if (value != null && value !== "") {
      config[key] = String(value);
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

/** Starter config written by `sweny new`. */
export const STARTER_CONFIG = `# .sweny.yml — SWEny project configuration
# Commit this file. Secrets (API keys, tokens) go in .env (gitignored).
#
# Every key matches a CLI flag: "time-range: 4h" is the same as "--time-range 4h".
# CLI flags override this file; env vars override this file; this file overrides defaults.

# ── Providers ────────────────────────────────────────────────────────
# observability-provider: datadog        # datadog | sentry | cloudwatch | splunk | elastic | newrelic | loki | prometheus | pagerduty | heroku | opsgenie | vercel | supabase | netlify | fly | render | file
# issue-tracker-provider: github-issues  # github-issues | linear | jira
# source-control-provider: github        # github | gitlab
# coding-agent-provider: claude          # claude | codex | pi
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

# ── Run reporting ─────────────────────────────────────────────────────
# Opt-in and not currently available: token minting is not yet exposed, so
# leaving this unset means no reporting request is ever made.
# cloud-token: sweny_pk_...
# Or set SWENY_CLOUD_TOKEN in your environment.

# ── Agent sandbox ─────────────────────────────────────────────────────
# See https://docs.sweny.ai/advanced/agent-sandbox/
# sandbox: off                           # off (local default) | auto (CI default: sandbox if supported, else warn) | strict
# sandbox-allowed-domains: [internal.example.com]   # extra hosts agent commands may reach
# env-scope: off                         # off (local default: full env) | on (CI default: allowlist)
# env-passthrough: [NPM_TOKEN]           # extra env vars the agent may see when scoped ("*" = all)

# ── MCP servers ───────────────────────────────────────────────────────
# Extend the coding agent with additional tools via MCP.
# Value is a JSON object — each key is a server name you choose.
# See https://docs.sweny.ai/advanced/mcp-servers/ for a full catalog with copy-paste configs.
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
# Honeycomb (observability) — https://docs.honeycomb.io/api/
#   HONEYCOMB_API_KEY=...
#   HONEYCOMB_DATASET=...        # dataset name (e.g. production)
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
#
# Decision model (optional) for nodes with route_by: decider. https://docs.sweny.ai/advanced/decision-models/
#   Local Ollama: set it here (a URL in this file must be loopback and never gets a key):
#     decider:
#       url: http://localhost:11434
#       model: nimble
#   Remote server: set it in the CI or shell environment only, never in this file or .env:
#     SWENY_DECIDER_URL=https://...  SWENY_DECIDER_MODEL=...  SWENY_DECIDER_API_KEY=...
`;
