# Task: npm publish CI pipeline for engine, providers, and cli packages

## Why

`@sweny-ai/engine`, `@sweny-ai/providers`, and `@sweny-ai/cli` are public npm packages
(no `"private": true`) but there is no automated publish step. Releases currently require
manual `npm publish` runs. A GitHub Actions release workflow fixes this.

---

## Packages to publish

| Package | Name | Current version |
|---------|------|-----------------|
| `packages/engine` | `@sweny-ai/engine` | 0.2.0 |
| `packages/providers` | `@sweny-ai/providers` | 0.2.0 |
| `packages/cli` | `@sweny-ai/cli` | 0.2.0 |

`packages/action` and `packages/web` are `private: true` — do NOT publish.

---

## Trigger

Publish on **GitHub Release** creation (tag pushed + release created in GitHub UI).
This lets you control the exact moment of publish and keeps the tag as the source of truth.

```yaml
on:
  release:
    types: [published]
```

---

## File to create

**`.github/workflows/release.yml`**

```yaml
name: Release

on:
  release:
    types: [published]

jobs:
  publish:
    name: Publish to npm
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write  # for npm provenance

    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
          cache: npm

      - run: npm ci

      # Build providers first — engine and cli depend on it
      - name: Build providers
        run: npm run build --workspace=packages/providers

      - name: Build engine
        run: npm run build --workspace=packages/engine

      - name: Build cli
        run: npm run build --workspace=packages/cli

      # Run tests before publishing
      - name: Test
        run: npm run test

      - name: Publish @sweny-ai/providers
        run: npm publish --workspace=packages/providers --provenance --access=public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Publish @sweny-ai/engine
        run: npm publish --workspace=packages/engine --provenance --access=public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Publish @sweny-ai/cli
        run: npm publish --workspace=packages/cli --provenance --access=public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## Version bump strategy

Do NOT auto-bump in CI. The release tag drives the version. Before creating a GitHub Release:

1. Update `version` in `packages/engine/package.json`, `packages/providers/package.json`,
   and `packages/cli/package.json` to match the intended release (e.g. `0.3.0`)
2. Commit and push
3. Create a GitHub Release with tag `v0.3.0`
4. The workflow publishes to npm automatically

---

## Repository secret required

Add `NPM_TOKEN` to GitHub repo secrets (Settings → Secrets → Actions):
- Token type: **Granular Access Token** scoped to `@sweny-ai` packages with publish permission
- Or a legacy **Automation token** for the `swenyai` npm org

---

## `.npmrc` check

Verify each publishable package's `package.json` has:
```json
"publishConfig": {
  "access": "public"
}
```

If missing, add it — this ensures scoped packages (`@sweny-ai/*`) default to public.
The `--access=public` flag in the workflow is a fallback, but explicit is better.

---

## Notes

- `--provenance` links the npm package to the GitHub Actions run via OIDC — requires
  `id-token: write` permission and npm ≥ 9.5. Provides supply chain transparency.
- Providers must be published before engine (engine's build imports provider types).
- If a package has no changes since last publish, `npm publish` will fail with
  "cannot publish over existing version" — that is expected and acceptable. Consider
  adding `|| true` or checking versions first if you want silent no-ops.
