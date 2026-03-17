# Task: Warn When Service Map File Is Missing

## Goal
When a user specifies `serviceMapPath` in their config but the file doesn't exist, print a clear warning at startup — before the workflow begins — instead of silently producing incorrect triage results.

## Problem
If the service map file path is wrong or the file hasn't been created yet, the engine currently proceeds silently. The service map is used for cross-repo routing; without it, cross-repo dispatch always fails or produces wrong results. The user has no idea why.

## Files to Change

### `packages/cli/src/config.ts` — `validateInputs()`

Add a filesystem check for `serviceMapPath`:
```typescript
import * as fs from "node:fs";

// In validateInputs(), after the other checks:
if (config.serviceMapPath !== undefined && !fs.existsSync(config.serviceMapPath)) {
  // Warn but don't error — file might be optional in some workflows
  warnings.push(
    `Service map file not found: "${config.serviceMapPath}". Cross-repo routing will be disabled.`
  );
}
```

If `validateInputs()` currently only returns `string[]` (errors), update it to return `{ errors: string[], warnings: string[] }` — or add a separate `validateWarnings()` function. Check the existing return type before deciding which approach fits cleanly.

### `packages/cli/src/main.ts` — triage command action

After calling `validateInputs()`, if warnings are present, print them with `chalk.yellow("⚠ " + warning)` before starting the spinner.

## Tests to Add

File: `packages/cli/src/config.test.ts`

```typescript
describe("serviceMapPath validation", () => {
  it("returns a warning when serviceMapPath does not exist", () => {
    const warnings = validateWarnings({ serviceMapPath: "/nonexistent/service-map.json" } as CliConfig);
    expect(warnings.some((w) => w.includes("Service map file not found"))).toBe(true);
  });

  it("no warning when serviceMapPath is undefined", () => {
    const warnings = validateWarnings({ serviceMapPath: undefined } as CliConfig);
    expect(warnings.length).toBe(0);
  });

  it("no warning when serviceMapPath file exists", () => {
    // Create a temp file, validate, delete it
    const tmp = os.tmpdir() + "/test-service-map.json";
    fs.writeFileSync(tmp, "{}");
    try {
      const warnings = validateWarnings({ serviceMapPath: tmp } as CliConfig);
      expect(warnings.length).toBe(0);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
```

## Acceptance Criteria
- Running with `serviceMapPath: "/missing/file.json"` prints a yellow warning before the spinner
- The workflow still starts (it's a warning, not an error)
- Running with a valid path or no `serviceMapPath` produces no warning
- Tests pass: `npm test` in `packages/cli`

## Changeset Required
File: `.changeset/service-map-missing-warning.md`
```md
---
"@sweny-ai/cli": patch
---

Warn at startup when serviceMapPath points to a missing file, instead of silently disabling cross-repo routing.
```
