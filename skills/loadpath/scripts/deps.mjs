#!/usr/bin/env node
// Loadpath — the quarantine. Everything that cannot be measured exactly lives
// here, alone, so a reader can tell a number's trustworthiness from which file
// produced it.
//
// This module never guesses at imports. It runs each declared ecosystem's own
// analyzer, at that ecosystem's own root, and returns one span per ecosystem —
// a measured graph or a named absence, never a merged graph and never the
// first answer standing for the rest.
//
// Guessing was tried: substring matching of directory
// paths scored 94% precision at one repository root and 43% one directory down,
// and reported fourteen cycles in a Go module where the compiler makes them
// impossible. See docs/adr/0003.
//
// Calling a real analyzer is not the same as trusting it. The dominant failure
// mode of the Node tools is silent empty output, so every result passes a
// sanity assertion before it is believed.

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, resolve, sep, extname } from "node:path";
import { execFileSync } from "node:child_process";

const run = (cmd, args, cwd, ms = 60000, env = {}) => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: "utf8", timeout: ms, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } }) };
  } catch (e) {
    return { ok: false, err: String(e.stderr || e.message).trim().split("\n")[0].slice(0, 160) };
  }
};
// `go --version` does not exist; Go spells it `go version`. A probe that gets
// this wrong reports "no analyzer applies" on a repository that has one.
const has = (bin, probe = ["--version"]) => run(bin, probe, process.cwd(), 8000).ok;

// ── Analyzers ────────────────────────────────────────────────────────────────
//
// Go is the best case: `Imports` is the union across a package's files, so it is
// package-level — and one Go directory is one package, which is exactly this
// tool's granularity. -e keeps going past broken packages; -mod=readonly is not
// optional, because GOFLAGS=-mod=mod rewrites go.mod and reaches the network.
// GOPROXY=off is the other half of that: without it, scanning a module with a
// cold cache downloads its whole dependency tree, which is not what a read does.
const OFFLINE = { GOPROXY: "off", GOFLAGS: "" };

// `go list ./...` stops at the module it is run in. A repository holding several
// go.mod files is several modules, and analysing only the root one silently
// drops the rest: on one real repository that was 290 packages of 420. Each
// module is analysed where it lives, and its package paths are rebased onto the
// repository so every node in the merged graph is one repo-relative directory.
function goModules(root) {
  const mods = [];
  const walk = (abs, d) => {
    if (d > 4) return;
    if (existsSync(join(abs, "go.mod"))) mods.push(abs);
    let es; try { es = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      if (e.name.startsWith(".") || e.name === "vendor" || e.name === "testdata" || e.name === "node_modules") continue;
      walk(join(abs, e.name), d + 1);
    }
  };
  walk(root, 0);
  return mods;
}

function goAnalyzer(root) {
  const mods = goModules(root);
  if (!mods.length) return null;
  // A toolchain that is not installed is not the absence of a Go repository,
  // and returning the same null for both said the second about the first. The
  // module count is what the reader loses, so it is what the sentence names.
  if (!has("go", ["version"])) {
    return { absent: `go is not on PATH, so ${mods.length} Go module${mods.length === 1 ? " was" : "s were"} not analysed` };
  }
  const edges = new Set(); const nodes = new Set();
  let firstWhy = null, reached = 0;
  for (const dir of mods) {
    const at = relative(root, dir).split(sep).join("/");
    const one = goModule(dir, at);
    if (one.why) { firstWhy ??= one.why; continue; }
    reached++;
    for (const n of one.nodes) nodes.add(n);
    for (const e of one.edges) edges.add(e);
  }
  if (!nodes.size) {
    return { provenance: "go list", edges: null,
      why: firstWhy ?? "go list resolved no packages in this repository" };
  }
  // `scope` is a path prefix the coverage gate filters on; a module count is
  // not one, and putting it there would empty the gate's denominator and make
  // every multi-module repository pass unchecked.
  const note = reached < mods.length ? `${reached} of ${mods.length} modules resolved` : "";
  return { provenance: "go list -e -mod=readonly", edges, nodes, unit: "package", unitPlural: "packages", scope: "", note };
}

