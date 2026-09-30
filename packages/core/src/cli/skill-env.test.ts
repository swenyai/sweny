import { describe, it, expect } from "vitest";
import { findSkillEnvGaps, formatSkillEnvGap, formatMissingSkillLines, skillEnvWarnings } from "./skill-env.js";
import { validateWorkflowSkills, createSkillMap, builtinSkills } from "../skills/index.js";

const wf = (skills: string[][]) => ({
  nodes: Object.fromEntries(skills.map((s, i) => [`n${i}`, { skills: s }])),
});

describe("findSkillEnvGaps", () => {
  it("reports a built-in skill whose required env is unset", () => {
    const gaps = findSkillEnvGaps(["github"], new Set());
    expect(gaps).toEqual([{ id: "github", missingEnv: ["GITHUB_TOKEN"] }]);
  });

  it("ignores skills that are configured, inline, or genuinely unknown", () => {
    expect(findSkillEnvGaps(["github"], new Set(["github"]))).toEqual([]);
    expect(findSkillEnvGaps(["github"], new Set(), new Set(["github"]))).toEqual([]);
    expect(findSkillEnvGaps(["not-a-real-skill"], new Set())).toEqual([]);
  });

  it("dedupes repeated ids", () => {
    expect(findSkillEnvGaps(["github", "github"], new Set())).toHaveLength(1);
  });
});

describe("formatSkillEnvGap", () => {
  it("names the skill, the env var, and where to set it", () => {
    expect(formatSkillEnvGap({ id: "github", missingEnv: ["GITHUB_TOKEN"] })).toBe(
      'skill "github" needs GITHUB_TOKEN (set it in .env)',
    );
  });

  it("lists several env vars", () => {
    expect(formatSkillEnvGap({ id: "datadog", missingEnv: ["DD_API_KEY", "DD_APP_KEY"] })).toBe(
      'skill "datadog" needs DD_API_KEY, DD_APP_KEY (set it in .env)',
    );
  });
});

describe("formatMissingSkillLines", () => {
  it("prints the env message once per skill, never 'unknown skill'", () => {
    const workflow = wf([["github"], ["github"], ["github"]]);
    const validation = validateWorkflowSkills(workflow, createSkillMap([]));
    const lines = formatMissingSkillLines(validation);
    expect(lines).toEqual(['skill "github" needs GITHUB_TOKEN (set it in .env)']);
    expect(lines.join("\n")).not.toMatch(/unknown skill/);
  });

  it("keeps the node-level error for genuinely unknown ids", () => {
    const validation = validateWorkflowSkills(wf([["gtihub"]]), createSkillMap([]));
    const lines = formatMissingSkillLines(validation);
    expect(lines.join("\n")).toContain("gtihub");
  });
});

describe("skillEnvWarnings", () => {
  it("warns (does not fail) for referenced skills with missing env", () => {
    const warnings = skillEnvWarnings({ nodes: { a: { skills: ["github"] } } }, {}, builtinSkills);
    expect(warnings).toEqual(['skill "github" needs GITHUB_TOKEN (set it in .env)']);
  });

  it("is empty when env is set", () => {
    const w = skillEnvWarnings({ nodes: { a: { skills: ["github"] } } }, { GITHUB_TOKEN: "x" }, builtinSkills);
    expect(w).toEqual([]);
  });
});
