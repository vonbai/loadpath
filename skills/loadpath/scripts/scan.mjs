#!/usr/bin/env node
// Loadpath — exact facts about how a codebase carries its weight.
//
// Everything in this file is measured from the filesystem or from git history.
// Nothing here infers. Inference lives in deps.mjs, alone, so that a reader can
// tell a number's trustworthiness from which file produced it.
//
// Entry point is loadpath.mjs; this file is a module, not a command.
//
// The tool emits leads. A finding exists after someone reads the code a lead
// points at. See DESIGN.md.

import { readdirSync, openSync, readSync, closeSync, existsSync, statSync } from "node:fs";
import { join, relative, dirname, basename, extname, sep, resolve } from "node:path";
import { execFileSync } from "node:child_process";

// ── Vocabulary ───────────────────────────────────────────────────────────────

const SOURCE_EXT = new Set([
  ".go", ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".rs", ".java",
  ".kt", ".kts", ".rb", ".php", ".cs", ".swift", ".c", ".h", ".cc", ".cpp",
  ".hpp", ".m", ".mm", ".scala", ".ex", ".exs", ".clj", ".cljs", ".hs", ".ml",
  ".sol", ".zig", ".dart", ".lua", ".pl", ".r", ".jl", ".vue", ".svelte",
]);

// Directories never walked. Vendored and build output, not first-party code.
const SKIP_DIR = new Set([
  ".git", "node_modules", "vendor", "target", "dist", "build", "out",
  ".venv", "venv", "__pycache__", ".next", ".nuxt", ".svelte-kit", "coverage",
  ".tox", "third_party", "Pods", "Carthage", ".gradle", ".idea", ".vscode",
  ".mypy_cache", ".pytest_cache", ".ruff_cache", "bower_components", ".terraform",
]);

// Generated-file markers, after github-linguist's generated.rb. Path patterns
// first because they need no content read; a filter, not a report line.
const GENERATED_PATH = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|go\.sum|flake\.lock|Podfile\.lock)$/,
  /\.min\.(js|css)$/, /\.pb\.(go|cc|h|py)$/, /_pb2\.py$/, /\.generated\./,
  /(^|\/)(gen|generated)\//, /\.designer\.cs$/i, /\.g\.dart$/, /_generated\.\w+$/,
];
const GENERATED_HEAD = /^\/\/ Code generated .* DO NOT EDIT\.|@generated|DO NOT EDIT/;

// Test-path conventions, voted on rather than assumed. Applied to the full
// repo-relative path, never a bare filename — a filename cannot contain a
// separator, so a path rule tested against one can never fire.
const TEST_RULES = [
  { name: "*_test.*", re: /_test\.[^./]+$/ },
  { name: "test_*", re: /(^|\/)test_[^/]+$/ },
  { name: "*.test.*", re: /\.test\.[^./]+$/ },
  { name: "*.spec.*", re: /\.spec\.[^./]+$/ },
  { name: "*_spec.*", re: /_spec\.[^./]+$/ },
  { name: "__tests__/", re: /(^|\/)__tests__\// },
  { name: "tests/", re: /(^|\/)tests?\// },
  { name: "spec/", re: /(^|\/)specs?\// },
  { name: "*Test.*", re: /(^|\/)[A-Z]\w*Tests?\.[^./]+$/ },
  { name: "conftest.py", re: /(^|\/)conftest\.py$/ },
];

const MANIFESTS = [
  { file: "go.mod", eco: "Go" },
  { file: "package.json", eco: "Node" },
  { file: "pyproject.toml", eco: "Python" },
  { file: "setup.py", eco: "Python" },
  { file: "Cargo.toml", eco: "Rust" },
  { file: "pom.xml", eco: "Java" },
  { file: "build.gradle", eco: "Java" },
  { file: "build.gradle.kts", eco: "Java" },
  { file: "Gemfile", eco: "Ruby" },
  { file: "composer.json", eco: "PHP" },
  { file: "pnpm-workspace.yaml", eco: "Node" },
  { file: "tsconfig.json", eco: "TypeScript" },
];

// ── Small helpers ────────────────────────────────────────────────────────────

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(Math.floor(s.length * p), s.length - 1)];
};
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const num = (n) => n.toLocaleString("en-US");
// Token estimate. A proxy, stated as one wherever it is printed.
const tokens = (s) => Math.round(s.length / 3.6);

function git(root, args, { buffer = false } = {}) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: buffer ? "buffer" : "utf8",
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tryGit(root, args, opts) {
  try { return { ok: true, out: git(root, args, opts) }; }
  catch (e) { return { ok: false, err: String(e.stderr || e.message).trim().split("\n")[0] }; }
}

// ── Inventory — exact, from the filesystem ───────────────────────────────────

function inventory(root, prefix = "") {
  const files = [];
  const unreadable = [];
  const walk = (abs) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".github") continue;
      if (SKIP_DIR.has(e.name)) continue;
      const p = join(abs, e.name);
      if (e.isSymbolicLink()) continue;             // never follow; loops and duplicates
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;
      const rel = relative(root, p).split(sep).join("/");
      if (prefix && !rel.startsWith(prefix + "/") && rel !== prefix) continue;
      if (!SOURCE_EXT.has(extname(e.name))) continue;
      if (GENERATED_PATH.some((re) => re.test(rel))) continue;
      const m = measure(p);
      if (m.unreadable) { unreadable.push(rel); continue; }
      if (m.generated) continue;
      files.push({ path: rel, dir: dirname(rel) === "." ? "" : dirname(rel), ...m });
    }
  };
  walk(root);
  files.unreadable = unreadable;
  return files;
}

