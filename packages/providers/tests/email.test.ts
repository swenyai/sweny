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

  // ---------------------------------------------------------------------------
  // HTML rendering from structured payload
  // ---------------------------------------------------------------------------

  it("sends text/html and builds HTML when status is present", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({ body: "fallback", status: "success", summary: "PR created" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content[0].type).toBe("text/html");
    expect(body.content[0].value).toContain("PR created");
    expect(body.content[0].value).toContain("#28a745"); // success green
  });

  it("sends text/html and renders fields as an HTML table", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({
      body: "fallback",
      fields: [
        { label: "Service", value: "api-*" },
        { label: "Range", value: "24h" },
      ],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content[0].type).toBe("text/html");
    const html: string = body.content[0].value;
    expect(html).toContain("<table");
    expect(html).toContain("Service");
    expect(html).toContain("api-*");
    expect(html).toContain("Range");
    expect(html).toContain("24h");
  });

  it("renders links as anchor buttons in HTML", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({
      body: "fallback",
      links: [
        { label: "View PR", url: "https://github.com/org/repo/pull/42" },
        { label: "View Issue", url: "https://linear.app/ENG-100" },
      ],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const html: string = body.content[0].value;
    expect(html).toContain(`href="https://github.com/org/repo/pull/42"`);
    expect(html).toContain("View PR");
    expect(html).toContain(`href="https://linear.app/ENG-100"`);
  });

  it("renders sections as h3 + pre blocks in HTML", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({
      body: "fallback",
      sections: [{ title: "Investigation Log", content: "Found 3 errors in <service>" }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const html: string = body.content[0].value;
    expect(html).toContain("<h3>Investigation Log</h3>");
    expect(html).toContain("<pre");
    // Content should be HTML-escaped
    expect(html).toContain("Found 3 errors in &lt;service&gt;");
  });

  it("escapes HTML special chars in field values", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({
      body: "fallback",
      fields: [{ label: "Query", value: "<script>alert('xss')</script>" }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const html: string = body.content[0].value;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("rejects javascript: links via safeUrl fallback", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({
      body: "fallback",

      links: [{ label: "Evil", url: "javascript:alert(1)" }],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const html: string = body.content[0].value;
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  it("does not build HTML when no structured content and format is not html", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = createProvider();
    await provider.send({ body: "plain body", format: "text" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content[0].type).toBe("text/plain");
    expect(body.content[0].value).toBe("plain body");
  });
});
