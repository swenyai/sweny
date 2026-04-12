# Unified `Source` Type — Design Spec

**Goal:** Replace the ad-hoc mix of inline-only, file-only, and URL-or-file fields across the SWEny spec with a single unified `Source` type used by every content-bearing field. Ship the minimal, ergonomic form in v1; reserve the schema surface so MCP-dispatched resolvers can slot in later without breaking changes.

**Motivation:** Today the spec is inconsistent. `node.instruction` is inline-only. `rules`/`context` accept inline, file, or URL via a string heuristic. `issueTemplate`/`prTemplate` accept file or URL (no inline). A user who wants to externalize a node's instruction into a shared markdown file can't — even though the machinery to do it already exists for sibling fields. This gap blocks a legitimate and common pattern: **team-shared knowledge and prompts that evolve over time**, pulled in by reference so every workflow benefits when the playbook improves.

**Scope decision:** Pre-launch, we close the gap with a small, defensible surface. We explicitly reject the "grand polymorphic everything" direction — we do not unify `when` conditions, identifiers, or display names, and we do not build an MCP-backed URL resolver registry for v1. Plain HTTPS fetch with env-sourced auth headers covers the dominant use case (knowledge in a git-hosted markdown file) and leaves the registry as a clean Tier 2 extension.

---

## 1. File Layout

| File | Action | Purpose |
|---|---|---|
| `packages/core/src/sources.ts` | Create | `Source` type, `resolveSource()`, `resolveSources()`, content hashing, in-run cache, `--offline` handling |
| `packages/core/src/sources.test.ts` | Create | Unit tests: heuristic parsing, tagged form, file resolution, URL fetch (mocked), auth header resolution, offline mode, cache, error messages |
| `packages/core/src/schema.ts` | Modify | Add `sourceZ` union. Update `nodeZ.instruction`, workflow input `rules[]` / `context[]`, templates to reference `sourceZ`. Regenerate `workflowJsonSchema`. |
| `packages/core/src/types.ts` | Modify | Export `Source` type. Update `Node.instruction`, `WorkflowInput.rules`, `WorkflowInput.context`, template fields. Add `ResolvedSource` (content + metadata) and `SourceResolution` (map). |
| `packages/core/src/executor.ts` | Modify | New Source resolution phase runs before workflow execution. Trace records per-source resolution metadata. |
| `packages/core/src/templates.ts` | Modify / deprecate | `classifySource()` moves into `sources.ts`. `loadAdditionalContext()` delegates to `resolveSources()`. `loadTemplate()` becomes a thin wrapper over `resolveSource()`. |
| `packages/core/src/cli/main.ts` | Modify | `resolveRulesAndContext()` delegates to the new resolver. Add `--offline` flag. |
| `packages/core/src/cli/config.ts` | Modify | Add `fetch.auth` map to `.sweny.yml` schema (per-host env-var for `Authorization` header). |
| `packages/core/src/workflows/triage.yml` | Modify | Remove the `prepare` node (no longer required — URLs resolve at load time). Keep the node as a documented optional pattern for summarization use cases. |
| `spec/src/content/docs/sources.mdx` | Create | Normative definition: Source type, resolution semantics, error codes, trace contract, resolver registry extension point. |
| `spec/src/content/docs/nodes.mdx` | Modify | `instruction` field is now a Source. Update prose + example. |
| `spec/src/content/docs/execution.mdx` | Modify | Add Source resolution phase to Node Execution Sequence. Update trace schema. |
| `spec/src/content/docs/workflow.mdx` | Modify | Cross-reference Source for `rules` / `context` inputs. |
| `spec/public/schemas/workflow.json` | Regenerate | Rebuild from updated schema. |

---

## 2. The `Source` Type

### 2.1 Shape

```ts
export type Source =
  | string
  | { inline: string }
  | { file: string }
  | { url: string; type?: string };
```

The **string form** is the ergonomic default. It's classified by prefix:

| Prefix | Kind | Example |
|---|---|---|
| `./` or `../` or `/` | file | `./prompts/investigate.md` |
| `http://` or `https://` | url | `https://raw.githubusercontent.com/acme/playbook/main/rules.md` |
| anything else | inline | `Investigate the alert.` |

The **tagged object form** is the escape hatch: use it when the inline content would otherwise be misclassified (e.g., literal content starting with `./`), or when you want a `type` hint on a URL. It's also the form tooling should emit programmatically for unambiguous round-tripping.

**`type` on URLs.** Reserved for the Tier 2 resolver registry. The JSON Schema accepts any string (see §9.5) so the schema can stay stable as new resolvers are registered. **Runtime validation** rejects unknown values at load time — in v1 the only valid value is `"fetch"` (the default and only built-in). When Tier 2 ships, `"linear"`, `"notion"`, etc. become valid at runtime via the registry; no schema change needed. Users who want to force plain fetch against a future-auto-dispatched host will write `type: "fetch"`.

