#!/usr/bin/env node
// The skill's own contract: frontmatter, budget, pointers, and the words it
// promised not to use.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { proseTokens } from "../skills/loadpath/scripts/scan.mjs";

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
const tok = proseTokens(text);
if (lines > 500) errors.push(`SKILL.md is ${lines} lines; the budget is 500`);
if (tok > 5000) errors.push(`SKILL.md is ≤${tok} tokens; the budget is 5000`);

// codebase-design rejects "boundary" as overloaded and says seam or interface.
// Two skills loaded together must not contradict each other on vocabulary.
const banned = { boundary: "codebase-design rejects it; say seam or interface" };
for (const [w, why] of Object.entries(banned)) {
  if (new RegExp(`\\b${w}`, "i").test(text)) errors.push(`SKILL.md uses "${w}" — ${why}`);
}

// The install-facing surfaces must name the population they actually promise.
// Inventory holds only direct parents of admitted source files; "every
// directory" falsely includes container-only and unsupported-file paths.
for (const [file, body] of [
  ["skills/loadpath/SKILL.md", text],
  ["README.md", readFileSync(join(ROOT, "README.md"), "utf8")],
]) {
  if (/\bevery directory\b/i.test(body)) errors.push(`${file} promises every directory; the measured population is source-containing directories`);
}

const glossary = readFileSync(join(ROOT, "CONTEXT.md"), "utf8");
for (const term of ["Source population", "Source-containing directory", "Source-path depth", "Layer depth"]) {
  if (!glossary.includes(`**${term}**`)) errors.push(`CONTEXT.md does not define ${term}`);
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
console.log(`OK  SKILL.md ${lines} lines, ≤${tok} tokens, pointers resolve, vocabulary clean`);

// ── Documentation consistency ────────────────────────────────────────────────
//
// The manual review that produced this section found DESIGN.md naming two
// Python files that had been replaced by four JavaScript ones, canon.md citing
// a script that no longer existed, and docs/evidence.md describing the
// withdrawn substring method as though it were the shipped one. Each was a
// single-source-of-truth violation of the kind DESIGN.md forbids, and each
// would have drifted back. These checks are the loop closing.

import { readdirSync, statSync } from "node:fs";

const mds = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".md")) mds.push(p);
  }
})(ROOT);

// 1. Every script or reference a document names must exist.
for (const md of mds) {
  const body = readFileSync(md, "utf8");
  for (const m of body.matchAll(/`(scripts\/[\w.-]+|references\/[\w.-]+)`/g)) {
    if (!existsSync(join(S, m[1]))) {
      errors.push(`${md.slice(ROOT.length + 1)} names ${m[1]}, which does not exist`);
    }
  }
}

// 2. Terminology recorded as falsified must not read as current. It may appear
//    only in the documents whose subject is that failure.
const FALSIFIED = {
  "sound over-approximation": "a formal claim the measurement could not fund",
  "no cycle here": "false outside Go; the contract it named does not hold",
};
const MAY_RECORD_FAILURE = ["docs/adr/0006-withdraw-v0-1-0.md", "docs/research/findings.md"];
for (const md of mds) {
  const rel = md.slice(ROOT.length + 1);
  if (MAY_RECORD_FAILURE.includes(rel)) continue;
  const body = readFileSync(md, "utf8").toLowerCase();
  for (const [term, why] of Object.entries(FALSIFIED)) {
    if (body.includes(term)) errors.push(`${rel} uses "${term}" — ${why}`);
  }
}

