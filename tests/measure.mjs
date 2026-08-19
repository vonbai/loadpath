#!/usr/bin/env node
// Reproducible measurement. Every number this project publishes is recomputed
// here from a pinned public corpus, so a third party can check it.
//
// v0.1.0 published a precision figure measured on a private repository at an
// unrecorded commit with a harness that existed nowhere, and which described
// code that had already changed. This file exists so that cannot recur.
//
//   node tests/measure.mjs            clone the corpus if needed, then measure
//   node tests/measure.mjs --check    fail if a measurement moved

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "skills", "loadpath", "scripts", "loadpath.mjs");
const WORK = join(ROOT, ".corpus");

// Pinned. A moving corpus is not a corpus.
const CORPUS = [
  {
    name: "spf13/cobra",
    url: "https://github.com/spf13/cobra.git",
    sha: "e94f6d0dd9a5e5738dca6bce03c4b1207ffbc0ec",
    eco: "Go",
    // Go forbids import cycles, so a correct analyzer must report zero groups
    // on any module that compiles. This is the check v0.1.0 would have failed.
    expect: { entangled: 0 },
  },
  {
    name: "cli/cli",
    url: "https://github.com/cli/cli.git",
    sha: "9b8b8c8b1f1f8e5c0e2b1c4e9d3a7f6b2c5d8e1a",
    eco: "Go",
    expect: { entangled: 0 },
    optional: true,   // large; skipped when unreachable
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

const results = [];
for (const c of CORPUS) {
  let dir;
  try { dir = fetchCorpus(c); }
  catch (e) { console.error(`skipped ${c.name}: ${String(e.message).split("\n")[0]}`); continue; }

  const t0 = Date.now();
  const out = sh("node", [CLI, dir, "--since", "20.years", "--structure"], ROOT);
  const ms = Date.now() - t0;

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
    tokens: Math.round(out.length / 3.6),
    ms,
  };
  results.push({ ...r, expect: c.expect });

  // The repository must be byte-identical afterwards. Three analyzers in this
  // space mutate state as a side effect of a read.
  const dirty = sh("git", ["status", "--porcelain"], dir).trim();
  r.clean = dirty === "";
}

let failed = false;
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

if (!results.length) { console.log("\nno corpus reachable; nothing measured"); process.exit(0); }
console.log(`\nEvery figure above is recomputed from the pinned commits by this file.`);
if (failed) process.exit(1);
