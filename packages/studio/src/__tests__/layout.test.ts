import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { workflowZ } from "@sweny-ai/core/schema";
import { triageWorkflow, implementWorkflow } from "@sweny-ai/core/workflows";
import type { Workflow } from "@sweny-ai/core";
import { PACK_TEMPLATES } from "../../../core/src/cli/packs.js";
import { layoutWorkflow } from "../layout/elk.js";
import { boxesIntersect, measureLabel, separateBoxes, type Box } from "../layout/geometry.js";

const bundled: Array<[string, Workflow]> = [
  ["triage", triageWorkflow],
  ["implement", implementWorkflow],
  ...PACK_TEMPLATES.map((t): [string, Workflow] => [`pack:${t.id}`, workflowZ.parse(parseYaml(t.yaml)) as Workflow]),
];

function overlaps(boxes: Array<{ id: string; box: Box }>): string[] {
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesIntersect(boxes[i].box, boxes[j].box)) hits.push(`${boxes[i].id} x ${boxes[j].id}`);
    }
  }
  return hits;
}

describe("studio ELK layout", () => {
  it("covers triage, implement and every bundled pack", () => {
    expect(PACK_TEMPLATES.length).toBeGreaterThan(0);
    expect(bundled.length).toBe(2 + PACK_TEMPLATES.length);
  });

  describe.each(bundled)("%s", (_name, workflow) => {
    it("places every edge label and no two label boxes intersect", async () => {
      const { edges } = await layoutWorkflow(workflow);
      const expected = (workflow.edges ?? []).filter((e) => e.when !== undefined).length;
      const labelled = edges.flatMap((e) => (e.data?.labelBox ? [{ id: e.id, box: e.data.labelBox }] : []));
      expect(labelled.length).toBe(expected);
      for (const { box } of labelled) {
        expect(Number.isFinite(box.x) && Number.isFinite(box.y)).toBe(true);
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
      }
      expect(overlaps(labelled)).toEqual([]);
    });

    it("carries an ELK route for every edge", async () => {
      const { edges } = await layoutWorkflow(workflow);
      for (const e of edges) {
        expect(e.data?.route?.length ?? 0).toBeGreaterThanOrEqual(2);
      }
    });

    it("keeps label boxes off node boxes", async () => {
      const { nodes, edges } = await layoutWorkflow(workflow);
      const nodeBoxes = nodes.map((n) => ({
        id: n.id,
        box: { x: n.position.x, y: n.position.y, width: 280, height: 84 },
      }));
      const hits: string[] = [];
      for (const e of edges) {
        const box = e.data?.labelBox;
        if (!box) continue;
        for (const n of nodeBoxes) if (boxesIntersect(box, n.box)) hits.push(`${e.id} x ${n.id}`);
      }
      expect(hits).toEqual([]);
    });
  });

  it("proves the gate has teeth: converging labels measured in a column collide until separated", () => {
    const { width, height } = measureLabel("severity is high or critical");
    const stacked: Box[] = [0, 1, 2].map(() => ({ x: 100, y: 100, width, height }));
    expect(overlaps(stacked.map((box, i) => ({ id: String(i), box })))).not.toEqual([]);
    separateBoxes(stacked);
    expect(overlaps(stacked.map((box, i) => ({ id: String(i), box })))).toEqual([]);
  });
});
