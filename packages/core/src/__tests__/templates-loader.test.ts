import { describe, it, expect, vi, afterEach } from "vitest";

// Fix #16: CLI rules/context loading must honor the same offline and
// fetchAuth semantics as the executor's per-node Source resolution.
// Previously loadAdditionalContext() hardcoded { offline: false, authConfig: {} }.

describe("loadAdditionalContext honors offline + fetchAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses to fetch URL sources when offline: true", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("should not be called", { status: 200 }));

    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m: unknown) => warns.push(String(m)));

    const { loadAdditionalContext } = await import("../templates.js");
    const { resolved } = await loadAdditionalContext(["https://example.com/rules.md"], { offline: true });

    expect(fetchSpy).not.toHaveBeenCalled();
    // The source is skipped — failure is logged, result is empty.
    expect(resolved).toBe("");
    expect(warns.some((w) => /offline/i.test(w))).toBe(true);
  });

  it("sends Authorization header when fetchAuth maps the host", async () => {
    const captured: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init?: any) => {
      const headers: Record<string, string> = {};
      const rawHeaders = init?.headers ?? {};
      for (const [k, v] of Object.entries(rawHeaders)) {
        headers[k.toLowerCase()] = String(v);
      }
      captured.push({ url: String(url), headers });
      return new Response("# rules\ncontent", { status: 200 });
    });

    const { loadAdditionalContext } = await import("../templates.js");
    await loadAdditionalContext(["https://api.internal/rules.md"], {
      fetchAuth: { "api.internal": "MY_TOKEN" },
      env: { MY_TOKEN: "secret-value" },
    });

    expect(captured.length).toBe(1);
    expect(captured[0].headers.authorization).toBe("Bearer secret-value");
  });

  it("falls back to no auth when host is not in fetchAuth", async () => {
    const captured: Array<{ headers: Record<string, string> }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url: any, init?: any) => {
      const headers: Record<string, string> = {};
      const rawHeaders = init?.headers ?? {};
      for (const [k, v] of Object.entries(rawHeaders)) {
        headers[k.toLowerCase()] = String(v);
      }
      captured.push({ headers });
      return new Response("content", { status: 200 });
    });

    const { loadAdditionalContext } = await import("../templates.js");
    await loadAdditionalContext(["https://public.example/rules.md"], {
      fetchAuth: { "api.internal": "MY_TOKEN" },
      env: { MY_TOKEN: "secret" },
    });

    expect(captured[0].headers.authorization).toBeUndefined();
  });
});

describe("loadTemplate honors offline + fetchAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns fallback when offline and source is a URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("remote", { status: 200 }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { loadTemplate } = await import("../templates.js");
    const result = await loadTemplate("https://example.com/pr-template.md", "FALLBACK", { offline: true });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toBe("FALLBACK");
  });
});
