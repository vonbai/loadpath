#!/usr/bin/env node
// Mutation check. Delete one load-bearing line at a time and require the suite
// to notice. v0.1.0's suite let 14 of 20 such deletions pass, including the one
// that broke its own headline claim, so a surviving mutant is a release blocker
// rather than a metric.
//
//   node tests/mutate.mjs          run them all
//   node tests/mutate.mjs --list   name them without running

import { readFileSync, writeFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const S = "skills/loadpath/scripts";

// Each mutant removes or inverts one decision the tool is supposed to make.
// A fourth field classifies the ones a hermetic suite cannot simply kill:
//
//   equivalent  a second guard already produces the same observable, so the
//               mutant CANNOT change behaviour. It must survive; if it starts
//               dying, the stated proof has gone stale and belongs re-read.
//   uncovered   killing it needs something this suite will not assume — a
//               network-isolated machine, a warm npx cache, a pip install.
//               Listed on every run so the count is never read as coverage.
//
// Everything without a fourth field must die.
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
  // A record is not a lead: the population rule governs what points somewhere,
  // and must not reach the table whose subject is what already moved away.
  ["the relocation record is filtered to the source population", `${S}/scan.mjs`,
    "const move = inScope(from) || inScope(to) ? commonMove(from, to) : null;",
    "const move = admit(to) && (inScope(from) || inScope(to)) ? commonMove(from, to) : null;"],
  ["the relocation section stops saying what it counts", `${S}/report.mjs`,
    " — every file type, not only source", ""],
  ["shallow clones are not detected", `${S}/scan.mjs`,
    'shallow.out.trim() === "true"', "false"],
  ["object ids must be exactly 40 characters", `${S}/scan.mjs`,
    "/^[0-9a-f]{40,64}$/", "/^[0-9a-f]{40}$/"],
  ["compact --since spellings are not normalised", `${S}/scan.mjs`,
    "const canonical = `${m[1]}.${unit}`;", "const canonical = t;"],
  ["an ambiguous --since unit is guessed at instead of refused", `${S}/scan.mjs`,
    "if (!unit) return { since: t, ambiguous:", "if (false) return { since: t, ambiguous:"],
  ["a future cutoff is accepted", `${S}/scan.mjs`,
    "if (cutoff > Date.now() / 1000) {", "if (false) {"],
  ["an unparseable --since is accepted", `${S}/scan.mjs`,
    "Math.abs(cutoff - Date.now() / 1000) < 5", "false"],
  ["generated files are not filtered", `${S}/scan.mjs`,
    "if (m.generated) continue;", "if (false) continue;"],
  ["generated paths are not filtered", `${S}/scan.mjs`,
    "if (GENERATED_PATH.some((re) => re.test(rel))) return false;", "if (false) return false;"],
  ["vendored and dot directories enter the population", `${S}/scan.mjs`,
    "const closed = (seg) => SKIP_DIR.has(seg) || (seg.startsWith(\".\") && seg !== \".github\");",
    "const closed = () => false;"],
  ["a co-change pair may name a directory the tree no longer has", `${S}/scan.mjs`,
    "if (!live.has(a) || !live.has(b)) { dropped++; continue; }", ""],
  ["the drop of those pairs is not disclosed", `${S}/report.mjs`,
    "if (hist.dropped) out.push(", "if (false) out.push("],
  ["history admits any path with a source extension again", `${S}/scan.mjs`,
    "if (!admit(p) || !inScope(p)) continue;", "if (!SOURCE_EXT.has(extname(p)) || !inScope(p)) continue;"],
  // Two mutants edit one line, because one line now carries two decisions:
  // which paths vote, and which paths count as an edit rather than a creation.
  ["edits are counted over every path in the commit again", `${S}/scan.mjs`,
    "if (!admit(p) || !inScope(p)) continue;",
    "if (st[0] === \"A\") cur.adds++; else cur.edits++; if (!admit(p) || !inScope(p)) continue;"],
  ["the activity horizon is not capped at the convention", `${S}/scan.mjs`,
    "Math.max(1, Math.min(90, Math.floor(span / 86400)))", "Math.max(1, Math.floor(span / 86400))"],
  ["the structure table seeds its search at twenty rows", `${S}/report.mjs`,
    "let lo = 1, hi = rows.length, best = draw(1), kept = 1;", "let lo = 1, hi = rows.length, best = draw(Math.min(rows.length, 20)), kept = 1;"],
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
  ["the size ranking is unsorted", `${S}/report.mjs`,
    "].sort((a, b) => b.files - a.files)", "]"],
  ["the window profile is not printed", `${S}/report.mjs`,
    "[${prof} ]", "[]"],
  ["history keeps directories that no longer exist", `${S}/scan.mjs`,
    "for (const d of [...dirs.keys()]) if (!live.has(d)) dirs.delete(d);", ""],
  ["symlinked paths are compared unresolved", `${S}/loadpath.mjs`,
    "try { root = realpathSync(root); } catch { /* keep the literal path */ }", ""],

  // An independent reviewer wrote its own set against the same files by the
  // same rules; 22 of 26 survived. A hand-curated list measures that the lines
  // in it are covered, not that the suite resists deletion, so the survivors
  // are folded in here and the tests were written until each one dies.
  ["the analyzer coverage gate never fires", `${S}/deps.mjs`,
    "if (r.nodes.size < 2 || covered < 0.2)", "if (false)"],
  ["-mod=readonly is dropped from go list", `${S}/deps.mjs`,
    '"list", "-e", "-mod=readonly", "-json", "./..."', '"list", "-e", "-json", "./..."',
    { uncovered: "readonly is already the default in a module with a complete go.mod; the difference shows only where GOFLAGS=-mod=mod is set in the environment, which the suite will not set on a contributor's machine." }],
  ["the offline guard is dropped from go list", `${S}/deps.mjs`,
    'GOPROXY: "off"', 'GOPROXY: "direct"',
    { uncovered: "asserting a negative about the network needs an isolated machine; on a warm cache both settings resolve identically." }],
  ["madge loses --extensions", `${S}/deps.mjs`,
    '"--json", "--extensions", "ts,tsx,js,jsx,mjs"', '"--json"',
    { uncovered: "needs a warm npx cache. This is the exact silent-empty-output failure the sanity gate exists for, and the gate itself is covered." }],
  ["madge loses --ts-config", `${S}/deps.mjs`,
    'args.push("--ts-config", "./tsconfig.json");', "void 0;",
    { uncovered: "needs a warm npx cache and a repository with path aliases." }],
  ["layer depth is always one", `${S}/deps.mjs`,
    "const depth = maxOf(level) + 1;", "const depth = 1;"],
  ["go self-edges are admitted", `${S}/deps.mjs`,
    "if (dst !== src)", "if (true)",
    { equivalent: "Go forbids a package importing itself, so `go list` never emits a self-edge for the guard to drop." }],
  ["the csproj walk stops at depth one", `${S}/deps.mjs`,
    "const CSPROJ_DEPTH = 12;", "const CSPROJ_DEPTH = 1;"],
  ["python looks only at the repository root", `${S}/deps.mjs`,
    'const roots = ["", "src"]', 'const roots = [""]',
    { uncovered: "needs grimp installed; the suite does not pip install." }],
  ["the orient view loses its dependency line", `${S}/report.mjs`,
    'out.push(renderDeps(spans));', "void 0;"],
  ["the installed copy cannot name its version", `${S}/loadpath.mjs`,
    'const VERSION = "0.3.0";', 'const VERSION = "0.0.0";'],
  ["only the root Go module is analysed", `${S}/deps.mjs`,
    "const mods = goModules(root);", "const mods = [root];"],
  ["a partial module resolution is not disclosed", `${S}/deps.mjs`,
    "const note = reached < mods.length", "const note = false"],
  ["the token bound goes back to a general prose ratio", `${S}/scan.mjs`,
    "const CHARS_PER_TOKEN = 2.6;", "const CHARS_PER_TOKEN = 3.6;"],
  ["the structure table ignores its budget", `${S}/report.mjs`,
    "if (tokens(s) <= budget)", "if (true)"],
  ["p90 is really the max", `${S}/scan.mjs`,
    "return s[Math.min(Math.floor(s.length * p), s.length - 1)];", "return s[s.length - 1];"],
  ["merge commits are counted as work", `${S}/scan.mjs`,
    '"log", `--since=${since}`, "--no-merges"', '"log", `--since=${since}`',
    { equivalent: "a merge emits no --name-status record, so `commits.filter(c => c.paths.length)` drops it a second time regardless." }],
  ["the co-change reporting floor is removed", `${S}/scan.mjs`,
    "if (total < CO_FLOOR || base < CO_SUPPORT) continue;", "if (false) continue;"],
  ["the walk follows symlinks", `${S}/scan.mjs`,
    "if (e.isSymbolicLink()) continue;", "if (false) continue;",
    { equivalent: "a symlink dirent reports neither isDirectory nor isFile, so `if (!e.isFile()) continue` two lines down excludes it anyway. The guard states the intent; it is not the only thing enforcing it." }],
  ["submodules are scanned as first-party code", `${S}/scan.mjs`,
    'return !subs.some((sm) => rel === sm || rel.startsWith(sm + "/"));', "return true;"],
  ["the manifest walk stops at the root", `${S}/scan.mjs`,
    "if (depth > 3) return;", "if (depth > 0) return;"],
  ["an unreadable file returns zero lines", `${S}/scan.mjs`,
    'catch { return { unreadable: true }; }', "catch { return { lines: 0, bytes: 0 }; }"],
  ["the committer date reverts to the author date", `${S}/scan.mjs`,
    '"--format=%x01%H%x1f%ct%x1f%aN"', '"--format=%x01%H%x1f%at%x1f%aN"'],
  ["the resolved cutoff is not reported", `${S}/scan.mjs`,
    "cutoff, cutoffDay,", ""],
  ["L2 no longer sorts files by size", `${S}/report.mjs`,
    "const sorted = [...inSub].sort((a, b) => b.lines - a.lines);", "const sorted = [...inSub];"],
  ["the single-window annotation is dropped", `${S}/report.mjs`,
    '? "  in one window" : ""', '? "" : ""'],
  ["directories with no commit in the window go unmentioned", `${S}/scan.mjs`,
    "const unseen = live.size - dirs.size;", "const unseen = 0;"],
  ["the co-change denominator is dropped", `${S}/report.mjs`,
    "of ${p.base}c", ""],
  ["the repository root prints as a blank name", `${S}/report.mjs`,
    "${p.a || \".\"} + ${p.b || \".\"}", "${p.a} + ${p.b}"],
  ["a trailing slash breaks --dir", `${S}/loadpath.mjs`,
    "o.dir.replace(/\\/$/, \"\")", "o.dir"],
  ["the scope prefix is dropped from history", `${S}/loadpath.mjs`,
    "breadthCap: o.cap, prefix,", "breadthCap: o.cap,"],

  // Spans. Each of these restores a defect that shipped: a repository that
  // declared two ecosystems and reported one of them, or none of them.
  ["the first measured span wins and the rest are dropped", `${S}/deps.mjs`,
    "spans.push(one);", "spans.push(one); if (one.measured) return spans;"],
  ["every analyzer roots at the ancestor of every manifest", `${S}/deps.mjs`,
    "paths: f.ecos.flatMap((e) => byEco.get(e) ?? [])", "paths: mans.map((m) => m.path)"],
  ["a declared ecosystem with no analyzer here is dropped from the array", `${S}/deps.mjs`,
    "if (!FAMILIES.some((f) => f.ecos.includes(eco))) out.push(", "if (false) out.push("],
  ["a missing toolchain is reported as no Go repository", `${S}/deps.mjs`,
    'if (!has("go", ["version"])) {', "if (false) {"],
  ["analyzer node names are left in the analyzer's own coordinates", `${S}/deps.mjs`,
    "const nodes = new Set([...r.nodes].map((n) => rebase(n, at)));", "const nodes = new Set(r.nodes);"],
  ["a subdirectory scan presents the whole module again", `${S}/deps.mjs`,
    'const inside = (n) => !at || n === at || n.startsWith(at + "/");', "const inside = () => true;"],
  ["a scope with none of the ecosystem in it is presented as a graph of nothing", `${S}/deps.mjs`,
    "if (!kept.size) return fam.paths.length", "if (false) return fam.paths.length"],
  ["several spans print without their labels", `${S}/report.mjs`,
    "(spans.length > 1 ?", "(false ?"],
  ["a private application's manifest is not a declaration", `${S}/scan.mjs`,
    "|| (Boolean(j.private) && entries.some((x) => x.isDirectory() && APP_DIR.has(x.name)))", ""],
  ["copies of one scaffold each count as a module", `${S}/scan.mjs`,
    "const shared = new Set([...seen].filter(([, n]) => n > 1).map(([n]) => n));", "const shared = new Set();"],
  ["a hyphenated template directory counts as a module", `${S}/scan.mjs`,
    "|template[-_.][^/]*", ""],
  ["a wide ecosystem name runs into the path beside it", `${S}/report.mjs`,
    '`  ${(m.eco + " ").padEnd(11)}${m.path || "."}`', '`  ${m.eco.padEnd(11)}${m.path || "."}`'],

  // Read, place, move. Each of these deletes something a reader would act on
  // while leaving a page that still looks complete.
  ["the subtree load filter counts internal edges as crossings", `${S}/deps.mjs`,
    "if (inside(a) && inside(b)) within.add(e);", "if (false) within.add(e);"],
  ["the fan-in line is dropped from the subtree load", `${S}/report.mjs`,
    "out.push(`${head}   fan-in ${c.inbound} from outside${counterparts(c.inboundTop, true)}`);", ""],
  ["every file reads as never touched", `${S}/scan.mjs`,
    "if (prior === undefined || c.at > prior) fileLast.set(p, c.at);", "void 0;"],
  ["role words scatter alongside subjects", `${S}/scan.mjs`,
    " && !SCATTER_STOP.has(t)", ""],
  ["a token in one directory is called scattered", `${S}/scan.mjs`,
    ".filter((e) => e.dirs >= minDirs)", ".filter((e) => e.dirs >= 1)"],
  ["a camelCase name is one token again", `${S}/scan.mjs`,
    '.replace(/([a-z0-9])([A-Z])/g, "$1 $2")', ""],
  ["entangled groups are compared by count instead of by membership", `${S}/report.mjs`,
    'const key = (g) => [...g].sort().join("\\0");', "const key = (g) => String(g.length);"],
  ["compare stops saying that history lags a move", `${S}/report.mjs`,
    "for (const l of LAG) out.push(l);", ""],
  ["the snapshot loses the field that identifies it", `${S}/scan.mjs`,
    "    version,", ""],
  // The command line. Each of these restores a departure between what was
  // typed and what ran, made without a word on either stream.
  ["an unknown flag is ignored rather than refused", `${S}/loadpath.mjs`,
    "else if (a.startsWith(\"-\")) fail(", "else if (false) fail("],
  ["a flag whose value is missing takes the default", `${S}/loadpath.mjs`,
    "if (v === undefined || looksLikeFlag) { fail(`${flag} needs a value, and none followed it`); return null; }",
    "if (false) { return null; }"],
  ["a value that is not a number resolves to the default", `${S}/loadpath.mjs`,
    "if (raw.trim() === \"\" || !Number.isFinite(n)) { fail(`${flag} ${raw} is not a number`); return null; }",
    "if (false) { return null; }"],
  ["a value is clamped without saying which number was used", `${S}/loadpath.mjs`,
    "if (used < lo) { o.notices.push(`${flag} ${raw} is below the floor of ${lo}; using ${lo}`); used = lo; }",
    "if (used < lo) { used = lo; }"],
  ["a second repository is dropped instead of refused", `${S}/loadpath.mjs`,
    "if (rest.length > 1) fail(", "if (false) fail("],
  ["--dir stops naming the flags it ignores", `${S}/loadpath.mjs`,
    "if (ignored.length) o.notices.push(", "if (false) o.notices.push("],

  // Disclosure. Every one of these is a list that ends without saying how many
  // it did not name, which is a list claiming to be the whole list.
  ["the language list stops saying what it dropped", `${S}/report.mjs`,
    "+ more(byCount.length - LANGS);", ";"],
  ["the test-convention list stops saying what it dropped", `${S}/report.mjs`,
    "${more(conv.winners.length - CONVS)}", ""],
  ["the largest-directories list stops saying what it dropped", `${S}/report.mjs`,
    "if (dirs.size > ranked.length) out.push(", "if (false) out.push("],
  ["the relocation list stops saying what it dropped", `${S}/report.mjs`,
    "if (hist.relocations.length > RELOCS) out.push(", "if (false) out.push("],
  ["the co-change floor is applied and never stated", `${S}/report.mjs`,
    "and a pair is printed once it clears ${floor}.", "and a pair is printed once it clears the floor."],
  ["the co-change list stops saying what it dropped", `${S}/report.mjs`,
    "if (rest > 0) out.push(`  +${count(rest, \"pair\")} above that floor, not shown (--top ${top})`);", ""],
  ["the entangled-group list stops saying what it dropped", `${S}/report.mjs`,
    "if (d.tangles.length > TANGLES) out.push(", "if (false) out.push("],
  ["the structure header promises every directory whatever the budget did", `${S}/report.mjs`,
    "return [kept < rows.length", "return [false"],
  ["a history record that does not parse is dropped in silence", `${S}/scan.mjs`,
    "if (!/^[0-9a-f]{40,64}$/.test(oid || \"\")) { skipped++; continue; }",
    "if (!/^[0-9a-f]{40,64}$/.test(oid || \"\")) { continue; }"],
  ["the manifests the noise rules refuse go unmentioned", `${S}/report.mjs`,
    "if (noise.length) {", "if (false) {"],
  ["a binary file is counted as source with a newline count", `${S}/scan.mjs`,
    "if (binary) return { unreadable: true, binary: true };", ""],
  ["the files with no line count are not disclosed", `${S}/report.mjs`,
    "if (withheld) {", "if (false) {"],
  // The count was gathered and never returned for as long as the bound existed,
  // which is a disclosure that fails the same way as one deleted here.
  ["the depth bound on the csproj walk goes unmentioned", `${S}/report.mjs`,
    "if (d.unsearched) {", "if (false) {"],

  // What the page spends on saying nothing, and what it says wrongly.
  ["the share column survives a repository with one author", `${S}/report.mjs`,
    "const share = !singleAuthor(hist);", "const share = true;"],
  ["a single-author repository does not say so", `${S}/report.mjs`,
    "if (singleAuthor(hist)) out.push(", "if (false) out.push("],
  ["the structure header goes back to a fixed string", `${S}/report.mjs`,
    "names.map((h, i) => h.padStart(w[i])).join(\" \")", "names.join(\" \")"],
  ["a count of one takes a plural again", `${S}/scan.mjs`,
    "const count = (n, one, many = one + \"s\") => `${num(n)} ${n === 1 ? one : many}`;",
    "const count = (n, one, many = one + \"s\") => `${num(n)} ${many}`;"],
  ["a maximum over a growing array is taken by spread again", `${S}/scan.mjs`,
    "const maxOf = (xs, seed = 0) => { let m = seed; for (const x of xs) if (x > m) m = x; return m; };",
    "const maxOf = (xs, seed = 0) => Math.max(seed, ...xs);"],
  ["an empty entanglement count is printed as a number again", `${S}/report.mjs`,
    "${d.tangles.length ? count(d.tangles.length, \"mutually entangled group\") : \"no mutually entangled group\"}",
    "${d.tangles.length} mutually entangled group(s)"],

  // Reach, and where the analyzers came from.
  ["transitive reach degrades to the direct fan-out", `${S}/deps.mjs`,
    "for (let w = 0; w < W; w++) bits[base + w] |= bits[from + w];", ""],
  ["madge is fetched unpinned", `${S}/deps.mjs`,
    "export const MADGE = `madge@${MADGE_VERSION}`;", "export const MADGE = \"madge\";"],
  ["the provenance stops naming the toolchain that produced the graph", `${S}/deps.mjs`,
    "const versioned = (name, v) => (v ? `${name} ${v}` : name);", "const versioned = (name) => name;"],
];

