/**
 * Template + rules/context loading for the CLI.
 *
 * Templates and additional-context documents can come from:
 *   1. Local file path (relative to repo root)
 *   2. URL (fetched at runtime)
 *   3. Built-in defaults / inline text
 *
 * Delegates to source-resolver.ts for the actual fetch. Fix #16: both
 * `loadTemplate` and `loadAdditionalContext` now honor `offline` and
 * `fetchAuth` the same way the executor's per-node Sources do, so CLI-level
 * rules/context stay consistent with everything the executor touches later.
 */

import * as path from "node:path";

import { classifySource, type SourceResolutionContext } from "./sources.js";
import { resolveSource, SOURCE_OFFLINE_REQUIRES_FETCH } from "./source-resolver.js";
import { consoleLogger } from "./types.js";

export const DEFAULT_ISSUE_TEMPLATE = `## Summary
<!-- One-line description of the issue -->

## Root Cause
<!-- What caused this issue -->

## Impact
- **Severity**: <!-- critical / high / medium / low -->
- **Affected Services**: <!-- list -->
- **User Impact**: <!-- description -->

## Steps to Reproduce
1. ...

## Recommended Fix
<!-- Proposed solution -->

## Related
- Commits: <!-- relevant commits -->
- PRs: <!-- related PRs -->
`;

export const DEFAULT_PR_TEMPLATE = `## Summary
<!-- What does this PR do? -->

## Root Cause
<!-- What caused the issue this fixes? -->

## Changes
<!-- Bullet list of changes -->

## Testing
- [ ] Tested locally
- [ ] No breaking changes

## Related Issues
Fixes #
`;

export interface Templates {
  issueTemplate: string;
  prTemplate: string;
}

/**
 * Options shared by `loadTemplate` and `loadAdditionalContext`.
 *
 * `offline` and `fetchAuth` mirror the same knobs on the executor's
 * `ExecuteOptions`, so CLI-preloaded rules/context resolve under the same
 * policy as Sources resolved later by the executor.
 */
export interface SourceLoadOptions {
  cwd?: string;
  offline?: boolean;
  /** Host → env-var-name map for URL Source authentication (Bearer). */
  fetchAuth?: Record<string, string>;
  /** Environment used to resolve `fetchAuth` env-var names. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /**
   * Root directory `file:` template/context Sources are sandboxed to. A path
   * that escapes it via `..` or an absolute path is rejected. Defaults to
   * {@link cwd} (or `process.cwd()`), so the sandbox is ON by default. Set
   * {@link allowFileOutsideRoot} to opt out.
   */
  fileRoot?: string;
  /**
   * Opt out of the {@link fileRoot} sandbox, permitting `file:` Sources to read
   * anywhere on disk. Defaults to `false`.
   */
  allowFileOutsideRoot?: boolean;
}

function buildCtx(options: SourceLoadOptions): SourceResolutionContext {
  const cwd = options.cwd ?? process.cwd();
  return {
    cwd,
    env: options.env ?? process.env,
    authConfig: options.fetchAuth ?? {},
    offline: options.offline ?? false,
    fileRoot: options.fileRoot ?? cwd,
    allowFileOutsideRoot: options.allowFileOutsideRoot ?? false,
    logger: consoleLogger,
  };
}

/**
 * True when a resolution error is the intentional `--offline` skip of a URL
 * source. Offline mode is the one failure we deliberately swallow into the
 * fallback: the operator explicitly asked to skip URL Sources. Every other
 * failure (404/403/SSRF block/read error/unreachable) is a real
 * misconfiguration and must surface, matching the executor's per-node Source
 * resolution which hard-throws on all of these.
 */
function isOfflineSkip(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.startsWith(SOURCE_OFFLINE_REQUIRES_FETCH);
}

/**
 * Load a template from a file path or URL.
 *
 * Returns the default only when the source is empty/unset, or when a URL source
 * is intentionally skipped under `--offline`. A CONFIGURED source that fails to
 * resolve (404, 403, SSRF block, read error) now THROWS instead of silently
 * degrading to the built-in default — a typo'd or unauthorized template URL is
 * a misconfiguration, not a no-op. This matches the executor's Source handling.
 *
 * Accepts the legacy `cwd?: string` signature for backward compat.
 */
export async function loadTemplate(
  source: string | undefined,
  fallback: string,
  options: SourceLoadOptions | string = {},
): Promise<string> {
  if (!source || source.trim() === "") return fallback;
  const opts: SourceLoadOptions = typeof options === "string" ? { cwd: options } : options;

  try {
    const resolved = await resolveSource(source.trim(), "template", buildCtx(opts));
    return resolved.content;
  } catch (err: unknown) {
    if (isOfflineSkip(err)) {
      console.warn(`[templates] Skipping URL template in --offline mode, using default.`);
      return fallback;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load configured template "${source.trim()}": ${msg}`);
  }
}

/**
 * Resolve issue and PR templates from config.
 */
export async function resolveTemplates(
  config: { issueTemplate?: string; prTemplate?: string },
  options: SourceLoadOptions | string = {},
): Promise<Templates> {
  const opts: SourceLoadOptions = typeof options === "string" ? { cwd: options } : options;
  const [issueTemplate, prTemplate] = await Promise.all([
    loadTemplate(config.issueTemplate, DEFAULT_ISSUE_TEMPLATE, opts),
    loadTemplate(config.prTemplate, DEFAULT_PR_TEMPLATE, opts),
  ]);
  return { issueTemplate, prTemplate };
}

/**
 * Load additional context documents (local files, URLs, or inline text).
 * Each source is resolved eagerly (including URLs) and wrapped with a header.
 * Returns { resolved, urls } — resolved text for all sources; urls is kept
 * for API compat but will be empty since URLs now resolve eagerly.
 *
 * A configured source that fails to resolve THROWS (matching the executor and
 * `loadTemplate`); only the intentional `--offline` URL skip is swallowed.
 *
 * Accepts the legacy `cwd?: string` signature for backward compat.
 */
export async function loadAdditionalContext(
  sources: string[],
  options: SourceLoadOptions | string = {},
): Promise<{ resolved: string; urls: string[] }> {
  if (sources.length === 0) return { resolved: "", urls: [] };

  const opts: SourceLoadOptions = typeof options === "string" ? { cwd: options } : options;
  const parts: string[] = [];
  const ctx = buildCtx(opts);

  for (const source of sources) {
    const trimmed = source.trim();
    if (!trimmed) continue;

    const kind = classifySource(trimmed);
    if (kind === "inline") {
      parts.push(trimmed);
    } else {
      try {
        const resolved = await resolveSource(trimmed, "context", ctx);
        if (resolved.content) {
          const label = kind === "file" ? path.basename(trimmed) : trimmed;
          parts.push(`### ${label}\n\n${resolved.content}`);
        }
      } catch (err: unknown) {
        // Offline skip of a URL source is intentional; everything else (404,
        // 403, SSRF block, read error) is a misconfiguration and must surface
        // rather than silently dropping the configured context document.
        if (isOfflineSkip(err)) {
          console.warn(`[templates] Skipping URL context source "${trimmed}" in --offline mode.`);
          continue;
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to load configured context source "${trimmed}": ${msg}`);
      }
    }
  }

  return {
    resolved: parts.length > 0 ? parts.join("\n\n---\n\n") : "",
    urls: [],
  };
}
