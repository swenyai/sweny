import { describe, it, expect, vi, beforeEach } from "vitest";
import { stringify as stringifyYaml, parse as parseYaml } from "yaml";
import {
  resolveTemplateVars,
  buildE2eVars,
  buildSetupNode,
  buildReportNode,
  buildCleanupNode,
  buildFlowNodes,
  buildFlowWorkflow,
  buildE2eEnvTemplate,
} from "./e2e.js";
import type { FlowConfig, FlowType, E2eSelections } from "./e2e.js";
import type { Workflow } from "../types.js";
import { workflowZ, validateWorkflow } from "../schema.js";

// ── Clack mock for runE2eInit tests ────────────────────────────────────
// Hoisted spies so `vi.mock` (also hoisted) can reference them.
const { introSpy, logStepSpy } = vi.hoisted(() => ({
  introSpy: vi.fn(),
  logStepSpy: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  intro: (...args: unknown[]) => introSpy(...args),
  outro: vi.fn(),
  cancel: vi.fn(),
  log: {
    step: (...args: unknown[]) => logStepSpy(...args),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    message: vi.fn(),
  },
  // Abort the wizard right after the intro/step decision so we can assert on spies.
  multiselect: vi.fn(async () => {
    throw new Error("__abort_test__");
  }),
  select: vi.fn(),
  confirm: vi.fn(),
  text: vi.fn(),
  isCancel: vi.fn(() => false),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
}));

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

describe("buildFlowNodes", () => {
  describe("registration", () => {
    it("returns a test_registration node", () => {
      const { nodes, testNodeIds } = buildFlowNodes({
        type: "registration",
        path: "/signup",
        fields: ["email", "password", "name"],
        successRedirect: "/dashboard",
      });
      expect(nodes.test_registration).toBeDefined();
      expect(nodes.test_registration.instruction).toContain("/signup");
      expect(nodes.test_registration.instruction).toContain("{test_email}");
      expect(nodes.test_registration.instruction).toContain("{test_password}");
      expect(nodes.test_registration.instruction).toContain("agent-browser");
      expect(testNodeIds).toEqual(["test_registration"]);
    });

    it("does not include a login node", () => {
      const { nodes } = buildFlowNodes({ type: "registration", path: "/signup" });
      expect(nodes.login).toBeUndefined();
    });

    it("includes field names in instruction", () => {
      const { nodes } = buildFlowNodes({
        type: "registration",
        path: "/signup",
        fields: ["email", "password", "name", "company"],
      });
      expect(nodes.test_registration.instruction).toContain("company");
    });
  });

  describe("login", () => {
    it("returns a test_login node", () => {
      const { nodes, testNodeIds } = buildFlowNodes({ type: "login", path: "/login" });
      expect(nodes.test_login).toBeDefined();
      expect(nodes.test_login.instruction).toContain("/login");
      expect(nodes.test_login.instruction).toContain("{email}");
      expect(nodes.test_login.instruction).toContain("{password}");
      expect(testNodeIds).toEqual(["test_login"]);
    });
  });

  describe("purchase (auth-dependent)", () => {
    it("returns both login and test_purchase nodes", () => {
      const { nodes, testNodeIds } = buildFlowNodes({
        type: "purchase",
        path: "/pricing",
        paymentProvider: "Stripe",
      });
      expect(nodes.login).toBeDefined();
      expect(nodes.test_purchase).toBeDefined();
      expect(nodes.login.instruction).toContain("{email}");
      expect(nodes.test_purchase.instruction).toContain("/pricing");
      expect(nodes.test_purchase.instruction).toContain("Stripe");
      expect(testNodeIds).toEqual(["login", "test_purchase"]);
    });
  });

  describe("custom", () => {
    it("embeds the user description in the instruction", () => {
      const { nodes } = buildFlowNodes({
        type: "custom",
        path: "/admin",
        description: "Test the admin dashboard data export feature",
        successCriteria: "CSV file downloads successfully",
      });
      expect(nodes.test_custom).toBeDefined();
      expect(nodes.test_custom.instruction).toContain("Test the admin dashboard data export feature");
      expect(nodes.test_custom.instruction).toContain("CSV file downloads successfully");
    });
  });

  describe("all flow types return valid nodes", () => {
    const flows: FlowConfig[] = [
      { type: "registration", path: "/signup" },
      { type: "login", path: "/login" },
      { type: "purchase", path: "/pricing" },
      { type: "onboarding", path: "/onboarding" },
      { type: "upgrade", path: "/upgrade" },
      { type: "cancellation", path: "/cancel" },
      { type: "custom", path: "/test", description: "custom test" },
    ];

    for (const flow of flows) {
      it(`${flow.type}: every node has non-empty name, instruction, and skills array`, () => {
        const { nodes } = buildFlowNodes(flow);
        for (const [id, node] of Object.entries(nodes)) {
          expect(node.name, `${id}.name`).toBeTruthy();
          expect(node.instruction.length, `${id}.instruction`).toBeGreaterThan(0);
          expect(Array.isArray(node.skills), `${id}.skills`).toBe(true);
        }
      });
    }
  });

  describe("auth-dependent flows include login node", () => {
    const authFlows: FlowType[] = ["purchase", "onboarding", "upgrade", "cancellation"];
    for (const type of authFlows) {
      it(`${type} includes a login node`, () => {
        const { nodes } = buildFlowNodes({ type, path: "/test" });
        expect(nodes.login).toBeDefined();
        expect(nodes.login.instruction).toContain("{email}");
      });
    }
  });
});

