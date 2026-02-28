import { loadConfig } from "./config/loader.js";
import { slackChannel } from "./channel/slack.js";
import { createStandardCommands } from "./channel/slack-commands.js";
import { Orchestrator } from "./orchestrator.js";
import { SessionManager } from "./session/manager.js";
import { ClaudeRunner } from "./claude/runner.js";
import { ClaudeCodeRunner } from "./model/claude-code.js";
import { PluginRegistry } from "./plugins/registry.js";
import { RateLimiter } from "./rate-limit.js";
import { startHealthServer } from "./health.js";
import { ConsoleAuditLogger } from "./audit/console.js";
import { allowAllGuard } from "./access/allow-all.js";
import { createLogger } from "./logger.js";
import type { Channel } from "./channel/types.js";

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
  const modelRunner = new ClaudeCodeRunner({
    apiKey: env.claudeApiKey,
    oauthToken: env.claudeOauthToken,
  });
  const claudeRunner = new ClaudeRunner(
    {
      name: config.name,
      basePrompt: config.systemPrompt,
      maxTurns: config.model.maxTurns ?? 20,
      model: {
        apiKey: env.claudeApiKey,
        oauthToken: env.claudeOauthToken,
      },
    },
    { registry, memoryStore, workspaceStore },
    modelRunner,
  );
  const auditLogger = config.audit ?? new ConsoleAuditLogger();
  const rateLimiter = new RateLimiter(config.rateLimit?.maxPerMinute, config.rateLimit?.maxPerHour);
  const accessGuard = config.accessGuard ?? allowAllGuard();

  // ─── Resolve channels ─────────────────────────────────────────
  let channels: Channel[];

  if (config.channels && config.channels.length > 0) {
    channels = config.channels;
  } else if (config.slack?.appToken && config.slack?.botToken && config.slack?.signingSecret) {
    channels = [
      slackChannel({
        appToken: config.slack.appToken,
        botToken: config.slack.botToken,
        signingSecret: config.slack.signingSecret,
      }),
    ];
  } else {
    logger.error(
      "No channels configured. Either set `channels` in sweny.config.ts " +
        "or provide SLACK_APP_TOKEN, SLACK_BOT_TOKEN, and SLACK_SIGNING_SECRET.",
    );
    process.exit(1);
  }

  // ─── Standard commands ─────────────────────────────────────────
  const commands = createStandardCommands(sessionManager, memoryStore);

  // ─── Wire each channel ─────────────────────────────────────────
  const teardowns: Array<() => Promise<void>> = [];

  for (const channel of channels) {
    channel.registerLoginUI?.(config.auth);
    channel.registerCommands?.(commands);

    const orchestrator = new Orchestrator(channel, {
      authProvider: config.auth,
      sessionManager,
      runner: claudeRunner,
      memoryStore,
      auditLogger,
      rateLimiter,
      accessGuard,
      allowedUsers: config.allowedUsers ?? [],
      logger,
    });

    const teardown = await channel.start((msg) => orchestrator.handleMessage(msg));
    teardowns.push(teardown);

    logger.info(`Channel "${channel.name}" started`);
  }

  startHealthServer(config.healthPort ?? 3000);

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info("Shutting down...");
    sessionManager.destroy();
    await registry.destroy();
    for (const teardown of teardowns) {
      await teardown();
    }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[sweny] Fatal error:", err);
  process.exit(1);
});
