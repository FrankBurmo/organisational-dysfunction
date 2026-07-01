#!/usr/bin/env node
/**
 * harness.js — evaluation core for the organisational-dysfunction skill loop.
 *
 * Dependency-free (Node.js built-ins only). Drives the local `copilot` CLI to measure how
 * well the skill performs, on two axes:
 *
 *   ROUTING    — given the router (SKILL.md) and a user scenario, does the model open
 *                the right reference file(s)?
 *   TRIGGERING — given only the skill's description and a user scenario, would the
 *                skill fire at all? (positives should fire, near-miss negatives should not)
 *
 * And, for qualitative mode, an LLM-judge that scores the actual answer the skill
 * would produce against a rubric (faithful to OST, structural diagnosis, altitude-aware,
 * actionable).
 *
 * This file is a library; run it via run_loop.js, or directly:
 *     node harness.js --mode quant
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// --- paths -------------------------------------------------------------------

const HARNESS_DIR = __dirname;
const PLUGIN_ROOT = path.dirname(HARNESS_DIR);
const SKILL_DIR = path.join(PLUGIN_ROOT, ".github", "skills", "organisational-dysfunction");
const SKILL_MD = path.join(SKILL_DIR, "SKILL.md");
const REFS_DIR = path.join(SKILL_DIR, "references");
const SCENARIOS = path.join(PLUGIN_ROOT, "evals", "scenarios.json");

const DEFAULT_MODEL = "gpt-5";

// --- copilot CLI -------------------------------------------------------------

/**
 * Run `copilot -p` headlessly, return stdout text.
 *
 * Uses --allow-all-tools so the CLI runs non-interactively without approval prompts.
 * @param {string} prompt
 * @param {string} model
 * @param {number} timeout seconds
 * @returns {string}
 */
function callCopilot(prompt, model = DEFAULT_MODEL, timeout = 180) {
  const res = spawnSync(
    "copilot",
    ["-p", prompt, "--allow-all-tools", "--model", model],
    { encoding: "utf-8", timeout: timeout * 1000, maxBuffer: 64 * 1024 * 1024 }
  );
  if (res.error) {
    if (res.error.code === "ENOENT") {
      console.error("ERROR: `copilot` CLI not found on PATH. Install it or adjust callCopilot().");
      process.exit(1);
    }
    return ""; // timeout or other spawn failure
  }
  if (res.status !== 0 && res.stderr) {
    process.stderr.write(`[copilot error] ${String(res.stderr).slice(0, 400)}\n`);
  }
  return (res.stdout || "").trim();
}

/** Pull the first JSON value (array or object) out of a noisy model reply. */
function extractJson(text) {
  const m = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

// --- skill introspection -----------------------------------------------------

function readSkillMd() {
  return fs.readFileSync(SKILL_MD, "utf-8");
}

function getDescription(skillMd) {
  const s = skillMd || readSkillMd();
  const m = s.match(/^description:\s*(.+?)\s*$/m);
  return m ? m[1] : "";
}

function validSlugs() {
  return new Set(
    fs.readdirSync(REFS_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.basename(f, ".md"))
  );
}

function loadScenarios() {
  return JSON.parse(fs.readFileSync(SCENARIOS, "utf-8")).scenarios;
}

// --- the three probes --------------------------------------------------------

/** Return the list of reference slugs the model would open for this scenario. */
function probeRouting(scenario, model) {
  const prompt = `You are deciding which reference file(s) of a skill to open.

Below is the skill's router file (SKILL.md). A user has said:

"""${scenario.prompt}"""

Based ONLY on the router's index, which reference file(s) would you open to answer
well? Reply with a JSON array of the file identifiers (the \`NN-slug\` part, WITHOUT
the .md extension). If none of the dysfunctions genuinely fit, reply with [].
Reply with ONLY the JSON array, nothing else.

--- SKILL.md ---
${readSkillMd()}
`;
  const reply = callCopilot(prompt, model);
  const data = extractJson(reply);
  if (!Array.isArray(data)) return [];
  return data.map((x) => String(x).replace(/\.md/g, "").trim());
}

/** Return whether the model thinks the skill should fire, from the description alone. */
function probeTrigger(scenario, model) {
  const desc = getDescription();
  const prompt = `An AI coding assistant has access to a skill with this description:

"""${desc}"""

The user says:

"""${scenario.prompt}"""

Should the assistant consult this skill to answer? Consider that skills should fire when they
genuinely add value and NOT for adjacent requests that merely share vocabulary.
Reply with ONLY one word: YES or NO.`;
  const reply = callCopilot(prompt, model).toUpperCase();
  return reply.startsWith("Y") || reply.slice(0, 10).includes("YES");
}

const JUDGE_RUBRIC = [
  ["structural_diagnosis", "Diagnoses the problem as structural (DP1/DP2, system design) rather than blaming individuals, mindset, or 'communication'."],
  ["faithful_to_ost", "Uses the open sociotechnical systems lens accurately and specifically, not generic management advice."],
  ["altitude_aware", "Distinguishes the real structural fix from realistic local moves the person can make from where they sit."],
  ["actionable", "Gives concrete, usable next steps rather than vague platitudes."],
  ["rings_true", "Names the dysfunction in a way that would feel recognisable to someone living it."],
];

/** Produce the answer the skill would give: router + the routed reference files + the prompt. */
function probeAnswer(scenario, model, refs) {
  const refTexts = [];
  for (const slug of refs) {
    const f = path.join(REFS_DIR, `${slug}.md`);
    if (fs.existsSync(f)) refTexts.push(fs.readFileSync(f, "utf-8"));
  }
  const bundle = refTexts.length
    ? refTexts.join("\n\n---\n\n")
    : "(no specific reference matched; reason from the core lens)";
  const prompt = `You are answering a user using the 'organisational-dysfunction' skill.
Use the router guidance and the reference material below. Be sharp and concrete.

User:
"""${scenario.prompt}"""

--- SKILL.md (router + lens) ---
${readSkillMd()}

--- Routed reference material ---
${bundle}
`;
  return callCopilot(prompt, model);
}

function probeJudge(scenario, answer, model) {
  const rubricLines = JUDGE_RUBRIC.map(([k, d]) => `- ${k}: ${d}`).join("\n");
  const prompt = `Score an answer that an org-design assistant gave to a user.

User asked:
"""${scenario.prompt}"""

Answer to score:
"""${answer}"""

Score each criterion from 0.0 to 1.0:
${rubricLines}

Reply with ONLY a JSON object: {"<criterion>": <score>, ...} using the exact keys above.`;
  const reply = callCopilot(prompt, model);
  const data = extractJson(reply);
  const keys = JUDGE_RUBRIC.map(([k]) => k);
  const out = {};
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    for (const k of keys) out[k] = 0.0;
    return out;
  }
  for (const k of keys) {
    const v = parseFloat(data[k]);
    out[k] = Number.isNaN(v) ? 0.0 : v;
  }
  return out;
}

