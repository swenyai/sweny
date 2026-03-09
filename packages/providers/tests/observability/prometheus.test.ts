import { describe, it, expect, vi, afterEach } from "vitest";
import { prometheus, prometheusConfigSchema } from "../../src/observability/prometheus.js";
import type { ObservabilityProvider } from "../../src/observability/types.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("prometheusConfigSchema", () => {
  it("validates a minimal config with only url", () => {
    const result = prometheusConfigSchema.safeParse({ url: "http://localhost:9090" });
    expect(result.success).toBe(true);
  });

  it("validates a full config with token", () => {
    const result = prometheusConfigSchema.safeParse({
      url: "https://prometheus.example.com",
      token: "my-bearer-token",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing url", () => {
    const result = prometheusConfigSchema.safeParse({ token: "tok" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid url", () => {
    const result = prometheusConfigSchema.safeParse({ url: "not-a-url" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe("prometheus factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider: ObservabilityProvider = prometheus({
      url: "http://localhost:9090",
      logger: silentLogger,
    });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns PROMETHEUS_URL without token", () => {
    const provider = prometheus({ url: "http://localhost:9090", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({ PROMETHEUS_URL: "http://localhost:9090" });
  });

  it("getAgentEnv includes PROMETHEUS_TOKEN when token is set", () => {
    const provider = prometheus({ url: "http://localhost:9090", token: "my-token", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({
      PROMETHEUS_URL: "http://localhost:9090",
      PROMETHEUS_TOKEN: "my-token",
    });
  });

  it("getPromptInstructions returns non-empty string containing Prometheus", () => {
    const provider = prometheus({ url: "http://localhost:9090", logger: silentLogger });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toBeTruthy();
    expect(instructions).toContain("Prometheus");
    expect(instructions).toContain("PROMETHEUS_URL");
    expect(instructions).toContain("curl");
  });

  it("getPromptInstructions includes auth header example when token is set", () => {
    const provider = prometheus({ url: "http://localhost:9090", token: "tok", logger: silentLogger });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("PROMETHEUS_TOKEN");
    expect(instructions).toContain("Authorization");
    expect(instructions).toContain("Bearer");
  });

  it("throws on invalid config", () => {
    expect(() => prometheus({ url: "not-valid" } as any)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// PrometheusProvider API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("PrometheusProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makePrometheus(extra?: { token?: string }) {
    return prometheus({ url: "http://localhost:9090", logger: silentLogger, ...extra });
  }

  const firingAlert = {
    labels: { alertname: "HighCPU", severity: "warning", service: "api", job: "api-job" },
    annotations: { summary: "CPU usage is high" },
    state: "firing",
    activeAt: "2024-01-01T00:00:00.000Z",
  };

  // -------------------------------------------------------------------------
  // verifyAccess
  // -------------------------------------------------------------------------

  it("verifyAccess resolves when buildinfo endpoint returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ status: "success", data: { version: "2.40.0" } }), { status: 200 });
    });

    await expect(makePrometheus().verifyAccess()).resolves.toBeUndefined();
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/api/v1/status/buildinfo");
  });

  it("verifyAccess throws ProviderApiError when fetch returns non-200", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
    });

    await expect(makePrometheus().verifyAccess()).rejects.toThrow();
  });

  it("verifyAccess sets Authorization header when token is configured", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ status: "success", data: {} }), { status: 200 });
    });

    await makePrometheus({ token: "secret-token" }).verifyAccess();

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((opts as RequestInit).headers).toMatchObject({
      Authorization: "Bearer secret-token",
    });
  });

  // -------------------------------------------------------------------------
  // queryLogs
  // -------------------------------------------------------------------------

  it("queryLogs maps firing alerts to LogEntry[]", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ data: { alerts: [firingAlert] } }),
        { status: 200 },
      );
    });

    const logs = await makePrometheus().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs).toHaveLength(1);
    expect(logs[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
    expect(logs[0].service).toBe("api");
    expect(logs[0].level).toBe("warning");
    expect(logs[0].message).toBe("CPU usage is high");
    expect(logs[0].attributes).toMatchObject({ alertname: "HighCPU", state: "firing" });
  });

  it("queryLogs filters by severity label when severity is not '*'", async () => {
    const criticalAlert = {
      ...firingAlert,
      labels: { ...firingAlert.labels, severity: "critical", alertname: "DiskFull" },
      annotations: { summary: "Disk is full" },
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ data: { alerts: [firingAlert, criticalAlert] } }),
        { status: 200 },
      );
    });

    const logs = await makePrometheus().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "critical" });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe("critical");
  });

  it("queryLogs filters by service label when serviceFilter is not '*'", async () => {
    const workerAlert = {
      ...firingAlert,
      labels: { ...firingAlert.labels, service: "worker", job: "worker-job", alertname: "WorkerDown" },
      annotations: { summary: "Worker is down" },
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ data: { alerts: [firingAlert, workerAlert] } }),
        { status: 200 },
      );
    });

    const logs = await makePrometheus().queryLogs({ timeRange: "1h", serviceFilter: "worker", severity: "*" });

    expect(logs).toHaveLength(1);
    expect(logs[0].service).toBe("worker");
  });

  it("queryLogs filters by job label when serviceFilter matches job", async () => {
    const alertWithJob = {
      labels: { alertname: "SlowQuery", severity: "warning", job: "database" },
      annotations: { summary: "Slow query detected" },
      state: "firing",
      activeAt: "2024-01-01T00:00:00.000Z",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ data: { alerts: [firingAlert, alertWithJob] } }),
        { status: 200 },
      );
    });

    const logs = await makePrometheus().queryLogs({ timeRange: "1h", serviceFilter: "database", severity: "*" });

    expect(logs).toHaveLength(1);
    expect(logs[0].service).toBe("database");
  });

  it("queryLogs returns empty array when no alerts match", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ data: { alerts: [firingAlert] } }), { status: 200 });
    });

    const logs = await makePrometheus().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "critical" });
    expect(logs).toEqual([]);
  });

  it("queryLogs falls back to job for service when service label is absent", async () => {
    const alertNoService = {
      labels: { alertname: "HighMem", severity: "warning", job: "memcached" },
      annotations: { summary: "High memory" },
      state: "firing",
      activeAt: "2024-01-01T00:00:00.000Z",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ data: { alerts: [alertNoService] } }),
        { status: 200 },
      );
    });

    const logs = await makePrometheus().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });
    expect(logs[0].service).toBe("memcached");
  });

  it("queryLogs falls back to 'unknown' service when no service or job label", async () => {
    const alertNoLabels = {
      labels: { alertname: "Something" },
      annotations: {},
      state: "firing",
      activeAt: "2024-01-01T00:00:00.000Z",
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ data: { alerts: [alertNoLabels] } }),
        { status: 200 },
      );
    });

    const logs = await makePrometheus().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });
    expect(logs[0].service).toBe("unknown");
  });

  // -------------------------------------------------------------------------
  // aggregate
  // -------------------------------------------------------------------------

  it("aggregate groups alerts by service and returns counts", async () => {
    const alert2 = { ...firingAlert };
    const alert3 = {
      ...firingAlert,
      labels: { ...firingAlert.labels, service: "worker", alertname: "WorkerDown" },
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ data: { alerts: [firingAlert, alert2, alert3] } }),
        { status: 200 },
      );
    });

    const results = await makePrometheus().aggregate({ timeRange: "1h", serviceFilter: "*" });

    expect(results).toHaveLength(2);
    const apiGroup = results.find((r) => r.service === "api");
    const workerGroup = results.find((r) => r.service === "worker");
    expect(apiGroup?.count).toBe(2);
    expect(workerGroup?.count).toBe(1);
  });

  it("aggregate returns empty array when no alerts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ data: { alerts: [] } }), { status: 200 });
    });

    const results = await makePrometheus().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });

  it("aggregate filters by serviceFilter when not '*'", async () => {
    const workerAlert = {
      ...firingAlert,
      labels: { ...firingAlert.labels, service: "worker", alertname: "WorkerDown" },
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({ data: { alerts: [firingAlert, workerAlert] } }),
        { status: 200 },
      );
    });

    const results = await makePrometheus().aggregate({ timeRange: "1h", serviceFilter: "api" });
    expect(results).toHaveLength(1);
    expect(results[0].service).toBe("api");
    expect(results[0].count).toBe(1);
  });

  // -------------------------------------------------------------------------
  // getAgentEnv
  // -------------------------------------------------------------------------

  it("getAgentEnv returns PROMETHEUS_URL without token", () => {
    const env = makePrometheus().getAgentEnv();
    expect(env).toEqual({ PROMETHEUS_URL: "http://localhost:9090" });
    expect(env.PROMETHEUS_TOKEN).toBeUndefined();
  });

  it("getAgentEnv returns PROMETHEUS_URL and PROMETHEUS_TOKEN when token set", () => {
    const env = makePrometheus({ token: "tok" }).getAgentEnv();
    expect(env.PROMETHEUS_URL).toBe("http://localhost:9090");
    expect(env.PROMETHEUS_TOKEN).toBe("tok");
  });

  // -------------------------------------------------------------------------
  // getPromptInstructions
  // -------------------------------------------------------------------------

  it("getPromptInstructions returns non-empty string containing 'Prometheus'", () => {
    const instructions = makePrometheus().getPromptInstructions();
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions).toContain("Prometheus");
  });

  it("getPromptInstructions does not include auth header when no token", () => {
    const instructions = makePrometheus().getPromptInstructions();
    expect(instructions).not.toContain("PROMETHEUS_TOKEN");
  });

  it("getPromptInstructions includes auth header when token is set", () => {
    const instructions = makePrometheus({ token: "tok" }).getPromptInstructions();
    expect(instructions).toContain("PROMETHEUS_TOKEN");
    expect(instructions).toContain("Authorization");
  });
});
