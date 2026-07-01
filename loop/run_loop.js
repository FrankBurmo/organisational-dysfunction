#!/usr/bin/env node
/**
 * run_loop.js — the autoresearch-style improvement loop for the org-dysfunction skill.
 *
 * Modelled on Karpathy's autoresearch shape: a fixed evaluation (the "metric"), an agent
 * that proposes a change, keep-if-better / revert-if-worse, logged each iteration.
 *
 * Two modes:
 *
 *   --mode quant   Optimise TRIGGERING + ROUTING. Each iteration, an agent ("the researcher")
 *                  reads the failing scenarios and proposes a new description and/or router
 *                  index tweaks. We re-score; keep the change only if the composite metric
 *                  improves, otherwise revert. The mutation surface is deliberately limited to
 *                  the description and the router (SKILL.md) — the levers the metric measures —
 *                  so the loop is safe to run unattended. Best version wins.
 *
 *   --mode qual    Run the LLM-judge over the actual answers, then synthesise concrete
 *                  improvement suggestions for the lowest-scoring references. Does NOT auto-edit
 *                  reference prose — advice quality needs a human in the loop — it produces a
 *                  review file for you to act on.
 *
 * Usage:
 *   node run_loop.js --mode quant --iterations 5 [--model gpt-5]
 *   node run_loop.js --mode qual  [--limit 8]
 *
 * Requires the local `copilot` CLI (see harness.js). Note: this calls `copilot -p` many times
 * and consumes tokens/billing — start with a small --iterations / --limit.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const H = require("./harness.js");

const HISTORY_DIR = path.join(H.HARNESS_DIR, "history");
const RESEARCH_MD = path.join(H.HARNESS_DIR, "research.md");

const argv = process.argv;
function arg(flag, def) {
  return argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : def;
}

function ensureHistoryDir() {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function logHistory(record) {
  ensureHistoryDir();
  fs.appendFileSync(path.join(HISTORY_DIR, "history.jsonl"), JSON.stringify(record) + "\n", "utf-8");
}

function saveReport(name, report) {
  ensureHistoryDir();
  fs.writeFileSync(path.join(HISTORY_DIR, name), JSON.stringify(report, null, 2), "utf-8");
}

// --- quant loop --------------------------------------------------------------

/** Ask the researcher agent for a new description + router replacements to fix failures. */
function proposeChange(report, model) {
  const fails = report.rows.filter((r) => !(r.trigger_ok && r.routing_ok));
  const failLines = fails.map(
    (r) =>
      `- [${r.id}] positive=${r.positive} | triggered=${r.triggered} ` +
      `(want ${r.positive}) | predicted_refs=${JSON.stringify(r.predicted_refs)} ` +
      `| expected_refs=${JSON.stringify(r.expected_refs)}`
  );
  const research = fs.existsSync(RESEARCH_MD) ? fs.readFileSync(RESEARCH_MD, "utf-8") : "";
  const prompt = `${research}

## Current scores
trigger_accuracy=${report.trigger_accuracy}  routing_accuracy=${report.routing_accuracy}  composite=${report.composite}

## Failing scenarios (these are what to fix)
${failLines.length ? failLines.join("\n") : "(none — propose a small robustness improvement)"}

## Current description
${H.getDescription()}

## Current SKILL.md (router)
${H.readSkillMd()}

## Your task
Propose ONE focused improvement. You may rewrite the \`description\` and/or make a few exact-string
replacements inside SKILL.md's index to fix the routing failures above (e.g. sharpen a recognition
cue so the right reference is chosen, or disambiguate two entries the model is confusing). Do NOT
rewrite reference files. Keep the description tight (2 sentences, umbrella terms + the "structure
not people" discriminating hook). Every \`find\` string must appear VERBATIM in the current SKILL.md.

Reply with ONLY this JSON:
{
  "description": "<new full description, or the current one unchanged>",
  "router_replacements": [{"find": "<exact substring in SKILL.md>", "replace": "<new text>"}],
  "rationale": "<one sentence>"
}`;
  const reply = H.callCopilot(prompt, model, 240);
  const data = H.extractJson(reply);
  return data && typeof data === "object" && !Array.isArray(data) ? data : null;
}

