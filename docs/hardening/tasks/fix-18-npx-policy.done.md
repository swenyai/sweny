# Fix #18: Encode `npx -y` policy in metadata

_Part of HARDENING_PLAN.v1.claude.md (P4). **Depends on Fix #15** (MCP catalog)._

## Goal

The `npx -y` exception is documented in `ARCHITECTURE.md` but not enforced. Fix #15 introduces `MCP_CATALOG` — extend it so every stdio entry declares why `npx -y` is acceptable, and fail CI if a future entry violates the policy.

## Why this matters

`ARCHITECTURE.md` states: "don't use `npx -y`" except for a small documented list of official first-party vendor servers. Today this is enforced by convention. A contributor adding a new provider with `command: "npx", args: ["-y", "somerandom-mcp-server"]` wouldn't trip anything until a reviewer notices.

Encoding the policy in data + a test closes the gap.

## Current state (after Fix #15)

`MCP_CATALOG` entries already have:

```ts
transport: "http" | "stdio";
npxExceptionReason: string | null;
```

This task adds the tests + docs that make the policy load-bearing.

## What to do

### Step 1 — enforce at catalog-definition time

In `packages/core/src/mcp.test.ts` (or `mcp-catalog.test.ts`), add:

```ts
it("every stdio entry has an npxExceptionReason", () => {
  for (const entry of MCP_CATALOG) {
    if (entry.transport === "stdio") {
      expect(entry.npxExceptionReason).not.toBeNull();
      expect(entry.npxExceptionReason!.length).toBeGreaterThan(10);
    }
  }
});

it("every http entry has a null npxExceptionReason (no exception needed)", () => {
  for (const entry of MCP_CATALOG) {
    if (entry.transport === "http") {
      expect(entry.npxExceptionReason).toBeNull();
    }
  }
});
```

### Step 2 — runtime enforcement (defense-in-depth)

Add a small assertion function in `mcp.ts`:

```ts
function assertNpxPolicyCompliant(entry: McpCatalogEntry): void {
  if (entry.transport === "stdio" && entry.npxExceptionReason === null) {
    throw new Error(
      `MCP catalog entry "${entry.id}" uses stdio transport but declares no npxExceptionReason. ` +
      `See ARCHITECTURE.md for the policy.`,
    );
  }
}
```

Call it once at module load over `MCP_CATALOG` so any future entry that slips past test review still throws at boot. This catches the case where someone bypasses the test (e.g. commits with `.skip`).

### Step 3 — update ARCHITECTURE.md

Add a pointer to the catalog:

> The authoritative list of `npx -y` exceptions lives in `packages/core/src/mcp-catalog.ts` as `MCP_CATALOG[].npxExceptionReason`. Update both the code and this document together.

Make sure the list of official vendor servers matches what's in the catalog post-Fix #15.

### Step 4 — expose for external tooling

Add a lightweight export so `sweny check` can surface the policy state:

- In `packages/core/src/index.ts`, export `MCP_CATALOG` and `McpCatalogEntry`.
- Wire a simple `sweny check --mcp-policy` subcommand that prints the catalog with transport + exception reason. One-table output, ~20 lines of code.
- Optional — skip if time-boxed, but nice for ops transparency.

## Acceptance criteria

- [ ] `npm test` fails if any stdio entry has `npxExceptionReason: null`.
- [ ] `npm test` fails if any http entry has a non-null `npxExceptionReason` (keep the fields tight).
- [ ] Module-load-time assertion protects against `.skip`'d tests.
- [ ] `ARCHITECTURE.md` points to the catalog.
- [ ] No user-visible behavior change; this is purely policy enforcement.

## Out of scope

- Proxy/cache for `npx -y` fetches (separate supply-chain concern).
- Pinned version lockfile for MCP servers (also separate).
- The `sweny check --mcp-policy` subcommand is optional. Ship it only if you have budget.

## Verify when done

```bash
cd packages/core
# Artificially break one entry in MCP_CATALOG (stdio with null reason)
# `npm test` should now fail. Restore and commit.
npm test
```
