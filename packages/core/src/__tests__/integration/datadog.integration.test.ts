import { describe, it, expect } from "vitest";
import { available } from "./harness.js";
import { datadog } from "../../skills/datadog.js";
import type { ToolContext } from "../../types.js";

const ctx = (): ToolContext => ({
  config: {
    DD_API_KEY: process.env.DD_API_KEY!,
    DD_APP_KEY: process.env.DD_APP_KEY!,
    DD_SITE: process.env.DD_SITE ?? "",
  },
  logger: console,
});

describe.runIf(available.datadog)("datadog integration", () => {
  it("lists monitors", async () => {
    const tool = datadog.tools.find((t) => t.name === "datadog_list_monitors")!;
    const result: any = await tool.handler({}, ctx());
    expect(Array.isArray(result)).toBe(true);
  }, 15_000);

  it("searches logs", async () => {
    const tool = datadog.tools.find((t) => t.name === "datadog_search_logs")!;
    const result: any = await tool.handler({ query: "*", from: "now-5m", limit: 5 }, ctx());
    expect(result).toHaveProperty("data");
  }, 15_000);
});
