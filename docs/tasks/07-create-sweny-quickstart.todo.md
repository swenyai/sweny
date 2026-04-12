# Task 07: `npx create-sweny` Quickstart CLI

## Goal
Create a standalone `create-sweny` npm package that bootstraps a SWEny project in one command. This is the "zero to running workflow" experience.

## Context
- Pattern: like `create-next-app`, `create-vite`, `create-astro`
- Should work as `npx create-sweny` or `npm create sweny`
- Installs `@sweny-ai/core`, creates config, offers starter template, runs first workflow
- The existing `sweny init` wizard is in `packages/core/src/cli/init.ts` — reuse its logic

## Design

### User Experience
```
$ npx create-sweny

  ╭──────────────────────────────╮
  │  Create SWEny Project  v1.0  │
  ╰──────────────────────────────╯

? Project directory: ./my-project (or .)
? Source control: GitHub / GitLab / None
? Issue tracker: GitHub Issues / Linear / Jira / None  
? Observability: Datadog / Sentry / None
? Start with a template?
  ● PR Review Bot — Review PRs automatically
  ○ Issue Triage — Classify and route issues
  ○ Security Scan — Audit code for vulnerabilities
  ○ Blank — Start from scratch

  ✓ Created .sweny.yml
  ✓ Created .env (add your API keys)
  ✓ Created .sweny/workflows/pr-review.yml
  ✓ Installed @sweny-ai/core

  Next steps:
  1. Add your API key to .env
  2. Run: npx sweny workflow run .sweny/workflows/pr-review.yml
  
  Docs: https://docs.sweny.ai
```

## Implementation

### 1. Create new package
Create `packages/create-sweny/` in the monorepo:
```
packages/create-sweny/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts
```

**package.json:**
```json
{
  "name": "create-sweny",
  "version": "1.0.0",
  "description": "Create a new SWEny AI workflow project",
  "type": "module",
  "bin": {
    "create-sweny": "./dist/index.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@clack/prompts": "^1.2.0",
    "chalk": "^5.0.0"
  }
}
```

### 2. Core logic (`src/index.ts`)
- Shebang: `#!/usr/bin/env node`
- Use `@clack/prompts` for interactive flow (same as `sweny init`)
- Accept optional directory argument: `npx create-sweny my-project`
- Steps:
  1. Create/enter directory
  2. Run provider selection (reuse logic pattern from init.ts)
  3. Offer template selection (reuse templates from Task 04)
  4. Generate `.sweny.yml`
  5. Generate `.env` template
  6. Write selected template workflow
  7. Optionally install `@sweny-ai/core` via `npm install`
  8. Print next steps

### 3. Reuse vs duplicate
- Don't import from `@sweny-ai/core` (circular dep, and we want `create-sweny` to be standalone)
- Copy/inline the essential config generation logic
- Reference the template YAML strings directly
- Keep it minimal — this is a scaffolding tool, not the full CLI

### 4. Add to workspace
Update root `package.json` workspaces to include `packages/create-sweny`.

## Files to Create
- `packages/create-sweny/package.json`
- `packages/create-sweny/tsconfig.json`
- `packages/create-sweny/src/index.ts`

## Files to Modify
- Root `package.json` — add to workspaces (already `packages/*` glob, so automatic)

## Acceptance Criteria
- [ ] `packages/create-sweny/` package created
- [ ] Interactive wizard with provider + template selection
- [ ] Generates `.sweny.yml`, `.env`, and optional workflow template
- [ ] Prints clear next-steps instructions
- [ ] Builds successfully (`npm run build --workspace=packages/create-sweny`)
- [ ] Can run via `node dist/index.js` locally
