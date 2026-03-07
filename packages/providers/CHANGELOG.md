# @sweny-ai/providers

## 0.2.2

### Patch Changes

- d552edb: Add `description` field to the `Issue` interface. This field was used internally by the engine but missing from the type definition, causing TypeScript errors when accessing `issue.description`.
