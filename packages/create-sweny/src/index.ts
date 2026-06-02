#!/usr/bin/env node
import { runNew } from "@sweny-ai/core/new";

// Mirror `sweny new [id]` (packages/core/src/cli/main.ts): a positional
// workflow id is threaded through as `marketplaceId` so it installs that
// workflow non-interactively. With no arg, runNew opens the interactive picker.
const id = process.argv[2];
runNew(id ? { marketplaceId: id } : undefined).catch((err) => {
  console.error(err);
  process.exit(1);
});
