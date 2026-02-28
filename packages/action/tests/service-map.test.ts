import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseServiceMap, findRepoForService } from "../src/utils/service-map.js";

vi.mock("@actions/core", () => ({
  warning: vi.fn(),
}));

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "service-map-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("parseServiceMap", () => {
  it("returns empty services for non-existent file", () => {
    const result = parseServiceMap(path.join(tmpDir, "nope.yml"));
    expect(result.services).toEqual([]);
  });

  it("parses a valid service map", () => {
    const filePath = path.join(tmpDir, "map.yml");
    fs.writeFileSync(
      filePath,
      `services:
  api-gateway:
    repo: "org/api-gateway"
    owns:
      - api-gateway
      - api-gateway-staging
  worker:
    repo: "org/worker"
    owns:
      - worker-prod
      - worker-staging
`,
    );

    const result = parseServiceMap(filePath);
    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe("api-gateway");
    expect(result.services[0].repo).toBe("org/api-gateway");
    expect(result.services[0].owns).toEqual(["api-gateway", "api-gateway-staging"]);
    expect(result.services[1].name).toBe("worker");
    expect(result.services[1].repo).toBe("org/worker");
    expect(result.services[1].owns).toEqual(["worker-prod", "worker-staging"]);
  });

  it("handles empty file", () => {
    const filePath = path.join(tmpDir, "empty.yml");
    fs.writeFileSync(filePath, "");

    const result = parseServiceMap(filePath);
    expect(result.services).toEqual([]);
  });

  it("handles comments and blank lines", () => {
    const filePath = path.join(tmpDir, "comments.yml");
    fs.writeFileSync(
      filePath,
      `# Service ownership map
services:
  # API services
  api:
    repo: "org/api"
    owns:
      - api-prod
`,
    );

    const result = parseServiceMap(filePath);
    expect(result.services).toHaveLength(1);
    expect(result.services[0].name).toBe("api");
    expect(result.services[0].repo).toBe("org/api");
    expect(result.services[0].owns).toEqual(["api-prod"]);
  });

  it("handles service with no owns list", () => {
    const filePath = path.join(tmpDir, "no-owns.yml");
    fs.writeFileSync(
      filePath,
      `services:
  api:
    repo: "org/api"
  worker:
    repo: "org/worker"
    owns:
      - worker-prod
`,
    );

    const result = parseServiceMap(filePath);
    expect(result.services).toHaveLength(2);
    expect(result.services[0].owns).toEqual([]);
    expect(result.services[1].owns).toEqual(["worker-prod"]);
  });
});

describe("findRepoForService", () => {
  const serviceMap = {
    services: [
      { name: "api", repo: "org/api", owns: ["api-prod", "api-staging"] },
      { name: "worker", repo: "org/worker", owns: ["worker-prod"] },
    ],
  };

  it("finds the correct repo for a matching service", () => {
    expect(findRepoForService(serviceMap, "api-prod")).toBe("org/api");
    expect(findRepoForService(serviceMap, "api-staging")).toBe("org/api");
    expect(findRepoForService(serviceMap, "worker-prod")).toBe("org/worker");
  });

  it("returns null for unknown service", () => {
    expect(findRepoForService(serviceMap, "unknown-service")).toBeNull();
  });

  it("returns null for empty service map", () => {
    expect(findRepoForService({ services: [] }, "api-prod")).toBeNull();
  });
});
