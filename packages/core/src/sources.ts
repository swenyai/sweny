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

const inlineTagZ = z.object({ inline: z.string() }).strict();
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
    const url = value;
    const headers = buildFetchHeaders(url, ctx);
    let res: Response;
    try {
      res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `SOURCE_URL_UNREACHABLE: ${url} (referenced by ${fieldPath}): ${msg}. Pass --offline to skip URL sources.`,
      );
    }
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

function buildFetchHeaders(_url: string, _ctx: SourceResolutionContext): Record<string, string> {
  return { Accept: "text/plain, text/markdown, */*" };
}

function normalizeSource(source: Source): [SourceKind, string] {
  if (typeof source === "string") {
    const kind = classifySource(source);
    return [kind, source.trim()];
  }
  if ("inline" in source) return ["inline", source.inline];
  if ("file" in source) return ["file", source.file];
  if ("url" in source) return ["url", source.url];
  throw new Error("source error: unrecognised Source shape");
}
