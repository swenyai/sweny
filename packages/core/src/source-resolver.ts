/**
 * Source resolution (Node-only).
 *
 * Runtime helpers that read files, hash content, and fetch URLs. These are
 * separated from `./sources.ts` so the browser-safe bits of the Source type
 * (Zod schema, classifier, types) can be imported without pulling `node:fs`
 * or `node:crypto` into bundlers that target the browser.
 */

import * as dns from "node:dns/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { DnsLookup, ResolvedSource, Source, SourceResolutionContext, SourceResolutionMap } from "./sources.js";
import { normalizeSource } from "./sources.js";

/** Schemes a `url:` source is allowed to use. Everything else is rejected. */
const ALLOWED_URL_SCHEMES = new Set(["http:", "https:"]);

/** Default DNS resolver used when the context does not inject one. */
const defaultDnsLookup: DnsLookup = async (hostname) => {
  const records = await dns.lookup(hostname, { all: true });
  return records.map((r) => r.address);
};

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
    assertFileWithinRoot(absolute, ctx, fieldPath);
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
    assertAllowedScheme(url, fieldPath);
    // Validate the initial host before sending anything. Redirect hops are
    // re-validated per-hop inside fetchWithRetry (redirect: "manual").
    await assertSafeHost(url, ctx, fieldPath);
    const headers = await buildFetchHeaders(url, ctx);
    const res = await fetchWithRetry(url, headers, fieldPath, ctx);
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
const MAX_REDIRECTS = 5;

/**
 * Fetch with retry on 5xx/network errors AND manual redirect handling. Each
 * redirect hop is re-validated (scheme + host SSRF check + token scoping) so a
 * benign first host cannot redirect to the cloud metadata endpoint or another
 * private target, and a credential meant for host A is never replayed to host
 * B unless B is also allowlisted.
 */
async function fetchWithRetry(
  startUrl: string,
  startHeaders: Record<string, string>,
  fieldPath: string,
  ctx: SourceResolutionContext,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const res = await fetchFollowingRedirects(startUrl, startHeaders, fieldPath, ctx);
      // Don't retry on 4xx (client errors) or 2xx (success)
      if (res.status < 500) return res;
      // 5xx — retry if attempts remain
      if (attempt < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      return res; // final 5xx — let caller handle it
    } catch (err) {
      // SSRF rejections are not transient — surface immediately, do not retry.
      if (err instanceof Error && err.message.startsWith("SOURCE_URL_BLOCKED")) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_DELAYS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
    }
  }
  throw new Error(
    `SOURCE_URL_UNREACHABLE: ${startUrl} (referenced by ${fieldPath}): ${lastError?.message ?? "unknown error"}. Pass --offline to skip URL sources.`,
  );
}

async function fetchFollowingRedirects(
  startUrl: string,
  startHeaders: Record<string, string>,
  fieldPath: string,
  ctx: SourceResolutionContext,
): Promise<Response> {
  let currentUrl = startUrl;
  let headers = startHeaders;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // NOTE (IO-06): this bare fetch() does its own DNS resolution, independent
    // of the lookup assertSafeHost() just validated — a residual DNS-rebinding
    // TOCTOU window. Closing it means pinning to the validated IP via a custom
    // dispatcher. See the assertSafeHost() doc comment.
    const res = await fetch(currentUrl, {
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!isRedirect(res.status)) return res;

    const location = res.headers.get("location");
    if (!location) return res; // redirect status with no Location — let caller handle
    const nextUrl = new URL(location, currentUrl).toString();
    assertAllowedScheme(nextUrl, fieldPath);
    await assertSafeHost(nextUrl, ctx, fieldPath);
    // Re-scope the credential for the redirect target. A token for host A is
    // dropped on a hop to host B unless B is also explicitly allowlisted.
    headers = await buildFetchHeaders(nextUrl, ctx);
    currentUrl = nextUrl;
  }
  throw new Error(
    `SOURCE_URL_UNREACHABLE: ${startUrl} (referenced by ${fieldPath}): too many redirects (>${MAX_REDIRECTS}).`,
  );
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function buildFetchHeaders(url: string, ctx: SourceResolutionContext): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "text/plain, text/markdown, */*",
  };
  const token = resolveFetchToken(url, ctx);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Resolve the bearer token for a URL, but ONLY if the URL's host is on the
 * fetch-token allowlist. There is no blanket `SWENY_FETCH_TOKEN` fallback to
 * arbitrary hosts: a credential is never sent to a host the operator did not
 * explicitly authorize.
 */