// One module, rebased onto `at` — the module's directory relative to the repo.
const COLD = "the module cache is cold and this scan does not reach the network; run `go mod download` once, then scan again";
// A refusal to fetch is this tool's choice, not a broken toolchain, and the
// message a reader gets should say which of the two it is.
const explain = (err) => (/GOPROXY=off|module lookup disabled|no such host|dial tcp/i.test(err) ? COLD : err);

function goModule(root, at) {
  const mod = run("go", ["list", "-m"], root, 20000, OFFLINE);
  if (!mod.ok) return { why: explain(mod.err) };
  // In a workspace `go list -m` prints every module; the first line is this one.
  const prefix = mod.out.trim().split("\n")[0].trim();
  if (!prefix) return { why: "go list -m named no module" };
  const r = run("go", ["list", "-e", "-mod=readonly", "-json", "./..."], root, 120000, OFFLINE);
  if (!r.ok) return { why: explain(r.err) };
  const edges = new Set(); const nodes = new Set();
  const rebase = (p) => (at ? (p === "." ? at : at + "/" + p) : p);
  // A concatenated JSON stream, not an array.
  let i = 0, s = r.out;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let depth = 0, start = i, inStr = false, esc = false;
    for (; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") { depth--; if (!depth) { i++; break; } }
    }
    let o; try { o = JSON.parse(s.slice(start, i)); } catch { continue; }
    const ip = o.ImportPath || "";
    if (!ip.startsWith(prefix)) continue;
    const src = rebase(ip.slice(prefix.length).replace(/^\//, "") || ".");
    nodes.add(src);
    for (const imp of o.Imports || []) {
      if (!imp.startsWith(prefix)) continue;
      const dst = rebase(imp.slice(prefix.length).replace(/^\//, "") || ".");
      if (dst !== src) { edges.add(src + "\0" + dst); nodes.add(dst); }
    }
  }
  if (!nodes.size) {
    const vendored = existsSync(join(root, "vendor"));
    return { why: vendored ? "go list resolved no packages in this module" : COLD };
  }
  return { edges, nodes };
}

// Project-to-project edges from .csproj XML. Exact, and needs no toolchain.
function csprojAnalyzer(root) {
  const projects = [];
  let capped = 0;
  const walk = (abs, d) => {
    if (d > 12) { capped++; return; }
    let es; try { es = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.isDirectory()) { if (!e.name.startsWith(".") && e.name !== "bin" && e.name !== "obj") walk(join(abs, e.name), d + 1); }
      else if (e.name.endsWith(".csproj")) projects.push(join(abs, e.name));
    }
  };
  walk(root, 0);
  if (!projects.length) return null;
  const edges = new Set(); const nodes = new Set();
  for (const p of projects) {
    const from = relative(root, dirname(p)).split(sep).join("/") || ".";
    nodes.add(from);
    let xml = ""; try { xml = readFileSync(p, "utf8"); } catch { continue; }
    for (const m of xml.matchAll(/<ProjectReference\s+Include\s*=\s*"([^"]+)"/gi)) {
      const target = relative(root, join(dirname(p), m[1].replace(/\\/g, "/"))).split(sep).join("/");
      const to = dirname(target) || ".";
      if (to !== from) { edges.add(from + "\0" + to); nodes.add(to); }
    }
  }
  return { provenance: ".csproj ProjectReference", edges, nodes, unit: "project", unitPlural: "projects", scope: "" };
}

// grimp knows which modules exist, which a parser cannot: `from x import y`
// leaves y ambiguous between module and attribute, and a parser must emit both.
// On one real corpus that difference was 7,644 edges against grimp's 3,061.
function pythonAnalyzer(root) {
  if (!existsSync(join(root, "pyproject.toml")) && !existsSync(join(root, "setup.py"))) return null;
  if (!run("python3", ["-c", "import grimp"], root, 15000).ok) {
    return { provenance: "grimp", edges: null, why: "grimp is not installed (pip install grimp)" };
  }
  // src-layout is the modern packaging standard; looking only at the repository
  // root finds the tests package or nothing at all.
  const roots = ["", "src"].filter((d) => existsSync(join(root, d || ".")));
  let base = "", pkgs = [];
  for (const d of roots) {
    const here = readdirSync(join(root, d || "."), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "tests" && e.name !== "test"
        && existsSync(join(root, d, e.name, "__init__.py")))
      .map((e) => e.name);
    if (here.length) { base = d; pkgs = here; break; }
  }
  if (!pkgs.length) return { provenance: "grimp", edges: null, why: "no importable package found at the root or under src/" };
  const script = `
import json, grimp
out=[]
for pkg in ${JSON.stringify(pkgs)}:
    try: g = grimp.build_graph(pkg)
    except Exception as e: print(json.dumps({"error": str(e)})); raise SystemExit(0)
    for m in g.modules:
        for d in g.find_modules_directly_imported_by(m):
            out.append([m, d])
print(json.dumps({"edges": out}))`;
  const r = run("python3", ["-c", script], join(root, base), 120000);
  if (!r.ok) return { provenance: "grimp", edges: null, why: r.err };
  let j; try { j = JSON.parse(r.out.trim().split("\n").pop()); } catch { return { provenance: "grimp", edges: null, why: "unparseable grimp output" }; }
  if (j.error) return { provenance: "grimp", edges: null, why: j.error.slice(0, 160) };
  const edges = new Set(); const nodes = new Set();
  const toDir = (m) => m.split(".").slice(0, -1).join("/") || m.split(".")[0];
  for (const [a, b] of j.edges) {
    const [x, y] = [toDir(a), toDir(b)];
    nodes.add(x); nodes.add(y);
    if (x !== y) edges.add(x + "\0" + y);
  }
  return { provenance: "grimp", edges, nodes, unit: "module directory", unitPlural: "module directories", scope: base };
}

// madge returns {} without --extensions and misses aliases without --ts-config,
// with no error either way. Both flags, then the sanity assertion.
function nodeAnalyzer(root) {
  if (!existsSync(join(root, "package.json"))) return null;
  const srcDir = ["src", "lib", "packages", "app"].find((d) => existsSync(join(root, d)));
  // Present and unreadable is a different fact from not present: madge is
  // pointed at a directory, and there is none here to point it at. The sentence
  // states the file and the missing directory rather than calling the file a
  // declaration — whether a package.json declares a module is the manifest
  // scan's judgement, and it is made elsewhere.
  if (!srcDir) return { absent: "a package.json sits here with none of src/, lib/, packages/ or app/ beside it for madge to read" };
  const args = ["--yes", "--offline", "madge", "--json", "--extensions", "ts,tsx,js,jsx,mjs"];
  if (existsSync(join(root, "tsconfig.json"))) args.push("--ts-config", "./tsconfig.json");
  args.push(srcDir);
  // madge exits without draining its stdout pipe, so anything past 64 KiB is
  // lost and the JSON no longer parses — which is every real TypeScript
  // project. Redirect to a file and read it back.
  const tmp = join(tmpdir(), `loadpath-madge-${process.pid}-${Date.now()}.json`);
  const r = run("sh", ["-c", `npx ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ")} > '${tmp}'`], root, 300000);
  let raw = "";
  try { raw = readFileSync(tmp, "utf8"); } catch { /* nothing was written */ }
  finally { try { rmSync(tmp, { force: true }); } catch {} }
  if (!raw.trim()) return { provenance: "madge", edges: null, why: r.ok ? "madge wrote no output" : r.err };
  let j; try { j = JSON.parse(raw); } catch { return { provenance: "madge", edges: null, why: `madge output did not parse (${raw.length} bytes)` }; }
  const keys = Object.keys(j);
  if (!keys.length) return { provenance: "madge", edges: null, why: "madge returned an empty graph; treat as not measured, not as no dependencies" };
  const edges = new Set(); const nodes = new Set();
  const toDir = (p) => { const d = dirname(join(srcDir, p)); return d === "." ? srcDir : d; };
  for (const [from, tos] of Object.entries(j)) {
    const a = toDir(from); nodes.add(a);
    for (const t of tos) { const b = toDir(t); nodes.add(b); if (a !== b) edges.add(a + "\0" + b); }
  }
  return { provenance: "madge", edges, nodes, unit: "file directory", unitPlural: "file directories", scope: srcDir };
}

// ── Ecosystem families ───────────────────────────────────────────────────────
//
// One ecosystem, one analyzer, one span. A repository declaring Go and Node
// holds two dependency graphs and no third one that merges them: `go list`
// counts packages and madge counts file directories, so their sum has no unit.
// Trying the analyzers in order and keeping the first that answered was worse
// than that — it printed one ecosystem's graph as the repository's, and on a
// split tree it printed "no analyzer applies" directly underneath the two
// ecosystems the same page had just declared. See docs/adr/0013.

const FAMILIES = [
  { eco: "Go", ecos: ["Go"], run: goAnalyzer },
  { eco: "C#", ecos: ["C#"], run: csprojAnalyzer },
  { eco: "Python", ecos: ["Python"], run: pythonAnalyzer },
  // madge reads TypeScript and JavaScript through one tsconfig, so a
  // package.json, a workspace file and a tsconfig.json are one family.
  { eco: "Node", ecos: ["Node", "TypeScript"], run: nodeAnalyzer },
];

// An analyzer is rooted at the common ancestor of its OWN ecosystem's
// manifests. The ancestor of every manifest is a different directory: with
// backend/go.mod beside frontend/package.json it is the repository root, where
// neither analyzer finds anything to read.
function commonAncestor(paths) {
  if (!paths.length) return "";
  const parts = paths.map((p) => (p ? p.split("/") : []));
  const first = parts[0];
  let i = 0;
  while (i < first.length && parts.every((p) => p[i] === first[i])) i++;
  return first.slice(0, i).join("/");
}

function families(mans) {
  const byEco = new Map();
  for (const m of mans) {
    for (const eco of m.eco.split("/")) {
      if (!byEco.has(eco)) byEco.set(eco, []);
      byEco.get(eco).push(m.path);
    }
  }
  // Every family is offered the repository, because a manifest scan that stops
  // three directories down does not see a .csproj eight directories down. A
  // family no manifest declared becomes a span only if its analyzer finds its
  // ecosystem there; a declared one becomes a span either way.
  const out = FAMILIES.map((f) => ({ eco: f.eco, run: f.run, paths: f.ecos.flatMap((e) => byEco.get(e) ?? []) }));
  for (const eco of [...byEco.keys()].sort()) {
    if (!FAMILIES.some((f) => f.ecos.includes(eco))) out.push({ eco, run: null, paths: byEco.get(eco) });
  }
  return out;
}

// ── Graph structure ──────────────────────────────────────────────────────────
//
// Tarjan, iterative. Recursion dies around 1,500 nodes and real repositories
// exceed that. Components, not cycles: enumerating cycles of length two and
// three missed 56% of the directories actually inside one, and degraded exactly
// as the tangle grew. "These 27 directories are one module wearing 27 names" is
// the fact; a list of triangles inside it is an arbitrary slice.

export function tarjan(nodes, out) {
  const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
  const comps = []; let counter = 0;
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work = [[root, (out.get(root) || new Set()).values()]];
    index.set(root, counter); low.set(root, counter++); stack.push(root); onStack.add(root);
    while (work.length) {
      const [v, it] = work[work.length - 1];
      let descended = false;
      for (;;) {
        const n = it.next();
        if (n.done) break;
        const w = n.value;
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter++); stack.push(w); onStack.add(w);
          work.push([w, (out.get(w) || new Set()).values()]);
          descended = true; break;
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
      }
      if (descended) continue;
      work.pop();
      if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))); }
      if (low.get(v) === index.get(v)) {
        const comp = [];
        for (;;) { const w = stack.pop(); onStack.delete(w); comp.push(w); if (w === v) break; }
        comps.push(comp.sort());
      }
    }
  }
  return comps;
}

