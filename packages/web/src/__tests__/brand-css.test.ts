import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PALETTE, SURFACE_COLORS } from "@sweny-ai/core/theme";

const css = readFileSync(fileURLToPath(new URL("../styles/brand.css", import.meta.url)), "utf8");

/** The value of `--name` inside the block that starts with `selector`. */
function token(selector: string, name: string): string | undefined {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return undefined;
  const block = css.slice(start, css.indexOf("}", start));
  return new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];
}

describe("brand.css", () => {
  it("dark mode uses the theme tokens", () => {
    expect(token(":root", "--sl-color-accent")).toBe(SURFACE_COLORS.dark.primary);
    expect(token(":root", "--sl-color-accent-low")).toBe(PALETTE.blue900);
    expect(token(":root", "--sl-color-accent-high")).toBe(PALETTE.blue300);
    expect(token(":root", "--sl-color-black")).toBe(SURFACE_COLORS.dark.background);
    expect(token(":root", "--sl-color-gray-6")).toBe(SURFACE_COLORS.dark.surface);
    expect(token(":root", "--sl-color-gray-5")).toBe(SURFACE_COLORS.dark.border);
    expect(token(":root", "--sl-color-white")).toBe(SURFACE_COLORS.dark.text);
    expect(token(":root", "--sl-color-gray-3")).toBe(SURFACE_COLORS.dark.textSecondary);
  });

  it("light mode uses the theme tokens", () => {
    const sel = ':root[data-theme="light"]';
    expect(token(sel, "--sl-color-accent")).toBe(SURFACE_COLORS.light.primary);
    expect(token(sel, "--sl-color-accent-high")).toBe(PALETTE.blue900);
    expect(token(sel, "--sl-color-black")).toBe(SURFACE_COLORS.light.surface);
    expect(token(sel, "--sl-color-gray-6")).toBe(SURFACE_COLORS.light.background);
    expect(token(sel, "--sl-color-gray-5")).toBe(SURFACE_COLORS.light.border);
    expect(token(sel, "--sl-color-white")).toBe(SURFACE_COLORS.light.text);
    expect(token(sel, "--sl-color-gray-3")).toBe(SURFACE_COLORS.light.textSecondary);
  });
});