function resolveFetchToken(url: string, ctx: SourceResolutionContext): string | undefined {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return undefined;
  }
  if (!isTokenHostAllowed(host, ctx)) return undefined;
  const envVar = ctx.authConfig[host];
  if (envVar && ctx.env[envVar]) return ctx.env[envVar];
  const fallback = ctx.env.SWENY_FETCH_TOKEN;
  return fallback || undefined;
}

/**
 * A host may receive the fetch token if it is explicitly allowlisted. The
 * allowlist is `fetchTokenHosts` when provided, otherwise the keys of
 * `authConfig` (the hosts the operator configured a per-host mapping for).
 */
function isTokenHostAllowed(host: string, ctx: SourceResolutionContext): boolean {
  const allow = ctx.fetchTokenHosts ?? Object.keys(ctx.authConfig);
  return allow.includes(host);
}

function assertAllowedScheme(url: string, fieldPath: string): void {
  let scheme: string;
  try {
    scheme = new URL(url).protocol;
  } catch {
    throw new Error(`SOURCE_URL_BLOCKED: malformed URL "${url}" (referenced by ${fieldPath}).`);
  }
  if (!ALLOWED_URL_SCHEMES.has(scheme)) {
    throw new Error(
      `SOURCE_URL_BLOCKED: scheme "${scheme}" not allowed for ${url} (referenced by ${fieldPath}). Only http and https are permitted.`,
    );
  }
}

/**
 * Reject a URL whose host resolves to a private, loopback, or link-local
 * address (SSRF guard). Literal-IP hosts are checked directly. Hostnames are
 * resolved via the injected DNS lookup and every returned address is checked.
 * A hostname that fails to resolve is allowed through (the subsequent fetch
 * will simply fail) so that this guard does not turn DNS outages or unknown
 * test hosts into hard validation errors.
 *
 * KNOWN RESIDUAL — DNS-rebinding TOCTOU (IO-06). This guard resolves the
 * hostname here, but `fetchFollowingRedirects` then calls bare `fetch()`, which
 * performs its OWN independent DNS resolution. The validated address and the
 * connected address are not pinned to be the same. An attacker-controlled
 * domain with a short-TTL record can therefore return a public IP to this
 * lookup and a private/metadata IP to `fetch`'s lookup, slipping past the guard
 * (classic DNS rebinding). The window is small (the two lookups happen
 * back-to-back and Node caches within a resolution) but non-zero.
 *
 * This is NOT fully closed. Closing it requires pinning the connection to the
 * validated IP — e.g. an undici `Agent` with a custom `connect`/`lookup` that
 * returns the pre-validated address while preserving the original `Host` header
 * and TLS SNI (servername = original hostname), and re-pinning on every redirect
 * hop. That interacts with TLS and the existing per-hop redirect re-validation,
 * so it is deferred as a follow-up. Severity is low: it requires an
 * attacker-controlled domain AND a precisely-timed TTL flip between the two
 * resolutions. Do not treat the SSRF guard as airtight against rebinding until
 * the connection is IP-pinned.
 */
async function assertSafeHost(url: string, ctx: SourceResolutionContext, fieldPath: string): Promise<void> {
  const hostname = new URL(url).hostname;
  const literal = stripIpv6Brackets(hostname);

  if (isIpAddress(literal)) {
    if (isBlockedIp(literal)) {
      throw new Error(
        `SOURCE_URL_BLOCKED: ${url} resolves to blocked address ${literal} (referenced by ${fieldPath}). Private, loopback, and link-local hosts are not allowed.`,
      );
    }
    return;
  }

  const lookup = ctx.dnsLookup ?? defaultDnsLookup;
  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return; // unresolved host — let fetch fail naturally
  }
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new Error(
        `SOURCE_URL_BLOCKED: ${url} resolves to blocked address ${addr} (referenced by ${fieldPath}). Private, loopback, and link-local hosts are not allowed.`,
      );
    }
  }
}

