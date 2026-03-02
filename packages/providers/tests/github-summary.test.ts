import { describe, it, expect, vi, beforeEach } from "vitest";
import { githubSummary, githubSummaryConfigSchema } from "../src/notification/github-summary.js";

const mockSummary = {
  addHeading: vi.fn().mockReturnThis(),
  addRaw: vi.fn().mockReturnThis(),
  addTable: vi.fn().mockReturnThis(),
  write: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@actions/core", () => ({
  summary: {
    addHeading: (...args: unknown[]) => mockSummary.addHeading(...args),
    addRaw: (...args: unknown[]) => mockSummary.addRaw(...args),
    addTable: (...args: unknown[]) => mockSummary.addTable(...args),
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
    expect(githubSummaryConfigSchema.safeParse({ logger: silentLogger }).success).toBe(true);
  });

  it("validates config without logger", () => {
    expect(githubSummaryConfigSchema.safeParse({}).success).toBe(true);
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

  // ---------------------------------------------------------------------------
  // Structured field rendering
  // ---------------------------------------------------------------------------

  it("renders status emoji and summary via addRaw", async () => {
    const provider = githubSummary({ logger: silentLogger });

    await provider.send({ body: "fallback", status: "success", summary: "New PR created" });

    const rawCalls = mockSummary.addRaw.mock.calls.map((c: unknown[]) => c[0] as string);
    const statusCall = rawCalls.find((s) => s.includes("✅") && s.includes("New PR created"));
    expect(statusCall).toBeDefined();
  });

  it("renders status emoji without summary", async () => {
    const provider = githubSummary({ logger: silentLogger });

    await provider.send({ body: "fallback", status: "error" });

    const rawCalls = mockSummary.addRaw.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(rawCalls.some((s) => s.includes("❌"))).toBe(true);
  });

  it("renders fields as addTable with header row", async () => {
    const provider = githubSummary({ logger: silentLogger });

    await provider.send({
      body: "fallback",
      fields: [
        { label: "Service", value: "api-*" },
        { label: "Range", value: "24h" },
      ],
    });

    expect(mockSummary.addTable).toHaveBeenCalledOnce();
    const tableArg = mockSummary.addTable.mock.calls[0][0] as unknown[][];
    // First row is the header
    expect(tableArg[0]).toEqual([
      { data: "Field", header: true },
      { data: "Value", header: true },
    ]);
    // Data rows follow
    expect(tableArg[1]).toEqual(["Service", "api-*"]);
    expect(tableArg[2]).toEqual(["Range", "24h"]);
  });

  it("renders action links via addRaw", async () => {
    const provider = githubSummary({ logger: silentLogger });

    await provider.send({
      body: "fallback",
      links: [
        { label: "View PR", url: "https://github.com/org/repo/pull/42" },
        { label: "View Issue", url: "https://linear.app/ENG-100" },
      ],
    });

    const rawCalls = mockSummary.addRaw.mock.calls.map((c: unknown[]) => c[0] as string);
    const linkCall = rawCalls.find((s) => s.includes("[View PR]") && s.includes("[View Issue]"));
    expect(linkCall).toBeDefined();
  });

  it("renders sections with addHeading and addRaw", async () => {
    const provider = githubSummary({ logger: silentLogger });

    await provider.send({
      body: "fallback",
      sections: [
        { title: "Investigation Log", content: "Found 3 errors in logs" },
        { content: "untitled section content" },
      ],
    });

    expect(mockSummary.addHeading).toHaveBeenCalledWith("Investigation Log", 3);
    const rawCalls = mockSummary.addRaw.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(rawCalls.some((s) => s.includes("Found 3 errors in logs"))).toBe(true);
    expect(rawCalls.some((s) => s.includes("untitled section content"))).toBe(true);
  });

  it("falls back to addRaw(body) when no structured content", async () => {
    const provider = githubSummary({ logger: silentLogger });

    await provider.send({ body: "the body content" });

    // addHeading never called (no title in this test)
    expect(mockSummary.addTable).not.toHaveBeenCalled();
    expect(mockSummary.addRaw).toHaveBeenCalledWith("the body content");
  });

  it("does not render body when structured content is present", async () => {
    const provider = githubSummary({ logger: silentLogger });

    await provider.send({
      body: "should-not-appear",
      status: "info",
      summary: "Dry run complete",
    });

    const rawCalls = mockSummary.addRaw.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(rawCalls.some((s) => s === "should-not-appear")).toBe(false);
  });
});
