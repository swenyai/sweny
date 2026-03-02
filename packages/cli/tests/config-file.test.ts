import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs");

const fs = await import("node:fs");
const { loadDotenv, loadConfigFile } = await import("../src/config-file.js");

describe("loadDotenv", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    // Save and clear test keys
    for (const key of ["TEST_KEY", "QUOTED_KEY", "EXISTING_KEY"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("does nothing when .env file does not exist", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    loadDotenv("/fake/dir");

    expect(process.env.TEST_KEY).toBeUndefined();
  });

  it("sets environment variables from a .env file", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("TEST_KEY=hello\n" as unknown as Buffer);

    loadDotenv("/fake/dir");

    expect(process.env.TEST_KEY).toBe("hello");
  });

  it("strips double quotes from values", () => {
    vi.mocked(fs.readFileSync).mockReturnValue('QUOTED_KEY="quoted value"\n' as unknown as Buffer);

    loadDotenv("/fake/dir");

    expect(process.env.QUOTED_KEY).toBe("quoted value");
  });

  it("strips single quotes from values", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("QUOTED_KEY='single quoted'\n" as unknown as Buffer);

    loadDotenv("/fake/dir");

    expect(process.env.QUOTED_KEY).toBe("single quoted");
  });

  it("skips comment lines", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("# This is a comment\nTEST_KEY=from-env\n" as unknown as Buffer);

    loadDotenv("/fake/dir");

    expect(process.env.TEST_KEY).toBe("from-env");
  });

  it("skips blank lines without error", () => {
    vi.mocked(fs.readFileSync).mockReturnValue("\n\nTEST_KEY=works\n\n" as unknown as Buffer);

    expect(() => loadDotenv("/fake/dir")).not.toThrow();
    expect(process.env.TEST_KEY).toBe("works");
  });

  it("does not override already-set environment variables", () => {
    process.env.EXISTING_KEY = "original";
    vi.mocked(fs.readFileSync).mockReturnValue("EXISTING_KEY=override\n" as unknown as Buffer);

    loadDotenv("/fake/dir");

    expect(process.env.EXISTING_KEY).toBe("original");
  });

  it("reads from .env in the provided directory", () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    loadDotenv("/my/project");

    expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining("/my/project"), "utf-8");
  });
});

describe("loadConfigFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty object when no .sweny.yml is found", () => {
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const result = loadConfigFile("/some/dir");

    expect(result).toEqual({});
  });

  it("parses key-value pairs from .sweny.yml", () => {
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue("time-range: 4h\nobservability-provider: sentry\n" as unknown as Buffer);

    const result = loadConfigFile("/project");

    expect(result["time-range"]).toBe("4h");
    expect(result["observability-provider"]).toBe("sentry");
  });

  it("strips double quotes from values", () => {
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue('service-filter: "*"\n' as unknown as Buffer);

    const result = loadConfigFile("/project");

    expect(result["service-filter"]).toBe("*");
  });

  it("strips single quotes from values", () => {
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue("service-filter: '*'\n" as unknown as Buffer);

    const result = loadConfigFile("/project");

    expect(result["service-filter"]).toBe("*");
  });

  it("skips comment lines and blank lines", () => {
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue("# comment\n\ntime-range: 24h\n" as unknown as Buffer);

    const result = loadConfigFile("/project");

    expect(Object.keys(result)).toEqual(["time-range"]);
  });

  it("skips lines without a colon separator", () => {
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockReturnValue("invalid line\ntime-range: 24h\n" as unknown as Buffer);

    const result = loadConfigFile("/project");

    expect(result).toEqual({ "time-range": "24h" });
  });

  it("returns empty object when file cannot be read after being found", () => {
    let callCount = 0;
    vi.mocked(fs.accessSync).mockReturnValue(undefined);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      callCount++;
      throw new Error("permission denied");
    });

    const result = loadConfigFile("/project");

    expect(result).toEqual({});
    expect(callCount).toBe(1);
  });
});
