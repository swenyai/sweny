/**
 * Integration tests validating the skill config system end-to-end:
 * - Every builtin skill has a non-empty config
 * - Config fields have correct structure (description, required, env)
 * - deriveWorkflowVariables produces correct output for real skills
 * - collectCredentialsForSkills works with real builtins
 * - Custom skill config merge works correctly
 * - publish validation catches real problems
 */
import { describe, it, expect } from "vitest";
import { builtinSkills } from "../skills/index.js";
import { deriveWorkflowVariables } from "../workflow-builder.js";
import { collectCredentialsForSkills } from "../cli/new.js";
import type { Workflow, ConfigField, Skill } from "../types.js";

// ── Builtin skill config completeness ────────────────────────────────

describe("builtin skill config completeness", () => {
  const SKILLS_WITH_CONFIG = [
    "github",
    "linear",
    "slack",
    "sentry",
    "datadog",
    "betterstack",
    "notification",
    "supabase",
  ];

  it("all expected skills exist in builtinSkills", () => {
    const ids = builtinSkills.map((s) => s.id);
    for (const expected of SKILLS_WITH_CONFIG) {
      expect(ids, `missing builtin skill: ${expected}`).toContain(expected);
    }
  });

  it("every builtin skill has at least one config field", () => {
    for (const skill of builtinSkills) {
      if (!SKILLS_WITH_CONFIG.includes(skill.id)) continue;
      expect(Object.keys(skill.config).length, `${skill.id} should have config fields`).toBeGreaterThan(0);
    }
  });

  it("every config field has description, required boolean, and env string", () => {
    for (const skill of builtinSkills) {
      for (const [key, field] of Object.entries(skill.config)) {
        expect(typeof field.description, `${skill.id}.${key}.description`).toBe("string");
        expect(field.description.length, `${skill.id}.${key}.description is empty`).toBeGreaterThan(0);
        expect(typeof field.required, `${skill.id}.${key}.required`).toBe("boolean");
        expect(typeof field.env, `${skill.id}.${key}.env`).toBe("string");
        expect(field.env, `${skill.id}.${key}.env should match key`).toBe(key);
      }
    }
  });

  it("github has GITHUB_TOKEN as required", () => {
    const github = builtinSkills.find((s) => s.id === "github")!;
    expect(github.config.GITHUB_TOKEN).toBeDefined();
    expect(github.config.GITHUB_TOKEN.required).toBe(true);
  });

  it("sentry has SENTRY_AUTH_TOKEN, SENTRY_ORG (required) and SENTRY_BASE_URL (optional)", () => {
    const sentry = builtinSkills.find((s) => s.id === "sentry")!;
    expect(sentry.config.SENTRY_AUTH_TOKEN.required).toBe(true);
    expect(sentry.config.SENTRY_ORG.required).toBe(true);
    expect(sentry.config.SENTRY_BASE_URL.required).toBe(false);
  });

  it("datadog has DD_API_KEY, DD_APP_KEY (required) and DD_SITE (optional)", () => {
    const dd = builtinSkills.find((s) => s.id === "datadog")!;
    expect(dd.config.DD_API_KEY.required).toBe(true);
    expect(dd.config.DD_APP_KEY.required).toBe(true);
    expect(dd.config.DD_SITE.required).toBe(false);
  });

  it("betterstack has 4 required config fields", () => {
    const bs = builtinSkills.find((s) => s.id === "betterstack")!;
    expect(Object.keys(bs.config)).toHaveLength(4);
    expect(bs.config.BETTERSTACK_API_TOKEN.required).toBe(true);
    expect(bs.config.BETTERSTACK_QUERY_ENDPOINT.required).toBe(true);
    expect(bs.config.BETTERSTACK_QUERY_USERNAME.required).toBe(true);
    expect(bs.config.BETTERSTACK_QUERY_PASSWORD.required).toBe(true);
  });

  it("notification has all optional config fields", () => {
    const notif = builtinSkills.find((s) => s.id === "notification")!;
    for (const field of Object.values(notif.config)) {
      expect(field.required).toBe(false);
    }
  });
});

// ── deriveWorkflowVariables integration ──────────────────────────────

