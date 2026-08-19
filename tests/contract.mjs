#!/usr/bin/env node
// The skill's own contract: frontmatter, budget, pointers, and the words it
// promised not to use.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const S = join(ROOT, "skills", "loadpath");
const text = readFileSync(join(S, "SKILL.md"), "utf8");
const errors = [];

const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
if (!fm) errors.push("SKILL.md has no frontmatter");
else {
  const name = fm[1].match(/^name:\s*(\S+)/m);
  const desc = fm[1].match(/^description:\s*([\s\S]+?)(?=\n[a-z-]+:|$)/m);
  if (!name || name[1] !== "loadpath") errors.push(`name must be loadpath, got ${name?.[1]}`);
  if (!desc) errors.push("description is missing");
  else {
    const d = desc[1].split(/\s+/).filter(Boolean);
    if (d.length < 25) errors.push("description is too short to route on");
    if (d.length > 70) errors.push(`description is ${d.length} words; it is paid on every turn, keep it under 70`);
  }
  if (/allowed-tools/.test(fm[1])) errors.push("declaring allowed-tools raises the machine's tool surface");
}

const lines = text.split("\n").length;
const tok = text.length / 3.6;
if (lines > 500) errors.push(`SKILL.md is ${lines} lines; the budget is 500`);
if (tok > 5000) errors.push(`SKILL.md is ~${Math.round(tok)} tokens; the budget is 5000`);

// codebase-design rejects "boundary" as overloaded and says seam or interface.
// Two skills loaded together must not contradict each other on vocabulary.
const banned = { boundary: "codebase-design rejects it; say seam or interface" };
for (const [w, why] of Object.entries(banned)) {
  if (new RegExp(`\\b${w}`, "i").test(text)) errors.push(`SKILL.md uses "${w}" — ${why}`);
}

// A verdict is not this tool's to emit; the skill must not teach one either.
for (const v of ["god file", "code smell", "violation", "you should split"]) {
  if (text.toLowerCase().includes(v)) errors.push(`SKILL.md emits a verdict: "${v}"`);
}

for (const p of text.match(/`(references\/[\w.-]+|scripts\/[\w.-]+)`/g) ?? []) {
  const rel = p.replace(/`/g, "");
  if (!existsSync(join(S, rel))) errors.push(`broken pointer: ${rel}`);
}
for (const need of ["references/canon.md", "references/language-conventions.md", "scripts/loadpath.mjs", "scripts/scan.mjs", "scripts/deps.mjs", "scripts/report.mjs"]) {
  if (!existsSync(join(S, need))) errors.push(`missing: ${need}`);
}

if (errors.length) { console.log("FAIL"); errors.forEach((e) => console.log(`  - ${e}`)); process.exit(1); }
console.log(`OK  SKILL.md ${lines} lines, ~${Math.round(tok)} tokens, pointers resolve, vocabulary clean`);
