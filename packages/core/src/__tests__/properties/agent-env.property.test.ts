// Property-based and adversarial tests for the agent env floor (agent-env.ts):
// skill credentials never reach the agent unless a write node grants them with
// agent_env, whatever the scoping, passthrough or run mode, and the push
// blocker always lands its keys.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import * as path from "node:path";
import {
  AGENT_AUTH_VARS,
  AGENT_CREDENTIAL_VARS,
  PUSH_TOKEN_VARS,
  finishAgentEnv,
  grantedAgentEnv,
  isAgentCredential,
  noPushDir,
  noPushGitConfig,
  scopeAgentEnv,
  withPushBlocked,
} from "../../agent-env.js";
import { params } from "./config.js";

// ─── Names ───────────────────────────────────────────────────────

/** Written out here, not read from the module, so a dropped entry is caught. */
const KNOWN_TOKENS = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GITLAB_TOKEN",
  "BITBUCKET_TOKEN",
  "LINEAR_API_KEY",
  "SENTRY_AUTH_TOKEN",
  "DD_API_KEY",
  "DD_APP_KEY",
  "BETTERSTACK_API_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SMTP_URL",
  "NOTIFICATION_WEBHOOK_URL",
  "DISCORD_WEBHOOK_URL",
  "TEAMS_WEBHOOK_URL",
];
const SECRETS = [...new Set([...KNOWN_TOKENS, ...AGENT_CREDENTIAL_VARS])];
const SLACK = ["SLACK_BOT_TOKEN", "SLACK_WEBHOOK_URL", "SLACK_APP_TOKEN", "SLACK_X"];
/** Config names of a run's custom skills: credentials only because the run says so (`withhold`). */
const SKILL_CONFIG = ["MYSKILL_KEY", "CUSTOM_TOKEN", "ACME_API_SECRET"];
const PLAIN = [
  "PATH",
  "HOME",
  "LANG",
  "CI",
  "GITHUB_REPOSITORY",
  "NODE_ENV",
  "DATABASE_URL",
  "FOO",
  "LC_ALL",
  "RANDOM_VAR_1",
];

const isSecret = (k: string, withhold: string[]): boolean =>
  SECRETS.includes(k) || k.startsWith("SLACK_") || withhold.includes(k);

// ─── Agent env, end to end ───────────────────────────────────────

const scenarioArb = fc.record({
  present: fc.subarray([...SECRETS, ...SLACK, ...SKILL_CONFIG, ...AGENT_AUTH_VARS, ...PLAIN]),
  withhold: fc.subarray(SKILL_CONFIG),
  scope: fc.boolean(),
  readOnly: fc.boolean(),
  staged: fc.boolean(),
  passthrough: fc.oneof(fc.constant<string[]>([]), fc.subarray([...SECRETS, ...PLAIN]), fc.constant<string[]>(["*"])),
  agentEnv: fc.subarray([...SECRETS, ...SLACK, ...SKILL_CONFIG, ...PLAIN]),
});

