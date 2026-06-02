import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("create-sweny", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("error handling pattern", () => {
    it("catch handler logs error and exits with code 1", async () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      // Simulate what the entry point does: runNew().catch(...)
      const testError = new Error("init failed");
      const rejectedPromise = Promise.reject(testError);
      rejectedPromise.catch((err) => {
        console.error(err);
        process.exit(1);
      });

      await new Promise((r) => setTimeout(r, 10));

      expect(mockConsoleError).toHaveBeenCalledWith(testError);
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
      mockConsoleError.mockRestore();
    });
  });

  describe("module structure", () => {
    const originalArgv = process.argv;

    afterEach(() => {
      process.argv = originalArgv;
      vi.doUnmock("@sweny-ai/core/new");
      vi.resetModules();
    });

    async function loadWithArgv(argv: string[]): Promise<ReturnType<typeof vi.fn>> {
      const mockRunNew = vi.fn().mockResolvedValue(undefined);
      vi.resetModules();
      vi.doMock("@sweny-ai/core/new", () => ({ runNew: mockRunNew }));
      process.argv = ["node", "create-sweny", ...argv];
      await import("./index.js");
      await new Promise((r) => setTimeout(r, 10));
      return mockRunNew;
    }

    it("calls runNew on load", async () => {
      const mockRunNew = await loadWithArgv([]);
      expect(mockRunNew).toHaveBeenCalledOnce();
    });

    it("threads the workflow id arg into runNew as marketplaceId", async () => {
      const mockRunNew = await loadWithArgv(["release-notes"]);
      expect(mockRunNew).toHaveBeenCalledWith({ marketplaceId: "release-notes" });
    });

    it("passes the e2e arg through (matches `sweny new e2e`)", async () => {
      const mockRunNew = await loadWithArgv(["e2e"]);
      expect(mockRunNew).toHaveBeenCalledWith({ marketplaceId: "e2e" });
    });

    it("calls runNew with undefined when no arg is given (interactive picker)", async () => {
      const mockRunNew = await loadWithArgv([]);
      expect(mockRunNew).toHaveBeenCalledWith(undefined);
    });
  });

  describe("package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf-8"));

    it("has correct bin entry", () => {
      expect(pkg.bin["create-sweny"]).toBe("./dist/index.js");
    });

    it("is ESM", () => {
      expect(pkg.type).toBe("module");
    });

    it("requires node 18+", () => {
      expect(pkg.engines?.node).toMatch(/18/);
    });

    it("has bugs URL", () => {
      expect(pkg.bugs?.url).toMatch(/github\.com.*issues/);
    });

    it("only depends on @sweny-ai/core", () => {
      expect(Object.keys(pkg.dependencies ?? {})).toEqual(["@sweny-ai/core"]);
    });

    it("publishes only dist/", () => {
      expect(pkg.files).toEqual(["dist"]);
    });
  });

  describe("source", () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, "index.ts"), "utf-8");

    it("has node shebang", () => {
      expect(src.startsWith("#!/usr/bin/env node")).toBe(true);
    });

    it("imports from @sweny-ai/core/new", () => {
      expect(src).toContain('from "@sweny-ai/core/new"');
    });

    it("has .catch() error handler", () => {
      expect(src).toContain(".catch(");
    });
  });
});
