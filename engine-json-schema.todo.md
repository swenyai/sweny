# Task: JSON Schema for RecipeDefinition

## Goal
Generate a canonical `recipe-definition.schema.json` (JSON Schema Draft-07) for the
`RecipeDefinition` type. This is an industry-standard deliverable that enables:
- VS Code IntelliSense / autocomplete when editing `.recipe.json` files
- External tool validation (CI linting, API validation)
- Documentation and interoperability with other workflow tooling
- The future studio import/export flow (validate imported JSON before rendering)

## Repo context
- Package: `packages/engine`
- Schema output location: `packages/engine/schema/recipe-definition.schema.json`
- Build: `npm run build` inside `packages/engine`

## The TypeScript types to schema-ify

From `packages/engine/src/types.ts`:

```typescript
type WorkflowPhase = "learn" | "act" | "report";

interface RecipeDefinition {
  id: string;
  version: string;          // semver string e.g. "1.0.0"
  name: string;
  description?: string;
  initial: string;          // must be a key in states (validated at runtime, not schema)
  states: Record<string, StateDefinition>;
}

interface StateDefinition {
  phase: WorkflowPhase;
  description?: string;
  critical?: boolean;
  next?: string;            // "end" or a stateId — reserved target: "end"
  on?: Record<string, string>;  // outcome → stateId or "end"
}
```

## Write the schema by hand (do NOT use codegen tools)

Codegen tools produce bloated, hard-to-maintain schemas. Write it clearly and directly.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://sweny.ai/schemas/recipe-definition.schema.json",
  "title": "RecipeDefinition",
  "description": "A pure-data, serializable workflow recipe definition for the Sweny engine.",
  "type": "object",
  "required": ["id", "version", "name", "initial", "states"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "description": "Unique machine-readable identifier. Used for persistence and import/export."
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+",
      "description": "Semver version string, e.g. \"1.0.0\"."
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "description": "Human-readable name used in logs."
    },
    "description": {
      "type": "string",
      "description": "Optional description of what this recipe does."
    },
    "initial": {
      "type": "string",
      "minLength": 1,
      "description": "Id of the first state to execute. Must be a key in 'states'."
    },
    "states": {
      "type": "object",
      "description": "All states keyed by their unique id. All routing must be explicit.",
      "minProperties": 1,
      "additionalProperties": {
        "$ref": "#/$defs/StateDefinition"
      }
    }
  },
  "$defs": {
    "StateDefinition": {
      "type": "object",
      "required": ["phase"],
      "additionalProperties": false,
      "properties": {
        "phase": {
          "type": "string",
          "enum": ["learn", "act", "report"],
          "description": "Phase for swimlane grouping. 'learn' gathers data, 'act' does work, 'report' notifies."
        },
        "description": {
          "type": "string",
          "description": "Human-readable description shown in the visual editor."
        },
        "critical": {
          "type": "boolean",
          "description": "If true, any failure immediately aborts the entire recipe."
        },
        "next": {
          "type": "string",
          "minLength": 1,
          "description": "Explicit default successor state id for linear chains. Use 'end' to stop successfully."
        },
        "on": {
          "type": "object",
          "description": "Outcome-based transitions. Keys: outcome string, status ('success'|'skipped'|'failed'), or '*' wildcard. Values: state id or 'end'.",
          "additionalProperties": {
            "type": "string",
            "minLength": 1
          }
        }
      }
    }
  }
}
```

Save this to `packages/engine/schema/recipe-definition.schema.json`.

## Validate the schema against the real recipes

Write a Node.js test (or vitest test) that:
1. Loads `triageDefinition` and `implementDefinition` from the engine
2. Validates each against the JSON schema using `ajv` (a standard JSON Schema validator)
3. Asserts that both pass validation with zero errors

Add `ajv` as a devDependency to `packages/engine`:
```
npm install --save-dev ajv
```

Test file: `packages/engine/src/schema.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import { triageDefinition, implementDefinition } from "./index.js";
import schema from "../schema/recipe-definition.schema.json" with { type: "json" };

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

describe("recipe-definition.schema.json", () => {
  it("triageDefinition passes schema validation", () => {
    const valid = validate(triageDefinition);
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it("implementDefinition passes schema validation", () => {
    const valid = validate(implementDefinition);
    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it("rejects a definition with missing required fields", () => {
    const valid = validate({ id: "bad", version: "1.0.0" }); // missing name, initial, states
    expect(valid).toBe(false);
    expect(validate.errors).not.toBeNull();
  });

  it("rejects an invalid phase value", () => {
    const valid = validate({
      id: "bad", version: "1.0.0", name: "bad", initial: "a",
      states: { a: { phase: "deploy" } }, // invalid phase
    });
    expect(valid).toBe(false);
  });

  it("rejects empty states object", () => {
    const valid = validate({
      id: "bad", version: "1.0.0", name: "bad", initial: "a",
      states: {},
    });
    expect(valid).toBe(false);
  });

  it("rejects invalid semver version string", () => {
    const valid = validate({
      id: "bad", version: "not-semver", name: "bad", initial: "a",
      states: { a: { phase: "learn" } },
    });
    expect(valid).toBe(false);
  });
});
```

## Export the schema from the package

Add to `packages/engine/package.json` exports:
```json
"./schema": "./schema/recipe-definition.schema.json"
```

So consumers can do:
```typescript
import schema from "@sweny-ai/engine/schema" with { type: "json" };
```

## Add a tsconfig note for JSON imports

The `with { type: "json" }` syntax requires `"resolveJsonModule": true` in tsconfig.
Verify it's set (or add it) in `packages/engine/tsconfig.json`.

## Success criteria
1. `packages/engine/schema/recipe-definition.schema.json` exists and is valid JSON Schema Draft-07
2. Both `triageDefinition` and `implementDefinition` validate against the schema with zero errors
3. All schema tests pass: `npx vitest run` green in `packages/engine`
4. `npm run build` passes
5. The schema is exported via the `"./schema"` subpath

## Commit when done
```
git add packages/engine/schema/ packages/engine/src/schema.test.ts packages/engine/package.json
git commit -m "feat(engine): JSON Schema for RecipeDefinition with ajv validation tests"
```
Then rename: `mv engine-json-schema.todo.md engine-json-schema.done.md`
