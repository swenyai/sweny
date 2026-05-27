import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveCheckAuthMode, redactUrl, checkAnthropicGateway } from "../check.js";

type AuthFields = Parameters<typeof resolveCheckAuthMode>[0];

function auth(over: Partial<AuthFields> = {}): AuthFields {
  return { anthropicApiKey: "", anthropicAuthToken: "", claudeOauthToken: "", swenyAuth: "auto", ...over };
}

describe("resolveCheckAuthMode", () => {
  it("auto: OAuth wins when present (protective)", () => {
    expect(resolveCheckAuthMode(auth({ claudeOauthToken: "o", anthropicApiKey: "k" }))).toBe("oauth");
  });

  it("auto: api-key when only a key is present", () => {
    expect(resolveCheckAuthMode(auth({ anthropicApiKey: "k" }))).toBe("api-key");
  });

  it("auto: auth-token when only a bearer is present", () => {
    expect(resolveCheckAuthMode(auth({ anthropicAuthToken: "b" }))).toBe("auth-token");
  });

  it("auto: none when nothing is configured", () => {
    expect(resolveCheckAuthMode(auth())).toBe("none");
  });

  it("oauth mode: oauth when token present, else none", () => {
    expect(resolveCheckAuthMode(auth({ swenyAuth: "oauth", claudeOauthToken: "o", anthropicApiKey: "k" }))).toBe(
      "oauth",
    );
    expect(resolveCheckAuthMode(auth({ swenyAuth: "oauth", anthropicApiKey: "k" }))).toBe("none");
  });

  it("api-key mode: prefers key, then bearer, ignoring a present OAuth token", () => {
    expect(
      resolveCheckAuthMode(
        auth({ swenyAuth: "api-key", claudeOauthToken: "o", anthropicApiKey: "k", anthropicAuthToken: "b" }),
      ),
    ).toBe("api-key");
    expect(resolveCheckAuthMode(auth({ swenyAuth: "api-key", anthropicAuthToken: "b" }))).toBe("auth-token");
    expect(resolveCheckAuthMode(auth({ swenyAuth: "api-key" }))).toBe("none");
  });
});

describe("redactUrl", () => {
  it("keeps scheme + host only", () => {
    expect(redactUrl("https://litellm.internal:4000/v1/messages")).toBe("https://litellm.internal:4000");
  });

  it("drops userinfo and query (which can carry a credential)", () => {
    expect(redactUrl("https://user:secret@gw.example.com/v1?api_key=leak")).toBe("https://gw.example.com");
  });

  it("returns a safe placeholder for an invalid URL", () => {
    expect(redactUrl("not a url")).toBe("(invalid URL)");
  });
});

describe("checkAnthropicGateway", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(impl: (url: string, init: any) => Promise<{ ok: boolean; status: number }>) {
    const spy = vi.fn(impl);
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("probes the gateway base (not real Anthropic) with x-api-key in api-key mode", async () => {
    const spy = stubFetch(async () => ({ ok: true, status: 200 }));
    const res = await checkAnthropicGateway("https://gw.example.com", auth({ anthropicApiKey: "k" }), "api-key");
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://gw.example.com/v1/models");
    expect(url).not.toContain("api.anthropic.com");
    expect(init.headers["x-api-key"]).toBe("k");
    expect(init.headers.Authorization).toBeUndefined();
    expect(res.status).toBe("ok");
  });

  it("uses Authorization: Bearer for auth-token mode", async () => {
    const spy = stubFetch(async () => ({ ok: true, status: 200 }));
    await checkAnthropicGateway("https://gw.example.com", auth({ anthropicAuthToken: "b" }), "auth-token");
    expect(spy.mock.calls[0][1].headers.Authorization).toBe("Bearer b");
  });

  it("treats 404 as reachable (gateways may not implement /v1/models)", async () => {
    stubFetch(async () => ({ ok: false, status: 404 }));
    const res = await checkAnthropicGateway("https://gw.example.com", auth({ anthropicApiKey: "k" }), "api-key");
    expect(res.status).toBe("ok");
  });

  it("fails on 401/403 with a redacted base and no secret", async () => {
    stubFetch(async () => ({ ok: false, status: 401 }));
    const res = await checkAnthropicGateway(
      "https://user:supersecret@gw.example.com/v1",
      auth({ anthropicApiKey: "supersecret" }),
      "api-key",
    );
    expect(res.status).toBe("fail");
    expect(res.detail).toContain("https://gw.example.com");
    expect(res.detail).not.toContain("supersecret");
  });

  it("fails on an unexpected status", async () => {
    stubFetch(async () => ({ ok: false, status: 500 }));
    const res = await checkAnthropicGateway("https://gw.example.com", auth({ anthropicApiKey: "k" }), "api-key");
    expect(res.status).toBe("fail");
  });

  it("fails (not throws) on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const res = await checkAnthropicGateway("https://gw.example.com", auth({ anthropicApiKey: "k" }), "api-key");
    expect(res.status).toBe("fail");
  });

  it("strips a trailing slash from the base before appending /v1/models", async () => {
    const spy = stubFetch(async () => ({ ok: true, status: 200 }));
    await checkAnthropicGateway("https://gw.example.com/", auth({ anthropicApiKey: "k" }), "api-key");
    expect(spy.mock.calls[0][0]).toBe("https://gw.example.com/v1/models");
  });
});
