/**
 * Test-only preload for the codex and pi fakes (`node --import <this> <fake> --fake-dir <dir> ...`).
 *
 * It holds the fake inside its k-th capture save, at the point where a signal
 * from an aborting caller does the damage: the capture file is already opened
 * for writing (created or truncated) and no byte of the new content has landed.
 * `<dir>/hold-save` names k. Once held, the fake says so on stderr (written
 * synchronously, so it reaches the adapter even with the event loop blocked)
 * and blocks until it is killed.
 */

import fs from "node:fs";
import * as path from "node:path";
import { syncBuiltinESMExports } from "node:module";

const dirIdx = process.argv.indexOf("--fake-dir");
let k = 0;
if (dirIdx !== -1) {
  try {
    k = Number(fs.readFileSync(path.join(process.argv[dirIdx + 1], "hold-save"), "utf8"));
  } catch {
    // not armed
  }
}

if (k > 0) {
  const writeFileSync = fs.writeFileSync;
  let saves = 0;
  fs.writeFileSync = function held(file, ...rest) {
    if (typeof file === "string" && /^capture-\d+\.json/.test(path.basename(file)) && ++saves === k) {
      // open(O_CREAT | O_TRUNC) has returned; the write has not started.
      fs.closeSync(fs.openSync(file, "w"));
      fs.writeSync(2, `hold-capture-save: holding pid ${process.pid}\n`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    }
    return writeFileSync.call(this, file, ...rest);
  };
  // The fakes import `node:fs` as an ES module namespace; make it see the patch.
  syncBuiltinESMExports();
}
