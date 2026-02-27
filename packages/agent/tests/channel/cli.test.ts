import { describe, it, expect, vi, beforeEach } from "vitest";
import { PassThrough } from "node:stream";
import { cliChannel } from "../../src/channel/cli.js";
import type { IncomingMessage, ChannelCommand } from "../../src/channel/types.js";

function createStreams() {
  const input = new PassThrough();
  const output = new PassThrough();
  return { input, output };
}

function collectOutput(output: PassThrough): string[] {
  const chunks: string[] = [];
  output.on("data", (chunk: Buffer) => {
    chunks.push(chunk.toString());
  });
  return chunks;
}

/** Write a line to the input stream (simulates user typing + enter) */
function writeLine(input: PassThrough, text: string): void {
  input.write(text + "\n");
}

/** Wait for async handlers to flush */
function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("cliChannel", () => {
  let input: PassThrough;
  let output: PassThrough;

  beforeEach(() => {
    const streams = createStreams();
    input = streams.input;
    output = streams.output;
  });

  describe("properties", () => {
    it('has name "cli"', () => {
      const channel = cliChannel({ input, output });
      expect(channel.name).toBe("cli");
    });

    it('has formatHint "plaintext"', () => {
      const channel = cliChannel({ input, output });
      expect(channel.formatHint).toBe("plaintext");
    });
  });

  describe("formatResponse", () => {
    it("returns a single-element array with the text", () => {
      const channel = cliChannel({ input, output });
      expect(channel.formatResponse("hello world")).toEqual(["hello world"]);
    });

    it("does not chunk long text", () => {
      const channel = cliChannel({ input, output });
      const longText = "x".repeat(10_000);
      const result = channel.formatResponse(longText);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(longText);
    });
  });

  describe("sendMessage", () => {
    it("writes text to the output stream", async () => {
      const channel = cliChannel({ input, output });
      const chunks = collectOutput(output);

      const conversation = { conversationId: "cli", messageId: "m1" };
      await channel.sendMessage(conversation, "hello from agent");

      // The output should contain the message text
      const combined = chunks.join("");
      expect(combined).toContain("hello from agent");
    });

    it("returns a SentMessage with the conversation ref", async () => {
      const channel = cliChannel({ input, output });
      collectOutput(output); // consume output

      const conversation = { conversationId: "cli", messageId: "m1" };
      const sent = await channel.sendMessage(conversation, "test");

      expect(sent.ref).toBe(conversation);
      expect(typeof sent.platformMessageId).toBe("string");
      expect(sent.platformMessageId.length).toBeGreaterThan(0);
    });
  });

  describe("start", () => {
    it("calls onMessage for user input", async () => {
      const channel = cliChannel({ input, output, prompt: "" });
      collectOutput(output);

      const messages: IncomingMessage[] = [];
      const onMessage = vi.fn(async (msg: IncomingMessage) => {
        messages.push(msg);
      });

      const teardown = await channel.start(onMessage);

      writeLine(input, "hello agent");
      await tick();

      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(messages[0]!.text).toBe("hello agent");
      expect(messages[0]!.userId).toBe("cli-user");
      expect(messages[0]!.conversation.conversationId).toBe("cli");

      await teardown();
    });

    it("skips empty lines", async () => {
      const channel = cliChannel({ input, output, prompt: "" });
      collectOutput(output);

      const onMessage = vi.fn(async () => {});
      const teardown = await channel.start(onMessage);

      writeLine(input, "");
      writeLine(input, "   ");
      writeLine(input, "\t");
      await tick();

      expect(onMessage).not.toHaveBeenCalled();

      await teardown();
    });

    it("/quit triggers readline close", async () => {
      const channel = cliChannel({ input, output, prompt: "" });
      collectOutput(output);

      const onMessage = vi.fn(async () => {});
      const teardown = await channel.start(onMessage);

      writeLine(input, "/quit");
      await tick();

      expect(onMessage).not.toHaveBeenCalled();

      await teardown();
    });

    it("/exit also triggers readline close", async () => {
      const channel = cliChannel({ input, output, prompt: "" });
      collectOutput(output);

      const onMessage = vi.fn(async () => {});
      const teardown = await channel.start(onMessage);

      writeLine(input, "/exit");
      await tick();

      expect(onMessage).not.toHaveBeenCalled();

      await teardown();
    });

    it("returns a teardown function that closes readline", async () => {
      const channel = cliChannel({ input, output, prompt: "" });
      collectOutput(output);

      const onMessage = vi.fn(async () => {});
      const teardown = await channel.start(onMessage);

      expect(typeof teardown).toBe("function");

      // Should not throw
      await teardown();
    });
  });

  describe("registerCommands", () => {
    it("dispatches registered commands", async () => {
      const channel = cliChannel({ input, output, prompt: "" });
      collectOutput(output);

      const executeFn = vi.fn(async () => {});
      const cmd: ChannelCommand = {
        name: "greet",
        description: "Say hello",
        execute: executeFn,
      };

      channel.registerCommands!([cmd]);

      const onMessage = vi.fn(async () => {});
      const teardown = await channel.start(onMessage);

      writeLine(input, "/greet world");
      await tick();

      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "cli-user",
          text: "world",
          conversation: expect.objectContaining({ conversationId: "cli" }),
          respond: expect.any(Function),
        }),
      );
      // onMessage should NOT be called for commands
      expect(onMessage).not.toHaveBeenCalled();

      await teardown();
    });

    it("passes unregistered /commands to onMessage", async () => {
      const channel = cliChannel({ input, output, prompt: "" });
      collectOutput(output);

      channel.registerCommands!([]);

      const messages: IncomingMessage[] = [];
      const onMessage = vi.fn(async (msg: IncomingMessage) => {
        messages.push(msg);
      });
      const teardown = await channel.start(onMessage);

      writeLine(input, "/unknown stuff");
      await tick();

      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(messages[0]!.text).toBe("/unknown stuff");

      await teardown();
    });

    it("command respond function writes to output", async () => {
      const channel = cliChannel({ input, output, prompt: "" });
      const chunks = collectOutput(output);

      const cmd: ChannelCommand = {
        name: "echo",
        description: "Echo args",
        execute: async ({ text, respond }) => {
          await respond(`echoed: ${text}`);
        },
      };

      channel.registerCommands!([cmd]);

      const onMessage = vi.fn(async () => {});
      const teardown = await channel.start(onMessage);

      writeLine(input, "/echo hello");
      await tick();

      const combined = chunks.join("");
      expect(combined).toContain("echoed: hello");

      await teardown();
    });

    it("handles command with no arguments", async () => {
      const channel = cliChannel({ input, output, prompt: "" });
      collectOutput(output);

      const executeFn = vi.fn(async () => {});
      const cmd: ChannelCommand = {
        name: "help",
        description: "Show help",
        execute: executeFn,
      };

      channel.registerCommands!([cmd]);

      const onMessage = vi.fn(async () => {});
      const teardown = await channel.start(onMessage);

      writeLine(input, "/help");
      await tick();

      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "",
        }),
      );

      await teardown();
    });
  });

  describe("editMessage", () => {
    it("is not defined (optional)", () => {
      const channel = cliChannel({ input, output });
      expect(channel.editMessage).toBeUndefined();
    });
  });

  describe("config", () => {
    it("uses default prompt when not specified", async () => {
      const channel = cliChannel({ input, output });
      collectOutput(output);

      const onMessage = vi.fn(async () => {});
      const teardown = await channel.start(onMessage);

      // The default prompt "you> " should have been written to output
      // We just verify start() works without explicit prompt
      await teardown();
    });

    it("accepts custom prompt", async () => {
      const channel = cliChannel({ input, output, prompt: "test> " });
      collectOutput(output);

      const onMessage = vi.fn(async () => {});
      const teardown = await channel.start(onMessage);

      await teardown();
    });
  });
});
