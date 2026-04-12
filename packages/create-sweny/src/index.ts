#!/usr/bin/env node
import { runNew } from "@sweny-ai/core/new";

runNew().catch((err) => {
  console.error(err);
  process.exit(1);
});
