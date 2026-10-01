export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Label typography, shared by measurement and rendering. */
export const LABEL_FONT_SIZE = 9;
export const LABEL_PAD_X = 8;
export const LABEL_PAD_Y = 3;
export const LABEL_MAX_WIDTH = 220;
export const LABEL_LINE_HEIGHT = Math.round(LABEL_FONT_SIZE * 1.4 * 10) / 10;
/** Average glyph advance at 600 weight, slightly generous so ELK never under-reserves. */
const CHAR_WIDTH = LABEL_FONT_SIZE * 0.62;

/** Measure an edge label: single line up to LABEL_MAX_WIDTH, then wrapped. */
export function measureLabel(text: string): { width: number; height: number } {
  const textWidth = Math.ceil(text.length * CHAR_WIDTH);
  const maxText = LABEL_MAX_WIDTH - 2 * LABEL_PAD_X - 2;
  const lines = Math.max(1, Math.ceil(textWidth / maxText));
  const width = Math.min(LABEL_MAX_WIDTH, textWidth + 2 * LABEL_PAD_X + 2);
  const height = Math.ceil(lines * LABEL_LINE_HEIGHT + 2 * LABEL_PAD_Y + 2);
  return { width, height };
}

/** True when the interiors overlap. Boxes that only touch do not intersect. */
export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Safety net after ELK: if any two label boxes still overlap, push the later one
 * down until clear. ELK places inline labels in their own layer, so this is
 * normally a no-op. Mutates and returns the boxes.
 */
export function separateBoxes<T extends Box>(boxes: T[], gap = 4): T[] {
  const order = boxes.map((_, i) => i).sort((i, j) => boxes[i].y - boxes[j].y || boxes[i].x - boxes[j].x);
  for (let pass = 0; pass <= boxes.length; pass++) {
    let moved = false;
    for (let a = 0; a < order.length; a++) {
      for (let b = a + 1; b < order.length; b++) {
        const first = boxes[order[a]];
        const second = boxes[order[b]];
        if (boxesIntersect(first, second)) {
          second.y = first.y + first.height + gap;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return boxes;
}

/** SVG path through orthogonal points with rounded corners. */
export function pointsToPath(points: Point[], radius = 8): string {
  if (points.length === 0) return "";
  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    if (r <= 0) {
      parts.push(`L ${cur.x} ${cur.y}`);
      continue;
    }
    const inX = cur.x - ((cur.x - prev.x) / d1) * r;
    const inY = cur.y - ((cur.y - prev.y) / d1) * r;
    const outX = cur.x + ((next.x - cur.x) / d2) * r;
    const outY = cur.y + ((next.y - cur.y) / d2) * r;
    parts.push(`L ${inX} ${inY} Q ${cur.x} ${cur.y} ${outX} ${outY}`);
  }
  const last = points[points.length - 1];
  if (points.length > 1) parts.push(`L ${last.x} ${last.y}`);
  return parts.join(" ");
}
