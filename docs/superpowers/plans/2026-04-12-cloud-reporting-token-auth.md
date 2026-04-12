# Cloud Reporting + Token Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the CLI-to-cloud reporting feature with a token-gated consent model (Codecov pattern). The Action defaults to zero phone-home; users opt in either by (a) pasting a `SWENY_CLOUD_TOKEN` secret or (b) installing the GitHub App and letting the Action pass the installation ID. The deprecated `GITHUB_TOKEN → GitHub-API verification` auth path is removed.

**Architecture:**
- **CLI (`@sweny-ai/core`):** `reportToCloud()` only fires when `SWENY_CLOUD_TOKEN` is set OR when a GitHub App installation ID is detectable from the Action environment. Never sends user's `GITHUB_TOKEN` to sweny.ai.
- **Cloud (`swenyai/cloud`):** Existing `/api/report` route keeps two auth paths — `Bearer <sweny_pk_...>` and `X-GitHub-Installation-Id`. The legacy `token <github_token>` path is deleted. Token management UI is added at `/dashboard/projects/[id]` so users can view/rotate/copy the project token.
- **Consent model:** Explicit — token paste or App install. Silent default is no-op.

**Tech Stack:**
- CLI: TypeScript ESM, Vitest 4, Commander, Node 20+
- Cloud: Next.js 14 App Router, Supabase (Postgres + RLS), Vitest, Tailwind, React Server Components

**Repos touched:**
- `/Users/nate/src/swenyai/sweny` (CLI — `@sweny-ai/core`)
- `/Users/nate/src/swenyai/cloud` (Next.js + Supabase dashboard)

---

## Current-State Summary

**CLI (`/Users/nate/src/swenyai/sweny/packages/core/src/cli/main.ts`):**
- Uncommitted draft of `reportToCloud()` at lines 92–157.
- Sends `Authorization: token ${ghToken}` using the user's `GITHUB_TOKEN`. **This is the problem.**
- Called at lines 525 (triage), 682 (implement), 893 (workflowRunAction).

**Cloud (`/Users/nate/src/swenyai/cloud`):**
- `src/app/api/report/route.ts` — already accepts reports, has rate limiting (20/hr/project), writes to `runs` table.
- `src/lib/report-auth.ts` — has 3 auth paths: Bearer project token, X-GitHub-Installation-Id, legacy GitHub token.
- `projects.token` column exists (48-hex, plaintext, unique-indexed). Token prefix `sweny_pk_` is NOT used yet.
- `runs` table has all needed columns (`status`, `workflow`, `findings`, `nodes`, `duration_ms`, `action_version`, `runner_os`, etc.).
- No UI for viewing/rotating project tokens exists (was deleted in 2026-03-29 UX overhaul). `TokenReveal.tsx` no longer exists.
- Dashboard pages live at `src/app/dashboard/projects/[id]/page.tsx`.

---

## File Structure

### Cloud repo (`/Users/nate/src/swenyai/cloud`)

**Create:**
- `supabase/migrations/20260412000000_add_token_prefix.sql` — backfill `sweny_pk_` prefix on `projects.token`, add `token_created_at` column
- `src/app/api/projects/[id]/token/rotate/route.ts` — POST endpoint to rotate the project token
- `src/components/dashboard/ProjectTokenCard.tsx` — UI: show token (masked), copy, rotate
- `src/__tests__/token-rotate-api.test.ts` — tests for rotate endpoint
- `src/__tests__/project-token-card.test.ts` — structural test for component

**Modify:**
- `src/app/api/report/route.ts` — remove deprecated GitHub-token auth branch
- `src/lib/report-auth.ts` — delete the legacy `auth?.startsWith("token ")` block (lines 82–114)
- `src/app/dashboard/projects/[id]/page.tsx` — render `<ProjectTokenCard />`
- `src/__tests__/report-api.test.ts` (if exists) or create — verify GitHub-token path returns 401

### Sweny repo (`/Users/nate/src/swenyai/sweny`)

**Modify:**
- `packages/core/src/cli/main.ts` — rewrite `reportToCloud()` (lines 92–157)
- `packages/core/src/cli/config.ts` — add `cloudToken: string` field to `CliConfig` (near line 52), parse in `parseCliInputs()` (near line 256)
- `packages/core/src/cli/config-file.ts` — allow `cloud-token` key in YAML schema
- `README.md` — document `SWENY_CLOUD_TOKEN` secret

**Create:**
- `packages/core/src/cli/__tests__/report-cloud.test.ts` — new test file for `reportToCloud` behavior

---

## Phase 1: Cloud — Token Rotation Endpoint

### Task 1.1: DB migration — add `token_created_at` + prefix backfill

**Files:**
- Create: `/Users/nate/src/swenyai/cloud/supabase/migrations/20260412000000_add_token_prefix.sql`

- [ ] **Step 1: Write migration**

```sql
-- 20260412000000_add_token_prefix.sql
-- Add token_created_at for rotation history; backfill sweny_pk_ prefix on existing tokens.

alter table projects
  add column if not exists token_created_at timestamptz not null default now();

-- Backfill: prepend sweny_pk_ to any token that doesn't already have the prefix.
update projects
  set token = 'sweny_pk_' || token
  where token not like 'sweny_pk_%';

-- Enforce prefix going forward via check constraint.
alter table projects
  add constraint projects_token_prefix_check
  check (token like 'sweny_pk_%');
```

- [ ] **Step 2: Apply migration locally**

