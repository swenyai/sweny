import { describe, it, expect } from "vitest";
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Fix #8: `@sweny-ai/core/browser` is a browser-safe entrypoint. Anything
// exported here must bundle without pulling node: imports. `execute` drags
// `executor.ts` → `source-resolver.ts` → `node:fs/promises`, so it is not
// honest to expose from this entry. The Node entry still exports it.

const __dirname = dirname(fileURLToPath(import.meta.url));
// browser.ts is the TS source; esbuild compiles it on the fly during the test.
const BROWSER_ENTRY = resolve(__dirname, "..", "browser.ts");

describe("browser entry surface (runtime-level)", () => {
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

// Real browser-bundling test. Catches transitive node:* leaks that the
// export-shape test above cannot: if someone adds an import that imports
// something that imports node:fs, the shape stays fine but a browser
// bundler would fail. esbuild with platform: "browser" reproduces that.
describe("browser entry bundles cleanly for a browser target", () => {
  it("compiles with platform=browser without any node: imports in output", async () => {
    const result = await esbuild.build({
      entryPoints: [BROWSER_ENTRY],
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      write: false,
      // Fail the build if ANY import resolves to a Node builtin. esbuild's
      // default behavior for platform: "browser" is to error on node:*
      // imports, but we make that explicit.
      external: [],
      metafile: true,
      logLevel: "silent",
    });

    expect(result.errors).toEqual([]);

    // Defense-in-depth: even if esbuild didn't error, scan the output
    // bundle for node: imports. A malformed esbuild config could shim
    // node: modules and produce silent junk.
    for (const file of result.outputFiles ?? []) {
      expect(file.text, `${file.path} must not contain node: imports`).not.toMatch(/from\s+["']node:/);
      expect(file.text, `${file.path} must not require node: modules`).not.toMatch(/require\(["']node:/);
    }

    // The bundle must not pull source-resolver or executor (the known
    // Node-only dependencies). These would indicate a regression in the
    // browser entry's import graph.
    const inputs = Object.keys(result.metafile?.inputs ?? {});
    expect(inputs.some((p) => p.endsWith("source-resolver.ts"))).toBe(false);
    expect(inputs.some((p) => p.endsWith("executor.ts"))).toBe(false);
    expect(inputs.some((p) => p.endsWith("claude.ts"))).toBe(false);
  });
});