const list = process.argv.includes("--list");
if (list) { MUTANTS.forEach(([n], i) => console.log(`${String(i + 1).padStart(2)}. ${n}`)); process.exit(0); }

const run = promisify(execFile);

// One mutant is a whole acceptance run over its own copy of the tree, and the
// suite outgrew doing them one at a time: 82 exercised mutants at 15 seconds
// each is 21 minutes of wall clock, on the machine this is actually run on.
// That matters because this is a local gate — the four suites are what a
// change passes before it lands, not what a server reports afterwards — and a
// twenty-minute gate is a gate that gets skipped, which is the exact failure a
// mutation check exists to prevent.
//
// The mutants share nothing: a separate mkdtemp copy each, and every fixture
// the suite builds is a mkdtemp of its own. So a pool moves the clock and not
// one verdict — measured at 4.6 minutes across six lanes, with the same 87
// verdicts in the same order.
//
// One lane fewer than the machine has, and never more than six: each lane's
// suite spawns git and go of its own, so lanes past that contend rather than
// parallelise. `availableParallelism` arrived in Node 18.14 and this project
// supports 18, so the older spelling stands behind it. The whole `os` module
// is imported rather than the name, because a named import of something a
// builtin does not export is a load-time SyntaxError, not a fallback.
const LANES = Math.max(1, Math.min((os.availableParallelism?.() ?? os.cpus().length) - 1, 6));