// 3. A decision recorded as fact must be implemented, or say that it is not.
const scripts = readdirSync(join(S, "scripts")).map((f) => readFileSync(join(S, "scripts", f), "utf8")).join("\n");
const ADR_EVIDENCE = {
  "0002": /the quarantine/,          // inference quarantined by file
  "0003": /go list|grimp|madge|ProjectReference/,
  "0005": /export function tarjan\b/,
  "0009": /"--name-status"/,
  "0011": /e\.topShare = shares\[0\]/,
  "0012": /of \$\{p\.base\}c/,
  "0013": /const FAMILIES = \[/,      // one span per ecosystem, rooted at its own manifests
  // The field list is the decision: layout and spans, and nothing from git.
  // Nothing else holds history out of the record — a suite can assert what a
  // snapshot contains, not what it must never contain — so this is where a
  // `hist` added to that signature would be caught.
  "0014": /function snapshot\(\{ version, files, dirs, spans \}\)/,
  "0015": /max source-path depth/,
};
for (const f of readdirSync(join(ROOT, "docs", "adr"))) {
  const n = f.slice(0, 4);
  const body = readFileSync(join(ROOT, "docs", "adr", f), "utf8");
  const declared = /\*\*Status:\*\*[^\n]*not yet implemented/.test(body);
  const evidence = ADR_EVIDENCE[n];
  if (evidence && !evidence.test(scripts) && !declared) {
    errors.push(`ADR ${n} reads as implemented and the code does not show it`);
  }
}

// 4. Published token figures must bracket what the pinned corpora actually
// produced. Prose is what moves these numbers, so the check has to live where
// prose is checked; otherwise the README quietly describes an older output.
{
  const base = JSON.parse(readFileSync(join(ROOT, "tests", "measure-baseline.json"), "utf8"));
  const vals = Object.values(base);
  const n = (x) => Number(String(x).replace(/,/g, ""));
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const pairs = [
    ["orient", /([\d,]+)–([\d,]+) tokens across the four pinned corpora/, vals.map((v) => v.orientTokens)],
    ["structure", /([\d,]+)–([\d,]+) with `--structure`/, vals.map((v) => v.structureTokens)],
  ];
  for (const [name, re, got] of pairs) {
    const m = re.exec(readme);
    if (!m) { errors.push(`README states no ${name} token range`); continue; }
    if (got.some((x) => x == null)) { errors.push(`the baseline records no ${name} token count; re-run tests/measure.mjs --record`); continue; }
    if (n(m[1]) !== Math.min(...got) || n(m[2]) !== Math.max(...got)) {
      errors.push(`README's ${name} range ${m[1]}–${m[2]} is not the measured ${Math.min(...got)}–${Math.max(...got)}`);
    }
  }
  // SKILL.md publishes the same orient range in its own words, and it was the
  // copy nothing checked — one file's worth of drift away from the failure
  // this whole block exists to catch.
  const orient = vals.map((v) => v.orientTokens);
  const sm = /orient — ([\d,]+)–([\d,]+) tokens measured/.exec(text);
  if (!sm) errors.push("SKILL.md states no orient token range");
  else if (orient.every((x) => x != null) && (n(sm[1]) !== Math.min(...orient) || n(sm[2]) !== Math.max(...orient))) {
    errors.push(`SKILL.md's orient range ${sm[1]}–${sm[2]} is not the measured ${Math.min(...orient)}–${Math.max(...orient)}`);
  }
}

// 5. The installed copy must be able to name itself, and name itself correctly.
{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const cliSrc = readFileSync(join(S, "scripts", "loadpath.mjs"), "utf8");
  const v = /const VERSION = "([^"]+)";/.exec(cliSrc)?.[1];
  if (!v) errors.push("loadpath.mjs declares no VERSION; an installed copy cannot say what it is");
  else if (v !== pkg.version) errors.push(`loadpath.mjs is v${v} and package.json is v${pkg.version}`);
}

// 5b. The pinned install command is the primary one; a stale pin ships old bytes
// to everyone who copies it, so the pin is held to the package version.
{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const pin = /skills add vonbai\/loadpath@v([\d.]+) --global/.exec(readme)?.[1];
  if (!pin) errors.push("README publishes no pinned install command");
  else if (pin !== pkg.version) errors.push(`README pins v${pin} and package.json is v${pkg.version}`);
}

