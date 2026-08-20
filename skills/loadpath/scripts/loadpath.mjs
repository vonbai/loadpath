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
//   --snapshot FILE       also record this scan's layout and spans to FILE
//   --compare FILE        print only what moved since FILE, then stop
//
// The default output orients. Ask for more by name.

import { existsSync, statSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inventory, history, manifests, submodulePaths, byDirectory, testConvention, scatter, snapshot, tryGit, tokens, CHARS_PER_TOKEN } from "./scan.mjs";
import { renderL0, renderL1, renderL2, renderCoChange, renderRelocations, renderDepsDetail, renderCompare } from "./report.mjs";
import { dependencies } from "./deps.mjs";

// `npx skills add` copies skills/loadpath/ and nothing else, so package.json
// does not travel with the installed skill. Without this constant an installed
// copy cannot say what it is, and output pasted into an issue carries no
// provenance. tests/contract.mjs holds it equal to package.json.
const VERSION = "0.2.2";

function parse(argv) {
  const o = { repo: ".", since: "12.months", budget: 1600, windows: 4, cap: 30, top: 12, dir: null, structure: false, snapshot: null, compare: null };
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
    // A file the user named, and only that: there is no default path here,
    // because the only default worth having would be inside the repository
    // being read, and a read does not write there. An empty string is the
    // flag arriving without its file, which main() refuses by name.
    else if (a === "--snapshot" || a === "--compare") {
      const v = argv[i + 1];
      const given = v !== undefined && !v.startsWith("-");
      if (given) i++;
      o[a.slice(2)] = given ? v : "";
    }
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
  --snapshot FILE     also write this scan's layout and spans to FILE
  --compare FILE      print only what moved since FILE, and nothing else

Take a snapshot before moving code and compare after: the layout and the spans
answer immediately, while co-change and activity lag a move by design.
Neither flag has a default path — the file is yours to name, so that nothing
is ever written into the repository being read.

Every number is measured from the filesystem or from git. Where a thing cannot
be measured the output says "not measured", which is not the same as zero.
The tool emits leads; a finding exists after someone reads the code.`;

// A usage error the reader can act on, and nothing printed on stdout: what
// this tool writes there is measurements, and a message in that stream would
// be read as one.
function refuse(why) {
  console.error(`loadpath: ${why}`);
  process.exit(1);
}

// What --compare expects, checked before anything is compared against it. A
// file whose version is missing is not a snapshot this tool wrote, and reading
// its fields anyway would silently compare against zeros.
function readSnapshot(file) {
  let raw;
  try { raw = readFileSync(file, "utf8"); }
  catch (e) { refuse(`cannot read ${file} — ${String(e.message).split("\n")[0]}`); }
  let j;
  try { j = JSON.parse(raw); }
  catch { refuse(`${file} is not JSON; --compare expects a file written by --snapshot`); }
  if (!j || typeof j !== "object" || typeof j.version !== "string") {
    refuse(`${file} carries no version field, so it is not a loadpath snapshot; --compare expects a file written by --snapshot`);
  }
  // Shape, not just presence: a field of the wrong type would raise inside the
  // comparison, and a stack trace is a worse answer than a sentence.
  if (!j.dirs || typeof j.dirs !== "object" || !Array.isArray(j.spans)) {
    refuse(`${file} carries no layout or no spans; --compare expects a file written by --snapshot`);
  }
  return j;
}

function main() {
  const o = parse(process.argv.slice(2));
  if (o.version) { console.log(`loadpath ${VERSION}`); return; }
  if (o.help) { console.log(HELP); return; }
  if (o.snapshot === "") refuse("--snapshot needs the file to write, and has no default: the only default worth having would sit inside the repository being read, and a read does not write there");
  if (o.compare === "") refuse("--compare needs the snapshot file to read, and has no default");

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

  const submodules = submodulePaths(root);
  const files = inventory(root, prefix, submodules);
  if (!files.length) {
    console.log(`${resolve(o.repo)}\n\nno source files found (after skipping vendored, generated and build output)`);
    return;
  }
  const conv = testConvention(files);
  const dirs = byDirectory(files, conv.isTest);
  const hist = history(root, {
    since: o.since, windows: o.windows, breadthCap: o.cap, prefix,
    // The same submodule set the walk used, and the tree it found. Both halves
    // of the page owe the reader one population, and only the walk knows which
    // directories a reader can still open.
    submodules, live: new Set(dirs.keys()),
  });
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

  // Where each analyzer is rooted is the quarantine's decision, not this
  // file's: one root for the whole repository is what made a Go backend beside
  // a Node frontend report that no analyzer applied to either. The subtree is
  // a second question asked of the same graph, so naming one does not change
  // what is measured — only what is also reported.
  const subtree = o.dir ? o.dir.replace(/\/$/, "") : "";
  const spans = dependencies(root, { files, mans, prefix, subtree });
  const head = tryGit(root, ["rev-parse", "HEAD"]);
  const record = () => snapshot({
    version: VERSION, at: head.ok ? head.out.trim() : "", since: o.since, files, dirs, spans,
  });

  let text;
  if (o.compare) {
    // Only the delta. The reader has seen the normal view already — it is
    // where the snapshot came from — and reprinting it would bury the lines
    // they came back for.
    text = renderCompare(readSnapshot(o.compare), record());
  } else if (o.dir) {
    text = renderL2({ files, conv, hist, spans, prefix: subtree });
  } else {
    const parts = [];
    parts.push(root + (prefix ? "/" + prefix : ""));
    if (scopeNote) parts.push(scopeNote);
    parts.push("");
    // The whole result, not a pre-rendered line: the entry point does not format.
    parts.push(renderL0({ files, dirs, conv, hist, mans, filtered, spans, scattered: scatter(files), root, since: o.since, windows: o.windows }));

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
    text = parts.join("\n");
  }
  console.log(text);
  // Written after the view, and to the path the reader named. Where it lands
  // is their choice; this tool has no opinion about it beyond never picking
  // one itself.
  if (o.snapshot) {
    writeFileSync(o.snapshot, JSON.stringify(record(), null, 2) + "\n");
    console.error(`[loadpath] snapshot written to ${resolve(o.snapshot)}`);
  }
  console.error(`[loadpath] v${VERSION}  \u2264${tokens(text)} tokens (upper bound: characters / ${CHARS_PER_TOKEN}, calibrated against tiktoken on this tool's densest output)`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
export { parse };