describe("buildFlowWorkflow", () => {
  it("returns a valid Workflow object for registration", () => {
    const wf = buildFlowWorkflow({ type: "registration", path: "/signup" }, "http://localhost:3000");
    expect(wf.id).toBe("e2e-registration");
    expect(wf.entry).toBe("setup");
    expect(wf.nodes.setup).toBeDefined();
    expect(wf.nodes.test_registration).toBeDefined();
    expect(wf.nodes.report).toBeDefined();
  });

  it("passes Zod schema validation", () => {
    const wf = buildFlowWorkflow({ type: "registration", path: "/signup" }, "http://localhost:3000");
    expect(() => workflowZ.parse(wf)).not.toThrow();
  });

  it("passes structural validation (no cycles, all reachable)", () => {
    const wf = buildFlowWorkflow({ type: "registration", path: "/signup" }, "http://localhost:3000");
    const errors = validateWorkflow(wf);
    expect(errors).toEqual([]);
  });

  it("includes login node for auth-dependent flows", () => {
    const wf = buildFlowWorkflow({ type: "purchase", path: "/pricing" }, "http://localhost:3000");
    expect(wf.nodes.login).toBeDefined();
    expect(wf.edges.some((e) => e.from === "setup" && e.to === "login")).toBe(true);
    expect(wf.edges.some((e) => e.from === "login" && e.to === "test_purchase")).toBe(true);
  });

  it("adds cleanup node when enabled", () => {
    const wf = buildFlowWorkflow({ type: "registration", path: "/signup" }, "http://localhost:3000", {
      enabled: true,
      backend: "supabase",
    });
    expect(wf.nodes.cleanup).toBeDefined();
    expect(wf.edges.some((e) => e.to === "cleanup")).toBe(true);
    expect(wf.edges.some((e) => e.from === "cleanup" && e.to === "report")).toBe(true);
  });

  it("skips cleanup node when not enabled", () => {
    const wf = buildFlowWorkflow({ type: "registration", path: "/signup" }, "http://localhost:3000", {
      enabled: false,
    });
    expect(wf.nodes.cleanup).toBeUndefined();
  });

  it("all 7 flow types produce valid workflows", () => {
    const types: Array<{ type: FlowType; path: string }> = [
      { type: "registration", path: "/signup" },
      { type: "login", path: "/login" },
      { type: "purchase", path: "/pricing" },
      { type: "onboarding", path: "/onboarding" },
      { type: "upgrade", path: "/upgrade" },
      { type: "cancellation", path: "/cancel" },
      { type: "custom", path: "/test" },
    ];

    for (const { type, path: flowPath } of types) {
      const wf = buildFlowWorkflow({ type, path: flowPath, description: "test custom flow" }, "http://localhost:3000");
      expect(() => workflowZ.parse(wf), `${type}: schema`).not.toThrow();
      const errors = validateWorkflow(wf);
      expect(errors, `${type}: structural`).toEqual([]);
    }
  });

  it("includes failure edge from setup to report", () => {
    const wf = buildFlowWorkflow({ type: "registration", path: "/signup" }, "http://localhost:3000");
    expect(wf.edges.some((e) => e.from === "setup" && e.to === "report" && e.when?.includes("fail"))).toBe(true);
  });

  it("includes failure edges from login to report for auth flows", () => {
    const wf = buildFlowWorkflow({ type: "purchase", path: "/pricing" }, "http://localhost:3000");
    expect(wf.edges.some((e) => e.from === "login" && e.to === "report" && e.when?.includes("fail"))).toBe(true);
  });
});

