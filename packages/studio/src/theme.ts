/**
 * Studio brand tokens, built from the shared theme in @sweny-ai/core (#479).
 * Only Studio-specific surfaces (canvas, node, grid, label chip) live here;
 * every brand, text, border and status color comes from core.
 */
import { PALETTE, ROLE_COLORS, SURFACE_COLORS } from "@sweny-ai/core/theme";

export interface StudioTokens {
  canvas: string;
  surface: string;
  nodeBg: string;
  border: string;
  grid: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryHover: string;
  accent: string;
  /** Brand success is blue, matching the PR and CLI output. */
  success: string;
  warning: string;
  error: string;
  labelBg: string;
  labelBorder: string;
  labelText: string;
}

export const darkTokens: StudioTokens = {
  canvas: "#0f1a2c",
  surface: SURFACE_COLORS.dark.surface,
  nodeBg: "rgba(8,14,26,0.92)",
  border: SURFACE_COLORS.dark.border,
  grid: "#1e2840",
  text: SURFACE_COLORS.dark.text,
  textSecondary: SURFACE_COLORS.dark.textSecondary,
  textMuted: SURFACE_COLORS.dark.textMuted,
  primary: ROLE_COLORS.brand,
  primaryHover: ROLE_COLORS.brandStrong,
  accent: ROLE_COLORS.info,
  success: ROLE_COLORS.info,
  warning: ROLE_COLORS.warning,
  error: ROLE_COLORS.error,
  labelBg: "#eff6ff",
  labelBorder: "#bfdbfe",
  labelText: PALETTE.blue700,
};

export const lightTokens: StudioTokens = {
  canvas: SURFACE_COLORS.light.background,
  surface: SURFACE_COLORS.light.surface,
  nodeBg: PALETTE.white,
  border: SURFACE_COLORS.light.border,
  grid: PALETTE.slate200,
  text: SURFACE_COLORS.light.text,
  textSecondary: SURFACE_COLORS.light.textSecondary,
  textMuted: SURFACE_COLORS.light.textMuted,
  primary: SURFACE_COLORS.light.primary,
  primaryHover: PALETTE.blue700,
  accent: PALETTE.blue500,
  success: PALETTE.blue600,
  warning: PALETTE.yellow600,
  error: PALETTE.red600,
  labelBg: "#eff6ff",
  labelBorder: "#bfdbfe",
  labelText: PALETTE.blue700,
};

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function cssVars(t: StudioTokens): string {
  return (Object.keys(t) as (keyof StudioTokens)[]).map((k) => `--sw-${kebab(k)}:${t[k]};`).join("");
}

/** Dark by default, light under prefers-color-scheme: light. */
export const THEME_CSS = `:root{${cssVars(darkTokens)}color-scheme:dark light;}@media (prefers-color-scheme: light){:root{${cssVars(lightTokens)}}}`;

/** var() reference with a dark fallback, so components still render outside the Studio shell. */
export function tok(name: keyof StudioTokens): string {
  return `var(--sw-${kebab(name)}, ${darkTokens[name]})`;
}
