# Fix Declined — LOCAL-2

**Date**: 2026-03-12
**Issue**: Auth Middleware Null Guard Missing on userId Access
**Confidence in decline**: High

## Reason

The target file `/src/middleware/auth.ts` does not exist in this repository. The `api-gateway`
service identified in the error logs is not part of the `swenyai/sweny` monorepo.

The triage analysis itself acknowledges this uncertainty:

> `.github/service-map.yml` was not found in this repository. The `api-gateway` service
> referenced in the logs could not be matched to a specific repo. TARGET_REPO is set to
> the current repo (`swenyai/sweny`) as a fallback.

A glob search for `**/middleware/auth.ts` and `**/auth.ts` returned no results across the
entire monorepo. There is no Express/HTTP server code in any published package here —
this is a DAG engine + CLI + GitHub Action toolchain, not an API gateway service.

## Action Required

1. Create `.github/service-map.yml` mapping service names to repository owners.
2. Re-dispatch this triage issue to the correct repository once `api-gateway` is mapped.
3. The fix itself is valid and straightforward — a single null guard before `decodedToken.userId`
   — it just needs to be applied in the right repo.