/** Apply description + router replacements to SKILL.md. Returns false if any find is missing. */
function applyChange(change) {
  let text = H.readSkillMd();
  const newDesc = (change.description || "").trim();
  if (newDesc) {
    text = text.replace(/^description:.*$/m, () => `description: ${newDesc}`);
  }
  for (const rep of change.router_replacements || []) {
    const find = rep.find || "";
    const replace = rep.replace || "";
    if (find && text.includes(find)) {
      text = text.replace(find, () => replace); // first occurrence, literal replacement
    } else if (find) {
      return false; // stale find — reject whole change to stay safe
    }
  }
  fs.writeFileSync(H.SKILL_MD, text, "utf-8");
  return true;
}

function quantLoop(model, iterations) {
  const original = H.readSkillMd();
  console.log(`\n=== Baseline eval (model=${model}) ===`);
  let best = H.runQuant(model);
  saveReport("iteration-0.json", best);
  logHistory({
    iter: 0,
    composite: best.composite,
    trigger: best.trigger_accuracy,
    routing: best.routing_accuracy,
    kept: true,
    note: "baseline",
  });
  console.log(
    `baseline composite=${best.composite} (trigger=${best.trigger_accuracy} routing=${best.routing_accuracy})`
  );
  let bestText = original;

  for (let i = 1; i <= iterations; i++) {
    console.log(`\n=== Iteration ${i}/${iterations} ===`);
    const change = proposeChange(best, model);
    if (!change) {
      console.log("  researcher returned no parseable change; stopping.");
      break;
    }
    console.log(`  proposal: ${change.rationale || "(no rationale)"}`);
    if (!applyChange(change)) {
      console.log("  proposal had a stale find-string; skipping (reverting).");
      fs.writeFileSync(H.SKILL_MD, bestText, "utf-8");
      logHistory({ iter: i, kept: false, note: "stale-find rejected" });
      continue;
    }
    const trial = H.runQuant(model);
    const improved = trial.composite > best.composite;
    console.log(
      `  trial composite=${trial.composite} vs best=${best.composite} -> ${improved ? "KEEP" : "REVERT"}`
    );
    if (improved) {
      best = trial;
      bestText = H.readSkillMd();
      saveReport(`iteration-${i}.json`, trial);
    } else {
      fs.writeFileSync(H.SKILL_MD, bestText, "utf-8"); // revert
    }
    logHistory({
      iter: i,
      composite: trial.composite,
      trigger: trial.trigger_accuracy,
      routing: trial.routing_accuracy,
      kept: improved,
      rationale: change.rationale || "",
    });
  }

  fs.writeFileSync(H.SKILL_MD, bestText, "utf-8"); // ensure best is on disk
  console.log(`\n=== Done. Best composite=${best.composite}. SKILL.md left at best version. ===`);
  console.log(`History: ${path.join(HISTORY_DIR, "history.jsonl")}`);
}

// --- qual report -------------------------------------------------------------

function qualReport(model, limit) {
  console.log(`\n=== Qualitative judge pass (model=${model}) ===`);
  const report = H.runQual(model, true, limit ? parseInt(limit, 10) : null);
  saveReport("qual-report.json", report);
  const weak = [...report.rows].sort((a, b) => a.avg - b.avg).slice(0, 5);
  const weakBlock = weak
    .map(
      (r) =>
        `### ${r.id} (avg ${r.avg}) refs=${JSON.stringify(r.refs_used)}\nScores: ${JSON.stringify(r.scores)}\nAnswer:\n${r.answer.slice(0, 1500)}`
    )
    .join("\n\n");
  const prompt = `You are improving an org-design skill's reference files. Below are its weakest-scoring
answers from a rubric judge (structural diagnosis, OST fidelity, altitude-awareness, actionability,
rings-true). For EACH, name the reference file(s) likely responsible and give 1-3 concrete edits that
would raise the score — sharper symptoms, a crisper DP1/DP2 diagnosis, more honest local moves, etc.
Be specific and brief.

${weakBlock}

Reply as markdown with one section per scenario.`;
  const suggestions = H.callCopilot(prompt, model, 240);
  ensureHistoryDir();
  const out = path.join(HISTORY_DIR, "qual-suggestions.md");
  fs.writeFileSync(
    out,
    `# Qual improvement suggestions\n\nOverall rubric score: ${report.overall}\n\n${suggestions}\n`,
    "utf-8"
  );
  console.log(`overall rubric score = ${report.overall}`);
  console.log(`Suggestions written to ${out} (review and apply by hand).`);
}

if (require.main === module) {
  const mode = arg("--mode", "quant");
  const model = arg("--model", H.DEFAULT_MODEL);
  if (mode === "quant") {
    quantLoop(model, parseInt(arg("--iterations", "5"), 10));
  } else {
    qualReport(model, arg("--limit"));
  }
}
