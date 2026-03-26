import { describe, it, expect } from "vitest";
import type { Workflow, Skill } from "@sweny-ai/core/browser";
import {
  usedSkillIds,
  nodesUsingSkill,
  collectSkillEnvVars,
  generateEnvTemplate,
  generateCodeSnippet,
} from "../lib/workflow-helpers";

// ── Test fixtures ────────────────────────────────────────────────────────────

const fakeGithub: Skill = {
  id: "github",
  name: "GitHub",
  description: "GitHub tools",
  config: {
    GITHUB_TOKEN: { description: "GitHub token", required: true, env: "GITHUB_TOKEN" },
  },
  tools: [
    { name: "github_search_code", description: "Search code", input_schema: {}, handler: async () => ({}) },
    { name: "github_get_issue", description: "Get issue", input_schema: {}, handler: async () => ({}) },
  ],
};

const fakeSlack: Skill = {
  id: "slack",
  name: "Slack",
  description: "Slack tools",
  config: {
    SLACK_BOT_TOKEN: { description: "Slack bot token", required: true, env: "SLACK_BOT_TOKEN" },
    SLACK_WEBHOOK_URL: { description: "Slack webhook URL", required: false, env: "SLACK_WEBHOOK_URL" },
  },
  tools: [{ name: "slack_send_message", description: "Send message", input_schema: {}, handler: async () => ({}) }],
};

const fakeNotification: Skill = {
  id: "notification",
  name: "Notification",
  description: "Notification tools",
  config: {
    DISCORD_WEBHOOK_URL: { description: "Discord webhook URL", required: false, env: "DISCORD_WEBHOOK_URL" },
    TEAMS_WEBHOOK_URL: { description: "Teams webhook URL", required: false, env: "TEAMS_WEBHOOK_URL" },
  },
  tools: [{ name: "notify_webhook", description: "Webhook", input_schema: {}, handler: async () => ({}) }],
};

function makeSkillMap(...skills: Skill[]): Map<string, Skill> {
  return new Map(skills.map((s) => [s.id, s]));
}

const simpleWorkflow: Workflow = {
  id: "test",
  name: "Test Workflow",
  description: "A test workflow",
  entry: "step-a",
  nodes: {
    "step-a": { name: "Step A", instruction: "Do A", skills: ["github"] },
    "step-b": { name: "Step B", instruction: "Do B", skills: ["slack", "notification"] },
  },
  edges: [{ from: "step-a", to: "step-b" }],
};

const multiSkillWorkflow: Workflow = {
  id: "multi",
  name: "Multi Skill",
  description: "Workflow with multiple skills per node",
  entry: "gather",
  nodes: {
    gather: { name: "Gather", instruction: "Gather context", skills: ["github", "slack"] },
    analyze: { name: "Analyze", instruction: "Analyze", skills: ["github"] },
    notify: { name: "Notify", instruction: "Notify team", skills: ["slack", "notification"] },
  },
  edges: [
    { from: "gather", to: "analyze" },
    { from: "analyze", to: "notify" },
  ],
};

const noSkillWorkflow: Workflow = {
  id: "empty",
  name: "Empty Skills",
  description: "A workflow with no skills",
  entry: "only",
  nodes: {
    only: { name: "Only Node", instruction: "Do nothing special", skills: [] },
  },
  edges: [],
};

// ── usedSkillIds ─────────────────────────────────────────────────────────────

describe("usedSkillIds", () => {
  it("returns sorted unique skill IDs across all nodes", () => {
    const ids = usedSkillIds(simpleWorkflow);
    expect(ids).toEqual(["github", "notification", "slack"]);
  });

  it("deduplicates skills used by multiple nodes", () => {
    const ids = usedSkillIds(multiSkillWorkflow);
    expect(ids).toEqual(["github", "notification", "slack"]);
  });

  it("returns empty array when no nodes use skills", () => {
    expect(usedSkillIds(noSkillWorkflow)).toEqual([]);
  });

  it("handles a single-skill workflow", () => {
    const wf: Workflow = {
      id: "single",
      name: "Single",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "", skills: ["github"] } },
      edges: [],
    };
    expect(usedSkillIds(wf)).toEqual(["github"]);
  });
});

// ── nodesUsingSkill ──────────────────────────────────────────────────────────

describe("nodesUsingSkill", () => {
  it("returns node IDs that use a given skill", () => {
    const nodes = nodesUsingSkill(multiSkillWorkflow, "github");
    expect(nodes).toEqual(["gather", "analyze"]);
  });

  it("returns empty array for an unused skill", () => {
    expect(nodesUsingSkill(simpleWorkflow, "datadog")).toEqual([]);
  });

  it("returns single node when skill is used once", () => {
    expect(nodesUsingSkill(simpleWorkflow, "github")).toEqual(["step-a"]);
  });

  it("finds notification nodes correctly", () => {
    expect(nodesUsingSkill(multiSkillWorkflow, "notification")).toEqual(["notify"]);
  });
});

// ── collectSkillEnvVars ──────────────────────────────────────────────────────

