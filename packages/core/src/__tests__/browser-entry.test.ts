import { describe, it, expect } from "vitest";

// Fix #8: `@sweny-ai/core/browser` is a browser-safe entrypoint. Anything
// exported here must bundle without pulling node: imports. `execute` drags
// `executor.ts` → `source-resolver.ts` → `node:fs/promises`, so it is not
// honest to expose from this entry. The Node entry still exports it.

describe("browser entry surface", () => {
  it("does not re-export execute", async () => {
    const browser = await import("../browser.js");
    expect((browser as Record<string, unknown>).execute).toBeUndefined();
  });

  it("still exports browser-safe surface (skills, schema, studio helpers)", async () => {
    const browser = await import("../browser.js");
    // A representative subset — keep this loose so future additions don't
    // require re-ratifying each one.
    expect(browser.builtinSkills).toBeDefined();
    expect(browser.workflowToFlow).toBeDefined();
    expect(browser.validateWorkflow).toBeDefined();
    expect(browser.parseWorkflow).toBeDefined();
  });
});
