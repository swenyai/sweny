import { describe, it, expect } from "vitest";
import { buildSystemPrompt, deriveWorkflowVariables } from "../workflow-builder.js";
import type { Skill, Workflow } from "../types.js";

const fakeSkill = (id: string, config: Skill["config"] = {}): Skill => ({
  id,
  name: id,
  description: `${id} skill`,
  category: "general",
  config,
  tools: [],
});

describe("buildSystemPrompt", () => {
  it("includes config fields in the skill list", () => {
    const skills = [
      fakeSkill("github", {
        GITHUB_TOKEN: { description: "GitHub token", required: true, env: "GITHUB_TOKEN" },
      }),
    ];
    const prompt = buildSystemPrompt(skills);
    expect(prompt).toContain("- github: github skill");
    expect(prompt).toContain("Config: GITHUB_TOKEN (required)");
  });

  it("shows optional config fields", () => {
    const skills = [
      fakeSkill("slack", {
        SLACK_WEBHOOK_URL: { description: "Webhook URL", required: false, env: "SLACK_WEBHOOK_URL" },
        SLACK_BOT_TOKEN: { description: "Bot token", required: false, env: "SLACK_BOT_TOKEN" },
      }),
    ];
    const prompt = buildSystemPrompt(skills);
    expect(prompt).toContain("SLACK_WEBHOOK_URL (optional)");
    expect(prompt).toContain("SLACK_BOT_TOKEN (optional)");
  });

  it("omits Config line for skills with no config", () => {
    const skills = [fakeSkill("simple")];
    const prompt = buildSystemPrompt(skills);
    expect(prompt).toContain("- simple: simple skill");
    expect(prompt).not.toContain("Config:");
  });
});

describe("deriveWorkflowVariables", () => {
  const workflow: Workflow = {
    id: "test",
    name: "test",
    description: "test workflow",
    entry: "gather",
    nodes: {
      gather: {
        name: "Gather",
        instruction: "gather data",
        skills: ["github", "slack"],
      },
    },
    edges: [],
  };

  it("always includes ANTHROPIC_API_KEY first", () => {
    const vars = deriveWorkflowVariables(workflow, []);
    expect(vars[0].name).toBe("ANTHROPIC_API_KEY");
    expect(vars[0].required).toBe(true);
  });

  it("derives variables from referenced skills", () => {
    const skills = [
      fakeSkill("github", {
        GITHUB_TOKEN: { description: "GitHub token", required: true, env: "GITHUB_TOKEN" },
      }),
      fakeSkill("slack", {
        SLACK_WEBHOOK_URL: { description: "Webhook URL", required: false, env: "SLACK_WEBHOOK_URL" },
      }),
    ];
    const vars = deriveWorkflowVariables(workflow, skills);
    const names = vars.map((v) => v.name);
    expect(names).toContain("GITHUB_TOKEN");
    expect(names).toContain("SLACK_WEBHOOK_URL");
  });

  it("deduplicates env vars across skills", () => {
    const multiNodeWorkflow: Workflow = {
      ...workflow,
      nodes: {
        a: { name: "A", instruction: "a", skills: ["github"] },
        b: { name: "B", instruction: "b", skills: ["github"] },
      },
    };
    const skills = [
      fakeSkill("github", {
        GITHUB_TOKEN: { description: "GitHub token", required: true, env: "GITHUB_TOKEN" },
      }),
    ];
    const vars = deriveWorkflowVariables(multiNodeWorkflow, skills);
    const tokenCount = vars.filter((v) => v.name === "GITHUB_TOKEN").length;
    expect(tokenCount).toBe(1);
  });

  it("skips skills not in the available list", () => {
    const vars = deriveWorkflowVariables(workflow, []);
    // Only ANTHROPIC_API_KEY
    expect(vars).toHaveLength(1);
  });

  it("includes custom skills with config", () => {
    const customWorkflow: Workflow = {
      ...workflow,
      nodes: { tax: { name: "Tax", instruction: "do taxes", skills: ["my-tax-tool"] } },
    };
    const skills = [
      fakeSkill("my-tax-tool", {
        MY_TAX_KEY: { description: "Tax API key", required: true, env: "MY_TAX_KEY" },
      }),
    ];
    const vars = deriveWorkflowVariables(customWorkflow, skills);
    expect(vars.find((v) => v.name === "MY_TAX_KEY")).toBeDefined();
    expect(vars.find((v) => v.name === "MY_TAX_KEY")?.skill).toBe("my-tax-tool");
  });
});