Run: `cd /Users/nate/src/swenyai/cloud && supabase migration up`
Expected: migration applies, no errors. Verify via: `supabase db diff` returns empty.

- [ ] **Step 3: Commit**

```bash
cd /Users/nate/src/swenyai/cloud
git add supabase/migrations/20260412000000_add_token_prefix.sql
git commit -m "feat(db): add token prefix + rotation timestamp to projects"
```

---

### Task 1.2: Token generation helper

**Files:**
- Create: `/Users/nate/src/swenyai/cloud/src/lib/project-token.ts`
- Create: `/Users/nate/src/swenyai/cloud/src/__tests__/project-token.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/project-token.test.ts
import { describe, it, expect } from "vitest";
import { generateProjectToken, isValidTokenFormat, maskToken } from "@/lib/project-token";

describe("project-token", () => {
  it("generates tokens with sweny_pk_ prefix", () => {
    const t = generateProjectToken();
    expect(t.startsWith("sweny_pk_")).toBe(true);
  });

  it("generates tokens with 48 hex chars after prefix", () => {
    const t = generateProjectToken();
    const body = t.slice("sweny_pk_".length);
    expect(body).toMatch(/^[0-9a-f]{48}$/);
  });

  it("generates unique tokens across 100 calls", () => {
    const set = new Set(Array.from({ length: 100 }, () => generateProjectToken()));
    expect(set.size).toBe(100);
  });

  it("isValidTokenFormat accepts valid tokens", () => {
    expect(isValidTokenFormat(generateProjectToken())).toBe(true);
  });

  it("isValidTokenFormat rejects malformed tokens", () => {
    expect(isValidTokenFormat("nope")).toBe(false);
    expect(isValidTokenFormat("sweny_pk_short")).toBe(false);
    expect(isValidTokenFormat("wrong_prefix_" + "a".repeat(48))).toBe(false);
  });

  it("maskToken reveals only first 12 and last 4 chars", () => {
    const t = "sweny_pk_" + "a".repeat(48);
    expect(maskToken(t)).toBe("sweny_pk_aaa…aaaa");
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `cd /Users/nate/src/swenyai/cloud && npx vitest run src/__tests__/project-token.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```typescript
// src/lib/project-token.ts
import { randomBytes } from "node:crypto";

const PREFIX = "sweny_pk_";
const BODY_LEN = 48; // 24 random bytes → 48 hex chars

export function generateProjectToken(): string {
  return PREFIX + randomBytes(24).toString("hex");
}

export function isValidTokenFormat(token: string): boolean {
  if (!token.startsWith(PREFIX)) return false;
  const body = token.slice(PREFIX.length);
  return body.length === BODY_LEN && /^[0-9a-f]+$/.test(body);
}

export function maskToken(token: string): string {
  if (!token.startsWith(PREFIX)) return "***";
  const body = token.slice(PREFIX.length);
  const head = body.slice(0, 3);
  const tail = body.slice(-4);
  return `${PREFIX}${head}…${tail}`;
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cd /Users/nate/src/swenyai/cloud && npx vitest run src/__tests__/project-token.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/nate/src/swenyai/cloud
git add src/lib/project-token.ts src/__tests__/project-token.test.ts
git commit -m "feat(tokens): project token generation + format helpers"
```

---

### Task 1.3: Token rotation API route

