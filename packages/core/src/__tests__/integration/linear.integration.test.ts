import { describe, it, expect } from "vitest";
import { available } from "./harness.js";
import { linear } from "../../skills/linear.js";
import type { ToolContext } from "../../types.js";

const ctx = (): ToolContext => ({
  config: { LINEAR_API_KEY: process.env.LINEAR_API_KEY! },
  logger: console,
});

describe.runIf(available.linear)("linear integration", () => {
  it("searches issues", async () => {
    const tool = linear.tools.find((t) => t.name === "linear_search_issues")!;
    const result: any = await tool.handler({ query: "bug", limit: 3 }, ctx());
    expect(result).toHaveProperty("searchIssues");
    expect(result.searchIssues).toHaveProperty("nodes");
  }, 15_000);
});
