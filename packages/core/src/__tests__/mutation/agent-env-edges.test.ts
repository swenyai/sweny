/**
 * Edge assertions found by mutation testing of agent-env.ts: what the agent
 * process may see (allowlists, credentials, push blocking, sandbox settings).
 * The name lists are pinned exactly: a name added or dropped here changes what
 * a model-driven process can read, so it must be a deliberate edit to this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

import {
  AGENT_AUTH_VARS,
  AGENT_CREDENTIAL_PREFIXES,
  AGENT_CREDENTIAL_VARS,
  AGENT_ENV_ALLOWLIST,
  AGENT_ENV_PREFIXES,
  CODEX_AUTH_VARS,
  CODEX_ENV_PREFIXES,
  DEFAULT_SANDBOX_DOMAINS,
  NO_PUSH_REMOTE,
  PI_AUTH_VARS,
  PI_ENV_PREFIXES,
  PI_PROVIDER_VARS,
  PUSH_TOKEN_VARS,
  RUNNER_BASELINE_VARS,
  SKILL_SANDBOX_DOMAINS,
  WITHHELD_WARNING_CAP,
  buildAgentEnv,
  buildSandboxSettings,
  checkSandboxSupport,
  classifyWithheld,
  finishAgentEnv,
  formatScopeSummary,
  formatWithheldWarning,
  grantedAgentEnv,
  hasCodexLogin,
  heldCredentials,
  isAgentCredential,
  isRunnerBaselineVar,
  noPushDir,
  noPushGitConfig,
  parseList,
  piProviderVars,
  reportWithheldEnv,
  resetWithheldReport,
  resolveAgentAccess,
  resolveAgentSandbox,
  resolveCodexAuthEnv,
  resolveEnvScope,
  resolvePiProvider,
  resolveSandboxMode,
  scopeAgentEnv,
  withPushBlocked,
  withholdCredentials,
} from "../../agent-env.js";
import { runStateRoot } from "../../journal.js";
import type { Skill } from "../../types.js";

const names = (list: readonly string[]) => Object.fromEntries(list.map((n) => [n, `v-${n}`]));
const logger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

describe("scoped env: allowlists", () => {
  const ALLOW = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TERM",
    "TMPDIR",
    "TMP",
    "TEMP",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "LANG",
    "LANGUAGE",
    "TZ",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "CI",
    "GITHUB_ACTIONS",
    "GITHUB_REPOSITORY",
    "GITHUB_REPOSITORY_OWNER",
    "GITHUB_WORKSPACE",
    "GITHUB_SHA",
    "GITHUB_REF",
    "GITHUB_REF_NAME",
    "GITHUB_HEAD_REF",
    "GITHUB_BASE_REF",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_NUMBER",
    "GITHUB_SERVER_URL",
    "GITHUB_API_URL",
    "GITHUB_EVENT_NAME",
    "RUNNER_OS",
    "RUNNER_TEMP",
    "GITLAB_CI",
    "CI_PROJECT_DIR",
    "CI_COMMIT_SHA",
    "BUILDKITE",
    "CIRCLECI",
    "JENKINS_URL",
    "TF_BUILD",
    "MAX_THINKING_TOKENS",
    "MCP_TIMEOUT",
    "MCP_TOOL_TIMEOUT",
    "BASH_DEFAULT_TIMEOUT_MS",
    "BASH_MAX_TIMEOUT_MS",
    "DISABLE_TELEMETRY",
    "DISABLE_AUTOUPDATER",
    "DISABLE_ERROR_REPORTING",
    "DISABLE_NON_ESSENTIAL_MODEL_CALLS",
  ];

  it("passes exactly the allowlisted names, and no credential among them", () => {
    expect([...AGENT_ENV_ALLOWLIST]).toStrictEqual(ALLOW);
    expect(buildAgentEnv(names(ALLOW))).toStrictEqual(names(ALLOW));
    for (const secret of ["GITHUB_TOKEN", "NPM_TOKEN", "AWS_SECRET_ACCESS_KEY", "DATABASE_URL", "OPENAI_API_KEY"]) {
      expect(ALLOW).not.toContain(secret);
    }
  });

  it("matches names exactly: a near miss is withheld", () => {
    const src = { XPATH: "1", PATHX: "2", path: "3", Home: "4", GITHUB_TOKEN: "5" };
    expect(buildAgentEnv(src)).toStrictEqual({});
  });

  it("passes locale, ANTHROPIC_ and CLAUDE_ by prefix, anchored at the start", () => {
    expect([...AGENT_ENV_PREFIXES]).toStrictEqual(["LC_", "ANTHROPIC_", "CLAUDE_"]);
    expect(buildAgentEnv({ LC_ALL: "a", ANTHROPIC_API_KEY: "b", CLAUDE_CODE_OAUTH_TOKEN: "c" })).toStrictEqual({
      LC_ALL: "a",
      ANTHROPIC_API_KEY: "b",
      CLAUDE_CODE_OAUTH_TOKEN: "c",
    });
    expect(buildAgentEnv({ XLC_ALL: "a", MY_ANTHROPIC_KEY: "b", XCLAUDE_X: "c" })).toStrictEqual({});
  });

  it("drops nullish values and never mutates the source", () => {
    const src: Record<string, string | undefined> = { PATH: "/bin", HOME: undefined, LANG: null as never };
    const frozen = { ...src };
    expect(buildAgentEnv(src)).toStrictEqual({ PATH: "/bin" });
    expect(src).toStrictEqual(frozen);
  });

  it("keeps an empty string value", () => {
    expect(buildAgentEnv({ PATH: "" })).toStrictEqual({ PATH: "" });
  });

  it("adds extra, auth and passthrough names, and nothing else", () => {
    const src = { A: "1", B: "2", C: "3", D: "4" };
    expect(buildAgentEnv(src, { extraVars: ["A"], authVars: ["B"], passthrough: ["C"] })).toStrictEqual({
      A: "1",
      B: "2",
      C: "3",
    });
    expect(buildAgentEnv(src)).toStrictEqual({});
  });

  it("a '*' passthrough inherits everything non-null and warns", () => {
    const logger = { warn: vi.fn() };
    const out = buildAgentEnv({ A: "1", SECRET: "2", N: undefined }, { passthrough: ["X", "*"], logger });
    expect(out).toStrictEqual({ A: "1", SECRET: "2" });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "[sweny] env-passthrough contains '*': the agent inherits the full environment, including every secret.",
    );
    expect(buildAgentEnv({ A: "1" }, { passthrough: ["*"] })).toStrictEqual({ A: "1" });
  });

  it("AWS_ reaches the agent only when Bedrock is switched on, by any truthy spelling", () => {
    const aws = { AWS_ACCESS_KEY_ID: "k", AWS_REGION: "r" };
    for (const on of ["1", "true", "yes", " TRUE ", "anything"]) {
      expect(buildAgentEnv({ ...aws, CLAUDE_CODE_USE_BEDROCK: on }), on).toMatchObject(aws);
    }
    for (const off of ["", "  ", "0", "false", "no", "off", " Off ", "FALSE"]) {
      expect(buildAgentEnv({ ...aws, CLAUDE_CODE_USE_BEDROCK: off }), off).not.toHaveProperty("AWS_ACCESS_KEY_ID");
    }
    expect(buildAgentEnv(aws)).toStrictEqual({});
    expect(buildAgentEnv({ XAWS_X: "1", CLAUDE_CODE_USE_BEDROCK: "1" })).not.toHaveProperty("XAWS_X");
  });

  it("the Vertex variables reach the agent only when Vertex is switched on", () => {
    const vertex = {
      GOOGLE_APPLICATION_CREDENTIALS: "/c.json",
      CLOUD_ML_REGION: "us",
      GOOGLE_CLOUD_PROJECT: "p",
      GCLOUD_PROJECT: "p2",
    };
    expect(buildAgentEnv({ ...vertex, CLAUDE_CODE_USE_VERTEX: "1" })).toMatchObject(vertex);
    expect(buildAgentEnv({ ...vertex, CLAUDE_CODE_USE_VERTEX: "0" })).not.toHaveProperty(
      "GOOGLE_APPLICATION_CREDENTIALS",
    );
    expect(buildAgentEnv(vertex)).toStrictEqual({});
    expect(buildAgentEnv({ OTHER: "x", CLAUDE_CODE_USE_VERTEX: "1" })).not.toHaveProperty("OTHER");
  });

  it("custom prefixes replace the defaults and carry no Bedrock or Vertex routing", () => {
    const src = {
      LC_ALL: "a",
      ANTHROPIC_API_KEY: "b",
      CODEX_THING: "c",
      AWS_REGION: "r",
      GCLOUD_PROJECT: "p",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
    };
    expect(buildAgentEnv(src, { prefixes: ["CODEX_"] })).toStrictEqual({ CODEX_THING: "c" });
    expect(buildAgentEnv(src, { prefixes: [] })).toStrictEqual({});
  });

  it("scopeAgentEnv reports the names it withheld, never nullish ones", () => {
    const r = scopeAgentEnv({ PATH: "/bin", SECRET: "s", OTHER: "o", GONE: undefined, NIL: null as never });
    expect(r.env).toStrictEqual({ PATH: "/bin" });
    expect(r.withheld).toStrictEqual(["SECRET", "OTHER"]);
    expect(scopeAgentEnv({ A: "1" }, { extraVars: ["A"] }).withheld).toStrictEqual([]);
  });
});

describe("harness auth lists", () => {
  it("pins the Claude, Codex and pi lists", () => {
    expect([...AGENT_AUTH_VARS]).toStrictEqual([
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
    ]);
    expect([...CODEX_AUTH_VARS]).toStrictEqual(["CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "CODEX_HOME"]);
    expect([...CODEX_ENV_PREFIXES]).toStrictEqual(["LC_"]);
    expect([...PI_ENV_PREFIXES]).toStrictEqual(["LC_"]);
    expect([...PI_AUTH_VARS]).toStrictEqual([
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_OAUTH_TOKEN",
      "ANTHROPIC_AUTH_TOKEN",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "DEEPSEEK_API_KEY",
      "MISTRAL_API_KEY",
      "GROQ_API_KEY",
      "CEREBRAS_API_KEY",
      "XAI_API_KEY",
      "OPENROUTER_API_KEY",
      "AI_GATEWAY_API_KEY",
      "ZAI_API_KEY",
      "ZAI_CODING_CN_API_KEY",
      "OPENCODE_API_KEY",
      "RADIUS_API_KEY",
      "TYPESAFE_API_KEY",
      "HF_TOKEN",
      "FIREWORKS_API_KEY",
      "TOGETHER_API_KEY",
      "BASETEN_API_KEY",
      "KIMI_API_KEY",
      "META_API_KEY",
      "MINIMAX_API_KEY",
      "MINIMAX_CN_API_KEY",
      "MOONSHOT_API_KEY",
      "NVIDIA_API_KEY",
      "ANT_LING_API_KEY",
      "QWEN_TOKEN_PLAN_API_KEY",
      "QWEN_TOKEN_PLAN_CN_API_KEY",
      "XIAOMI_API_KEY",
      "XIAOMI_TOKEN_PLAN_CN_API_KEY",
      "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
      "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
      "COPILOT_GITHUB_TOKEN",
      "AZURE_OPENAI_API_KEY",
      "AZURE_OPENAI_BASE_URL",
      "AZURE_OPENAI_RESOURCE_NAME",
      "CLOUDFLARE_API_KEY",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_GATEWAY_ID",
      "GOOGLE_CLOUD_API_KEY",
      "GOOGLE_CLOUD_PROJECT",
      "GCLOUD_PROJECT",
      "GOOGLE_CLOUD_LOCATION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_BEARER_TOKEN_BEDROCK",
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
    ]);
  });

  it("every pi provider variable is a pi auth variable", () => {
    for (const vars of Object.values(PI_PROVIDER_VARS)) for (const v of vars) expect(PI_AUTH_VARS).toContain(v);
  });

  it("a codex or pi env gets its own credential names and locale, nothing from Claude", () => {
    const src = { ...names([...CODEX_AUTH_VARS, "ANTHROPIC_API_KEY", "CLAUDE_X", "OPENAI_API_KEY"]), LC_ALL: "C" };
    expect(buildAgentEnv(src, { authVars: CODEX_AUTH_VARS, prefixes: CODEX_ENV_PREFIXES })).toStrictEqual({
      ...names(CODEX_AUTH_VARS),
      LC_ALL: "C",
    });
  });

  it("parseList splits on commas and whitespace and drops empties", () => {
    expect(parseList(undefined)).toStrictEqual([]);
    expect(parseList("")).toStrictEqual([]);
    expect(parseList(" , ,, ")).toStrictEqual([]);
    expect(parseList("a, b  c,,d\n e\tf")).toStrictEqual(["a", "b", "c", "d", "e", "f"]);
    expect(parseList("one")).toStrictEqual(["one"]);
  });
});

describe("codex auth", () => {
  it("copies the OpenAI key into CODEX_API_KEY only when that is missing or empty", () => {
    expect(resolveCodexAuthEnv({ OPENAI_API_KEY: "sk" })).toStrictEqual({ OPENAI_API_KEY: "sk", CODEX_API_KEY: "sk" });
    expect(resolveCodexAuthEnv({ OPENAI_API_KEY: "sk", CODEX_API_KEY: "" }).CODEX_API_KEY).toBe("sk");
    expect(resolveCodexAuthEnv({ OPENAI_API_KEY: "sk", CODEX_API_KEY: "own" }).CODEX_API_KEY).toBe("own");
    expect(resolveCodexAuthEnv({ CODEX_API_KEY: "own" })).toStrictEqual({ CODEX_API_KEY: "own" });
    expect(resolveCodexAuthEnv({ PATH: "/bin" })).toStrictEqual({ PATH: "/bin" });
    expect(resolveCodexAuthEnv({ OPENAI_API_KEY: "" })).toStrictEqual({ OPENAI_API_KEY: "" });
  });

  it("returns a copy", () => {
    const env = { OPENAI_API_KEY: "sk" };
    const out = resolveCodexAuthEnv(env);
    expect(out).not.toBe(env);
    expect(env).toStrictEqual({ OPENAI_API_KEY: "sk" });
  });

  it("looks for auth.json under CODEX_HOME, else ~/.codex", () => {
    const exists = vi.fn(() => true);
    expect(hasCodexLogin({ CODEX_HOME: "/h" }, exists)).toBe(true);
    expect(exists).toHaveBeenLastCalledWith(path.join("/h", "auth.json"));
    hasCodexLogin({}, exists);
    expect(exists).toHaveBeenLastCalledWith(path.join(homedir(), ".codex", "auth.json"));
    hasCodexLogin({ CODEX_HOME: "" }, exists);
    expect(exists).toHaveBeenLastCalledWith(path.join(homedir(), ".codex", "auth.json"));
    expect(hasCodexLogin({ CODEX_HOME: "/h" }, () => false)).toBe(false);
  });
});

describe("pi provider resolution", () => {
  it("maps a provider id to its credential names, case and space insensitively, as a copy", () => {
    expect(piProviderVars(" OpenAI ")).toStrictEqual(["OPENAI_API_KEY"]);
    expect(piProviderVars("amazon-bedrock")).toStrictEqual([
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_BEARER_TOKEN_BEDROCK",
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
    ]);
    const vars = piProviderVars("openai");
    vars.push("X");
    expect(PI_PROVIDER_VARS.openai).toStrictEqual(["OPENAI_API_KEY"]);
  });

  it("falls back to <ID>_API_KEY when that is a pi variable, else nothing", () => {
    expect(piProviderVars("meta")).toStrictEqual(["META_API_KEY"]);
    expect(piProviderVars("Moonshot")).toStrictEqual(["MOONSHOT_API_KEY"]);
    expect(piProviderVars("qwen.token.plan")).toStrictEqual(["QWEN_TOKEN_PLAN_API_KEY"]);
    expect(piProviderVars("qwen--token--plan")).toStrictEqual(["QWEN_TOKEN_PLAN_API_KEY"]);
    expect(piProviderVars("my-custom")).toStrictEqual([]);
    expect(piProviderVars("")).toStrictEqual([]);
  });

  it("an explicit provider wins and is trimmed and lowercased", () => {
    expect(resolvePiProvider({}, undefined, " Anthropic ")).toStrictEqual({
      provider: "anthropic",
      explicit: true,
      vars: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"],
    });
    expect(resolvePiProvider({}, undefined, "my-custom")).toStrictEqual({
      provider: "my-custom",
      explicit: true,
      vars: [],
    });
    expect(resolvePiProvider({ SWENY_PI_PROVIDER: " OpenAI " })).toStrictEqual({
      provider: "openai",
      explicit: true,
      vars: ["OPENAI_API_KEY"],
    });
    expect(resolvePiProvider({ SWENY_PI_PROVIDER: "openai" }, undefined, "groq").provider).toBe("groq");
  });

  it("an explicit empty value falls through to the model and the credentials", () => {
    expect(resolvePiProvider({ SWENY_PI_PROVIDER: "openai" }, undefined, "")).toStrictEqual({
      explicit: false,
      vars: [],
    });
  });

  it("refuses an explicit provider that contradicts the model's", () => {
    expect(resolvePiProvider({}, "openai/gpt-5", "mistral")).toStrictEqual({
      explicit: true,
      vars: [],
      error: 'pi_provider "mistral" does not match the model "openai/gpt-5" (provider "openai"); set one of them',
    });
    expect(resolvePiProvider({}, "OpenAI/gpt-5", "openai")).toStrictEqual({
      provider: "openai",
      explicit: true,
      vars: ["OPENAI_API_KEY"],
    });
    expect(resolvePiProvider({}, "unknown/model", "mistral").provider).toBe("mistral");
  });

  it("takes the provider from a known model prefix", () => {
    expect(resolvePiProvider({}, "openai/gpt-5")).toStrictEqual({
      provider: "openai",
      explicit: false,
      vars: ["OPENAI_API_KEY"],
    });
    expect(resolvePiProvider({}, " Mistral /large")).toStrictEqual({
      provider: "mistral",
      explicit: false,
      vars: ["MISTRAL_API_KEY"],
    });
    expect(resolvePiProvider({ OPENAI_API_KEY: "x" }, "unknown/model").provider).toBe("openai");
    expect(resolvePiProvider({}, "gpt-5")).toStrictEqual({ explicit: false, vars: [] });
    expect(resolvePiProvider({}, "/model")).toStrictEqual({ explicit: false, vars: [] });
  });

  it("with no name, picks the one provider whose secret is set", () => {
    expect(resolvePiProvider({ OPENAI_API_KEY: "x" })).toStrictEqual({
      provider: "openai",
      explicit: false,
      vars: ["OPENAI_API_KEY"],
    });
    expect(resolvePiProvider({ MISTRAL_API_KEY: "x" })).toStrictEqual({
      provider: "mistral",
      explicit: false,
      vars: ["MISTRAL_API_KEY"],
    });
    expect(resolvePiProvider({ HF_TOKEN: "x" }).provider).toBe("huggingface");
    expect(resolvePiProvider({ RADIUS_API_KEY: "x" }).provider).toBe("radius");
    expect(resolvePiProvider({ ZAI_API_KEY: "x" }).provider).toBe("zai");
    expect(resolvePiProvider({ XIAOMI_API_KEY: "x" }).provider).toBe("xiaomi");
  });

  it("ignores unset, empty and non-secret settings", () => {
    expect(resolvePiProvider({})).toStrictEqual({ explicit: false, vars: [] });
    expect(resolvePiProvider({ OPENAI_API_KEY: "" })).toStrictEqual({ explicit: false, vars: [] });
    expect(
      resolvePiProvider({ AWS_REGION: "us", GOOGLE_CLOUD_PROJECT: "p", AZURE_OPENAI_BASE_URL: "u" }),
    ).toStrictEqual({
      explicit: false,
      vars: [],
    });
    expect(resolvePiProvider({ OPENAI_API_KEY: "x", AWS_REGION: "us" }).provider).toBe("openai");
  });

  it("a provider whose settings span several variables is still one provider", () => {
    expect(resolvePiProvider({ AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b", AWS_REGION: "r" })).toStrictEqual({
      provider: "amazon-bedrock",
      explicit: false,
      vars: PI_PROVIDER_VARS["amazon-bedrock"],
    });
    expect(resolvePiProvider({ ANTHROPIC_API_KEY: "a", ANTHROPIC_OAUTH_TOKEN: "b" }).provider).toBe("anthropic");
  });

  it("several providers sharing one key leave the provider open but pass the vars", () => {
    expect(resolvePiProvider({ QWEN_TOKEN_PLAN_API_KEY: "x" })).toStrictEqual({
      provider: undefined,
      explicit: false,
      vars: ["QWEN_TOKEN_PLAN_API_KEY"],
    });
    expect(resolvePiProvider({ CLOUDFLARE_API_KEY: "x" })).toStrictEqual({
      provider: undefined,
      explicit: false,
      vars: ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID"],
    });
  });

  it("refuses when credentials for different providers are set and none is named", () => {
    expect(resolvePiProvider({ OPENAI_API_KEY: "a", MISTRAL_API_KEY: "b" })).toStrictEqual({
      explicit: false,
      vars: [],
      error:
        "pi: credentials for several providers are set (OPENAI_API_KEY, MISTRAL_API_KEY) and the model does not name one. " +
        "Set SWENY_PI_PROVIDER (pi_provider) or a provider/model, so only that provider's credential reaches pi.",
    });
  });
});

describe("env scope", () => {
  it("an explicit value always wins", () => {
    expect(resolveEnvScope({ SWENY_ENV_SCOPE: "off", CI: "1" }, true)).toBe(true);
    expect(resolveEnvScope({ SWENY_ENV_SCOPE: "on" }, false)).toBe(false);
  });

  it("reads on|true|1 and off|false|0, trimmed and case-insensitive", () => {
    for (const v of ["on", "true", "1", " ON ", "True"]) expect(resolveEnvScope({ SWENY_ENV_SCOPE: v }), v).toBe(true);
    for (const v of ["off", "false", "0", " OFF ", "False"])
      expect(resolveEnvScope({ SWENY_ENV_SCOPE: v, CI: "1" }), v).toBe(false);
  });

  it("defaults to on in CI and off elsewhere, warning on an unknown value", () => {
    const warn = vi.fn();
    expect(resolveEnvScope({ CI: "true" })).toBe(true);
    expect(resolveEnvScope({ CI: "false" })).toBe(false);
    expect(resolveEnvScope({})).toBe(false);
    expect(resolveEnvScope({ SWENY_ENV_SCOPE: "", CI: "1" }, undefined, { warn })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    expect(resolveEnvScope({ SWENY_ENV_SCOPE: "Maybe", CI: "1" }, undefined, { warn })).toBe(true);
    expect(warn).toHaveBeenLastCalledWith('SWENY_ENV_SCOPE="maybe" is not one of on|off; using on');
    expect(resolveEnvScope({ SWENY_ENV_SCOPE: "maybe" }, undefined, { warn })).toBe(false);
    expect(warn).toHaveBeenLastCalledWith('SWENY_ENV_SCOPE="maybe" is not one of on|off; using off');
    expect(resolveEnvScope({ SWENY_ENV_SCOPE: "maybe" })).toBe(false);
  });
});

describe("runner baseline", () => {
  const BASELINE = [
    "ImageOS",
    "ImageVersion",
    "ACCEPT_EULA",
    "DEBIAN_FRONTEND",
    "AGENT_TOOLSDIRECTORY",
    "CONDA",
    "SWIFT_PATH",
    "LEIN_HOME",
    "LEIN_JAR",
    "ANT_HOME",
    "GRADLE_HOME",
    "M2_HOME",
    "SELENIUM_JAR_PATH",
    "ENABLE_RUNNER_TRACING",
    "INVOCATION_ID",
    "JOURNAL_STREAM",
    "SYSTEMD_EXEC_PID",
    "MANAGERPID",
    "OLDPWD",
    "PWD",
    "SHLVL",
    "_",
    "GITHUB_ACTION",
    "GITHUB_ACTION_PATH",
    "GITHUB_ACTION_REF",
    "GITHUB_ACTION_REPOSITORY",
    "GITHUB_ACTOR",
    "GITHUB_ACTOR_ID",
    "GITHUB_ENV",
    "GITHUB_EVENT_PATH",
    "GITHUB_GRAPHQL_URL",
    "GITHUB_JOB",
    "GITHUB_OUTPUT",
    "GITHUB_PATH",
    "GITHUB_REF_PROTECTED",
    "GITHUB_REF_TYPE",
    "GITHUB_REPOSITORY_ID",
    "GITHUB_REPOSITORY_OWNER_ID",
    "GITHUB_RETENTION_DAYS",
    "GITHUB_RUN_ATTEMPT",
    "GITHUB_STATE",
    "GITHUB_STEP_SUMMARY",
    "GITHUB_TRIGGERING_ACTOR",
    "GITHUB_WORKFLOW",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_WORKFLOW_SHA",
  ];

  it("recognizes exactly the pinned image variables", () => {
    expect([...RUNNER_BASELINE_VARS].sort()).toStrictEqual([...BASELINE].sort());
    for (const n of BASELINE) expect(isRunnerBaselineVar(n), n).toBe(true);
  });

  it("recognizes each pattern family, anchored, and never a secret-shaped name", () => {
    const yes = [
      "ACTIONS_RUNTIME_TOKEN",
      "RUNNER_OS",
      "ANDROID_HOME",
      "JAVA_HOME",
      "JAVA_HOME_17_X64",
      "CHROME_BIN",
      "CHROMEWEBDRIVER",
      "GECKOWEBDRIVER",
      "DOTNET_ROOT",
      "GOROOT",
      "GOROOT_1_21_X64",
      "PIPX_HOME",
      "POWERSHELL_DISTRIBUTION_CHANNEL",
      "VCPKG_INSTALLATION_ROOT",
      "GHCUP_INSTALL_BASE_PREFIX",
      "BOOTSTRAP_HASKELL_NONINTERACTIVE",
      "AZURE_EXTENSION_DIR",
      "AZURE_HTTP_USER_AGENT",
      "AZURE_CONFIG_DIR",
      "HOMEBREW_NO_AUTO_UPDATE",
      "STATS_VMD",
    ];
    for (const n of yes) expect(isRunnerBaselineVar(n), n).toBe(true);
    const no = [
      "XACTIONS_X",
      "MY_RUNNER_X",
      "MYANDROID_HOME",
      "JAVA_HOMEX",
      "XJAVA_HOME",
      "XCHROME",
      "WEBDRIVERX",
      "XDOTNET_ROOT",
      "GOROOTX",
      "XGOROOT",
      "XPIPX_HOME",
      "XPOWERSHELL_X",
      "XVCPKG_X",
      "XGHCUP_X",
      "XBOOTSTRAP_HASKELL_X",
      "AZURE_CONFIG_DIRX",
      "XAZURE_CONFIG_DIR",
      "AZURE_OTHER",
      "XHOMEBREW_X",
      "XSTATS_X",
      "GITHUB_TOKEN",
      "NPM_TOKEN",
      "AWS_ACCESS_KEY_ID",
      "DATABASE_URL",
      "imageos",
    ];
    for (const n of no) expect(isRunnerBaselineVar(n), n).toBe(false);
  });

  it("classifyWithheld splits and sorts each side", () => {
    expect(classifyWithheld(["Z_VAR", "PWD", "A_VAR", "ImageOS", "RUNNER_X"])).toStrictEqual({
      baseline: ["ImageOS", "PWD", "RUNNER_X"],
      other: ["A_VAR", "Z_VAR"],
    });
    expect(classifyWithheld([])).toStrictEqual({ baseline: [], other: [] });
  });
});

describe("withheld reporting", () => {
  beforeEach(() => resetWithheldReport());

  it("formats the warning with sorted names and the exact guidance", () => {
    expect(formatWithheldWarning(["B", "A"])).toBe(
      "Agent env scoping withheld 2 environment variable(s) from the agent: A, B. " +
        "If a node's commands need any of them, add the names to env-passthrough " +
        "(SWENY_ENV_PASSTHROUGH), or set env-scope: off (SWENY_ENV_SCOPE=off).",
    );
  });

  it("caps the list at 30 names and counts the rest", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `V${String(i).padStart(2, "0")}`);
    expect(WITHHELD_WARNING_CAP).toBe(30);
    const at = formatWithheldWarning(many(30));
    expect(at).toContain("withheld 30 environment variable(s) from the agent: V00, V01");
    expect(at).toContain("V29. If a node's");
    expect(at).not.toContain("more");
    const over = formatWithheldWarning(many(33).reverse());
    expect(over).toContain("withheld 33 environment variable(s)");
    expect(over).toContain("V29, and 3 more. If a node's");
    expect(over).not.toContain("V30");
  });

  it("formats the plain summary", () => {
    expect(formatScopeSummary(7, 3)).toBe(
      "sweny: agent env scoped (7 withheld, 3 from the CI image). Add names to env-passthrough if a node needs them; --verbose lists them.",
    );
  });

  it("reports once per process: a summary, a warning for operator-fixable names, a debug list of all", () => {
    const l = logger();
    reportWithheldEnv(["Zed", "ImageOS", "SLACK_BOT_TOKEN", "Alpha"], l, {});
    expect(l.info).toHaveBeenCalledWith(formatScopeSummary(4, 1));
    expect(l.warn).toHaveBeenCalledTimes(1);
    expect(l.warn).toHaveBeenCalledWith(formatWithheldWarning(["Alpha", "Zed"]));
    expect(l.debug).toHaveBeenCalledWith("sweny: agent env withheld: Alpha, ImageOS, SLACK_BOT_TOKEN, Zed");
    const again = logger();
    reportWithheldEnv(["Other"], again, {});
    expect(again.info).not.toHaveBeenCalled();
    resetWithheldReport();
    reportWithheldEnv(["Other"], again, {});
    expect(again.info).toHaveBeenCalledTimes(1);
  });

  it("annotates the warning under GitHub Actions only", () => {
    const gh = logger();
    reportWithheldEnv(["Foo"], gh, { GITHUB_ACTIONS: "true" });
    expect(gh.warn).toHaveBeenCalledWith(`::warning title=SWEny agent env::${formatWithheldWarning(["Foo"])}`);
    resetWithheldReport();
    const other = logger();
    reportWithheldEnv(["Foo"], other, { GITHUB_ACTIONS: "false" });
    expect(other.warn).toHaveBeenCalledWith(formatWithheldWarning(["Foo"]));
  });

  it("stays quiet about the baseline and about skill credentials, and about nothing", () => {
    const l = logger();
    reportWithheldEnv([], l, {});
    expect(l.info).not.toHaveBeenCalled();
    reportWithheldEnv(["ImageOS", "GITHUB_TOKEN", "SLACK_X"], l, {});
    expect(l.info).toHaveBeenCalledTimes(1);
    expect(l.warn).not.toHaveBeenCalled();
    expect(l.debug).toHaveBeenCalledTimes(1);
  });
});

describe("no push (#442)", () => {
  const PUSH = [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
    "GITHUB_PAT",
    "GITLAB_TOKEN",
    "GL_TOKEN",
    "CI_JOB_TOKEN",
    "BITBUCKET_TOKEN",
    "SSH_AUTH_SOCK",
    "SSH_ASKPASS",
    "GIT_ASKPASS",
  ];

  it("pins the withheld push credentials and the blocking remote", () => {
    expect([...PUSH_TOKEN_VARS]).toStrictEqual(PUSH);
    expect(NO_PUSH_REMOTE).toBe("sweny-no-push");
  });

  it("builds the git config entries that make every push fail", () => {
    const url = `url.${NO_PUSH_REMOTE}://blocked/.pushInsteadOf`;
    expect(noPushGitConfig("/d")).toStrictEqual([
      ["credential.helper", ""],
      ["remote.pushDefault", "sweny-no-push"],
      ["push.default", "nothing"],
      ["core.hooksPath", path.join("/d", "hooks")],
      [url, "https://"],
      [url, "http://"],
      [url, "ssh://"],
      [url, "git://"],
      [url, "git@"],
      [url, "file://"],
      [url, "/"],
    ]);
  });

  it("creates a hook, askpass and ssh wrapper that are executable, and reuses the directory", () => {
    const dir = noPushDir();
    expect(noPushDir()).toBe(dir);
    for (const f of ["hooks/pre-push", "askpass", "ssh"]) {
      expect(statSync(path.join(dir, f)).mode & 0o111, f).toBeGreaterThan(0);
    }
    expect(statSync(path.join(dir, "gh")).isDirectory()).toBe(true);
    const msg = "sweny: git push is blocked under --stage and --dry-run (#442)";
    for (const f of ["hooks/pre-push", "askpass"]) {
      expect(readFileSync(path.join(dir, f), "utf-8")).toBe(`#!/bin/sh\necho "${msg}" >&2\nexit 1\n`);
      const r = spawnSync(path.join(dir, f), [], { encoding: "utf-8" });
      expect([r.status, r.stderr.trim()], f).toStrictEqual([1, msg]);
    }
  });

  it("the ssh wrapper refuses a push and hands a fetch to the operator's own ssh", () => {
    const ssh = path.join(noPushDir(), "ssh");
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", SWENY_NO_PUSH_SSH: "echo ran" };
    const push = spawnSync(ssh, ["host", "git-receive-pack 'repo.git'"], { env, encoding: "utf-8" });
    expect(push.status).toBe(1);
    expect(push.stderr).toContain("git push is blocked under --stage and --dry-run (#442)");
    const fetch = spawnSync(ssh, ["host", "git-upload-pack 'repo.git'"], { env, encoding: "utf-8" });
    expect(fetch.status).toBe(0);
    expect(fetch.stdout.trim()).toBe("ran host git-upload-pack 'repo.git'");
  });

  it("returns the very same env when disabled", () => {
    const env = { GITHUB_TOKEN: "t" };
    expect(withPushBlocked(env, false)).toBe(env);
    expect(withPushBlocked(env, undefined)).toBe(env);
  });

  it("drops push tokens and skill credentials, even granted ones, and keeps the rest", () => {
    const out = withPushBlocked(
      { ...names(PUSH), LINEAR_API_KEY: "l", SLACK_BOT_TOKEN: "s", PATH: "/bin", FOO: "1" },
      true,
    );
    for (const n of PUSH.filter((n) => n !== "GIT_ASKPASS")) expect(out, n).not.toHaveProperty(n);
    expect(out).not.toHaveProperty("LINEAR_API_KEY");
    expect(out).not.toHaveProperty("SLACK_BOT_TOKEN");
    expect(out).toMatchObject({ PATH: "/bin", FOO: "1" });
  });

  it("sets the blocking env and routes git's ssh through the wrapper", () => {
    const dir = noPushDir();
    const out = withPushBlocked({ PATH: "/bin" }, true);
    expect(out).toMatchObject({
      GIT_SSH_COMMAND: `'${path.join(dir, "ssh")}'`,
      GIT_SSH_VARIANT: "ssh",
      GIT_ASKPASS: path.join(dir, "askpass"),
      GIT_TERMINAL_PROMPT: "0",
      GH_CONFIG_DIR: path.join(dir, "gh"),
      GH_PROMPT_DISABLED: "1",
      GIT_CONFIG_COUNT: "11",
    });
    expect(out).not.toHaveProperty("SWENY_NO_PUSH_SSH");
    const entries = noPushGitConfig(dir);
    entries.forEach(([k, v], i) => {
      expect(out[`GIT_CONFIG_KEY_${i}`]).toBe(k);
      expect(out[`GIT_CONFIG_VALUE_${i}`]).toBe(v);
    });
  });

  it("appends after existing GIT_CONFIG entries and restarts from zero on a bad count", () => {
    const out = withPushBlocked({ GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "a", GIT_CONFIG_VALUE_0: "b" }, true);
    expect(out.GIT_CONFIG_KEY_0).toBe("a");
    expect(out.GIT_CONFIG_KEY_2).toBe("credential.helper");
    expect(out.GIT_CONFIG_VALUE_2).toBe("");
    expect(out.GIT_CONFIG_COUNT).toBe("13");
    for (const bad of ["abc", "-1", "0", "", "NaN"]) {
      const o = withPushBlocked({ GIT_CONFIG_COUNT: bad }, true);
      expect(o.GIT_CONFIG_KEY_0, bad).toBe("credential.helper");
      expect(o.GIT_CONFIG_COUNT, bad).toBe("11");
    }
    expect(withPushBlocked({ GIT_CONFIG_COUNT: "1" }, true).GIT_CONFIG_COUNT).toBe("12");
  });

  it("remembers the operator's own ssh command, or quotes GIT_SSH", () => {
    expect(withPushBlocked({ GIT_SSH_COMMAND: "ssh -i key" }, true).SWENY_NO_PUSH_SSH).toBe("ssh -i key");
    expect(withPushBlocked({ GIT_SSH: "/usr/bin/my ssh" }, true).SWENY_NO_PUSH_SSH).toBe("'/usr/bin/my ssh'");
    expect(withPushBlocked({ GIT_SSH: "/o'dd/ssh" }, true).SWENY_NO_PUSH_SSH).toBe("'/o'\\''dd/ssh'");
    expect(withPushBlocked({ GIT_SSH_COMMAND: "own", GIT_SSH: "/x" }, true).SWENY_NO_PUSH_SSH).toBe("own");
    expect(withPushBlocked({ GIT_SSH_COMMAND: "ssh -i key" }, true).GIT_SSH_COMMAND).toBe(
      `'${path.join(noPushDir(), "ssh")}'`,
    );
  });
});

describe("skill credentials", () => {
  const CREDS = [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
    "GITHUB_PAT",
    "GITLAB_TOKEN",
    "GL_TOKEN",
    "CI_JOB_TOKEN",
    "BITBUCKET_TOKEN",
    "LINEAR_API_KEY",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_BASE_URL",
    "DD_API_KEY",
    "DD_APP_KEY",
    "DD_SITE",
    "BETTERSTACK_API_TOKEN",
    "BETTERSTACK_QUERY_ENDPOINT",
    "BETTERSTACK_QUERY_USERNAME",
    "BETTERSTACK_QUERY_PASSWORD",
    "NOTIFICATION_WEBHOOK_URL",
    "NOTIFICATION_WEBHOOK_ALLOWED_HOSTS",
    "DISCORD_WEBHOOK_URL",
    "TEAMS_WEBHOOK_URL",
    "SMTP_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_ALLOWED_TABLES",
    "SUPABASE_ALLOWED_FUNCTIONS",
  ];

  it("pins the list and the Slack prefix", () => {
    expect([...AGENT_CREDENTIAL_VARS]).toStrictEqual(CREDS);
    expect([...AGENT_CREDENTIAL_PREFIXES]).toStrictEqual(["SLACK_"]);
  });

  it("isAgentCredential: listed names, the prefix at its start, and the run's own extras", () => {
    for (const n of CREDS) expect(isAgentCredential(n), n).toBe(true);
    expect(isAgentCredential("SLACK_BOT_TOKEN")).toBe(true);
    expect(isAgentCredential("SLACK_")).toBe(true);
    expect(isAgentCredential("MY_SLACK_TOKEN")).toBe(false);
    expect(isAgentCredential("PATH")).toBe(false);
    expect(isAgentCredential("CUSTOM_KEY")).toBe(false);
    expect(isAgentCredential("CUSTOM_KEY", ["CUSTOM_KEY"])).toBe(true);
    expect(isAgentCredential("OTHER", ["CUSTOM_KEY"])).toBe(false);
  });

  it("withholdCredentials keeps ordinary vars, grants and the harness's own keys, and sorts what it reports", () => {
    const env = {
      PATH: "/bin",
      LINEAR_API_KEY: "l",
      GITHUB_TOKEN: "g",
      SLACK_TOKEN: "s",
      MY_KEY: "m",
      DD_API_KEY: "d",
    };
    expect(withholdCredentials(env)).toStrictEqual({
      env: { PATH: "/bin", MY_KEY: "m" },
      withheld: ["DD_API_KEY", "GITHUB_TOKEN", "LINEAR_API_KEY", "SLACK_TOKEN"],
      held: [],
    });
    expect(withholdCredentials(env, { withhold: ["MY_KEY"] }).withheld).toContain("MY_KEY");
    const r = withholdCredentials(env, { grant: ["LINEAR_API_KEY"], keep: ["GITHUB_TOKEN"], withhold: ["MY_KEY"] });
    expect(r.env).toStrictEqual({ PATH: "/bin", LINEAR_API_KEY: "l", GITHUB_TOKEN: "g" });
    expect(r.withheld).toStrictEqual(["DD_API_KEY", "MY_KEY", "SLACK_TOKEN"]);
    expect(r.held).toStrictEqual(["GITHUB_TOKEN", "LINEAR_API_KEY"]);
  });

  it("heldCredentials lists the credential names present, sorted", () => {
    expect(heldCredentials({ PATH: "1", LINEAR_API_KEY: "1", GITHUB_TOKEN: "1", X: "1" })).toStrictEqual([
      "GITHUB_TOKEN",
      "LINEAR_API_KEY",
    ]);
    expect(heldCredentials({ X: "1" }, ["X"])).toStrictEqual(["X"]);
    expect(heldCredentials({ X: "1" })).toStrictEqual([]);
  });

  describe("finishAgentEnv", () => {
    beforeEach(() => resetWithheldReport());

    it("withholds credentials, logs the names at debug, and returns what is held", () => {
      const l = logger();
      const out = finishAgentEnv(
        { PATH: "/bin", GITHUB_TOKEN: "g", LINEAR_API_KEY: "l", ANTHROPIC_API_KEY: "a" },
        { access: { envVars: ["LINEAR_API_KEY"], withhold: [] }, keep: ["ANTHROPIC_API_KEY"], logger: l },
      );
      expect(out).toStrictEqual({
        env: { PATH: "/bin", LINEAR_API_KEY: "l", ANTHROPIC_API_KEY: "a" },
        held: ["LINEAR_API_KEY"],
      });
      expect(l.debug).toHaveBeenCalledWith("sweny: skill credentials withheld from the agent: GITHUB_TOKEN");
      expect(l.warn).not.toHaveBeenCalled();
    });

    it("says nothing at debug when nothing was withheld", () => {
      const l = logger();
      finishAgentEnv({ PATH: "/bin" }, { logger: l });
      expect(l.debug).not.toHaveBeenCalled();
    });

    it("warns once per process when passthrough names a credential, sorted, excluding grants and keeps", () => {
      const l = logger();
      finishAgentEnv(
        { PATH: "/bin" },
        {
          passthrough: ["LINEAR_API_KEY", "GITHUB_TOKEN", "DD_API_KEY", "CUSTOM", "FOO", "OWN"],
          access: { envVars: ["DD_API_KEY"], withhold: ["CUSTOM"] },
          keep: ["OWN", "LINEAR_API_KEY"],
          logger: l,
        },
      );
      expect(l.warn).toHaveBeenCalledTimes(1);
      expect(l.warn).toHaveBeenCalledWith(
        "[sweny] env-passthrough names skill credentials (CUSTOM, GITHUB_TOKEN); they never reach the agent. " +
          "Skill tools run in sweny and already have them. If a node's own shell needs one, add it to that node's agent_env.",
      );
      finishAgentEnv({}, { passthrough: ["GITHUB_TOKEN"], logger: l });
      expect(l.warn).toHaveBeenCalledTimes(1);
    });

    it("works with no options at all", () => {
      expect(finishAgentEnv({ PATH: "/bin", GITHUB_TOKEN: "g" })).toStrictEqual({ env: { PATH: "/bin" }, held: [] });
    });
  });

  it("grantedAgentEnv: de-duplicates, and grants nothing to a read-only node or a staged run", () => {
    expect(grantedAgentEnv(undefined, { readOnly: false, staged: false })).toStrictEqual({ grant: [] });
    expect(grantedAgentEnv([], { readOnly: true, staged: true })).toStrictEqual({ grant: [] });
    expect(grantedAgentEnv(["A", "B", "A"], { readOnly: false, staged: false })).toStrictEqual({ grant: ["A", "B"] });
    expect(grantedAgentEnv(["A", "B", "A"], { readOnly: true, staged: false })).toStrictEqual({
      grant: [],
      dropped: "agent_env withheld on a read-only node: A, B",
    });
    expect(grantedAgentEnv(["A"], { readOnly: false, staged: true })).toStrictEqual({
      grant: [],
      dropped: "agent_env withheld in a staged or dry run: A",
    });
    expect(grantedAgentEnv(["A"], { readOnly: true, staged: true }).dropped).toBe(
      "agent_env withheld on a read-only node: A",
    );
  });
});

describe("agent access and sandbox", () => {
  const skill = (id: string, env: (string | undefined)[]): Skill =>
    ({
      id,
      name: id,
      description: "",
      category: "git",
      config: Object.fromEntries(env.map((e, i) => [`f${i}`, { description: "", ...(e ? { env: e } : {}) }])),
      tools: [],
    }) as Skill;

  it("pins the sandbox host lists", () => {
    expect([...DEFAULT_SANDBOX_DOMAINS]).toStrictEqual([
      "github.com",
      "api.github.com",
      "codeload.github.com",
      "uploads.github.com",
      "*.githubusercontent.com",
      "registry.npmjs.org",
      "registry.yarnpkg.com",
      "pypi.org",
      "files.pythonhosted.org",
      "proxy.golang.org",
      "sum.golang.org",
      "crates.io",
      "static.crates.io",
      "index.crates.io",
      "rubygems.org",
    ]);
    expect(SKILL_SANDBOX_DOMAINS).toStrictEqual({
      github: ["github.com", "api.github.com", "uploads.github.com", "*.githubusercontent.com"],
      linear: ["api.linear.app", "mcp.linear.app"],
      sentry: ["sentry.io", "*.sentry.io"],
      datadog: ["*.datadoghq.com", "*.datadoghq.eu", "*.ddog-gov.com"],
      betterstack: ["*.betterstack.com", "*.betterstackdata.com"],
      slack: ["slack.com", "*.slack.com"],
      supabase: ["*.supabase.co"],
      gitlab: ["gitlab.com"],
    });
  });

  it("resolveAgentAccess: hosts of the referenced skills, every config var withheld, grants as a copy", () => {
    const skills = new Map([
      ["a", skill("a", ["Z_KEY", undefined, "A_KEY"])],
      ["b", skill("b", ["A_KEY", "M_KEY"])],
      ["c", { ...skill("c", []), config: undefined } as unknown as Skill],
    ]);
    const grant = ["G"];
    const r = resolveAgentAccess(["github", "linear", "github", "nope"], skills, grant);
    expect(r).toStrictEqual({
      envVars: ["G"],
      domains: [
        "github.com",
        "api.github.com",
        "uploads.github.com",
        "*.githubusercontent.com",
        "api.linear.app",
        "mcp.linear.app",
      ],
      withhold: ["A_KEY", "M_KEY", "Z_KEY"],
    });
    expect(r.envVars).not.toBe(grant);
    expect(resolveAgentAccess([], new Map())).toStrictEqual({ envVars: [], domains: [], withhold: [] });
    expect(resolveAgentAccess(["sentry", "github"], new Map()).domains).toStrictEqual([
      "sentry.io",
      "*.sentry.io",
      "github.com",
      "api.github.com",
      "uploads.github.com",
      "*.githubusercontent.com",
    ]);
  });

  it("resolveSandboxMode: aliases, precedence, and a CI-aware default", () => {
    for (const v of ["off", "false", "0", " OFF "]) expect(resolveSandboxMode({ CI: "1" }, v), v).toBe("off");
    for (const v of ["strict", "on", "true", "1", " Strict "]) expect(resolveSandboxMode({}, v), v).toBe("strict");
    expect(resolveSandboxMode({}, "auto")).toBe("auto");
    expect(resolveSandboxMode({ SWENY_SANDBOX: " STRICT " })).toBe("strict");
    expect(resolveSandboxMode({ SWENY_SANDBOX: "off" }, "auto")).toBe("auto");
    expect(resolveSandboxMode({ CI: "true" })).toBe("auto");
    expect(resolveSandboxMode({ CI: "1" })).toBe("auto");
    for (const ci of ["", "0", "false", "no", "off"]) expect(resolveSandboxMode({ CI: ci }), ci).toBe("off");
    expect(resolveSandboxMode({})).toBe("off");
  });

  it("resolveSandboxMode warns once about an unknown value, naming the default it used", () => {
    const warn = vi.fn();
    expect(resolveSandboxMode({ CI: "1" }, "Bogus", { warn })).toBe("auto");
    expect(warn).toHaveBeenCalledWith('SWENY_SANDBOX="bogus" is not one of off|auto|strict; using auto');
    expect(resolveSandboxMode({}, "bogus", { warn })).toBe("off");
    expect(warn).toHaveBeenLastCalledWith('SWENY_SANDBOX="bogus" is not one of off|auto|strict; using off');
    warn.mockClear();
    expect(resolveSandboxMode({}, "", { warn })).toBe("off");
    expect(resolveSandboxMode({}, undefined, { warn })).toBe("off");
    expect(warn).not.toHaveBeenCalled();
    expect(resolveSandboxMode({}, "bogus")).toBe("off");
  });

  describe("checkSandboxSupport", () => {
    const install = "(install: sudo apt-get install -y bubblewrap socat)";

    it("macOS is supported; anything but macOS and Linux is not", () => {
      expect(
        checkSandboxSupport(
          "darwin",
          "",
          () => false,
          () => "never",
        ),
      ).toBeUndefined();
      expect(checkSandboxSupport("win32", "/bin", () => true)).toBe(
        'the Claude Code sandbox does not support platform "win32"',
      );
      expect(checkSandboxSupport("freebsd", "/bin", () => true)).toBe(
        'the Claude Code sandbox does not support platform "freebsd"',
      );
    });

    it("Linux names what is missing from PATH", () => {
      const none = () => false;
      expect(checkSandboxSupport("linux", "/a:/b", none)).toBe(`missing bwrap and socat on PATH ${install}`);
      expect(checkSandboxSupport("linux", "/a", (p) => p === path.join("/a", "bwrap"))).toBe(
        `missing socat on PATH ${install}`,
      );
      expect(checkSandboxSupport("linux", "/a", (p) => p === path.join("/a", "socat"))).toBe(
        `missing bwrap on PATH ${install}`,
      );
      expect(checkSandboxSupport("linux", "", none)).toBe(`missing bwrap and socat on PATH ${install}`);
    });

    it("Linux finds each binary in any PATH directory and ignores empty entries", () => {
      const inB = (p: string) => p === path.join("/b", "bwrap") || p === path.join("/b", "socat");
      expect(checkSandboxSupport("linux", "/a:/b", inB, () => undefined)).toBeUndefined();
      const split = (p: string) => p === path.join("/a", "bwrap") || p === path.join("/b", "socat");
      expect(checkSandboxSupport("linux", "/a:/b", split, () => undefined)).toBeUndefined();
      const bare = (p: string) => p === "bwrap" || p === "socat";
      expect(checkSandboxSupport("linux", ":", bare)).toBe(`missing bwrap and socat on PATH ${install}`);
    });

    it("Linux returns the namespace probe's answer once the binaries exist", () => {
      const present = () => true;
      const probe = vi.fn(() => "bwrap cannot create a sandbox (nope)");
      expect(checkSandboxSupport("linux", "/a", present, probe)).toBe("bwrap cannot create a sandbox (nope)");
      expect(probe).toHaveBeenCalledTimes(1);
      expect(checkSandboxSupport("linux", "/a", present, () => undefined)).toBeUndefined();
      const skipped = vi.fn();
      checkSandboxSupport("linux", "/a", () => false, skipped);
      expect(skipped).not.toHaveBeenCalled();
    });
  });

  describe("buildSandboxSettings", () => {
    it("denies the agent's credentials and the credentials file, and allows only the listed hosts", () => {
      expect(buildSandboxSettings(["a.com", "b.com", "a.com"], { home: "/h" })).toStrictEqual({
        enabled: true,
        failIfUnavailable: true,
        autoAllowBashIfSandboxed: true,
        allowUnsandboxedCommands: false,
        network: { allowedDomains: ["a.com", "b.com"], strictAllowlist: true },
        credentials: {
          envVars: [
            { name: "ANTHROPIC_API_KEY", mode: "deny" },
            { name: "ANTHROPIC_AUTH_TOKEN", mode: "deny" },
            { name: "CLAUDE_CODE_OAUTH_TOKEN", mode: "deny" },
          ],
          files: [
            { path: path.join("/h", ".claude", ".credentials.json"), mode: "deny" },
            // Run journals and their keys: an agent that could read a key could forge records.
            { path: runStateRoot(), mode: "deny" },
          ],
        },
        filesystem: { denyRead: [runStateRoot()], denyWrite: [runStateRoot()] },
      });
    });

    it("failIfUnavailable defaults on and follows the option; home defaults to the user's", () => {
      expect(buildSandboxSettings([]).failIfUnavailable).toBe(true);
      expect(buildSandboxSettings([], { failIfUnavailable: false }).failIfUnavailable).toBe(false);
      expect(buildSandboxSettings([], { failIfUnavailable: true }).failIfUnavailable).toBe(true);
      expect(buildSandboxSettings([]).credentials?.files).toStrictEqual([
        { path: path.join(homedir(), ".claude", ".credentials.json"), mode: "deny" },
        { path: runStateRoot(), mode: "deny" },
      ]);
    });
  });

  describe("resolveAgentSandbox", () => {
    it("off needs no probe and no settings", () => {
      const probe = vi.fn();
      expect(resolveAgentSandbox({ env: {}, probe })).toStrictEqual({ mode: "off" });
      expect(resolveAgentSandbox({ env: { SWENY_SANDBOX: "off", CI: "1" }, mode: "off", probe })).toStrictEqual({
        mode: "off",
      });
      expect(probe).not.toHaveBeenCalled();
    });

    it("strict fails closed with the reason and the way out", () => {
      expect(resolveAgentSandbox({ env: { SWENY_SANDBOX: "strict" }, probe: () => "missing bwrap" })).toStrictEqual({
        mode: "strict",
        error:
          "Agent sandbox is required (SWENY_SANDBOX=strict) but unavailable: missing bwrap. " +
          "Refusing to run the agent unsandboxed. Fix the host, or set SWENY_SANDBOX=auto to fall back with a warning.",
      });
    });

    it("auto runs unsandboxed with a loud warning", () => {
      expect(resolveAgentSandbox({ env: {}, mode: "auto", probe: () => "missing bwrap" })).toStrictEqual({
        mode: "auto",
        warning:
          "Agent sandbox unavailable: missing bwrap. Running agent shell commands UNSANDBOXED " +
          "(network and filesystem unrestricted; env scoping and untrusted-input fencing still apply). " +
          "Fix the host to sandbox, set SWENY_SANDBOX=strict (or `sandbox: strict` in .sweny.yml) to fail instead, " +
          "or SWENY_SANDBOX=off to silence this.",
      });
    });

    it("a supported host gets settings: defaults, then node hosts, then extras, without duplicates", () => {
      const r = resolveAgentSandbox({
        env: { SWENY_SANDBOX_ALLOWED_DOMAINS: "x.test, y.test" },
        mode: "strict",
        nodeDomains: ["api.linear.app", "github.com"],
        probe: () => undefined,
      });
      expect(Object.keys(r).sort()).toStrictEqual(["mode", "settings"]);
      expect(r.mode).toBe("strict");
      expect(r.settings?.failIfUnavailable).toBe(true);
      expect(r.settings?.network?.allowedDomains).toStrictEqual([
        ...DEFAULT_SANDBOX_DOMAINS,
        "api.linear.app",
        "x.test",
        "y.test",
      ]);
    });

    it("an explicit extra list beats the environment, and auto does not fail when unavailable at start", () => {
      const r = resolveAgentSandbox({
        env: { SWENY_SANDBOX_ALLOWED_DOMAINS: "env.test" },
        mode: "auto",
        allowedDomains: ["own.test"],
        probe: () => undefined,
      });
      expect(r.settings?.failIfUnavailable).toBe(false);
      expect(r.settings?.network?.allowedDomains).toStrictEqual([...DEFAULT_SANDBOX_DOMAINS, "own.test"]);
      const none = resolveAgentSandbox({ env: {}, mode: "auto", probe: () => undefined });
      expect(none.settings?.network?.allowedDomains).toStrictEqual([...DEFAULT_SANDBOX_DOMAINS]);
    });
  });
});

afterEach(() => resetWithheldReport());

describe("agent env: second-pass edges", () => {
  it("pins every pi provider's credential names", () => {
    expect(PI_PROVIDER_VARS).toStrictEqual({
      anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"],
      openai: ["OPENAI_API_KEY"],
      "azure-openai-responses": ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_BASE_URL", "AZURE_OPENAI_RESOURCE_NAME"],
      google: ["GEMINI_API_KEY"],
      "google-vertex": ["GOOGLE_CLOUD_API_KEY", "GOOGLE_CLOUD_PROJECT", "GCLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
      "amazon-bedrock": [
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "AWS_BEARER_TOKEN_BEDROCK",
        "AWS_REGION",
        "AWS_DEFAULT_REGION",
      ],
      "cloudflare-ai-gateway": ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_GATEWAY_ID"],
      "cloudflare-workers-ai": ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID"],
      "github-copilot": ["COPILOT_GITHUB_TOKEN"],
      "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
      "ant-ling": ["ANT_LING_API_KEY"],
      "zai-coding-cn": ["ZAI_CODING_CN_API_KEY"],
      "opencode-go": ["OPENCODE_API_KEY"],
      huggingface: ["HF_TOKEN"],
      "kimi-coding": ["KIMI_API_KEY"],
      "minimax-cn": ["MINIMAX_CN_API_KEY"],
      "qwen-token-plan": ["QWEN_TOKEN_PLAN_API_KEY"],
      "qwen-token-plan-individual": ["QWEN_TOKEN_PLAN_API_KEY"],
      "qwen-token-plan-cn": ["QWEN_TOKEN_PLAN_CN_API_KEY"],
      "xiaomi-token-plan-cn": ["XIAOMI_TOKEN_PLAN_CN_API_KEY"],
      "xiaomi-token-plan-ams": ["XIAOMI_TOKEN_PLAN_AMS_API_KEY"],
      "xiaomi-token-plan-sgp": ["XIAOMI_TOKEN_PLAN_SGP_API_KEY"],
    });
  });

  it("a pi setting that is not a secret never selects a provider by itself", () => {
    for (const v of [
      "AZURE_OPENAI_BASE_URL",
      "AZURE_OPENAI_RESOURCE_NAME",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_GATEWAY_ID",
      "GOOGLE_CLOUD_PROJECT",
      "GCLOUD_PROJECT",
      "GOOGLE_CLOUD_LOCATION",
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
    ]) {
      expect(resolvePiProvider({ [v]: "x" }), v).toStrictEqual({ explicit: false, vars: [] });
    }
  });

  it("an unset SWENY_ENV_SCOPE is not an unknown value", () => {
    const warn = vi.fn();
    expect(resolveEnvScope({ CI: "1" }, undefined, { warn })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("lists every withheld credential name, comma separated, and needs no logger", () => {
    resetWithheldReport();
    const l = logger();
    finishAgentEnv({ LINEAR_API_KEY: "l", GITHUB_TOKEN: "g" }, { logger: l });
    expect(l.debug).toHaveBeenCalledWith(
      "sweny: skill credentials withheld from the agent: GITHUB_TOKEN, LINEAR_API_KEY",
    );
    expect(() => finishAgentEnv({ GITHUB_TOKEN: "g" }, { passthrough: ["GITHUB_TOKEN"] })).not.toThrow();
  });

  it("names every dropped agent_env grant for a staged run", () => {
    expect(grantedAgentEnv(["A", "B"], { readOnly: false, staged: true }).dropped).toBe(
      "agent_env withheld in a staged or dry run: A, B",
    );
  });
});

describe("agent env: push block applied twice", () => {
  it("keeps the operator's own ssh command instead of wrapping the wrapper", () => {
    const once = withPushBlocked({ GIT_SSH_COMMAND: "ssh -i key", PATH: "/bin" }, true);
    const twice = withPushBlocked(once, true);
    expect(twice.SWENY_NO_PUSH_SSH).toBe("ssh -i key");
    expect(twice.GIT_SSH_COMMAND).toBe(once.GIT_SSH_COMMAND);
    expect(twice.GIT_CONFIG_COUNT).toBe("22");
    const none = withPushBlocked(withPushBlocked({ PATH: "/bin" }, true), true);
    expect(none).not.toHaveProperty("SWENY_NO_PUSH_SSH");
  });
});
