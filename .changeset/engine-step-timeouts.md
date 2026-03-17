---
"@sweny-ai/engine": minor
---

Steps now support a `timeout` field (milliseconds). When set, the step is forcibly failed if it does not complete within the allotted time — preventing hung workflows. Works in both the Node.js runner and the browser-safe runner.