describe("buildE2eEnvTemplate", () => {
  it("always includes E2E_BASE_URL", () => {
    const env = buildE2eEnvTemplate({
      flows: [{ type: "registration", path: "/signup" }],
      baseUrl: "http://localhost:3000",
      cleanup: { enabled: false },
    });
    expect(env).toContain("E2E_BASE_URL=http://localhost:3000");
  });

  it("includes E2E_EMAIL and E2E_PASSWORD for auth-dependent flows", () => {
    const env = buildE2eEnvTemplate({
      flows: [{ type: "purchase", path: "/pricing" }],
      baseUrl: "http://localhost:3000",
      cleanup: { enabled: false },
    });
    expect(env).toContain("E2E_EMAIL=");
    expect(env).toContain("E2E_PASSWORD=");
  });

  it("does not include E2E_EMAIL for registration-only flows", () => {
    const env = buildE2eEnvTemplate({
      flows: [{ type: "registration", path: "/signup" }],
      baseUrl: "http://localhost:3000",
      cleanup: { enabled: false },
    });
    expect(env).not.toContain("E2E_EMAIL=");
  });

  it("includes SUPABASE vars when cleanup backend is supabase", () => {
    const env = buildE2eEnvTemplate({
      flows: [{ type: "registration", path: "/signup" }],
      baseUrl: "http://localhost:3000",
      cleanup: { enabled: true, backend: "supabase" },
    });
    expect(env).toContain("SUPABASE_URL=");
    expect(env).toContain("SUPABASE_SERVICE_ROLE_KEY=");
  });

  it("includes FIREBASE var when cleanup backend is firebase", () => {
    const env = buildE2eEnvTemplate({
      flows: [{ type: "registration", path: "/signup" }],
      baseUrl: "http://localhost:3000",
      cleanup: { enabled: true, backend: "firebase" },
    });
    expect(env).toContain("FIREBASE_SERVICE_ACCOUNT_KEY=");
  });

  it("includes DATABASE_URL when cleanup backend is postgres", () => {
    const env = buildE2eEnvTemplate({
      flows: [{ type: "registration", path: "/signup" }],
      baseUrl: "http://localhost:3000",
      cleanup: { enabled: true, backend: "postgres" },
    });
    expect(env).toContain("DATABASE_URL=");
  });

  it("includes auth vars for login-only flows", () => {
    const env = buildE2eEnvTemplate({
      flows: [{ type: "login", path: "/login" }],
      baseUrl: "http://localhost:3000",
      cleanup: { enabled: false },
    });
    expect(env).toContain("E2E_EMAIL=");
    expect(env).toContain("E2E_PASSWORD=");
  });

  it("includes auth vars for mixed flows when any need auth", () => {
    const env = buildE2eEnvTemplate({
      flows: [
        { type: "registration", path: "/signup" },
        { type: "purchase", path: "/pricing" },
      ],
      baseUrl: "http://localhost:3000",
      cleanup: { enabled: false },
    });
    expect(env).toContain("E2E_EMAIL=");
    expect(env).toContain("E2E_PASSWORD=");
  });

  it("does not include cleanup vars when cleanup is disabled", () => {
    const env = buildE2eEnvTemplate({
      flows: [{ type: "registration", path: "/signup" }],
      baseUrl: "http://localhost:3000",
      cleanup: { enabled: false },
    });
    expect(env).not.toContain("SUPABASE_URL");
    expect(env).not.toContain("FIREBASE_SERVICE_ACCOUNT_KEY");
    expect(env).not.toContain("DATABASE_URL");
  });
});

// ── Additional coverage: edge cases and robustness ────────────────────

