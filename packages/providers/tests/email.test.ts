import { describe, it, expect, vi, afterEach } from "vitest";
import { email, emailConfigSchema } from "../src/notification/email.js";
import { ProviderApiError } from "../src/errors.js";

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("emailConfigSchema", () => {
  it("validates a valid config with single recipient", () => {
    const result = emailConfigSchema.safeParse({
      apiKey: "SG.test-key",
      from: "noreply@sweny.ai",
      to: "team@example.com",
    });
    expect(result.success).toBe(true);
  });

  it("validates a valid config with array of recipients", () => {
    const result = emailConfigSchema.safeParse({
      apiKey: "SG.test-key",
      from: "noreply@sweny.ai",
      to: ["alice@example.com", "bob@example.com"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing apiKey", () => {
    const result = emailConfigSchema.safeParse({
      from: "noreply@sweny.ai",
      to: "team@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = emailConfigSchema.safeParse({
      apiKey: "",
      from: "noreply@sweny.ai",
      to: "team@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid from email", () => {
    const result = emailConfigSchema.safeParse({
      apiKey: "SG.key",
      from: "not-an-email",
      to: "team@example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid to email", () => {
    const result = emailConfigSchema.safeParse({
      apiKey: "SG.key",
      from: "noreply@sweny.ai",
      to: "not-an-email",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// send()
// ---------------------------------------------------------------------------

describe("email provider", () => {
  function createProvider(overrides?: { to?: string | string[] }) {
    return email({
      apiKey: "SG.test-key",
      from: "noreply@sweny.ai",
      to: overrides?.to ?? "team@example.com",
      logger: silentLogger,
    });
  }

  it("sends correct SendGrid payload with Bearer auth", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({ title: "Alert", body: "something broke", format: "text" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(opts.headers.Authorization).toBe("Bearer SG.test-key");
    expect(opts.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts.body);
    expect(body.from).toEqual({ email: "noreply@sweny.ai" });
    expect(body.subject).toBe("Alert");
    expect(body.content).toEqual([{ type: "text/plain", value: "something broke" }]);
  });

  it("sends to a single recipient", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider({ to: "alice@example.com" });
    await provider.send({ body: "test" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.personalizations).toEqual([{ to: [{ email: "alice@example.com" }] }]);
  });

  it("sends to multiple recipients", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider({ to: ["alice@example.com", "bob@example.com"] });
    await provider.send({ body: "test" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.personalizations).toEqual([{ to: [{ email: "alice@example.com" }, { email: "bob@example.com" }] }]);
  });

  it("sends plain text for markdown format", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({ body: "**bold**", format: "markdown" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content[0].type).toBe("text/plain");
  });

  it("sends plain text for text format", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({ body: "plain text", format: "text" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content[0].type).toBe("text/plain");
  });

  it("sends HTML for html format", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({ body: "<h1>Hello</h1>", format: "html" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content[0].type).toBe("text/html");
    expect(body.content[0].value).toBe("<h1>Hello</h1>");
  });

  it("uses title as subject", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({ title: "Deploy Failed", body: "details here" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.subject).toBe("Deploy Failed");
  });

  it("falls back to default subject when no title", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({ body: "no title" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.subject).toBe("SWEny Notification");
  });

  it("throws ProviderApiError on non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: () => Promise.resolve("invalid API key"),
    });

    const provider = createProvider();

    await expect(provider.send({ body: "test" })).rejects.toThrow(ProviderApiError);
    await expect(provider.send({ body: "test" })).rejects.toThrow("email API error: 403 Forbidden");
  });

  it("logs on successful send", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    const provider = createProvider();
    await provider.send({ body: "test" });

    expect(silentLogger.info).toHaveBeenCalledWith("Email notification sent to team@example.com");
  });
});
