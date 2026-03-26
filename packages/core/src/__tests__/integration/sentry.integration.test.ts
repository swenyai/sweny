import { describe, it, expect } from "vitest";
import { available } from "./harness.js";
import { sentry } from "../../skills/sentry.js";
import type { ToolContext } from "../../types.js";

const ctx = (): ToolContext => ({
  config: {
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN!,
    SENTRY_ORG: process.env.SENTRY_ORG!,
    SENTRY_BASE_URL: process.env.SENTRY_BASE_URL ?? "",
  },
  logger: console,
});

describe.runIf(available.sentry)("sentry integration", () => {
  // These tests require at least one project in the org
  it("list_issues returns an array", async () => {
    const tool = sentry.tools.find((t) => t.name === "sentry_list_issues")!;
    // Use the first project found, or skip if none
    const result: any = await tool.handler({ project: process.env.SENTRY_PROJECT ?? "javascript" }, ctx());
    expect(Array.isArray(result)).toBe(true);
  }, 15_000);
});
