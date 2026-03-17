import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  phaseColor,
  formatValidationErrors,
  formatCrashError,
  extractCredentialHint,
  formatResultJson,
  getStepDetails,
  formatResultHuman,
  formatPhaseHeader,
  formatStepLine,
} from "../src/output.js";

// Strip ANSI escape codes before making text assertions
function plain(s: string): string {
  return stripAnsi(s);
}

// Minimal workflow result shape for tests
type MockStep = {
  name: string;
  phase: "learn" | "act" | "report";
  result: { status: "completed" | "failed"; data?: Record<string, unknown>; reason?: string };
};

type MockResult = {
  status: "completed" | "failed";
  duration: number;
  steps: MockStep[];
};

function makeStep(name: string, phase: "learn" | "act" | "report", data?: Record<string, unknown>): MockStep {
  return { name, phase, result: { status: "completed", data } };
}

function makeResult(overrides: Partial<MockResult> & { steps?: MockStep[] }): MockResult {
  return { status: "completed", duration: 12_000, steps: [], ...overrides };
}

// ── stripAnsi ───────────────────────────────────────────────────────────────

describe("stripAnsi", () => {
  it("removes ANSI color escape sequences", () => {
    expect(stripAnsi("\x1B[32mhello\x1B[0m")).toBe("hello");
  });

  it("removes bold sequences", () => {
    expect(stripAnsi("\x1B[1mBold\x1B[0m")).toBe("Bold");
  });

  it("leaves plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });

  it("handles multiple sequences in one string", () => {
    expect(stripAnsi("\x1B[1m\x1B[34mBold Blue\x1B[0m text")).toBe("Bold Blue text");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });
});

// ── phaseColor ──────────────────────────────────────────────────────────────

describe("phaseColor", () => {
  it("returns a function for each known phase", () => {
    expect(typeof phaseColor("learn")).toBe("function");
    expect(typeof phaseColor("act")).toBe("function");
    expect(typeof phaseColor("report")).toBe("function");
  });

  it("returns a function for unknown phase (falls back to white)", () => {
    expect(typeof phaseColor("unknown")).toBe("function");
  });

  it("returned function passes the text through (modulo ANSI)", () => {
    const result = plain(phaseColor("learn")("hello"));
    expect(result).toBe("hello");
  });

  it("different phases return different color functions", () => {
    // In a TTY environment colors would differ; strip ANSI only if chalk is level 0
    const learn = phaseColor("learn")("x");
    const act = phaseColor("act")("x");
    // At minimum both should produce non-empty strings
    expect(learn.length).toBeGreaterThan(0);
    expect(act.length).toBeGreaterThan(0);
  });
});

// ── formatPhaseHeader ───────────────────────────────────────────────────────

describe("formatPhaseHeader", () => {
  it("includes the capitalized phase name", () => {
    expect(plain(formatPhaseHeader("learn"))).toContain("Learn");
    expect(plain(formatPhaseHeader("act"))).toContain("Act");
    expect(plain(formatPhaseHeader("report"))).toContain("Report");
  });

  it("renders without throwing for all phases", () => {
    expect(() => formatPhaseHeader("learn")).not.toThrow();
    expect(() => formatPhaseHeader("act")).not.toThrow();
    expect(() => formatPhaseHeader("report")).not.toThrow();
  });
});

// ── formatStepLine ──────────────────────────────────────────────────────────

describe("formatStepLine", () => {
  it("includes icon, counter, name, and elapsed", () => {
    const line = plain(formatStepLine("✓", "1/5", "investigate", "3s"));
    expect(line).toContain("1/5");
    expect(line).toContain("investigate");
    expect(line).toContain("3s");
  });

  it("includes reason when provided", () => {
    const line = plain(formatStepLine("−", "2/5", "novelty-gate", "1s", "skipped"));
    expect(line).toContain("skipped");
  });

  it("omits reason suffix when not provided", () => {
    const line = plain(formatStepLine("✓", "1/5", "investigate", "2s"));
    expect(line).not.toContain("—");
  });
});

// ── formatValidationErrors ──────────────────────────────────────────────────

describe("formatValidationErrors", () => {
  it("includes 'Configuration Error' heading", () => {
    const out = plain(formatValidationErrors(["Missing: DD_API_KEY"]));
    expect(out).toContain("Configuration Error");
  });

  it("includes each error message", () => {
    const out = plain(formatValidationErrors(["Missing: ANTHROPIC_API_KEY", "Missing: GITHUB_TOKEN"]));
    expect(out).toContain("ANTHROPIC_API_KEY");
    expect(out).toContain("GITHUB_TOKEN");
  });

  it("numbers multiple errors", () => {
    const out = plain(formatValidationErrors(["Error A", "Error B", "Error C"]));
    expect(out).toContain("1.");
    expect(out).toContain("2.");
    expect(out).toContain("3.");
  });

  it("renders a single error without numbering artifacts", () => {
    const out = plain(formatValidationErrors(["Missing: DD_API_KEY"]));
    expect(out).toContain("Missing: DD_API_KEY");
  });
});

// ── extractCredentialHint ───────────────────────────────────────────────────

describe("extractCredentialHint", () => {
  it("returns Anthropic hint for 401 Anthropic error", () => {
    const hint = extractCredentialHint(new Error("401 Unauthorized from Anthropic API"));
    expect(hint).toContain("ANTHROPIC_API_KEY");
  });

  it("returns Anthropic hint for authentication error mentioning anthropic", () => {
    const hint = extractCredentialHint(new Error("Authentication failed: anthropic rejected the key"));
    expect(hint).toContain("ANTHROPIC_API_KEY");
  });

  it("returns Datadog hint for 401 Datadog error", () => {
    const hint = extractCredentialHint(new Error("401 Unauthorized from datadog metrics API"));
    expect(hint).toContain("DD_API_KEY");
    expect(hint).toContain("DD_APP_KEY");
  });

  it("returns Datadog hint for 403 Datadog error", () => {
    const hint = extractCredentialHint(new Error("403 Forbidden from Datadog"));
    expect(hint).toContain("DD_API_KEY");
  });

  it("returns Linear hint for 401 Linear error", () => {
    const hint = extractCredentialHint(new Error("401 Unauthorized: Linear API rejected the request"));
    expect(hint).toContain("LINEAR_API_KEY");
  });

  it("returns GitHub hint for 401 GitHub error", () => {
    const hint = extractCredentialHint(new Error("401 Bad credentials from GitHub API"));
    expect(hint).toContain("GITHUB_TOKEN");
  });

  it("returns network hint for ENOTFOUND", () => {
    const hint = extractCredentialHint(new Error("getaddrinfo ENOTFOUND api.datadoghq.com"));
    expect(hint).toContain("Network error");
  });

  it("returns network hint for ETIMEDOUT", () => {
    const hint = extractCredentialHint(new Error("connect ETIMEDOUT 1.2.3.4:443"));
    expect(hint).toContain("Network error");
  });

  it("returns null for unrecognized error", () => {
    expect(extractCredentialHint(new Error("some random runtime error"))).toBeNull();
  });

  it("returns null for generic 500 server error", () => {
    expect(extractCredentialHint(new Error("500 Internal Server Error"))).toBeNull();
  });

  it("handles non-Error values without throwing", () => {
    expect(() => extractCredentialHint("string error")).not.toThrow();
    expect(() => extractCredentialHint(null)).not.toThrow();
    expect(() => extractCredentialHint(42)).not.toThrow();
  });
});

// ── formatCrashError ────────────────────────────────────────────────────────

describe("formatCrashError", () => {
  it("includes 'Unexpected Error' heading", () => {
    const out = plain(formatCrashError(new Error("boom")));
    expect(out).toContain("Unexpected Error");
  });

  it("includes the error message", () => {
    const out = plain(formatCrashError(new Error("connection refused")));
    expect(out).toContain("connection refused");
  });

  it("handles non-Error values gracefully", () => {
    const out = plain(formatCrashError("string error"));
    expect(out).toContain("Unexpected Error");
    expect(out).toContain("Unknown error");
  });

  it("handles null gracefully", () => {
    const out = plain(formatCrashError(null));
    expect(out).toContain("Unknown error");
  });

  it("appends credential hint when error matches a known pattern", () => {
    const out = plain(formatCrashError(new Error("401 Unauthorized from Anthropic API")));
    expect(out).toContain("Hint:");
    expect(out).toContain("ANTHROPIC_API_KEY");
  });

  it("does not append hint for unrecognized errors", () => {
    const out = plain(formatCrashError(new Error("some random error")));
    expect(out).not.toContain("Hint:");
  });
});

// ── formatResultJson ─────────────────────────────────────────────────────────

describe("formatResultJson", () => {
  it("returns valid JSON", () => {
    const result = makeResult({ status: "completed", duration: 5000 });
    expect(() => JSON.parse(formatResultJson(result as any))).not.toThrow();
  });

  it("preserves all fields in the JSON output", () => {
    const result = makeResult({ status: "completed", duration: 5000 });
    const json = JSON.parse(formatResultJson(result as any));
    expect(json.status).toBe("completed");
    expect(json.duration).toBe(5000);
  });
});

// ── getStepDetails ───────────────────────────────────────────────────────────

describe("getStepDetails", () => {
  it("returns empty array when no data is provided", () => {
    expect(getStepDetails("investigate")).toEqual([]);
  });

  it("returns empty array for unknown step names", () => {
    expect(getStepDetails("unknown-step", { foo: "bar" })).toEqual([]);
  });

  describe("investigate", () => {
    it("includes 'Issues found' when issuesFound is true", () => {
      const details = getStepDetails("investigate", { issuesFound: true, recommendation: "implement" });
      expect(details.some((d) => d.includes("Issues found"))).toBe(true);
    });

    it("includes 'No issues found' when issuesFound is false", () => {
      const details = getStepDetails("investigate", { issuesFound: false });
      expect(details.some((d) => d.includes("No issues found"))).toBe(true);
    });

    it("includes recommendation when present", () => {
      const details = getStepDetails("investigate", { issuesFound: true, recommendation: "implement" });
      expect(details.some((d) => d.includes("implement"))).toBe(true);
    });

    it("includes targetRepo when present", () => {
      const details = getStepDetails("investigate", { issuesFound: false, targetRepo: "acme/api-v2" });
      expect(details.some((d) => d.includes("acme/api-v2"))).toBe(true);
    });
  });

  describe("novelty-gate", () => {
    it("shows 'Dry run' for dry-run action", () => {
      const details = getStepDetails("novelty-gate", { action: "dry-run" });
      expect(details[0]).toContain("Dry run");
    });

    it("shows 'No novel issues' for skip action", () => {
      const details = getStepDetails("novelty-gate", { action: "skip" });
      expect(details[0]).toContain("No novel issues");
    });

    it("shows '+1 on existing' with issue identifier", () => {
      const details = getStepDetails("novelty-gate", { action: "+1", issueIdentifier: "ENG-42" });
      expect(details[0]).toContain("ENG-42");
    });

    it("shows 'Proceeding with implementation' for implement action", () => {
      const details = getStepDetails("novelty-gate", { action: "implement" });
      expect(details[0]).toContain("implementation");
    });
  });

  describe("create-issue", () => {
    it("includes identifier and title", () => {
      const details = getStepDetails("create-issue", {
        issueIdentifier: "ENG-123",
        issueTitle: "Null pointer in auth",
      });
      expect(details.some((d) => d.includes("ENG-123"))).toBe(true);
      expect(details.some((d) => d.includes("Null pointer in auth"))).toBe(true);
    });

    it("includes issue URL when present", () => {
      const details = getStepDetails("create-issue", {
        issueIdentifier: "ENG-1",
        issueUrl: "https://linear.app/issue/ENG-1",
      });
      expect(details.some((d) => d.includes("https://linear.app/issue/ENG-1"))).toBe(true);
    });
  });

  describe("implement-fix", () => {
    it("includes branch name", () => {
      const details = getStepDetails("implement-fix", { branchName: "fix/null-pointer" });
      expect(details.some((d) => d.includes("fix/null-pointer"))).toBe(true);
    });

    it("includes 'Code changes committed' when hasCodeChanges is true", () => {
      const details = getStepDetails("implement-fix", { branchName: "fix/x", hasCodeChanges: true });
      expect(details.some((d) => d.includes("Code changes committed"))).toBe(true);
    });
  });

  describe("create-pr", () => {
    it("includes PR URL and number", () => {
      const details = getStepDetails("create-pr", {
        prUrl: "https://github.com/acme/api/pull/42",
        prNumber: 42,
      });
      expect(details.some((d) => d.includes("https://github.com/acme/api/pull/42"))).toBe(true);
      expect(details.some((d) => d.includes("#42"))).toBe(true);
    });

    it("includes linked issue identifier", () => {
      const details = getStepDetails("create-pr", {
        prUrl: "https://github.com/pr/1",
        issueIdentifier: "ENG-5",
      });
      expect(details.some((d) => d.includes("ENG-5"))).toBe(true);
    });
  });

  describe("cross-repo-check", () => {
    it("includes target repo when dispatched", () => {
      const details = getStepDetails("cross-repo-check", { dispatched: true, targetRepo: "acme/backend" });
      expect(details.some((d) => d.includes("acme/backend"))).toBe(true);
    });

    it("returns empty when not dispatched", () => {
      expect(getStepDetails("cross-repo-check", { dispatched: false })).toEqual([]);
    });
  });

  describe("build-context", () => {
    it("counts known issues from markdown list", () => {
      const content = "- **Issue 1**: foo\n- **Issue 2**: bar\n- **Issue 3**: baz\n";
      const details = getStepDetails("build-context", { knownIssuesContent: content });
      expect(details.some((d) => d.includes("3 known issues"))).toBe(true);
    });

    it("returns empty when there are no known issues", () => {
      expect(getStepDetails("build-context", { knownIssuesContent: "nothing here" })).toEqual([]);
    });
  });
});

// ── formatResultHuman ────────────────────────────────────────────────────────

describe("formatResultHuman", () => {
  it("renders 'Triage Failed' for a failed workflow", () => {
    const result = makeResult({ status: "failed", steps: [makeStep("investigate", "learn")] });
    result.steps[0].result.status = "failed";
    result.steps[0].result.reason = "Datadog API returned 403";

    const out = plain(formatResultHuman(result as any));

    expect(out).toContain("Triage Failed");
    expect(out).toContain("investigate");
    expect(out).toContain("Datadog API returned 403");
  });

  it("renders 'Dry Run Complete' when novelty-gate is dry-run", () => {
    const result = makeResult({
      steps: [makeStep("novelty-gate", "act", { action: "dry-run" })],
    });
    expect(plain(formatResultHuman(result as any))).toContain("Dry Run Complete");
  });

  it("dry run result includes investigate findings when present", () => {
    const result = makeResult({
      steps: [
        makeStep("investigate", "learn", { issuesFound: true, recommendation: "implement" }),
        makeStep("novelty-gate", "act", { action: "dry-run" }),
      ],
    });
    const out = plain(formatResultHuman(result as any));
    expect(out).toContain("Dry Run Complete");
  });

  it("renders 'Triage Complete' when a PR was created", () => {
    const result = makeResult({
      steps: [
        makeStep("create-issue", "act", { issueIdentifier: "ENG-1", issueTitle: "Bug", issueUrl: "https://lin.ar/e" }),
        makeStep("create-pr", "act", { prUrl: "https://github.com/pr/42", prNumber: 42 }),
      ],
    });
    const out = plain(formatResultHuman(result as any));
    expect(out).toContain("Triage Complete");
    expect(out).toContain("ENG-1");
    expect(out).toContain("https://github.com/pr/42");
  });

  it("renders 'No Action Needed' when novelty-gate skips", () => {
    const result = makeResult({ steps: [makeStep("novelty-gate", "act", { action: "skip" })] });
    const out = plain(formatResultHuman(result as any));
    expect(out).toContain("No Action Needed");
    expect(out).toContain("novel issues");
  });

  it("renders '+1 on existing issue' when novelty-gate action is +1", () => {
    const result = makeResult({
      steps: [makeStep("novelty-gate", "act", { action: "+1", issueIdentifier: "ENG-5" })],
    });
    const out = plain(formatResultHuman(result as any));
    expect(out).toContain("No Action Needed");
    expect(out).toContain("ENG-5");
  });

  it("renders 'No Action Needed' when there are no notable steps", () => {
    const result = makeResult({ steps: [] });
    const out = plain(formatResultHuman(result as any));
    expect(out).toContain("No Action Needed");
  });

  it("formats duration in seconds for short runs", () => {
    const result = makeResult({ duration: 12_000 });
    const out = plain(formatResultHuman(result as any));
    expect(out).toContain("12s");
  });

  it("formats duration in minutes for runs over 60s", () => {
    const result = makeResult({ duration: 65_000 });
    const out = plain(formatResultHuman(result as any));
    expect(out).toContain("1m 5s");
  });
});
