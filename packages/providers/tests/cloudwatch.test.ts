import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cloudwatch, cloudwatchConfigSchema } from "../src/observability/cloudwatch.js";
import type { ObservabilityProvider } from "../src/observability/types.js";

// ---------------------------------------------------------------------------
// Mock AWS SDK — the provider uses dynamic imports, vi.mock intercepts them
// ---------------------------------------------------------------------------

const mockSend = vi.fn();

vi.mock("@aws-sdk/client-cloudwatch-logs", () => {
  return {
    CloudWatchLogsClient: class MockCloudWatchLogsClient {
      send = mockSend;
      constructor(_config?: unknown) {}
    },
    DescribeLogGroupsCommand: class MockDescribeLogGroupsCommand {
      _type = "DescribeLogGroupsCommand";
      input: unknown;
      constructor(args: unknown) {
        this.input = args;
      }
    },
    StartQueryCommand: class MockStartQueryCommand {
      _type = "StartQueryCommand";
      input: unknown;
      constructor(args: unknown) {
        this.input = args;
      }
    },
    GetQueryResultsCommand: class MockGetQueryResultsCommand {
      _type = "GetQueryResultsCommand";
      input: unknown;
      constructor(args: unknown) {
        this.input = args;
      }
    },
  };
});

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("cloudwatchConfigSchema", () => {
  it("validates a complete config with region and logGroupPrefix", () => {
    const result = cloudwatchConfigSchema.safeParse({
      region: "eu-west-1",
      logGroupPrefix: "/ecs/my-app",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.region).toBe("eu-west-1");
      expect(result.data.logGroupPrefix).toBe("/ecs/my-app");
    }
  });

  it("applies default region us-east-1 when not specified", () => {
    const result = cloudwatchConfigSchema.parse({
      logGroupPrefix: "/ecs/my-app",
    });
    expect(result.region).toBe("us-east-1");
  });

  it("rejects missing logGroupPrefix", () => {
    const result = cloudwatchConfigSchema.safeParse({ region: "us-east-1" });
    expect(result.success).toBe(false);
  });

  it("rejects empty logGroupPrefix", () => {
    const result = cloudwatchConfigSchema.safeParse({
      region: "us-east-1",
      logGroupPrefix: "",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe("cloudwatch factory", () => {
  it("returns an ObservabilityProvider with correct methods", () => {
    const provider: ObservabilityProvider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });
    expect(provider).toBeDefined();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns AWS env vars", () => {
    const provider = cloudwatch({
      region: "eu-west-1",
      logGroupPrefix: "/ecs/my-app",
      logger: silentLogger,
    });
    const env = provider.getAgentEnv();
    expect(env).toEqual({
      AWS_REGION: "eu-west-1",
      CW_LOG_GROUP_PREFIX: "/ecs/my-app",
    });
  });

  it("getPromptInstructions contains CloudWatch API docs", () => {
    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("CloudWatch");
    expect(instructions).toContain("AWS_REGION");
    expect(instructions).toContain("aws logs");
  });

  it("throws on invalid config", () => {
    expect(() => cloudwatch({ logGroupPrefix: "" } as any)).toThrow();
    expect(() => cloudwatch({} as any)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// verifyAccess
// ---------------------------------------------------------------------------

describe("CloudWatchProvider.verifyAccess", () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it("calls DescribeLogGroupsCommand with correct prefix and limit", async () => {
    mockSend.mockResolvedValue({});

    const provider = cloudwatch({
      region: "us-west-2",
      logGroupPrefix: "/ecs/production",
      logger: silentLogger,
    });

    await provider.verifyAccess();

    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0][0];
    expect(cmd._type).toBe("DescribeLogGroupsCommand");
    expect(cmd.input).toEqual({
      logGroupNamePrefix: "/ecs/production",
      limit: 1,
    });
  });

  it("throws when AWS client throws", async () => {
    mockSend.mockRejectedValue(new Error("AccessDeniedException"));

    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    await expect(provider.verifyAccess()).rejects.toThrow("AccessDeniedException");
  });
});

// ---------------------------------------------------------------------------
// queryLogs
// ---------------------------------------------------------------------------

describe("CloudWatchProvider.queryLogs", () => {
  beforeEach(() => {
    mockSend.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupQueryMocks(results: Array<Array<{ field?: string; value?: string }>>) {
    // First call: StartQueryCommand -> returns queryId
    // Second call: GetQueryResultsCommand -> returns Complete with results
    mockSend.mockResolvedValueOnce({ queryId: "test-query-id" }).mockResolvedValueOnce({ status: "Complete", results });
  }

  it("starts query with correct time range, service filter, and severity", async () => {
    setupQueryMocks([]);

    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    const provider = cloudwatch({
      region: "us-east-1",
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    const promise = provider.queryLogs({
      timeRange: "1h",
      serviceFilter: "api-service",
      severity: "error",
    });

    // Advance past the 1s polling delay
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    // StartQueryCommand call
    const startCmd = mockSend.mock.calls[0][0];
    expect(startCmd._type).toBe("StartQueryCommand");
    expect(startCmd.input.logGroupName).toBe("/ecs/app");
    expect(startCmd.input.startTime).toBe(Math.floor((now - 3_600_000) / 1000));
    expect(startCmd.input.endTime).toBe(Math.floor(now / 1000));
    expect(startCmd.input.queryString).toContain("api-service");
    expect(startCmd.input.queryString).toContain("error");
  });

  it("polls for results and returns mapped LogEntry[]", async () => {
    setupQueryMocks([
      [
        { field: "@timestamp", value: "2025-06-01T12:00:00Z" },
        { field: "@logStream", value: "api-service" },
        { field: "@message", value: "Something went wrong" },
      ],
      [
        { field: "@timestamp", value: "2025-06-01T12:01:00Z" },
        { field: "@logStream", value: "worker" },
        { field: "@message", value: "Connection refused" },
      ],
    ]);

    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    const promise = provider.queryLogs({
      timeRange: "1h",
      serviceFilter: "*",
      severity: "error",
    });

    await vi.advanceTimersByTimeAsync(1000);
    const logs = await promise;

    expect(logs).toHaveLength(2);

    expect(logs[0]).toEqual({
      timestamp: "2025-06-01T12:00:00Z",
      service: "api-service",
      level: "error",
      message: "Something went wrong",
      attributes: {},
    });

    expect(logs[1]).toEqual({
      timestamp: "2025-06-01T12:01:00Z",
      service: "worker",
      level: "error",
      message: "Connection refused",
      attributes: {},
    });
  });

  it("handles empty results", async () => {
    setupQueryMocks([]);

    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    const promise = provider.queryLogs({
      timeRange: "30m",
      serviceFilter: "*",
      severity: "warn",
    });

    await vi.advanceTimersByTimeAsync(1000);
    const logs = await promise;

    expect(logs).toEqual([]);
  });

  it("applies service filter when not '*'", async () => {
    setupQueryMocks([]);

    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    const promise = provider.queryLogs({
      timeRange: "1h",
      serviceFilter: "my-service",
      severity: "error",
    });

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    const startCmd = mockSend.mock.calls[0][0];
    expect(startCmd.input.queryString).toContain("filter @logStream like /my-service/");
  });

  it("omits service filter when serviceFilter is '*'", async () => {
    setupQueryMocks([]);

    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    const promise = provider.queryLogs({
      timeRange: "1h",
      serviceFilter: "*",
      severity: "error",
    });

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    const startCmd = mockSend.mock.calls[0][0];
    expect(startCmd.input.queryString).not.toContain("filter @logStream like");
  });
});

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

describe("CloudWatchProvider.aggregate", () => {
  beforeEach(() => {
    mockSend.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupAggMocks(results: Array<Array<{ field?: string; value?: string }>>) {
    mockSend.mockResolvedValueOnce({ queryId: "agg-query-id" }).mockResolvedValueOnce({ status: "Complete", results });
  }

  it("starts aggregation query", async () => {
    setupAggMocks([]);

    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    const promise = provider.aggregate({
      timeRange: "7d",
      serviceFilter: "*",
    });

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    const startCmd = mockSend.mock.calls[0][0];
    expect(startCmd._type).toBe("StartQueryCommand");
    expect(startCmd.input.logGroupName).toBe("/ecs/app");
    expect(startCmd.input.startTime).toBe(Math.floor((now - 604_800_000) / 1000));
    expect(startCmd.input.endTime).toBe(Math.floor(now / 1000));
    expect(startCmd.input.queryString).toContain("stats count(*)");
    expect(startCmd.input.queryString).toContain("by @logStream");
  });

  it("returns mapped AggregateResult[] with service and count", async () => {
    setupAggMocks([
      [
        { field: "@logStream", value: "api-service" },
        { field: "errorCount", value: "42" },
      ],
      [
        { field: "@logStream", value: "worker" },
        { field: "errorCount", value: "7" },
      ],
    ]);

    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    const promise = provider.aggregate({
      timeRange: "1h",
      serviceFilter: "*",
    });

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ service: "api-service", count: 42 });
    expect(results[1]).toEqual({ service: "worker", count: 7 });
  });

  it("handles empty results", async () => {
    setupAggMocks([]);

    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    const promise = provider.aggregate({
      timeRange: "1h",
      serviceFilter: "*",
    });

    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseTimeRange (tested indirectly via queryLogs / aggregate time calculations)
// ---------------------------------------------------------------------------

describe("parseTimeRange (via queryLogs)", () => {
  beforeEach(() => {
    mockSend.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupMocks() {
    mockSend.mockResolvedValueOnce({ queryId: "q" }).mockResolvedValueOnce({ status: "Complete", results: [] });
  }

  it("parses '1h' as 3,600,000ms", async () => {
    setupMocks();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    const promise = provider.queryLogs({
      timeRange: "1h",
      serviceFilter: "*",
      severity: "error",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    const startCmd = mockSend.mock.calls[0][0];
    expect(startCmd.input.startTime).toBe(Math.floor((now - 3_600_000) / 1000));
  });

  it("parses '30m' as 1,800,000ms", async () => {
    setupMocks();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    const promise = provider.queryLogs({
      timeRange: "30m",
      serviceFilter: "*",
      severity: "error",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    const startCmd = mockSend.mock.calls[0][0];
    expect(startCmd.input.startTime).toBe(Math.floor((now - 1_800_000) / 1000));
  });

  it("parses '7d' as 604,800,000ms", async () => {
    setupMocks();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);

    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    const promise = provider.queryLogs({
      timeRange: "7d",
      serviceFilter: "*",
      severity: "error",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    const startCmd = mockSend.mock.calls[0][0];
    expect(startCmd.input.startTime).toBe(Math.floor((now - 604_800_000) / 1000));
  });

  it("throws on invalid time range format", async () => {
    const provider = cloudwatch({
      logGroupPrefix: "/ecs/app",
      logger: silentLogger,
    });

    await expect(
      provider.queryLogs({
        timeRange: "invalid",
        serviceFilter: "*",
        severity: "error",
      }),
    ).rejects.toThrow("Invalid time range: invalid");
  });
});
