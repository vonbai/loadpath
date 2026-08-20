#!/usr/bin/env node
// Reproducible measurement. Every number this project publishes is recomputed
// here from a pinned public corpus, so a third party can check it.
//
// v0.1.0 published a precision figure measured on a private repository at an
// unrecorded commit with a harness that existed nowhere, and which described
// code that had already changed. This file exists so that cannot recur.
//
//   node tests/measure.mjs            measure, and compare against the baseline
//   node tests/measure.mjs --record   rewrite the baseline from this run

import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tokens } from "../skills/loadpath/scripts/scan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "skills", "loadpath", "scripts", "loadpath.mjs");
const WORK = join(ROOT, ".corpus");

// Pinned. A moving corpus is not a corpus.
const CORPUS = [
  {
    name: "spf13/cobra",
    url: "https://github.com/spf13/cobra.git",
    sha: "adbc8813901bba65827259daa8e22ff94ec1f30e",
    eco: "Go",
    // Go forbids import cycles, so a correct analyzer must report zero groups
    // on any module that compiles. This is the check v0.1.0 would have failed.
    expect: { entangled: 0 },
  },
  {
    // Large, Go, long history: the corpus that exercises the scale claims a
    // 36-file repository cannot. Every SHA here was read from the GitHub API,
    // never typed — the previous entry carried a SHA that did not resolve to
    // any object, and `optional: true` hid it. That is the v0.1.0 failure
    // reproduced inside the harness written to prevent it.
    name: "cli/cli",
    url: "https://github.com/cli/cli.git",
    sha: "95d3a1db45abd547c2dafbee4f8a68ca53fb9c80",
    eco: "Go",
    expect: { entangled: 0 },
  },
  {
    // TypeScript, so the Node path is exercised rather than only asserted.
    name: "sverweij/dependency-cruiser",
    url: "https://github.com/sverweij/dependency-cruiser.git",
    sha: "ec603451d07d699280234808f91c4c8d3813f6e8",
    eco: "Node",
  },
];

const sh = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

function fetchCorpus(c) {
  const dir = join(WORK, c.name.replace("/", "__"));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    sh("git", ["init", "-q"], dir);
    sh("git", ["remote", "add", "origin", c.url], dir);
  }
  const at = (() => { try { return sh("git", ["rev-parse", "HEAD"], dir).trim(); } catch { return ""; } })();
  if (at !== c.sha) {
    // Full history: co-change and relocations need it, and a blobless partial
    // clone costs two minutes where a full one costs a fraction of a second.
    sh("git", ["fetch", "-q", "--tags", "origin"], dir);
    sh("git", ["checkout", "-q", "--detach", c.sha], dir);
  }
  return dir;
}

// `--warm` fetches the corpora and downloads Go module dependencies, then
// stops. The scan itself refuses to reach the network, so on a cold machine
// something has to do this first — explicitly, and named as what it is.
const warmOnly = process.argv.includes("--warm");

const results = [];
let failedFetch = false;
for (const c of CORPUS) {
  let dir;
  try { dir = fetchCorpus(c); }
  catch (e) {
    // A pin that does not resolve is the defect this file exists to prevent,
    // so it fails the run rather than printing "skipped" and moving on.
    console.log(`  FAIL  ${c.name} @ ${c.sha.slice(0, 12)} did not fetch — ${String(e.message).split("\n")[0].slice(0, 120)}`);
    failedFetch = true;
    continue;
  }

  if (warmOnly) {
    // The scan refuses to reach the network, so whatever each ecosystem's
    // analyzer needs is fetched here, named, and paid for once.
    try {
      if (c.eco === "Go") sh("go", ["mod", "download"], dir);
      else if (c.eco === "Node") sh("npx", ["--yes", "madge", "--version"], dir);
      console.log(`  warmed  ${c.name} (${c.eco})`);
    } catch (e) {
      console.log(`  FAIL  ${c.name} could not be warmed — ${String(e.message).split("\n")[0].slice(0, 120)}`);
      failedFetch = true;
    }
    continue;
  }

  const t0 = Date.now();
  const out = sh("node", [CLI, dir, "--since", "20.years", "--structure"], ROOT);
  const ms = Date.now() - t0;
  // Both views, because both are published figures.
  const orient = sh("node", [CLI, dir, "--since", "20.years"], ROOT);

  const grab = (re) => Number(out.match(re)?.[1] ?? -1);
  const r = {
    corpus: c.name,
    sha: c.sha.slice(0, 12),
    files: Number((out.match(/^([\d,]+) source files/m)?.[1] ?? "-1").replace(/,/g, "")),
    directories: grab(/, (\d+) directories,/),
    edges: grab(/dependencies\s+([\d,]+) edges/),
    entangled: grab(/(\d+) mutually entangled group/),
    layers: grab(/load path is (\d+) layers deep/),
    analyzer: out.match(/via ([^\n]+)/)?.[1] ?? "none",
    tokens: tokens(out),
    orientTokens: tokens(orient),
    ms,
  };
  // The repository must be byte-identical afterwards. Three analyzers in this
  // space mutate state as a side effect of a read — and this assertion was
  // dead until now, because the copy was taken before the flag was set.
  r.clean = sh("git", ["status", "--porcelain"], dir).trim() === "";
  results.push({ ...r, expect: c.expect });
}