// --- scoring -----------------------------------------------------------------

const round = (x, n) => Number(x.toFixed(n));
const sum = (arr) => arr.reduce((a, b) => a + b, 0);

/** Routing + triggering accuracy across the scenario set. */
function runQuant(model, verbose = true) {
  const scenarios = loadScenarios();
  const rows = [];
  for (const s of scenarios) {
    const positive = s.should_trigger;
    const triggered = probeTrigger(s, model);
    const triggerOk = triggered === positive;

    let routingOk = null;
    let predicted = [];
    if (positive) {
      predicted = probeRouting(s, model);
      const expected = new Set(s.expected_refs);
      routingOk = predicted.some((p) => expected.has(p)); // lenient: any acceptable ref hit
    } else {
      // negatives: routing should be empty / not over-eager
      predicted = probeRouting(s, model);
      routingOk = predicted.length === 0;
    }

    const row = {
      id: s.id,
      positive,
      triggered,
      trigger_ok: triggerOk,
      expected_refs: s.expected_refs || [],
      predicted_refs: predicted,
      routing_ok: routingOk,
    };
    rows.push(row);
    if (verbose) {
      const mark = triggerOk && routingOk ? "\u2713" : "\u2717";
      const route = predicted.length ? JSON.stringify(predicted) : "[]";
      console.log(
        `  ${mark} ${s.id.padEnd(32)} trig=${triggered ? "Y" : "N"}(${triggerOk ? "ok" : "X"}) route=${route}`
      );
    }
  }

  const n = rows.length;
  const trigAcc = sum(rows.map((r) => (r.trigger_ok ? 1 : 0))) / n;
  const routeAcc = sum(rows.map((r) => (r.routing_ok ? 1 : 0))) / n;
  const composite = 0.5 * trigAcc + 0.5 * routeAcc;
  return {
    mode: "quant",
    model,
    n,
    trigger_accuracy: round(trigAcc, 4),
    routing_accuracy: round(routeAcc, 4),
    composite: round(composite, 4),
    rows,
  };
}

/** LLM-judge rubric scores on the actual answers for positive scenarios. */
function runQual(model, verbose = true, limit = null) {
  let scenarios = loadScenarios().filter((s) => s.should_trigger);
  if (limit) scenarios = scenarios.slice(0, limit);
  const rows = [];
  for (const s of scenarios) {
    const refs = (s.expected_refs && s.expected_refs.length) ? s.expected_refs : probeRouting(s, model);
    const answer = probeAnswer(s, model, refs);
    const scores = probeJudge(s, answer, model);
    const vals = Object.values(scores);
    const avg = vals.length ? sum(vals) / vals.length : 0.0;
    rows.push({ id: s.id, refs_used: refs, scores, avg: round(avg, 3), answer });
    if (verbose) {
      const parts = Object.entries(scores).map(([k, v]) => `${k.slice(0, 6)}=${v.toFixed(1)}`).join(" ");
      console.log(`  ${s.id.padEnd(32)} avg=${avg.toFixed(2)}  ${parts}`);
    }
  }
  const overall = rows.length ? sum(rows.map((r) => r.avg)) / rows.length : 0.0;
  return { mode: "qual", model, n: rows.length, overall: round(overall, 4), rows };
}

module.exports = {
  HARNESS_DIR,
  PLUGIN_ROOT,
  SKILL_DIR,
  SKILL_MD,
  REFS_DIR,
  SCENARIOS,
  DEFAULT_MODEL,
  callCopilot,
  extractJson,
  readSkillMd,
  getDescription,
  validSlugs,
  loadScenarios,
  probeRouting,
  probeTrigger,
  probeAnswer,
  probeJudge,
  runQuant,
  runQual,
};

if (require.main === module) {
  const argv = process.argv;
  const arg = (flag, def) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : def);
  const mode = arg("--mode", "quant");
  const model = arg("--model", DEFAULT_MODEL);
  const result = mode === "quant" ? runQuant(model) : runQual(model);
  const { rows, ...rest } = result;
  console.log(JSON.stringify(rest, null, 2));
}
