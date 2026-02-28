import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock express to avoid real HTTP server
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
const mockListen = vi.fn((_port: number, cb?: () => void) => cb?.());

vi.mock("express", () => ({
  default: () => ({
    get: mockGet,
    listen: mockListen,
  }),
}));

import { startHealthServer } from "../src/health.js";

describe("startHealthServer", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("registers GET /health route", () => {
    startHealthServer();

    expect(mockGet).toHaveBeenCalledWith("/health", expect.any(Function));
  });

  it("listens on default port 3000", () => {
    startHealthServer();

    expect(mockListen).toHaveBeenCalledWith(3000, expect.any(Function));
  });

  it("listens on custom port when provided", () => {
    startHealthServer(8080);

    expect(mockListen).toHaveBeenCalledWith(8080, expect.any(Function));
  });

  it("health handler returns status ok with uptime", () => {
    startHealthServer();

    // Extract the handler registered with app.get("/health", handler)
    const handler = mockGet.mock.calls[0][1];
    const mockRes = { json: vi.fn() };

    handler({}, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith({
      status: "ok",
      uptime: expect.any(Number),
    });
  });
});
