/**
 * Security tests for source resolution: SSRF guards, credential scoping, and
 * the file-path sandbox.
 *
 * Covers:
 *   - blocked private / loopback / link-local IPs (incl. 169.254.169.254 + IPv6)
 *   - blocked redirect to the cloud metadata endpoint (per-hop re-validation)
 *   - fetch token NOT sent to a non-allowlisted host
 *   - file path traversal blocked by the repo-root sandbox
 *   - normal https URL + relative file paths still resolve (back-compat)
 */

import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SourceResolutionContext } from "./sources.js";
import { resolveSource } from "./source-resolver.js";

const fileTmp = path.join(tmpdir(), `sweny-sources-security-test-${randomBytes(4).toString("hex")}`);

const baseCtx = (): SourceResolutionContext => ({
  cwd: "/tmp",
  env: {} as NodeJS.ProcessEnv,
  authConfig: {},
  offline: false,
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
});

// ── scheme allowlist ─────────────────────────────────────────────

describe("scheme allowlist", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("blocks non-http(s) schemes on tagged url sources", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(resolveSource({ url: "file:///etc/passwd" }, "ctx[0]", baseCtx())).rejects.toThrow(
      /SOURCE_URL_BLOCKED.*scheme/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── SSRF: blocked IPs ────────────────────────────────────────────

describe("SSRF host validation (literal IPs)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("blocks the cloud metadata endpoint 169.254.169.254", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(resolveSource("http://169.254.169.254/latest/meta-data/", "ctx[0]", baseCtx())).rejects.toThrow(
      /SOURCE_URL_BLOCKED.*169\.254\.169\.254/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks loopback 127.0.0.1", async () => {
    await expect(resolveSource("http://127.0.0.1:8080/secret", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
  });

  it("blocks private 10.x / 192.168.x / 172.16.x", async () => {
    await expect(resolveSource("http://10.0.0.5/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
    await expect(resolveSource("http://192.168.1.1/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
    await expect(resolveSource("http://172.16.0.1/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
  });

  it("blocks IPv6 loopback ::1 and link-local fe80::", async () => {
    await expect(resolveSource("http://[::1]/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
    await expect(resolveSource("http://[fe80::1]/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
  });

  it("blocks IPv4-mapped IPv6 form of the metadata endpoint", async () => {
    await expect(resolveSource("http://[::ffff:169.254.169.254]/x", "f", baseCtx())).rejects.toThrow(
      /SOURCE_URL_BLOCKED/,
    );
  });

  it("blocks the IPv4-mapped IPv6 metadata endpoint in hex form", async () => {
    // The WHATWG URL parser normalizes ::ffff:169.254.169.254 to ::ffff:a9fe:a9fe.
    await expect(resolveSource("http://[::ffff:a9fe:a9fe]/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
  });

  it("blocks 0.0.0.0 (unspecified address)", async () => {
    await expect(resolveSource("http://0.0.0.0/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
  });

  it("blocks CGNAT 100.64.0.0/10", async () => {
    await expect(resolveSource("http://100.64.0.1/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
  });
});

// ── SSRF: obfuscated IP literals (URL-parser normalization) ──────
//
// These hosts are NOT dotted-quad as written. The WHATWG URL parser (used by
// both our guard's `new URL(...).hostname` and by `fetch`) normalizes them to
// 127.0.0.1 / 0.0.0.0 BEFORE the IP check runs, so the literal-IP fast path
// catches them with no DNS lookup. These are regression tests: if the resolver
// ever stops reading the normalized `.hostname`, they fail loudly.

describe("SSRF host validation (obfuscated IP literals)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("blocks decimal IP literal http://2130706433/ (= 127.0.0.1)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(resolveSource("http://2130706433/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks octal IP literal http://0177.0.0.1/ (= 127.0.0.1)", async () => {
    await expect(resolveSource("http://0177.0.0.1/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
  });

  it("blocks hex IP literal http://0x7f.0.0.1/ (= 127.0.0.1)", async () => {
    await expect(resolveSource("http://0x7f.0.0.1/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
  });

  it("blocks short-form IP literal http://127.1/ (= 127.0.0.1)", async () => {
    await expect(resolveSource("http://127.1/x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
  });

  it("blocks a trailing-dot loopback host http://127.0.0.1./", async () => {
    await expect(resolveSource("http://127.0.0.1./x", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_BLOCKED/);
  });

  it("blocks userinfo-prefixed metadata host http://x@169.254.169.254/", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(resolveSource("http://x@169.254.169.254/latest/", "f", baseCtx())).rejects.toThrow(
      /SOURCE_URL_BLOCKED.*169\.254\.169\.254/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks an uppercase-scheme metadata URL (tagged form) HTTP://169.254.169.254/", async () => {
    // Tagged {url} form so the string classifier (lowercase http:// only) does
    // not misroute it to inline. assertAllowedScheme reads the URL-parser's
    // lowercased protocol, then the host check rejects the metadata IP.
    await expect(resolveSource({ url: "HTTP://169.254.169.254/latest/" }, "f", baseCtx())).rejects.toThrow(
      /SOURCE_URL_BLOCKED/,
    );
  });
});

// ── SSRF: blocked via hostname DNS resolution ────────────────────

describe("SSRF host validation (DNS resolution)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("blocks a hostname that resolves to a private IP", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      resolveSource("https://evil.example/x", "f", {
        ...baseCtx(),
        dnsLookup: async () => ["10.1.2.3"],
      }),
    ).rejects.toThrow(/SOURCE_URL_BLOCKED.*10\.1\.2\.3/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a hostname that resolves to a public IP", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok", { status: 200 }));
    const resolved = await resolveSource("https://good.example/x", "f", {
      ...baseCtx(),
      dnsLookup: async () => ["93.184.216.34"],
    });
    expect(resolved.content).toBe("ok");
  });

  it("allows a hostname that fails to resolve (fetch handles the error)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok", { status: 200 }));
    const resolved = await resolveSource("https://unresolvable.test/x", "f", {
      ...baseCtx(),
      dnsLookup: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(resolved.content).toBe("ok");
  });
});

// ── SSRF: blocked redirect to metadata endpoint ──────────────────

describe("redirect re-validation", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("blocks a redirect that points at the metadata endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    });
    await expect(
      resolveSource("https://good.example/redirect", "f", {
        ...baseCtx(),
        dnsLookup: async () => ["93.184.216.34"],
      }),
    ).rejects.toThrow(/SOURCE_URL_BLOCKED.*169\.254\.169\.254/);
  });

  it("follows a redirect to an allowed public host", async () => {
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call++;
      if (call === 1) {
        return new Response(null, { status: 302, headers: { location: "https://final.example/doc" } });
      }
      return new Response("final body", { status: 200 });
    });
    const resolved = await resolveSource("https://start.example/x", "f", {
      ...baseCtx(),
      dnsLookup: async () => ["93.184.216.34"],
    });
    expect(resolved.content).toBe("final body");
  });

  it("does NOT replay the token to a non-allowlisted redirect host", async () => {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url, auth: headers.Authorization });
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: "https://other.example/leak" } });
      }
      return new Response("ok", { status: 200 });
    });
    await resolveSource("https://allowed.example/x", "f", {
      ...baseCtx(),
      env: { SWENY_FETCH_TOKEN: "secret" } as NodeJS.ProcessEnv,
      fetchTokenHosts: ["allowed.example"],
      dnsLookup: async () => ["93.184.216.34"],
    });
    expect(calls[0].auth).toBe("Bearer secret"); // first hop: allowlisted host gets token
    expect(calls[1].auth).toBeUndefined(); // redirect to non-allowlisted host: no token
  });
});

// ── file sandbox: traversal ──────────────────────────────────────

describe("file-path sandbox", () => {
  beforeEach(() => {
    rmSync(fileTmp, { recursive: true, force: true });
    mkdirSync(fileTmp, { recursive: true });
  });

  it("blocks path traversal out of the configured root", async () => {
    writeFileSync(path.join(fileTmp, "inside.md"), "inside");
    await expect(
      resolveSource("../../../../etc/passwd", "f", { ...baseCtx(), cwd: fileTmp, fileRoot: fileTmp }),
    ).rejects.toThrow(/SOURCE_FILE_OUTSIDE_ROOT/);
  });

  it("blocks an absolute path outside the configured root", async () => {
    await expect(resolveSource("/etc/passwd", "f", { ...baseCtx(), cwd: fileTmp, fileRoot: fileTmp })).rejects.toThrow(
      /SOURCE_FILE_OUTSIDE_ROOT/,
    );
  });

  it("allows a relative path inside the configured root", async () => {
    writeFileSync(path.join(fileTmp, "ok.md"), "ok body");
    const resolved = await resolveSource("./ok.md", "f", { ...baseCtx(), cwd: fileTmp, fileRoot: fileTmp });
    expect(resolved.content).toBe("ok body");
  });

  it("allowFileOutsideRoot opt-out permits reads outside the root", async () => {
    const outside = path.join(fileTmp, "..", `outside-${randomBytes(3).toString("hex")}.md`);
    writeFileSync(outside, "outside body");
    try {
      const resolved = await resolveSource(outside, "f", {
        ...baseCtx(),
        cwd: fileTmp,
        fileRoot: fileTmp,
        allowFileOutsideRoot: true,
      });
      expect(resolved.content).toBe("outside body");
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("rejects a symlink inside the root that points outside it", async () => {
    // A symlink that lives inside the sandbox but targets an external secret.
    // The lexical check alone would pass it; realpath canonicalization catches it.
    const secret = path.join(tmpdir(), `sweny-secret-${randomBytes(4).toString("hex")}.md`);
    writeFileSync(secret, "TOP-SECRET-OUTSIDE-ROOT");
    const link = path.join(fileTmp, "link.md");
    try {
      symlinkSync(secret, link);
    } catch {
      // Some CI environments disallow symlink creation; skip rather than fail.
      rmSync(secret, { force: true });
      return;
    }
    try {
      await expect(resolveSource("./link.md", "f", { ...baseCtx(), cwd: fileTmp, fileRoot: fileTmp })).rejects.toThrow(
        /SOURCE_FILE_OUTSIDE_ROOT/,
      );
    } finally {
      rmSync(link, { force: true });
      rmSync(secret, { force: true });
    }
  });

  it("with allowFileOutsideRoot, legacy read-anywhere behavior is restored", async () => {
    const abs = path.join(fileTmp, "legacy.md");
    writeFileSync(abs, "legacy body");
    // fileRoot is /tmp (the sandbox is active), abs is under tmpdir (not /tmp on
    // macOS): the explicit opt-out is what lets it through, not an unset root.
    const resolved = await resolveSource(abs, "f", { ...baseCtx(), fileRoot: "/tmp", allowFileOutsideRoot: true });
    expect(resolved.content).toBe("legacy body");
  });
});

// ── back-compat: normal https + relative file still work ─────────

describe("back-compat smoke", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rmSync(fileTmp, { recursive: true, force: true });
    mkdirSync(fileTmp, { recursive: true });
  });

  it("resolves a normal https URL (public host)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("# Rules", { status: 200 }));
    const resolved = await resolveSource("https://example.com/rules.md", "f", {
      ...baseCtx(),
      dnsLookup: async () => ["93.184.216.34"],
    });
    expect(resolved.content).toBe("# Rules");
  });

  it("resolves an in-repo relative file path", async () => {
    writeFileSync(path.join(fileTmp, "rel.md"), "relative body");
    const resolved = await resolveSource("./rel.md", "f", { ...baseCtx(), cwd: fileTmp });
    expect(resolved.content).toBe("relative body");
  });
});
