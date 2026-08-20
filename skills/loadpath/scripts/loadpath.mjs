#!/usr/bin/env node
// Loadpath — one command, three layers.
//
//   node loadpath.mjs [REPO] [options]
//
//   --since 12.months     history window (default 12.months)
//   --budget 1600         token budget for the structure table (default 1600)
//   --windows 4           time windows for co-change (default 4)
//   --cap 30              breadth cap; wider commits are sweeps, not coupling
//   --top 12              co-change pairs to print
//   --dir PATH            file-level detail for one subtree, then stop
//   --structure           add the structure table and the entangled groups
//
// The default output orients. Ask for more by name.

import { existsSync, statSync, realpathSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inventory, history, manifests, submodulePaths, byDirectory, testConvention, tryGit, tokens, CHARS_PER_TOKEN } from "./scan.mjs";
import { renderL0, renderL1, renderL2, renderCoChange, renderRelocations, renderDepsDetail } from "./report.mjs";
import { dependencies } from "./deps.mjs";

// `npx skills add` copies skills/loadpath/ and nothing else, so package.json
// does not travel with the installed skill. Without this constant an installed
// copy cannot say what it is, and output pasted into an issue carries no
// provenance. tests/contract.mjs holds it equal to package.json.
const VERSION = "0.2.2";

function parse(argv) {
  const o = { repo: ".", since: "12.months", budget: 1600, windows: 4, cap: 30, top: 12, dir: null, structure: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since") o.since = argv[++i];
    else if (a === "--budget") o.budget = Math.max(200, Number(argv[++i]) || 1600);
    else if (a === "--windows") o.windows = Math.min(12, Math.max(2, Number(argv[++i]) || 4));
    else if (a === "--cap") o.cap = Math.max(2, Number(argv[++i]) || 30);
    else if (a === "--top") o.top = Math.max(1, Number(argv[++i]) || 12);
    else if (a === "--dir") o.dir = argv[++i];
    else if (a === "--structure") o.structure = true;
    else if (a === "--version" || a === "-V") { o.version = true; }
    else if (a === "-h" || a === "--help") { o.help = true; }
    else if (!a.startsWith("-")) rest.push(a);
  }
  if (rest.length) o.repo = rest[0];
  return o;
}

const HELP = `loadpath — exact facts about how a codebase carries its weight

  node loadpath.mjs [REPO] [options]

  --version           print the version of this installed copy
  --since 12.months   history window
  --budget 1600       token budget for the structure table
  --windows 4         time windows for co-change
  --cap 30            breadth cap; wider commits are sweeps
  --top 12            co-change pairs to print
  --dir PATH          file-level detail for one subtree
  --structure         add the structure table and entangled groups

Every number is measured from the filesystem or from git. Where a thing cannot
be measured the output says "not measured", which is not the same as zero.
The tool emits leads; a finding exists after someone reads the code.`;

function main() {
  const o = parse(process.argv.slice(2));
  if (o.version) { console.log(`loadpath ${VERSION}`); return; }
  if (o.help) { console.log(HELP); return; }

  let root = resolve(o.repo);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`not a directory: ${root}`); process.exit(1);
  }
  // Resolve symlinks on both sides before comparing. On macOS /tmp and
  // /var are symlinks, so a path that looks different from git's toplevel
  // may be the same directory — and treating it as a subdirectory filters
  // every file out.
  try { root = realpathSync(root); } catch { /* keep the literal path */ }

  // Every module speaks repo-root-relative paths. Without this the filesystem
  // half and the git half use different coordinate systems and cannot be read
  // side by side — which is the whole point of having two.
  const top = tryGit(root, ["rev-parse", "--show-toplevel"]);
  let scopeNote = null, prefix = "";
  if (top.ok) {
    let gitRoot = resolve(top.out.trim());
    try { gitRoot = realpathSync(gitRoot); } catch { /* keep */ }
    if (gitRoot !== root) {
      prefix = relative(gitRoot, root).split(sep).join("/");
      scopeNote = `scanning ${prefix}/ inside the repository at ${gitRoot}; all paths are repository-relative`;
      root = gitRoot;
    }
  }

  const files = inventory(root, prefix, submodulePaths(root));
  if (!files.length) {
    console.log(`${resolve(o.repo)}\n\nno source files found (after skipping vendored, generated and build output)`);
    return;
  }
  const conv = testConvention(files);
  const dirs = byDirectory(files, conv.isTest);
  const hist = history(root, { since: o.since, windows: o.windows, breadthCap: o.cap, prefix });
  // A subtree inside a module still belongs to that module, so the manifest
  // above the scope is kept beside the ones inside it. Both are what the
  // reader is told is declared, and both are what the analyzers are rooted at.
  const under = (p, q) => q === "" || p === q || p.startsWith(q + "/");
  const inScope = (m) => under(m.path, prefix) || under(prefix, m.path);
  const declared = manifests(root);
  const mans = declared.modules.filter(inScope);
  // What the scan dropped as copies, scoped the same way: a drop outside the
  // scope is not this reader's news.
  const filtered = declared.filtered.filter(inScope);

  if (o.dir) {
    console.log(renderL2({ files, conv, hist, prefix: o.dir.replace(/\/$/, "") }));
    return;
  }

  // Where each analyzer is rooted is the quarantine's decision, not this
  // file's: one root for the whole repository is what made a Go backend beside
  // a Node frontend report that no analyzer applied to either.
  const spans = dependencies(root, { files, mans, prefix });

  const parts = [];
  parts.push(root + (prefix ? "/" + prefix : ""));
  if (scopeNote) parts.push(scopeNote);
  parts.push("");
  // The whole result, not a pre-rendered line: the entry point does not format.
  parts.push(renderL0({ files, dirs, conv, hist, mans, filtered, spans, root, since: o.since, windows: o.windows }));

  const reloc = renderRelocations(hist);
  if (reloc) { parts.push(""); parts.push(reloc); }

  parts.push("");
  parts.push(renderCoChange(hist, o.top));

  if (o.structure) {
    parts.push("");
    parts.push("structure   every directory, largest first");
    parts.push(renderL1({ dirs, hist, spans, budget: o.budget }));
    // Each span's header line already appeared in L0; only the detail is new.
    const detail = renderDepsDetail(spans);
    if (detail) { parts.push(""); parts.push(detail); }
  }

  parts.push("");
  parts.push("next        --structure for every directory and the entangled groups");
  parts.push("            --dir PATH for one subtree, file by file");
  parts.push("            then read the code. These are leads, not findings.");

  const text = parts.join("\n");
  console.log(text);
  console.error(`[loadpath] v${VERSION}  \u2264${tokens(text)} tokens (upper bound: characters / ${CHARS_PER_TOKEN}, calibrated against tiktoken on this tool's densest output)`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
export { parse };
