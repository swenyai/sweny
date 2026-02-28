# Task 29: Add Exports Field to Agent Package

## Goal
Add an `exports` field to `packages/agent/package.json` to define the public API surface, matching the pattern used by `@sweny/providers`.

## Context
- `packages/providers/package.json` has a comprehensive `exports` field with 12 subpath exports
- `packages/agent/package.json` has NO exports field — everything is implicitly importable
- The agent package should export clear entry points for consumers

## Implementation
Edit `packages/agent/package.json` to add `exports` and `typesVersions` fields.

The public API should include:
```json
{
  "exports": {
    ".": "./dist/index.js",
    "./channel": "./dist/channel/index.js",
    "./orchestrator": "./dist/orchestrator.js",
    "./plugins": "./dist/plugins/types.js",
    "./runner": "./dist/runner/index.js",
    "./config": "./dist/config/types.js",
    "./auth": "./dist/auth/types.js",
    "./session": "./dist/session/manager.js",
    "./storage": "./dist/storage/types.js"
  }
}
```

Also add matching `typesVersions` for TypeScript consumers (same pattern as providers package).

Also add a `"files"` field to limit what gets published: `["dist", "LICENSE", "README.md"]`.

## Verification
```bash
npm run typecheck --workspace=packages/agent
npm test --workspace=packages/agent
```

## Commit
```bash
git add packages/agent/package.json
git commit -m "chore: add exports field to @sweny/agent package.json

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