// The copy is paid once per mutant, so whatever it carries is multiplied by
// the mutant count. `.corpus` is three full public checkouts that
// tests/measure.mjs leaves behind: 51 MB and half a second here, 4 GB of
// copying across a run, and not one byte of it read by an acceptance test.
// Excluding it takes the copy to under a megabyte and 7 ms.
//
// The `.git` test matches the directory itself and not only its contents. A
// filter looking for "/.git/" alone admits the directory entry and then
// refuses every child, which leaves each copy claiming to be a git repository
// with no objects in it.
const carried = (s) => !/(^|\/)(\.git|node_modules|\.corpus)(\/|$)/.test(s.slice(ROOT.length));

// A verdict, and nothing printed: the lanes finish out of order and the report
// below is written in the order the mutants are declared.
async function verdict([, file, from, to, cls]) {
  if (cls?.uncovered) return { kind: "notRun", why: cls.uncovered };
  const dir = mkdtempSync(join(tmpdir(), "lp-mut-"));
  try {
    cpSync(ROOT, dir, { recursive: true, filter: carried });
    const p = join(dir, file);
    const src = readFileSync(p, "utf8");
    if (!src.includes(from)) return { kind: "broken" };
    writeFileSync(p, src.replace(from, to));
    let lived = false;
    try {
      await run("node", ["--test", "tests/loadpath.test.mjs"], { cwd: dir, timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
      lived = true;
    } catch { /* suite failed: the mutant was killed */ }
    // An equivalent mutant is asserted to survive. A kill means the proof is
    // wrong, which is a finding about the claim rather than about the tests.
    if (cls?.equivalent) return lived ? { kind: "equivalent" } : { kind: "resurrected", why: cls.equivalent };
    return lived ? { kind: "survived" } : { kind: "killed" };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// A semaphore rather than batches: a batch waits for its slowest member before
// starting the next, and a mutant killed by the first failing test finishes in
// a fraction of one that runs the suite to the end.
const results = new Array(MUTANTS.length);
let next = 0;
await Promise.all(Array.from({ length: LANES }, async () => {
  for (let i = next++; i < MUTANTS.length; i = next++) results[i] = await verdict(MUTANTS[i]);
}));

const survivors = [], broken = [], resurrected = [], notRun = [];
MUTANTS.forEach(([name], i) => {
  const r = results[i];
  if (r.kind === "notRun") notRun.push([name, r.why]);
  else if (r.kind === "broken") broken.push(name);
  else if (r.kind === "resurrected") resurrected.push([name, r.why]);
  else if (r.kind === "survived") survivors.push(name);
});

const ran = MUTANTS.length - notRun.length;
const equivalent = MUTANTS.filter((m) => m[4]?.equivalent).length - resurrected.length;
const killed = ran - survivors.length - broken.length - equivalent - resurrected.length;
console.log(`mutants ${MUTANTS.length}   killed ${killed}   survived ${survivors.length}   equivalent ${equivalent}   not exercised ${notRun.length}   stale ${broken.length}`);
for (const s of survivors) console.log(`  SURVIVED     ${s}`);
for (const [n, why] of resurrected) console.log(`  PROOF STALE  ${n}\n               was called equivalent because ${why}`);
for (const b of broken) console.log(`  STALE        ${b}  (the line this mutant edits no longer exists)`);
// Printed every run, never counted as coverage: a number that hides its own
// gaps is the failure this repository was rebuilt to stop making.
for (const [n, why] of notRun) console.log(`  NOT EXERCISED  ${n}\n                 ${why}`);
if (survivors.length || broken.length || resurrected.length) process.exit(1);
console.log(`every load-bearing deletion this suite can reach is caught; ${notRun.length} are listed above as out of its reach.`);
