#!/usr/bin/env node
// Mutation check. Delete one load-bearing line at a time and require the suite
// to notice. v0.1.0's suite let 14 of 20 such deletions pass, including the one
// that broke its own headline claim, so a surviving mutant is a release blocker
// rather than a metric.
//
//   node tests/mutate.mjs          run them all
//   node tests/mutate.mjs --list   name them without running

import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const S = "skills/loadpath/scripts";

// Each mutant removes or inverts one decision the tool is supposed to make.
const MUTANTS = [
  ["one commit is not split across its pairs", `${S}/scan.mjs`,
    "const vote = (2 / (ds.length * (ds.length - 1)))", "const vote = (1"],
  ["bulk-creation commits are not damped", `${S}/scan.mjs`,
    "(c.edits === 0 ? 0.15 : 1)", "(1)"],
  ["the breadth cap never fires", `${S}/scan.mjs`,
    "if (ds.length > cap) { capped++; continue; }", "if (false) { capped++; continue; }"],
  ["commit share is not computed", `${S}/scan.mjs`,
    "e.topShare = shares[0] / e.commits;", "e.topShare = 1;"],
  ["the 5% major-author threshold is ignored", `${S}/scan.mjs`,
    "shares.filter((n) => n / e.commits >= 0.05).length", "1"],
  ["time windows collapse into one", `${S}/scan.mjs`,
    "const w = Math.min(Math.floor(((c.at - lo) * windows) / span), windows - 1);", "const w = 0;"],
  ["renames stop producing relocations", `${S}/scan.mjs`,
    "if (st[0] === \"R\" || st[0] === \"C\")", "if (false)"],
  ["relocations fire on a single rename", `${S}/scan.mjs`,
    "filter((r) => r.n >= 3)", "filter((r) => r.n >= 1)"],
  ["shallow clones are not detected", `${S}/scan.mjs`,
    'shallow.out.trim() === "true"', "false"],
  ["object ids must be exactly 40 characters", `${S}/scan.mjs`,
    "/^[0-9a-f]{40,64}$/", "/^[0-9a-f]{40}$/"],
  ["an unparseable --since is accepted", `${S}/scan.mjs`,
    "Math.abs(cutoff - Date.now() / 1000) < 5", "false"],
  ["generated files are not filtered", `${S}/scan.mjs`,
    "if (m.generated) continue;", "if (false) continue;"],
  ["generated paths are not filtered", `${S}/scan.mjs`,
    "if (GENERATED_PATH.some((re) => re.test(rel))) continue;", "if (false) continue;"],
  ["vendored directories are walked", `${S}/scan.mjs`,
    "if (SKIP_DIR.has(e.name)) continue;", "if (false) continue;"],
  ["deleted directories inflate the activity count", `${S}/report.mjs`,
    "const dormant = live.length - active;", "const dormant = hist.dirs.size - active;"],
  ["test-path conventions never match", `${S}/scan.mjs`,
    "const isTest = (p) => winners.some((w) => w.re.test(p));", "const isTest = () => false;"],
  ["the median is the mean", `${S}/scan.mjs`,
    "return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;", "return s.reduce((a, b) => a + b, 0) / s.length;"],
  ["an empty analyzer result is believed", `${S}/deps.mjs`,
    "if (r.edges.size === 0) return notMeasured", "if (false) return notMeasured"],
  ["Tarjan never reports a component", `${S}/deps.mjs`,
    "comps.push(comp.sort());", "if (comp.length === 1) comps.push(comp.sort());"],
  ["go is probed with the wrong flag", `${S}/deps.mjs`,
    'has("go", ["version"])', 'has("go", ["--version"])'],
  [".csproj references are not read", `${S}/deps.mjs`,
    "/<ProjectReference\\s+Include\\s*=\\s*\"([^\"]+)\"/gi", "/__never__/gi"],
  ["the deviation ranking is unsorted", `${S}/report.mjs`,
    "].sort((a, b) => b.files / med - a.files / med)", "]"],
  ["the window profile is not printed", `${S}/report.mjs`,
    "[${prof} ]", "[]"],
  ["the budget is ignored", `${S}/report.mjs`,
    "if (s.length / 3.6 <= budget)", "if (true)"],
  ["history keeps directories that no longer exist", `${S}/report.mjs`,
    "filter(([p]) => dirs.has(p))", "filter(() => true)"],
  ["symlinked paths are compared unresolved", `${S}/loadpath.mjs`,
    "try { root = realpathSync(root); } catch { /* keep the literal path */ }", ""],
];

const list = process.argv.includes("--list");
if (list) { MUTANTS.forEach(([n], i) => console.log(`${String(i + 1).padStart(2)}. ${n}`)); process.exit(0); }

const survivors = [], broken = [];
for (const [name, file, from, to] of MUTANTS) {
  const dir = mkdtempSync(join(tmpdir(), "lp-mut-"));
  try {
    cpSync(ROOT, dir, { recursive: true, filter: (s) => !s.includes("/.git/") && !s.includes("node_modules") });
    const p = join(dir, file);
    const src = readFileSync(p, "utf8");
    if (!src.includes(from)) { broken.push(name); continue; }
    writeFileSync(p, src.replace(from, to));
    try {
      execFileSync("node", ["--test", "tests/*.test.mjs"], { cwd: dir, stdio: "pipe", timeout: 300000 });
      survivors.push(name);                       // suite stayed green: the mutant lives
    } catch { /* suite failed: the mutant was killed */ }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const killed = MUTANTS.length - survivors.length - broken.length;
console.log(`mutants ${MUTANTS.length}   killed ${killed}   survived ${survivors.length}   stale ${broken.length}`);
for (const s of survivors) console.log(`  SURVIVED  ${s}`);
for (const b of broken) console.log(`  STALE     ${b}  (the line this mutant edits no longer exists)`);
if (survivors.length || broken.length) process.exit(1);
console.log("every load-bearing deletion is caught.");