function stripIpv6Brackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isIpAddress(host: string): boolean {
  return isIpv4(host) || host.includes(":");
}

function isIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/**
 * True if `ip` (v4 or v6 literal) is one of the address ranges that must never
 * be reachable from a source fetch: loopback, private (RFC1918), link-local
 * (including the cloud metadata endpoint 169.254.169.254), CGNAT, unspecified,
 * and the IPv6 equivalents (::1, fe80::/10, fc00::/7, IPv4-mapped forms).
 */
function isBlockedIp(ip: string): boolean {
  const v4 = ipv4Octets(ip);
  if (v4) return isBlockedIpv4(v4);
  return isBlockedIpv6(ip);
}

function ipv4Octets(ip: string): number[] | null {
  if (!isIpv4(ip)) return null;
  return ip.split(".").map(Number);
}

function isBlockedIpv4([a, b]: number[]): boolean {
  if (a === 0) return true; // 0.0.0.0/8 (incl. unspecified)
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function isBlockedIpv6(raw: string): boolean {
  const ip = raw.toLowerCase().split("%")[0]; // drop zone id
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified

  const embedded = embeddedIpv4(ip);
  if (embedded) return isBlockedIpv4(embedded);

  const firstGroup = ip.split(":")[0];
  const hextet = parseInt(firstGroup || "0", 16);
  if ((hextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((hextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  return false;
}

/**
 * Extract the embedded IPv4 address from an IPv4-mapped IPv6 literal, handling
 * both the dotted tail form (`::ffff:1.2.3.4`) and the hex form the WHATWG URL
 * parser normalizes to (`::ffff:0102:0304`).
 *
 * Only `::ffff:`-prefixed (IPv4-mapped) addresses are unwrapped. A dotted tail
 * on any other prefix (e.g. `fe80::1.2.3.4`) is NOT treated as an embedded
 * IPv4: unwrapping it would skip the link-local / unique-local hextet checks
 * below and let `fe80::1.2.3.4` masquerade as the public address 1.2.3.4. In
 * practice the WHATWG URL parser already normalizes such inputs to hex form, so
 * this is defense-in-depth, but the predicate must be correct on its own.
 */
function embeddedIpv4(ip: string): number[] | null {
  if (!ip.includes("::ffff:")) return null;

  // Dotted tail form: ::ffff:1.2.3.4
  const lastColon = ip.lastIndexOf(":");
  const tail = lastColon >= 0 ? ip.slice(lastColon + 1) : ip;
  if (tail.includes(".")) return ipv4Octets(tail);

  // Hex form: an IPv4-mapped address ends in two hextets after ::ffff:.
  const groups = ip.split(":").filter((g) => g.length > 0);
  if (groups.length < 2) return null;
  const hi = parseInt(groups[groups.length - 2], 16);
  const lo = parseInt(groups[groups.length - 1], 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
  return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
}

/**
 * Enforce the optional repo-root file sandbox. The sandbox is opt-in: it only
 * applies when `fileRoot` is set (preserving legacy "read anywhere" behavior
 * for callers that don't configure a root). When active, a `file:` source must
 * resolve to a path inside `fileRoot`; `..` traversal and absolute paths that
 * escape the root are rejected. Set `allowFileOutsideRoot` to opt back out even
 * when a root is configured.
 */
function assertFileWithinRoot(absolute: string, ctx: SourceResolutionContext, fieldPath: string): void {
  if (ctx.allowFileOutsideRoot) return;
  if (!ctx.fileRoot) return; // sandbox not configured — legacy behavior
  const root = path.resolve(ctx.fileRoot);
  const normalized = path.resolve(absolute);
  const rel = path.relative(root, normalized);
  const escapes = rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel);
  if (escapes) {
    throw new Error(
      `SOURCE_FILE_OUTSIDE_ROOT: ${absolute} is outside the allowed root ${root} (referenced by ${fieldPath}). Set allowFileOutsideRoot to permit reads outside the repo.`,
    );
  }
}
