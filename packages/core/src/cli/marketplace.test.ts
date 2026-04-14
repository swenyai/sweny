import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchMarketplaceWorkflow, MARKETPLACE_RAW_BASE } from "./marketplace.js";

describe("fetchMarketplaceWorkflow", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("id: pr-review\nname: PR Review\n", { status: 200 });
    });
  });
  afterEach(() => fetchSpy.mockRestore());

  it("fetches workflow YAML from raw GitHub", async () => {
    const result = await fetchMarketplaceWorkflow("pr-review");
    expect(result.id).toBe("pr-review");
    expect(result.yaml).toContain("id: pr-review");
    expect(fetchSpy).toHaveBeenCalledWith(`${MARKETPLACE_RAW_BASE}/workflows/pr-review.yml`);
  });
});

describe("fetchMarketplaceWorkflow errors", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => fetchSpy?.mockRestore());

  it("throws not-found on 404", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 404 }));
    await expect(fetchMarketplaceWorkflow("missing")).rejects.toMatchObject({
      kind: "not-found",
      message: expect.stringContaining("missing"),
    });
  });

  it("throws rate-limit on 403 with X-RateLimit-Remaining: 0", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("", {
          status: 403,
          headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1234567890" },
        }),
    );
    await expect(fetchMarketplaceWorkflow("pr-review")).rejects.toMatchObject({
      kind: "rate-limit",
      retryAfter: 1234567890,
    });
  });

  it("throws network error when fetch rejects", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchMarketplaceWorkflow("pr-review")).rejects.toMatchObject({
      kind: "network",
    });
  });
});