### 2.2 Fields that use `Source`

| Field | Was | Now |
|---|---|---|
| `node.instruction` | `string` (inline only) | `Source` |
| `workflow.input.rules[]` | `string` (heuristic) | `Source` |
| `workflow.input.context[]` | `string` (heuristic) | `Source` |
| `issueTemplate` | `string` (file/url) | `Source` |
| `prTemplate` | `string` (file/url) | `Source` |

### 2.3 Fields that stay plain strings

- `workflow.id`, `workflow.name`, `workflow.description`, `node.name`, `skill.id`, `skill.description` — identifiers and display metadata, not content.
- `edge.when` — conditional routing logic is workflow-local; externalizing it has no compelling use case and would obscure DAG intent.
- `node.skills[]` — skill IDs, not content.

Rationale for excluding `when`: routing conditions are short, tightly coupled to the DAG structure, and live in the same file as the nodes they connect. Making them externalizable adds schema surface for no observed benefit.

---

## 3. Resolution Semantics

### 3.1 Eager, load-time resolution

All Sources in a workflow resolve **before** any node executes. The executor receives a `SourceResolution` map — original Source → resolved string — and uses it throughout execution. Nodes never fetch content themselves.

Rationale:
- **Fail-fast.** A broken URL or missing file is a load-time error, never mid-run.
- **Single code path.** Files and URLs resolve through the same pipeline.
- **Dry-run fidelity.** `sweny dry-run` / `sweny validate` see the same content the executor will use.
- **Trace completeness.** The resolution phase stamps hashes and timestamps into the trace before execution begins.

### 3.2 File resolution

- Read via `fs.promises.readFile` with UTF-8 encoding.
- Relative paths resolve against the workflow file's directory (or the CLI's `cwd` when invoked programmatically — same behavior as `loadAdditionalContext` today).
- Absolute paths (`/foo/bar`) allowed but discouraged for portability.
- Missing file → hard error: `source error: file not found: /abs/path/to/file.md (referenced by node 'investigate' instruction)`.

### 3.3 URL resolution

- Plain `fetch()` with default timeout **10s**, retry on 5xx up to **2 attempts** with exponential backoff (250ms, 1s).
- `Authorization` header resolution order:
  1. Per-host config in `.sweny.yml`: `fetch.auth: { "raw.githubusercontent.com": "GITHUB_TOKEN" }` → sets `Authorization: Bearer ${env.GITHUB_TOKEN}`.
  2. Global env var `SWENY_FETCH_TOKEN` — applied to all URL fetches if set and no per-host match.
  3. No header.
- `Accept: text/plain, text/markdown, */*` by default. Response body returned as UTF-8 string.
- HTTP 4xx → hard error with auth-troubleshooting hint.
- HTTP 5xx after retries → hard error with `--offline` hint.
- Network error / timeout → hard error with `--offline` hint.

### 3.4 Inline resolution

Identity. The string is used as-is.

### 3.5 In-run cache

Resolutions are cached by canonical key for the lifetime of a single workflow run:
- File: absolute path
- URL: full URL (including query string)
- Inline: not cached (content is the key)

If the same URL appears in `rules[0]` and in a node instruction, we fetch it once.

### 3.6 `--offline` flag

CLI flag (and SDK option). When set:
- File resolutions proceed normally.
- URL resolutions are **skipped and fail the run** at load time with a clear message listing each URL that would have been fetched.
- Rationale: CI sandboxes, air-gapped customer envs, and local debugging without network. Explicit opt-in keeps the default model simple.

---

## 4. Auditability

Every resolved Source produces a `ResolvedSource` record:

```ts
export type ResolvedSource = {
  content: string;
  kind: "inline" | "file" | "url";
  origin: Source;                        // the original YAML value
  resolver: "inline" | "file" | "fetch"; // Tier 2 adds "linear", etc.
  hash: string;                          // sha256 hex, first 16 chars
  fetchedAt?: string;                    // ISO 8601, for url kind only
  sourcePath?: string;                   // absolute path, for file kind only
};
```

The execution trace is extended with a `sources` map:

```ts
export interface ExecutionTrace {
  // ... existing fields
  sources: Record<string, ResolvedSource>; // keyed by field path, e.g. "nodes.investigate.instruction"
}
```

This replaces "determinism by refusing URLs" with "determinism by recording what resolved to what." A compliance reviewer can diff two traces and see whether a shared rules URL drifted between runs. A team that wants pin-by-hash can implement it as a post-hoc check against prior run hashes — or we add `{ url, pin: "sha256:..." }` in a future iteration.

