import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthProvider, LoginField, UserIdentity } from "../../src/auth/types.js";
import { registerLoginModal } from "../../src/channel/slack-login.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeField(overrides: Partial<LoginField> = {}): LoginField {
  return { key: "email", label: "Email", type: "email", ...overrides };
}

function makeAuthProvider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    displayName: "TestAuth",
    loginFields: [makeField()],
    authenticate: vi.fn(),
    login: vi.fn(async () => ({
      userId: "U1",
      displayName: "Alice",
      roles: [],
      metadata: {},
    })),
    hasValidSession: vi.fn(async () => false),
    clearSession: vi.fn(async () => {}),
    ...overrides,
  };
}

type Handler = (...args: any[]) => Promise<void>;

function makeMockApp() {
  const commands = new Map<string, Handler>();
  const views = new Map<string, Handler>();

  return {
    command: vi.fn((name: string, handler: Handler) => {
      commands.set(name, handler);
    }),
    view: vi.fn((callbackId: string, handler: Handler) => {
      views.set(callbackId, handler);
    }),
    getCommandHandler: (name: string) => commands.get(name),
    getViewHandler: (callbackId: string) => views.get(callbackId),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerLoginModal", () => {
  let app: ReturnType<typeof makeMockApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeMockApp();
  });

  it("does nothing when authProvider has no loginFields", () => {
    const provider = makeAuthProvider({ loginFields: [] });
    registerLoginModal(app as any, provider);

    expect(app.command).not.toHaveBeenCalled();
    expect(app.view).not.toHaveBeenCalled();
  });

  it("does nothing when loginFields is undefined", () => {
    const provider = makeAuthProvider({ loginFields: undefined });
    registerLoginModal(app as any, provider);

    expect(app.command).not.toHaveBeenCalled();
    expect(app.view).not.toHaveBeenCalled();
  });

  it("registers /login command and view handler", () => {
    registerLoginModal(app as any, makeAuthProvider());

    expect(app.command).toHaveBeenCalledWith("/login", expect.any(Function));
    expect(app.view).toHaveBeenCalledWith("sweny_login_modal", expect.any(Function));
  });

  describe("/login command handler", () => {
    it("acks and opens a modal with input blocks for each field", async () => {
      const provider = makeAuthProvider({
        loginFields: [
          makeField({ key: "email", label: "Email", type: "email", placeholder: "you@example.com" }),
          makeField({ key: "password", label: "Password", type: "password" }),
        ],
      });
      registerLoginModal(app as any, provider);

      const handler = app.getCommandHandler("/login")!;
      const ack = vi.fn();
      const viewsOpen = vi.fn();
      const body = { trigger_id: "T123" };

      await handler({ ack, client: { views: { open: viewsOpen } }, body });

      expect(ack).toHaveBeenCalled();
      expect(viewsOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger_id: "T123",
          view: expect.objectContaining({
            type: "modal",
            callback_id: "sweny_login_modal",
            title: { type: "plain_text", text: "TestAuth Login" },
            submit: { type: "plain_text", text: "Login" },
            close: { type: "plain_text", text: "Cancel" },
          }),
        }),
      );

      const blocks = viewsOpen.mock.calls[0][0].view.blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks[0].block_id).toBe("email_block");
      expect(blocks[0].element.type).toBe("email_text_input");
      expect(blocks[0].element.placeholder.text).toBe("you@example.com");
      expect(blocks[1].block_id).toBe("password_block");
      expect(blocks[1].element.type).toBe("plain_text_input");
      expect(blocks[1].element.placeholder).toBeUndefined();
    });
  });

  describe("view submission handler", () => {
    function setupLoginSubmission(provider?: AuthProvider) {
      const p = provider ?? makeAuthProvider();
      registerLoginModal(app as any, p);
      return app.getViewHandler("sweny_login_modal")!;
    }

    function makeViewState(values: Record<string, string | undefined>) {
      const state: Record<string, any> = {};
      for (const [key, val] of Object.entries(values)) {
        state[`${key}_block`] = { [`${key}_input`]: { value: val } };
      }
      return { state: { values: state } };
    }

    it("calls authProvider.login with extracted credentials on valid submission", async () => {
      const provider = makeAuthProvider();
      const handler = setupLoginSubmission(provider);
      const ack = vi.fn();
      const view = makeViewState({ email: "alice@test.com" });

      await handler({ ack, view, body: { user: { id: "U1" } } });

      expect(provider.login).toHaveBeenCalledWith("U1", { email: "alice@test.com" });
      expect(ack).toHaveBeenCalledWith(
        expect.objectContaining({
          response_action: "update",
          view: expect.objectContaining({
            blocks: expect.arrayContaining([
              expect.objectContaining({
                text: expect.objectContaining({
                  text: expect.stringContaining("Alice"),
                }),
              }),
            ]),
          }),
        }),
      );
    });

    it("returns field errors when required fields are missing", async () => {
      const provider = makeAuthProvider({
        loginFields: [
          makeField({ key: "email", label: "Email" }),
          makeField({ key: "token", label: "Token", type: "text" }),
        ],
      });
      const handler = setupLoginSubmission(provider);
      const ack = vi.fn();
      const view = makeViewState({ email: "alice@test.com", token: undefined });

      await handler({ ack, view, body: { user: { id: "U1" } } });

      expect(provider.login).not.toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith(
        expect.objectContaining({
          response_action: "errors",
          errors: { token_block: "Token is required" },
        }),
      );
    });

    it("shows error when authProvider.login is not defined", async () => {
      const provider = makeAuthProvider({ login: undefined });
      const handler = setupLoginSubmission(provider);
      const ack = vi.fn();
      const view = makeViewState({ email: "alice@test.com" });

      await handler({ ack, view, body: { user: { id: "U1" } } });

      expect(ack).toHaveBeenCalledWith(
        expect.objectContaining({
          response_action: "errors",
          errors: expect.objectContaining({
            email_block: expect.stringContaining("Login failed"),
          }),
        }),
      );
    });

    it("shows error on login failure", async () => {
      const provider = makeAuthProvider({
        login: vi.fn(async () => {
          throw new Error("Invalid credentials");
        }),
      });
      const handler = setupLoginSubmission(provider);
      const ack = vi.fn();
      const view = makeViewState({ email: "alice@test.com" });

      await handler({ ack, view, body: { user: { id: "U1" } } });

      expect(ack).toHaveBeenCalledWith(
        expect.objectContaining({
          response_action: "errors",
          errors: {
            email_block: "Login failed: Invalid credentials",
          },
        }),
      );
    });

    it("handles non-Error throws gracefully", async () => {
      const provider = makeAuthProvider({
        login: vi.fn(async () => {
          throw "string-error";
        }),
      });
      const handler = setupLoginSubmission(provider);
      const ack = vi.fn();
      const view = makeViewState({ email: "alice@test.com" });

      await handler({ ack, view, body: { user: { id: "U1" } } });

      expect(ack).toHaveBeenCalledWith(
        expect.objectContaining({
          response_action: "errors",
          errors: {
            email_block: "Login failed: Unknown error",
          },
        }),
      );
    });
  });
});
