import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hasGitHubOidc, mintGitHubOidcToken } from "../github-oidc.js";

describe("hasGitHubOidc", () => {
  const orig = {
    url: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    token: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  };

  afterEach(() => {
    if (orig.url === undefined) delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    else process.env.ACTIONS_ID_TOKEN_REQUEST_URL = orig.url;
    if (orig.token === undefined) delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    else process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = orig.token;
  });

  it("returns true when both OIDC env vars are set", () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://runner.example/oidc";
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "runner-token";
    expect(hasGitHubOidc()).toBe(true);
  });

  it("returns false when URL is missing", () => {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "runner-token";
    expect(hasGitHubOidc()).toBe(false);
  });

  it("returns false when token is missing", () => {
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://runner.example/oidc";
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    expect(hasGitHubOidc()).toBe(false);
  });

  it("returns false when neither is set", () => {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    expect(hasGitHubOidc()).toBe(false);
  });
});

describe("mintGitHubOidcToken", () => {
  const fetchMock = vi.fn();
  const orig = {
    url: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    token: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
  };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://runner.example/oidc";
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "runner-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (orig.url === undefined) delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    else process.env.ACTIONS_ID_TOKEN_REQUEST_URL = orig.url;
    if (orig.token === undefined) delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    else process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = orig.token;
  });

  it("returns the JWT from the runner response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ value: "jwt-abc.xyz.sig" }), { status: 200 }));

    const jwt = await mintGitHubOidcToken({ audience: "https://cloud.sweny.ai" });
    expect(jwt).toBe("jwt-abc.xyz.sig");
  });

  it("passes audience as a query parameter", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ value: "jwt" }), { status: 200 }));

    await mintGitHubOidcToken({ audience: "https://cloud.test.example" });
    const [url] = fetchMock.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get("audience")).toBe("https://cloud.test.example");
  });

  it("sends the runner token as Authorization: Bearer", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ value: "jwt" }), { status: 200 }));

    await mintGitHubOidcToken({ audience: "https://cloud.sweny.ai" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer runner-token");
  });

  it("throws when env vars are missing", async () => {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;

    await expect(mintGitHubOidcToken({ audience: "https://cloud.sweny.ai" })).rejects.toThrow(/OIDC env vars missing/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when runner returns non-2xx", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));

    await expect(mintGitHubOidcToken({ audience: "https://cloud.sweny.ai" })).rejects.toThrow(/403/);
  });

  it("throws when response body has no value field", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ other: "field" }), { status: 200 }));

    await expect(mintGitHubOidcToken({ audience: "https://cloud.sweny.ai" })).rejects.toThrow(/missing `value`/);
  });
});
