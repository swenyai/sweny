# Task: Fix file observability provider — getPromptInstructions

## Why

The `investigate` step calls `observability.getPromptInstructions()` to inject
provider-specific API usage instructions into the agent prompt. Every observability
provider must implement this method as part of the `ObservabilityProvider` interface.

The file provider (`packages/providers/src/observability/file.ts`) exists and is used
when `observability-provider: file` is configured (e.g., for local development or CI
log files). But its `getPromptInstructions()` almost certainly returns a stub or empty
string — meaning the agent has no instructions for how to read the log file, so the
investigation step either fails or produces garbage output.

This makes the `file` provider non-functional in practice. It was added as a
convenience provider for offline development but was never completed.

---

## Relevant files

| File | Notes |
|------|-------|
| `packages/providers/src/observability/file.ts` | The provider to fix |
| `packages/providers/src/observability/types.ts` | `ObservabilityProvider` interface |
| `packages/providers/src/observability/datadog.ts` | Reference implementation |
| `packages/providers/src/observability/cloudwatch.ts` | Another reference |
| `packages/engine/src/recipes/triage/steps/investigate.ts` | How `getPromptInstructions()` is used |
| `packages/engine/src/recipes/triage/prompts.ts` | Where the result is embedded |
| `packages/action/src/config.ts` | `log-file-path` config field |

---

## What `getPromptInstructions()` needs to do

Look at any existing provider for the pattern. For example, in `cloudwatch.ts`:

```typescript
getPromptInstructions(): string {
  return `## CloudWatch Logs

The AWS CloudWatch environment is configured. Use the AWS CLI to query logs:

\`\`\`bash
aws logs filter-log-events \\
  --log-group-name "/aws/lambda/my-service" \\
  --start-time $(date -d '1 hour ago' +%s000) \\
  --filter-pattern "ERROR"
\`\`\`

The log group prefix is: ${config.logGroupPrefix}
...`;
}
```

For the file provider, the agent just needs to know:
- The path to the log file (from `config.logFilePath`)
- That it should use standard shell tools (`cat`, `grep`, `tail`, `jq`) to read it
- The expected format (plain text, JSON lines, etc.)

---

## Step 1 — Read the current implementation

Read `packages/providers/src/observability/file.ts` in full. Understand what
`queryLogs` and `aggregate` do (they probably read from the file). Then look at
`getPromptInstructions()` — confirm it's incomplete.

---

## Step 2 — Implement `getPromptInstructions()`

The file provider takes a config with at minimum `{ path: string }`. Write
instructions like:

```typescript
getPromptInstructions(): string {
  return `## File-based Observability

Your log data is in a local file. Use standard shell commands to read it.

**Log file path**: \`${config.path}\`

### Reading logs

\`\`\`bash
# View the whole file
cat "${config.path}"

# View the last 200 lines
tail -200 "${config.path}"

# Filter for errors
grep -i "error\\|exception\\|fatal" "${config.path}"

# If the file contains JSON lines (one JSON object per line):
cat "${config.path}" | jq 'select(.level == "error")' 2>/dev/null || grep -i error "${config.path}"
\`\`\`

### What to look for

- Error messages, stack traces, exception names
- Repeated patterns (same error appearing multiple times)
- Timestamps to determine when issues started
- Service or module names in the log lines

Read the file, identify the top errors by frequency and severity, and proceed
with the standard investigation output format.`;
}
```

Adapt the exact text based on what you see in the existing `file.ts` implementation.

---

## Step 3 — Add/fix `queryLogs` and `aggregate`

Check if these methods actually read the file. Common issues:
- The path might not be validated before use (add a check + throw if the file
  doesn't exist at provider construction time, or return empty results)
- JSON parsing might not handle mixed-format log files

If they work correctly, leave them alone.

---

## Step 4 — Tests

The file provider should have tests in `packages/providers/tests/observability/`.
Check if a test file exists. If not, create one:

```typescript
// packages/providers/tests/observability/file.test.ts
import { describe, it, expect, vi } from "vitest";
import * as nodeFs from "node:fs";
import { fileObservability } from "../../src/observability/file.js"; // adjust import

vi.mock("node:fs");

describe("file observability provider", () => {
  it("getPromptInstructions includes the log file path", () => {
    const provider = fileObservability({ path: "/var/log/app.log" });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("/var/log/app.log");
    expect(instructions).toContain("cat");
    expect(instructions).toContain("grep");
  });

  it("queryLogs returns empty array when file does not exist", async () => {
    vi.mocked(nodeFs.existsSync).mockReturnValue(false);
    const provider = fileObservability({ path: "/nonexistent.log" });
    const results = await provider.queryLogs({ timeRange: "24h", filter: "" });
    expect(results).toEqual([]);
  });

  it("queryLogs reads and parses log lines from file", async () => {
    const logContent = [
      '{"ts":1700000000,"level":"error","msg":"Something failed"}',
      '{"ts":1700000001,"level":"info","msg":"All good"}',
    ].join("\n");
    vi.mocked(nodeFs.existsSync).mockReturnValue(true);
    vi.mocked(nodeFs.readFileSync).mockReturnValue(logContent);
    const provider = fileObservability({ path: "/app.log" });
    const results = await provider.queryLogs({ timeRange: "24h", filter: "error" });
    // should return at least the error line
    expect(results.length).toBeGreaterThan(0);
  });
});
```

---

## Acceptance

- `getPromptInstructions()` returns a non-empty string that includes the log file path
  and clear instructions for reading it with shell commands
- The investigate step can run successfully with `observability-provider: file`
- At least 3 new tests covering `getPromptInstructions`, `queryLogs` with missing file,
  and `queryLogs` with a valid file
- `npm test` in `packages/providers` passes
