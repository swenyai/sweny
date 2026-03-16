---
"@sweny-ai/studio": patch
---

EdgePanel and WorkflowMetaPanel are now read-only in simulate/live mode.
Previously, clicking an edge or de-selecting a node while a simulation was
running allowed editing transitions and workflow metadata. All inputs are now
disabled and the "Delete transition" button is hidden during execution.
