---
"@sweny-ai/core": minor
---

Add DagRenderer class for terminal visualization of workflow execution. Renders the DAG as an animated box diagram with per-node status icons (pending/running/completed/failed), elapsed time for running nodes, tool call counts for completed nodes, and a legend. Supports in-place terminal updates via cursor manipulation when animate=true.