describe("buildE2eVars — edge cases", () => {
  it("does not duplicate base_url from E2E_BASE_URL custom var pickup", () => {
    const vars = buildE2eVars({ E2E_BASE_URL: "https://myapp.com" });
    // base_url should exist exactly once with the correct value
    expect(vars.base_url).toBe("https://myapp.com");
    // The E2E_BASE_URL should NOT appear as a separate key
    expect(vars).not.toHaveProperty("base_url_extra");
  });

  it("excludes E2E_EMAIL and E2E_PASSWORD from custom var pickup", () => {
    const vars = buildE2eVars({
      E2E_EMAIL: "test@example.com",
      E2E_PASSWORD: "secret",
      E2E_API_KEY: "abc",
    });
    // email/password should come from the explicit handling, not custom pickup
    expect(vars.email).toBe("test@example.com");
    expect(vars.password).toBe("secret");
    expect(vars.api_key).toBe("abc");
    // Should NOT have duplicates from the E2E_* stripping logic
    expect(Object.keys(vars).filter((k) => k === "email")).toHaveLength(1);
    expect(Object.keys(vars).filter((k) => k === "password")).toHaveLength(1);
  });

  it("ignores E2E_* vars with empty string values", () => {
    const vars = buildE2eVars({ E2E_EMPTY: "" });
    expect(vars).not.toHaveProperty("empty");
  });

  it("ignores E2E_* vars with undefined values", () => {
    const vars = buildE2eVars({ E2E_UNDEF: undefined });
    expect(vars).not.toHaveProperty("undef");
  });
});

describe("buildFlowNodes — login node content", () => {
  it("login node for auth-dependent flows contains agent-browser commands", () => {
    const { nodes } = buildFlowNodes({ type: "purchase", path: "/pricing" });
    const instruction = nodes.login.instruction;
    expect(instruction).toContain("agent-browser open");
    expect(instruction).toContain("agent-browser snapshot");
    expect(instruction).toContain("agent-browser fill");
    expect(instruction).toContain("agent-browser click");
  });

  it("login node uses {email} and {password} (not test_email/test_password)", () => {
    const { nodes } = buildFlowNodes({ type: "onboarding", path: "/onboarding" });
    expect(nodes.login.instruction).toContain("{email}");
    expect(nodes.login.instruction).toContain("{password}");
  });

  it("login node has pass/fail output schema", () => {
    const { nodes } = buildFlowNodes({ type: "upgrade", path: "/upgrade" });
    expect(nodes.login.output).toEqual({
      type: "object",
      properties: {
        status: { type: "string", enum: ["pass", "fail"] },
        error: { type: "string" },
      },
      required: ["status"],
    });
  });
});

describe("buildFlowNodes — custom flow defaults", () => {
  it("uses default description when none provided", () => {
    const { nodes } = buildFlowNodes({ type: "custom", path: "/test" });
    expect(nodes.test_custom.instruction).toContain("Perform the custom test flow");
  });

  it("uses default success criteria when none provided", () => {
    const { nodes } = buildFlowNodes({ type: "custom", path: "/test" });
    expect(nodes.test_custom.instruction).toContain("expected outcome is achieved without errors");
  });
});

describe("buildFlowNodes — all test nodes have correct output schema", () => {
  const flows: FlowConfig[] = [
    { type: "registration", path: "/signup" },
    { type: "login", path: "/login" },
    { type: "purchase", path: "/pricing" },
    { type: "onboarding", path: "/onboarding" },
    { type: "upgrade", path: "/upgrade" },
    { type: "cancellation", path: "/cancel" },
    { type: "custom", path: "/test", description: "test" },
  ];

  for (const flow of flows) {
    it(`${flow.type}: test node has pass/fail output schema`, () => {
      const { nodes, testNodeIds } = buildFlowNodes(flow);
      const testNodeId = testNodeIds[testNodeIds.length - 1]; // last one is the actual test (not login)
      const node = nodes[testNodeId];
      expect(node.output).toEqual({
        type: "object",
        properties: {
          status: { type: "string", enum: ["pass", "fail"] },
          error: { type: "string" },
        },
        required: ["status"],
      });
    });
  }
});

