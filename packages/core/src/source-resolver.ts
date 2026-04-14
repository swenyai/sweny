/**
 * Source resolution (Node-only).
 *
 * Runtime helpers that read files, hash content, and fetch URLs. These are
 * separated from `./sources.ts` so the browser-safe bits of the Source type
 * (Zod schema, classifier, types) can be imported without pulling `node:fs`
 * or `node:crypto` into bundlers that target the browser.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ResolvedSource, Source, SourceResolutionContext, SourceResolutionMap } from "./sources.js";
import { normalizeSource } from "./sources.js";

/**
 * Produce a stable 16-hex-char hash of `content` for use as a cache key /
 * change-detection ID.
 *
 * Intentionally avoids `node:crypto` so this module can be bundled for the
 * browser (studio SPA's in-browser simulator reaches this via the inline
 * Source resolver). `cyrb64` is a well-known non-crypto 64-bit hash — fine
 * for cache keys, not fine for security. Deterministic across Node and
 * browser (both operate on UTF-16 code units).
 */
export function hashContent(content: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export async function resolveSource(
  source: Source,
  fieldPath: string,
  ctx: SourceResolutionContext,
): Promise<ResolvedSource> {
  const [kind, value] = normalizeSource(source);

  if (kind === "inline") {
    return {
      content: value,
      kind: "inline",
      origin: source,
      resolver: "inline",
      hash: hashContent(value),
    };
  }

  if (kind === "file") {
    const absolute = path.isAbsolute(value) ? value : path.resolve(ctx.cwd, value);
    let content: string;
    try {
      content = await fs.readFile(absolute, "utf-8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        throw new Error(`SOURCE_FILE_NOT_FOUND: file not found: ${absolute} (referenced by ${fieldPath})`);
      }
      throw new Error(`SOURCE_FILE_READ_FAILED: could not read ${absolute} (referenced by ${fieldPath}): ${e.message}`);
    }
    // Strip UTF-8 BOM (Windows editors emit this)
    if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
    return {
      content,
      kind: "file",
      origin: source,
      resolver: "file",
      hash: hashContent(content),
      sourcePath: absolute,
    };
  }

  if (kind === "url") {
    if (ctx.offline) {
      throw new Error(
        `SOURCE_OFFLINE_REQUIRES_FETCH: cannot fetch ${value} in --offline mode (referenced by ${fieldPath}).`,
      );
    }
    // Validate type field on tagged URL forms — v1 only accepts "fetch" (the default).
    if (typeof source === "object" && "url" in source && source.type && source.type !== "fetch") {
      throw new Error(
        `SOURCE_INVALID_TYPE: unknown resolver type "${source.type}" on ${value} (referenced by ${fieldPath}). v1 supports only "fetch".`,
      );
    }
    const url = value;
    const headers = buildFetchHeaders(url, ctx);
    const res = await fetchWithRetry(url, headers, fieldPath);
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `SOURCE_URL_AUTH_REQUIRED: ${url} returned HTTP ${res.status} (referenced by ${fieldPath}). Configure fetch.auth in .sweny.yml or set SWENY_FETCH_TOKEN.`,
      );
    }
    if (!res.ok) {
      throw new Error(`SOURCE_URL_HTTP_ERROR: ${url} returned HTTP ${res.status} (referenced by ${fieldPath}).`);
    }
    const content = await res.text();
    return {
      content,
      kind: "url",
      origin: source,
      resolver: "fetch",
      hash: hashContent(content),
      fetchedAt: new Date().toISOString(),
    };
  }

  throw new Error(`source error: unreachable (kind: ${kind}, field: ${fieldPath})`);
}

export async function resolveSources(
  sources: Record<string, Source>,
  ctx: SourceResolutionContext,
): Promise<SourceResolutionMap> {
  const cache = new Map<string, Promise<ResolvedSource>>();
  const out: SourceResolutionMap = {};
  const entries = Object.entries(sources);

  await Promise.all(
    entries.map(async ([fieldPath, source]) => {
      const key = canonicalKey(source, ctx);
      let promise = key ? cache.get(key) : undefined;
      if (!promise) {
        promise = resolveSource(source, fieldPath, ctx);
        if (key) cache.set(key, promise);
      }
      out[fieldPath] = await promise;
    }),
  );

  return out;
}

function canonicalKey(source: Source, ctx: SourceResolutionContext): string | null {
  const [kind, value] = normalizeSource(source);
  if (kind === "file") {
    return "file:" + (path.isAbsolute(value) ? value : path.resolve(ctx.cwd, value));
  }
  if (kind === "url") return "url:" + value;
  return null;
}

const RETRY_DELAYS = [250, 1000]; // ms — exponential backoff for 5xx

async function fetchWithRetry(url: string, headers: Record<string, string>, fieldPath: string): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
      // Don't retry on 4xx (client errors) or 2xx (success)
      if (res.status < 500) return res;
      // 5xx — retry if attempts remain
      if (attempt < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      return res; // final 5xx — let caller handle it
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
    }
  }
  throw new Error(
    `SOURCE_URL_UNREACHABLE: ${url} (referenced by ${fieldPath}): ${lastError?.message ?? "unknown error"}. Pass --offline to skip URL sources.`,
  );
}

function buildFetchHeaders(url: string, ctx: SourceResolutionContext): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "text/plain, text/markdown, */*",
  };
  const token = resolveFetchToken(url, ctx);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function resolveFetchToken(url: string, ctx: SourceResolutionContext): string | undefined {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return undefined;
  }
  const envVar = ctx.authConfig[host];
  if (envVar && ctx.env[envVar]) return ctx.env[envVar];
  const fallback = ctx.env.SWENY_FETCH_TOKEN;
  return fallback || undefined;
}
