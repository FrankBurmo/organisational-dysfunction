#!/usr/bin/env node
/**
 * validate.js — static validation of the skill + eval assets. No `copilot` calls, so it is
 * safe to run in CI. Exits non-zero on any problem.
 *
 * Checks:
 *   - SKILL.md exists and its `name` frontmatter matches the directory name (or the skill
 *     silently fails to load in Copilot) and is a valid slug
 *   - `description` frontmatter is present and within the 1024-char limit
 *   - at least one reference file exists
 *   - evals/scenarios.json parses and every scenario is well-formed
 *   - every `expected_refs` slug maps to a real references/<slug>.md file
 *   - every reference file is linked from the SKILL.md router index (no orphans)
 *
 * Run: node validate.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const H = require("./harness.js");

const errors = [];
const check = (cond, msg) => {
  if (!cond) errors.push(msg);
};

// 1. SKILL.md exists
check(fs.existsSync(H.SKILL_MD), `SKILL.md not found at ${H.SKILL_MD}`);
const skill = fs.existsSync(H.SKILL_MD) ? H.readSkillMd() : "";

// 2. Frontmatter: name matches directory, valid slug; description present and <= 1024 chars
const dirName = path.basename(H.SKILL_DIR);
const nameMatch = skill.match(/^name:\s*(.+?)\s*$/m);
check(
  nameMatch && nameMatch[1] === dirName,
  `frontmatter \`name\` must equal directory name "${dirName}" (got "${nameMatch ? nameMatch[1] : "none"}")`
);
check(
  /^[a-z0-9-]{1,64}$/.test(dirName),
  `skill directory name "${dirName}" must be lowercase letters/numbers/hyphens, max 64 chars`
);
const desc = H.getDescription(skill);
check(desc.length > 0, "frontmatter `description` is empty");
check(desc.length <= 1024, `frontmatter \`description\` is ${desc.length} chars (max 1024)`);

// 3. References exist
const slugs = H.validSlugs();
check(slugs.size > 0, "no reference files found in references/");

// 4. scenarios.json parses and each scenario is well-formed
let scenarios = [];
try {
  scenarios = H.loadScenarios();
} catch (e) {
  errors.push(`scenarios.json failed to parse: ${e.message}`);
}
check(Array.isArray(scenarios) && scenarios.length > 0, "scenarios.json has no scenarios");

const seenIds = new Set();
for (const s of scenarios) {
  const id = s && s.id;
  check(typeof id === "string" && id.length > 0, `scenario missing string \`id\`: ${JSON.stringify(s).slice(0, 80)}`);
  check(!seenIds.has(id), `duplicate scenario id: ${id}`);
  seenIds.add(id);
  check(typeof s.prompt === "string" && s.prompt.length > 0, `scenario ${id}: missing \`prompt\``);
  check(typeof s.should_trigger === "boolean", `scenario ${id}: \`should_trigger\` must be a boolean`);
  check(Array.isArray(s.expected_refs), `scenario ${id}: \`expected_refs\` must be an array`);
  for (const ref of s.expected_refs || []) {
    check(slugs.has(ref), `scenario ${id}: expected_ref "${ref}" has no matching references/${ref}.md`);
  }
  if (s.should_trigger === false) {
    check((s.expected_refs || []).length === 0, `scenario ${id}: negative scenarios must have empty expected_refs`);
  } else if (s.should_trigger === true) {
    check((s.expected_refs || []).length > 0, `scenario ${id}: positive scenarios must list at least one expected_ref`);
  }
}

// 5. No orphan references — every reference must be linked from the router index
for (const slug of slugs) {
  check(skill.includes(`references/${slug}.md`), `reference "${slug}" is not linked from the SKILL.md router index`);
}

// --- report ------------------------------------------------------------------

if (errors.length) {
  console.error(`\u2717 validation failed (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `\u2713 validation passed: ${slugs.size} references, ${scenarios.length} scenarios, description ${desc.length} chars`
);
