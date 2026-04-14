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