describe("agent env: credentials stay in the sweny process", () => {
  it("canary secrets never reach the agent unless granted by agent_env on a write node", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const source: Record<string, string> = {};
        for (const k of s.present) {
          source[k] = isSecret(k, s.withhold) || AGENT_AUTH_VARS.includes(k) ? `CANARY:${k}` : `v:${k}`;
        }
        const snapshot = { ...source };

        // The same steps every harness takes: grant, scope (maybe), finish, then no-push when staged.
        const { grant } = grantedAgentEnv(s.agentEnv, { readOnly: s.readOnly, staged: s.staged });
        const scoped = s.scope ? scopeAgentEnv(source, { extraVars: grant, passthrough: s.passthrough }).env : source;
        const finished = finishAgentEnv(scoped, {
          access: { envVars: grant, withhold: s.withhold },
          keep: AGENT_AUTH_VARS,
          passthrough: s.passthrough,
        }).env;
        const env = s.staged ? withPushBlocked(finished, true) : finished;

        const permitted = (k: string): boolean => grant.includes(k) || AGENT_AUTH_VARS.includes(k);

        // Never mutates its input.
        expect(source).toEqual(snapshot);

        for (const k of s.present) {
          if (isSecret(k, s.withhold) && !permitted(k)) {
            expect(env, `${k} must be withheld`).not.toHaveProperty(k);
          }
        }
        // No canary value appears under any name that is not permitted to carry it.
        for (const [k, v] of Object.entries(env)) {
          if (v.startsWith("CANARY:")) {
            expect(permitted(k), `${k} leaked a canary`).toBe(true);
            expect(v).toBe(`CANARY:${k}`);
          }
        }
        // Read-only nodes and staged runs grant nothing, whatever agent_env says.
        if (s.readOnly || s.staged) {
          expect(grant).toEqual([]);
          for (const k of s.present)
            if (isSecret(k, s.withhold) && !AGENT_AUTH_VARS.includes(k)) expect(env).not.toHaveProperty(k);
        }
        // A grant works (a write node that asked for it, outside a staged run), and the harness's own auth is kept.
        if (!s.readOnly && !s.staged) {
          for (const k of s.present) {
            if (s.agentEnv.includes(k) && isSecret(k, s.withhold)) expect(env[k]).toBe(source[k]);
          }
        }
        for (const k of s.present) if (AGENT_AUTH_VARS.includes(k)) expect(env[k]).toBe(source[k]);
      }),
      params(500),
    );
  });

  it("agent_env grants nothing on a read-only node or a staged run", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 12 }), { maxLength: 6 }), (names) => {
        expect(grantedAgentEnv(names, { readOnly: true, staged: false }).grant).toEqual([]);
        expect(grantedAgentEnv(names, { readOnly: false, staged: true }).grant).toEqual([]);
        expect(grantedAgentEnv(names, { readOnly: true, staged: true }).grant).toEqual([]);
        const g = grantedAgentEnv(names, { readOnly: false, staged: false }).grant;
        expect(g).toEqual([...new Set(names)]);
      }),
      params(100),
    );
  });

  it("every built-in credential name is recognized, with or without a run-specific list", () => {
    fc.assert(
      fc.property(fc.constantFrom(...SECRETS), fc.constantFrom("", "A_", "x"), (name, junk) => {
        expect(isAgentCredential(name)).toBe(true);
        expect(isAgentCredential(`SLACK_${junk}`)).toBe(true);
        // Anything the run names as a skill credential is withheld too.
        expect(isAgentCredential(`${junk}CUSTOM_${name}`, [`${junk}CUSTOM_${name}`])).toBe(true);
      }),
      params(60),
    );
  });
});

// ─── No push under --stage / --dry-run ───────────────────────────

const COUNT_VALUES = ["0", "1", "2", "3", "", "abc", "-1", "2.5", " 2"];

const gitEnvArb: fc.Arbitrary<Record<string, string>> = fc
  .tuple(
    fc.subarray([
      ...PUSH_TOKEN_VARS,
      ...SECRETS.slice(0, 8),
      "SLACK_BOT_TOKEN",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
      "GIT_CONFIG_KEY_1",
      "GIT_CONFIG_VALUE_1",
      "GIT_CONFIG_KEY_2",
      "GIT_CONFIG_VALUE_2",
      "GIT_SSH_COMMAND",
      "GIT_SSH",
      "GIT_SSH_VARIANT",
      "GH_CONFIG_DIR",
      "GH_PROMPT_DISABLED",
      "GIT_TERMINAL_PROMPT",
      "PATH",
      "HOME",
      "FOO",
    ]),
    fc.option(fc.constantFrom(...COUNT_VALUES), { nil: undefined }),
    fc.string({ maxLength: 10 }),
  )
  .map(([names, count, val]) => {
    const env: Record<string, string> = {};
    for (const n of names) env[n] = `${n}=${val}`;
    if (count !== undefined) env.GIT_CONFIG_COUNT = count;
    return env;
  });

