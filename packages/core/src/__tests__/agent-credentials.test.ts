/**
 * Security review 2026-09-30, findings 1 to 3: skill credentials stay in the
 * sweny process, pi gets one provider's key, and a staged write node's push
 * block is not mistaken for a guarantee.
 *
 * Pure helpers, the policy gate and the executor wiring, tested directly. The
 * per-harness proof that the env the agent actually receives holds no canary
 * is contract case 21 (harness/__contract__/suite.ts). No LLM calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AGENT_CREDENTIAL_VARS,
  PI_AUTH_VARS,
  finishAgentEnv,
  grantedAgentEnv,
  heldCredentials,
  isAgentCredential,
  piProviderVars,
  resetWithheldReport,
  resolvePiProvider,
  withholdCredentials,
  withPushBlocked,
} from "../agent-env.js";
import { policyGate } from "../harness/policy.js";
import { ACP_CAPABILITIES, CLAUDE_CODE_CAPABILITIES, CODEX_CAPABILITIES } from "../harness/capabilities.js";
import type { NodePolicy } from "../harness/types.js";
import { execute } from "../executor.js";
import { builtinSkills, createSkillMap } from "../skills/index.js";
import { github } from "../skills/github.js";
import type { Claude, Workflow } from "../types.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe("skill credentials", () => {
  it("every built-in skill config variable is a withheld credential", () => {
    for (const skill of builtinSkills) {
      for (const field of Object.values(skill.config)) {
        if (field.env) expect(isAgentCredential(field.env), `${skill.id}: ${field.env}`).toBe(true);
      }
    }
    for (const n of ["GITHUB_TOKEN", "GH_TOKEN", "GITLAB_TOKEN", "LINEAR_API_KEY", "SLACK_ANYTHING"]) {
      expect(isAgentCredential(n), n).toBe(true);
    }
    // The agents' own model credentials are never on the list.
    for (const n of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY"]) {
      expect(isAgentCredential(n), n).toBe(false);
    }
    expect(AGENT_CREDENTIAL_VARS.filter((v) => PI_AUTH_VARS.includes(v))).toEqual([]);
  });

  it("withholdCredentials drops credentials and run-declared names, keeps grants and harness auth", () => {
    const env = {
      PATH: "/bin",
      GITHUB_TOKEN: "gh",
      LINEAR_API_KEY: "lin",
      CUSTOM_SKILL_SECRET: "c",
      ANTHROPIC_API_KEY: "a",
      DATABASE_URL: "db",
    };
    const out = withholdCredentials(env, { withhold: ["CUSTOM_SKILL_SECRET"] });
    expect(out.env).toEqual({ PATH: "/bin", ANTHROPIC_API_KEY: "a", DATABASE_URL: "db" });
    expect(out.withheld).toEqual(["CUSTOM_SKILL_SECRET", "GITHUB_TOKEN", "LINEAR_API_KEY"]);
    expect(out.held).toEqual([]);

    const granted = withholdCredentials(env, { grant: ["GITHUB_TOKEN"], keep: ["LINEAR_API_KEY"] });
    expect(granted.env.GITHUB_TOKEN).toBe("gh");
    expect(granted.env.LINEAR_API_KEY).toBe("lin");
    expect(granted.held).toEqual(["GITHUB_TOKEN", "LINEAR_API_KEY"]);
    expect(heldCredentials(granted.env)).toEqual(["GITHUB_TOKEN", "LINEAR_API_KEY"]);
  });

  describe("finishAgentEnv", () => {
    beforeEach(() => resetWithheldReport());

    it("passthrough cannot carry a credential, and says agent_env once", () => {
      const log = { warn: vi.fn(), debug: vi.fn() };
      const env = { PATH: "/bin", GITHUB_TOKEN: "canary-secret-value" };
      const a = finishAgentEnv(env, { passthrough: ["GITHUB_TOKEN"], logger: log });
      const b = finishAgentEnv(env, { passthrough: ["GITHUB_TOKEN"], logger: log });
      expect(a.env.GITHUB_TOKEN).toBeUndefined();
      expect(b.env.GITHUB_TOKEN).toBeUndefined();
      expect(log.warn).toHaveBeenCalledOnce();
      expect(String(log.warn.mock.calls[0][0])).toMatch(/agent_env/);
      // Names only, never values.
      for (const c of [...log.warn.mock.calls, ...log.debug.mock.calls]) {
        expect(String(c[0])).not.toContain("canary-secret-value");
      }
    });
  });

  it("grantedAgentEnv refuses a read-only node and a staged run", () => {
    expect(grantedAgentEnv(undefined, { readOnly: false, staged: false })).toEqual({ grant: [] });
    expect(grantedAgentEnv(["GITHUB_TOKEN"], { readOnly: false, staged: false })).toEqual({ grant: ["GITHUB_TOKEN"] });
    expect(grantedAgentEnv(["GITHUB_TOKEN"], { readOnly: true, staged: false })).toMatchObject({
      grant: [],
      dropped: expect.stringMatching(/read-only/),
    });
    expect(grantedAgentEnv(["GITHUB_TOKEN"], { readOnly: false, staged: true })).toMatchObject({
      grant: [],
      dropped: expect.stringMatching(/staged/),
    });
  });

  it("withPushBlocked drops every skill credential, even a granted one", () => {
    const out = withPushBlocked(
      { PATH: "/bin", GITHUB_TOKEN: "gh", LINEAR_API_KEY: "lin", SLACK_BOT_TOKEN: "s" },
      true,
    );
    expect(out.GITHUB_TOKEN).toBeUndefined();
    expect(out.LINEAR_API_KEY).toBeUndefined();
    expect(out.SLACK_BOT_TOKEN).toBeUndefined();
  });
});

describe("resolvePiProvider", () => {
  it("the model's provider prefix selects its key only", () => {
    const r = resolvePiProvider({ OPENAI_API_KEY: "o", ANTHROPIC_API_KEY: "a" }, "openai/gpt-5");
    expect(r).toMatchObject({ provider: "openai", explicit: false, vars: ["OPENAI_API_KEY"] });
    expect(r.error).toBeUndefined();
    expect(resolvePiProvider({}, "groq/llama").vars).toEqual(["GROQ_API_KEY"]);
  });

  it("an explicit provider wins and must agree with the model", () => {
    expect(resolvePiProvider({}, "claude-sonnet-4-5", "anthropic")).toMatchObject({
      provider: "anthropic",
      explicit: true,
      vars: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"],
    });
    expect(resolvePiProvider({ SWENY_PI_PROVIDER: "amazon-bedrock" }, "us.anthropic.claude").vars).toContain(
      "AWS_SECRET_ACCESS_KEY",
    );
    expect(resolvePiProvider({}, "openai/gpt-5", "anthropic").error).toMatch(/does not match/);
  });

  it("no named provider: the one provider whose secret is set, else an error asking for pi_provider", () => {
    expect(resolvePiProvider({ ANTHROPIC_API_KEY: "a", AWS_REGION: "us-east-1" }, "sonnet").vars).toEqual([
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_OAUTH_TOKEN",
      "ANTHROPIC_AUTH_TOKEN",
    ]);
    expect(resolvePiProvider({ OPENAI_API_KEY: "" }, undefined)).toEqual({ explicit: false, vars: [] });
    const amb = resolvePiProvider({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" }, "sonnet");
    expect(amb.vars).toEqual([]);
    expect(amb.error).toMatch(/SWENY_PI_PROVIDER/);
  });

  it("maps documented and conventional provider ids", () => {
    expect(piProviderVars("google")).toEqual(["GEMINI_API_KEY"]);
    expect(piProviderVars("github-copilot")).toEqual(["COPILOT_GITHUB_TOKEN"]);
    expect(piProviderVars("mistral")).toEqual(["MISTRAL_API_KEY"]);
    expect(piProviderVars("my-local-ollama")).toEqual([]);
  });
});

describe("policyGate: credentials and staged writes", () => {
  const readOnly: NodePolicy = { readOnly: true, deny: [], egress: [], strict: true, sandbox: "auto" };
  const mount = { sandbox: true, egress: true, readOnlyMount: true };

  it("a read-only mount alone holds read-only only while the agent holds no write credential", () => {
    expect(policyGate(ACP_CAPABILITIES, readOnly, mount).refuse).toBeUndefined();
    const held = policyGate(ACP_CAPABILITIES, { ...readOnly, agentCredentials: ["GITHUB_TOKEN"] }, mount);
    expect(held.refuse).toMatch(/GITHUB_TOKEN/);
    const warn = policyGate(
      ACP_CAPABILITIES,
      { ...readOnly, strict: false, agentCredentials: ["GITHUB_TOKEN"] },
      mount,
    );
    expect(warn.refuse).toBeUndefined();
    expect(warn.degraded.some((d) => /read-only filesystem mount does not stop API writes/.test(d))).toBe(true);
    // A native read-only mode (no shell, or an OS sandbox without network) is not weakened by it.
    expect(
      policyGate(CODEX_CAPABILITIES, { ...readOnly, agentCredentials: ["GITHUB_TOKEN"] }, mount).refuse,
    ).toBeUndefined();
  });

  it("a staged write node needs fs and network containment, else strict refuses", () => {
    const staged: NodePolicy = { readOnly: false, deny: [], egress: [], strict: true, stagedWrite: true };
    expect(policyGate(ACP_CAPABILITIES, { ...staged, sandbox: "off" }).refuse).toMatch(/no push/);
    expect(policyGate(ACP_CAPABILITIES, { ...staged, sandbox: "auto" }, mount).refuse).toBeUndefined();
    expect(policyGate(CODEX_CAPABILITIES, { ...staged, sandbox: "auto" }).refuse).toMatch(/no push/);
    expect(policyGate(CLAUDE_CODE_CAPABILITIES, { ...staged, sandbox: "auto" }).refuse).toBeUndefined();
    const warn = policyGate(ACP_CAPABILITIES, { ...staged, strict: false, sandbox: "off" });
    expect(warn.refuse).toBeUndefined();
    expect(warn.degraded.some((d) => d.startsWith("no push"))).toBe(true);
  });
});

describe("executor: agent_env", () => {
  function recordingClaude() {
    const runs: Parameters<Claude["run"]>[0][] = [];
    const claude: Claude = {
      async run(opts) {
        runs.push(opts);
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate(opts) {
        return opts.choices[0].id;
      },
      async ask() {
        return "";
      },
    };
    return { claude, runs };
  }

  const wf = (node: Partial<Workflow["nodes"][string]> = {}, extra: Partial<Workflow> = {}): Workflow => ({
    id: "t",
    name: "T",
    description: "",
    entry: "a",
    edges: [],
    ...extra,
    nodes: { a: { name: "A", instruction: "Do it.", skills: ["github"], ...node } },
  });
  const deps = (claude: Claude) => ({
    skills: createSkillMap([github]),
    claude,
    config: { GITHUB_TOKEN: "x" },
    logger: silent,
  });

  it("a default write node grants nothing and withholds the skill's credential", async () => {
    const { claude, runs } = recordingClaude();
    await execute(wf(), {}, deps(claude));
    expect(runs[0].agentAccess?.envVars).toEqual([]);
    expect(runs[0].agentAccess?.withhold).toContain("GITHUB_TOKEN");
  });

  it("agent_env grants exactly the named secret on a write node", async () => {
    const { claude, runs } = recordingClaude();
    await execute(wf({ agent_env: ["GITHUB_TOKEN"] }), {}, deps(claude));
    expect(runs[0].agentAccess?.envVars).toEqual(["GITHUB_TOKEN"]);
  });

  it("agent_env is withheld in a staged run and a dry run", async () => {
    const staged = recordingClaude();
    await execute(wf({ agent_env: ["GITHUB_TOKEN"] }), {}, { ...deps(staged.claude), stageOutputs: true });
    expect(staged.runs[0].agentAccess?.envVars).toEqual([]);

    const dry = recordingClaude();
    await execute(wf({ agent_env: ["GITHUB_TOKEN"] }), { dryRun: true }, deps(dry.claude));
    expect(dry.runs[0].agentAccess?.envVars).toEqual([]);
  });

  it("agent_env on a permissions: read node fails at load, before any model call", async () => {
    const { claude, runs } = recordingClaude();
    await expect(execute(wf({ agent_env: ["GITHUB_TOKEN"], permissions: "read" }), {}, deps(claude))).rejects.toThrow(
      /AGENT_ENV_READ_ONLY/,
    );
    const inherited = recordingClaude();
    await expect(
      execute(wf({ agent_env: ["GITHUB_TOKEN"] }, { permissions: "read" }), {}, deps(inherited.claude)),
    ).rejects.toThrow(/AGENT_ENV_READ_ONLY/);
    expect(runs).toHaveLength(0);
    expect(inherited.runs).toHaveLength(0);
  });
});
