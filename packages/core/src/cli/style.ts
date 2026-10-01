/**
 * Terminal painters built from the theme tokens. The only place the CLI
 * turns a color role into ANSI.
 *
 * `createPaint(false)` returns identity painters, so a formatter takes one
 * `Paint` and renders the same text with or without color.
 */

import chalk, { Chalk, chalkStderr } from "chalk";
import { ROLE_COLORS } from "../theme.js";

export type Painter = (text: string) => string;

export interface Paint {
  brand: Painter;
  success: Painter;
  warning: Painter;
  error: Painter;
  info: Painter;
  muted: Painter;
  /** Emphasis without a color: bold. */
  strong: Painter;
  link: Painter;
}

const identity: Painter = (s) => s;

/** Painters for one output. `enabled: false` paints nothing. */
export function createPaint(enabled: boolean): Paint {
  if (!enabled) {
    return {
      brand: identity,
      success: identity,
      warning: identity,
      error: identity,
      info: identity,
      muted: identity,
      strong: identity,
      link: identity,
    };
  }
  // Force a level so a caller that decided "color on" gets color even when
  // chalk's own detection looked at a different stream.
  const k = new Chalk({ level: Math.max(chalk.level, chalkStderr.level, 1) as 1 | 2 | 3 });
  return {
    brand: (s) => k.hex(ROLE_COLORS.brand)(s),
    success: (s) => k.hex(ROLE_COLORS.success)(s),
    warning: (s) => k.hex(ROLE_COLORS.warning)(s),
    error: (s) => k.hex(ROLE_COLORS.error)(s),
    info: (s) => k.hex(ROLE_COLORS.info)(s),
    muted: (s) => k.hex(ROLE_COLORS.muted)(s),
    strong: (s) => k.bold(s),
    link: (s) => k.hex(ROLE_COLORS.info).underline(s),
  };
}

/**
 * Honor `NO_COLOR` for every chalk call in the process, including the ones
 * that do not go through `createPaint`. Call once at CLI startup.
 */
export function applyNoColor(env: Record<string, string | undefined> = process.env): void {
  if (env.NO_COLOR) {
    chalk.level = 0;
    chalkStderr.level = 0;
  }
}
