# Task: Fix npm audit vulnerabilities (svgo HIGH, fast-xml-parser LOW)

## Vulnerabilities

| Severity | Package | Advisory | Path |
|----------|---------|----------|------|
| HIGH | `svgo@4.0.0` | GHSA-xpqw-6gx7-v673 — DoS via entity expansion in DOCTYPE | `packages/web` → astro → astro-expressive-code → @astrojs/starlight |
| LOW | `fast-xml-parser` | GHSA-fj3w-jwp8-x2g3 — stack overflow with `preserveOrder` | `packages/providers` → @aws-sdk/client-cloudwatch-logs → @aws-sdk/core → @aws-sdk/xml-builder |

---

## Fix 1 — svgo (HIGH, in packages/web)

**Attack surface:** Build-time only. svgo is used by the Astro/Starlight docs site to
optimize SVGs during `npm run build`. It is never executed at runtime or in CI tests.
The DoS advisory requires an attacker to control the SVG input to the build process —
not possible in our pipeline. Risk is minimal but the severity flag should be resolved.

**Approach:** Upgrade `@astrojs/starlight` — it likely ships a fixed version of svgo
in a recent release.

```bash
cd packages/web
npm update @astrojs/starlight
```

If the update brings in a patched svgo (≥ 4.0.1 or whatever the fix version is),
the advisory clears.

**Fallback — npm overrides:** If `@astrojs/starlight` hasn't patched yet, force a
safe svgo version via the root `package.json`:

```json
"overrides": {
  "svgo": "^3.3.2"
}
```

Verify the Starlight build still works after the override (`npm run build --workspace=packages/web`).

---

## Fix 2 — fast-xml-parser (LOW, in packages/providers)

**Attack surface:** Development/test dependency only. `@aws-sdk/client-cloudwatch-logs`
is a `devDependency` of `packages/providers` (used in tests). It is never bundled or
deployed. The stack overflow requires calling `XMLBuilder` with `preserveOrder: true` on
attacker-controlled input — this does not apply to the AWS SDK's internal usage.

**Approach:** Upgrade the AWS SDK packages to a version that depends on a patched
`fast-xml-parser`:

```bash
cd packages/providers
npm update @aws-sdk/client-cloudwatch-logs
```

AWS SDK releases frequently; a recent minor should pull in the patch.

**Fallback — npm overrides:** If no fixed version exists upstream yet:
```json
"overrides": {
  "fast-xml-parser": "^4.5.2"
}
```

Verify CloudWatch provider tests still pass (`npm test --workspace=packages/providers`).

---

## Steps

1. Run `npm audit` to confirm current state
2. Try `npm update` for the affected packages
3. Run `npm audit` again — verify both advisories are resolved
4. Run full test suite: `npm test`
5. If tests pass, commit:
   ```
   fix: resolve npm audit advisories (svgo HIGH, fast-xml-parser LOW)
   ```
6. If `npm overrides` was needed, note it in the commit message

---

## Acceptance

`npm audit --audit-level=low` exits 0 (no advisories at any level).
All 514+ tests still pass.