describe("collectSkillEnvVars", () => {
  const skillMap = makeSkillMap(fakeGithub, fakeSlack, fakeNotification);

  it("collects env vars from all skills in the workflow", () => {
    const envVars = collectSkillEnvVars(simpleWorkflow, skillMap);
    const keys = envVars.map((v) => v.key);
    expect(keys).toContain("GITHUB_TOKEN");
    expect(keys).toContain("SLACK_BOT_TOKEN");
    expect(keys).toContain("SLACK_WEBHOOK_URL");
    expect(keys).toContain("DISCORD_WEBHOOK_URL");
    expect(keys).toContain("TEAMS_WEBHOOK_URL");
  });

  it("deduplicates env vars shared across skills", () => {
    // github is used by gather AND analyze, but GITHUB_TOKEN should appear once
    const envVars = collectSkillEnvVars(multiSkillWorkflow, skillMap);
    const tokenCount = envVars.filter((v) => v.key === "GITHUB_TOKEN").length;
    expect(tokenCount).toBe(1);
  });

  it("preserves required flag correctly", () => {
    const envVars = collectSkillEnvVars(simpleWorkflow, skillMap);
    const ghToken = envVars.find((v) => v.key === "GITHUB_TOKEN");
    expect(ghToken?.required).toBe(true);

    const discord = envVars.find((v) => v.key === "DISCORD_WEBHOOK_URL");
    expect(discord?.required).toBe(false);
  });

  it("tracks which skill provides each env var", () => {
    const envVars = collectSkillEnvVars(simpleWorkflow, skillMap);
    const ghToken = envVars.find((v) => v.key === "GITHUB_TOKEN");
    expect(ghToken?.skillId).toBe("github");
    expect(ghToken?.skillName).toBe("GitHub");
  });

  it("returns empty array when no skills have config", () => {
    const envVars = collectSkillEnvVars(noSkillWorkflow, skillMap);
    expect(envVars).toEqual([]);
  });

  it("handles unknown skill IDs gracefully (skill not in map)", () => {
    const wf: Workflow = {
      id: "unknown",
      name: "Unknown",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "", skills: ["nonexistent"] } },
      edges: [],
    };
    const envVars = collectSkillEnvVars(wf, skillMap);
    expect(envVars).toEqual([]);
  });
});

// ── generateEnvTemplate ──────────────────────────────────────────────────────

describe("generateEnvTemplate", () => {
  const skillMap = makeSkillMap(fakeGithub, fakeSlack, fakeNotification);

  it("generates a valid .env template with headers", () => {
    const template = generateEnvTemplate(simpleWorkflow, skillMap);
    expect(template).toContain("# Environment variables for this workflow");
    expect(template).toContain("GITHUB_TOKEN=");
    expect(template).toContain("SLACK_BOT_TOKEN=");
  });

  it("marks optional vars with comment", () => {
    const template = generateEnvTemplate(simpleWorkflow, skillMap);
    expect(template).toContain("SLACK_WEBHOOK_URL=  # optional");
  });

  it("required vars have no comment suffix", () => {
    const template = generateEnvTemplate(simpleWorkflow, skillMap);
    // GITHUB_TOKEN is required — should not have "# optional"
    const ghLine = template.split("\n").find((l) => l.startsWith("GITHUB_TOKEN="));
    expect(ghLine).toBe("GITHUB_TOKEN=");
  });

  it("groups env vars by skill name", () => {
    const template = generateEnvTemplate(simpleWorkflow, skillMap);
    expect(template).toContain("# GitHub");
    expect(template).toContain("# Slack");
    expect(template).toContain("# Notification");
  });

  it("returns fallback message when no env vars are needed", () => {
    const template = generateEnvTemplate(noSkillWorkflow, skillMap);
    expect(template).toBe("# No environment variables required.");
  });
});

// ── generateCodeSnippet ──────────────────────────────────────────────────────

describe("generateCodeSnippet", () => {
  it("generates import for built-in triage workflow", () => {
    const triageWf: Workflow = {
      id: "triage",
      name: "Triage",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "", skills: ["github", "slack"] } },
      edges: [],
    };
    const code = generateCodeSnippet(triageWf);
    expect(code).toContain('import { triageWorkflow } from "@sweny-ai/core/workflows"');
    expect(code).toContain("execute(triageWorkflow,");
    expect(code).not.toContain("import type { Workflow }");
  });

  it("generates import for built-in implement workflow", () => {
    const implementWf: Workflow = {
      id: "implement",
      name: "Implement",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "", skills: ["github"] } },
      edges: [],
    };
    const code = generateCodeSnippet(implementWf);
    expect(code).toContain('import { implementWorkflow } from "@sweny-ai/core/workflows"');
    expect(code).toContain("execute(implementWorkflow,");
  });

  it("generates generic template for custom workflows", () => {
    const customWf: Workflow = {
      id: "my-custom",
      name: "Custom",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "", skills: ["github"] } },
      edges: [],
    };
    const code = generateCodeSnippet(customWf);
    expect(code).toContain('import type { Workflow } from "@sweny-ai/core"');
    expect(code).toContain("execute(myWorkflow,");
    expect(code).toContain("// Define or import your workflow");
    expect(code).not.toContain("triageWorkflow");
    expect(code).not.toContain("implementWorkflow");
  });

  it("includes all used skill imports", () => {
    const code = generateCodeSnippet(simpleWorkflow);
    expect(code).toContain("github, notification, slack");
    expect(code).toContain("createSkillMap([github, notification, slack])");
  });

  it("includes ClaudeClient import and setup", () => {
    const code = generateCodeSnippet(simpleWorkflow);
    expect(code).toContain("ClaudeClient");
    expect(code).toContain("process.env.ANTHROPIC_API_KEY");
  });

  it("includes execute call with correct shape", () => {
    const code = generateCodeSnippet(simpleWorkflow);
    expect(code).toContain("input:");
    expect(code).toContain("skills,");
    expect(code).toContain("claude,");
  });
});