// One read per file: line count, byte count, generated-marker check, binary check.
const BUF = Buffer.allocUnsafe(1 << 16);
function measure(abs) {
  let fd;
  // A file that cannot be read is not a file of zero lines. It leaves the
  // inventory rather than entering every total, median and percentile as 0.
  try { fd = openSync(abs, "r"); } catch { return { unreadable: true }; }
  let lines = 0, bytes = 0, first = "", binary = false, partial = false, n;
  try {
    while ((n = readSync(fd, BUF, 0, BUF.length, null)) > 0) {
      if (bytes === 0) first = BUF.subarray(0, Math.min(n, 400)).toString("utf8");
      for (let i = 0; i < n; i++) {
        const b = BUF[i];
        if (b === 10) lines++;
        else if (b === 0) binary = true;
      }
      bytes += n;
    }
  } catch { partial = true; }
  finally { closeSync(fd); }
  if (partial) return { unreadable: true };   // a partial count is not an exact one
  return { lines, bytes, binary, generated: GENERATED_HEAD.test(first) };
}

// Which test convention does this repository use? Voted, not assumed.
function testConvention(files) {
  const votes = TEST_RULES.map((r) => ({ ...r, n: files.filter((f) => r.re.test(f.path)).length }))
    .filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  const winners = votes.filter((v) => v.n >= Math.max(3, votes[0]?.n * 0.2));
  const isTest = (p) => winners.some((w) => w.re.test(p));
  return { winners, isTest };
}

function byDirectory(files, isTest) {
  const dirs = new Map();
  for (const f of files) {
    let d = dirs.get(f.dir);
    if (!d) dirs.set(f.dir, (d = { path: f.dir, files: 0, lines: 0, bytes: 0, tests: 0, lineList: [] }));
    d.files++; d.lines += f.lines; d.bytes += f.bytes;
    if (isTest(f.path)) d.tests++;
    d.lineList.push(f.lines);
  }
  return dirs;
}

// ── History — exact, from git ────────────────────────────────────────────────
//
// One pass with --name-status -M -z yields file lists, add/delete/rename
// status, author and timestamp together. NUL separation is not optional: git
// C-quotes any path holding a non-ASCII byte, a quote, a tab or a newline, and
// such a path parses its own extension wrongly and vanishes.

