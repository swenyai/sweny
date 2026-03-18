/**
 * Shared factory functions for common provider categories.
 *
 * These consolidate the switch/case logic that would otherwise be duplicated
 * across CLI, Action, and any other integration layer.
 */
import type { Logger } from "./logger.js";
import type { ObservabilityProvider } from "./observability/index.js";
import type { CodingAgent } from "./coding-agent/index.js";
import {
  datadog,
  sentry,
  cloudwatch,
  splunk,
  elastic,
  newrelic,
  loki,
  file,
  prometheus,
  pagerduty,
  vercel,
  supabase,
  netlify,
  fly,
  render,
  heroku,
  opsgenie,
  honeycomb,
} from "./observability/index.js";
import { claudeCode, openaiCodex, googleGemini } from "./coding-agent/index.js";

/**
 * Instantiate an observability provider by name.
 *
 * @param name        - Provider key: "datadog" | "sentry" | "cloudwatch" | "splunk" |
 *                      "elastic" | "newrelic" | "loki" | "file" | "prometheus" | "pagerduty" |
 *                      "vercel" | "supabase" | "netlify" | "fly" | "render" | "heroku" | "opsgenie"
 * @param credentials - Key/value map of provider-specific credentials (same shape as
 *                      `parseObservabilityCredentials` returns in the CLI/Action).
 * @param logger      - Logger instance to pass to the provider.
 */
export function createObservabilityProvider(
  name: string,
  credentials: Record<string, string>,
  logger: Logger,
): ObservabilityProvider {
  switch (name) {
    case "datadog":
      return datadog({ apiKey: credentials.apiKey, appKey: credentials.appKey, site: credentials.site, logger });
    case "sentry":
      return sentry({
        authToken: credentials.authToken,
        organization: credentials.organization,
        project: credentials.project,
        baseUrl: credentials.baseUrl,
        logger,
      });
    case "cloudwatch":
      return cloudwatch({ region: credentials.region, logGroupPrefix: credentials.logGroupPrefix, logger });
    case "splunk":
      return splunk({ baseUrl: credentials.baseUrl, token: credentials.token, index: credentials.index, logger });
    case "elastic":
      return elastic({ baseUrl: credentials.baseUrl, apiKey: credentials.apiKey, index: credentials.index, logger });
    case "newrelic":
      return newrelic({
        apiKey: credentials.apiKey,
        accountId: credentials.accountId,
        region: (credentials.region ?? "us") as "us" | "eu",
        logger,
      });
    case "loki":
      return loki({ baseUrl: credentials.baseUrl, apiKey: credentials.apiKey, orgId: credentials.orgId, logger });
    case "file":
      return file({ path: credentials.path, logger });
    case "prometheus":
      return prometheus({ url: credentials.url, token: credentials.token || undefined, logger });
    case "pagerduty":
      return pagerduty({ apiKey: credentials.apiKey, logger });
    case "vercel":
      return vercel({ token: credentials.token, projectId: credentials.projectId, teamId: credentials.teamId, logger });
    case "supabase":
      return supabase({ managementApiKey: credentials.managementApiKey, projectRef: credentials.projectRef, logger });
    case "netlify":
      return netlify({ token: credentials.token, siteId: credentials.siteId, logger });
    case "fly":
      return fly({ token: credentials.token, appName: credentials.appName, logger });
    case "render":
      return render({ apiKey: credentials.apiKey, serviceId: credentials.serviceId, logger });
    case "heroku":
      return heroku({ apiKey: credentials.apiKey, appName: credentials.appName, logger });
    case "opsgenie":
      return opsgenie({
        apiKey: credentials.apiKey,
        region: (credentials.region ?? "us") as "us" | "eu",
        logger,
      });
    case "honeycomb":
      return honeycomb({ apiKey: credentials.apiKey, dataset: credentials.dataset, logger });
    default:
      throw new Error(`Unsupported observability provider: ${name}`);
  }
}

/**
 * Instantiate a coding agent provider by name.
 *
 * @param name   - Provider key: "claude" | "codex" | "gemini"
 * @param logger - Logger instance.
 * @param opts   - Optional: `quiet` suppresses agent stdout (used in CLI/Action).
 */
export function createCodingAgentProvider(name: string, logger: Logger, opts?: { quiet?: boolean }): CodingAgent {
  const quiet = opts?.quiet ?? false;
  switch (name) {
    case "codex":
      return openaiCodex({ logger, quiet });
    case "gemini":
      return googleGemini({ logger, quiet });
    case "claude":
    default:
      return claudeCode({ logger, quiet });
  }
}
