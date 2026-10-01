import { describe, it, expect } from "vitest";
import { claudeCodeAuth, codexAuth, CLAUDE_CODE_AUTH_HINT, CODEX_AUTH_HINT } from "./auth.js";

// #339: every probe here is faked. No real CLI, keychain or home directory.
const noLogin = () => false;
const hasLogin = () => true;

describe("claudeCodeAuth", () => {
  it("accepts an API key, an OAuth token or a bearer token", () => {
    expect(claudeCodeAuth({ ANTHROPIC_API_KEY: "k" }, noLogin)).toEqual({ ok: true, via: "ANTHROPIC_API_KEY" });
    expect(claudeCodeAuth({ CLAUDE_CODE_OAUTH_TOKEN: "t" }, noLogin)).toEqual({
      ok: true,
      via: "CLAUDE_CODE_OAUTH_TOKEN",
    });
    expect(claudeCodeAuth({ ANTHROPIC_AUTH_TOKEN: "b" }, noLogin)).toEqual({ ok: true, via: "ANTHROPIC_AUTH_TOKEN" });
  });

  it("accepts Bedrock and Vertex routing", () => {
    expect(claudeCodeAuth({ CLAUDE_CODE_USE_BEDROCK: "1" }, noLogin).ok).toBe(true);
    expect(claudeCodeAuth({ CLAUDE_CODE_USE_VERTEX: "true" }, noLogin).ok).toBe(true);
    expect(claudeCodeAuth({ CLAUDE_CODE_USE_BEDROCK: "0" }, noLogin).ok).toBe(false);
  });

  it("accepts a stored Claude Code login when no env credential is set", () => {
    expect(claudeCodeAuth({}, hasLogin)).toEqual({ ok: true, via: "Claude Code login" });
  });

  it("treats empty values as unset (action.yml passes '' for omitted inputs)", () => {
    const r = claudeCodeAuth({ ANTHROPIC_API_KEY: "", CLAUDE_CODE_OAUTH_TOKEN: " " }, noLogin);
    expect(r).toEqual({ ok: false, reason: CLAUDE_CODE_AUTH_HINT });
  });

  it("SWENY_AUTH=oauth ignores keys the agent will never see", () => {
    const r = claudeCodeAuth({ SWENY_AUTH: "oauth", ANTHROPIC_API_KEY: "k", ANTHROPIC_AUTH_TOKEN: "b" }, noLogin);
    expect(r.ok).toBe(false);
  });

  it("fails with a fix that names the agent, the env vars and the login", () => {
    const r = claudeCodeAuth({}, noLogin);
    expect(r.ok).toBe(false);
    const reason = !r.ok ? r.reason : "";
    expect(reason).toMatch(/^Missing: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN/);
    expect(reason).toMatch(/Claude Code login/);
    expect(reason).toMatch(/for --agent claude$/);
  });
});

describe("codexAuth", () => {
  it("accepts OPENAI_API_KEY, CODEX_API_KEY or CODEX_ACCESS_TOKEN", () => {
    expect(codexAuth({ OPENAI_API_KEY: "k" }, noLogin)).toEqual({ ok: true, via: "OPENAI_API_KEY" });
    expect(codexAuth({ CODEX_API_KEY: "k" }, noLogin)).toEqual({ ok: true, via: "CODEX_API_KEY" });
    expect(codexAuth({ CODEX_ACCESS_TOKEN: "t" }, noLogin)).toEqual({ ok: true, via: "CODEX_ACCESS_TOKEN" });
  });

  it("accepts a stored codex login", () => {
    expect(codexAuth({}, hasLogin)).toEqual({ ok: true, via: "codex login" });
  });

  it("never counts Anthropic credentials", () => {
    expect(codexAuth({ ANTHROPIC_API_KEY: "k" }, noLogin)).toEqual({ ok: false, reason: CODEX_AUTH_HINT });
  });

  it("fails with a fix that names the agent, OPENAI_API_KEY and codex login", () => {
    const r = codexAuth({}, noLogin);
    const reason = !r.ok ? r.reason : "";
    expect(reason).toMatch(/^Missing: OPENAI_API_KEY/);
    expect(reason).toMatch(/codex login/);
    expect(reason).toMatch(/for --agent codex$/);
  });
});
