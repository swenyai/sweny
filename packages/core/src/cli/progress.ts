/**
 * Node progress lines for `sweny workflow run` and `sweny try`: a spinner on
 * the running node when the output is live, then one settled line per node.
 *
 *   ⠙ survey  7 tool calls          (live, redrawn in place)
 *   ✓ survey   18s · 12 tool calls   (settled)
 *
 * Not live (pipes, CI, --verbose): no redraws, no spinner, one line per event.
 */

import { SPINNER_INTERVAL_MS } from "../theme.js";
import type { Paint } from "./style.js";
import { glyphsFor, spinnerFramesFor } from "./terminal.js";

export interface NodeProgressOptions {
  write: (s: string) => void;
  /** Redraw the running node in place with a spinner. */
  live: boolean;
  unicode: boolean;
  paint: Paint;
  /** Pad node ids to this width so the details line up. */
  idWidth?: number;
  /** When not live, print a `○ node…` line as each node starts. Default false. */
  announce?: boolean;
}

export type SettledStatus = "success" | "failed" | "skipped";

export interface NodeProgress {
  enter(node: string): void;
  /** One unit of work (a tool call) on the running node. */
  tick(node: string): void;
  /** Settle the node: its glyph, its id, and a muted detail (`18s · 12 tool calls`). */
  exit(node: string, status: SettledStatus, detail?: string): void;
  /** Stop any spinner without settling (a crash). Clears the live line. */
  stop(): void;
}

export function toolCallsText(n: number): string {
  return `${n} tool ${n === 1 ? "call" : "calls"}`;
}

export function createNodeProgress(o: NodeProgressOptions): NodeProgress {
  const g = glyphsFor(o.unicode);
  const frames = spinnerFramesFor(o.unicode);
  const { paint } = o;
  const pad = (id: string) => id.padEnd(o.idWidth ?? 0);
  let timer: ReturnType<typeof setInterval> | undefined;
  let current: { node: string; calls: number } | undefined;
  let frame = 0;

  const draw = () => {
    if (!current) return;
    const calls = current.calls > 0 ? `  ${paint.muted(toolCallsText(current.calls))}` : "";
    o.write(`\r\x1B[2K  ${paint.brand(frames[frame++ % frames.length])} ${current.node}${calls}`);
  };
  const clear = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (current && o.live) o.write("\r\x1B[2K");
    current = undefined;
  };

  return {
    enter(node) {
      clear();
      if (o.live) {
        current = { node, calls: 0 };
        frame = 0;
        draw();
        timer = setInterval(draw, SPINNER_INTERVAL_MS);
        timer.unref?.();
      } else if (o.announce) {
        o.write(`  ${paint.muted(g.pending)} ${paint.muted(node)}${g.ellipsis}\n`);
      }
    },
    tick(node) {
      if (current && current.node === node) current.calls++;
    },
    exit(node, status, detail) {
      clear();
      const glyph =
        status === "success"
          ? paint.success(g.success)
          : status === "failed"
            ? paint.error(g.failure)
            : paint.muted(g.skipped);
      const tail = detail ? `  ${paint.muted(detail)}` : "";
      o.write(`  ${glyph} ${detail ? pad(node) : node}${tail}\n`);
    },
    stop() {
      clear();
    },
  };
}