let failed = false;
if (warmOnly) process.exit(failedFetch ? 1 : 0);

console.log("corpus                sha           files  dirs  edges  entangled  layers  tokens   ms  analyzer");
for (const r of results) {
  console.log(
    `${r.corpus.padEnd(21)} ${r.sha}  ${String(r.files).padStart(6)} ${String(r.directories).padStart(5)} ` +
    `${String(r.edges).padStart(6)} ${String(r.entangled).padStart(10)} ${String(r.layers).padStart(7)} ` +
    `${String(r.tokens).padStart(7)} ${String(r.ms).padStart(4)}  ${r.analyzer}`);
  for (const [k, v] of Object.entries(r.expect ?? {})) {
    if (r[k] !== v) { console.log(`  FAIL  ${k} is ${r[k]}, pinned expectation is ${v}`); failed = true; }
  }
  if (r.clean === false) { console.log(`  FAIL  the corpus working tree was modified by a scan`); failed = true; }
}

if (!results.length) { console.log("\nno corpus reachable; nothing was measured, so nothing is verified"); process.exit(1); }
if (failedFetch) process.exit(1);
// Compare against the recorded baseline, so a figure cannot move unnoticed.
const BASE = join(ROOT, "tests", "measure-baseline.json");
const record = process.argv.includes("--record");
const seen = Object.fromEntries(results.map((r) => [r.corpus, {
  sha: r.sha, files: r.files, directories: r.directories, edges: r.edges,
  entangled: r.entangled, layers: r.layers, analyzer: r.analyzer,
  // Recorded so the range the README publishes can be checked against the
  // output that produced it, instead of drifting with every wording change.
  orientTokens: r.orientTokens, structureTokens: r.tokens,
}]));
if (record) {
  writeFileSync(BASE, JSON.stringify(seen, null, 2) + "\n");
  console.log(`\nbaseline recorded for ${Object.keys(seen).length} corpora`);
} else if (existsSync(BASE)) {
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  for (const [corpus, want] of Object.entries(base)) {
    const got = seen[corpus];
    if (!got) { console.log(`  FAIL  ${corpus} is in the baseline and was not measured`); failed = true; continue; }
    // An analyzer that is not installed here did not regress; it was not run.
    // Saying so is the difference between a gap and a defect, and the two must
    // never be printed the same way.
    if (want.analyzer !== "none" && got.analyzer === "none") {
      console.log(`  NOT EXERCISED  ${corpus}: ${want.analyzer} is unavailable here, so its dependency figures were not recomputed`);
      for (const k of ["edges", "entangled", "layers", "analyzer", "orientTokens", "structureTokens"]) delete want[k];
    }
    for (const [k, v] of Object.entries(want)) {
      // Token counts carry the current date, and a date one character wider
      // moves them by a few. A band, stated, catches a divisor error without
      // failing on the calendar.
      if (k.endsWith("Tokens")) {
        const drift = Math.abs(got[k] - v) / v;
        if (drift > 0.05) { console.log(`  FAIL  ${corpus}.${k}: measured ${got[k]}, baseline ${v} (${Math.round(drift * 100)}% outside the 5% band)`); failed = true; }
        continue;
      }
      if (got[k] !== v) { console.log(`  FAIL  ${corpus}.${k}: measured ${got[k]}, baseline ${v}`); failed = true; }
    }
  }
  if (!failed) console.log(`\nEvery figure matches tests/measure-baseline.json, recomputed from the pinned commits; token counts within a stated 5% band.`);
} else {
  console.log(`\nno baseline yet — run with --record once the figures are trusted`);
}
if (failed) process.exit(1);
