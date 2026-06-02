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

// IO-05: a CONFIGURED template/context source that fails to resolve must NOT
// silently degrade to the default — it surfaces an error. Only the empty/unset
// case (and the intentional --offline skip) returns the fallback.
describe("loadTemplate surfaces configured-source failures (IO-05)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when a configured template URL 403s instead of silently using the default", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("forbidden", { status: 403 }));

    const { loadTemplate } = await import("../templates.js");
    await expect(
      loadTemplate("https://example.com/pr-template.md", "FALLBACK", {
        fetchAuth: {},
        env: {} as NodeJS.ProcessEnv,
      }),
    ).rejects.toThrow(/Failed to load configured template.*403/);
  });

  it("throws when a configured template URL is blocked by the SSRF guard", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { loadTemplate } = await import("../templates.js");
    await expect(loadTemplate("http://169.254.169.254/latest/template.md", "FALLBACK", {})).rejects.toThrow(
      /Failed to load configured template.*SOURCE_URL_BLOCKED/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the default (no throw) when the source is empty/unset", async () => {
    const { loadTemplate } = await import("../templates.js");
    expect(await loadTemplate(undefined, "FALLBACK")).toBe("FALLBACK");
    expect(await loadTemplate("", "FALLBACK")).toBe("FALLBACK");
    expect(await loadTemplate("   ", "FALLBACK")).toBe("FALLBACK");
  });
});

describe("loadAdditionalContext surfaces configured-source failures (IO-05)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when a configured context URL 403s instead of silently dropping it", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("forbidden", { status: 403 }));

    const { loadAdditionalContext } = await import("../templates.js");
    await expect(loadAdditionalContext(["https://example.com/rules.md"], {})).rejects.toThrow(
      /Failed to load configured context source.*403/,
    );
  });

  it("still skips a URL source under --offline (warn, no throw)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const warns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((m: unknown) => warns.push(String(m)));

    const { loadAdditionalContext } = await import("../templates.js");
    const { resolved } = await loadAdditionalContext(["https://example.com/rules.md"], { offline: true });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(resolved).toBe("");
    expect(warns.some((w) => /offline/i.test(w))).toBe(true);
  });
});