describe("buildFlowWorkflow — edge chain topology", () => {
  it("registration: setup → test → report (3 edges)", () => {
    const wf = buildFlowWorkflow({ type: "registration", path: "/signup" }, "http://localhost:3000");
    expect(wf.edges).toEqual([
      { from: "setup", to: "test_registration", when: "setup status is ready" },
      { from: "setup", to: "report", when: "setup status is fail" },
      { from: "test_registration", to: "report" },
    ]);
  });

  it("purchase: setup → login → test → report with failure edges", () => {
    const wf = buildFlowWorkflow({ type: "purchase", path: "/pricing" }, "http://localhost:3000");
    expect(wf.edges).toEqual([
      { from: "setup", to: "login", when: "setup status is ready" },
      { from: "setup", to: "report", when: "setup status is fail" },
      { from: "login", to: "test_purchase", when: "login status is pass" },
      { from: "login", to: "report", when: "login status is fail" },
      { from: "test_purchase", to: "report" },
    ]);
  });

  it("registration with cleanup: setup → test → cleanup → report", () => {
    const wf = buildFlowWorkflow({ type: "registration", path: "/signup" }, "http://localhost:3000", {
      enabled: true,
      backend: "supabase",
    });
    expect(wf.edges).toEqual([
      { from: "setup", to: "test_registration", when: "setup status is ready" },
      { from: "setup", to: "report", when: "setup status is fail" },
      { from: "test_registration", to: "cleanup" },
      { from: "cleanup", to: "report" },
    ]);
  });

  it("purchase with cleanup: setup → login → test → cleanup → report", () => {
    const wf = buildFlowWorkflow({ type: "purchase", path: "/pricing" }, "http://localhost:3000", {
      enabled: true,
      backend: "postgres",
    });
    expect(wf.edges).toEqual([
      { from: "setup", to: "login", when: "setup status is ready" },
      { from: "setup", to: "report", when: "setup status is fail" },
      { from: "login", to: "test_purchase", when: "login status is pass" },
      { from: "login", to: "report", when: "login status is fail" },
      { from: "test_purchase", to: "cleanup" },
      { from: "cleanup", to: "report" },
    ]);
  });
});

describe("YAML round-trip — generated workflows survive stringify→parse→validate", () => {
  const flowConfigs: FlowConfig[] = [
    { type: "registration", path: "/signup", fields: ["email", "password", "name"] },
    { type: "login", path: "/login" },
    { type: "purchase", path: "/pricing", paymentProvider: "Stripe" },
    { type: "onboarding", path: "/onboarding" },
    { type: "upgrade", path: "/upgrade" },
    { type: "cancellation", path: "/cancel" },
    { type: "custom", path: "/test", description: "Export user data as CSV" },
  ];

  for (const flow of flowConfigs) {
    it(`${flow.type}: stringifyYaml → parseYaml → workflowZ.parse succeeds`, () => {
      const wf = buildFlowWorkflow(flow, "http://localhost:3000");
      const yaml = stringifyYaml(wf, { indent: 2, lineWidth: 120 });
      const parsed = parseYaml(yaml) as Workflow;

      // Zod schema validation
      expect(() => workflowZ.parse(parsed)).not.toThrow();

      // Structural validation (cycles, reachability)
      const errors = validateWorkflow(parsed);
      expect(errors).toEqual([]);

      // Key fields survive round-trip
      expect(parsed.id).toBe(wf.id);
      expect(parsed.entry).toBe("setup");
      expect(Object.keys(parsed.nodes)).toEqual(Object.keys(wf.nodes));
      expect(parsed.edges).toHaveLength(wf.edges.length);
    });

    it(`${flow.type} with cleanup: round-trip with cleanup node`, () => {
      const wf = buildFlowWorkflow(flow, "https://staging.example.com", {
        enabled: true,
        backend: "supabase",
      });
      const yaml = stringifyYaml(wf, { indent: 2, lineWidth: 120 });
      const parsed = parseYaml(yaml) as Workflow;

      expect(() => workflowZ.parse(parsed)).not.toThrow();
      expect(validateWorkflow(parsed)).toEqual([]);
      expect(parsed.nodes.cleanup).toBeDefined();
    });
  }
});

