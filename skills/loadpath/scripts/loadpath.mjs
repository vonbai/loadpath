#!/usr/bin/env node
// Loadpath — one command, three layers. The default output orients; everything
// else is asked for by name.
//
// The flags and what each one does live in HELP below, once. This header
// carried a second copy of that list, which is a list with two sides to go
// stale on; tests/contract.mjs now holds HELP to naming every flag parse()
// accepts, so HELP is the only place either can be read from.

import { existsSync, statSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inventory, history, manifests, submodulePaths, byDirectory, testConvention, scatter, snapshot, SNAPSHOT_SCHEMA, tryGit, tokens, CHARS_PER_TOKEN } from "./scan.mjs";
import { renderL0, renderL1, renderL2, renderCoChange, renderRelocations, renderDepsDetail, renderCompare } from "./report.mjs";
import { dependencies } from "./deps.mjs";

// `npx skills add` copies skills/loadpath/ and nothing else, so package.json
// does not travel with the installed skill. Without this constant an installed
// copy cannot say what it is, and output pasted into an issue carries no
// provenance. tests/contract.mjs holds it equal to package.json.
const VERSION = "0.3.1";

// What the command line said, and what this tool did with it. Every departure
// between the two is carried out of here rather than made quietly: a flag it
// does not know, a flag whose value is missing, a value it had to move, and a
// flag another flag makes it ignore. The reader typed a number and was shown
// the output of a different one, with nothing on the page to say so.
function parse(argv) {
  const o = { repo: ".", since: "12.months", budget: 1600, windows: 4, cap: 30, top: 12, dir: null, structure: false, snapshot: null, compare: null, notices: [], error: null };
  const rest = [], asked = new Set();
  // The first refusal wins. A second message about the same command line tells
  // the reader to fix two things when fixing the first may resolve both.
  const fail = (why) => { if (!o.error) o.error = why; };
  // A flag that needs a value and did not get one. The next token missing, or
  // itself a flag, is the shape the typo takes — and falling back to the
  // default there answers a question nobody asked, silently. --snapshot has
  // always refused; this is that rule, generalised to every flag that takes a
  // value rather than left as one flag's special case.
  const value = (flag, i, numeric = false) => {
    const v = argv[i + 1];
    // A negative number is a value, and one of the bounds below is where it
    // gets answered — reading it as the next flag would refuse it for the
    // wrong reason and name the wrong fix.
    const looksLikeFlag = v !== undefined && v.startsWith("-") && !(numeric && Number.isFinite(Number(v)));
    if (v === undefined || looksLikeFlag) { fail(`${flag} needs a value, and none followed it`); return null; }
    return v;
  };
  // A clamp the reader can see. `Number(x) || default` read every non-number as
  // a request for the default, so `--budget wide` and `--budget 1600` produced
  // the same page; and a value outside the bounds was moved without a word.
  const bounded = (flag, raw, lo, hi) => {
    const n = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(n)) { fail(`${flag} ${raw} is not a number`); return null; }
    let used = Math.trunc(n);
    if (used !== n) o.notices.push(`${flag} ${raw} is not a whole number; using ${used}`);
    if (used < lo) { o.notices.push(`${flag} ${raw} is below the floor of ${lo}; using ${lo}`); used = lo; }
    else if (used > hi) { o.notices.push(`${flag} ${raw} is above the ceiling of ${hi}; using ${hi}`); used = hi; }
    return used;
  };
  const take = (flag, i, lo, hi, set) => {
    const raw = value(flag, i, true);
    if (raw === null) return;
    const n = bounded(flag, raw, lo, hi);
    if (n !== null) set(n);
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("-")) asked.add(a);
    if (a === "--since") { const v = value(a, i); if (v !== null) o.since = v; i++; }
    else if (a === "--budget") { take(a, i, 200, Infinity, (n) => (o.budget = n)); i++; }
    else if (a === "--windows") { take(a, i, 2, 12, (n) => (o.windows = n)); i++; }
    else if (a === "--cap") { take(a, i, 2, Infinity, (n) => (o.cap = n)); i++; }
    else if (a === "--top") { take(a, i, 1, Infinity, (n) => (o.top = n)); i++; }
    else if (a === "--dir") { const v = value(a, i); if (v !== null) o.dir = v; i++; }
    else if (a === "--structure") o.structure = true;
    // A file the user named, and only that: there is no default path here,
    // because the only default worth having would be inside the repository
    // being read, and a read does not write there. An empty string is the flag
    // arriving without its file, which main() refuses by name and with that
    // reason — a fuller sentence than the general one above, and the reason is
    // the part worth reading.
    else if (a === "--snapshot" || a === "--compare") {
      const v = argv[i + 1];
      const given = v !== undefined && !v.startsWith("-");
      if (given) i++;
      o[a.slice(2)] = given ? v : "";
    }
    else if (a === "--version" || a === "-V") { o.version = true; }
    else if (a === "-h" || a === "--help") { o.help = true; }
    else if (a.startsWith("-")) fail(`${a} is not a flag this tool accepts; --help lists the ones it does`);
    else rest.push(a);
  }
  // One repository, because everything below is measured against one tree. A
  // second path was taken as the first and the rest dropped without a word,
  // which reads as a scan of something it never opened.
  if (rest.length > 1) fail(`${rest.length} repositories were given (${rest.join(", ")}); this reads one`);
  if (rest.length) o.repo = rest[0];
  // Each terminal view names the accepted flags it cannot use. Compare takes
  // precedence when both are present: it does not become a subtree view merely
  // because --dir was typed beside it.
  if (o.compare !== null) {
    const ignored = ["--since", "--windows", "--cap", "--top", "--dir", "--structure", "--budget"].filter((f) => asked.has(f));
    if (ignored.length) o.notices.push(`--compare prints only the recorded delta, so ${ignored.join(", ")} ${ignored.length === 1 ? "has" : "have"} no effect here`);
  } else if (o.dir) {
    const ignored = ["--structure", "--budget", "--windows", "--cap", "--top"].filter((f) => asked.has(f));
    if (ignored.length) o.notices.push(`--dir prints one subtree and stops, so ${ignored.join(", ")} ${ignored.length === 1 ? "has" : "have"} no effect here`);
  }
  return o;
}

