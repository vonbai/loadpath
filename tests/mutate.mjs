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
    "let lo = 1, hi = rows.length, best = draw(1);", "let lo = 1, hi = rows.length, best = draw(Math.min(rows.length, 20));"],
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
    "const depth = Math.max(0, ...level) + 1;", "const depth = 1;"],
  ["go self-edges are admitted", `${S}/deps.mjs`,
    "if (dst !== src)", "if (true)",
    { equivalent: "Go forbids a package importing itself, so `go list` never emits a self-edge for the guard to drop." }],
  ["the csproj walk stops at depth one", `${S}/deps.mjs`,
    "if (d > 12) { capped++; return; }", "if (d > 1) { capped++; return; }"],
  ["python looks only at the repository root", `${S}/deps.mjs`,
    'const roots = ["", "src"]', 'const roots = [""]',
    { uncovered: "needs grimp installed; the suite does not pip install." }],
  ["the orient view loses its dependency line", `${S}/report.mjs`,
    'out.push(renderDeps(spans));', "void 0;"],
  ["the installed copy cannot name its version", `${S}/loadpath.mjs`,
    'const VERSION = "0.2.2";', 'const VERSION = "0.0.0";'],
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
    "if (total < 0.5 || base < 3) continue;", "if (false) continue;"],
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
    'const inside = (n) => !prefix || n === prefix || n.startsWith(prefix + "/");', "const inside = () => true;"],
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
];

const list = process.argv.includes("--list");
if (list) { MUTANTS.forEach(([n], i) => console.log(`${String(i + 1).padStart(2)}. ${n}`)); process.exit(0); }

const survivors = [], broken = [], resurrected = [], notRun = [];
for (const [name, file, from, to, cls] of MUTANTS) {
  if (cls?.uncovered) { notRun.push([name, cls.uncovered]); continue; }
  const dir = mkdtempSync(join(tmpdir(), "lp-mut-"));
  try {
    cpSync(ROOT, dir, { recursive: true, filter: (s) => !s.includes("/.git/") && !s.includes("node_modules") });
    const p = join(dir, file);
    const src = readFileSync(p, "utf8");
    if (!src.includes(from)) { broken.push(name); continue; }
    writeFileSync(p, src.replace(from, to));
    let lived = false;
    try {
      execFileSync("node", ["--test", "tests/loadpath.test.mjs"], { cwd: dir, stdio: "pipe", timeout: 300000 });
      lived = true;
    } catch { /* suite failed: the mutant was killed */ }
    // An equivalent mutant is asserted to survive. A kill means the proof is
    // wrong, which is a finding about the claim rather than about the tests.
    if (cls?.equivalent) { if (!lived) resurrected.push([name, cls.equivalent]); }
    else if (lived) survivors.push(name);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

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
