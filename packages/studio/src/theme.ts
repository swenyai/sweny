/**
 * Studio brand tokens. Values mirror docs/brand-guide.md.
 * The shared theme module in @sweny-ai/core (#479) is the long-term home;
 * once it lands this file can re-export from there.
 */

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
  surface: "#162032",
  nodeBg: "rgba(8,14,26,0.92)",
  border: "#334155",
  grid: "#1e2840",
  text: "#f1f5f9",
  textSecondary: "#94a3b8",
  textMuted: "#64748b",
  primary: "#3b82f6",
  primaryHover: "#2563eb",
  accent: "#60a5fa",
  success: "#60a5fa",
  warning: "#facc15",
  error: "#f87171",
  labelBg: "#eff6ff",
  labelBorder: "#bfdbfe",
  labelText: "#1d4ed8",
};

export const lightTokens: StudioTokens = {
  canvas: "#f8fafc",
  surface: "#ffffff",
  nodeBg: "#ffffff",
  border: "#e2e8f0",
  grid: "#e2e8f0",
  text: "#0f172a",
  textSecondary: "#64748b",
  textMuted: "#94a3b8",
  primary: "#2563eb",
  primaryHover: "#1d4ed8",
  accent: "#3b82f6",
  success: "#2563eb",
  warning: "#ca8a04",
  error: "#dc2626",
  labelBg: "#eff6ff",
  labelBorder: "#bfdbfe",
  labelText: "#1d4ed8",
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
