---
"@sweny-ai/studio": patch
---

Fix infinite render loop in RecipeViewer when no executionState is passed. The `executionState = {}` default was creating a new object reference on every render, causing the executionState effect to fire continuously and trigger maximum update depth exceeded.
