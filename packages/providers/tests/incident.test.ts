import { describe, it, expect, vi, afterEach } from "vitest";
import { pagerduty, pagerdutyConfigSchema } from "../src/incident/pagerduty.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("pagerdutyConfigSchema", () => {
  it("validates a valid config", () => {
    const result = pagerdutyConfigSchema.safeParse({
      apiToken: "tok",
      routingKey: "rk",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing routingKey", () => {
    expect(pagerdutyConfigSchema.safeParse({ apiToken: "tok" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PagerDuty provider
// ---------------------------------------------------------------------------

describe("PagerDutyProvider", () => {
  it("verifyAccess calls /abilities", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ abilities: [] }),
    });
    globalThis.fetch = mockFetch;

    const provider = pagerduty({
      apiToken: "tok",
      routingKey: "rk",
      logger: silentLogger,
    });
    await provider.verifyAccess();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.pagerduty.com/abilities");
    expect(opts.headers.Authorization).toBe("Token token=tok");
  });

  it("createIncident posts to Events API v2", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dedup_key: "dk123", status: "success" }),
    });
    globalThis.fetch = mockFetch;

    const provider = pagerduty({
      apiToken: "tok",
      routingKey: "rk",
      logger: silentLogger,
    });

    const incident = await provider.createIncident({
      title: "Server down",
      urgency: "high",
    });

    expect(incident.id).toBe("dk123");
    expect(incident.status).toBe("triggered");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://events.pagerduty.com/v2/enqueue");
    const body = JSON.parse(opts.body);
    expect(body.routing_key).toBe("rk");
    expect(body.event_action).toBe("trigger");
    expect(body.payload.summary).toBe("Server down");
    expect(body.payload.severity).toBe("critical");
  });

  it("createIncident uses warning severity for low urgency", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ dedup_key: "dk", status: "success" }),
    });
    globalThis.fetch = mockFetch;

    const provider = pagerduty({
      apiToken: "tok",
      routingKey: "rk",
      logger: silentLogger,
    });

    await provider.createIncident({ title: "Slow queries", urgency: "low" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.payload.severity).toBe("warning");
  });

  it("acknowledgeIncident sends acknowledge event", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = mockFetch;

    const provider = pagerduty({
      apiToken: "tok",
      routingKey: "rk",
      logger: silentLogger,
    });

    await provider.acknowledgeIncident("dk123");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event_action).toBe("acknowledge");
    expect(body.dedup_key).toBe("dk123");
  });

  it("resolveIncident sends resolve event", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = mockFetch;

    const provider = pagerduty({
      apiToken: "tok",
      routingKey: "rk",
      logger: silentLogger,
    });

    await provider.resolveIncident("dk123", "Fixed the thing");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event_action).toBe("resolve");
    expect(body.dedup_key).toBe("dk123");
    expect(body.payload.summary).toBe("Fixed the thing");
  });
});