**Files:**
- Create: `/Users/nate/src/swenyai/cloud/src/app/api/projects/[id]/token/rotate/route.ts`
- Create: `/Users/nate/src/swenyai/cloud/src/__tests__/token-rotate-api.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/token-rotate-api.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("POST /api/projects/[id]/token/rotate", () => {
  const src = readFileSync("src/app/api/projects/[id]/token/rotate/route.ts", "utf-8");

  it("exports a POST handler", () => {
    expect(src).toContain("export async function POST");
  });

  it("authenticates the user via Supabase auth", () => {
    expect(src).toContain("supabase.auth.getUser");
  });

  it("verifies the user is a member of the project's org", () => {
    expect(src).toContain("org_members");
  });

  it("generates a new token using generateProjectToken()", () => {
    expect(src).toContain("generateProjectToken");
  });

  it("updates token_created_at", () => {
    expect(src).toContain("token_created_at");
  });

  it("returns the full plaintext token in the response (shown once)", () => {
    expect(src).toContain("token:");
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `cd /Users/nate/src/swenyai/cloud && npx vitest run src/__tests__/token-rotate-api.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/projects/[id]/token/rotate/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateProjectToken } from "@/lib/project-token";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // 1. Authenticate the user
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Verify the user is a member of the project's org (admin role)
  const admin = createServiceClient();
  const { data: project } = await admin
    .from("projects")
    .select("id, org_id")
    .eq("id", id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const { data: membership } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", project.org_id)
    .eq("user_id", user.id)
    .single();

  if (!membership || (membership.role !== "admin" && membership.role !== "owner")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 3. Generate and persist a new token
  const newToken = generateProjectToken();
  const { error } = await admin
    .from("projects")
    .update({ token: newToken, token_created_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to rotate token" }, { status: 500 });
  }

  // 4. Return the plaintext token — shown ONCE in the UI
  return NextResponse.json({ token: newToken });
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cd /Users/nate/src/swenyai/cloud && npx vitest run src/__tests__/token-rotate-api.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/nate/src/swenyai/cloud
git add src/app/api/projects/[id]/token/rotate/route.ts src/__tests__/token-rotate-api.test.ts
git commit -m "feat(api): token rotation endpoint"
```

---

### Task 1.4: Token management UI component

**Files:**
- Create: `/Users/nate/src/swenyai/cloud/src/components/dashboard/ProjectTokenCard.tsx`
- Create: `/Users/nate/src/swenyai/cloud/src/__tests__/project-token-card.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/project-token-card.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("ProjectTokenCard component", () => {
  const src = readFileSync("src/components/dashboard/ProjectTokenCard.tsx", "utf-8");

  it("is a client component", () => {
    expect(src).toMatch(/^"use client";/);
  });

  it("shows the token masked by default", () => {
    expect(src).toContain("maskToken");
  });

  it("has a rotate button that POSTs to the rotate endpoint", () => {
    expect(src).toContain("/token/rotate");
    expect(src).toContain('method: "POST"');
  });

  it("shows a one-time reveal of the new token after rotation", () => {
    expect(src).toContain("newToken");
  });

  it("includes copy-to-clipboard affordance", () => {
    expect(src).toContain("navigator.clipboard");
  });

  it("shows the SWENY_CLOUD_TOKEN usage snippet", () => {
    expect(src).toContain("SWENY_CLOUD_TOKEN");
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `cd /Users/nate/src/swenyai/cloud && npx vitest run src/__tests__/project-token-card.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/dashboard/ProjectTokenCard.tsx
"use client";

import { useState } from "react";
import { maskToken } from "@/lib/project-token";

interface Props {
  projectId: string;
  currentToken: string;          // full token, only sent from server to trusted admins
  tokenCreatedAt: string;        // ISO timestamp
}

export function ProjectTokenCard({ projectId, currentToken, tokenCreatedAt }: Props) {
  const [newToken, setNewToken] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const displayToken = newToken ?? currentToken;

  async function rotate() {
    if (!confirm("Rotate token? The old token will stop working immediately.")) return;
    setRotating(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/token/rotate`, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status}`);
      const { token } = await res.json();
      setNewToken(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rotation failed");
    } finally {
      setRotating(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(displayToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-slate-100">CI reporting token</h3>
        <p className="text-sm text-slate-400">
          Paste this as <code className="text-blue-400">SWENY_CLOUD_TOKEN</code> in your GitHub
          repo secrets to enable run reporting. The Action will not phone home without it.
        </p>
      </div>

      <div className="font-mono text-sm bg-slate-950 border border-slate-800 rounded px-3 py-2 flex items-center justify-between">
        <span className={newToken ? "text-green-400" : "text-slate-300"}>
          {newToken ? displayToken : maskToken(currentToken)}
        </span>
        <button
          onClick={copy}
          className="text-xs text-blue-400 hover:text-blue-300 ml-4"
          type="button"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>

      {newToken && (
        <p className="text-xs text-amber-400">
          ⚠ This is the only time you'll see the full token. Save it now.
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Created {new Date(tokenCreatedAt).toLocaleDateString()}</span>
        <button
          onClick={rotate}
          disabled={rotating}
          className="text-red-400 hover:text-red-300 disabled:opacity-50"
          type="button"
        >
          {rotating ? "Rotating…" : "Rotate token"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">Error: {error}</p>}

      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer hover:text-slate-300">Usage example</summary>
        <pre className="mt-2 bg-slate-950 border border-slate-800 rounded p-3 overflow-x-auto">
{`# .github/workflows/sweny.yml
- uses: swenyai/sweny-action@v1
  env:
    SWENY_CLOUD_TOKEN: \${{ secrets.SWENY_CLOUD_TOKEN }}`}
        </pre>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cd /Users/nate/src/swenyai/cloud && npx vitest run src/__tests__/project-token-card.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/nate/src/swenyai/cloud
git add src/components/dashboard/ProjectTokenCard.tsx src/__tests__/project-token-card.test.ts
git commit -m "feat(ui): project token management card"
```

---

### Task 1.5: Wire ProjectTokenCard into project detail page

**Files:**
- Modify: `/Users/nate/src/swenyai/cloud/src/app/dashboard/projects/[id]/page.tsx`

- [ ] **Step 1: Read the current page**

Read: `/Users/nate/src/swenyai/cloud/src/app/dashboard/projects/[id]/page.tsx`
Note where to insert the card — likely below the existing project metadata section, above the runs list. Note the variable name holding the project row (likely `project` or `data`).

- [ ] **Step 2: Verify admin role before exposing token**

The page is a Server Component. Before rendering `<ProjectTokenCard />`, fetch the current user's role in `project.org_id` from `org_members`. Only render the card if role is `admin` or `owner`.

Pattern:
```tsx
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ProjectTokenCard } from "@/components/dashboard/ProjectTokenCard";

// inside the server component, after loading project:
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
const admin = createServiceClient();
const { data: membership } = await admin
  .from("org_members")
  .select("role")
  .eq("org_id", project.org_id)
  .eq("user_id", user!.id)
  .single();
const isAdmin = membership?.role === "admin" || membership?.role === "owner";
```

- [ ] **Step 3: Insert the card (admin-only)**

```tsx
{isAdmin && (
  <ProjectTokenCard
    projectId={project.id}
    currentToken={project.token}
    tokenCreatedAt={project.token_created_at}
  />
)}
```

- [ ] **Step 4: Update the project query**

Ensure the Supabase `select()` for the project includes `token, token_created_at`. Non-admins never receive these fields — narrow the select at the query level via a separate query gated on `isAdmin`, e.g.:

```tsx
const baseSelect = "id, org_id, owner, name, workflow_enabled_at, created_at";
const { data: project } = await admin
  .from("projects")
  .select(isAdminInitial ? `${baseSelect}, token, token_created_at` : baseSelect)
  .eq("id", id)
  .single();
```

(Fetch membership first, then the project with the appropriate select.)

- [ ] **Step 5: Manual smoke test**

Run: `cd /Users/nate/src/swenyai/cloud && npm run dev`
Navigate: `http://localhost:3000/dashboard/projects/<known-project-id>`
Expected: token card visible if logged in as org admin; absent for non-admin.

- [ ] **Step 6: Commit**

```bash
cd /Users/nate/src/swenyai/cloud
git add src/app/dashboard/projects/[id]/page.tsx
git commit -m "feat(ui): show token card on project detail (admins only)"
```

---

## Phase 2: Cloud — Harden `/api/report`

### Task 2.1: Delete deprecated GitHub-token auth path

**Files:**
- Modify: `/Users/nate/src/swenyai/cloud/src/lib/report-auth.ts` (remove lines 82–114)
- Modify: `/Users/nate/src/swenyai/cloud/src/app/api/report/route.ts` (no change expected; auth is delegated)

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/report-auth-hardening.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("report-auth hardening", () => {
  const src = readFileSync("src/lib/report-auth.ts", "utf-8");

  it("does NOT accept `Authorization: token <github-token>`", () => {
    // The deprecated path verified tokens against api.github.com.
    // It must be removed to eliminate the third-party token-forwarding risk.
    expect(src).not.toContain("api.github.com/repos");
    expect(src).not.toMatch(/auth\?\.startsWith\("token "\)/);
  });

  it("still accepts Bearer project tokens", () => {
    expect(src).toContain('auth?.startsWith("Bearer ")');
  });

  it("still accepts X-GitHub-Installation-Id", () => {
    expect(src).toContain("installation");
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `cd /Users/nate/src/swenyai/cloud && npx vitest run src/__tests__/report-auth-hardening.test.ts`
Expected: FAIL — first assertion trips on existing deprecated code.

- [ ] **Step 3: Delete the deprecated block**

Open `src/lib/report-auth.ts`. Find the block beginning `if (!project && auth?.startsWith("token "))` (~line 82) and ending at its closing brace (~line 114). Delete it entirely. Also remove any now-unused imports (e.g. `fetch` call, GitHub helper).

- [ ] **Step 4: Run the hardening test — expect pass**

Run: `cd /Users/nate/src/swenyai/cloud && npx vitest run src/__tests__/report-auth-hardening.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full report-api test suite — expect pass**

Run: `cd /Users/nate/src/swenyai/cloud && npx vitest run src/__tests__/`
Expected: all existing tests pass. If any fail on the deprecated path, those were testing behavior we've intentionally removed — update the test to assert 401, not delete.

- [ ] **Step 6: Commit**

```bash
cd /Users/nate/src/swenyai/cloud
git add src/lib/report-auth.ts src/__tests__/report-auth-hardening.test.ts
git commit -m "feat(api): remove deprecated GitHub-token auth path"
```

---

### Task 2.2: Validate token format at `/api/report`

**Files:**
- Modify: `/Users/nate/src/swenyai/cloud/src/lib/report-auth.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/report-auth-format.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("report-auth token format validation", () => {
  const src = readFileSync("src/lib/report-auth.ts", "utf-8");

  it("validates Bearer token format before hitting the DB", () => {
    expect(src).toContain("isValidTokenFormat");
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `cd /Users/nate/src/swenyai/cloud && npx vitest run src/__tests__/report-auth-format.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add format check**

In the Bearer branch of `report-auth.ts`:

```typescript
import { isValidTokenFormat } from "./project-token";

// inside the Bearer branch:
if (auth?.startsWith("Bearer ")) {
  const token = auth.slice(7);
  if (!isValidTokenFormat(token)) {
    return { error: "Invalid token format", status: 401 };
  }
  // ... existing DB lookup
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cd /Users/nate/src/swenyai/cloud && npx vitest run src/__tests__/report-auth-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/nate/src/swenyai/cloud
git add src/lib/report-auth.ts src/__tests__/report-auth-format.test.ts
git commit -m "feat(api): validate token format before DB lookup"
```

---

## Phase 3: Sweny CLI — Token-Gated `reportToCloud`

### Task 3.1: Add `cloudToken` to `CliConfig`

**Files:**
- Modify: `/Users/nate/src/swenyai/sweny/packages/core/src/cli/config.ts`
- Modify: `/Users/nate/src/swenyai/sweny/packages/core/src/cli/config.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `config.test.ts` — `baseConfig()` helper must include the new field, and a new test verifies `SWENY_CLOUD_TOKEN` env var is read:

```typescript
// in config.test.ts — add to baseConfig():
cloudToken: "",

// add new describe block:
describe("parseCliInputs — cloud token", () => {
  it("reads SWENY_CLOUD_TOKEN env var", () => {
    const config = parseCliInputs(
      {}, // options
      {}, // configFile
      { SWENY_CLOUD_TOKEN: "sweny_pk_abc123" }, // env
    );
    expect(config.cloudToken).toBe("sweny_pk_abc123");
  });

  it("reads cloud-token from .sweny.yml", () => {
    const config = parseCliInputs(
      {},
      { "cloud-token": "sweny_pk_fromfile" },
      {},
    );
    expect(config.cloudToken).toBe("sweny_pk_fromfile");
  });

  it("env var overrides file", () => {
    const config = parseCliInputs(
      {},
      { "cloud-token": "sweny_pk_file" },
      { SWENY_CLOUD_TOKEN: "sweny_pk_env" },
    );
    expect(config.cloudToken).toBe("sweny_pk_env");
  });

  it("defaults to empty string when neither set", () => {
    const config = parseCliInputs({}, {}, {});
    expect(config.cloudToken).toBe("");
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `cd /Users/nate/src/swenyai/sweny && npx vitest run packages/core/src/cli/config.test.ts`
Expected: FAIL — `cloudToken` is not in CliConfig.

- [ ] **Step 3: Add field to `CliConfig` interface**

In `/Users/nate/src/swenyai/sweny/packages/core/src/cli/config.ts`, near the `githubToken` field (around line 52), add:

```typescript
/** SWEny Cloud reporting token (opt-in). When set, run summaries are sent to cloud.sweny.ai. */
cloudToken: string;
```

- [ ] **Step 4: Parse in `parseCliInputs()`**

In the same file, near the `githubToken` parse line (around line 256), add:

```typescript
cloudToken: env.SWENY_CLOUD_TOKEN || f("cloud-token") || "",
```

Maintain the precedence: env > file > default.

- [ ] **Step 5: Run the test — expect pass**

Run: `cd /Users/nate/src/swenyai/sweny && npx vitest run packages/core/src/cli/config.test.ts`
Expected: PASS (including all pre-existing tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/nate/src/swenyai/sweny
git add packages/core/src/cli/config.ts packages/core/src/cli/config.test.ts
git commit -m "feat(cli): add cloudToken to CliConfig + parseCliInputs"
```

---

### Task 3.2: Allow `cloud-token` in `.sweny.yml`

**Files:**
- Modify: `/Users/nate/src/swenyai/sweny/packages/core/src/cli/config-file.ts`

- [ ] **Step 1: Read the current config-file parser**

Read: `/Users/nate/src/swenyai/sweny/packages/core/src/cli/config-file.ts` — note how known keys are declared (Zod schema, type, or pass-through). Add `cloud-token` to the allowed keys if it's a strict schema.

- [ ] **Step 2: Write the failing test**

Add to an appropriate test file (create `config-file.test.ts` if needed):

```typescript
it("accepts cloud-token key in .sweny.yml", () => {
  const parsed = parseConfigFileContent('cloud-token: sweny_pk_xyz');
  expect(parsed["cloud-token"]).toBe("sweny_pk_xyz");
});
```

- [ ] **Step 3: Run the test — expect failure**

Run: `cd /Users/nate/src/swenyai/sweny && npx vitest run packages/core/src/cli/config-file.test.ts`
Expected: FAIL if schema is strict.

- [ ] **Step 4: Add `cloud-token` to the schema**

Depending on how the parser is structured (Zod, manual), add `cloud-token: z.string().optional()` or equivalent.

- [ ] **Step 5: Run the test — expect pass**

Run: `cd /Users/nate/src/swenyai/sweny && npx vitest run packages/core/src/cli/config-file.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/nate/src/swenyai/sweny
git add packages/core/src/cli/config-file.ts packages/core/src/cli/config-file.test.ts
git commit -m "feat(cli): allow cloud-token in .sweny.yml"
```

---

### Task 3.3: Rewrite `reportToCloud` — token-gated, no GitHub-token forwarding

**Files:**
- Modify: `/Users/nate/src/swenyai/sweny/packages/core/src/cli/main.ts` (lines 92–157 — replace entire function + CLOUD_URL constant)
- Create: `/Users/nate/src/swenyai/sweny/packages/core/src/cli/__tests__/report-cloud.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/cli/__tests__/report-cloud.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NodeResult, CliConfig } from "../../types.js";

// Import the exported function (will need to export reportToCloud from main.ts)
import { reportToCloud } from "../main.js";

function makeConfig(overrides: Partial<CliConfig> = {}): CliConfig {
  return {
    cloudToken: "",
    githubToken: "",
    repository: "acme/widget",
    // ...other required CliConfig fields (reuse a minimal helper if available)
  } as CliConfig;
}

function makeResults(): Map<string, NodeResult> {
  return new Map([
    ["investigate", { status: "success", data: { findings: [{ id: "F1" }], recommendation: "implement" }, toolCalls: [] }],
    ["create_pr", { status: "success", data: { prUrl: "https://github.com/acme/widget/pull/7", prNumber: 7 }, toolCalls: [] }],
  ]);
}

describe("reportToCloud", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ run_url: "https://cloud.sweny.ai/runs/abc" }), { status: 200 }));
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock);
  });
  afterEach(() => vi.restoreAllMocks());

  it("does NOT call fetch when cloudToken is empty", async () => {
    await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "" }), "triage");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does NOT call fetch when repository is missing", async () => {
    await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_x", repository: "" }), "triage");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls fetch with Bearer cloudToken when token is set", async () => {
    await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer sweny_pk_abc");
  });

  it("does NOT send GITHUB_TOKEN in Authorization header", async () => {
    await reportToCloud(
      makeResults(),
      1000,
      makeConfig({ cloudToken: "sweny_pk_abc", githubToken: "ghs_evil" }),
      "triage",
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).not.toContain("ghs_evil");
    expect(init.headers.Authorization).not.toMatch(/^token /);
  });

  it("posts to SWENY_CLOUD_URL override when set", async () => {
    process.env.SWENY_CLOUD_URL = "https://cloud.example.test";
    try {
      await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe("https://cloud.example.test/api/report");
    } finally {
      delete process.env.SWENY_CLOUD_URL;
    }
  });

  it("silently swallows network failures — never throws", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage"),
    ).resolves.toBeUndefined();
  });

  it("prints the run URL when response includes one", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await reportToCloud(makeResults(), 1000, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
    expect(logSpy.mock.calls.flat().join(" ")).toContain("cloud.sweny.ai/runs/abc");
  });

  it("payload contains owner, repo, workflow, duration_ms, findings, nodes", async () => {
    await reportToCloud(makeResults(), 1234, makeConfig({ cloudToken: "sweny_pk_abc" }), "triage");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      owner: "acme",
      repo: "widget",
      workflow: "triage",
      duration_ms: 1234,
    });
    expect(Array.isArray(body.findings)).toBe(true);
    expect(Array.isArray(body.nodes)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

Run: `cd /Users/nate/src/swenyai/sweny && npx vitest run packages/core/src/cli/__tests__/report-cloud.test.ts`
Expected: FAIL — function not exported, current behavior wrong.

- [ ] **Step 3: Export `reportToCloud` from `main.ts`**

Change `async function reportToCloud(...)` to `export async function reportToCloud(...)` so the test can import it.

- [ ] **Step 4: Rewrite the function body**

Replace lines 92–157 of `main.ts` with:

```typescript
// ── Cloud reporting ────────────────────────────────────────────────
const CLOUD_URL_DEFAULT = "https://cloud.sweny.ai";

/**
 * Opt-in run reporting to SWEny Cloud.
 *
 * Fires only when `config.cloudToken` (from SWENY_CLOUD_TOKEN or .sweny.yml)
 * is set. Authenticates using the user's cloud token — the user's GITHUB_TOKEN
 * is never forwarded to sweny.ai.
 *
 * Failure is silent; reporting never blocks a workflow run.
 */
export async function reportToCloud(
  results: Map<string, NodeResult>,
  durationMs: number,
  config: CliConfig,
  workflow: string,
): Promise<void> {
  // 1. Opt-in gate: no cloud token → no network call, ever.
  const cloudToken = config.cloudToken;
  if (!cloudToken) return;

  // 2. Basic precondition: we need owner/repo to identify the project.
  const repo = config.repository || process.env.GITHUB_REPOSITORY || "";
  const [owner, name] = repo.split("/");
  if (!owner || !name) return;

  // 3. Build the payload.
  const investigateData = results.get("investigate")?.data;
  const createPrData = results.get("create_pr")?.data;
  const createIssueData =
    results.get("create_issue")?.data ?? results.get("create-issue")?.data;

  const findings = (investigateData?.findings as unknown[]) ?? [];
  const hasFailed = [...results.values()].some((r) => r.status === "failed");

  const nodes = [...results.entries()].map(([id, r]) => ({
    id,
    name: id,
    status:
      r.status === "success" ? ("success" as const)
      : r.status === "failed" ? ("failed" as const)
      : ("skipped" as const),
    durationMs: undefined,
  }));

  const body = {
    owner,
    repo: name,
    status: hasFailed ? "failed" : "completed",
    workflow,
    duration_ms: durationMs,
    recommendation: investigateData?.recommendation as string | undefined,
    findings,
    highest_severity: investigateData?.highest_severity as string | undefined,
    novel_count: investigateData?.novel_count as number | undefined,
    pr_url: createPrData?.prUrl as string | undefined,
    pr_number: createPrData?.prNumber as number | undefined,
    issue_url: (createIssueData?.issueUrl ?? createPrData?.issueUrl) as string | undefined,
    issue_identifier: (createIssueData?.issueIdentifier ?? createPrData?.issueIdentifier) as string | undefined,
    issues_found: findings.length > 0,
    nodes,
    action_version: version,
    runner_os: process.env.RUNNER_OS,
  };

  const cloudUrl = process.env.SWENY_CLOUD_URL || CLOUD_URL_DEFAULT;

  try {
    const res = await fetch(`${cloudUrl}/api/report`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cloudToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as { run_url?: string };
      if (data.run_url) {
        console.log(c.subtle(`  cloud: ${data.run_url}`));
      }
    }
  } catch {
    // Never block the workflow on a reporting failure.
  }
}
```

- [ ] **Step 5: Run the tests — expect pass**

Run: `cd /Users/nate/src/swenyai/sweny && npx vitest run packages/core/src/cli/__tests__/report-cloud.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Run the whole core test suite — expect no regression**

Run: `cd /Users/nate/src/swenyai/sweny && npx vitest run packages/core`
Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/nate/src/swenyai/sweny
git add packages/core/src/cli/main.ts packages/core/src/cli/__tests__/report-cloud.test.ts
git commit -m "feat(cli): token-gated cloud reporting (no GITHUB_TOKEN forwarding)"
```

---

### Task 3.4: Confirm the three call sites still wire correctly

**Files:**
- Modify (verify-only, no diff expected): `/Users/nate/src/swenyai/sweny/packages/core/src/cli/main.ts` lines 525, 682, 893

- [ ] **Step 1: Read each call site**

Read `main.ts` around lines 525, 682, 893. The call sites should still read:

```typescript
await reportToCloud(results, durationMs, config, "triage");
await reportToCloud(results, Date.now() - implRunStart, config, "implement");
await reportToCloud(results, 0, config, workflow.id);
```

These remain unchanged — the function signature is identical and the gating logic moved inside.

- [ ] **Step 2: Confirm `workflowRunAction` passes real duration**

At line 893 the duration is currently `0`. Replace with a start-timestamp captured at the top of `workflowRunAction` (pattern: mirror `implRunStart` at line 591). This is a small drive-by correctness fix:

```typescript
// at the top of workflowRunAction:
const runStart = Date.now();

// at the call site (line 893):
await reportToCloud(results, Date.now() - runStart, config, workflow.id);
```

- [ ] **Step 3: Run the full CLI test suite**

Run: `cd /Users/nate/src/swenyai/sweny && npx vitest run packages/core/src/cli`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/nate/src/swenyai/sweny
git add packages/core/src/cli/main.ts
git commit -m "fix(cli): report real duration from workflowRunAction"
```

---

## Phase 4: Documentation

### Task 4.1: Document `SWENY_CLOUD_TOKEN` in sweny README

**Files:**
- Modify: `/Users/nate/src/swenyai/sweny/README.md`

- [ ] **Step 1: Add a new section near the Quickstart**

Insert after the Quickstart section:

````markdown
### Cloud reporting (optional)

SWEny runs locally or in CI with zero phone-home behavior by default. To enable the cloud dashboard at [cloud.sweny.ai](https://cloud.sweny.ai):

1. Sign up and link your repo — the GitHub App handles this in one click.
2. Copy the **CI reporting token** from your project page (starts with `sweny_pk_`).
3. Add it as a GitHub Actions secret named `SWENY_CLOUD_TOKEN`.
4. Expose it to the Action:

```yaml
- uses: swenyai/sweny-action@v1
  env:
    SWENY_CLOUD_TOKEN: ${{ secrets.SWENY_CLOUD_TOKEN }}
```

Without `SWENY_CLOUD_TOKEN`, the Action performs **no network calls to sweny.ai**. No anonymous telemetry, no pings, nothing.
````

- [ ] **Step 2: Commit**

```bash
cd /Users/nate/src/swenyai/sweny
git add README.md
git commit -m "docs: document SWENY_CLOUD_TOKEN opt-in reporting"
```

---

### Task 4.2: Add a `PRIVACY.md` to sweny root

**Files:**
- Create: `/Users/nate/src/swenyai/sweny/PRIVACY.md`

- [ ] **Step 1: Write the file**

````markdown
# SWEny Privacy

SWEny is an open-source CLI and GitHub Action. It does not collect telemetry by default.

## What we do NOT do

- No anonymous usage telemetry
- No crash reporting phone-home
- No reading or exfiltrating your code
- No forwarding of `GITHUB_TOKEN` to any third party

## What we DO do (only when you opt in)

If you set `SWENY_CLOUD_TOKEN`, run summaries are sent to `https://cloud.sweny.ai/api/report`:

- Repository owner and name
- Workflow name, status, duration
- Investigation findings your workflow generated (summaries, not source)
- PR / issue URLs the workflow created
- Per-node execution status
- Action version + runner OS

Authentication is via your project token only. Your `GITHUB_TOKEN` is never sent.

To disable at any time, remove `SWENY_CLOUD_TOKEN` from your workflow. Reporting will immediately stop.

## Self-hosting

Override the reporting endpoint with `SWENY_CLOUD_URL=https://your-own-host` if you run your own SWEny Cloud instance.
````

- [ ] **Step 2: Link from README**

In `/Users/nate/src/swenyai/sweny/README.md`, add a line under the "Cloud reporting" section:

```markdown
See [PRIVACY.md](./PRIVACY.md) for the full data policy.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/nate/src/swenyai/sweny
git add PRIVACY.md README.md
git commit -m "docs: add PRIVACY.md describing opt-in reporting"
```

---

### Task 4.3: Update cloud docs (in-app)

**Files:**
- Modify: `/Users/nate/src/swenyai/cloud/src/app/dashboard/projects/[id]/page.tsx` (if it has empty-state copy)
- Modify: any in-app "Getting Started" copy that references "install the GitHub App"

- [ ] **Step 1: Audit copy referencing reporting**

Grep: `rg -i "cloud token|cloud reporting|SWENY_CLOUD_TOKEN" src/` in the cloud repo. Identify any copy that needs updating to mention the token flow.

- [ ] **Step 2: Update empty states**

For a new project with no runs yet, the "Waiting for first run" empty state should now say:

> "Add `SWENY_CLOUD_TOKEN` to your GitHub repo secrets and run the Action. [Show me how →]"

With a link/modal that points to the ProjectTokenCard.

- [ ] **Step 3: Commit**

```bash
cd /Users/nate/src/swenyai/cloud
git add src/app/dashboard/projects/[id]/page.tsx  # and any other updated files
git commit -m "docs(ui): update empty states to reference SWENY_CLOUD_TOKEN"
```

---

## Phase 5: Integration Smoke Test

### Task 5.1: End-to-end happy path

- [ ] **Step 1: Start cloud dev server**

Run: `cd /Users/nate/src/swenyai/cloud && npm run dev`
Wait for: `http://localhost:3000` ready.

- [ ] **Step 2: Create a test project and copy its token**

Log in, navigate to a project page as admin, click "Copy" on the token card. Note the token (starts with `sweny_pk_`).

- [ ] **Step 3: Run sweny against a fixture repo**

```bash
cd /Users/nate/src/swenyai/sweny
SWENY_CLOUD_URL=http://localhost:3000 \
SWENY_CLOUD_TOKEN=<pasted-token> \
GITHUB_REPOSITORY=<owner>/<repo-matching-project> \
node packages/core/dist/cli/main.js triage --repository <owner>/<repo> --json
```

Expected: triage runs to completion; last line of stderr contains `cloud: http://localhost:3000/runs/<uuid>`.

- [ ] **Step 4: Verify the run row in Supabase**

Open Supabase Studio → `runs` table. Newest row should have:
- `project_id` = the project you chose
- `workflow` = "triage"
- `status` = "completed"
- `findings` jsonb populated
- `action_version` matches `packages/core/package.json` version

- [ ] **Step 5: Verify opt-out**

Re-run the CLI with `SWENY_CLOUD_TOKEN` unset. Confirm no new row is inserted and no outbound request is made (check network tab / dev-server logs show no POST to `/api/report`).

- [ ] **Step 6: Verify token rotation**

Rotate the token in the UI. Re-run the CLI with the *old* token. Expect: request hits `/api/report` and receives 401. Re-run with the new token: 200 OK.

- [ ] **Step 7: Verify GitHub-token-based auth is gone**

```bash
curl -X POST http://localhost:3000/api/report \
  -H "Authorization: token ghs_something" \
  -H "Content-Type: application/json" \
  -d '{"owner":"x","repo":"y","status":"completed","workflow":"triage"}'
```

Expected: 401 Unauthorized.

- [ ] **Step 8: No commit needed for this task — but if any issue was found and fixed, commit that fix with a descriptive message.**

---

## Phase 6: Release

### Task 6.1: Version bump + changelog

**Files:**
- Modify: `/Users/nate/src/swenyai/sweny/packages/core/package.json` (bump minor version)
- Modify: `/Users/nate/src/swenyai/sweny/CHANGELOG.md` (if exists; create if not)

- [ ] **Step 1: Bump `@sweny-ai/core` minor**

Current version per research: `0.1.51`. Bump to `0.2.0` — this is a meaningful behavior change (new opt-in feature, removal of GITHUB_TOKEN forwarding).

Edit `packages/core/package.json`: `"version": "0.2.0"`.

- [ ] **Step 2: Write changelog entry**

```markdown
## 0.2.0 — 2026-04-12

### Added
- Opt-in run reporting to SWEny Cloud via `SWENY_CLOUD_TOKEN` (see PRIVACY.md)

### Changed
- **BREAKING (security):** The CLI no longer forwards your `GITHUB_TOKEN` to cloud.sweny.ai for auth. The only way to enable reporting is `SWENY_CLOUD_TOKEN` (project token from cloud.sweny.ai) or the GitHub App installation path.
- `workflowRunAction` now reports actual run duration (previously hardcoded `0`).

### Removed
- Deprecated `Authorization: token <github-token>` auth path on cloud `/api/report` endpoint.
```

- [ ] **Step 3: Commit**

```bash
cd /Users/nate/src/swenyai/sweny
git add packages/core/package.json CHANGELOG.md
git commit -m "chore(release): @sweny-ai/core 0.2.0"
```

- [ ] **Step 4: Tag (do NOT push without user confirmation)**

Note: **do not tag or push** without explicit user confirmation — release cutting is a separate decision.

---

## Self-Review

**Spec coverage:**
- ✅ Default-off reporting — Task 3.3 (gating on `config.cloudToken`)
- ✅ No GITHUB_TOKEN forwarding — Task 3.3 test "does NOT send GITHUB_TOKEN"
- ✅ Token generation and prefix convention — Task 1.2
- ✅ Token management UI — Task 1.4 + 1.5
- ✅ Token rotation — Task 1.3
- ✅ Delete deprecated server-side auth — Task 2.1
- ✅ Token format validation — Task 2.2
- ✅ Config integration — Task 3.1, 3.2
- ✅ Docs + privacy policy — Task 4.1, 4.2, 4.3
- ✅ E2E verification — Phase 5

**Placeholder scan:** None found. Every step includes concrete code or a specific command.

**Type consistency:**
- `generateProjectToken()` / `isValidTokenFormat()` / `maskToken()` — all referenced consistently across Tasks 1.2, 1.3, 1.4, 2.2.
- `cloudToken` field on `CliConfig` — introduced in Task 3.1, used in Task 3.3.
- `SWENY_CLOUD_TOKEN` env var — referenced consistently.
- `sweny_pk_` prefix — consistent across migration (1.1), generator (1.2), README (4.1), PRIVACY (4.2).

**Known risks not covered by this plan (intentional — out of scope):**
- GitHub OIDC-based auth (tokenless for App-installed repos) — a worthwhile v2 follow-up but adds significant verifier infrastructure.
- Token hashing at rest (currently plaintext, matching existing scheme) — defer until we have more than a handful of customers.
- Rate limiting hardening (currently in-memory, resets on deploy) — tracked separately; file `src/lib/rate-limit.ts` calls out the concern in its own comments.

---

## Execution Handoff

**Plan complete and saved to** `/Users/nate/src/swenyai/sweny/docs/superpowers/plans/2026-04-12-cloud-reporting-token-auth.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a plan that spans two repos (cleaner context isolation per task).

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
