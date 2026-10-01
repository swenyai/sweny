import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const webRoot = fileURLToPath(new URL("../..", import.meta.url));
const specRoot = fileURLToPath(new URL("../../../../spec", import.meta.url));

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const REMOTE_SCRIPT_TAG = /<script[^>]*\ssrc\s*=\s*["']?(?:https?:)?\/\//i;
// import("https://..."), import x from "https://...", importScripts("https://...")
const REMOTE_IMPORT = [
  /\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?["'`]https?:\/\//,
  /\bfrom\s+["']https?:\/\//,
  /\bimportScripts\s*\(\s*["']https?:\/\//,
];
const CDN_HOSTS = /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|skypack\.dev|ga\.jspm\.io/i;

describe("no third-party script loading", () => {
  const exts = [".astro", ".ts", ".tsx", ".js", ".mjs", ".html"];
  const sources = [
    ...walk(join(webRoot, "src"), exts).filter((f) => !f.includes("__tests__")),
    ...walk(join(specRoot, "src"), exts),
    join(webRoot, "astro.config.mjs"),
    join(specRoot, "astro.config.mjs"),
  ].filter(existsSync);

  it("scans source components", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it("source components never reference a CDN or remote script", () => {
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      expect(CDN_HOSTS.test(text), `${file} references a CDN host`).toBe(false);
      expect(REMOTE_SCRIPT_TAG.test(text), `${file} has a remote script tag`).toBe(false);
      for (const re of REMOTE_IMPORT) expect(re.test(text), `${file} matches ${re}`).toBe(false);
    }
  });

  it("mermaid is a pinned dependency imported through the build", () => {
    const pkg = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8"));
    expect(pkg.dependencies.mermaid).toMatch(/^\d+\.\d+\.\d+$/);
    const footer = readFileSync(join(webRoot, "src/components/Footer.astro"), "utf8");
    expect(footer).toContain('import("mermaid")');
    expect(footer).toContain('securityLevel: "strict"');
  });

  // Built output exists only after `astro build`; the docs-sites CI job builds before it asserts.
  for (const [name, root] of [
    ["docs", join(webRoot, "dist")],
    ["spec", join(specRoot, "dist")],
  ] as const) {
    it.skipIf(!existsSync(root))(`built ${name} output loads no third-party script`, () => {
      const html = walk(root, [".html"]);
      const js = walk(root, [".js", ".mjs"]);
      expect(html.length).toBeGreaterThan(0);
      for (const file of html) {
        const text = readFileSync(file, "utf8");
        expect(CDN_HOSTS.test(text), `${file} references a CDN host`).toBe(false);
        expect(REMOTE_SCRIPT_TAG.test(text), `${file} has a remote script tag`).toBe(false);
      }
      for (const file of js) {
        const text = readFileSync(file, "utf8");
        for (const re of REMOTE_IMPORT) expect(re.test(text), `${file} matches ${re}`).toBe(false);
      }
    });
  }
});
