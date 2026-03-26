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

  it("all skills have valid metadata", () => {
    for (const skill of builtinSkills) {
      expect(skill.id).toBeTruthy();
      expect(skill.name).toBeTruthy();
      expect(skill.description).toBeTruthy();
      expect(skill.config).toBeDefined();
      expect(Array.isArray(skill.tools)).toBe(true);
    }
  });

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
