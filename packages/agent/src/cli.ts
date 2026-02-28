/* eslint-disable no-console */
/**
 * Interactive CLI — test sweny-agent end-to-end without Slack.
 *
 * Usage:
 *   npx tsx --env-file=.env src/cli.ts
 *
 * Requires:
 *   - CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in .env
 *
 * Commands:
 *   /quit, /exit     Exit the CLI
 *   /new             Clear session (start fresh conversation)
 *   /memory          Manage saved memories
 *   /help            Show commands
 */
import { loadConfig } from "./config/loader.js";
import { cliChannel } from "./channel/cli.js";
import { createStandardCommands } from "./channel/slack-commands.js";
import { Orchestrator } from "./orchestrator.js";
import { SessionManager } from "./session/manager.js";
import { ClaudeRunner } from "./claude/runner.js";
import { ClaudeCodeRunner } from "./model/claude-code.js";
import { PluginRegistry } from "./plugins/registry.js";
import { ConsoleAuditLogger } from "./audit/console.js";
import { allowAllGuard } from "./access/allow-all.js";
import { createLogger } from "./logger.js";

async function main(): Promise<void> {
  const logger = createLogger("sweny");

  const { sweny: config, env } = await loadConfig();

  // ─── Storage ──────────────────────────────────────────────────
  const storage = config.storage;
  const sessionStore = storage.createSessionStore();
  const memoryStore = storage.createMemoryStore();
  const workspaceStore = storage.createWorkspaceStore();

  // ─── Plugins ──────────────────────────────────────────────────
  const registry = new PluginRegistry(config.plugins);

  // ─── Runner ───────────────────────────────────────────────────
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
  const accessGuard = config.accessGuard ?? allowAllGuard();
  const sessionManager = new SessionManager(24, sessionStore);

  // ─── Channel ──────────────────────────────────────────────────
  const channel = cliChannel();
  const commands = createStandardCommands(sessionManager, memoryStore);
  channel.registerCommands!(commands);

  const orchestrator = new Orchestrator(channel, {
    authProvider: config.auth,
    sessionManager,
    runner: claudeRunner,
    memoryStore,
    auditLogger,
    accessGuard,
    allowedUsers: config.allowedUsers ?? [],
    logger,
  });

  // ─── Print status ─────────────────────────────────────────────
  console.log("");
  console.log(`${config.name} CLI`);
  console.log("\u2500".repeat(40));
  console.log(`  name:  ${config.name}`);
  console.log("\u2500".repeat(40));
  console.log("  /help for commands, /quit to exit");
  console.log("");

  const teardown = await channel.start((msg) => orchestrator.handleMessage(msg));

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    await teardown();
    sessionManager.destroy();
    await registry.destroy();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", async () => {
    console.log("\n");
    await shutdown();
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