---

## 5. Error Handling

All Source errors fail the workflow **before any node executes**. Error messages include:
- The field path (e.g., `nodes.investigate.instruction`)
- The original Source spec
- What was tried
- A remediation hint

### 5.1 Error codes

| Code | When |
|---|---|
| `SOURCE_FILE_NOT_FOUND` | `fs.readFile` ENOENT |
| `SOURCE_FILE_READ_FAILED` | Any other `fs.readFile` error |
| `SOURCE_URL_UNREACHABLE` | Network error / DNS / timeout after retries |
| `SOURCE_URL_HTTP_ERROR` | Non-2xx response after retries |
| `SOURCE_URL_AUTH_REQUIRED` | HTTP 401/403 (sub-case of HTTP_ERROR with clearer hint) |
| `SOURCE_OFFLINE_REQUIRES_FETCH` | URL Source encountered with `--offline` |
| `SOURCE_INVALID_TYPE` | Tagged URL with unknown `type` value (runtime check against resolver registry — v1 accepts only `"fetch"`) |
| `SOURCE_INVALID_SHAPE` | Tagged object with both `file` and `url`, both `inline` and `file`, etc. |

### 5.2 Shape validation

Tagged-object form validated by Zod as a discriminated union:
- Exactly one of `inline` / `file` / `url` must be present.
- `url` may have optional `type` (string).
- Extra keys rejected (`strict()` in Zod terms).

---

## 6. Resolver Registry (Extension Point)

v1 ships with three built-in resolvers: `inline` (identity, no-op), `file`, and `fetch`. The registry shape is defined now so Tier 2 can extend without schema changes:

```ts
export type Resolver = {
  name: string;                        // "fetch", "linear", ...
  kind: "file" | "http" | "mcp";
  match: (source: Source) => boolean;
  resolve: (source: Source, ctx: ResolverContext) => Promise<string>;
};

export type ResolverContext = {
  env: NodeJS.ProcessEnv;
  cwd: string;
  authConfig: Record<string, string>;  // from .sweny.yml fetch.auth
  logger: Logger;
  offline: boolean;
};
```

In v1:
- `inline` resolver — matches `{ inline: ... }` and string form classified as inline. Returns content as-is.
- `file` resolver — matches `{ file: ... }` and string form classified as file.
- `fetch` resolver — matches `{ url, type?: "fetch" }` and string form classified as url. Handles all URL sources.

In Tier 2:
- `linear`, `notion`, `confluence`, etc. — each registers with a host pattern. Default registration is by host (e.g., `linear.app`); `{ url, type: "linear" }` forces dispatch even for non-matching hosts.
- Selection rule: first registered resolver whose `match()` returns true wins. `fetch` remains the fallback.

The registry is internal in v1 — no public extension API. Users who want to extend will file issues; we'll add public registration after observing real patterns.

---

## 7. `.sweny.yml` Changes

Add a `fetch` section for per-host auth config:

```yaml
fetch:
  auth:
    raw.githubusercontent.com: GITHUB_TOKEN
    docs.internal.corp: CORP_DOCS_TOKEN
```

Each value is the name of an env var. At resolution time, the CLI reads `process.env[value]` and sets `Authorization: Bearer ${value}` on the fetch. Missing env vars → no Authorization header (not an error; the server may not require auth).

Global fallback: `SWENY_FETCH_TOKEN` env var applies to all URL Sources without a per-host match.

---

## 8. Backwards Compatibility

- Existing workflows using inline `instruction` strings: **unchanged behavior**.
- Existing workflows using `./path` or `https://url` in `rules`/`context`: **unchanged behavior** (heuristic preserved exactly).
- Existing workflows using file paths or URLs for `issueTemplate`/`prTemplate`: **unchanged behavior**.
- The `prepare` node in `triage.yml` (and the `rulesUrls`/`contextUrls` pattern it uses) is **deprecated but not removed in v1**. URLs in `rules`/`context` are now resolved eagerly by the CLI, so the prepare node becomes a no-op. We keep the node for one release as an opt-in summarization/digest pattern and drop it or document it as a user pattern in v2.
- JSON Schema consumers: the schema becomes strictly more permissive for affected fields. Consumers that validated inline-only will continue to accept inline. Consumers that need to write Sources programmatically should emit the tagged form.

---

## 9. Spec Updates

### 9.1 New page: `sources.mdx`

Normative definition containing:
- `Source` type and its four forms
- Resolution semantics (eager, file / url / inline behaviors)
- Resolver registry contract
- `ResolvedSource` and trace fields
- Error codes table
- `--offline` semantics
- Examples