// Steward's DSM partitioning is exactly condensation plus a topological order;
// the blocks that cannot be triangularised are the non-trivial components.
export function layers(comps, out) {
  const of = new Map();
  comps.forEach((c, i) => c.forEach((n) => of.set(n, i)));
  const cOut = comps.map(() => new Set()), indeg = comps.map(() => 0);
  for (const [a, tos] of out) {
    const ca = of.get(a); if (ca === undefined) continue;
    for (const b of tos) {
      const cb = of.get(b);
      if (cb === undefined || cb === ca || cOut[ca].has(cb)) continue;
      cOut[ca].add(cb); indeg[cb]++;
    }
  }
  const level = comps.map(() => 0);
  const queue = comps.map((_, i) => i).filter((i) => indeg[i] === 0);
  const deg = [...indeg];
  while (queue.length) {
    const i = queue.shift();
    for (const j of cOut[i]) {
      level[j] = Math.max(level[j], level[i] + 1);
      if (--deg[j] === 0) queue.push(j);
    }
  }
  return { level, of };
}

// ── Entry point ──────────────────────────────────────────────────────────────

// One span per ecosystem the manifests declare, in a fixed order, each one
// either a measured graph or a named absence. Never a merged graph, never a
// winner, never silence about an ecosystem this page has already named.
export function dependencies(root, { files, mans = [], prefix = "" }) {
  const spans = [];
  for (const fam of families(mans)) {
    const one = span(root, fam, { files, prefix });
    if (!one) continue;
    spans.push(one);
  }
  // Nothing declared and nothing recognised: still one absence, because the
  // dependency axis must never render as blank.
  if (!spans.length) spans.push(notMeasured("", "no analyzer applies to this repository — dependency edges are not guessed here"));
  return spans;
}

