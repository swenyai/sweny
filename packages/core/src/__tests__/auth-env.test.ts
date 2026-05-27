import { describe, it, expect, vi } from "vitest";
import { resolveAuthEnv } from "../claude.js";

const KEY = "sk-ant-secret-key";
const OAUTH = "oauth-secret-token";
const BEARER = "sk-litellm-bearer";

describe("resolveAuthEnv", () => {
  // ── auto (default) — must reproduce historical behavior byte-for-byte ──
  it("auto: strips ANTHROPIC_API_KEY when an OAuth token is present", () => {
    const out = resolveAuthEnv({ CLAUDE_CODE_OAUTH_TOKEN: OAUTH, ANTHROPIC_API_KEY: KEY });
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBe(OAUTH);
  });

  it("auto: no-op when only an OAuth token is present", () => {
    const out = resolveAuthEnv({ CLAUDE_CODE_OAUTH_TOKEN: OAUTH });
    expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBe(OAUTH);
  });

  it("auto: keeps a bare API key (no OAuth)", () => {
    const out = resolveAuthEnv({ ANTHROPIC_API_KEY: KEY });
    expect(out.ANTHROPIC_API_KEY).toBe(KEY);
  });

  it("auto: never strips ANTHROPIC_AUTH_TOKEN, even with OAuth present", () => {
    const out = resolveAuthEnv({
      CLAUDE_CODE_OAUTH_TOKEN: OAUTH,
      ANTHROPIC_AUTH_TOKEN: BEARER,
      ANTHROPIC_API_KEY: KEY,
    });
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.ANTHROPIC_AUTH_TOKEN).toBe(BEARER);
  });

  it("auto: empty-string OAuth token reads as unset, key survives", () => {
    const out = resolveAuthEnv({ CLAUDE_CODE_OAUTH_TOKEN: "", ANTHROPIC_API_KEY: KEY });
    expect(out.ANTHROPIC_API_KEY).toBe(KEY);
  });

  it("auto: empty-string SWENY_AUTH behaves as auto with no warning", () => {
    const warn = vi.fn();
    const out = resolveAuthEnv(
      { SWENY_AUTH: "", CLAUDE_CODE_OAUTH_TOKEN: OAUTH, ANTHROPIC_API_KEY: KEY },
      { logger: { warn, debug: vi.fn() } },
    );
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  // ── api-key ──
  it("api-key: keeps key + bearer even when an OAuth token is present", () => {
    const out = resolveAuthEnv({
      SWENY_AUTH: "api-key",
      CLAUDE_CODE_OAUTH_TOKEN: OAUTH,
      ANTHROPIC_API_KEY: KEY,
      ANTHROPIC_AUTH_TOKEN: BEARER,
    });
    expect(out.ANTHROPIC_API_KEY).toBe(KEY);
    expect(out.ANTHROPIC_AUTH_TOKEN).toBe(BEARER);
  });

  // ── oauth ──
  it("oauth: strips both key and bearer, keeps OAuth (fails closed)", () => {
    const out = resolveAuthEnv({
      SWENY_AUTH: "oauth",
      CLAUDE_CODE_OAUTH_TOKEN: OAUTH,
      ANTHROPIC_API_KEY: KEY,
      ANTHROPIC_AUTH_TOKEN: BEARER,
    });
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBe(OAUTH);
  });

  // ── invalid + override ──
  it("invalid SWENY_AUTH falls back to auto and warns", () => {
    const warn = vi.fn();
    const out = resolveAuthEnv(
      { SWENY_AUTH: "nonsense", CLAUDE_CODE_OAUTH_TOKEN: OAUTH, ANTHROPIC_API_KEY: KEY },
      { logger: { warn, debug: vi.fn() } },
    );
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("opts.mode overrides env.SWENY_AUTH (test seam)", () => {
    const out = resolveAuthEnv(
      { SWENY_AUTH: "auto", CLAUDE_CODE_OAUTH_TOKEN: OAUTH, ANTHROPIC_API_KEY: KEY },
      { mode: "api-key" },
    );
    expect(out.ANTHROPIC_API_KEY).toBe(KEY);
  });

  // ── purity + no secret logging ──
  it("returns a copy and does not mutate the input", () => {
    const input = { CLAUDE_CODE_OAUTH_TOKEN: OAUTH, ANTHROPIC_API_KEY: KEY };
    const out = resolveAuthEnv(input);
    expect(input.ANTHROPIC_API_KEY).toBe(KEY); // input untouched
    expect(out).not.toBe(input);
  });

  it("debug log contains the mode but no credential values", () => {
    const debug = vi.fn();
    resolveAuthEnv(
      { SWENY_AUTH: "api-key", ANTHROPIC_API_KEY: KEY, ANTHROPIC_AUTH_TOKEN: BEARER, CLAUDE_CODE_OAUTH_TOKEN: OAUTH },
      { logger: { debug, warn: vi.fn() } },
    );
    const logged = debug.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("api-key");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(OAUTH);
    expect(logged).not.toContain(BEARER);
  });
});
