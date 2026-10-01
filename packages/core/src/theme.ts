/**
 * SWEny visual tokens: one palette, one glyph set, one meaning per color.
 *
 * The single source for the CLI, the PR comment, the Mermaid diagrams, and
 * Studio. Values come from docs/brand-guide.md. Browser-safe on purpose: no
 * imports, no `process`, no chalk. Terminal painters live in `cli/style.ts`
 * and are built from these tokens.
 *
 * Import from `@sweny-ai/core`, `@sweny-ai/core/browser`, or
 * `@sweny-ai/core/theme`.
 */

/** The product line, as on the README and docs. */
export const SWENY_TAGLINE = "Workflows for coding agents. One set of rules, a receipt for every run.";

// ── Palette ─────────────────────────────────────────────────────

/** Raw brand palette (Tailwind names in comments). Prefer `ROLE_COLORS` in UI code. */
export const PALETTE = {
  blue300: "#93c5fd", // blue-300
  blue400: "#60a5fa", // blue-400, accent light
  blue500: "#3b82f6", // blue-500, primary
  blue600: "#2563eb", // blue-600, primary hover, light-mode primary
  blue700: "#1d4ed8", // blue-700
  blue900: "#1e3a5f", // primary muted
  green400: "#4ade80", // green-400
  green600: "#16a34a", // green-600
  yellow400: "#facc15", // yellow-400
  yellow600: "#ca8a04", // yellow-600
  red400: "#f87171", // red-400
  red600: "#dc2626", // red-600
  red800: "#991b1b", // red-800
  slate50: "#f8fafc",
  slate100: "#f1f5f9",
  slate200: "#e2e8f0",
  slate400: "#94a3b8",
  slate500: "#64748b",
  slate600: "#475569",
  slate700: "#334155",
  slate800: "#1e293b",
  slate900: "#0f172a",
  surface: "#162032",
  white: "#ffffff",
} as const;

/**
 * One color per meaning. Every surface (terminal, PR comment, diagram,
 * Studio) maps a meaning to the same token:
 *
 * - `brand`   the SWEny mark, the policy stamp, the running spinner, current work
 * - `success` a passed node or run
 * - `warning` something ran weaker than asked (unscoped env, no sandbox, degraded)
 * - `error`   a failed node or run, a budget stop
 * - `info`    links and neutral highlights
 * - `muted`   labels, frames, pending and skipped work
 */
export const ROLE_COLORS = {
  brand: PALETTE.blue500,
  brandStrong: PALETTE.blue600,
  brandDeep: PALETTE.blue700,
  success: PALETTE.green400,
  warning: PALETTE.yellow400,
  error: PALETTE.red400,
  info: PALETTE.blue400,
  muted: PALETTE.slate500,
} as const;

export type ColorRole = keyof typeof ROLE_COLORS;

/** Surface colors for dark and light UIs (Studio, docs). */
export const SURFACE_COLORS = {
  dark: {
    background: PALETTE.slate800,
    surface: PALETTE.surface,
    border: PALETTE.slate700,
    primary: PALETTE.blue500,
    text: PALETTE.slate100,
    textSecondary: PALETTE.slate400,
    textMuted: PALETTE.slate500,
  },
  light: {
    background: PALETTE.slate50,
    surface: PALETTE.white,
    border: PALETTE.slate200,
    primary: PALETTE.blue600,
    text: PALETTE.slate900,
    textSecondary: PALETTE.slate500,
    textMuted: PALETTE.slate400,
  },
} as const;

// ── Glyphs ──────────────────────────────────────────────────────

/**
 * The glyph set. One glyph per meaning, everywhere:
 *
 * | key      | unicode | ascii | meaning                              |
 * |----------|---------|-------|--------------------------------------|
 * | success  | ✓       | +     | node or run passed                   |
 * | failure  | ✗       | x     | node or run failed                   |
 * | skipped  | −       | -     | node skipped                         |
 * | pending  | ○       | o     | node not reached yet                 |
 * | running  | ●       | *     | node running (static views)          |
 * | warning  | ⚠       | !     | a warning line                       |
 * | brand    | ▲       | ^     | the SWEny mark                       |
 * | detail   | ↳       | >     | a detail line under a node           |
 * | sep      | ·       | |     | separator between inline facts       |
 * | ellipsis | …       | ...   | work in progress, truncated text     |
 * | arrow    | →       | ->    | a route taken, a change from a to b  |
 *
 * Every unicode glyph above is a single terminal column.
 */
export const GLYPHS = {
  unicode: {
    success: "✓",
    failure: "✗",
    skipped: "−",
    pending: "○",
    running: "●",
    warning: "⚠",
    brand: "▲",
    detail: "↳",
    sep: "·",
    ellipsis: "…",
    arrow: "→",
  },
  ascii: {
    success: "+",
    failure: "x",
    skipped: "-",
    pending: "o",
    running: "*",
    warning: "!",
    brand: "^",
    detail: ">",
    sep: "|",
    ellipsis: "...",
    arrow: "->",
  },
} as const;

export type GlyphKey = keyof typeof GLYPHS.unicode;
export type GlyphSet = { readonly [K in GlyphKey]: string };

/** Spinner frames for live work: braille dots, or a plain ASCII bar. */
export const SPINNER_FRAMES = {
  unicode: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  ascii: ["|", "/", "-", "\\"],
} as const;

/** Spinner frame interval in ms. */
export const SPINNER_INTERVAL_MS = 80;

/**
 * Box drawing for the receipt ticket. The frame is perforated (dashed
 * edges); the tear line separates the stub that carries the policy stamp.
 */
export const TICKET_BOX = {
  unicode: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "┄",
    vertical: "┆",
    tearLeft: "├",
    tearRight: "┤",
    tear: "╌",
  },
  ascii: {
    topLeft: "+",
    topRight: "+",
    bottomLeft: "+",
    bottomRight: "+",
    horizontal: "-",
    vertical: ":",
    tearLeft: "+",
    tearRight: "+",
    tear: "- ",
  },
} as const;

export type TicketBox = { readonly [K in keyof typeof TICKET_BOX.unicode]: string };

// ── Diagrams ────────────────────────────────────────────────────

/** Node states a diagram can show. `pending` is any node the run never reached. */
export type DiagramNodeStatus = "current" | "success" | "failed" | "skipped" | "pending";

/**
 * Mermaid `classDef` bodies by node status. Readable on GitHub light and dark:
 * filled nodes carry white text, pending is an outline in slate-500 (legible
 * on both backgrounds).
 */
export const MERMAID_CLASS_DEFS: Readonly<Record<DiagramNodeStatus, string>> = {
  current: `fill:${PALETTE.blue500},stroke:${PALETTE.blue700},color:#fff,stroke-width:4px`,
  success: `fill:${PALETTE.blue600},stroke:${PALETTE.blue700},color:#fff,stroke-width:2px`,
  failed: `fill:${PALETTE.red600},stroke:${PALETTE.red800},color:#fff,stroke-width:2px`,
  skipped: `fill:${PALETTE.slate500},stroke:${PALETTE.slate600},color:#fff,stroke-dasharray:5 5`,
  pending: `fill:none,stroke:${PALETTE.slate500},color:${PALETTE.slate500},stroke-width:1px`,
};

/** Mermaid `linkStyle` bodies for edges a traced run took and did not take. */
export const MERMAID_EDGE_STYLES = {
  taken: `stroke:${PALETTE.blue600},stroke-width:3px`,
  notTaken: `stroke:${PALETTE.slate500},stroke-width:1px,stroke-dasharray:5 5`,
} as const;
