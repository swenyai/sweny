import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Position } from "@xyflow/react";
import { EdgeLabel, resolveEdgeGeometry, type TransitionEdgeData } from "../components/TransitionEdge.js";
import { BrandLockup, EmptyCanvasWatermark } from "../components/BrandMark.js";
import { pointsToPath } from "../layout/geometry.js";
import { THEME_CSS, darkTokens, lightTokens, tok } from "../theme.js";

describe("EdgeLabel", () => {
  const box = { x: 40, y: 60, width: 120, height: 20 };

  it("renders the label pill at the ELK box with the blue-50 brand background", () => {
    const html = renderToStaticMarkup(<EdgeLabel text="severity is high" box={box} isError={false} />);
    expect(html).toContain("severity is high");
    expect(html).toContain("translate(40px,60px)");
    expect(html).toContain("width:120px");
    expect(html).toContain("height:20px");
    expect(html).toContain("var(--sw-label-bg, #eff6ff)");
    expect(html).not.toContain("#eef0ff");
  });

  it("uses the error palette for error edges", () => {
    const html = renderToStaticMarkup(<EdgeLabel text={"⚠ missing"} box={box} isError />);
    expect(html).toContain("#fef2f2");
    expect(html).toContain("#fecaca");
  });
});

describe("resolveEdgeGeometry", () => {
  const data: TransitionEdgeData = {
    edgeIndex: 0,
    isConditional: true,
    route: [
      { x: 140, y: 84 },
      { x: 140, y: 120 },
      { x: 300, y: 120 },
      { x: 300, y: 200 },
    ],
    labelBox: { x: 180, y: 110, width: 80, height: 20 },
    layoutAnchors: { source: { x: 140, y: 84 }, target: { x: 300, y: 200 } },
  };
  const base = {
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    displayLabel: "when it is high",
  };

  it("draws the ELK route and places the label at the ELK box", () => {
    const g = resolveEdgeGeometry({ ...base, sourceX: 140, sourceY: 84, targetX: 300, targetY: 200, data });
    expect(g.path.startsWith("M 140 84")).toBe(true);
    expect(g.path).toContain("Q 140 120");
    expect(g.label).toEqual(data.labelBox);
  });

  it("falls back to a smooth-step path once a node has been dragged away", () => {
    const g = resolveEdgeGeometry({ ...base, sourceX: 500, sourceY: 400, targetX: 300, targetY: 200, data });
    expect(g.path.startsWith("M")).toBe(true);
    expect(g.path).not.toContain("Q 140 120");
    expect(g.label).not.toBeNull();
    expect(g.label).not.toEqual(data.labelBox);
  });

  it("has no label box for an unlabelled edge", () => {
    const g = resolveEdgeGeometry({
      ...base,
      displayLabel: undefined,
      sourceX: 140,
      sourceY: 84,
      targetX: 300,
      targetY: 200,
      data,
    });
    expect(g.label).toBeNull();
  });
});

describe("pointsToPath", () => {
  it("rounds orthogonal corners", () => {
    expect(
      pointsToPath(
        [
          { x: 0, y: 0 },
          { x: 0, y: 50 },
          { x: 50, y: 50 },
        ],
        8,
      ),
    ).toBe("M 0 0 L 0 42 Q 0 50 8 50 L 50 50");
  });
});

describe("brand chrome", () => {
  it("renders the SWEny lockup for the toolbar", () => {
    const html = renderToStaticMarkup(<BrandLockup />);
    expect(html).toContain('aria-label="SWEny"');
    expect(html).toContain("SWE");
    expect(html).toContain("#3b82f6");
    expect(html).toContain('viewBox="0 0 420 52"');
  });

  it("renders the empty-canvas watermark with the hint", () => {
    const html = renderToStaticMarkup(<EmptyCanvasWatermark />);
    expect(html).toContain("No nodes yet");
    expect(html).toContain("Use New or Import");
    expect(html).toContain("<svg");
  });
});

describe("theme tokens", () => {
  it("mirrors the brand guide and switches on prefers-color-scheme", () => {
    expect(darkTokens.primary).toBe("#3b82f6");
    expect(darkTokens.canvas).toBeDefined();
    expect(lightTokens.primary).toBe("#2563eb");
    expect(lightTokens.canvas).toBe("#f8fafc");
    expect(THEME_CSS).toContain("--sw-primary:#3b82f6;");
    expect(THEME_CSS).toContain("@media (prefers-color-scheme: light)");
    expect(THEME_CSS).toContain("--sw-label-bg:#eff6ff;");
    expect(tok("labelBg")).toBe("var(--sw-label-bg, #eff6ff)");
  });

  it("uses blue for success", () => {
    expect(darkTokens.success).toBe("#60a5fa");
    expect(lightTokens.success).toBe("#2563eb");
  });
});