const HELP = `loadpath — exact facts about how a codebase carries its weight

  node loadpath.mjs [REPO] [options]

  -h, --help          print this
  -V, --version       print the version of this installed copy
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

// What --compare expects, checked before anything is compared against it. This
// is a closed record: accepting a partial or future shape would turn absent
// facts into zeros, or let rendering fail with an implementation stack trace.
function readSnapshot(file) {
  let raw;
  try { raw = readFileSync(file, "utf8"); }
  catch (e) { refuse(`cannot read ${file} — ${String(e.message).split("\n")[0]}`); }
  let j;
  try { j = JSON.parse(raw); }
  catch { refuse(`${file} is not JSON; --compare expects a file written by --snapshot`); }
  const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  const natural = (x) => Number.isInteger(x) && x >= 0;
  const exact = (x, keys) => object(x) && Object.keys(x).sort().join("\0") === [...keys].sort().join("\0");
  const dir = (d) => exact(d, ["files", "lines"]) && natural(d.files) && natural(d.lines);
  const group = (g) => Array.isArray(g) && g.length >= 2 && g.every((n) => typeof n === "string" && n.length > 0);
  const span = (s) => exact(s, ["eco", "unit", "edges", "nodes", "layers", "groups"]) &&
    typeof s.eco === "string" && s.eco.length > 0 && typeof s.unit === "string" && s.unit.length > 0 &&
    natural(s.edges) && natural(s.nodes) && natural(s.layers) && Array.isArray(s.groups) && s.groups.every(group);
  const valid = exact(j, ["schema", "version", "files", "dirs", "spans"]) &&
    j.schema === SNAPSHOT_SCHEMA && typeof j.version === "string" && j.version.length > 0 && natural(j.files) &&
    object(j.dirs) && Object.values(j.dirs).every(dir) && Array.isArray(j.spans) && j.spans.every(span) &&
    new Set(j.spans.map((s) => s.eco)).size === j.spans.length;
  if (!valid) {
    refuse(`${file} does not match loadpath snapshot schema ${SNAPSHOT_SCHEMA}; --compare accepts only the exact shape written by this version's --snapshot`);
  }
  return j;
}

