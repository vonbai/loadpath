#!/usr/bin/env node
// Optional mutation sample. It deletes eight high-consequence anchors one at
// a time and asks the acceptance suite to notice. This is a diagnostic after
// risky test or architecture changes, not a release gate or coverage score.
//
//   node tests/mutate.mjs          run the sample
//   node tests/mutate.mjs --list   name it without running

import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const S = "skills/loadpath/scripts";

const MUTANTS = [
  ["generated files are not filtered", `${S}/scan.mjs`,
    "if (m.generated) continue;", "if (false) continue;"],
  ["history is not joined to the exact current-file population", `${S}/scan.mjs`,
    "if (!admit(p) || !inScope(p) || !liveFiles.has(p)) continue;", "if (!admit(p) || !inScope(p)) continue;"],
  ["an empty analyzer result is believed", `${S}/deps.mjs`,
    "if (r.edges.size === 0) return notMeasured", "if (false) return notMeasured"],
  ["layer depth is always one", `${S}/deps.mjs`,
    "const depth = maxOf(level) + 1;", "const depth = 1;"],
  ["the first measured span wins and the rest are dropped", `${S}/deps.mjs`,
    "spans.push(one);", "spans.push(one); if (one.measured) return spans;"],
  ["the inventory total falls back to an unspecified directory population", `${S}/report.mjs`,
    '"source-containing directory", "source-containing directories")}, max source-path depth',
    '"directory", "directories")}, max source-path depth'],
  ["physical source-path depth goes back to a bare depth", `${S}/report.mjs`,
    ', max source-path depth ${depth}`);', ', ${depth} deep`);'],
  ["compare stops saying that history lags a move", `${S}/report.mjs`,
    "for (const l of LAG) out.push(l);", ""],
];

if (process.argv.includes("--list")) {
  MUTANTS.forEach(([name], i) => console.log(`${String(i + 1).padStart(2)}. ${name}`));
  process.exit(0);
}

const run = promisify(execFile);
const lanes = Math.max(1, Math.min((os.availableParallelism?.() ?? os.cpus().length) - 1, 4));
const carried = (path) => !/(^|\/)(\.git|node_modules|\.corpus)(\/|$)/.test(path.slice(ROOT.length));

async function verdict([, file, from, to]) {
  const dir = mkdtempSync(join(tmpdir(), "lp-mut-"));
  try {
    cpSync(ROOT, dir, { recursive: true, filter: carried });
    const path = join(dir, file);
    const source = readFileSync(path, "utf8");
    if (!source.includes(from)) return "stale";
    writeFileSync(path, source.replace(from, to));
    try {
      await run("node", ["--test", "tests/loadpath.test.mjs"], {
        cwd: dir,
        timeout: 300000,
        maxBuffer: 64 * 1024 * 1024,
      });
      return "survived";
    } catch {
      return "killed";
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const results = new Array(MUTANTS.length);
let next = 0;
await Promise.all(Array.from({ length: lanes }, async () => {
  for (let i = next++; i < MUTANTS.length; i = next++) results[i] = await verdict(MUTANTS[i]);
}));

const survivors = [];
const stale = [];
MUTANTS.forEach(([name], i) => {
  if (results[i] === "survived") survivors.push(name);
  if (results[i] === "stale") stale.push(name);
});

console.log(`sampled mutants ${MUTANTS.length}   killed ${MUTANTS.length - survivors.length - stale.length}   survived ${survivors.length}   stale ${stale.length}`);
for (const name of survivors) console.log(`  SURVIVED  ${name}`);
for (const name of stale) console.log(`  STALE     ${name} (the edited line no longer exists)`);
if (survivors.length || stale.length) process.exit(1);
console.log("every sampled deletion is caught; this is diagnostic evidence, not exhaustive mutation coverage.");
