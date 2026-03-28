# Task 58: Fix Studio live mode event type inconsistency

## Goal
Fix the `node:progress` event type inconsistency in the Studio live mode docs.

## File to edit
`packages/web/src/content/docs/studio/live.md`

## Problem
The page shows `node:progress` in usage examples but the TypeScript `ExecutionEvent` type union shown on the same page doesn't include it. This is confusing for developers trying to implement live mode.

## Fix
1. Check `packages/core/src/types.ts` (or wherever `ExecutionEvent` is defined) to see if `node:progress` is a real event type.
2. If it IS a real type: add it to the TypeScript type definition shown in the docs.
3. If it is NOT a real type: remove it from the examples and replace with whatever the actual progress event is (likely `tool:call` or a different event).
4. Make sure every event type shown in examples appears in the type definition and vice versa.

## Verification
- The TypeScript type union and the usage examples reference the exact same set of event types
- Cross-reference with actual source code types