// 6. The counts the README publishes about its own verification must be the
// counts. These drifted twice by hand before they were checked here.
{
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const suite = readFileSync(join(ROOT, "tests", "loadpath.test.mjs"), "utf8");
  const mut = readFileSync(join(ROOT, "tests", "mutate.mjs"), "utf8");
  const tests = [...suite.matchAll(/^test\(/gm)].length;
  const mutants = [...mut.matchAll(/^  \["/gm)].length;
  const claimed = (re) => Number(re.exec(readme)?.[1] ?? -1);
  if (claimed(/(\d+) acceptance tests/) !== tests) errors.push(`README claims ${claimed(/(\d+) acceptance tests/)} acceptance tests; there are ${tests}`);
  if (claimed(/(\d+) one-line feature deletions/) !== mutants) errors.push(`README claims ${claimed(/(\d+) one-line feature deletions/)} mutants; there are ${mutants}`);
}

// 7. Every flag SKILL.md teaches must exist in the CLI.
const cli = readFileSync(join(S, "scripts", "loadpath.mjs"), "utf8");
for (const m of new Set([...text.matchAll(/`(--[a-z]+)[^`]*`/g)].map((x) => x[1]))) {
  if (!cli.includes(`"${m}"`)) errors.push(`SKILL.md teaches ${m}, which the CLI does not accept`);
}

// 8. And the other direction: every flag the CLI accepts must appear in
// --help. A flag that exists and is undocumented is a flag nobody finds, and
// the only map of this tool a reader has is the one it prints itself. The
// header comment used to carry a second copy of the list; it was deleted, and
// this is what keeps the remaining copy complete.
{
  const parse = /function parse\(argv\) \{[\s\S]*?\n\}/.exec(cli)?.[0];
  const help = /const HELP = `([\s\S]*?)`;/.exec(cli)?.[1];
  if (!parse) errors.push("loadpath.mjs declares no parse(argv); the flag list cannot be read");
  else if (help === undefined) errors.push("loadpath.mjs declares no HELP; the flags it accepts are documented nowhere");
  else {
    // A flag token, not a substring: "-h" occurs inside "--help", and a
    // containment test would call an undocumented -h documented.
    const flags = (s) => new Set([...s.matchAll(/(?<![\w-])(--?[A-Za-z][\w-]*)/g)].map((m) => m[1]));
    const named = flags(help);
    for (const f of [...parse.matchAll(/"(--?[A-Za-z][\w-]*)"/g)].map((m) => m[1])) {
      if (!named.has(f)) errors.push(`loadpath.mjs accepts ${f} and --help does not name it`);
    }
  }
}

// 9. Every truncation states what it dropped. DESIGN.md makes that a law, and a
// law is worth what it can be checked against: a slice whose result is rendered
// carries its "+N more" beside it. v0.1.0 cut every list in silence, and a
// reader who cannot tell a short list from a complete one stops looking exactly
// where the evidence was.
{
  const src = readFileSync(join(S, "scripts", "report.mjs"), "utf8");
  const lines = src.split("\n");
  // The two shapes a disclosure takes in this file: the shared `more()` helper,
  // or a "+" immediately before the interpolation carrying the count.
  const DISCLOSES = /\bmore\(|\+\$\{/;
  // The `.slice(0, …)` sites that are not a truncated list, each with its
  // reason. Keyed on the expression, so a rename or a changed cap breaks the
  // entry instead of silently widening it — the way the ADR anchors above break
  // when the code they cite moves.
  const NOT_A_LIST = {
    "names.slice(0, 3)": "the count is printed beside the ellipsis, so the line already says what it dropped",
  };
  // Measured against this file: the widest real gap is the largest-directories
  // block, where the rows themselves are printed between the slice and its
  // "+N more". A window rather than the enclosing function, because renderL0 is
  // long enough that any disclosure anywhere in it would pass.
  const WINDOW = 20;
  for (const expr of Object.keys(NOT_A_LIST)) {
    if (!src.includes(expr)) errors.push(`the truncation whitelist names ${expr}, which report.mjs no longer contains`);
  }
  lines.forEach((l, i) => {
    if (!l.includes(".slice(0,")) return;
    if (Object.keys(NOT_A_LIST).some((e) => l.includes(e))) return;
    if (DISCLOSES.test(lines.slice(i, i + WINDOW).join("\n"))) return;
    errors.push(`report.mjs:${i + 1} truncates and nothing within ${WINDOW} lines says what it dropped — ${l.trim()}`);
  });
}

// 10. docs/evidence.md is the register of every constant that shapes a
// measurement. A register that drifts from the code is worse than none, because
// a reader tunes the number it names while the tool goes on using another — and
// the paragraph this reads had gone stale exactly that way, naming two
// constants that no longer existed and missing a dozen that did. Each entry
// pins one value in the file the register says it lives in.
{
  const md = readFileSync(join(ROOT, "docs", "evidence.md"), "utf8").split("\n");
  const from = md.findIndex((l) => l.startsWith("- **No source supplies a threshold"));
  const to = md.findIndex((l, i) => i > from && (/^- \*\*/.test(l) || /^## /.test(l)));
  if (from < 0) errors.push("docs/evidence.md no longer carries the constants register");
  else {
    // Backticks off and whitespace flattened: the register is prose, and a
    // rewrap or a code fence should not read as a deleted constant.
    const block = md.slice(from, to < 0 ? md.length : to).join(" ").replace(/`/g, "").replace(/\s+/g, " ");
    const CONSTANTS = [
      ["--since default",           "loadpath.mjs", /since: "12\.months"/,                              "12.months"],
      ["--budget default",          "loadpath.mjs", /budget: 1600/,                                     "1600 tokens"],
      ["--budget floor",            "loadpath.mjs", /"--budget"\)[^\n]*take\(a, i, 200,/,               "with a floor of 200;"],
      ["--windows default",         "loadpath.mjs", /windows: 4/,                                       "--windows to 4"],
      ["--windows clamp",           "loadpath.mjs", /"--windows"\)[^\n]*take\(a, i, 2, 12,/,            "range 2 to 12"],
      ["breadth cap default",       "loadpath.mjs", /cap: 30/,                                          "breadth cap to 30"],
      ["breadth cap floor",         "loadpath.mjs", /"--cap"\)[^\n]*take\(a, i, 2, Infinity,/,          "with a floor of 2;"],
      ["--top default",             "loadpath.mjs", /top: 12/,                                          "to 12 pairs"],
      ["relocation floor",          "scan.mjs",     /filter\(\(r\) => r\.n >= 3\)/,                     "at 3 files moved"],
      ["test-convention quorum",    "scan.mjs",     /Math\.max\(3, votes\[0\]\?\.n \* 0\.2\)/,          "max(3, 20%)"],
      ["activity horizon",          "scan.mjs",     /Math\.min\(90, Math\.floor\(span \/ 86400\)\)/,    "min(90 days, the window)"],
      ["creation damping",          "scan.mjs",     /c\.edits === 0 \? 0\.15 : 1/,                      "damped to 0.15"],
      ["co-change vote floor",      "scan.mjs",     /const CO_FLOOR = 0\.5;/,                           "0.5 votes"],
      ["co-change support floor",   "scan.mjs",     /const CO_SUPPORT = 3;/,                            "over 3 commits"],
      ["scatter threshold and top", "scan.mjs",     /minDirs = 3, top = 3/,                             "at 3 directories, the widest 3"],
      ["major-author share",        "scan.mjs",     /n \/ e\.commits >= 0\.05/,                         "5% of a directory's commits"],
      ["token bound, output",       "scan.mjs",     /CHARS_PER_TOKEN = 2\.6;/,                          "2.6 characters per token"],
      ["token bound, prose",        "scan.mjs",     /CHARS_PER_TOKEN_PROSE = 4\.4;/,                    "4.4 for prose"],
      ["manifest walk depth",       "scan.mjs",     /if \(depth > 3\) return;/,                         "descends 3 directories below the root"],
      ["binary sniff",              "scan.mjs",     /const BINARY_SNIFF = 8000;/,                       "8,000-byte binary sniff"],
      ["L0 caps",                   "report.mjs",   /const LANGS = 5, CONVS = 2, LARGEST = 5, RELOCS = 8, TANGLES = 3, FANOUT = 3;/,
        "5 languages, 2 test conventions, 5 largest Source-containing directories, 8 relocations, 3 entangled groups and 3 fan-out rows"],
      ["fan-out gate",              "report.mjs",   /x\.o >= 3 && x\.i <= 1/,                           "3 or more outward edges with 1 or fewer inward"],
      ["compare list cap",          "report.mjs",   /const CAP = 5;/,                                   "names 5 members"],
      ["compare mass threshold",    "report.mjs",   /Math\.abs\(delta\) > 0\.2/,                        "more than a fifth"],
      ["single-author column drop", "report.mjs",   /topShare === 1 && e\.majorAuthors === 1/,          "top author holds every one of its commits"],
      ["reach ceiling",             "deps.mjs",     /const REACH_CEILING = 20000;/,                     "below 20,000 components"],
      ["busiest counterparts",      "deps.mjs",     /const TOP = 5;/,                                   "5 busiest counterpart directories"],
      ["Go module walk depth",      "deps.mjs",     /const GO_MODULE_DEPTH = 4;/,                       "descends 4 directories below the root"],
      ["csproj walk depth",         "deps.mjs",     /const CSPROJ_DEPTH = 12;/,                         ".csproj walk 12"],
    ];
    const cache = new Map();
    for (const [what, file, re, named] of CONSTANTS) {
      if (!cache.has(file)) cache.set(file, readFileSync(join(S, "scripts", file), "utf8"));
      if (!re.test(cache.get(file))) errors.push(`docs/evidence.md puts the ${what} in ${file}, and ${file} no longer carries it`);
      if (!block.includes(named)) errors.push(`the constants register no longer names the ${what} ("${named}")`);
    }
    for (const f of new Set(CONSTANTS.map((c) => c[1]))) {
      if (!block.includes(f)) errors.push(`the constants register pins a value in ${f} without naming the file`);
    }
  }
}

if (errors.length) { console.log("FAIL"); errors.forEach((e) => console.log(`  - ${e}`)); process.exit(1); }
console.log(`   documents consistent: ${mds.length} markdown files, pointers resolve, no withdrawn terminology, ADRs match the code`);
console.log(`   truncations disclosed in report.mjs, and the constants register matches the four scripts`);
