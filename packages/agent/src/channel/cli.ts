import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import type { Channel, ChannelCommand, ConversationRef, IncomingMessage, SentMessage } from "./types.js";

const CLI_USER_ID = "cli-user";
const CLI_CONVERSATION_ID = "cli";

export interface CliChannelConfig {
  /** Prompt string shown before user input (default: "you> ") */
  prompt?: string;
  /** Input stream (default: process.stdin) */
  input?: NodeJS.ReadableStream;
  /** Output stream (default: process.stdout) */
  output?: NodeJS.WritableStream;
}

/**
 * Create a CLI channel adapter that implements the Channel interface
 * for terminal-based interaction.
 */
export function cliChannel(config?: CliChannelConfig): Channel {
  const prompt = config?.prompt ?? "you> ";
  const input = config?.input ?? process.stdin;
  const output = config?.output ?? process.stdout;

  let commands: ChannelCommand[] = [];
  let messageCounter = 0;

  function makeConversation(): ConversationRef {
    return {
      conversationId: CLI_CONVERSATION_ID,
      messageId: `cli-${Date.now()}-${messageCounter++}`,
    };
  }

  const channel: Channel = {
    name: "cli",
    formatHint: "plaintext",

    formatResponse(text: string): string[] {
      return [text];
    },

    async sendMessage(conversation: ConversationRef, text: string): Promise<SentMessage> {
      const data = text + "\n";
      await new Promise<void>((resolve, reject) => {
        output.write(data, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      const msgId = `sent-${Date.now()}-${messageCounter++}`;
      return {
        ref: conversation,
        platformMessageId: msgId,
      };
    },

    async start(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<() => Promise<void>> {
      const rl: ReadlineInterface = createInterface({
        input: input as NodeJS.ReadableStream,
        output: output as NodeJS.WritableStream,
        prompt,
      });

      rl.prompt();

      const lineHandler = async (line: string): Promise<void> => {
        const trimmed = line.trim();

        // Skip empty lines
        if (!trimmed) {
          rl.prompt();
          return;
        }

        // Handle /quit and /exit
        if (trimmed === "/quit" || trimmed === "/exit") {
          rl.close();
          return;
        }

        // Check registered commands
        if (trimmed.startsWith("/")) {
          const parts = trimmed.slice(1).split(/\s+/);
          const cmdName = parts[0]!;
          const cmdArgs = parts.slice(1).join(" ");

          const matched = commands.find((c) => c.name === cmdName);
          if (matched) {
            const conversation = makeConversation();
            await matched.execute({
              userId: CLI_USER_ID,
              text: cmdArgs,
              conversation,
              respond: async (text: string) => {
                await channel.sendMessage(conversation, text);
              },
            });
            rl.prompt();
            return;
          }
        }

        // Regular message
        const conversation = makeConversation();
        const msg: IncomingMessage = {
          userId: CLI_USER_ID,
          text: trimmed,
          conversation,
        };
        await onMessage(msg);
        rl.prompt();
      };

      rl.on("line", (line: string) => {
        void lineHandler(line);
      });

      // Teardown function
      return async () => {
        rl.close();
      };
    },

    registerCommands(cmds: ChannelCommand[]): void {
      commands = cmds;
    },
  };

  return channel;
}
