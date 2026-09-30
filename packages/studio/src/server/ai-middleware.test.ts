import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import type { Connect } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiMiddlewarePlugin } from "./ai-middleware.js";

const agent = vi.hoisted(() => ({
  createHarness: vi.fn(),
  run: vi.fn(async () => ({ data: { summary: "Generated instruction" } })),
  buildWorkflow: vi.fn(async () => ({ name: "Generated" })),
  refineWorkflow: vi.fn(async () => ({ name: "Refined" })),
}));
vi.mock("@sweny-ai/core", () => ({
  createHarness: agent.createHarness.mockImplementation(() => ({ run: agent.run })),
  buildWorkflow: agent.buildWorkflow,
  refineWorkflow: agent.refineWorkflow,
  builtinSkills: [],
}));

let server: Server;
let origin: string;

beforeEach(async () => {
  vi.clearAllMocks();
  const handlers: Connect.NextHandleFunction[] = [];
  aiMiddlewarePlugin().configureServer({
    middlewares: { use: (handler: Connect.NextHandleFunction) => handlers.push(handler) } as unknown as Connect.Server,
  });
  server = createServer((req, res) => {
    handlers[0](req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "::", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

function send(path: string, headers: Record<string, string> = {}, body = "{}", method = "POST", target = origin) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = request(`${target}${path}`, { method, headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode!, body: data, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body);
  });
}
async function session() {
  const response = await send("/api/ai-session", { Origin: origin, "Content-Type": "application/json" });
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  return JSON.parse(response.body).token as string;
}
function expectNoAgentCalls() {
  expect(agent.createHarness).not.toHaveBeenCalled();
  expect(agent.run).not.toHaveBeenCalled();
  expect(agent.buildWorkflow).not.toHaveBeenCalled();
  expect(agent.refineWorkflow).not.toHaveBeenCalled();
}

const routes = [
  ["/api/generate-workflow", { description: "Build a workflow" }, { workflow: { name: "Generated" } }],
  [
    "/api/refine-workflow",
    { workflow: { name: "Original" }, instruction: "Refine it" },
    { workflow: { name: "Refined" } },
  ],
  [
    "/api/generate-instruction",
    { nodeName: "Node", nodeId: "node", skills: [], workflowContext: { workflowName: "Workflow" } },
    { instruction: "Generated instruction" },
  ],
] as const;

describe.each(routes)("%s", (path, body, expected) => {
  it.each([undefined, "null", "https://attacker.example", "http://localhost:9999"])(
    "rejects a simple cross-origin POST from %s without touching the agent",
    async (requestOrigin) => {
      const response = await send(
        path,
        {
          ...(requestOrigin ? { Origin: requestOrigin } : {}),
          "Content-Type": "text/plain",
        },
        JSON.stringify(body),
      );
      expect(response.status).toBe(403);
      expectNoAgentCalls();
    },
  );
  it("rejects a cross-origin JSON POST even with a valid token", async () => {
    const token = await session();
    const response = await send(
      path,
      { Origin: "https://attacker.example", "Content-Type": "application/json", "X-Sweny-Dev-Token": token },
      JSON.stringify(body),
    );
    expect(response.status).toBe(403);
    expectNoAgentCalls();
  });
  it.each([undefined, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonp"])(
    "rejects content type %s",
    async (contentType) => {
      const token = await session();
      const response = await send(
        path,
        { Origin: origin, ...(contentType ? { "Content-Type": contentType } : {}), "X-Sweny-Dev-Token": token },
        JSON.stringify(body),
      );
      expect(response.status).toBe(415);
      expectNoAgentCalls();
    },
  );
  it.each([undefined, "invalid", "0".repeat(64)])("rejects token %s", async (token) => {
    const response = await send(
      path,
      { Origin: origin, "Content-Type": "application/json", ...(token ? { "X-Sweny-Dev-Token": token } : {}) },
      JSON.stringify(body),
    );
    expect(response.status).toBe(403);
    expectNoAgentCalls();
  });
  it("accepts the legitimate same-origin JSON request", async () => {
    const token = await session();
    const response = await send(
      path,
      {
        Origin: origin,
        "Content-Type": "application/json; charset=utf-8",
        "Sec-Fetch-Site": "same-origin",
        "X-Sweny-Dev-Token": token,
      },
      JSON.stringify(body),
    );
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual(expected);
  });
});

describe("development session", () => {
  it.each([undefined, "null", "https://attacker.example", "http://localhost:9999"])(
    "rejects bootstrap origin %s",
    async (requestOrigin) => {
      const response = await send("/api/ai-session", {
        ...(requestOrigin ? { Origin: requestOrigin } : {}),
        "Content-Type": "application/json",
      });
      expect(response.status).toBe(403);
      expect(response.body).not.toContain("token");
      expectNoAgentCalls();
    },
  );
  it("rejects a simple bootstrap request", async () => {
    expect((await send("/api/ai-session", { Origin: origin, "Content-Type": "text/plain" })).status).toBe(415);
  });
  it("does not expose a token to GET requests", async () => {
    expect((await send("/api/ai-session", {}, "", "GET")).status).toBe(404);
  });
  it("rejects DNS rebinding hosts and cross-site fetch metadata", async () => {
    expect(
      (
        await send("/api/ai-session", {
          Host: "attacker.example",
          Origin: "http://attacker.example",
          "Content-Type": "application/json",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send("/api/ai-session", {
          Origin: origin,
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "cross-site",
        })
      ).status,
    ).toBe(403);
  });
});

describe("transport peer boundary", () => {
  it("rejects non-loopback peers spoofing local headers on bootstrap and every AI route", async () => {
    const remoteAddress = Object.values(networkInterfaces())
      .flat()
      .find((address) => address?.family === "IPv4" && !address.internal)?.address;
    expect(remoteAddress, "CI must have a non-loopback IPv4 interface for this HTTP regression").toBeDefined();
    const target = `http://${remoteAddress}:${(server.address() as AddressInfo).port}`;
    const token = await session();
    const headers = {
      Host: new URL(origin).host,
      Origin: origin,
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
      "X-Sweny-Dev-Token": token,
      "X-Forwarded-For": "127.0.0.1",
    };
    expect((await send("/api/ai-session", headers, "{}", "POST", target)).status).toBe(403);
    for (const [path, body] of routes) {
      expect((await send(path, headers, JSON.stringify(body), "POST", target)).status).toBe(403);
    }
    expectNoAgentCalls();
  });
  it("accepts native IPv6 loopback peers", async () => {
    const target = `http://[::1]:${(server.address() as AddressInfo).port}`;
    const headers = { Origin: target, "Content-Type": "application/json" };
    const response = await send("/api/ai-session", headers, "{}", "POST", target);
    expect(response.status).toBe(200);
    const { token } = JSON.parse(response.body);
    expect(
      (
        await send(
          routes[0][0],
          { ...headers, "X-Sweny-Dev-Token": token },
          JSON.stringify(routes[0][1]),
          "POST",
          target,
        )
      ).status,
    ).toBe(200);
  });
});
