# Task: Add `recipe` input to action — route to any engine recipe

## Depends on
- `engine-triage-dag.todo.md` must be done (triageRecipe exported)
- `engine-implement-dag.todo.md` must be done (implementRecipe exported)

## Goal
Add a `recipe` input to `action.yml` so users can choose which recipe to run.
Default to `triage` for backwards compatibility. Route in `main.ts` to the
correct engine recipe. Rebuild `dist/index.js`.

This turns "SWEny Triage Action" into "SWEny — pick your recipe".

## 1. Update `action.yml`

Add this input block BEFORE the `anthropic-api-key` input (i.e. first input):

```yaml
  recipe:
    description: "Recipe to run (triage, implement). Default: triage."
    required: false
    default: "triage"
```

## 2. Update `packages/action/src/config.ts`

Add `recipe` to the config schema and parsed config:

```typescript
// In the Zod schema:
recipe: z.enum(["triage", "implement"]).default("triage"),

// In ActionConfig type (if manually defined, add):
recipe: "triage" | "implement";
```

## 3. Update `packages/action/src/main.ts`

Replace the single `runRecipe(triageRecipe, ...)` call with a router:

```typescript
import { runRecipe, triageRecipe, implementRecipe } from "@sweny-ai/engine";
// ...

const recipe = config.recipe ?? "triage";

if (recipe === "implement") {
  // implement recipe needs ImplementConfig
  const implConfig = mapToImplementConfig(config);
  result = await runRecipe(implementRecipe, implConfig, providers, runOptions);
} else {
  // default: triage
  const triageConfig = mapToTriageConfig(config);
  result = await runRecipe(triageRecipe, triageConfig, providers, runOptions);
}
```

You'll need a `mapToImplementConfig(config: ActionConfig): ImplementConfig` function.
Look at `mapToTriageConfig` for the pattern. `ImplementConfig` needs:
- `issueIdentifier`: from `config.linearIssue` (the existing `linear-issue` input)
- `repository`: from `config.repository`
- `dryRun`, `maxImplementTurns`, `baseBranch`, `prLabels`, `agentEnv`, etc.

## 4. Update `action.yml` inputs documentation — add implement-specific section

After the `linear-issue` input description, note that it is required when `recipe: implement`:

```yaml
  linear-issue:
    description: "Issue to implement (e.g. ENG-123 or github#42). Required when recipe is implement."
    required: false
    default: ""
```

## 5. Rebuild dist

```bash
cd /path/to/repo
npm run build --workspace=packages/providers
npm run build --workspace=packages/engine
npm run package --workspace=packages/action
```

The `dist/index.js` will be regenerated. Stage and commit it.

## 6. Update README

In the inputs table, add `recipe` as the very first input under Authentication:

```markdown
| `recipe` | Recipe to run (`triage`, `implement`) | `triage` |
```

Add a brief example for `implement`:
```yaml
- uses: swenyai/sweny@v1
  with:
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    recipe: implement
    linear-issue: ENG-123
    linear-api-key: ${{ secrets.LINEAR_API_KEY }}
    linear-team-id: ${{ vars.LINEAR_TEAM_ID }}
```

## Verification

```bash
npm run build        # whole monorepo
npm run typecheck    # 0 errors
npx vitest run       # in packages/action
```

Check that:
- `action.yml` has `recipe` as first input with `default: "triage"`
- `dist/index.js` is rebuilt (file date will be today)
- `recipe: triage` still works exactly as before (backwards compat)

## Notes
- Do NOT break existing triage users — `recipe` defaults to `triage`.
- The `implement` recipe requires `linear-issue` or `github-issue` to be set.
  Add a validation error in `mapToImplementConfig` if it's missing.
- Commit message: `feat(action): add recipe input — triage (default) and implement`
