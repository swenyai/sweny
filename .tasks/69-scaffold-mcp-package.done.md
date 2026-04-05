# Scaffold `packages/mcp` package

**Package:** `packages/mcp`
**Depends on:** nothing

## Goal

Create the `@sweny-ai/mcp` package directory with all boilerplate so subsequent tasks can focus purely on implementation.

## What to create

### `packages/mcp/package.json`

```json
{
  "name": "@sweny-ai/mcp",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "description": "MCP server exposing SWEny workflows to Claude Code and Claude Desktop",
  "bin": {
    "sweny-mcp": "./dist/index.js"
  },
  "exports": {
    ".": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "rm -rf dist && tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "@sweny-ai/core": "*"
  },
  "devDependencies": {
    "vitest": "^4.1.2"
  }
}
```

Notes:
- `private: true` for now (not published to npm yet — can flip later)
- `bin.sweny-mcp` points to `dist/index.js` — this is what Claude Desktop/Code runs via stdio
- Depends on `@sweny-ai/core` (workspace link) for workflow parsing, skill listing, etc.
- Depends on `@modelcontextprotocol/sdk` for the MCP server framework

### `packages/mcp/tsconfig.json`

Match the convention used by all other packages in the monorepo:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

### `packages/mcp/src/index.ts`

Minimal placeholder — just a shebang + empty main:

```ts
#!/usr/bin/env node
// MCP server for SWEny — exposes workflow tools to Claude Code / Desktop
async function main() {
  // TODO: wire up MCP server + stdio transport
}
main().catch(console.error);
```

## After creating files

Run from repo root:

```bash
npm install          # picks up the new workspace package
cd packages/mcp
npm run typecheck    # should pass with the placeholder
```

## Acceptance criteria

- [ ] `packages/mcp/` directory exists with package.json, tsconfig.json, src/index.ts
- [ ] `npm install` at repo root succeeds and links the workspace package
- [ ] `npm run typecheck` in `packages/mcp` passes
