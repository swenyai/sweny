import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { WORKFLOW_TEMPLATES } from "../cli/templates.js";
import { parseWorkflow, validateWorkflow } from "../schema.js";

describe("WORKFLOW_TEMPLATES", () => {
  it("has at least 4 templates", () => {
    expect(WORKFLOW_TEMPLATES.length).toBeGreaterThanOrEqual(4);
  });

  it("each template has unique id, name, and description", () => {
    const ids = new Set<string>();
    for (const t of WORKFLOW_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
    }
  });

  for (const template of WORKFLOW_TEMPLATES) {
    describe(`template: ${template.id}`, () => {
      it("parses as valid YAML", () => {
        const parsed = parse(template.yaml);
        expect(parsed).toBeDefined();
        expect(parsed.id).toBe(template.id);
      });

      it("passes parseWorkflow validation", () => {
        const parsed = parse(template.yaml);
        const workflow = parseWorkflow(parsed);
        expect(workflow.id).toBe(template.id);
        expect(Object.keys(workflow.nodes).length).toBeGreaterThan(0);
      });

      it("passes validateWorkflow with no errors", () => {
        const parsed = parse(template.yaml);
        const workflow = parseWorkflow(parsed);
        const errors = validateWorkflow(workflow);
        expect(errors).toEqual([]);
      });

      it("uses only the github skill", () => {
        const parsed = parse(template.yaml);
        const workflow = parseWorkflow(parsed);
        for (const node of Object.values(workflow.nodes)) {
          for (const skill of node.skills) {
            expect(skill).toBe("github");
          }
        }
      });
    });
  }
});