function history(root, { since, windows, breadthCap, prefix = "" }) {
  const shallow = tryGit(root, ["rev-parse", "--is-shallow-repository"]);
  if (shallow.ok && shallow.out.trim() === "true") {
    return { available: false, reason: "shallow clone — every file reads as added, so history figures would be fabricated. Re-clone without --depth." };
  }
  const probe = tryGit(root, ["log", "-1", `--since=${since}`, "--format=%H"]);
  if (!probe.ok) {
    return { available: false, reason: `not a git repository, or no history (${probe.err})` };
  }
  // Git resolves an unparseable date to *now* and exits 0, so a typo silently
  // empties the window. Ask git to parse it first.
  // Git resolves an unparseable date to *now* and exits 0, so `--since 1y`
  // silently empties the window. A resolved cutoff within a few seconds of
  // now is that failure, not a request for the last few seconds.
  const dateCheck = tryGit(root, ["rev-parse", `--since=${since}`]);
  const cutoff = Number((dateCheck.out || "").match(/--max-age=(\d+)/)?.[1] ?? 0);
  if (!dateCheck.ok || !cutoff || Math.abs(cutoff - Date.now() / 1000) < 5) {
    return { available: false, reason: `--since ${since} is not a date git understands; git resolves it to "now", which would silently report no history` };
  }

  const res = tryGit(root, [
    "-c", "core.quotePath=false", "log", `--since=${since}`, "--no-merges",
    "-M", "--name-status", "-z", "--format=%x01%H%x1f%at%x1f%aN",
  ], { buffer: true });
  if (!res.ok) return { available: false, reason: res.err };

  const text = res.out.toString("utf8");
  const commits = [];
  const relocations = new Map();
  let cur = null;

  for (const chunk of text.split("\x01")) {
    if (!chunk) continue;
    const nl = chunk.indexOf("\n");
    const head = nl < 0 ? chunk : chunk.slice(0, nl);
    const [oid, at, author] = head.split("\x1f");
    if (!/^[0-9a-f]{40,64}$/.test(oid || "")) continue;   // sha1 and sha256 both
    cur = { at: Number(at), author: author || "?", paths: [], adds: 0, edits: 0 };
    commits.push(cur);
    const body = nl < 0 ? "" : chunk.slice(nl + 1);
    const fields = body.split("\0").filter(Boolean);
    const inScope = (p) => !prefix || p === prefix || p.startsWith(prefix + "/");
    for (let i = 0; i < fields.length; i++) {
      const st = fields[i];
      if (!/^[A-Z]\d*$/.test(st)) continue;
      if (st[0] === "R" || st[0] === "C") {
        const from = fields[++i], to = fields[++i];
        if (from && to) {
          if (SOURCE_EXT.has(extname(to)) && inScope(to)) cur.paths.push(to);
          cur.edits++;
          const move = inScope(from) || inScope(to) ? commonMove(from, to) : null;
          if (move) {
            const k = `${move[0]} ${move[1]}`;
            const r = relocations.get(k) || { from: move[0], to: move[1], n: 0, at: cur.at };
            r.n++; r.at = Math.max(r.at, cur.at); relocations.set(k, r);
          }
        }
      } else {
        const p = fields[++i];
        if (!p) continue;
        if (SOURCE_EXT.has(extname(p)) && inScope(p)) cur.paths.push(p);
        if (st[0] === "A") cur.adds++; else cur.edits++;
      }
    }
  }

  const withSource = commits.filter((c) => c.paths.length);
  if (!withSource.length) return { available: false, reason: "no commits touching source in this window" };

  return {
    available: true,
    commits: withSource,
    relocations: [...relocations.values()].filter((r) => r.n >= 3).sort((a, b) => b.n - a.n),
    ...perDirectory(withSource, windows),
    ...coChange(withSource, windows, breadthCap),
  };
}

// A rename's highest differing path prefix. `a/b/x.go -> a/c/x.go` relocates
// `a/b` to `a/c`; a rename inside one directory relocates nothing.
function commonMove(from, to) {
  const a = dirname(from).split("/"), b = dirname(to).split("/");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i >= a.length && i >= b.length) return null;
  const fa = a.slice(0, i + 1).join("/"), fb = b.slice(0, i + 1).join("/");
  return fa === fb ? null : [fa, fb];
}

