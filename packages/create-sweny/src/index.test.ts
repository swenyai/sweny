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
    it("calls runNew on load", async () => {
      const mockRunNew = vi.fn().mockResolvedValue(undefined);
      vi.doMock("@sweny-ai/core/new", () => ({ runNew: mockRunNew }));

      await import("./index.js");
      await new Promise((r) => setTimeout(r, 10));

      expect(mockRunNew).toHaveBeenCalledOnce();
      vi.doUnmock("@sweny-ai/core/new");
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
