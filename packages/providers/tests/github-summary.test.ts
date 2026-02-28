import { describe, it, expect, vi, beforeEach } from "vitest";
import { githubSummary, githubSummaryConfigSchema } from "../src/notification/github-summary.js";

const mockSummary = {
  addHeading: vi.fn().mockReturnThis(),
  addRaw: vi.fn().mockReturnThis(),
  write: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@actions/core", () => ({
  summary: {
    addHeading: (...args: unknown[]) => mockSummary.addHeading(...args),
    addRaw: (...args: unknown[]) => mockSummary.addRaw(...args),
    write: (...args: unknown[]) => mockSummary.write(...args),
  },
}));

const silentLogger = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("githubSummaryConfigSchema", () => {
  it("validates config with logger", () => {
    expect(
      githubSummaryConfigSchema.safeParse({ logger: silentLogger }).success,
    ).toBe(true);
  });

  it("validates config without logger", () => {
    expect(
      githubSummaryConfigSchema.safeParse({}).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe("githubSummary", () => {
  it("returns a NotificationProvider with send method", () => {
    const provider = githubSummary({ logger: silentLogger });

    expect(typeof provider.send).toBe("function");
  });

  it("uses default consoleLogger when no logger provided", () => {
    const provider = githubSummary();

    expect(provider).toBeDefined();
    expect(typeof provider.send).toBe("function");
  });

  // ---------------------------------------------------------------------------
  // send()
  // ---------------------------------------------------------------------------

  it("calls summary.addHeading() with title when title is provided", async () => {
    const provider = githubSummary({ logger: silentLogger });

    await provider.send({ title: "Deploy Report", body: "All good" });

    expect(mockSummary.addHeading).toHaveBeenCalledWith("Deploy Report", 2);
  });

  it("does not call summary.addHeading() when title is omitted", async () => {
    const provider = githubSummary({ logger: silentLogger });

    await provider.send({ body: "body only" });

    expect(mockSummary.addHeading).not.toHaveBeenCalled();
  });

  it("calls summary.addRaw() with body", async () => {
    const provider = githubSummary({ logger: silentLogger });

    await provider.send({ body: "the body content" });

    expect(mockSummary.addRaw).toHaveBeenCalledWith("the body content");
  });

  it("calls summary.write()", async () => {
    const provider = githubSummary({ logger: silentLogger });

    await provider.send({ body: "anything" });

    expect(mockSummary.write).toHaveBeenCalledOnce();
  });
});