function perDirectory(commits, windows) {
  const times = commits.map((c) => c.at).sort((a, b) => a - b);
  const lo = times[0], hi = times[times.length - 1], span = Math.max(hi - lo, 1);
  const dirs = new Map();
  for (const c of commits) {
    const seen = new Set();
    for (const p of c.paths) {
      const d = dirname(p) === "." ? "" : dirname(p);
      if (seen.has(d)) continue;
      seen.add(d);
      let e = dirs.get(d);
      if (!e) dirs.set(d, (e = { commits: 0, first: c.at, last: c.at, authors: new Map() }));
      e.commits++;
      e.first = Math.min(e.first, c.at);
      e.last = Math.max(e.last, c.at);
      e.authors.set(c.author, (e.authors.get(c.author) || 0) + 1);
    }
  }
  // Commit-share concentration: the top author's share, and how many authors
  // clear a stated 5% share. The ratio ranked first in a defect model where the
  // raw count did not — but it is undefined where activity is absent, so it is
  // emitted beside the count and never instead of it.
  for (const e of dirs.values()) {
    const shares = [...e.authors.values()].sort((a, b) => b - a);
    e.topShare = shares[0] / e.commits;
    e.majorAuthors = shares.filter((n) => n / e.commits >= 0.05).length;
    e.authorCount = shares.length;
  }
  return { dirs, lo, hi, span, windows };
}

function coChange(commits, windows, cap) {
  const { lo, span } = perDirectory(commits, windows);
  const pair = new Map();
  const own = new Map();
  let capped = 0;
  for (const c of commits) {
    const ds = [...new Set(c.paths.map((p) => (dirname(p) === "." ? "" : dirname(p))))].sort();
    const w = Math.min(Math.floor(((c.at - lo) * windows) / span), windows - 1);
    for (const d of ds) own.set(d, (own.get(d) || 0) + 1);
    if (ds.length < 2) continue;
    // A commit touching many directories is a sweep, not evidence of pairwise
    // coupling: at breadth 100 a pair's share of one vote is 2e-4, so 2,475
    // such commits would be needed to reach the reporting floor. Capping loses
    // nothing measurable and is disclosed.
    if (ds.length > cap) { capped++; continue; }
    const vote = (2 / (ds.length * (ds.length - 1))) * (c.edits === 0 ? 0.15 : 1);
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        const k = ds[i] + " " + ds[j];
        let v = pair.get(k);
        if (!v) pair.set(k, (v = new Array(windows).fill(0)));
        v[w] += vote;
      }
    }
  }
  const pairs = [];
  for (const [k, v] of pair) {
    const [a, b] = k.split(" ");
    const total = v.reduce((x, y) => x + y, 0);
    const base = Math.min(own.get(a) || 0, own.get(b) || 0);
    if (total < 0.5 || base < 3) continue;
    pairs.push({ a, b, total, share: total / base, profile: v });
  }
  pairs.sort((x, y) => y.share - x.share);
  return { pairs, capped, own };
}

// ── Manifests — exact, declared rather than inferred ─────────────────────────

function manifests(root) {
  const found = [];
  const walk = (abs, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name) || e.name.startsWith(".")) continue;
        walk(join(abs, e.name), depth + 1);
      } else {
        const hit = MANIFESTS.find((m) => m.file === e.name);
        if (hit) {
          const rel = relative(root, join(abs, e.name)).split(sep).join("/");
          // A workspace glob is not a module boundary: on one real repository
          // it matched 297 of 299 package.json files where the modules number
          // three. Named-and-public is the filter that separates them.
          let keep = true;
          if (e.name === "package.json") {
            try {
              const j = JSON.parse(readAll(join(abs, e.name)));
              keep = Boolean(j.name) && !j.private;
            } catch { keep = false; }
          }
          if (/(^|\/)(__tests__|fixtures?|playground|examples?|testdata|templates?)\//.test(rel)) keep = false;
          if (keep) found.push({ path: dirname(rel) === "." ? "" : dirname(rel), eco: hit.eco, file: e.name });
        }
      }
    }
  };
  walk(root, 0);
  return found;
}

function readAll(abs) {
  const fd = openSync(abs, "r");
  try {
    let s = "", n;
    while ((n = readSync(fd, BUF, 0, BUF.length, null)) > 0) s += BUF.subarray(0, n).toString("utf8");
    return s;
  } finally { closeSync(fd); }
}

export { inventory, history, manifests, byDirectory, testConvention, median, pct, day, num, tokens, git, tryGit, SOURCE_EXT, SKIP_DIR };
