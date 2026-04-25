import { describe, it, expect } from "vitest";
import {
  github,
  linear,
  slack,
  sentry,
  datadog,
  notification,
  builtinSkills,
  createSkillMap,
  allSkills,
  isSkillConfigured,
  validateWorkflowSkills,
} from "../skills/index.js";

describe("skills registry", () => {
  it("exports all builtin skills", () => {
    expect(builtinSkills.length).toBeGreaterThanOrEqual(6);
    const ids = builtinSkills.map((s) => s.id);
    expect(ids).toContain("github");
    expect(ids).toContain("linear");
    expect(ids).toContain("slack");
    expect(ids).toContain("sentry");
    expect(ids).toContain("datadog");
    expect(ids).toContain("notification");
  });

  it("individual skill exports match builtins", () => {
    expect(builtinSkills).toContain(github);
    expect(builtinSkills).toContain(linear);
    expect(builtinSkills).toContain(slack);
    expect(builtinSkills).toContain(sentry);
    expect(builtinSkills).toContain(datadog);
    expect(builtinSkills).toContain(notification);
  });

  it("createSkillMap builds a correct map", () => {
    const map = createSkillMap([github, slack]);
    expect(map.size).toBe(2);
    expect(map.get("github")).toBe(github);
    expect(map.get("slack")).toBe(slack);
  });

  it("createSkillMap throws on duplicate IDs", () => {
    expect(() => createSkillMap([github, github])).toThrow("Duplicate skill ID");
  });

  it("allSkills returns all builtin skills as a map", () => {
    const map = allSkills();
    expect(map.size).toBe(builtinSkills.length);
    for (const skill of builtinSkills) {
      expect(map.has(skill.id)).toBe(true);
    }
  });

  it("no tool name collisions across skills", () => {
    const seen = new Set<string>();
    for (const skill of builtinSkills) {
      for (const tool of skill.tools) {
        expect(seen.has(tool.name)).toBe(false);
        seen.add(tool.name);
      }
    }
  });

  it("all tools have name, description, and input_schema", () => {
    for (const skill of builtinSkills) {
      for (const tool of skill.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.input_schema).toBeDefined();
        expect(typeof tool.handler).toBe("function");
      }
    }
  });

  it("all skills have valid metadata and category", () => {
    const validCategories = ["git", "observability", "tasks", "notification", "general"];
    for (const skill of builtinSkills) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.config).toBeDefined();
      expect(Array.isArray(skill.tools)).toBe(true);
      expect(validCategories).toContain(skill.category);
    }
  });

  it("isSkillConfigured checks required env vars", () => {
    expect(isSkillConfigured(github, { GITHUB_TOKEN: "ghp_xxx" })).toBe(true);
    expect(isSkillConfigured(github, {})).toBe(false); // GITHUB_TOKEN is required
    // Slack has all-optional config — always configured, tools validate at call time
    expect(isSkillConfigured(slack, {})).toBe(true);
    expect(isSkillConfigured(slack, { SLACK_WEBHOOK_URL: "https://hooks.slack.com/..." })).toBe(true);
    expect(isSkillConfigured(slack, { SLACK_BOT_TOKEN: "xoxb-..." })).toBe(true);
  });

  it("validateWorkflowSkills detects missing providers", () => {
    const workflow = {
      nodes: {
        gather: { skills: ["github", "sentry"] },
        notify: { skills: ["slack"] },
      },
    };
    // Only github is available
    const available = createSkillMap([github]);
    const result = validateWorkflowSkills(workflow, available);

    expect(result.configured).toHaveLength(1);
    expect(result.configured[0].id).toBe("github");
    expect(result.missing.some((m) => m.id === "sentry")).toBe(true);
    // gather node has github (git) but no observability → error
    expect(result.errors.length).toBeGreaterThan(0);
    // notify node has no notification → warning (not error)
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  // Fix #5: workflow.skills (inline skill definitions) must count as available
  // during CLI validation. Previously the CLI called validateWorkflowSkills
  // with only the configured-builtins+custom map, so a spec-valid workflow
  // that defined a skill inline would be rejected as UNKNOWN_SKILL before
  // the executor ever ran mergeInlineSkills on it.
  it("validateWorkflowSkills accepts inline workflow.skills via inlineSkills param", () => {
    const workflow = {
      nodes: {
        gather: { skills: ["my-inline"] },
      },
      skills: {
        "my-inline": { instruction: "Do custom work" },
      },
    };
    const available = createSkillMap([]);
    const result = validateWorkflowSkills(workflow, available, workflow.skills);
    expect(result.errors).toHaveLength(0);
  });

  it("validateWorkflowSkills without inlineSkills param still rejects unknown ids", () => {
    const workflow = {
      nodes: {
        gather: { skills: ["my-inline"] },
      },
      skills: {
        "my-inline": { instruction: "Do custom work" },
      },
    };
    const available = createSkillMap([]);
    // No inlineSkills → treat as unknown, as before.
    const result = validateWorkflowSkills(workflow, available);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  // Contract test for the CLI workflow-run error formatter. main.ts splits
  // `result.missing` into "unknown" (scaffold-it path) vs "env-gap" (set-env-
  // vars path) by checking `m.category === "unknown"`. If this contract
  // changes, the CLI message degrades silently. Catch it here, not in prod.
  it("validateWorkflowSkills tags unknown ids with category='unknown' and built-in env-gaps with their real category", () => {
    const workflow = {
      nodes: {
        gather: { skills: ["github", "totally-made-up-skill"] },
      },
    };
    // No env vars set, so `github` is built-in but not configured.
    const available = createSkillMap([]);
    const result = validateWorkflowSkills(workflow, available);

    const made = result.missing.find((m) => m.id === "totally-made-up-skill");
    expect(made?.category).toBe("unknown");

    const github = result.missing.find((m) => m.id === "github");
    expect(github?.category).toBe("git");
    expect(github?.missingEnv).toContain("GITHUB_TOKEN");
  });

  it("validateWorkflowSkills passes when all categories covered", () => {
    const workflow = {
      nodes: {
        gather: { skills: ["github", "sentry"] },
      },
    };
    const available = createSkillMap([github, sentry]);
    const result = validateWorkflowSkills(workflow, available);

    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
    expect(result.configured).toHaveLength(2);
  });

  // Drift catcher for SKILL_CATEGORIES vs the published schema lives in
  // contract-tests.test.ts alongside the rest of the cross-source-of-truth
  // invariants. See docs/hardening/contract-tests.md.

  it("config fields have env vars matching canonical names", () => {
    // Datadog should use DD_* prefix
    for (const [key, field] of Object.entries(datadog.config)) {
      if (field.env) {
        expect(field.env).toMatch(/^DD_/);
      }
    }

    // Sentry base URL should be SENTRY_BASE_URL not SENTRY_URL
    const sentryConfig = Object.values(sentry.config).find((f) => f.env?.includes("SENTRY") && f.env?.includes("URL"));
    if (sentryConfig) {
      expect(sentryConfig.env).toBe("SENTRY_BASE_URL");
    }
  });
});
