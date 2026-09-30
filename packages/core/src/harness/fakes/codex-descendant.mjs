// Local-only lifecycle fixture: never starts Codex or contacts a model.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--version")) {
  console.log("codex-cli 0.159.2");
} else if (process.argv[2] === "--descendant") {
  process.on("SIGTERM", () => {});
  writeFileSync(process.argv[3], JSON.stringify({ parent: Number(process.argv[4]), descendant: process.pid }));
  process.send?.("ready");
  setInterval(() => {}, 1000);
} else {
  const descendant = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), "--descendant", process.argv[2], String(process.pid)],
    {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    },
  );
  descendant.once("message", () => {
    if (process.argv[3] === "exit") process.exit(0);
  });
  process.stdin.resume();
  process.on("SIGTERM", () => process.exit(0));
}
