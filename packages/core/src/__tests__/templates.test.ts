import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { WORKFLOW_TEMPLATES } from "../cli/templates.js";
import { parseWorkflow, validateWorkflow } from "../schema.js";
import { builtinSkills } from "../skills/index.js";
import { WORKFLOW_TYPES } from "../types.js";

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

      it("declares a workflow_type from the published enum", () => {
        const parsed = parse(template.yaml);
        const workflow = parseWorkflow(parsed);
        expect(workflow.workflow_type, `template "${template.id}" must declare workflow_type`).toBeDefined();
        expect(WORKFLOW_TYPES).toContain(workflow.workflow_type);
      });

      it("uses only known builtin skills", () => {
        const parsed = parse(template.yaml);
        const workflow = parseWorkflow(parsed);
        const knownSkillIds = new Set(builtinSkills.map((s) => s.id));
        for (const node of Object.values(workflow.nodes)) {
          for (const skill of node.skills) {
            expect(knownSkillIds.has(skill), `template "${template.id}" references unknown skill "${skill}"`).toBe(
              true,
            );
          }
        }
      });
    });
  }

  // The flywheel this monorepo is being built around depends on the OSS
  // authoring surface making every non-generic workflow type trivial to
  // scaffold. Pin the four templates that exist specifically to cover
  // content_generation, monitor, data_sync, and the Supabase seed-content
  // bundled example so a future edit can't quietly drop one back to
  // "generic" (or omit the field, which defaults to generic).
  describe("non-generic starter templates declare their type", () => {
    const nonGenericIds = ["content-pipeline", "url-monitor", "data-sync", "seed-content"];

    it("WORKFLOW_TEMPLATES includes all of them", () => {
      const ids = new Set(WORKFLOW_TEMPLATES.map((t) => t.id));
      for (const id of nonGenericIds) {
        expect(ids.has(id), `expected a "${id}" template`).toBe(true);
      }
    });

    for (const id of nonGenericIds) {
      it(`${id} carries a non-generic workflow_type`, () => {
        const template = WORKFLOW_TEMPLATES.find((t) => t.id === id);
        expect(template).toBeDefined();
        const parsed = parse(template!.yaml);
        const workflow = parseWorkflow(parsed);
        expect(workflow.workflow_type).toBeDefined();
        expect(workflow.workflow_type).not.toBe("generic");
      });
    }
  });
});
