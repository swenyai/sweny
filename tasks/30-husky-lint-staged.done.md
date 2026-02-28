# Task 30: Setup Husky + lint-staged Pre-commit Hooks

## Goal
Add pre-commit hooks using Husky and lint-staged so formatting and linting are enforced before each commit.

## Context
- ESLint and Prettier are already configured at root
- CI already runs `npm run lint` and `npm run format:check`
- No pre-commit hooks exist yet
- Root package.json has scripts: `lint`, `lint:fix`, `format`, `format:check`

## Implementation

### 1. Install dependencies
```bash
npm install -D husky lint-staged
```

### 2. Initialize Husky
```bash
npx husky init
```
This creates `.husky/pre-commit` with a default script.

### 3. Configure lint-staged in root package.json
Add to root `package.json`:
```json
{
  "lint-staged": {
    "*.{ts,tsx,js,mjs}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{json,yml,yaml,md,mdx}": [
      "prettier --write"
    ]
  }
}
```

### 4. Update .husky/pre-commit
```bash
npx lint-staged
```

### 5. Add prepare script to root package.json
```json
{
  "scripts": {
    "prepare": "husky"
  }
}
```

## Verification
- Make a small formatting change to a file
- Run `git add` + `git commit` and verify the hook runs lint-staged
- Verify `npm run prepare` works (for CI / fresh installs)

## Commit
```bash
git add package.json .husky/ package-lock.json
git commit -m "chore: add Husky + lint-staged pre-commit hooks

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
