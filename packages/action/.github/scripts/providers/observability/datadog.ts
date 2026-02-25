#!/usr/bin/env npx tsx
/**
 * Datadog Observability Provider
 *
 * Commands:
 *   verify-access  — Test Datadog API credentials
 *   query-logs     — Query error logs (--time-range, --service-filter, --severity)
 *   aggregate      — Get error counts by service (--time-range, --service-filter)
 *
 * Required env vars:
 *   DD_API_KEY   — Datadog API key
 *   DD_APP_KEY   — Datadog Application key
 *   DD_SITE      — Datadog site (default: datadoghq.com)
 */

const DD_SITE = process.env.DD_SITE || "datadoghq.com";
const DD_API_KEY = process.env.DD_API_KEY || "";
const DD_APP_KEY = process.env.DD_APP_KEY || "";

function requireCredentials(): void {
  if (!DD_API_KEY || !DD_APP_KEY) {
    console.error("Error: DD_API_KEY and DD_APP_KEY environment variables are required");
    process.exit(1);
  }
}

async function datadogRequest(path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`https://api.${DD_SITE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "DD-API-KEY": DD_API_KEY,
      "DD-APPLICATION-KEY": DD_APP_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Datadog API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function verifyAccess(): Promise<void> {
  requireCredentials();

  console.error(`DD_API_KEY length: ${DD_API_KEY.length}`);
  console.error(`DD_APP_KEY length: ${DD_APP_KEY.length}`);
  console.error(`DD_SITE: ${DD_SITE}`);

  await datadogRequest("/api/v2/logs/analytics/aggregate", {
    filter: { query: "*", from: "now-5m", to: "now" },
    compute: [{ type: "total", aggregation: "count" }],
  });

  console.error("Datadog API access verified");
}

async function queryLogs(timeRange: string, serviceFilter: string, severity: string): Promise<void> {
  requireCredentials();

  const query = `service:${serviceFilter} status:${severity}`;
  const result = (await datadogRequest("/api/v2/logs/events/search", {
    filter: { query, from: `now-${timeRange}`, to: "now" },
    sort: "-timestamp",
    page: { limit: 100 },
  })) as { data?: Array<{ attributes?: { timestamp?: string; service?: string; status?: string; message?: string; attributes?: Record<string, unknown> } }> };

  const logs = (result.data || []).map((entry) => ({
    timestamp: entry.attributes?.timestamp || "",
    service: entry.attributes?.service || "",
    level: entry.attributes?.status || "",
    message: entry.attributes?.message || "",
    attributes: entry.attributes?.attributes || {},
  }));

  console.log(JSON.stringify({ logs, summary: `Found ${logs.length} ${severity} logs for ${serviceFilter} in last ${timeRange}` }));
}

async function aggregate(timeRange: string, serviceFilter: string): Promise<void> {
  requireCredentials();

  const result = (await datadogRequest("/api/v2/logs/analytics/aggregate", {
    filter: { query: `service:${serviceFilter} status:error`, from: `now-${timeRange}`, to: "now" },
    compute: [{ type: "total", aggregation: "count" }],
    group_by: [{ facet: "service", limit: 20, sort: { type: "measure", aggregation: "count", order: "desc" } }],
  })) as { data?: { buckets?: Array<{ by?: { service?: string }; computes?: { "c0"?: number } }> } };

  const groups = (result.data?.buckets || []).map((bucket) => ({
    service: bucket.by?.service || "unknown",
    count: bucket.computes?.["c0"] || 0,
  }));

  console.log(JSON.stringify({ groups }));
}

// ── CLI ─────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

function getFlag(name: string, defaultValue: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

(async () => {
  try {
    switch (command) {
      case "verify-access":
        await verifyAccess();
        break;
      case "query-logs":
        await queryLogs(
          getFlag("time-range", "1h"),
          getFlag("service-filter", "*"),
          getFlag("severity", "error"),
        );
        break;
      case "aggregate":
        await aggregate(
          getFlag("time-range", "1h"),
          getFlag("service-filter", "*"),
        );
        break;
      default:
        console.error(`Usage: datadog.ts <verify-access|query-logs|aggregate> [options]`);
        console.error(`  --time-range <range>      Time range (e.g., 1h, 24h, 7d)`);
        console.error(`  --service-filter <filter>  Service filter pattern (e.g., core-*)`);
        console.error(`  --severity <level>         Severity focus (error, warn)`);
        process.exit(1);
    }
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
})();
