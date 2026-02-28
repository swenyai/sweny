# Task 16 — Add ESLint + Prettier

## Objective

Add lint and format tooling to the monorepo. No config exists yet — first contributor PRs will have inconsistent style.

## Project Context

- **Monorepo** with npm workspaces: `packages/agent`, `packages/action`, `packages/providers`, `packages/web`
- **TypeScript** ESM throughout (`"type": "module"` in all package.json files)
- **Node >= 22** (engines field in root package.json)
- **Root package.json** at `/Users/nate/src/swenyai/sweny/package.json`
- **No existing lint config** — no `.eslintrc`, `eslint.config.*`, `.prettierrc`, or `prettier.config.*`

## Files to Create

### 1. `eslint.config.js` (root, flat config — ESLint v9+)

Use the new flat config format. Config should:
- Target TypeScript files (`**/*.ts`)
- Use `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`
- Ignore `dist/`, `node_modules/`, `.next/`, coverage dirs
- Rules: `no-unused-vars` (warn, allow `_` prefix), `no-console` (warn), basic TS strict rules
- Keep it minimal — don't fight existing code patterns

### 2. `prettier.config.js` (root)

Match the existing code style observable in the codebase:
- 2-space indent
- Double quotes (the codebase uses double quotes for imports)
- Trailing commas: `all`
- Semicolons: yes
- Print width: 120 (the codebase has wide lines)
- Single attribute per line: false

### 3. `.prettierignore` (root)

Ignore: `dist/`, `node_modules/`, `*.md`, `packages/web/.next/`, coverage

## Files to Modify

### 4. Root `package.json` — add scripts

```json
"lint": "eslint .",
"lint:fix": "eslint . --fix",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

## Dev Dependencies to Install (root)

```
eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier eslint-config-prettier
```

Install as root devDependencies: `npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier eslint-config-prettier`

## Verification

1. `npm run lint` — should run without crashing (warnings OK, errors NOT OK)
2. `npm run format:check` — should run and report any unformatted files
3. `npm test` — all 343 tests still pass (lint/format don't touch runtime)

## Notes

- Do NOT run `format` (write mode) as part of this task — just set up the config
- Do NOT add husky/lint-staged yet — that's optional and can be a follow-up
- The `packages/web/` directory (Next.js docs site) should be included in lint but may need some rule exceptions
