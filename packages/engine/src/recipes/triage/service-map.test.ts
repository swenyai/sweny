import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseServiceMap } from "./service-map.js";

describe("parseServiceMap", () => {
  const tmpFiles: string[] = [];

  function writeTmp(content: string): string {
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, `service-map-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
    fs.writeFileSync(filePath, content);
    tmpFiles.push(filePath);
    return filePath;
  }

  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    tmpFiles.length = 0;
  });

  it("returns empty for non-existent file", () => {
    const result = parseServiceMap("/tmp/does-not-exist-service-map-12345.yml");
    expect(result).toEqual({ services: [] });
  });

  it("parses valid service map with multiple services", () => {
    const content = `services:
  api-gateway:
    repo: "org/api-gateway"
    owns:
      - src/gateway/
      - src/routes/
  auth-service:
    repo: "org/auth-service"
    owns:
      - src/auth/
`;
    const filePath = writeTmp(content);
    const result = parseServiceMap(filePath);
    expect(result.services).toHaveLength(2);
    expect(result.services[0]).toEqual({
      name: "api-gateway",
      repo: "org/api-gateway",
      owns: ["src/gateway/", "src/routes/"],
    });
    expect(result.services[1]).toEqual({
      name: "auth-service",
      repo: "org/auth-service",
      owns: ["src/auth/"],
    });
  });

  it("handles empty file", () => {
    const filePath = writeTmp("");
    const result = parseServiceMap(filePath);
    expect(result).toEqual({ services: [] });
  });

  it("handles comments and blank lines", () => {
    const content = `# This is a service map
services:

  # API service
  api:
    repo: "org/api"
    owns:
      - src/api/

  # Worker service
  worker:
    repo: "org/worker"
    owns:
      - src/worker/
`;
    const filePath = writeTmp(content);
    const result = parseServiceMap(filePath);
    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe("api");
    expect(result.services[1].name).toBe("worker");
  });

  it("handles service with no owns list", () => {
    const content = `services:
  standalone:
    repo: "org/standalone"
`;
    const filePath = writeTmp(content);
    const result = parseServiceMap(filePath);
    expect(result.services).toHaveLength(1);
    expect(result.services[0]).toEqual({
      name: "standalone",
      repo: "org/standalone",
      owns: [],
    });
  });
});
