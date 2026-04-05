# Tests + build verification for `@sweny-ai/mcp`

**Package:** `packages/mcp`
**Depends on:** Tasks 69-71

## Goal

Add unit tests for the MCP tools and verify the full build pipeline works.

## Tests to write

### `packages/mcp/src/__tests__/list-workflows.test.ts`

Test the `listWorkflows` handler directly (not through the MCP server):

1. **Returns built-in workflows** — call `listWorkflows(process.cwd())` and assert:
   - Result includes an entry with `id: "triage"`, `source: "builtin"`
   - Result includes an entry with `id: "implement"`, `source: "builtin"`
   - Each entry has `name`, `description`, `nodeCount` fields

2. **Handles missing directory gracefully** — call with a nonexistent path, assert it still returns built-ins without throwing

3. **Finds custom workflows** — create a temp dir with a `.sweny/workflows/test.yml` file containing a valid workflow YAML, call `listWorkflows(tmpDir)`, assert the custom workflow appears with `source: "custom"`

### `packages/mcp/src/__tests__/run-workflow.test.ts`

Test the `runWorkflow` handler. Since it spawns a child process, tests should mock `child_process.spawn`:

1. **Builds correct CLI args for triage** — mock spawn, call `runWorkflow({ workflow: "triage", input: "alert text" })`, assert spawn was called with `["sweny", "triage", "--alert", "alert text", "--json"]`

2. **Builds correct CLI args for implement** — same pattern, assert `["sweny", "implement", "--issue-url", "https://...", "--json"]`

3. **Adds --dry-run flag** — pass `dryRun: true`, assert `--dry-run` is in the args

4. **Parses JSON output on success** — mock spawn to emit `{"results": {"prepare": {"status": "success"}}}` on stdout and exit code 0. Assert `result.success === true` and `result.results` matches.

5. **Returns error on non-zero exit** — mock spawn with exit code 1 and stderr output. Assert `result.success === false` and `result.error` contains the stderr text.

### Test setup

Use Vitest 4 (already in devDependencies). Tests should be ESM. For child_process mocking, use `vi.mock("node:child_process")`.

For temp directories in the custom workflow test, use `fs.mkdtemp` + cleanup in `afterEach`.

## Build verification

After tests pass, verify the full pipeline:

```bash
# From repo root
npm install
cd packages/mcp
npm run build
npm run typecheck
npm test

# Verify the bin entry works
node dist/index.js --help 2>&1 || true  # MCP servers don't have --help, but shouldn't crash on startup
```

## Acceptance criteria

- [ ] `listWorkflows` handler has 3+ unit tests
- [ ] `runWorkflow` handler has 4+ unit tests with mocked child_process
- [ ] `npm run test` passes in packages/mcp
- [ ] `npm run build` produces dist/ with all .js + .d.ts files
- [ ] `npm run typecheck` passes clean
- [ ] `node dist/index.js` starts without immediate crash (waits for stdin as expected)