function main() {
  const o = parse(process.argv.slice(2));
  // A command line this tool did not understand is answered before anything is
  // measured. Running anyway would produce a page that looks like an answer to
  // what was typed and is an answer to something else.
  if (o.error) refuse(o.error);
  if (o.version) { console.log(`loadpath ${VERSION}`); return; }
  if (o.help) { console.log(HELP); return; }
  if (o.snapshot === "") refuse("--snapshot needs the file to write, and has no default: the only default worth having would sit inside the repository being read, and a read does not write there");
  if (o.compare === "") refuse("--compare needs the snapshot file to read, and has no default");
  // Where the reader's number and this tool's number differ, on stderr, so it
  // travels with the run and not with the measurements.
  for (const n of o.notices) console.error(`loadpath: ${n}`);

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
  // A subtree inside a module still belongs to that module, so the manifest
  // above the scope is kept beside the ones inside it. Both are what the
  // reader is told is declared, and both are what the analyzers are rooted at.
  const under = (p, q) => q === "" || p === q || p.startsWith(q + "/");
  const inScope = (m) => under(m.path, prefix) || under(prefix, m.path);
  const declared = manifests(root);
  const mans = declared.modules.filter(inScope);
  // What the scan dropped, scoped the same way: a drop outside the scope is not
  // this reader's news. Copies of one name on one side, and the manifests the
  // shape and path rules refused on the other.
  const filtered = declared.filtered.filter(inScope);
  const noise = declared.noise.filter(inScope);

  // Where each analyzer is rooted is the quarantine's decision, not this
  // file's: one root for the whole repository is what made a Go backend beside
  // a Node frontend report that no analyzer applied to either. The subtree is
  // a second question asked of the same graph, so naming one does not change
  // what is measured — only what is also reported.
  const subtree = !o.compare && o.dir ? o.dir.replace(/\/$/, "") : "";
  const spans = dependencies(root, { files, mans, prefix, subtree });
  const record = () => snapshot({ version: VERSION, files, dirs, spans });

  let text;
  if (o.compare) {
    // Only the delta. The reader has seen the normal view already — it is
    // where the snapshot came from — and reprinting it would bury the lines
    // they came back for.
    text = renderCompare(readSnapshot(o.compare), record());
  } else {
    const hist = history(root, {
      since: o.since, windows: o.windows, breadthCap: o.cap, prefix,
      // The same submodule set and exact file population the walk used. Both
      // halves of the page owe the reader one population.
      submodules, live: new Set(dirs.keys()), liveFiles: new Set(files.map((f) => f.path)),
    });
    if (o.dir) {
      text = renderL2({ files, conv, hist, spans, prefix: subtree });
    } else {
      const parts = [];
      parts.push(root + (prefix ? "/" + prefix : ""));
      if (scopeNote) parts.push(scopeNote);
      parts.push("");
      // The whole result, not a pre-rendered line: the entry point does not format.
      parts.push(renderL0({ files, dirs, conv, hist, mans, filtered, noise, spans, scattered: scatter(files), since: o.since }));

      const reloc = renderRelocations(hist);
      if (reloc) { parts.push(""); parts.push(reloc); }

      parts.push("");
      parts.push(renderCoChange(hist, o.top));

      if (o.structure) {
        parts.push("");
        // The section's own header comes back with it: whether the budget trimmed
        // the table is the renderer's fact, and the promise printed here was made
        // by a file that could not know whether it was kept.
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
