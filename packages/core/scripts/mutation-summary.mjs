// Summarize reports/mutation/mutation.json: per-file score plus surviving mutants.
// Usage: node scripts/mutation-summary.mjs [report.json]  (markdown on stdout)
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "reports/mutation/mutation.json";
const report = JSON.parse(readFileSync(file, "utf8"));

const rows = [];
const survivors = [];
const total = { detected: 0, undetected: 0 };
for (const [path, data] of Object.entries(report.files)) {
  const c = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
  for (const m of data.mutants) {
    if (m.status in c) c[m.status]++;
    if (m.status === "Survived" || m.status === "NoCoverage") {
      survivors.push({
        path,
        line: m.location.start.line,
        mutator: m.mutatorName,
        replacement: m.replacement,
        status: m.status,
      });
    }
  }
  const detected = c.Killed + c.Timeout;
  const undetected = c.Survived + c.NoCoverage;
  total.detected += detected;
  total.undetected += undetected;
  rows.push({ path, ...c, score: detected + undetected ? (100 * detected) / (detected + undetected) : 100 });
}

const pct = (n) => n.toFixed(2);
console.log("| file | killed | timeout | survived | no coverage | score |");
console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const r of rows) {
  console.log(`| ${r.path} | ${r.Killed} | ${r.Timeout} | ${r.Survived} | ${r.NoCoverage} | ${pct(r.score)} |`);
}
const all = total.detected + total.undetected;
console.log(`| **total** | | | | | **${pct(all ? (100 * total.detected) / all : 100)}** |`);
console.log("\nSurvivors (file:line mutator replacement):\n");
for (const s of survivors) {
  const repl = String(s.replacement).replace(/\s+/g, " ").slice(0, 100);
  console.log(`- ${s.path}:${s.line} ${s.mutator} [${s.status}] \`${repl}\``);
}
