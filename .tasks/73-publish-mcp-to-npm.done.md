# Publish @sweny-ai/mcp to npm

**Package:** `packages/mcp`
**Depends on:** nothing

## Goal

Make `@sweny-ai/mcp` a public npm package so users can run it via `npx @sweny-ai/mcp` or `npx sweny-mcp`. Every push to main auto-publishes — no manual release needed.

## What to change

### 1. `packages/mcp/package.json`

- Remove `"private": true`
- Add `"publishConfig": { "access": "public" }` (same as `@sweny-ai/core`)
- Change `@sweny-ai/core` dependency from `"*"` (workspace link) to `"^0.1.0"` so npm can resolve it when installed standalone

### 2. `.github/workflows/release.yml`

Add the mcp package to the change detection and publish block. The pattern is already established for core and studio.

After the `CHANGED_STUDIO` line (~line 54), add:
```bash
CHANGED_MCP=$(git diff --name-only "$DIFF_BASE"..HEAD -- packages/mcp/ | head -1)
```

After the studio publish block (~line 88), add:
```bash
if [ -n "$CHANGED_MCP" ]; then
  cd packages/mcp
  LOCAL_VER=$(node -p "require('./package.json').version")
  NPM_VER=$(npm view @sweny-ai/mcp version 2>/dev/null || echo "0.0.0")

  if [ "$LOCAL_VER" = "$NPM_VER" ]; then
    NEXT=$(echo "$LOCAL_VER" | awk -F. '{$NF=$NF+1; print}' OFS=.)
    npm version "$NEXT" --no-git-tag-version
  fi

  npm publish
  PUBLISHED=true
  echo "Published @sweny-ai/mcp@$(node -p "require('./package.json').version")"
  cd ../..
fi
```

Also add `npm run build --workspace=packages/mcp` to the Build step (~line 34).

### 3. Update docs — restore `npx` setup instructions

Now that the package will be on npm, update the setup instructions in:
- `packages/mcp/README.md` — primary method should be `npx @sweny-ai/mcp` (the npm package name)
- `packages/web/src/content/docs/advanced/mcp-plugin.md` — same

The `bin.sweny-mcp` field in package.json means `npx sweny-mcp` works. But `npx @sweny-ai/mcp` also works (runs the package's bin). Show both.

## Notes

- The `@sweny-ai/core` dep must be a proper version range (not `"*"`) for npm to resolve it when someone installs `@sweny-ai/mcp` standalone
- The `yaml` and `zod` deps are already proper ranges, so they're fine
- `@types/node` and `typescript` stay in devDependencies — they're not needed at runtime

## Verification

After merge to main, the release workflow should:
1. Detect changes in `packages/mcp/`
2. Bump the version if it matches npm
3. Publish to npm
4. The package should be installable: `npx @sweny-ai/mcp` or `npx sweny-mcp`

## Acceptance criteria

- [ ] `"private": true` removed from package.json
- [ ] `publishConfig.access` set to `"public"`
- [ ] `@sweny-ai/core` dependency uses a proper version range
- [ ] Release workflow builds and publishes mcp package
- [ ] Docs show correct `npx` setup instructions
