/**
 * Integration Test Harness
 *
 * Detects which external services are available via environment variables.
 * Integration tests use `describe.runIf(available.xxx)` to skip cleanly
 * when credentials aren't present.
 *
 * Usage:
 *   npx vitest run --config vitest.integration.config.ts
 *
 * Or with env vars:
 *   GITHUB_TOKEN=ghp_... npx vitest run --config vitest.integration.config.ts
 */

export const available = {
  github: !!process.env.GITHUB_TOKEN,
  linear: !!process.env.LINEAR_API_KEY,
  sentry: !!(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG),
  datadog: !!(process.env.DD_API_KEY && process.env.DD_APP_KEY),
  slack: !!(process.env.SLACK_WEBHOOK_URL || process.env.SLACK_BOT_TOKEN),
  discord: !!process.env.DISCORD_WEBHOOK_URL,
  claude: !!process.env.ANTHROPIC_API_KEY,
};

/** Print which services are available (for CI logs) */
export function logAvailability(): void {
  const entries = Object.entries(available);
  const on = entries.filter(([, v]) => v).map(([k]) => k);
  const off = entries.filter(([, v]) => !v).map(([k]) => k);

  console.log(`\n🔌 Integration test services:`);
  if (on.length > 0) console.log(`   ✅ Available: ${on.join(", ")}`);
  if (off.length > 0) console.log(`   ⏭️  Skipped:   ${off.join(", ")}`);
  console.log();
}
