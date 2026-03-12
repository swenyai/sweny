# Task 11: Fix CLI Version Display

## Context

The CLI banner always shows `v0.2.0` regardless of the actual published package version.
This is because the version is hardcoded somewhere rather than read from `package.json`.

The package is now at `v1.0.0` (published 2026-03-12) but the banner shows `v0.2.0`.

```
│  ▲ SWEny Triage                          v0.2.0  │
```

## Where to Look

The version string is displayed in the CLI spinner/banner at startup. Search for it:

```bash
grep -rn "0\.2\.0\|version" packages/cli/src/ | grep -v node_modules | grep -v dist
```

The version should be read dynamically from the package's own `package.json`:

```typescript
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version } = require("../package.json");
```

Or using `import` with JSON assertion (Node 22+):
```typescript
import pkg from "../package.json" with { type: "json" };
const version = pkg.version;
```

## What to Change

Find where the version string is hardcoded and replace it with a dynamic read from
`packages/cli/package.json`. The `package.json` is at the root of the CLI package,
so the relative path from `src/` is `../package.json`.

## Verification

```bash
npm run build -w packages/cli
node packages/cli/dist/main.js triage --help
# Banner should show the current version from package.json, not a hardcoded string

# Also verify it reads correctly after a version bump by checking package.json:
node -e "import('./packages/cli/dist/main.js')" 2>&1 | head -5
```

## Changeset Required

```bash
# Create .changeset/fix-cli-version-display.md
---
"@sweny-ai/cli": patch
---

CLI banner now reads version dynamically from package.json instead of a hardcoded string.
```

## Commit Message

```
fix(cli): read version from package.json instead of hardcoded string
```
