import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConversationRef, SentMessage } from "../../src/channel/types.js";

// ---------------------------------------------------------------------------
// vi.hoisted() — variables used inside vi.mock factories must be hoisted
// because vi.mock is itself hoisted above all imports.
// ---------------------------------------------------------------------------

const {
  mockPostMessage,
  mockChatUpdate,
  mockViewsOpen,
  mockAppEvent,
  mockAppMessage,
  mockAppCommand,
  mockAppView,
  mockAppStart,
  mockAppStop,
  mockRegisterLoginModal,
} = vi.hoisted(() => ({
  mockPostMessage: vi.fn(),
  mockChatUpdate: vi.fn(),
  mockViewsOpen: vi.fn(),
  mockAppEvent: vi.fn(),
  mockAppMessage: vi.fn(),
  mockAppCommand: vi.fn(),
  mockAppView: vi.fn(),
  mockAppStart: vi.fn(async () => {}),
  mockAppStop: vi.fn(async () => {}),
  mockRegisterLoginModal: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock @slack/bolt — App constructor returns a fake Bolt instance.
// ---------------------------------------------------------------------------

vi.mock("@slack/bolt", () => {
  // Must use a regular function (not arrow) so it can be called with `new`.
  function MockApp() {
    return {
      event: mockAppEvent,
      message: mockAppMessage,
      command: mockAppCommand,
      view: mockAppView,
      start: mockAppStart,
      stop: mockAppStop,
      client: {
        chat: { postMessage: mockPostMessage, update: mockChatUpdate },
        views: { open: mockViewsOpen },
      },
    };
  }
  return { App: MockApp };
});

// Mock slack-login so we don't pull in its dependency chain
vi.mock("../../src/channel/slack-login.js", () => ({
  registerLoginModal: mockRegisterLoginModal,
}));

import { slackChannel } from "../../src/channel/slack.js";
import type { Channel, IncomingMessage } from "../../src/channel/types.js";

const DEFAULT_CONFIG = {
  appToken: "xapp-test-token",
  botToken: "xoxb-test-token",
  signingSecret: "test-signing-secret",
};

describe("slackChannel", () => {
  let channel: Channel;

  beforeEach(() => {
    vi.clearAllMocks();
    channel = slackChannel(DEFAULT_CONFIG);
  });

  // -------------------------------------------------------------------------
  // Factory & properties
  // -------------------------------------------------------------------------
  describe("properties", () => {
    it('has name "slack"', () => {
      expect(channel.name).toBe("slack");
    });

    it('has formatHint "slack-mrkdwn"', () => {
      expect(channel.formatHint).toBe("slack-mrkdwn");
    });
  });

  // -------------------------------------------------------------------------
  // formatResponse (delegates to slack-formatter)
  // -------------------------------------------------------------------------
  describe("formatResponse", () => {
    it("returns single-element array for short text", () => {
      const result = channel.formatResponse("hello world");
      expect(result).toEqual(["hello world"]);
    });

    it("returns fallback for empty text", () => {
      const result = channel.formatResponse("");
      // slack-formatter returns ["No response generated."] for empty input
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("No response generated.");
    });

    it("splits long text into multiple chunks", () => {
      const longText = "a".repeat(6500);
      const result = channel.formatResponse(longText);
      expect(result.length).toBeGreaterThan(1);

      // Every chunk should be <= 3000 chars
      for (const chunk of result) {
        expect(chunk.length).toBeLessThanOrEqual(3000);
      }

      // All content should be preserved
      expect(result.join("")).toBe(longText);
    });

    it("prefers splitting on paragraph boundaries", () => {
      // Build text: 2800 chars, then a double newline, then 2800 chars
      const part1 = "x".repeat(2800);
      const part2 = "y".repeat(2800);
      const text = `${part1}\n\n${part2}`;

      const result = channel.formatResponse(text);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(part1);
      expect(result[1]).toBe(part2);
    });
  });

  // -------------------------------------------------------------------------
  // sendMessage
  // -------------------------------------------------------------------------
  describe("sendMessage", () => {
    it("calls client.chat.postMessage with correct params", async () => {
      mockPostMessage.mockResolvedValueOnce({ ok: true, ts: "1234567890.123456" });

      const conversation: ConversationRef = {
        conversationId: "C12345",
        messageId: "thread-ts-1",
      };

      await channel.sendMessage(conversation, "Hello from agent");

      expect(mockPostMessage).toHaveBeenCalledTimes(1);
      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: "C12345",
        thread_ts: "thread-ts-1",
        text: "Hello from agent",
      });
    });

    it("returns SentMessage with correct refs", async () => {
      mockPostMessage.mockResolvedValueOnce({ ok: true, ts: "1234567890.999" });

      const conversation: ConversationRef = {
        conversationId: "C99",
        messageId: "t1",
      };

      const sent = await channel.sendMessage(conversation, "test");

      expect(sent.ref).toBe(conversation);
      expect(sent.platformMessageId).toBe("1234567890.999");
    });

    it("returns empty platformMessageId when Slack omits ts", async () => {
      mockPostMessage.mockResolvedValueOnce({ ok: true });

      const conversation: ConversationRef = {
        conversationId: "C1",
        messageId: "t1",
      };

      const sent = await channel.sendMessage(conversation, "test");
      expect(sent.platformMessageId).toBe("");
    });
  });

  // -------------------------------------------------------------------------
  // editMessage
  // -------------------------------------------------------------------------
  describe("editMessage", () => {
    it("is defined (Slack supports message editing)", () => {
      expect(channel.editMessage).toBeDefined();
    });

    it("calls client.chat.update with correct params", async () => {
      mockChatUpdate.mockResolvedValueOnce({ ok: true });

      const message: SentMessage = {
        ref: { conversationId: "C12345", messageId: "thread-ts-1" },
        platformMessageId: "1234567890.123456",
      };

      await channel.editMessage!(message, "Updated text");

      expect(mockChatUpdate).toHaveBeenCalledTimes(1);
      expect(mockChatUpdate).toHaveBeenCalledWith({
        channel: "C12345",
        ts: "1234567890.123456",
        text: "Updated text",
      });
    });
  });

  // -------------------------------------------------------------------------
  // start
  // -------------------------------------------------------------------------
  describe("start", () => {
    it("registers a message handler via app.message()", async () => {
      const onMessage = vi.fn(async () => {});
      await channel.start(onMessage);

      expect(mockAppMessage).toHaveBeenCalledTimes(1);
      expect(typeof mockAppMessage.mock.calls[0][0]).toBe("function");
    });

    it("registers an app_mention event handler", async () => {
      const onMessage = vi.fn(async () => {});
      await channel.start(onMessage);

      expect(mockAppEvent).toHaveBeenCalledWith("app_mention", expect.any(Function));
    });

    it("calls app.start() to begin listening", async () => {
      const onMessage = vi.fn(async () => {});
      await channel.start(onMessage);

      expect(mockAppStart).toHaveBeenCalledTimes(1);
    });

    it("returns a teardown function that stops the app", async () => {
      const onMessage = vi.fn(async () => {});
      const teardown = await channel.start(onMessage);

      expect(typeof teardown).toBe("function");

      await teardown();
      expect(mockAppStop).toHaveBeenCalledTimes(1);
    });

    describe("message handler", () => {
      it("dispatches direct messages to onMessage", async () => {
        const messages: IncomingMessage[] = [];
        const onMessage = vi.fn(async (msg: IncomingMessage) => {
          messages.push(msg);
        });

        await channel.start(onMessage);

        // Grab the registered message handler and invoke it
        const handler = mockAppMessage.mock.calls[0][0];
        await handler({
          message: {
            user: "U123",
            text: "hello",
            channel: "C456",
            ts: "111.222",
          },
        });

        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(messages[0]).toEqual({
          userId: "U123",
          text: "hello",
          conversation: {
            conversationId: "C456",
            messageId: "111.222",
          },
        });
      });

      it("uses thread_ts when present", async () => {
        const messages: IncomingMessage[] = [];
        const onMessage = vi.fn(async (msg: IncomingMessage) => {
          messages.push(msg);
        });

        await channel.start(onMessage);

        const handler = mockAppMessage.mock.calls[0][0];
        await handler({
          message: {
            user: "U123",
            text: "reply",
            channel: "C456",
            ts: "111.222",
            thread_ts: "100.000",
          },
        });

        expect(messages[0]!.conversation.messageId).toBe("100.000");
      });

      it("ignores messages with subtypes (bot messages, edits, etc.)", async () => {
        const onMessage = vi.fn(async () => {});
        await channel.start(onMessage);

        const handler = mockAppMessage.mock.calls[0][0];
        await handler({
          message: {
            subtype: "bot_message",
            user: "U123",
            text: "bot says",
            channel: "C456",
            ts: "111.222",
          },
        });

        expect(onMessage).not.toHaveBeenCalled();
      });

      it("ignores messages without text", async () => {
        const onMessage = vi.fn(async () => {});
        await channel.start(onMessage);

        const handler = mockAppMessage.mock.calls[0][0];
        await handler({
          message: {
            user: "U123",
            channel: "C456",
            ts: "111.222",
          },
        });

        expect(onMessage).not.toHaveBeenCalled();
      });

      it("ignores messages without user", async () => {
        const onMessage = vi.fn(async () => {});
        await channel.start(onMessage);

        const handler = mockAppMessage.mock.calls[0][0];
        await handler({
          message: {
            text: "ghost message",
            channel: "C456",
            ts: "111.222",
          },
        });

        expect(onMessage).not.toHaveBeenCalled();
      });
    });

    describe("app_mention handler", () => {
      it("dispatches mentions to onMessage", async () => {
        const messages: IncomingMessage[] = [];
        const onMessage = vi.fn(async (msg: IncomingMessage) => {
          messages.push(msg);
        });

        await channel.start(onMessage);

        // Grab the app_mention handler
        const mentionHandler = mockAppEvent.mock.calls.find(
          (c) => c[0] === "app_mention",
        )![1];

        await mentionHandler({
          event: {
            user: "U789",
            text: "<@BOT123> what is 2+2?",
            channel: "C456",
            ts: "222.333",
          },
        });

        expect(onMessage).toHaveBeenCalledTimes(1);
        expect(messages[0]!.text).toBe("what is 2+2?");
        expect(messages[0]!.userId).toBe("U789");
        expect(messages[0]!.conversation.conversationId).toBe("C456");
      });

      it("strips @mention tags from text", async () => {
        const messages: IncomingMessage[] = [];
        const onMessage = vi.fn(async (msg: IncomingMessage) => {
          messages.push(msg);
        });

        await channel.start(onMessage);

        const mentionHandler = mockAppEvent.mock.calls.find(
          (c) => c[0] === "app_mention",
        )![1];

        await mentionHandler({
          event: {
            user: "U789",
            text: "<@BOT123> <@U999> help me",
            channel: "C456",
            ts: "222.333",
          },
        });

        expect(messages[0]!.text).toBe("help me");
      });

      it("uses thread_ts when present", async () => {
        const messages: IncomingMessage[] = [];
        const onMessage = vi.fn(async (msg: IncomingMessage) => {
          messages.push(msg);
        });

        await channel.start(onMessage);

        const mentionHandler = mockAppEvent.mock.calls.find(
          (c) => c[0] === "app_mention",
        )![1];

        await mentionHandler({
          event: {
            user: "U789",
            text: "<@BOT123> reply",
            channel: "C456",
            ts: "222.333",
            thread_ts: "200.000",
          },
        });

        expect(messages[0]!.conversation.messageId).toBe("200.000");
      });

      it("ignores mentions with empty text after stripping @tags", async () => {
        const onMessage = vi.fn(async () => {});
        await channel.start(onMessage);

        const mentionHandler = mockAppEvent.mock.calls.find(
          (c) => c[0] === "app_mention",
        )![1];

        await mentionHandler({
          event: {
            user: "U789",
            text: "<@BOT123>",
            channel: "C456",
            ts: "222.333",
          },
        });

        expect(onMessage).not.toHaveBeenCalled();
      });

      it("ignores mentions without user", async () => {
        const onMessage = vi.fn(async () => {});
        await channel.start(onMessage);

        const mentionHandler = mockAppEvent.mock.calls.find(
          (c) => c[0] === "app_mention",
        )![1];

        await mentionHandler({
          event: {
            text: "<@BOT123> hello",
            channel: "C456",
            ts: "222.333",
          },
        });

        expect(onMessage).not.toHaveBeenCalled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // registerLoginUI
  // -------------------------------------------------------------------------
  describe("registerLoginUI", () => {
    it("is defined", () => {
      expect(channel.registerLoginUI).toBeDefined();
    });

    it("delegates to registerLoginModal", () => {
      const mockAuthProvider = { displayName: "Test", loginFields: [] } as any;
      channel.registerLoginUI!(mockAuthProvider);

      expect(mockRegisterLoginModal).toHaveBeenCalledTimes(1);
      // First arg is the Bolt app instance, second is the auth provider
      expect(mockRegisterLoginModal).toHaveBeenCalledWith(
        expect.any(Object),
        mockAuthProvider,
      );
    });
  });

  // -------------------------------------------------------------------------
  // registerCommands
  // -------------------------------------------------------------------------
  describe("registerCommands", () => {
    it("is defined", () => {
      expect(channel.registerCommands).toBeDefined();
    });

    it("registers Slack slash commands via app.command()", () => {
      const cmds = [
        { name: "greet", description: "Say hello", execute: vi.fn() },
        { name: "help", description: "Show help", execute: vi.fn() },
      ];

      channel.registerCommands!(cmds);

      expect(mockAppCommand).toHaveBeenCalledTimes(2);
      expect(mockAppCommand).toHaveBeenCalledWith("/greet", expect.any(Function));
      expect(mockAppCommand).toHaveBeenCalledWith("/help", expect.any(Function));
    });

    it("command handler calls ack and execute with correct args", async () => {
      const executeFn = vi.fn(async () => {});
      const cmds = [{ name: "test", description: "Test cmd", execute: executeFn }];

      channel.registerCommands!(cmds);

      // Grab the registered command handler
      const commandHandler = mockAppCommand.mock.calls.find(
        (c) => c[0] === "/test",
      )![1];

      const ack = vi.fn(async () => {});
      const respond = vi.fn(async () => {});
      const body = {
        channel_id: "C123",
        trigger_id: "T456",
        user_id: "U789",
        text: "some args",
      };

      await commandHandler({ ack, respond, body });

      expect(ack).toHaveBeenCalledTimes(1);
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "U789",
          text: "some args",
          conversation: {
            conversationId: "C123",
            messageId: "T456",
          },
        }),
      );
    });

    it("command respond function calls Slack respond with ephemeral message", async () => {
      const executeFn = vi.fn(async ({ respond }: { respond: (t: string) => Promise<void> }) => {
        await respond("ephemeral reply");
      });
      const cmds = [{ name: "echo", description: "Echo", execute: executeFn }];

      channel.registerCommands!(cmds);

      const commandHandler = mockAppCommand.mock.calls.find(
        (c) => c[0] === "/echo",
      )![1];

      const ack = vi.fn(async () => {});
      const respond = vi.fn(async () => {});
      const body = {
        channel_id: "C1",
        trigger_id: "T1",
        user_id: "U1",
        text: "",
      };

      await commandHandler({ ack, respond, body });

      expect(respond).toHaveBeenCalledWith({
        response_type: "ephemeral",
        text: "ephemeral reply",
      });
    });
  });
});
