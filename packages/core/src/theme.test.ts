import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GLYPHS,
  MERMAID_CLASS_DEFS,
  MERMAID_EDGE_STYLES,
  PALETTE,
  ROLE_COLORS,
  SPINNER_FRAMES,
  SURFACE_COLORS,
  SWENY_TAGLINE,
  TICKET_BOX,
} from "./theme.js";
import * as browser from "./browser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const brandGuide = fs.readFileSync(path.join(root, "docs/brand-guide.md"), "utf8");

describe("theme tokens (#479)", () => {
  it("role colors are the brand guide's: blue primary, green/yellow/red semantics, slate muted", () => {
    expect(ROLE_COLORS.brand).toBe("#3b82f6");
    expect(ROLE_COLORS.brandStrong).toBe("#2563eb");
    expect(ROLE_COLORS.success).toBe("#4ade80");
    expect(ROLE_COLORS.warning).toBe("#facc15");
    expect(ROLE_COLORS.error).toBe("#f87171");
    expect(ROLE_COLORS.info).toBe("#60a5fa");
    expect(ROLE_COLORS.muted).toBe("#64748b");
    const { brandDeep: _deep, ...fromGuide } = ROLE_COLORS;
    for (const hex of [...Object.values(fromGuide), SURFACE_COLORS.dark.background, SURFACE_COLORS.light.primary]) {
      expect(brandGuide.toLowerCase(), hex).toContain(hex);
    }
  });

  it("no orange, no indigo, anywhere in the palette", () => {
    const all = JSON.stringify({ PALETTE, ROLE_COLORS, SURFACE_COLORS, MERMAID_CLASS_DEFS, MERMAID_EDGE_STYLES });
    expect(all).not.toMatch(/#ff6b2b|#cc5522|#f59e0b|#6366f1|#4f46e5/i);
    for (const v of Object.values(PALETTE)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("the tagline is the README's", () => {
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toContain(SWENY_TAGLINE);
  });

  it("the README npm badge is brand blue, not orange", () => {
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    expect(readme).toContain("npm/v/@sweny-ai/core?style=flat-square&color=3b82f6");
    expect(readme).not.toMatch(/color=orange/);
  });

  it("one glyph per meaning; unicode and ascii sets have the same keys", () => {
    expect(Object.keys(GLYPHS.ascii).sort()).toEqual(Object.keys(GLYPHS.unicode).sort());
    const uni = Object.values(GLYPHS.unicode);
    expect(new Set(uni).size).toBe(uni.length);
    // single code point each, so they are one terminal column
    for (const g of uni) expect([...g]).toHaveLength(1);
    for (const g of Object.values(GLYPHS.ascii)) expect(g).toMatch(/^[\x20-\x7e]+$/);
    expect(GLYPHS.unicode.success).toBe("✓");
    expect(GLYPHS.unicode.failure).toBe("✗");
  });

  it("box and spinner sets: unicode is single-column, ascii is printable", () => {
    expect(Object.keys(TICKET_BOX.ascii).sort()).toEqual(Object.keys(TICKET_BOX.unicode).sort());
    for (const v of Object.values(TICKET_BOX.unicode)) expect([...v]).toHaveLength(1);
    for (const v of Object.values(TICKET_BOX.ascii)) expect(v).toMatch(/^[\x20-\x7e]+$/);
    for (const f of SPINNER_FRAMES.ascii) expect(f).toMatch(/^[\x20-\x7e]$/);
    expect(SPINNER_FRAMES.unicode.length).toBeGreaterThan(1);
  });

  it("no em dash in any token", () => {
    expect(JSON.stringify({ GLYPHS, TICKET_BOX, SWENY_TAGLINE })).not.toContain("\u2014");
  });

  it("theme.ts is browser-safe: no imports at all (no chalk, no node:)", () => {
    const src = fs.readFileSync(path.join(here, "theme.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\brequire\(|\bprocess\./);
  });

  it("is exported from both the node and the browser entry", () => {
    const b = browser as Record<string, unknown>;
    expect(b.ROLE_COLORS).toBe(ROLE_COLORS);
    expect(b.GLYPHS).toBe(GLYPHS);
    expect(b.MERMAID_CLASS_DEFS).toBe(MERMAID_CLASS_DEFS);
    expect(fs.readFileSync(path.join(here, "index.ts"), "utf8")).toMatch(/ROLE_COLORS,[\s\S]*?\} from "\.\/theme\.js"/);
  });

  it("is a package subpath: @sweny-ai/core/theme", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8"));
    expect(pkg.exports["./theme"]).toBe("./dist/theme.js");
    expect(pkg.typesVersions["*"].theme).toEqual(["dist/theme.d.ts"]);
  });
});