### 9.2 `nodes.mdx` updates

- `instruction` field row: type changes from `string` to `Source`.
- New subsection "Externalizing Instructions" with a one-page example of a markdown file referenced from a node.
- Prose preserved: the executor MUST pass the resolved instruction to the model as the primary directive.

### 9.3 `execution.mdx` updates

- New step in Node Execution Sequence: "0. Resolve all Sources" (runs once before the first node).
- Trace section gains `sources: Record<string, ResolvedSource>`.
- New execution event: `sources:resolved` emitted once after the resolution phase, with the full map.

### 9.4 `workflow.mdx` updates

- `rules[]` and `context[]` row descriptions point at Source semantics.
- Example updated to show a mix of inline and file.

### 9.5 JSON Schema

Add `sourceZ` definition:

```json
{
  "$defs": {
    "Source": {
      "oneOf": [
        { "type": "string", "minLength": 1 },
        { "type": "object", "properties": { "inline": { "type": "string" } }, "required": ["inline"], "additionalProperties": false },
        { "type": "object", "properties": { "file": { "type": "string" } }, "required": ["file"], "additionalProperties": false },
        { "type": "object", "properties": { "url": { "type": "string", "format": "uri" }, "type": { "type": "string" } }, "required": ["url"], "additionalProperties": false }
      ]
    }
  }
}
```

Referenced from `node.instruction`, `input.rules.items`, `input.context.items`, `issueTemplate`, `prTemplate`.

---

## 10. Testing

### 10.1 Unit tests (`sources.test.ts`)

- Heuristic classification: `./x` → file, `/x` → file, `../x` → file, `http://x` → url, `https://x` → url, `hello` → inline, empty string → error.
- Tagged form parsing: each shape valid; invalid combinations rejected; `{ url, type: "fetch" }` is accepted; `{ url, type: "linear" }` rejected in v1 with `SOURCE_INVALID_TYPE`.
- File resolution: relative path, absolute path, missing file, read error, UTF-8 BOM handling.
- URL resolution: 200 OK, 404 → error, 500 with retry → eventually succeeds, 500 after retries → error, timeout → error, 401 → auth-hint error.
- Auth header: per-host match, global fallback, no auth, env var unset.
- Cache: same URL referenced twice → one fetch, two resolutions.
- Offline mode: URL Source → error; file Source → proceeds.
- Hash stability: same content → same hash, different content → different hash.

### 10.2 Integration tests

- Workflow with inline / file / URL sources across all supported fields.
- Trace assertions: `sources` map populated with correct hashes and kinds.
- `--offline` happy path (all files) and error path (URL present).
- Error path: missing file in `node.instruction` fails the workflow with correct field path in the error message.

### 10.3 Spec conformance tests

Add to the existing spec test suite:
- Sample YAMLs with each Source form validate against `workflow.json`.
- Invalid shapes rejected with expected error.

---

## 11. Open Questions (deferred, not blocking)

1. **Pin-by-hash for URL Sources.** `{ url, pin: "sha256:..." }` would let teams freeze a specific URL-resolved content hash. Defer until a concrete user asks. Not built in v1.
2. **Content-type handling.** v1 assumes text (markdown, plaintext). If a URL returns `application/json` or binary, behavior is to pass the raw body through as a string. Document this; revisit if users need structured parsing.
3. **Template interpolation inside Sources.** Today `rules`/`context` are passed through to the model as-is. Should resolved content support `{{ variable }}` interpolation from workflow input? Defer — no concrete ask, and interpolation belongs in the executor layer, not the Source layer.
4. **Signed URLs / short-lived tokens.** Out of scope for v1. Per-host env var covers the common case; signed-URL support can be a future resolver kind.

---

## 12. Non-Goals for v1

- MCP-dispatched URL resolution (Linear / Notion / Confluence) — reserved for Tier 2.
- Public resolver registration API — internal-only in v1.
- `when` conditions as Sources — rejected; routing stays inline.
- Identifier / display-name fields as Sources — rejected; they are references, not content.
- Mutable Source semantics during a run — resolution is once-per-run.
- Content transformations (Markdown-to-HTML, JSON parsing, YAML-to-JSON) — Source returns a string, period.

---

## 13. Success Criteria

- `node.instruction` accepts inline text, file path, or URL with no schema surprises.
- `rules` / `context` behavior unchanged from a user's perspective.
- A workflow with a URL-referenced shared rules doc runs, records the resolved hash in the trace, and re-runs pick up upstream edits to that URL.
- `--offline` produces a clear, actionable error when a URL Source is present.
- Zero breaking changes to existing `.sweny.yml` files or workflow YAMLs.
- Tier 2 (MCP dispatch) can be added later without a schema version bump.