const REPLACED = new Set([
  "GIT_SSH_COMMAND",
  "GIT_SSH_VARIANT",
  "GIT_ASKPASS",
  "GIT_TERMINAL_PROMPT",
  "GH_CONFIG_DIR",
  "GH_PROMPT_DISABLED",
  "GIT_CONFIG_COUNT",
]);

function expectPushBlocked(env: Record<string, string>, out: Record<string, string>): void {
  const dir = noPushDir();
  const tail = noPushGitConfig(dir);

  // The push-blocking keys are always set.
  expect(out.GIT_SSH_COMMAND).toContain(path.join(dir, "ssh"));
  expect(out.GIT_SSH_VARIANT).toBe("ssh");
  expect(out.GIT_ASKPASS).toBe(path.join(dir, "askpass"));
  expect(out.GIT_TERMINAL_PROMPT).toBe("0");
  expect(out.GH_PROMPT_DISABLED).toBe("1");
  expect(out.GH_CONFIG_DIR).toBe(path.join(dir, "gh"));

  // The git config entries land last, contiguously, after whatever was already there.
  const count = Number(out.GIT_CONFIG_COUNT);
  expect(Number.isInteger(count)).toBe(true);
  expect(count).toBeGreaterThanOrEqual(tail.length);
  const base = count - tail.length;
  tail.forEach(([key, value], t) => {
    expect(out[`GIT_CONFIG_KEY_${base + t}`]).toBe(key);
    expect(out[`GIT_CONFIG_VALUE_${base + t}`]).toBe(value);
  });
  // Entries the caller already had are untouched.
  for (let j = 0; j < base; j++) {
    expect(out[`GIT_CONFIG_KEY_${j}`]).toBe(env[`GIT_CONFIG_KEY_${j}`]);
    expect(out[`GIT_CONFIG_VALUE_${j}`]).toBe(env[`GIT_CONFIG_VALUE_${j}`]);
  }

  // No push credential survives, not even a granted skill credential.
  for (const k of Object.keys(out)) {
    expect(isAgentCredential(k), `${k} survived`).toBe(false);
    if (k !== "GIT_ASKPASS") expect(PUSH_TOKEN_VARS).not.toContain(k);
  }

  // The operator's own ssh command is kept for fetches, and everything unrelated is preserved.
  if (env.GIT_SSH_COMMAND !== undefined) expect(out.SWENY_NO_PUSH_SSH).toBe(env.GIT_SSH_COMMAND);
  for (const [k, v] of Object.entries(env)) {
    if (
      REPLACED.has(k) ||
      isAgentCredential(k) ||
      PUSH_TOKEN_VARS.includes(k) ||
      /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)
    )
      continue;
    expect(out[k]).toBe(v);
  }
}

describe("withPushBlocked: always sets the push-blocking keys", () => {
  it("for any env (credentials, git config noise, a hostile GIT_CONFIG_COUNT), pushes are blocked and credentials dropped", () => {
    fc.assert(
      fc.property(gitEnvArb, (env) => {
        const snapshot = { ...env };
        const out = withPushBlocked(env, true);
        expect(env).toEqual(snapshot);
        expectPushBlocked(env, out);
      }),
      params(300),
    );
  });

  it("applying it again keeps pushes blocked (the new entries stay last)", () => {
    fc.assert(
      fc.property(gitEnvArb, (env) => {
        const once = withPushBlocked(env, true);
        expectPushBlocked(once, withPushBlocked(once, true));
      }),
      params(100),
    );
  });

  it("disabled returns the env untouched", () => {
    fc.assert(
      fc.property(gitEnvArb, fc.constantFrom<boolean | undefined>(false, undefined), (env, enabled) => {
        expect(withPushBlocked(env, enabled)).toBe(env);
      }),
      params(50),
    );
  });
});