const rebase = (n, at) => (!at ? n : n === "." ? at : `${at}/${n}`);
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
// Most-loaded first, and a handful: these are examples a reader follows, not
// an edge list. Which ones are worth printing is Report's decision.
const busiest = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);

function span(root, fam, { files, prefix }) {
  if (!fam.run) return notMeasured(fam.eco, `no analyzer shipped for ${fam.eco}; edges are not guessed here`);
  const at = commonAncestor(fam.paths);
  let r;
  try { r = fam.run(resolve(root, at)); }
  catch (e) { r = { absent: `the ${fam.eco} analyzer raised — ${String(e.message).slice(0, 160)}` }; }
  // null is reserved for "this ecosystem is not here". A manifest said it is,
  // so the reader gets a sentence rather than a missing line.
  const n = fam.paths.length;
  if (!r) return n
    ? notMeasured(fam.eco, `${n} ${fam.eco} manifest${n === 1 ? " declares" : "s declare"} this ecosystem and no project was found at ${at ? at + "/" : "the repository root"}`)
    : null;
  if (r.absent) return notMeasured(fam.eco, r.absent);
  if (!r.edges) return notMeasured(fam.eco, `${r.provenance} could not run — ${r.why}`);

  // Every module speaks repository-relative paths. An analyzer rooted in a
  // subdirectory names its nodes relative to that subdirectory, and a graph in
  // a second coordinate system joins to neither the directory table nor the
  // scope the reader asked for.
  const nodes = new Set([...r.nodes].map((n) => rebase(n, at)));
  const edges = new Set([...r.edges].map((e) => e.split("\0").map((n) => rebase(n, at)).join("\0")));

  // Calling a real analyzer is not trusting it. An empty or absurdly small
  // graph over a large tree is the documented silent-failure shape.
  // Coverage against what the analyzer was pointed at. Judging madge on
  // `src/` by the size of a tree that also holds tests, docs and tooling
  // would reject a correct graph for looking at the thing it was given.
  const scope = [at, r.scope].filter(Boolean).join("/");
  const inScope = files.filter((f) => !scope || f.dir === scope || f.dir.startsWith(scope + "/"));
  const dirCount = new Set(inScope.map((f) => f.dir)).size;
  const where = scope ? `${scope}/` : "the tree";
  if (r.edges.size === 0) return notMeasured(fam.eco, `${r.provenance} resolved no edges over ${dirCount} directories in ${where}; treat as not measured, not as no dependencies`);
  // Proportional, not a constant. A graph covering a twentieth of the tree
  // is not a small graph, it is a failed one — and a fixed floor of three
  // let exactly that through while the message implied otherwise.
  const covered = r.nodes.size / Math.max(dirCount, 1);
  if (r.nodes.size < 2 || covered < 0.2) {
    return notMeasured(fam.eco, `${r.provenance} resolved ${r.nodes.size} nodes over ${dirCount} source directories in ${where} (${Math.round(covered * 100)}%); too little of it to read as a dependency graph`);
  }

  // The gate above judged the analyzer on what it was pointed at; this judges
  // nothing. A subdirectory scan is measured from the module's own root and
  // presented at the reader's scope, because an analyzer rooted at the
  // subdirectory loses exactly the edges the reader is asking about — every
  // import that crosses into it — and on a Go repository finds no go.mod at
  // all. What crosses the line is reported as load, not dropped in silence.
  const inside = (n) => !prefix || n === prefix || n.startsWith(prefix + "/");
  const kept = new Set([...nodes].filter(inside));
  const within = new Set(); const inbound = new Map(); const outbound = new Map();
  for (const e of edges) {
    const [a, b] = e.split("\0");
    if (inside(a) && inside(b)) within.add(e);
    else if (inside(b)) inbound.set(a, (inbound.get(a) || 0) + 1);
    else if (inside(a)) outbound.set(b, (outbound.get(b) || 0) + 1);
  }
  // A scope that holds none of this ecosystem is an absence only where the
  // manifests in scope named it. Where they did not, the reader scoped away
  // from an ecosystem rather than failing to measure one, and a line saying so
  // is noise on every subdirectory of a polyglot repository.
  const unitPlural = r.unitPlural || r.unit + "s";
  if (!kept.size) return fam.paths.length ? notMeasured(fam.eco, `the ${fam.eco} graph holds no ${unitPlural} under ${prefix}`) : null;
  const crossings = prefix
    ? { at: prefix, inbound: sum(inbound), outbound: sum(outbound), inboundTop: busiest(inbound), outboundTop: busiest(outbound) }
    : null;

  const out = new Map();
  for (const e of within) { const [a2, b] = e.split("\0"); if (!out.has(a2)) out.set(a2, new Set()); out.get(a2).add(b); }
  const comps = tarjan([...kept], out);
  const tangles = comps.filter((c) => c.length > 1).sort((a, b) => b.length - a.length);
  const { level } = layers(comps, out);
  const depth = Math.max(0, ...level) + 1;

  const fanIn = new Map(), fanOut = new Map();
  for (const [a2, tos] of out) { fanOut.set(a2, tos.size); for (const b of tos) fanIn.set(b, (fanIn.get(b) || 0) + 1); }

  // Layer and group travel with each node, so a reader never has to join two
  // sections to learn whether a directory is inside a tangle.
  const layerOf = new Map(), groupOf = new Map();
  comps.forEach((c, i) => c.forEach((n) => {
    layerOf.set(n, level[i]);
    if (c.length > 1) groupOf.set(n, tangles.indexOf(c) + 1);
  }));

  return { eco: fam.eco, measured: true, provenance: r.provenance, unit: r.unit, unitPlural,
           note: r.note || "", scope, out, nodes: kept, edges: within.size, comps, tangles, level, depth, fanIn, fanOut, layerOf, groupOf, crossings };
}

// A reason is data, exactly as History's `unavailable` is. Composing the
// sentence a reader sees is Report's job, and this module does not do it —
// see DESIGN.md, "Measure ↔ render".
function notMeasured(eco, why) {
  return { eco, measured: false, why };
}
