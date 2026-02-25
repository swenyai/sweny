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
 *   /reset           Clear session (start fresh conversation)
 *   /memory          Show saved memories
 *   /memory clear    Clear all memories
 *   /workspace       Show workspace contents
 *   /workspace reset Clear workspace
 *   /help            Show commands
 */
import { createInterface } from "node:readline/promises";
import { loadConfig } from "./config/loader.js";
import { ClaudeRunner } from "./claude/runner.js";
import { PluginRegistry } from "./plugins/registry.js";
import type { Session } from "./session/manager.js";
import { createLogger } from "./logger.js";

const CLI_USER_ID = "cli-user";

async function main(): Promise<void> {
  // Stub Slack env vars (not needed for CLI)
  process.env.SLACK_APP_TOKEN ??= "xapp-cli";
  process.env.SLACK_BOT_TOKEN ??= "xoxb-cli";
  process.env.SLACK_SIGNING_SECRET ??= "cli";

  const { sweny: config, env } = await loadConfig();

  // ─── Storage ──────────────────────────────────────────────────
  const storage = config.storage;
  const memoryStore = storage.createMemoryStore();
  const workspaceStore = storage.createWorkspaceStore();

  // ─── Plugins ──────────────────────────────────────────────────
  const registry = new PluginRegistry(config.plugins);

  // ─── Runner ───────────────────────────────────────────────────
  const runner = new ClaudeRunner(
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

  // ─── Authenticate via AuthProvider ────────────────────────────
  let identity = await config.auth.authenticate(CLI_USER_ID);
  if (!identity && config.auth.login) {
    const credentials: Record<string, string> = {};
    if (config.auth.loginFields) {
      const promptRl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        for (const field of config.auth.loginFields) {
          const value = await promptRl.question(`${field.label}: `);
          credentials[field.key] = value;
        }
      } finally {
        promptRl.close();
      }
    }
    identity = await config.auth.login(CLI_USER_ID, credentials);
  }

  if (!identity) {
    identity = {
      userId: CLI_USER_ID,
      displayName: "CLI User",
      roles: ["admin"],
      metadata: {},
    };
  }

  // ─── Print status ─────────────────────────────────────────────
  console.log("");
  console.log(`${config.name} CLI`);
  console.log("\u2500".repeat(40));
  console.log(`  user:  ${identity.displayName}`);
  console.log(`  name:  ${config.name}`);
  console.log("\u2500".repeat(40));
  console.log("  /help for commands, /quit to exit");
  console.log("");

  // ─── Session state ────────────────────────────────────────────
  let session: Session = freshSession();
  let turnCount = 0;

  function freshSession(): Session {
    return {
      threadKey: `cli-${Date.now()}`,
      userId: CLI_USER_ID,
      claudeSessionId: null,
      messageCount: 0,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };
  }

  // ─── REPL ─────────────────────────────────────────────────────
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const shutdown = async (): Promise<void> => {
    rl.close();
    await registry.destroy();
  };

  process.on("SIGINT", async () => {
    console.log("\n");
    await shutdown();
    process.exit(0);
  });

  try {
    while (true) {
      let input: string;
      try {
        input = await rl.question("you> ");
      } catch {
        break;
      }
      const trimmed = input.trim();

      if (!trimmed) continue;

      // ─── Commands ──────────────────────────────────────────
      if (trimmed === "/quit" || trimmed === "/exit") {
        break;
      }

      if (trimmed === "/reset") {
        session = freshSession();
        turnCount = 0;
        console.log("Session cleared.\n");
        continue;
      }

      if (trimmed === "/workspace reset") {
        try {
          await workspaceStore.reset(CLI_USER_ID);
          console.log("Workspace cleared.\n");
        } catch (err) {
          console.error(`Error: ${(err as Error).message}\n`);
        }
        continue;
      }

      if (trimmed === "/workspace") {
        try {
          const manifest = await workspaceStore.getManifest(CLI_USER_ID);
          if (manifest.files.length === 0) {
            console.log("\nWorkspace is empty.\n");
          } else {
            console.log(`\nWorkspace: ${manifest.files.length} files, ${manifest.totalBytes} bytes\n`);
            for (const f of manifest.files) {
              console.log(`  ${f.path}  (${f.size} bytes)  ${f.description ?? ""}`);
            }
            console.log("");
          }
        } catch (err) {
          console.error(`Error: ${(err as Error).message}\n`);
        }
        continue;
      }

      if (trimmed === "/memory") {
        try {
          const userMemory = await memoryStore.getMemories(CLI_USER_ID);
          if (userMemory.entries.length === 0) {
            console.log("\nNo saved memories.\n");
          } else {
            console.log(`\n${userMemory.entries.length} memories:\n`);
            for (const m of userMemory.entries) {
              console.log(`  [${m.id}] ${m.text}`);
            }
            console.log("");
          }
        } catch (err) {
          console.error(`Error: ${(err as Error).message}\n`);
        }
        continue;
      }

      if (trimmed === "/memory clear") {
        try {
          await memoryStore.clearMemories(CLI_USER_ID);
          console.log("Memory cleared.\n");
        } catch (err) {
          console.error(`Error: ${(err as Error).message}\n`);
        }
        continue;
      }

      if (trimmed === "/help") {
        console.log("\nCommands:");
        console.log("  /memory          Show saved memories");
        console.log("  /memory clear    Clear all memories");
        console.log("  /workspace       Show workspace contents");
        console.log("  /workspace reset Clear workspace");
        console.log("  /reset           Clear session");
        console.log("  /quit            Exit");
        console.log("");
        continue;
      }

      if (trimmed.startsWith("/")) {
        console.log(`Unknown command: ${trimmed}. Type /help for commands.\n`);
        continue;
      }

      // ─── Run Claude ────────────────────────────────────────
      turnCount++;
      const spinner = startSpinner();

      try {
        const start = Date.now();
        const userMemory = await memoryStore.getMemories(CLI_USER_ID);
        const result = await runner.run({
          prompt: trimmed,
          session,
          user: identity,
          memories: userMemory.entries,
        });
        spinner.stop();

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);

        if (result.sessionId) {
          session.claudeSessionId = result.sessionId;
          session.lastActiveAt = new Date();
          session.messageCount++;
        }

        if (result.toolCalls.length > 0) {
          const toolNames = [...new Set(result.toolCalls.map((tc) => tc.toolName))];
          console.log(`  tools: ${toolNames.join(", ")}`);
        }

        console.log(`\n${result.response}\n`);
        console.log(`  (${elapsed}s, turn ${turnCount})\n`);
      } catch (err) {
        spinner.stop();
        console.error(`\nError: ${(err as Error).message}\n`);
      }
    }
  } finally {
    await shutdown();
  }
}

function startSpinner(): { stop: () => void } {
  const frames = [".", "..", "...", "   "];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  thinking${frames[i % frames.length]}   `);
    i++;
  }, 400);
  return {
    stop() {
      clearInterval(interval);
      process.stdout.write("\r" + " ".repeat(20) + "\r");
    },
  };
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