describe("template variable completeness — all {vars} in instructions are resolvable", () => {
  const ALL_FLOW_TYPES: FlowConfig[] = [
    { type: "registration", path: "/signup", fields: ["email", "password"] },
    { type: "login", path: "/login" },
    { type: "purchase", path: "/pricing", paymentProvider: "Stripe" },
    { type: "onboarding", path: "/onboarding" },
    { type: "upgrade", path: "/upgrade" },
    { type: "cancellation", path: "/cancel" },
    { type: "custom", path: "/test", description: "test flow" },
  ];

  // Build vars with a known run_id so we can predict all values
  const vars = buildE2eVars({ RUN_ID: "12345", E2E_BASE_URL: "http://localhost:3000" });

  for (const flow of ALL_FLOW_TYPES) {
    it(`${flow.type}: all template vars in instructions resolve to values`, () => {
      const wf = buildFlowWorkflow(flow, "http://localhost:3000");

      for (const [nodeId, node] of Object.entries(wf.nodes)) {
        const resolved = resolveTemplateVars(node.instruction, vars);
        // After resolution, no {word} placeholders should remain
        // (except for agent-browser refs like @<ref> which are not {vars})
        const unresolvedVars = resolved.match(/\{(\w+)\}/g) || [];
        // Filter out intentional placeholders that are instructions, not template vars
        const actualUnresolved = unresolvedVars.filter(
          (v) => !["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].some((env) => v.includes(env)),
        );
        expect(actualUnresolved, `${nodeId} has unresolved vars: ${actualUnresolved.join(", ")}`).toEqual([]);
      }
    });
  }
});

describe("buildSetupNode — instruction quality", () => {
  it("lists all essential agent-browser commands", () => {
    const node = buildSetupNode();
    const essentialCommands = [
      "agent-browser open",
      "agent-browser snapshot",
      "agent-browser click",
      "agent-browser fill",
      "agent-browser press",
      "agent-browser get url",
      "agent-browser screenshot",
    ];
    for (const cmd of essentialCommands) {
      expect(node.instruction, `missing: ${cmd}`).toContain(cmd);
    }
  });

  it("includes timeout/retry instructions", () => {
    const node = buildSetupNode();
    expect(node.instruction).toContain("30 seconds");
    expect(node.instruction).toContain("2 seconds");
  });
});

describe("buildFlowWorkflow — node naming conventions", () => {
  it("workflow id follows e2e-{type} pattern", () => {
    const types: FlowType[] = ["registration", "login", "purchase", "onboarding", "upgrade", "cancellation", "custom"];
    for (const type of types) {
      const wf = buildFlowWorkflow({ type, path: "/test", description: "test" }, "http://localhost:3000");
      expect(wf.id).toBe(`e2e-${type}`);
    }
  });

  it("workflow name follows E2E: {Type} pattern", () => {
    const wf = buildFlowWorkflow({ type: "registration", path: "/signup" }, "http://localhost:3000");
    expect(wf.name).toBe("E2E: Registration");
  });

  it("every node has a non-empty name", () => {
    const wf = buildFlowWorkflow({ type: "purchase", path: "/pricing" }, "http://localhost:3000", {
      enabled: true,
      backend: "supabase",
    });
    for (const [id, node] of Object.entries(wf.nodes)) {
      expect(node.name, `${id} has empty name`).toBeTruthy();
      expect(node.name.length, `${id} name too short`).toBeGreaterThan(2);
    }
  });
});

describe("runE2eInit — skipIntro option", () => {
  beforeEach(() => {
    introSpy.mockClear();
    logStepSpy.mockClear();
  });

  it("calls p.intro when skipIntro is not set", async () => {
    const { runE2eInit } = await import("./e2e.js");
    await expect(runE2eInit()).rejects.toThrow("__abort_test__");
    expect(introSpy).toHaveBeenCalledTimes(1);
    expect(logStepSpy).not.toHaveBeenCalledWith("Setting up end-to-end browser testing");
  });

  it("skips p.intro and logs a step when skipIntro: true", async () => {
    const { runE2eInit } = await import("./e2e.js");
    await expect(runE2eInit({ skipIntro: true })).rejects.toThrow("__abort_test__");
    expect(introSpy).not.toHaveBeenCalled();
    expect(logStepSpy).toHaveBeenCalledWith("Setting up end-to-end browser testing");
  });
});
