import type { ExecutionEvent, Observer } from "../types.js";
import { redact } from "../journal.js";

/**
 * Observer that writes NDJSON ExecutionEvents to stdout (`--stream`).
 * Studio and other consumers parse these line-by-line.
 *
 * Every event goes through the run journal's redactor first (secret values,
 * secret-named fields, known token shapes): node data, summaries, errors,
 * tool inputs and outputs. Keys and structure are untouched.
 */
export function createStreamObserver(
  secrets: string[] = [],
  write: (line: string) => void = (line) => void process.stdout.write(line),
): Observer {
  return (event: ExecutionEvent) => {
    write(JSON.stringify(redact(event, secrets).value) + "\n");
  };
}
