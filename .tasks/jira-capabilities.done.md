# Task: Add FingerprintCapable and TriageHistoryCapable to Jira Provider

## Why

The Jira issue tracker provider (`packages/providers/src/issue-tracking/jira.ts`) is
missing two optional capabilities that Linear already implements:

- **`FingerprintCapable`** — `searchByFingerprint()` lets the triage engine deduplicate
  bugs by error pattern before creating a new issue.
- **`TriageHistoryCapable`** — `listTriageHistory()` lets the triage engine load recent
  triage history to avoid re-investigating known issues.

Without these capabilities, Jira users running `sweny triage` will not get duplicate
detection or historical context, which are core workflow features.

---

## Interfaces to implement

These are defined in `packages/providers/src/issue-tracking/types.ts` (lines 141–166):

```typescript
interface FingerprintCapable {
  searchByFingerprint(
    projectId: string,
    errorPattern: string,
    opts?: { labelId?: string; service?: string },
  ): Promise<Issue[]>;
}

interface TriageHistoryEntry {
  identifier: string;
  title: string;
  state: string;
  stateType: string;
  url: string;
  descriptionSnippet: string | null;
  fingerprint: string | null;  // Jira has no native fingerprint — set to null
  createdAt: string;
  labels: string[];
}

interface TriageHistoryCapable {
  listTriageHistory(projectId: string, labelId: string, days?: number): Promise<TriageHistoryEntry[]>;
}
```

Type guards (`canSearchByFingerprint`, `canListTriageHistory`) also live in that file and
work via duck-typing — no changes needed there.

---

## File to edit

**`packages/providers/src/issue-tracking/jira.ts`**

### Step 1 — Update imports

Add the new types to the existing import block (currently lines 5–12):

```typescript
import type {
  IssueTrackingProvider,
  Issue,
  IssueCreateOptions,
  IssueUpdateOptions,
  IssueSearchOptions,
  PrLinkCapable,
  FingerprintCapable,          // add
  TriageHistoryCapable,        // add
  TriageHistoryEntry,          // add
} from "./types.js";
```

### Step 2 — Update the factory return type and class declaration

Change the factory signature (currently line 26):
```typescript
// Before
export function jira(config: JiraConfig): IssueTrackingProvider & PrLinkCapable {

// After
export function jira(config: JiraConfig): IssueTrackingProvider & PrLinkCapable & FingerprintCapable & TriageHistoryCapable {
```

Change the class declaration (currently line 31):
```typescript
// Before
class JiraProvider implements IssueTrackingProvider, PrLinkCapable {

// After
class JiraProvider implements IssueTrackingProvider, PrLinkCapable, FingerprintCapable, TriageHistoryCapable {
```

### Step 3 — Implement `searchByFingerprint`

Add this method after `linkPr` (before the `// Helpers` section):

```typescript
// ------------------------------------------------------------------
// FingerprintCapable
// ------------------------------------------------------------------

async searchByFingerprint(
  projectId: string,
  errorPattern: string,
  opts?: { labelId?: string; service?: string },
): Promise<Issue[]> {
  this.log.info(`Searching Jira by fingerprint: "${errorPattern}" in project ${projectId}`);

  const jqlParts: string[] = [
    `project = "${projectId}"`,
    `summary ~ "${errorPattern}"`,
  ];

  if (opts?.labelId) {
    jqlParts.push(`labels = "${opts.labelId}"`);
  }

  const jql = jqlParts.join(" AND ");

  const result = await this.request<{
    issues: Array<{
      id: string;
      key: string;
      fields: {
        summary: string;
        status: { name: string };
      };
    }>;
  }>(`/search?jql=${encodeURIComponent(jql)}&maxResults=10&fields=summary,status`);

  const issues = result.issues ?? [];
  this.log.info(`Found ${issues.length} issues matching fingerprint`);

  return issues.map((i) => ({
    id: i.id,
    identifier: i.key,
    title: i.fields.summary,
    url: `${this.baseUrl}/browse/${i.key}`,
    branchName: `fix/${i.key}`,
    state: i.fields.status.name,
  }));
}
```

### Step 4 — Implement `listTriageHistory`

Add this method after `searchByFingerprint`:

```typescript
// ------------------------------------------------------------------
// TriageHistoryCapable
// ------------------------------------------------------------------

async listTriageHistory(
  projectId: string,
  labelId: string,
  days: number = 30,
): Promise<TriageHistoryEntry[]> {
  this.log.info(`Listing Jira triage history for project ${projectId} (last ${days} days)`);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]; // YYYY-MM-DD format for Jira JQL

  const jql = `project = "${projectId}" AND labels = "${labelId}" AND created >= "${since}" ORDER BY created DESC`;

  const result = await this.request<{
    issues: Array<{
      id: string;
      key: string;
      fields: {
        summary: string;
        status: { name: string; statusCategory: { key: string } };
        description: unknown | null;
        labels: string[];
        created: string;
      };
    }>;
  }>(`/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,status,description,labels,created`);

  const issues = result.issues ?? [];
  this.log.info(`Found ${issues.length} triage history entries`);

  return issues.map((i) => {
    // Extract plain text from Atlassian Document Format description
    let descriptionSnippet: string | null = null;
    if (i.fields.description) {
      const doc = i.fields.description as { content?: Array<{ content?: Array<{ text?: string }> }> };
      const text = doc.content
        ?.flatMap((block) => block.content ?? [])
        .map((node) => node.text ?? "")
        .join(" ")
        .trim();
      descriptionSnippet = text ? text.slice(0, 200) : null;
    }

    return {
      identifier: i.key,
      title: i.fields.summary,
      state: i.fields.status.name,
      stateType: i.fields.status.statusCategory.key, // "new", "indeterminate", "done", "undefined"
      url: `${this.baseUrl}/browse/${i.key}`,
      descriptionSnippet,
      fingerprint: null, // Jira has no native fingerprint field
      createdAt: i.fields.created,
      labels: i.fields.labels,
    };
  });
}
```

---

## Tests to add

**File:** `packages/providers/tests/jira.test.ts`

Add a new `describe` block after the existing `JiraProvider` tests. Follow the same
pattern used throughout the file (mock `globalThis.fetch`, make assertions on URL and
response shape). Use `vi.fn()` from `vitest`.

```typescript
// ---------------------------------------------------------------------------
// FingerprintCapable
// ---------------------------------------------------------------------------

describe("jira FingerprintCapable", () => {
  it("canSearchByFingerprint() returns true for jira provider", () => {
    // import canSearchByFingerprint from types.js and assert it returns true
  });

  it("searchByFingerprint calls /search with fingerprint JQL", async () => {
    // mock fetch returning { issues: [{id, key, fields: {summary, status}}] }
    // call searchByFingerprint("PROJ", "NullPointerException")
    // verify URL contains "project = \"PROJ\"" and "summary ~ \"NullPointerException\""
    // verify returned Issue[] shape
  });

  it("searchByFingerprint includes label filter when labelId provided", async () => {
    // call searchByFingerprint("PROJ", "pattern", { labelId: "bug" })
    // verify JQL contains 'labels = "bug"'
  });

  it("searchByFingerprint returns empty array when no issues found", async () => {
    // mock { issues: [] }
    // verify returns []
  });
});

// ---------------------------------------------------------------------------
// TriageHistoryCapable
// ---------------------------------------------------------------------------

describe("jira TriageHistoryCapable", () => {
  it("canListTriageHistory() returns true for jira provider", () => {
    // import canListTriageHistory from types.js and assert it returns true
  });

  it("listTriageHistory calls /search with label and date JQL", async () => {
    // mock fetch with one issue that has ADF description and a label
    // call listTriageHistory("PROJ", "triage-label", 30)
    // verify URL contains the expected JQL
    // verify TriageHistoryEntry shape: identifier, title, state, stateType, url,
    //   descriptionSnippet, fingerprint (null), createdAt, labels
  });

  it("listTriageHistory uses default 30 days when not specified", async () => {
    // call listTriageHistory("PROJ", "label")
    // verify JQL contains a date string (any value)
  });

  it("listTriageHistory returns null descriptionSnippet when description is null", async () => {
    // mock issue with fields.description = null
    // verify entry.descriptionSnippet === null
  });

  it("listTriageHistory returns fingerprint as null", async () => {
    // Jira has no fingerprint field
    // verify every returned entry has fingerprint === null
  });
});
```

---

## How to run tests

```bash
cd packages/providers
npm test
```

All existing tests must still pass. New tests should cover the scenarios above.

---

## Reference: Linear implementation

See `packages/providers/src/issue-tracking/linear.ts` for how Linear implements these
same capabilities using GraphQL. The Jira version uses REST + JQL instead, but the
return shapes (`Issue[]` and `TriageHistoryEntry[]`) must match exactly.
