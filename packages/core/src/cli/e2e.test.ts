import { describe, it, expect } from "vitest";
import { resolveTemplateVars, buildE2eVars, buildSetupNode, buildReportNode, buildCleanupNode } from "./e2e.js";

describe("resolveTemplateVars", () => {
  it("replaces known variables", () => {
    const result = resolveTemplateVars("Navigate to {base_url}/signup", {
      base_url: "http://localhost:3000",
    });
    expect(result).toBe("Navigate to http://localhost:3000/signup");
  });

  it("leaves unknown variables untouched", () => {
    const result = resolveTemplateVars("Hello {unknown}", {});
    expect(result).toBe("Hello {unknown}");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const result = resolveTemplateVars("{base_url} and {base_url}", {
      base_url: "http://localhost:3000",
    });
    expect(result).toBe("http://localhost:3000 and http://localhost:3000");
  });

  it("replaces multiple different variables", () => {
    const result = resolveTemplateVars("email: {test_email}, pw: {test_password}", {
      test_email: "e2e-123@app.test",
      test_password: "E2eTest!123",
    });
    expect(result).toBe("email: e2e-123@app.test, pw: E2eTest!123");
  });

  it("handles empty string input", () => {
    expect(resolveTemplateVars("", { foo: "bar" })).toBe("");
  });
});

describe("buildE2eVars", () => {
  it("auto-generates run_id when not in env", () => {
    const vars = buildE2eVars({});
    expect(vars.run_id).toMatch(/^\d+$/);
  });

  it("uses RUN_ID from env when provided", () => {
    const vars = buildE2eVars({ RUN_ID: "custom-42" });
    expect(vars.run_id).toBe("custom-42");
  });

  it("auto-generates test_email from run_id", () => {
    const vars = buildE2eVars({ RUN_ID: "12345" });
    expect(vars.test_email).toBe("e2e-12345@yourapp.test");
  });

  it("auto-generates test_password from run_id", () => {
    const vars = buildE2eVars({ RUN_ID: "12345" });
    expect(vars.test_password).toBe("E2eTest!12345");
  });

  it("reads base_url from E2E_BASE_URL", () => {
    const vars = buildE2eVars({ E2E_BASE_URL: "https://myapp.com" });
    expect(vars.base_url).toBe("https://myapp.com");
  });

  it("defaults base_url to http://localhost:3000", () => {
    const vars = buildE2eVars({});
    expect(vars.base_url).toBe("http://localhost:3000");
  });

  it("reads email/password from E2E_EMAIL and E2E_PASSWORD", () => {
    const vars = buildE2eVars({
      E2E_EMAIL: "test@example.com",
      E2E_PASSWORD: "secret",
    });
    expect(vars.email).toBe("test@example.com");
    expect(vars.password).toBe("secret");
  });

  it("falls back email/password to test_email/test_password when not in env", () => {
    const vars = buildE2eVars({ RUN_ID: "99" });
    expect(vars.email).toBe(vars.test_email);
    expect(vars.password).toBe(vars.test_password);
  });

  it("picks up E2E_* custom vars", () => {
    const vars = buildE2eVars({ E2E_API_KEY: "abc123" });
    expect(vars.api_key).toBe("abc123");
  });
});

describe("buildSetupNode", () => {
  it("returns a node with agent-browser install instructions", () => {
    const node = buildSetupNode();
    expect(node.name).toBe("Browser Setup");
    expect(node.instruction).toContain("agent-browser");
    expect(node.instruction).toContain("npm install -g");
    expect(node.skills).toEqual([]);
    expect(node.output).toBeDefined();
  });

  it("includes daemon startup and readiness polling", () => {
    const node = buildSetupNode();
    expect(node.instruction).toContain("agent-browser &");
    expect(node.instruction).toContain("agent-browser get url");
  });

  it("output schema has status enum [ready, fail]", () => {
    const node = buildSetupNode();
    expect(node.output).toEqual({
      type: "object",
      properties: {
        status: { type: "string", enum: ["ready", "fail"] },
      },
      required: ["status"],
    });
  });
});

describe("buildReportNode", () => {
  it("references the test node IDs in its instruction", () => {
    const node = buildReportNode(["test_registration", "test_login"]);
    expect(node.instruction).toContain("test_registration");
    expect(node.instruction).toContain("test_login");
  });

  it("output schema has total, passed, failed, summary", () => {
    const node = buildReportNode(["test_x"]);
    expect(node.output).toEqual({
      type: "object",
      properties: {
        total: { type: "number" },
        passed: { type: "number" },
        failed: { type: "number" },
        summary: { type: "string" },
      },
      required: ["total", "passed", "failed", "summary"],
    });
  });
});

describe("buildCleanupNode", () => {
  it("includes supabase-specific instructions for supabase backend", () => {
    const node = buildCleanupNode("supabase");
    expect(node.instruction).toContain("Supabase");
    expect(node.instruction).toContain("e2e-");
    expect(node.instruction).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("includes firebase-specific instructions for firebase backend", () => {
    const node = buildCleanupNode("firebase");
    expect(node.instruction).toContain("Firebase");
  });

  it("includes generic instructions for other backends", () => {
    const node = buildCleanupNode("other");
    expect(node.instruction).toContain("e2e-{run_id}");
  });

  it("has no output schema", () => {
    const node = buildCleanupNode("supabase");
    expect(node.output).toBeUndefined();
  });
});
