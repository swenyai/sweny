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
# observability-provider: datadog        # datadog | sentry | cloudwatch | splunk | elastic | newrelic | loki | file
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

# ── Local-only quick start ───────────────────────────────────────────
# Uncomment to run without any external services (just an LLM API key):
# observability-provider: file
# log-file: ./sample-errors.json
# issue-tracker-provider: file
# source-control-provider: file
# notification-provider: file
# output-dir: .sweny/output
`;
