# Implement `sweny_run_workflow` tool

**Package:** `packages/mcp`
**Depends on:** Task 70 (server + list tool)

## Goal

Add the primary tool: `sweny_run_workflow`. This lets Claude Code/Desktop trigger a full SWEny workflow execution and get back structured results.

## Design decisions

**Spawn the CLI, don't call the executor directly.** Why:
- The executor requires a `ClaudeClient` which itself spawns Claude Code — running this inside Claude Code's own MCP server would create recursion. Spawning a separate `sweny` CLI process isolates the execution context cleanly.
- The CLI already handles config loading, skill resolution, MCP auto-injection, and streaming.
- The `--json` flag on the CLI outputs structured results to stdout.

**Use `--stream` for progress + `--json` for output.** The CLI supports both. We'll use `--json` mode so the final output is machine-parseable.

## What to implement

### `packages/mcp/src/handlers/run-workflow.ts`

```ts
import { spawn } from "node:child_process";
import * as path from "node:path";

export interface RunWorkflowInput {
  workflow: string;     // "triage" | "implement" | path to custom .yml
  input: string;        // The input payload (alert text, issue URL, etc.)
  cwd?: string;         // Working directory
  dryRun?: boolean;     // If true, pass --dry-run flag
}

export interface RunWorkflowResult {
  success: boolean;
  results: Record<string, unknown>;  // node results map
  error?: string;
}
```

Implementation:

1. Resolve the `sweny` binary — use `import.meta.resolve("@sweny-ai/core/package.json")` to find the core package, then resolve its `bin.sweny` path. Alternatively, just spawn `npx sweny` which will find the workspace binary.

2. Build the CLI command args:
   - For `"triage"`: `["triage", "--alert", input, "--json"]`
   - For `"implement"`: `["implement", "--issue-url", input, "--json"]`
   - For custom workflows: not supported in v1, return an error message suggesting they use a built-in workflow
   - If `dryRun`: add `--dry-run`

3. Spawn the process:
   ```ts
   const child = spawn("npx", ["sweny", ...args], {
     cwd: cwd ?? process.cwd(),
     stdio: ["ignore", "pipe", "pipe"],
     env: { ...process.env },  // inherit env (picks up .env vars)
   });
   ```

4. Collect stdout and stderr. Parse the JSON output from stdout on exit.

5. Return structured result. If the process exits non-zero, return `{ success: false, error: stderr }`.

6. **Timeout**: Kill the process after 10 minutes (configurable). Workflows can take a while but shouldn't hang forever.

### Update `packages/mcp/src/tools.ts`

Register the new tool:

```ts
server.tool(
  "sweny_run_workflow",
  "Execute a SWEny workflow (triage or implement). Spawns the sweny CLI, runs the full DAG, and returns structured results. This can take several minutes.",
  {
    workflow: z.enum(["triage", "implement"]).describe("Which workflow to run"),
    input: z.string().describe("Input for the workflow: alert text for triage, issue URL for implement"),
    cwd: z.string().optional().describe("Working directory (must contain .sweny.yml). Defaults to process.cwd()."),
    dryRun: z.boolean().optional().describe("If true, run in dry-run mode (no side effects)"),
  },
  async ({ workflow, input, cwd, dryRun }) => {
    const result = await runWorkflow({ workflow, input, cwd, dryRun });
    return {
      content: [{
        type: "text",
        text: result.success
          ? JSON.stringify(result.results, null, 2)
          : `Workflow failed: ${result.error}`,
      }],
      isError: !result.success,
    };
  }
);
```

## Edge cases to handle

- **Missing .sweny.yml**: The CLI will error — surface its stderr as the tool error message.
- **Missing credentials**: Same — CLI validates and errors with a helpful message.
- **Process killed by timeout**: Return `{ success: false, error: "Workflow timed out after 10 minutes" }`.
- **Non-JSON stdout**: If the CLI output isn't valid JSON (e.g., it printed progress before JSON), try to extract the last JSON object from stdout.

## Verification

```bash
cd packages/mcp
npm run typecheck
npm run build
```

Manual test (requires .sweny.yml and credentials):
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"sweny_run_workflow","arguments":{"workflow":"triage","input":"test alert","dryRun":true}}}' | node dist/index.js
```

## Acceptance criteria

- [ ] `sweny_run_workflow` tool registered in the MCP server
- [ ] Spawns `sweny` CLI as a child process with correct args
- [ ] Returns structured JSON results on success
- [ ] Returns error message on failure (non-zero exit, timeout, missing config)
- [ ] 10-minute timeout kills hanging processes
- [ ] Typecheck passes
