#!/usr/bin/env node
/** Run the quant eval N times to measure score stability (LLM nondeterminism). */
"use strict";

const fs = require("fs");
const path = require("path");
const H = require("./harness.js");

const argv = process.argv;
const arg = (flag, def) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : def);

const N = parseInt(arg("--runs", "3"), 10);
const model = arg("--model", H.DEFAULT_MODEL);

const mean = (vals) => vals.reduce((a, b) => a + b, 0) / vals.length;
function pstdev(vals) {
  if (vals.length <= 1) return 0.0;
  const m = mean(vals);
  return Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length);
}

const runs = [];
for (let i = 0; i < N; i++) {
  console.log(`\n--- run ${i + 1}/${N} ---`);
  const r = H.runQuant(model, false);
  runs.push(r);
  console.log(
    `run ${i + 1}: composite=${r.composite} trigger=${r.trigger_accuracy} routing=${r.routing_accuracy}`
  );
}

console.log(`\n=== aggregate over ${N} runs ===`);
for (const key of ["composite", "trigger_accuracy", "routing_accuracy"]) {
  const vals = runs.map((r) => r[key]);
  const stdev = vals.length > 1 ? pstdev(vals) : 0.0;
  console.log(
    `${key.padEnd(18)} mean=${mean(vals).toFixed(4)}  stdev=${stdev.toFixed(4)}  ` +
      `min=${Math.min(...vals).toFixed(4)}  max=${Math.max(...vals).toFixed(4)}`
  );
}

// which scenarios ever failed, and how often
const fails = {};
for (const r of runs) {
  for (const row of r.rows) {
    if (!(row.trigger_ok && row.routing_ok)) {
      fails[row.id] = (fails[row.id] || 0) + 1;
    }
  }
}
const failsStr = Object.keys(fails).length ? JSON.stringify(fails) : "none — perfect every run";
console.log(`\nflaky/failed scenarios (id: times-failed of ${N}): ${failsStr}`);

const historyDir = path.join(H.HARNESS_DIR, "history");
fs.mkdirSync(historyDir, { recursive: true });
const out = path.join(historyDir, "variance.json");
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      runs: N,
      model,
      per_run: runs.map((r) => ({
        composite: r.composite,
        trigger_accuracy: r.trigger_accuracy,
        routing_accuracy: r.routing_accuracy,
      })),
      flaky: fails,
    },
    null,
    2
  ),
  "utf-8"
);
console.log(`\nsaved ${out}`);
