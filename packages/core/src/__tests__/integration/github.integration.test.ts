import { describe, it, expect } from "vitest";
import { available, logAvailability } from "./harness.js";
import { github } from "../../skills/github.js";
import type { ToolContext } from "../../types.js";

logAvailability();

const ctx = (): ToolContext => ({
  config: { GITHUB_TOKEN: process.env.GITHUB_TOKEN! },
  logger: console,
});

describe.runIf(available.github)("github integration", () => {
  it("searches code in a public repo", async () => {
    const tool = github.tools.find((t) => t.name === "github_search_code")!;
    const result: any = await tool.handler({ query: "README", repo: "octocat/Hello-World" }, ctx());
    expect(result).toHaveProperty("items");
  }, 15_000);

  it("gets an issue from a public repo", async () => {
    const tool = github.tools.find((t) => t.name === "github_get_issue")!;
    const result: any = await tool.handler({ repo: "octocat/Hello-World", number: 1 }, ctx());
    expect(result).toHaveProperty("title");
    expect(result).toHaveProperty("state");
  }, 15_000);

  it("lists recent commits", async () => {
    const tool = github.tools.find((t) => t.name === "github_list_recent_commits")!;
    const result: any = await tool.handler({ repo: "octocat/Hello-World", branch: "master", per_page: 3 }, ctx());
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  }, 15_000);

  it("searches issues", async () => {
    const tool = github.tools.find((t) => t.name === "github_search_issues")!;
    const result: any = await tool.handler({ query: "is:issue", repo: "octocat/Hello-World" }, ctx());
    expect(result).toHaveProperty("items");
  }, 15_000);

  it("gets a file from a public repo", async () => {
    const tool = github.tools.find((t) => t.name === "github_get_file")!;
    const result: any = await tool.handler({ repo: "octocat/Hello-World", path: "README" }, ctx());
    expect(result).toHaveProperty("content");
  }, 15_000);
});
