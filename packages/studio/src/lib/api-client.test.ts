import { afterEach, expect, it, vi } from "vitest";
import { post } from "./api-client.js";

afterEach(() => vi.unstubAllGlobals());

it("obtains a JSON POST session and attaches its token to the AI request", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ token: "session-token" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ instruction: "Generated" })));
  vi.stubGlobal("fetch", fetch);
  expect(await post("/api/generate-instruction", { nodeId: "node" })).toEqual({ instruction: "Generated" });
  expect(fetch).toHaveBeenNthCalledWith(1, "/api/ai-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  expect(fetch).toHaveBeenNthCalledWith(2, "/api/generate-instruction", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Sweny-Dev-Token": "session-token" },
    body: JSON.stringify({ nodeId: "node" }),
  });
});
it("does not invoke an AI route when session bootstrap fails", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden origin" }), { status: 403 }));
  vi.stubGlobal("fetch", fetch);
  await expect(post("/api/generate-workflow", {})).rejects.toThrow("Forbidden origin");
  expect(fetch).toHaveBeenCalledTimes(1);
});
