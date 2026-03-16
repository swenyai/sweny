---
"@sweny-ai/studio": minor
---

StepPanel now shows a "Step type" dropdown with all built-in step types.
Selecting a type auto-sets the step's phase to the type's canonical phase and
shows the type's description as a hint below the dropdown. Provider role badges
(e.g., `observability`, `sourceControl`) appear for types that declare them.
Selecting "— none (custom) —" clears the `type` field.
