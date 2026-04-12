/**
 * Source type — unified shape for every content-bearing field in a workflow
 * (instructions, rules, context, templates). Supports inline text, relative or
 * absolute file paths, and HTTP(S) URLs via a single ergonomic form.
 *
 * See docs/superpowers/specs/2026-04-12-unified-source-type-design.md.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import type { Logger } from "./types.js";

export type Source = string | { inline: string } | { file: string } | { url: string; type?: string };

export type SourceKind = "inline" | "file" | "url";

const inlineTagZ = z.object({ inline: z.string().min(1) }).strict();
const fileTagZ = z.object({ file: z.string().min(1) }).strict();
const urlTagZ = z
  .object({
    url: z.string().url(),
    type: z.string().optional(),
  })
  .strict();

/**
 * Zod schema for a Source. Accepts either a non-empty string (classified by
 * prefix) or one of three tagged object forms: {inline}, {file}, {url,type?}.
 * Runtime validation of `type` against the resolver registry happens later —
 * the schema stays permissive so new resolvers slot in without schema bumps.
 */
export const sourceZ = z.union([z.string().min(1), inlineTagZ, fileTagZ, urlTagZ]);

/**
 * Classify a plain-string Source by prefix. Throws on empty strings.
 */
export type ResolvedSource = {
  content: string;
  kind: SourceKind;
  origin: Source;
  resolver: "inline" | "file" | "fetch";
  hash: string;
  fetchedAt?: string;
  sourcePath?: string;
};

export type SourceResolutionMap = Record<string, ResolvedSource>;

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

export function classifySource(raw: string): SourceKind {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("source error: empty string is not a valid Source");
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return "url";
  }
  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("/")) {
    return "file";
  }
  return "inline";
}

export type SourceResolutionContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  authConfig: Record<string, string>;
  offline: boolean;
  logger: Logger;
};

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

function normalizeSource(source: Source): [SourceKind, string] {
  if (typeof source === "string") {
    const kind = classifySource(source);
    return [kind, source.trim()];
  }
  if ("inline" in source) return ["inline", source.inline];
  if ("file" in source) return ["file", source.file.trim()];
  if ("url" in source) return ["url", source.url.trim()];
  throw new Error("source error: unrecognised Source shape");
}
