import { loadConfig } from "./config/loader.js";
import { createSlackApp } from "./slack/app.js";
import { registerLoginModal } from "./slack/modals.js";
import { registerCommands } from "./slack/commands.js";
import { registerEventHandlers } from "./slack/event-handler.js";
import { SessionManager } from "./session/manager.js";
import { ClaudeRunner } from "./claude/runner.js";
import { PluginRegistry } from "./plugins/registry.js";
import { RateLimiter } from "./rate-limit.js";
import { startHealthServer } from "./health.js";
import { ConsoleAuditLogger } from "./audit/console.js";
import { allowAllGuard } from "./access/allow-all.js";
import { createLogger } from "./logger.js";

async function main(): Promise<void> {
  const logger = createLogger("sweny");
  logger.info("Starting...");

  const { sweny: config, env } = await loadConfig();
  logger.info(`Agent: ${config.name}`);
  logger.info(`Log level: ${config.logLevel ?? "info"}`);

  // ─── Storage ──────────────────────────────────────────────────
  const storage = config.storage;
  const sessionStore = storage.createSessionStore();
  const memoryStore = storage.createMemoryStore();
  const workspaceStore = storage.createWorkspaceStore();

  // ─── Plugins ──────────────────────────────────────────────────
  const registry = new PluginRegistry(config.plugins);

  // ─── Runtime components ───────────────────────────────────────
  const sessionManager = new SessionManager(24, sessionStore);
  const claudeRunner = new ClaudeRunner(
    {
      name: config.name,
      basePrompt: config.systemPrompt,
      maxTurns: config.claude.maxTurns ?? 20,
      claude: {
        apiKey: env.claudeApiKey,
        oauthToken: env.claudeOauthToken,
      },
    },
    { registry, memoryStore, workspaceStore },
  );
  const auditLogger = config.audit ?? new ConsoleAuditLogger();
  const rateLimiter = new RateLimiter(
    config.rateLimit?.maxPerMinute,
    config.rateLimit?.maxPerHour,
  );
  const accessGuard = config.accessGuard ?? allowAllGuard();

  // ─── Slack ────────────────────────────────────────────────────
  if (!config.slack?.appToken || !config.slack?.botToken || !config.slack?.signingSecret) {
    logger.error("Slack tokens are required. Set SLACK_APP_TOKEN, SLACK_BOT_TOKEN, and SLACK_SIGNING_SECRET.");
    process.exit(1);
  }

  const app = createSlackApp({
    appToken: config.slack.appToken,
    botToken: config.slack.botToken,
    signingSecret: config.slack.signingSecret,
  });

  registerLoginModal(app, config.auth);
  registerCommands(app, sessionManager, memoryStore);
  registerEventHandlers(app, {
    authProvider: config.auth,
    sessionManager,
    claudeRunner,
    memoryStore,
    auditLogger,
    rateLimiter,
    accessGuard,
    allowedUsers: config.allowedUsers ?? [],
  });

  startHealthServer(config.healthPort ?? 3000);

  await app.start();
  logger.info("Slack bot is running (Socket Mode)");

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");
    sessionManager.destroy();
    await registry.destroy();
    await app.stop();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[sweny] Fatal error:", err);
  process.exit(1);
});