describe("deriveWorkflowVariables with real builtins", () => {
  const makeWorkflow = (skills: string[]): Workflow => ({
    id: "test",
    name: "test",
    description: "test",
    entry: "step1",
    nodes: { step1: { name: "Step 1", instruction: "do it", skills } },
    edges: [],
  });

  it("produces ANTHROPIC_API_KEY + all github config fields", () => {
    const vars = deriveWorkflowVariables(makeWorkflow(["github"]), builtinSkills);
    const names = vars.map((v) => v.name);
    expect(names[0]).toBe("ANTHROPIC_API_KEY");
    expect(names).toContain("GITHUB_TOKEN");
  });

  it("handles multi-skill workflow correctly", () => {
    const vars = deriveWorkflowVariables(makeWorkflow(["github", "sentry", "slack"]), builtinSkills);
    const names = vars.map((v) => v.name);
    expect(names).toContain("GITHUB_TOKEN");
    expect(names).toContain("SENTRY_AUTH_TOKEN");
    expect(names).toContain("SENTRY_ORG");
    expect(names).toContain("SENTRY_BASE_URL");
    expect(names).toContain("SLACK_WEBHOOK_URL");
    expect(names).toContain("SLACK_BOT_TOKEN");
  });

  it("deduplicates when same skill appears in multiple nodes", () => {
    const workflow: Workflow = {
      id: "test",
      name: "test",
      description: "test",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "a", skills: ["github"] },
        b: { name: "B", instruction: "b", skills: ["github"] },
      },
      edges: [{ from: "a", to: "b" }],
    };
    const vars = deriveWorkflowVariables(workflow, builtinSkills);
    const tokenVars = vars.filter((v) => v.name === "GITHUB_TOKEN");
    expect(tokenVars).toHaveLength(1);
  });

  it("tracks skill attribution correctly", () => {
    const vars = deriveWorkflowVariables(makeWorkflow(["github", "sentry"]), builtinSkills);
    expect(vars.find((v) => v.name === "GITHUB_TOKEN")?.skill).toBe("github");
    expect(vars.find((v) => v.name === "SENTRY_AUTH_TOKEN")?.skill).toBe("sentry");
  });

  it("marks required/optional correctly", () => {
    const vars = deriveWorkflowVariables(makeWorkflow(["sentry"]), builtinSkills);
    expect(vars.find((v) => v.name === "SENTRY_AUTH_TOKEN")?.required).toBe(true);
    expect(vars.find((v) => v.name === "SENTRY_BASE_URL")?.required).toBe(false);
  });
});

// ── collectCredentialsForSkills integration ──────────────────────────

describe("collectCredentialsForSkills with real builtins", () => {
  it("always includes ANTHROPIC_API_KEY first", () => {
    const creds = collectCredentialsForSkills(["github"], builtinSkills);
    expect(creds[0].key).toBe("ANTHROPIC_API_KEY");
  });

  it("derives credentials from skill.config when availableSkills provided", () => {
    const creds = collectCredentialsForSkills(["github"], builtinSkills);
    expect(creds.some((c) => c.key === "GITHUB_TOKEN")).toBe(true);
  });

  it("includes all betterstack credentials", () => {
    const creds = collectCredentialsForSkills(["betterstack"], builtinSkills);
    const keys = creds.map((c) => c.key);
    expect(keys).toContain("BETTERSTACK_API_TOKEN");
    expect(keys).toContain("BETTERSTACK_QUERY_ENDPOINT");
    expect(keys).toContain("BETTERSTACK_QUERY_USERNAME");
    expect(keys).toContain("BETTERSTACK_QUERY_PASSWORD");
  });

  it("deduplicates across multiple skills", () => {
    const creds = collectCredentialsForSkills(["github", "github"], builtinSkills);
    const tokenCreds = creds.filter((c) => c.key === "GITHUB_TOKEN");
    expect(tokenCreds).toHaveLength(1);
  });

  it("falls back to SKILL_CREDENTIALS for unknown skills", () => {
    // "gitlab" isn't in builtinSkills but is in SKILL_CREDENTIALS
    const creds = collectCredentialsForSkills(["gitlab"], builtinSkills);
    expect(creds.some((c) => c.key === "GITLAB_TOKEN")).toBe(true);
  });
});

// ── Custom skill config merge ────────────────────────────────────────

describe("custom skill config merge", () => {
  it("custom skill config fields are preserved in deriveWorkflowVariables", () => {
    const customSkill: Skill = {
      id: "my-tax-tool",
      name: "Tax Tool",
      description: "Tax processing",
      category: "general",
      config: {
        TAX_API_KEY: { description: "Tax service API key", required: true, env: "TAX_API_KEY" },
      },
      tools: [],
    };

    const workflow: Workflow = {
      id: "test",
      name: "test",
      description: "test",
      entry: "start",
      nodes: { start: { name: "Start", instruction: "process", skills: ["my-tax-tool"] } },
      edges: [],
    };

    const vars = deriveWorkflowVariables(workflow, [customSkill]);
    expect(vars.find((v) => v.name === "TAX_API_KEY")).toBeDefined();
    expect(vars.find((v) => v.name === "TAX_API_KEY")?.skill).toBe("my-tax-tool");
    expect(vars.find((v) => v.name === "TAX_API_KEY")?.required).toBe(true);
  });

  it("collectCredentialsForSkills works with custom skills", () => {
    const customSkill: Skill = {
      id: "my-db",
      name: "DB",
      description: "Database",
      category: "general",
      config: {
        DB_URL: { description: "Database URL", required: true, env: "DB_URL" },
      },
      tools: [],
    };

    const creds = collectCredentialsForSkills(["my-db"], [customSkill]);
    expect(creds.some((c) => c.key === "DB_URL")).toBe(true);
  });
});
