---
"@sweny-ai/core": patch
---

Fix route evaluator silently treating declared-but-missing output fields as
matchable. When a source node declared `output.properties.foo` but the agent
omitted `foo` from its emitted JSON, the route eval view dropped the key
entirely. A natural-language edge condition like `foo is 0 or foo is undefined`
then ghost-matched on the structurally-absent field, taking the wrong branch.

The view is now contract-shaped: every declared property appears in the route
eval context, with explicit `null` when the agent did not emit it. A new
`node:warning` execution event surfaces the missing-field set so observers and
log streams see the contract violation. The evaluate prompt now instructs the
model to treat `null` as "declared but unknown", not as any specific value.

Additionally, when the source schema declares a property in its `required`
array and the agent omits it, the node is now failed post-run with a clear
error, so routing follows the failure path instead of guessing against a
half-built data view.
